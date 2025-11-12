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
      const cid =
        request.headers.get("x-correlation-id") || crypto.randomUUID();
      const body = await request.json().catch(() => ({}));
      const row = {
        ts: Date.now(),
        method: body.method || request.method,
        path: body.path || new URL(request.url).pathname,
        user_id: body.user_id ?? null,
        correlation_id: body.correlation_id || cid,
        preview:
          typeof body.preview === "string"
            ? body.preview
            : JSON.stringify(body).slice(0, 300)
      };
      try {
        await env.tb_metrics
          .prepare(
            "INSERT INTO logs (ts, method, path, user_id, correlation_id, preview) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(
            row.ts,
            row.method,
            row.path,
            row.user_id,
            row.correlation_id,
            row.preview
          )
          .run();
        return j(
          { ok: true, stored: true, correlation_id: row.correlation_id },
          request
        );
      } catch (err) {
        return j({ ok: false, error: String(err) }, request);
      }
    }
    if (pathname === "/metrics/recent" && request.method === "GET") {
      const limit = Math.min(
        parseInt(new URL(request.url).searchParams.get("limit") || "20", 10),
        200
      );
      const rows = await env.tb_metrics
        .prepare(
          "SELECT id, ts, method, path, user_id, correlation_id, preview FROM logs ORDER BY id DESC LIMIT ?"
        )
        .bind(limit)
        .all();
      return j({ ok: true, items: rows.results }, request);
    }
    return j({ ok: true, service: "tb-metrics-core" }, request);
  }
}
