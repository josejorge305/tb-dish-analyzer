// src/features/organs_core/index.js
export async function assessOrgans(env, { ingredients, userId, include_lactose }) {
  return { ok: true, source: "organs_core.facade", organs: [], insight_lines: [] };
}
export async function fromDish(env, { dish, userId }) {
  return { ok: true, source: "organs_core.facade", organs: [], insight_lines: [] };
}
