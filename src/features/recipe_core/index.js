// src/features/recipe_core/index.js
export async function resolveRecipe(env, { title, ingredients }) {
  return { ok: true, source: "recipe_core.facade", recipe: null };
}
export async function normalizeIngredients(env, { lines }) {
  return { ok: true, source: "recipe_core.facade", items: [] };
}
