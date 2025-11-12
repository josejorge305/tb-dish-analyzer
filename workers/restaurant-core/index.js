import * as restaurantCore from "../../src/features/restaurant_core/index.js";

function j(res, req) {
  const headers = { "content-type": "application/json" };
  const cid = req?.headers?.get?.("x-correlation-id");
  if (cid) headers["x-correlation-id"] = cid;
  return new Response(JSON.stringify(res), { headers });
}
function who(env, req) {
  return j({ worker: "tb-restaurant-core", env: env?.ENV || "production", built_at: env?.BUILT_AT || "n/a" }, req);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    if (pathname === "/healthz") return new Response("ok");
    if (pathname === "/debug/whoami") return who(env, request);

    if (pathname === "/restaurants/find") {
      const query = searchParams.get("query") || "";
      const result = await restaurantCore.findRestaurants(env, { query });
      return j(result, request);
    }

    if (pathname === "/menu/extract" && request.method === "GET") {
      const placeId = searchParams.get("placeId") || "";
      const urlParam = searchParams.get("url") || "";
      const result = await restaurantCore.extractMenu(env, { placeId, url: urlParam });
      return j(result, request);
    }

    return j({ ok: true, service: "tb-restaurant-core" }, request);
  }
}
