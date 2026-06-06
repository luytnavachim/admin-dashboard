/**
 * Informer API proxy — Cloudflare Worker
 *
 * Deploy:
 * 1. cloudflare.com → Workers & Pages → Create → Create Worker → Quick edit
 * 2. Paste this file as the only script, click Save and deploy.
 * 3. Worker → Settings → Variables → Add:
 *      INFORMER_API_KEY        = <jouw api key>        (Secret — encrypt!)
 *      INFORMER_SECURITY_CODE  = <jouw security code>  (Secret — alleen als anders dan API key)
 *      INFORMER_AUTH_METHOD    = apikey | bearer | basic-key | basic-user | x-api-key
 *      INFORMER_BASE_URL       = https://api.informer.eu/v2   (of v2, etc.)
 *      ALLOWED_ORIGIN          = *  of  https://jouwsite.github.io  (komma-gescheiden voor meerdere)
 * 4. Copy de worker-URL (eindigt op .workers.dev).
 * 5. In informer.html → sectie 1 → Base URL = <worker-url>/api
 *    Auth-methode = "Geen (proxy regelt auth)".
 *
 * Endpoints:
 *   ANY /api/<rest>   →  <INFORMER_BASE_URL>/<rest>  met auth-header toegevoegd
 *   GET /health       →  { ok: true }                (handig om te testen of worker leeft)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = buildCors(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/health" || url.pathname === "/") {
      return json({ ok: true, hint: "POST/GET via /api/<path>, POST /extract for PDF extraction" }, 200, cors);
    }

    if (url.pathname === "/extract") {
      return await handleExtract(request, env, cors, "purchase");
    }

    if (url.pathname === "/extract-sales") {
      return await handleExtract(request, env, cors, "sales");
    }

    if (url.pathname === "/projects") {
      return await handleProjects(request, env, cors);
    }

    const prefix = "/api/";
    if (!url.pathname.startsWith(prefix)) {
      return json({ error: "Use /api/<path>" }, 404, cors);
    }

    if (!env.INFORMER_API_KEY) {
      return json({ error: "Worker mist INFORMER_API_KEY in Variables." }, 500, cors);
    }

    const baseUrl = (env.INFORMER_BASE_URL || "https://api.informer.eu/v2").replace(/\/+$/, "");
    const upstreamUrl = baseUrl + "/" + url.pathname.slice(prefix.length) + url.search;

    const headers = new Headers();
    headers.set("Accept", "application/json");
    const ct = request.headers.get("content-type");
    if (ct) headers.set("Content-Type", ct);

    const method = (env.INFORMER_AUTH_METHOD || "apikey").toLowerCase();
    const key = env.INFORMER_API_KEY;
    if (method === "apikey") {
      headers.set("Apikey", key);
      headers.set("Securitycode", env.INFORMER_SECURITY_CODE || key);
    }
    else if (method === "bearer") headers.set("Authorization", "Bearer " + key);
    else if (method === "basic-key") headers.set("Authorization", "Basic " + btoa(key + ":"));
    else if (method === "basic-user") headers.set("Authorization", "Basic " + btoa(key));
    else if (method === "x-api-key") headers.set("X-API-Key", key);
    else return json({ error: "Onbekende INFORMER_AUTH_METHOD: " + method }, 500, cors);

    let body = null;
    if (!["GET", "HEAD"].includes(request.method)) {
      body = await request.arrayBuffer();
      if (body.byteLength === 0) body = null;
    }

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, { method: request.method, headers, body });
    } catch (e) {
      return json({ error: "Upstream fetch failed: " + e.message, upstreamUrl }, 502, cors);
    }

    const out = new Headers();
    const passthrough = ["content-type", "etag", "cache-control"];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    for (const [k, v] of Object.entries(cors)) out.set(k, v);

    // Informer returns HTTP 200 with { "error": ... } in the body for
    // validation failures. Translate those into a real 4xx so the
    // sandbox UI (and any other client) sees them as errors.
    let status = upstream.status;
    let bodyBytes = await upstream.arrayBuffer();
    const upstreamCt = upstream.headers.get("content-type") || "";
    if (status === 200 && upstreamCt.includes("application/json")) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bodyBytes));
        if (parsed && parsed.error != null && hasErrorPayload(parsed.error)) {
          status = 422;
        }
      } catch { /* not JSON, leave status as-is */ }
    }

    return new Response(bodyBytes, {
      status,
      statusText: upstream.statusText,
      headers: out
    });
  }
};

