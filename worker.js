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
 *      INFORMER_BASE_URL       = https://api.informer.eu/v1   (of v2, etc.)
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
      return await handleExtract(request, env, cors);
    }

    const prefix = "/api/";
    if (!url.pathname.startsWith(prefix)) {
      return json({ error: "Use /api/<path>" }, 404, cors);
    }

    if (!env.INFORMER_API_KEY) {
      return json({ error: "Worker mist INFORMER_API_KEY in Variables." }, 500, cors);
    }

    const baseUrl = (env.INFORMER_BASE_URL || "https://api.informer.eu/v1").replace(/\/+$/, "");
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
// /extract — PDF invoice extraction via Claude API (claude-opus-4-7).
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
      supplier_name:       { type: "string", description: "Volledige bedrijfsnaam van de leverancier (de partij die de factuur stuurt). Geen e-mailadres, geen klantnaam." },
      supplier_vat_number: { type: "string", description: "BTW-nummer van de leverancier (formaat zoals op factuur). Lege string als niet zichtbaar." },
      number:              { type: "string", description: "Factuur- of referentienummer zoals op de factuur." },
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

async function handleExtract(request, env, cors) {
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

  const anthropicReq = {
    model: "claude-opus-4-7",
    max_tokens: 4096,
    // Thinking deliberately omitted: Anthropic rejects thinking when
    // tool_choice forces a specific tool. Extraction here is pattern
    // matching on a structured document, not deliberation, so the loss is
    // negligible.
    tools: [{ ...PURCHASE_INVOICE_TOOL, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "report_purchase_invoice" },
    messages: [{
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: body.pdf_base64 }
        },
        {
          type: "text",
          text: "Dit is een inkoopfactuur. Roep de report_purchase_invoice tool aan met de geëxtraheerde velden. Belangrijke regels: (1) supplier_name = de partij die de factuur stuurt (bedrijfsnaam, geen e-mail/persoonsnaam). (2) Datums in YYYY-MM-DD. (3) Bedragen als getal (geen valuta-symbool). (4) Als de PDF geen regel-specificatie geeft, één samenvattende lijn met de totalen."
        }
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

  const toolBlock = (data.content || []).find(b => b && b.type === "tool_use" && b.name === "report_purchase_invoice");
  if (!toolBlock || !toolBlock.input) {
    return json({ error: "No report_purchase_invoice tool_use in Claude response", raw: data }, 502, cors);
  }

  return json({ extracted: toolBlock.input, usage: data.usage || null }, 200, cors);
}

function hasErrorPayload(err) {
  if (typeof err === "string") return err.length > 0;
  if (Array.isArray(err)) return err.length > 0;
  if (typeof err === "object") return Object.keys(err).length > 0;
  return Boolean(err);
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
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
