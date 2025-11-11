// src/features/restaurant_core/index.js
// Public facade ONLY — we will wire real logic later.

export async function findRestaurants(env, { query }) {
  return { ok: true, source: "restaurant_core.facade", items: [] };
}

export async function extractMenu(env, { placeId, url }) {
  return { ok: true, source: "restaurant_core.facade", sections: [] };
}
