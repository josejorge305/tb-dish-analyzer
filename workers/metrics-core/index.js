function j(res, req) {
  const h = { "content-type": "application/json" };
  const cid = req?.headers?.get?.("x-correlation-id");
  if (cid) h["x-correlation-id"] = cid;
  return new Response(JSON.stringify(res), { headers: h });
}
function who(env, req) {
  return j(
    {
      worker: "tb-metrics-core",
      env: env?.ENV || "production",
      built_at: env?.BUILT_AT || "n/a"
    },
    req
  );
}
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") return new Response("ok");
    if (pathname === "/debug/whoami") return who(env, request);
    if (pathname === "/metrics/ingest" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      // placeholder: later we’ll write to KV/D1; for now echo back
      return j({ ok: true, received: body }, request);
    }
    return j({ ok: true, service: "tb-metrics-core" }, request);
  }
}