// ---------------------------------------------------------------------------
// /extract — PDF invoice extraction via Claude API (claude-haiku-4-5).
// Haiku is ~15x goedkoper dan Opus en levert voor gestructureerde
// tool_choice-extractie van facturen identieke resultaten. Switch terug
// naar claude-sonnet-4-6 of claude-opus-4-7 alleen als Haiku op specifieke
// PDF's faalt (zeldzaam).
//
// Input:  POST { pdf_base64: "..." }
// Output: { extracted: { supplier_name, number, ... }, usage: {...} }
//
// Uses tool_choice to force a structured response matching the schema below.
// Adaptive thinking + ephemeral cache on the tool definition so repeated
// invocations within the cache window only pay for the PDF tokens.
// ---------------------------------------------------------------------------

const PURCHASE_INVOICE_TOOL = {
  name: "report_purchase_invoice",
  description: "Rapporteer de inkoopfactuur-velden zoals geëxtraheerd uit de PDF.",
  input_schema: {
    type: "object",
    properties: {
      supplier_name:           { type: "string", description: "Volledige bedrijfsnaam van de leverancier (de partij die de factuur stuurt). Geen e-mailadres, geen klantnaam." },
      supplier_vat_number:     { type: "string", description: "BTW-nummer van de leverancier (formaat zoals op factuur, bv. NL813399051B01). Lege string als niet zichtbaar." },
      supplier_kvk:            { type: "string", description: "KvK-nummer of buitenlands equivalent (Chamber of Commerce). Lege string als niet zichtbaar." },
      supplier_email:          { type: "string", description: "Contact-emailadres van de leverancier (uit footer/contactinfo). Lege string als niet zichtbaar." },
      supplier_phone:          { type: "string", description: "Telefoonnummer van de leverancier. Lege string als niet zichtbaar." },
      supplier_website:        { type: "string", description: "Website (domein, bv. easypark.nl). Lege string als niet zichtbaar." },
      supplier_street:         { type: "string", description: "Straatnaam van het leveranciersadres (zonder huisnummer). Lege string als niet zichtbaar." },
      supplier_house_number:   { type: "string", description: "Huisnummer van het leveranciersadres (alleen het cijfer, eventuele toevoeging weglaten). Lege string als niet zichtbaar." },
      supplier_zip:            { type: "string", description: "Postcode van het leveranciersadres (formaat zoals op factuur, bv. 1101CM). Lege string als niet zichtbaar." },
      supplier_city:           { type: "string", description: "Plaats van het leveranciersadres. Lege string als niet zichtbaar." },
      supplier_country:           { type: "string", description: "Landcode ISO-3166 alpha-2 (NL, BE, DE, FR, ...). Default NL als alleen 'Nederland' staat zonder code." },
      supplier_contact_firstname: { type: "string", description: "Voornaam van een contactpersoon bij de leverancier ALS die expliciet op de factuur staat (bv. bij freelancer-facturen). Lege string als niet zichtbaar — vul niet de ontvanger of de bedrijfsnaam in." },
      supplier_contact_surname:   { type: "string", description: "Achternaam van een contactpersoon bij de leverancier ALS die expliciet op de factuur staat. Lege string als niet zichtbaar." },
      number:                     { type: "string", description: "Factuur- of referentienummer zoals op de factuur." },
      invoice_date:        { type: "string", description: "Factuurdatum in YYYY-MM-DD." },
      invoice_expiry_date: { type: "string", description: "Vervaldatum in YYYY-MM-DD. Als geen vervaldatum zichtbaar, gebruik dezelfde waarde als invoice_date." },
      currency:            { type: "string", description: "ISO valuta-code (EUR, USD, GBP, ...). Default EUR als niet expliciet vermeld." },
      invoice_total:       { type: "number", description: "Totaalbedrag inclusief BTW." },
      lines: {
        type: "array",
        description: "Eén of meer factuurregels. Als de PDF geen specificatie geeft, één samenvattende regel met de totalen.",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "Korte omschrijving van de regel." },
            amount:      { type: "number", description: "Bedrag exclusief BTW." },
            vat_amount:  { type: "number", description: "BTW-bedrag op deze regel." },
            vat_rate:    { type: "number", description: "BTW-percentage (21, 9, 0, ...). 0 als BTW-vrij of buiten EU." }
          },
          required: ["description", "amount", "vat_amount", "vat_rate"]
        }
      }
    },
    required: ["supplier_name", "number", "invoice_date", "invoice_total", "lines"]
  }
};

