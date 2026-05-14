// Local sanity test for worker.js — runs in plain Node, no wrangler needed.
// Mocks globalThis.fetch so we can assert what the Worker sends upstream.

import worker from "./worker.js";

const results = [];
let passed = 0;
let failed = 0;

function assert(cond, label, detail) {
  if (cond) {
    passed++;
    results.push(`  PASS  ${label}`);
  } else {
    failed++;
    results.push(`  FAIL  ${label}` + (detail ? `\n        ${detail}` : ""));
  }
}

function mockUpstream(handler) {
  globalThis.fetch = async (url, init) => {
    const captured = {
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers || {})),
      body: init?.body ?? null
    };
    return handler(captured);
  };
  return () => { delete globalThis.fetch; };
}

async function run(label, fn) {
  console.log(`\n• ${label}`);
  results.length = 0;
  try {
    await fn();
  } catch (e) {
    failed++;
    results.push(`  FAIL  threw: ${e.message}`);
  }
  for (const r of results) console.log(r);
}

const baseEnv = {
  INFORMER_API_KEY: "test-key-123",
  INFORMER_SECURITY_CODE: "sec-456",
  INFORMER_AUTH_METHOD: "apikey",
  INFORMER_BASE_URL: "https://api.informer.eu/v1",
  ALLOWED_ORIGIN: "*"
};

// ---------------------------------------------------------------------------

await run("health endpoint returns ok", async () => {
  const res = await worker.fetch(new Request("https://w.workers.dev/health"), baseEnv);
  assert(res.status === 200, "status 200");
  const body = await res.json();
  assert(body.ok === true, "body.ok = true");
  assert(res.headers.get("access-control-allow-origin") === "*", "CORS allow-origin = *");
});

await run("root returns ok (treated like health)", async () => {
  const res = await worker.fetch(new Request("https://w.workers.dev/"), baseEnv);
  assert(res.status === 200, "status 200");
});

await run("OPTIONS preflight returns 204 with CORS", async () => {
  const res = await worker.fetch(
    new Request("https://w.workers.dev/api/administration/", { method: "OPTIONS" }),
    baseEnv
  );
  assert(res.status === 204, "status 204");
  assert(res.headers.get("access-control-allow-methods")?.includes("POST"), "POST in allowed methods");
});

await run("non-/api path returns 404", async () => {
  const res = await worker.fetch(new Request("https://w.workers.dev/foo"), baseEnv);
  assert(res.status === 404, "status 404");
});

await run("missing API key returns 500", async () => {
  const res = await worker.fetch(
    new Request("https://w.workers.dev/api/administration/"),
    { ...baseEnv, INFORMER_API_KEY: undefined }
  );
  assert(res.status === 500, "status 500");
  const body = await res.json();
  assert(body.error?.includes("INFORMER_API_KEY"), "error mentions INFORMER_API_KEY");
});

// ---------------------------------------------------------------------------
// The big one: auth headers for the apikey method (post-commit-91c9836 fix).

