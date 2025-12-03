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
    if (pathname === "/healthz") {
      return new Response("ok");
    }
    else if (pathname === "/debug/whoami") {
      return who(env, request);
    }
    else if (pathname === "/debug/lex-env" && request.method === "GET") {
      const base = env && (env.LEXICON_API_URL || "");
      const key = env && (env.LEXICON_API_KEY || env.API_KEY || "");
      const info = {
        hasUrl: !!base,
        hasKey: !!key,
        keyLength: key ? String(key).length : 0
      };
      return new Response(JSON.stringify(info, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    else if (pathname === "/organs/from-dish" && request.method === "GET") {
      const dish = searchParams.get("dish") || "";
      const userId = searchParams.get("user_id") || "";
      const res = await organsCore.fromDish(env, { dish, userId });
      return j(res, request);
    }
    else if (pathname === "/organs/assess" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const include_lactose = searchParams.get("include_lactose") === "1";
      const userId = searchParams.get("user_id") || "";
      const lex_hits = Array.isArray(body.lex_hits) ? body.lex_hits : null;
      const res = await organsCore.assessOrgans(env, {
        ingredients: body.ingredients || [],
        userId,
        include_lactose,
        lex_hits
      });
      return j(res, request);
    }
    else if (pathname === "/organs/test-lex" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
      const include_lactose = !!body.include_lactose;

      const result = await organsCore.assessOrgans(env, {
        ingredients,
        userId: "debug-test",
        include_lactose
      });

      return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    return j({ ok: true, service: "tb-allergen-organs" }, request);
  }
}