// ---------------------------------------------------------------------------
// SALES_INVOICE_TOOL — verkoopfactuur (factuur die WIJ aan een klant
// hebben verstuurd, gemigreerd vanuit MoneyMonk PDF-exports). Customer-
// velden ipv supplier-velden om Claude bij sales-prompts niet onze
// eigen bedrijfsinfo te laten extraheren.
// ---------------------------------------------------------------------------
const SALES_INVOICE_TOOL = {
  name: "report_sales_invoice",
  description: "Rapporteer de verkoopfactuur-velden uit de PDF. Dit is een factuur die WIJ aan een klant hebben verstuurd.",
  input_schema: {
    type: "object",
    properties: {
      customer_name:           { type: "string", description: "Volledige bedrijfsnaam van de klant (de partij die de factuur ontvangt). Geen e-mailadres, geen onze eigen bedrijfsnaam." },
      customer_vat_number:     { type: "string", description: "BTW-nummer van de klant. Lege string als niet zichtbaar." },
      customer_kvk:            { type: "string", description: "KvK-nummer van de klant. Lege string als niet zichtbaar." },
      customer_email:          { type: "string", description: "Contact-emailadres van de klant. Lege string als niet zichtbaar." },
      customer_phone:          { type: "string", description: "Telefoonnummer van de klant. Lege string als niet zichtbaar." },
      customer_website:        { type: "string", description: "Website van de klant. Lege string als niet zichtbaar." },
      customer_street:         { type: "string", description: "Straatnaam van het klantadres (zonder huisnummer). Lege string als niet zichtbaar." },
      customer_house_number:   { type: "string", description: "Huisnummer van het klantadres (alleen het cijfer). Lege string als niet zichtbaar." },
      customer_zip:            { type: "string", description: "Postcode van het klantadres. Lege string als niet zichtbaar." },
      customer_city:           { type: "string", description: "Plaats van het klantadres. Lege string als niet zichtbaar." },
      customer_country:        { type: "string", description: "Landcode ISO-3166 alpha-2 (NL, BE, DE, FR, ...). Default NL als alleen 'Nederland' staat." },
      customer_contact_firstname: { type: "string", description: "Voornaam van een contactpersoon bij de klant ALS die expliciet op de factuur staat. Lege string als niet zichtbaar." },
      customer_contact_surname:   { type: "string", description: "Achternaam van een contactpersoon bij de klant. Lege string als niet zichtbaar." },
      number:                  { type: "string", description: "Factuurnummer zoals op de factuur." },
      invoice_date:            { type: "string", description: "Factuurdatum in YYYY-MM-DD." },
      invoice_expiry_date:     { type: "string", description: "Vervaldatum in YYYY-MM-DD. Als geen vervaldatum zichtbaar, gebruik invoice_date." },
      currency:                { type: "string", description: "ISO valuta-code. Default EUR." },
      invoice_total:           { type: "number", description: "Totaalbedrag inclusief BTW." },
      lines: {
        type: "array",
        description: "Eén of meer factuurregels. Eén samenvattende regel als de PDF geen specificatie geeft.",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "Korte omschrijving van de regel." },
            amount:      { type: "number", description: "Bedrag exclusief BTW." },
            vat_amount:  { type: "number", description: "BTW-bedrag op deze regel." },
            vat_rate:    { type: "number", description: "BTW-percentage (21, 9, 0, ...)." }
          },
          required: ["description", "amount", "vat_amount", "vat_rate"]
        }
      }
    },
    required: ["customer_name", "number", "invoice_date", "invoice_total", "lines"]
  }
};

async function handleExtract(request, env, cors, kind) {
  if (request.method !== "POST") {
    return json({ error: "POST only" }, 405, cors);
  }
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "Worker mist ANTHROPIC_API_KEY in Variables." }, 500, cors);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Body moet JSON zijn met { pdf_base64 }." }, 400, cors); }

  if (!body || typeof body.pdf_base64 !== "string" || !body.pdf_base64) {
    return json({ error: "Missing or empty pdf_base64 in body." }, 400, cors);
  }

  const isSales = kind === "sales";
  const tool = isSales ? SALES_INVOICE_TOOL : PURCHASE_INVOICE_TOOL;
  const userPrompt = isSales
    ? "Dit is een VERKOOPfactuur (sales invoice) — een factuur die WIJ aan een klant hebben verstuurd. Roep de report_sales_invoice tool aan. Belangrijke regels: (1) customer_name = de partij die de factuur ONTVANGT (de klant) — NIET onze eigen bedrijfsnaam die als afzender op de factuur staat. (2) Datums in YYYY-MM-DD. (3) Bedragen als getal, geen valuta-symbool. (4) Eén samenvattende regel als de PDF geen specificatie geeft."
    : "Dit is een inkoopfactuur. Roep de report_purchase_invoice tool aan met de geëxtraheerde velden. Belangrijke regels: (1) supplier_name = de partij die de factuur stuurt (bedrijfsnaam, geen e-mail/persoonsnaam). (2) Datums in YYYY-MM-DD. (3) Bedragen als getal (geen valuta-symbool). (4) Als de PDF geen regel-specificatie geeft, één samenvattende lijn met de totalen.";

  const anthropicReq = {
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    // Thinking deliberately omitted: Anthropic rejects thinking when
    // tool_choice forces a specific tool. Extraction here is pattern
    // matching on a structured document, not deliberation, so the loss is
    // negligible.
    tools: [{ ...tool, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: body.pdf_base64 } },
        { type: "text", text: userPrompt }
      ]
    }]
  };

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(anthropicReq)
    });
  } catch (e) {
    return json({ error: "Anthropic fetch failed: " + e.message }, 502, cors);
  }

  const text = await resp.text();
  if (!resp.ok) {
    return json({ error: "Anthropic " + resp.status, body: text.slice(0, 4000) }, resp.status >= 500 ? 502 : resp.status, cors);
  }

  let data;
  try { data = JSON.parse(text); }
  catch { return json({ error: "Anthropic response not JSON", body: text.slice(0, 2000) }, 502, cors); }

  const toolBlock = (data.content || []).find(b => b && b.type === "tool_use" && b.name === tool.name);
  if (!toolBlock || !toolBlock.input) {
    return json({ error: "No " + tool.name + " tool_use in Claude response", raw: data }, 502, cors);
  }

  return json({ extracted: toolBlock.input, usage: data.usage || null }, 200, cors);
}

