import * as organsCore from "../../src/features/organs_core/index.js";

function j(res, req) {
  const h = { "content-type": "application/json" };
  const cid = req?.headers?.get?.("x-correlation-id");
  if (cid) h["x-correlation-id"] = cid;
  return new Response(JSON.stringify(res), { headers: h });
}
function who(env, req) {
  return j({ worker: "tb-allergen-organs", env: env?.ENV || "production", built_at: env?.BUILT_AT || "n/a" }, req);
}

export default {
  async fetch(request, env) {
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === "/healthz") return new Response("ok");
    if (pathname === "/debug/whoami") return who(env, request);

    if (pathname === "/organs/from-dish" && request.method === "GET") {
      const dish = searchParams.get("dish") || "";
      const userId = searchParams.get("user_id") || "";
      const res = await organsCore.fromDish(env, { dish, userId });
      return j(res, request);
    }

    if (pathname === "/organs/assess" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const include_lactose = searchParams.get("include_lactose") === "1";
      const userId = searchParams.get("user_id") || "";
      const res = await organsCore.assessOrgans(env, { ingredients: body.ingredients || [], userId, include_lactose });
      return j(res, request);
    }

    return j({ ok: true, service: "tb-allergen-organs" }, request);
  }
}