await run("apikey auth: sends Apikey + Securitycode, routes to /administration/", async () => {
  let captured;
  const restore = mockUpstream(req => {
    captured = req;
    return new Response(JSON.stringify({ administrations: [] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  });
  try {
    const res = await worker.fetch(
      new Request("https://w.workers.dev/api/administration/"),
      baseEnv
    );
    assert(res.status === 200, "worker returns 200");
    assert(captured.url === "https://api.informer.eu/v1/administration/", "upstream url joined correctly: " + captured.url);
    assert(captured.headers.apikey === "test-key-123", "Apikey header present (case-insensitive)");
    assert(captured.headers.securitycode === "sec-456", "Securitycode header present");
    assert(!captured.headers.authorization, "no Authorization header sent for apikey method");
  } finally { restore(); }
});

await run("apikey auth: Securitycode falls back to API key when not set", async () => {
  let captured;
  const restore = mockUpstream(req => { captured = req; return new Response("{}", { status: 200 }); });
  try {
    await worker.fetch(
      new Request("https://w.workers.dev/api/administration/"),
      { ...baseEnv, INFORMER_SECURITY_CODE: undefined }
    );
    assert(captured.headers.securitycode === "test-key-123", "Securitycode fell back to api key");
  } finally { restore(); }
});

await run("bearer auth sends Authorization: Bearer", async () => {
  let captured;
  const restore = mockUpstream(req => { captured = req; return new Response("{}", { status: 200 }); });
  try {
    await worker.fetch(
      new Request("https://w.workers.dev/api/whatever"),
      { ...baseEnv, INFORMER_AUTH_METHOD: "bearer" }
    );
    assert(captured.headers.authorization === "Bearer test-key-123", "Authorization: Bearer ...");
    assert(!captured.headers.apikey, "no Apikey header");
  } finally { restore(); }
});

await run("x-api-key auth sends X-API-Key header", async () => {
  let captured;
  const restore = mockUpstream(req => { captured = req; return new Response("{}", { status: 200 }); });
  try {
    await worker.fetch(
      new Request("https://w.workers.dev/api/whatever"),
      { ...baseEnv, INFORMER_AUTH_METHOD: "x-api-key" }
    );
    assert(captured.headers["x-api-key"] === "test-key-123", "X-API-Key header set");
  } finally { restore(); }
});

await run("unknown auth method returns 500", async () => {
  const res = await worker.fetch(
    new Request("https://w.workers.dev/api/whatever"),
    { ...baseEnv, INFORMER_AUTH_METHOD: "voodoo" }
  );
  assert(res.status === 500, "status 500");
});

await run("POST body is forwarded upstream", async () => {
  let captured;
  const restore = mockUpstream(req => { captured = req; return new Response("{}", { status: 200 }); });
  try {
    await worker.fetch(
      new Request("https://w.workers.dev/api/purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 100 })
      }),
      baseEnv
    );
    assert(captured.method === "POST", "method POST");
    const bodyText = new TextDecoder().decode(captured.body);
    assert(bodyText === '{"amount":100}', "body forwarded verbatim, got: " + bodyText);
    assert(captured.headers["content-type"] === "application/json", "content-type forwarded");
  } finally { restore(); }
});

await run("query string is preserved on upstream URL", async () => {
  let captured;
  const restore = mockUpstream(req => { captured = req; return new Response("{}", { status: 200 }); });
  try {
    await worker.fetch(
      new Request("https://w.workers.dev/api/administration/?limit=10&offset=20"),
      baseEnv
    );
    assert(
      captured.url === "https://api.informer.eu/v1/administration/?limit=10&offset=20",
      "query string preserved: " + captured.url
    );
  } finally { restore(); }
});

await run("upstream network failure → 502 with debug info", async () => {
  const restore = mockUpstream(() => { throw new Error("ECONNREFUSED simulated"); });
  try {
    const res = await worker.fetch(
      new Request("https://w.workers.dev/api/administration/"),
      baseEnv
    );
    assert(res.status === 502, "status 502 on upstream failure");
    const body = await res.json();
    assert(body.error?.includes("ECONNREFUSED"), "error message bubbled up");
    assert(body.upstreamUrl?.includes("/administration/"), "upstreamUrl in error body for debugging");
  } finally { restore(); }
});

await run("upstream 401 is passed through (worker is a proxy)", async () => {
  const restore = mockUpstream(() =>
    new Response(JSON.stringify({ error: "bad key" }), {
      status: 401, headers: { "content-type": "application/json" }
    })
  );
  try {
    const res = await worker.fetch(
      new Request("https://w.workers.dev/api/administration/"),
      baseEnv
    );
    assert(res.status === 401, "status 401 passed through");
    const body = await res.json();
    assert(body.error === "bad key", "upstream body passed through");
  } finally { restore(); }
});

await run("CORS with explicit allowed origin echoes that origin", async () => {
  const res = await worker.fetch(
    new Request("https://w.workers.dev/health", {
      headers: { Origin: "https://jouwsite.github.io" }
    }),
    { ...baseEnv, ALLOWED_ORIGIN: "https://jouwsite.github.io,https://other.example" }
  );
  assert(
    res.headers.get("access-control-allow-origin") === "https://jouwsite.github.io",
    "Allow-Origin echoes matched origin"
  );
});

await run("CORS with disallowed origin falls back to first listed", async () => {
  const res = await worker.fetch(
    new Request("https://w.workers.dev/health", {
      headers: { Origin: "https://evil.example" }
    }),
    { ...baseEnv, ALLOWED_ORIGIN: "https://good.example" }
  );
  assert(
    res.headers.get("access-control-allow-origin") === "https://good.example",
    "Allow-Origin falls back to first allowed entry"
  );
});

// ---------------------------------------------------------------------------
// Informer-quirk: HTTP 200 with { error: ... } in body → translate to 422.

await run("upstream 200 with error object → 422", async () => {
  const restore = mockUpstream(() =>
    new Response(JSON.stringify({ error: { "3000101": "Required field is empty: relation_id" } }), {
      status: 200, headers: { "content-type": "application/json" }
    })
  );
  try {
    const res = await worker.fetch(new Request("https://w.workers.dev/api/invoice/purchase/", { method: "POST" }), baseEnv);
    assert(res.status === 422, "200-with-error object → 422, got " + res.status);
    const body = await res.json();
    assert(body.error?.["3000101"]?.includes("relation_id"), "error body still surfaced");
  } finally { restore(); }
});

await run("upstream 200 with error array → 422", async () => {
  const restore = mockUpstream(() =>
    new Response(JSON.stringify({ error: ["Request not found: purchases"] }), {
      status: 200, headers: { "content-type": "application/json" }
    })
  );
  try {
    const res = await worker.fetch(new Request("https://w.workers.dev/api/purchases"), baseEnv);
    assert(res.status === 422, "200-with-error array → 422");
  } finally { restore(); }
});

await run("upstream 200 with error string → 422", async () => {
  const restore = mockUpstream(() =>
    new Response(JSON.stringify({ error: "bad request" }), {
      status: 200, headers: { "content-type": "application/json" }
    })
  );
  try {
    const res = await worker.fetch(new Request("https://w.workers.dev/api/x"), baseEnv);
    assert(res.status === 422, "200-with-error string → 422");
  } finally { restore(); }
});

await run("upstream 200 with empty error array stays 200", async () => {
  const restore = mockUpstream(() =>
    new Response(JSON.stringify({ data: [], error: [] }), {
      status: 200, headers: { "content-type": "application/json" }
    })
  );
  try {
    const res = await worker.fetch(new Request("https://w.workers.dev/api/x"), baseEnv);
    assert(res.status === 200, "empty error → still 200");
  } finally { restore(); }
});

await run("upstream 200 without error field stays 200", async () => {
  const restore = mockUpstream(() =>
    new Response(JSON.stringify({ invoice_id: 16053831, invoice_url: "https://app.informer.eu/..." }), {
      status: 200, headers: { "content-type": "application/json" }
    })
  );
  try {
    const res = await worker.fetch(new Request("https://w.workers.dev/api/invoice/purchase/", { method: "POST" }), baseEnv);
    assert(res.status === 200, "success response stays 200");
    const body = await res.json();
    assert(body.invoice_id === 16053831, "body preserved");
  } finally { restore(); }
});

await run("upstream 200 with non-JSON content stays 200", async () => {
  const restore = mockUpstream(() =>
    new Response("<html>error</html>", {
      status: 200, headers: { "content-type": "text/html" }
    })
  );
  try {
    const res = await worker.fetch(new Request("https://w.workers.dev/api/x"), baseEnv);
    assert(res.status === 200, "non-JSON → no rewrite");
  } finally { restore(); }
});

await run("upstream non-200 with error field is not rewritten", async () => {
  // Already passes-through 401/4xx; this guards we don't double-rewrite.
  const restore = mockUpstream(() =>
    new Response(JSON.stringify({ error: "auth" }), {
      status: 403, headers: { "content-type": "application/json" }
    })
  );
  try {
    const res = await worker.fetch(new Request("https://w.workers.dev/api/x"), baseEnv);
    assert(res.status === 403, "403 stays 403");
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// /extract — PDF invoice extraction via Claude API.

await run("/extract requires POST", async () => {
  const res = await worker.fetch(new Request("https://w.workers.dev/extract"), {
    ...baseEnv, ANTHROPIC_API_KEY: "sk-test"
  });
  assert(res.status === 405, "GET /extract returns 405");
});

await run("/extract requires ANTHROPIC_API_KEY", async () => {
  const res = await worker.fetch(
    new Request("https://w.workers.dev/extract", {
      method: "POST", body: JSON.stringify({ pdf_base64: "x" }),
      headers: { "content-type": "application/json" }
    }),
    { ...baseEnv, ANTHROPIC_API_KEY: undefined }
  );
  assert(res.status === 500, "missing key → 500");
  const body = await res.json();
  assert(body.error?.includes("ANTHROPIC_API_KEY"), "error names the missing var");
});

await run("/extract rejects missing pdf_base64", async () => {
  const res = await worker.fetch(
    new Request("https://w.workers.dev/extract", {
      method: "POST", body: "{}", headers: { "content-type": "application/json" }
    }),
    { ...baseEnv, ANTHROPIC_API_KEY: "sk-test" }
  );
  assert(res.status === 400, "no pdf_base64 → 400");
});

await run("/extract rejects non-JSON body", async () => {
  const res = await worker.fetch(
    new Request("https://w.workers.dev/extract", {
      method: "POST", body: "not json", headers: { "content-type": "application/json" }
    }),
    { ...baseEnv, ANTHROPIC_API_KEY: "sk-test" }
  );
  assert(res.status === 400, "non-JSON → 400");
});

await run("/extract: forwards to Anthropic with the right shape and returns extracted JSON", async () => {
  let captured;
  const restore = mockUpstream(req => {
    captured = req;
    return new Response(JSON.stringify({
      id: "msg_test", role: "assistant", model: "claude-opus-4-7",
      content: [{
        type: "tool_use", id: "toolu_1", name: "report_purchase_invoice",
        input: {
          supplier_name: "EasyPark", number: "4293049306362",
          invoice_date: "2026-05-13", invoice_expiry_date: "2026-05-13",
          currency: "EUR", invoice_total: 12.50,
          lines: [{ description: "Parking", amount: 10.33, vat_amount: 2.17, vat_rate: 21 }]
        }
      }],
      stop_reason: "tool_use",
      usage: { input_tokens: 5000, output_tokens: 250 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const res = await worker.fetch(
      new Request("https://w.workers.dev/extract", {
        method: "POST",
        body: JSON.stringify({ pdf_base64: "JVBERi0xLjQK" }),
        headers: { "content-type": "application/json" }
      }),
      { ...baseEnv, ANTHROPIC_API_KEY: "sk-test" }
    );
    assert(res.status === 200, "status 200, got " + res.status);
    const body = await res.json();
    assert(body.extracted?.supplier_name === "EasyPark", "supplier_name surfaced");
    assert(body.extracted?.invoice_total === 12.50, "invoice_total surfaced");
    assert(body.usage?.input_tokens === 5000, "usage surfaced");

    assert(captured.url === "https://api.anthropic.com/v1/messages", "Anthropic endpoint hit");
    assert(captured.headers["x-api-key"] === "sk-test", "x-api-key sent");
    assert(captured.headers["anthropic-version"] === "2023-06-01", "anthropic-version sent");

    const sentBody = JSON.parse(typeof captured.body === "string" ? captured.body : new TextDecoder().decode(captured.body));
    assert(sentBody.model === "claude-opus-4-7", "model is opus-4-7");
    assert(sentBody.thinking?.type === "adaptive", "adaptive thinking enabled");
    assert(sentBody.tool_choice?.name === "report_purchase_invoice", "tool_choice forces our tool");
    assert(sentBody.tools[0].cache_control?.type === "ephemeral", "tool def is cache-controlled");
    const userMsg = sentBody.messages[0];
    assert(userMsg.content[0].type === "document", "first content block is the PDF");
    assert(userMsg.content[0].source.media_type === "application/pdf", "PDF media_type");
    assert(userMsg.content[0].source.data === "JVBERi0xLjQK", "PDF base64 forwarded verbatim");
  } finally { restore(); }
});

await run("/extract: Anthropic error is passed through", async () => {
  const restore = mockUpstream(() =>
    new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }),
      { status: 400, headers: { "content-type": "application/json" } })
  );
  try {
    const res = await worker.fetch(
      new Request("https://w.workers.dev/extract", {
        method: "POST",
        body: JSON.stringify({ pdf_base64: "x" }),
        headers: { "content-type": "application/json" }
      }),
      { ...baseEnv, ANTHROPIC_API_KEY: "sk-test" }
    );
    assert(res.status === 400, "400 surfaced, got " + res.status);
  } finally { restore(); }
});

await run("/extract: 502 when response has no tool_use block", async () => {
  const restore = mockUpstream(() =>
    new Response(JSON.stringify({
      content: [{ type: "text", text: "I cannot extract this." }],
      stop_reason: "end_turn"
    }), { status: 200, headers: { "content-type": "application/json" } })
  );
  try {
    const res = await worker.fetch(
      new Request("https://w.workers.dev/extract", {
        method: "POST",
        body: JSON.stringify({ pdf_base64: "x" }),
        headers: { "content-type": "application/json" }
      }),
      { ...baseEnv, ANTHROPIC_API_KEY: "sk-test" }
    );
    assert(res.status === 502, "missing tool_use → 502");
  } finally { restore(); }
});

// ---------------------------------------------------------------------------

console.log(`\n${"=".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("=".repeat(60));
if (failed > 0) process.exit(1);