function hasErrorPayload(err) {
  if (typeof err === "string") return err.length > 0;
  if (Array.isArray(err)) return err.length > 0;
  if (typeof err === "object") return Object.keys(err).length > 0;
  return Boolean(err);
}

// ---------------------------------------------------------------------------
// /projects — cross-device opslag van projecten + uren in Workers KV.
// Eén key ("projects_v1") met de hele JSON-blob (single-user tool).
// Beveiliging via Microsoft-login: de frontend stuurt z'n Graph-token mee als
// `Authorization: Bearer <token>`. De Worker vraagt Microsoft Graph /me wie de
// gebruiker is en staat alleen toegestane gebruikers toe (env
// PROJECTS_ALLOWED_USERS, komma-gescheiden; default: domein triplet-it.nl).
//   GET  /projects  → { projects: [...] , updatedAt }
//   PUT  /projects  → body { projects: [...] }  (POST mag ook)
// Vereist KV-binding env.PROJECTS_KV (zie wrangler.jsonc).
// ---------------------------------------------------------------------------
function isAllowedProjectsUser(email, env) {
  if (!email) return false;
  const list = (env.PROJECTS_ALLOWED_USERS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.length) return list.includes(email);
  return email.endsWith("@triplet-it.nl");   // default: eigen bedrijfsdomein
}

async function handleProjects(request, env, cors) {
  // Identiteit verifiëren via Microsoft (Graph /me met het meegestuurde token).
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Unauthorized — geen Microsoft-token meegestuurd." }, 401, cors);
  let me;
  try {
    const r = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,id", {
      headers: { Authorization: "Bearer " + token }
    });
    if (!r.ok) return json({ error: "Unauthorized — Microsoft-token ongeldig of verlopen (" + r.status + ")." }, 401, cors);
    me = await r.json();
  } catch (e) {
    return json({ error: "Microsoft-verificatie faalde: " + e.message }, 502, cors);
  }
  const email = String(me.mail || me.userPrincipalName || "").toLowerCase().trim();
  if (!isAllowedProjectsUser(email, env)) {
    return json({ error: "Geen toegang voor " + (email || "onbekende gebruiker") + "." }, 403, cors);
  }
  if (!env.PROJECTS_KV) {
    return json({ error: "Worker mist PROJECTS_KV binding (kv_namespaces in wrangler.jsonc)." }, 500, cors);
  }
  const KEY = "projects_v1";

  if (request.method === "GET") {
    const raw = await env.PROJECTS_KV.get(KEY);
    let data = { projects: [] };
    if (raw) { try { data = JSON.parse(raw); } catch { data = { projects: [] }; } }
    if (!data || !Array.isArray(data.projects)) data = { projects: [] };
    return json(data, 200, cors);
  }

  if (request.method === "PUT" || request.method === "POST") {
    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Body moet JSON zijn met { projects: [...] }." }, 400, cors); }
    if (!body || !Array.isArray(body.projects)) {
      return json({ error: "Body moet { projects: [...] } zijn." }, 400, cors);
    }
    body.updatedAt = new Date().toISOString();
    await env.PROJECTS_KV.put(KEY, JSON.stringify(body));
    return json({ ok: true, updatedAt: body.updatedAt, count: body.projects.length }, 200, cors);
  }

  return json({ error: "Alleen GET of PUT." }, 405, cors);
}

function buildCors(origin, env) {
  const allow = env.ALLOWED_ORIGIN || "*";
  let allowOrigin = "*";
  if (allow !== "*") {
    const list = allow.split(",").map(s => s.trim()).filter(Boolean);
    allowOrigin = list.includes(origin) ? origin : list[0] || "*";
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Projects-Key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });
}
