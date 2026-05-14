/**
 * Informer API proxy — Cloudflare Worker
 *
 * Deploy:
 * 1. cloudflare.com → Workers & Pages → Create → Create Worker → Quick edit
 * 2. Paste this file as the only script, click Save and deploy.
 * 3. Worker → Settings → Variables → Add:
 *      INFORMER_API_KEY        = <jouw key>            (encrypt!)
 *      INFORMER_AUTH_METHOD    = bearer | basic-key | basic-user | x-api-key
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
      return json({ ok: true, hint: "POST/GET via /api/<path>" }, 200, cors);
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

    const method = (env.INFORMER_AUTH_METHOD || "bearer").toLowerCase();
    const key = env.INFORMER_API_KEY;
    if (method === "bearer") headers.set("Authorization", "Bearer " + key);
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
    const passthrough = ["content-type", "content-length", "etag", "cache-control"];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    for (const [k, v] of Object.entries(cors)) out.set(k, v);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out
    });
  }
};

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
