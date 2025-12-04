// NOTE: This worker is currently DEPRECATED for production recipe logic.
// Production uses the legacy resolver in the main gateway index.js
// (Edamam → Spoonacular → OpenAI + cache, recipe_card, Zestful, etc.).
// Do NOT add new features here until it has been fully brought to parity
// and the routing is explicitly switched back to recipe_core.
import * as recipeCore from "../../src/features/recipe_core/index.js";

function j(res, req) {
  const h = { "content-type": "application/json" };
  const cid = req?.headers?.get?.("x-correlation-id");
  if (cid) h["x-correlation-id"] = cid;
  return new Response(JSON.stringify(res), { headers: h });
}

function who(env, req) {
  return j({ worker: "tb-recipe-core", env: env?.ENV || "production", built_at: env?.BUILT_AT || "n/a" }, req);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") return new Response("ok");
    if (pathname === "/debug/whoami") return who(env, request);

    if (pathname === "/recipe/resolve" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const title = body.title || "";
      const restaurantName = body.restaurantName || null;
      const menuDescription = body.menuDescription || null;
      const menuSection = body.menuSection || null;
      const forceLLM = body.forceLLM || false;
      const ingredients = body.ingredients || [];
      const res = await recipeCore.resolveRecipe(env, {
        title,
        restaurantName,
        menuDescription,
        menuSection,
        forceLLM,
        ingredients
      });
      return j(res, request);
    }

    if (pathname === "/ingredients/normalize" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const lines = body.lines || [];
      const res = await recipeCore.normalizeIngredients(env, { lines });
      return j(res, request);
    }

    return j({ ok: true, service: "tb-recipe-core" }, request);
  }
}
