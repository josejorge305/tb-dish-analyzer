/* eslint-disable no-undef, no-unused-vars, no-empty, no-useless-escape */

// tb-dish-processor — Cloudflare Worker (Modules) — Uber Eats + Lexicon + Queue + Debug
// Clean build: exact vendor body for /api/job, US bias + filter, proper Modules export.

// ========== Version helper ==========
function getVersion(env) {
  const now = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York"
  });
  const localDate = new Date(now).toISOString().slice(0, 10);
  return env.RELEASE || env.VERSION || `prod-${localDate}`;
}
// Provider order: control fallback (e.g., "edamam,spoonacular,openai")
function providerOrder(env) {
  const raw =
    env && env.PROVIDERS ? String(env.PROVIDERS) : "edamam,spoonacular,openai";
  return raw
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- Simple Premium Gate (KV-backed) ---
// Usage: add ?user_id=alice  AND set KV key: tier/user:alice -> "premium"
// Dev override: ?dev=1 bypasses the check for quick testing.
async function requirePremium(env, url) {
  // Dev bypass for quick testing
  if (url.searchParams.get("dev") === "1") {
    return { ok: true, user: "dev-bypass" };
  }

  const userId = (url.searchParams.get("user_id") || "").trim();
  if (!userId) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: "premium_required",
        hint: "Add ?user_id=YOUR_ID (and make it premium in KV) or use ?dev=1 during development."
      }
    };
  }

  const kvKey = `tier/user:${userId}`;
  const tier = await (env.LEXICON_CACHE ? env.LEXICON_CACHE.get(kvKey) : null);
  if (String(tier || "").toLowerCase() === "premium") {
    return { ok: true, user: userId, tier: "premium" };
  }
  return {
    ok: false,
    status: 402,
    body: {
      ok: false,
      error: "upgrade_required",
      user_id: userId,
      hint: "This feature needs Premium. In dev, set KV key tier/user:YOUR_ID -> premium."
    }
  };
}

// ==== Step 41 Helpers: ctx + trace =========================================
// Lightweight per-request context (for consistent analytics headers)
function makeCtx(env) {
  return {
    served_at: new Date().toISOString(),
    version: getVersion(env)
  };
}

// === PATCH A: params + JSON helpers (safe commas, no trailing spread) ===
function asURL(u) {
  return u instanceof URL ? u : new URL(u, "https://dummy.local");
}
function pick(query, name, def) {
  const v = query.get(name);
  return v == null || v === "" ? def : v;
}
function pickInt(query, name, def) {
  const v = query.get(name);
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}
function pickFloat(query, name, def) {
  const v = query.get(name);
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
async function readJson(req) {
  // --- enqueue minimal meal log (safe debug) ---
  try {
    return await req.json();
  } catch {
    return null;
  }
}
async function readJsonSafe(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
async function parseResSafe(res) {
  const ct =
    (res.headers && res.headers.get && res.headers.get("content-type")) || "";
  try {
    if (ct.includes("application/json")) return await res.json();
    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch {
      return { __nonjson__: txt };
    }
  } catch (e) {
    try {
      const txt = await res.text();
      return {
        __nonjson__: txt,
        __parse_error__: String(e?.message || e)
      };
    } catch (e2) {
      return {
        __parse_error__: String(e?.message || e),
        __read_error__: String(e2?.message || e2)
      };
    }
  }
}
function okJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
function badJson(obj, status = 400) {
  const payload =
    obj && typeof obj === "object" && obj.ok !== undefined
      ? obj
      : { ok: false, ...obj };
  return okJson(payload, status);
}

/**
 * Build a normalized params object for handlers that accept both query/body.
 * Avoids parser errors VS Code was flagging and centralizes validation.
 */
function buildCommonParams(url, body = {}, extras = {}) {
  const q = url.searchParams;
  return {
    user_id: pick(q, "user_id", body?.user_id ?? undefined),
    dish: pick(q, "dish", body?.dish ?? undefined),
    method: pick(q, "method", body?.method ?? undefined),
    weight_kg: pickFloat(q, "weight_kg", body?.weight_kg ?? undefined),
    maxRows: pickInt(
      q,
      "maxRows",
      pickInt(q, "top", body?.maxRows ?? undefined)
    ),
    lat: pickFloat(q, "lat", body?.lat ?? undefined),
    lng: pickFloat(q, "lng", body?.lng ?? undefined),
    radius: pickInt(q, "radius", body?.radius ?? undefined),
    dev: pick(q, "dev", body?.dev ?? undefined) === "1" || body?.dev === 1,
    used_path: undefined,
    ...extras
  };
}

// Standardized trace payload for analytics/debug mirrors
// - endpoint: string (e.g. "uber-test" or "menu-search")
// - searchParams: URLSearchParams from the current request URL
// - env: worker env (optional, used only for host hint)
// - extras: object to merge in later (e.g. { used_path, source, cache })
function makeTrace(endpoint, searchParams, env, extras = {}) {
  const host =
    (env &&
      (env.UBER_RAPID_HOST ||
        env.RAPIDAPI_HOST ||
        env.CF_PAGES_URL ||
        env.HOSTNAME)) ||
    undefined;

  return {
    endpoint,
    query: pick(searchParams, "query", undefined),
    address: pick(searchParams, "address", undefined),
    locale: pick(searchParams, "locale", undefined),
    page: pickInt(searchParams, "page", undefined),
    maxRows: pickInt(
      searchParams,
      "maxRows",
      pickInt(searchParams, "top", undefined)
    ),
    lat: pickFloat(searchParams, "lat", undefined),
    lng: pickFloat(searchParams, "lng", undefined),
    radius: pickInt(searchParams, "radius", undefined),
    host,
    used_path: undefined,
    ...extras
  };
}

// === PATCH B: stricter /user/prefs with schema ===
function validatePrefs(payload) {
  // Minimal, future-proof: pills (allergen/FODMAP keys) + diet_tags
  const errors = [];
  if (!payload || typeof payload !== "object") {
    errors.push("payload must be a JSON object");
    return { ok: false, errors };
  }
  const out = {
    user_id:
      typeof payload.user_id === "string" && payload.user_id.trim()
        ? payload.user_id.trim()
        : null,
    pills: Array.isArray(payload.pills)
      ? payload.pills.filter((x) => typeof x === "string" && x.trim())
      : [],
    diet_tags: Array.isArray(payload.diet_tags)
      ? payload.diet_tags.filter((x) => typeof x === "string" && x.trim())
      : []
  };
  if (!out.user_id) errors.push("user_id is required");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out };
}

async function handleGetUserPrefs(url, env) {
  const q = url.searchParams;
  const user_id = q.get("user_id");
  if (!user_id) return badJson({ error: "user_id is required" }, 400);
  if (!env.USER_PREFS_KV)
    return badJson({ error: "USER_PREFS_KV binding missing" }, 500);

  const key = `user_prefs:${user_id}`;
  const raw = await env.USER_PREFS_KV.get(key, "json");
  return okJson({
    ok: true,
    user_id,
    prefs: raw ?? { pills: [], diet_tags: [] }
  });
}

async function handlePostUserPrefs(request, env) {
  if (!env.USER_PREFS_KV)
    return badJson({ error: "USER_PREFS_KV binding missing" }, 500);
  const body = await readJson(request);
  const v = validatePrefs(body);
  if (!v.ok)
    return badJson({ error: "invalid user prefs", details: v.errors }, 400);

  const key = `user_prefs:${v.value.user_id}`;
  await env.USER_PREFS_KV.put(
    key,
    JSON.stringify({
      pills: v.value.pills,
      diet_tags: v.value.diet_tags
    }),
    { expirationTtl: 60 * 60 * 24 * 365 }
  );
  return okJson({
    ok: true,
    saved: {
      user_id: v.value.user_id,
      pills: v.value.pills,
      diet_tags: v.value.diet_tags
    }
  });
}

// === PATCH C: clearer /organs/from-dish empty-card behavior ===
async function handleOrgansFromDish(url, env, request) {
  try {
    console.log(
      JSON.stringify({
        at: "organs:enter",
        method: request.method,
        q_dish: url.searchParams.get("dish") || null
      })
    );
  } catch {}

  const dishQ = (url.searchParams.get("dish") || "").trim();
  const body = await readJsonSafe(request);
  const dishB =
    body && typeof body === "object" && typeof body.dish === "string"
      ? body.dish.trim()
      : "";

  const finalDish = dishQ || dishB;
  if (!finalDish) {
    try {
      console.log(
        JSON.stringify({
          at: "organs:missing-dish",
          dishQ: dishQ || null,
          dishB: dishB || null
        })
      );
    } catch {}
    const resp = new Response(
      JSON.stringify({
        ok: false,
        error: "dish is required (use ?dish= or JSON {dish})",
        debug: { query_dish: dishQ || null, body_dish: dishB || null }
      }),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" }
      }
    );
    resp.headers.set("X-TB-Route", "/organs/from-dish");
    resp.headers.set("X-TB-Note", "missing-dish");
    return resp;
  }

  const params =
    typeof buildCommonParams === "function"
      ? buildCommonParams(url, body || {}, { dish: finalDish })
      : { dish: finalDish };
  params.used_path = "/organs/from-dish";

  const userId =
    url.searchParams.get("user_id") || (body && body.user_id) || null;
  const prefsKey = `prefs:user:${userId || "anon"}`;
  const user_prefs =
    (env.USER_PREFS_KV &&
      (await env.USER_PREFS_KV.get(prefsKey, "json")).catch?.(() => null)) ||
    (env.USER_PREFS_KV
      ? await env.USER_PREFS_KV.get(prefsKey, "json")
      : null) ||
    {};
  const ORGANS = await getOrgans(env);
  const method =
    (url.searchParams.get("method") || (body && body.method) || "saute")
      .toLowerCase()
      .trim() || "saute";
  const wq = url.searchParams.get("weight_kg") || (body && body.weight_kg);
  const weightNum = Number(wq);
  const weight_kg =
    Number.isFinite(weightNum) && weightNum > 0 ? weightNum : 70;

  const card = await fetchRecipeCardWithFallback(finalDish, env, {
    user_id: userId
  });
  const rawIngredients = Array.isArray(card?.ingredients)
    ? card.ingredients
    : [];
  const recipe_debug = {
    provider: card?.provider ?? null,
    reason: card?.reason ?? null,
    card_ingredients: rawIngredients.length,
    providers_order: providerOrder(env),
    attempts: card?.attempts ?? [],
    user_prefs_present: !!user_prefs && !!Object.keys(user_prefs).length,
    user_prefs_keys: Object.keys(user_prefs || {}),
    assess_prefs_passed: !!user_prefs
  };

  if (!rawIngredients.length) {
    const resp = new Response(
      JSON.stringify({
        ok: true,
        dish: finalDish,
        note: "no ingredients found — recipe card empty and inference didn’t yield ingredients",
        guidance:
          "Try a more specific dish name (e.g., 'Chicken Alfredo (Olive Garden)') or adjust PROVIDERS.",
        recipe_debug,
        ingredients: [],
        organ_levels: {},
        organ_top_drivers: {}
      }),
      { headers: { "content-type": "application/json; charset=utf-8" } }
    );
    resp.headers.set("X-TB-Route", "/organs/from-dish");
    resp.headers.set("X-TB-Note", "empty-ingredients");
    return resp;
  }

  const ingredientsRaw = Array.isArray(card?.ingredients)
    ? card.ingredients
    : [];
  const originalLines = ingredientsRaw.map((item) =>
    typeof item === "string"
      ? item
      : item?.original || item?.name || item?.text || ""
  );
  let ingredients = normalizeIngredientsArray(ingredientsRaw).map((entry) => ({
    name: canonicalizeIngredientName(entry.name),
    grams: entry.grams
  }));
  const normalizedIngredients = ingredients.slice();

  function snapToKnownIngredient(name) {
    const s = name.toLowerCase();
    if (s.includes("olive oil")) return "olive oil";
    if (s.includes("butter")) return "butter";
    if (s.includes("cream")) return "cream";
    if (s.includes("parmesan") || s.includes("parm")) return "parmesan cheese";
    if (s.includes("chicken thigh")) return "chicken thigh";
    if (s.includes("chicken")) return "chicken thighs";
    if (s.includes("fettuccine")) return "fettuccine";
    if (s.includes("tagliatelle")) return "tagliatelle";
    return name;
  }

  // --- organ assessment (inline) ---
  let organLevels = {};
  let organDrivers = {};
  try {
    if (typeof assessOrgansFromIngredients === "function") {
      console.log(
        "[ORGANS] assessing",
        normalizedIngredients.length,
        "ingredients"
      );
      const assessRes = await assessOrgansFromIngredients(
        normalizedIngredients,
        { weightKg: weight_kg }
      );
      organLevels = assessRes?.levels || {};
      organDrivers = assessRes?.top_drivers || {};
    } else {
      organLevels = {};
      organDrivers = {};
    }
  } catch {
    organLevels = {};
    organDrivers = {};
  }

  let calories_kcal = null;
  if (
    (env.EDAMAM_NUTRITION_APP_ID || env.EDAMAM_APP_ID) &&
    (env.EDAMAM_NUTRITION_APP_KEY || env.EDAMAM_APP_KEY) &&
    originalLines.length
  ) {
    try {
      const nut = await callEdamamNutritionAnalyze(
        { title: finalDish, ingr: originalLines },
        env
      );
      console.log("[NUTRITION] keys", Object.keys(nut || {}));
      console.log(
        "[NUTRITION] ingredients_n",
        Array.isArray(nut?.ingredients) ? nut.ingredients.length : null
      );
      console.log("[NUTRITION] totalWeight", nut?.totalWeight);
      console.log("[NUTRITION] lines_sent", originalLines);
      console.log(
        "[NUTRITION] reason:",
        nut?.reason,
        "calA:",
        nut?.calories,
        "calB:",
        nut?.nutrition?.calories
      );
      calories_kcal =
        typeof nut?.calories === "number"
          ? Math.round(nut.calories)
          : typeof nut?.nutrition?.calories === "number"
            ? Math.round(nut.nutrition.calories)
            : calories_kcal;
      if (Array.isArray(nut?.ingredients) && nut.ingredients.length) {
        const byName = new Map(
          nut.ingredients
            .filter((i) => i?.name)
            .map((i) => [canonicalizeIngredientName(i.name), i.grams])
        );
        ingredients = ingredients.map((item) => {
          const grams = byName.has(item.name)
            ? byName.get(item.name)
            : item.grams;
          return { name: item.name, grams };
        });
      }
    } catch {
      // non-fatal enrichment failure
    }
  }
  console.log("[CALORIES] kcal", calories_kcal);

  ingredients = ingredients.map((it) => ({
    ...it,
    name: snapToKnownIngredient(it.name)
  }));

  let organ = null;
  const origin = url.origin;
  let assessResp = null;
  try {
    assessResp = await env.SELF.fetch(
      new Request(new URL("/organs/assess", url).toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ingredients,
          user_id: userId,
          method,
          weight_kg,
          user_prefs
        })
      })
    );
  } catch (err) {
    return okJson({
      ok: true,
      dish: finalDish,
      note: "assess_call_failed",
      detail: String(err?.message || err),
      recipe_debug,
      ingredients
    });
  }

  const data = await parseResSafe(assessResp);
  console.log("[ASSESS] status", assessResp.status);
  if (!assessResp.ok || !data || typeof data !== "object") {
    return okJson({
      ok: true,
      dish: finalDish,
      note: "assess_upstream_error",
      status: assessResp.status,
      detail: data?.__nonjson__ || data,
      recipe_debug,
      ingredients
    });
  }
  organ = data;

  if (!organLevels || !Object.keys(organLevels).length) {
    organLevels = organ?.levels ?? organ?.organ_levels ?? {};
  }
  if (!organDrivers || !Object.keys(organDrivers).length) {
    organDrivers = organ?.top ?? organ?.organ_top_drivers ?? organDrivers ?? {};
  }
  console.log("[ORGANS] filled", {
    levels_keys: Object.keys(organLevels || {}).length,
    top_keys: Object.keys(organDrivers || {}).length
  });
  const driversSlim = slimTopDrivers(organDrivers || {});
  const driversText = topDriversText(driversSlim);

  const organ_summaries = organ?.summaries ?? {};
  const organ_top_drivers = { ...(organDrivers || {}) };
  const scoring = organ?.scoring || {};
  const filled = { organ_levels: organLevels || {} };
  const levels =
    (typeof organ_levels !== "undefined" && organ_levels) ||
    filled?.organ_levels ||
    scoring?.organ_levels ||
    scoring?.levels ||
    {};
  for (const organName of ORGANS) {
    if (!(organName in levels)) levels[organName] = "Neutral";
    if (!Array.isArray(organ_top_drivers[organName]))
      organ_top_drivers[organName] = [];
  }
  const levelToBar = (s) =>
    ({
      "High Benefit": 80,
      Benefit: 40,
      Neutral: 0,
      Caution: -40,
      "High Caution": -80
    })[s] ?? 0;
  const levelToColor = (s) =>
    ({
      "High Benefit": "#16a34a",
      Benefit: "#22c55e",
      Neutral: "#a1a1aa",
      Caution: "#f59e0b",
      "High Caution": "#dc2626"
    })[s] ?? "#a1a1aa";
  const barometerToColor = (n) =>
    n >= 40
      ? "#16a34a"
      : n > 0
        ? "#22c55e"
        : n === 0
          ? "#a1a1aa"
          : n <= -40
            ? "#dc2626"
            : "#f59e0b";
  const buildInsights = ({ top, prefs, organs = [] }) => {
    const lines = [];
    for (const organKey of organs) {
      const arr = Array.isArray(top?.[organKey]) ? top[organKey] : [];
      if (arr.length) {
        const title =
          organKey.charAt(0).toUpperCase() +
          organKey.slice(1).replace(/_/g, " ");
        lines.push(`${title}: ${arr.join(", ")}`);
        if (lines.length >= 3) break;
      }
    }
    if (prefs?.allergens?.dairy === false) {
      lines.push("Preference: dairy-sensitive applied");
    }
    if (
      prefs?.allergens?.garlic_onion === true ||
      prefs?.fodmap?.strict === true
    ) {
      lines.push("Preference: FODMAP applied");
    }
    return lines.slice(0, 3);
  };
  const organ_bars = ORGANS.reduce((acc, organKey) => {
    acc[organKey] = levelToBar(levels[organKey]);
    return acc;
  }, {});
  const organ_colors = ORGANS.reduce((acc, organKey) => {
    acc[organKey] = levelToColor(levels[organKey]);
    return acc;
  }, {});
  const tummy_barometer = computeBarometerFromLevelsAll(ORGANS, levels);
  const barometer_color = barometerToColor(tummy_barometer);
  const insight_lines = buildInsights({
    organs: ORGANS,
    top: organ_top_drivers,
    prefs: user_prefs
  });
  const result = {
    ok: true,
    dish: finalDish,
    ingredients,
    organ_summaries,
    organ_levels: levels,
    organ_top_drivers,
    drivers_slim: driversSlim,
    calories_kcal,
    tummy_barometer,
    barometer_color,
    organ_bars,
    organ_colors,
    insight_lines,
    recipe_debug
  };

  try {
    const names = ingredients.map((i) => i.name).filter(Boolean);

    console.log("[ENQUEUE] meal_log preview:", {
      levels_keys: Object.keys(organLevels || {}).length,
      top_keys: Object.keys(organDrivers || {}).length
    });

    if (env.ANALYSIS_QUEUE && names.length) {
      await env.ANALYSIS_QUEUE.send({
        kind: "meal_log",
        dish: finalDish,
        user_id: userId,
        ingredients: names,
        organs_summary: { levels: organLevels, top_drivers: organDrivers },
        organ_levels: organLevels,
        organ_top_drivers: organDrivers,
        calories_kcal: result.calories_kcal ?? null,
        created_at: new Date().toISOString()
      });
      recipe_debug.enqueue = { ok: true };
    } else {
      recipe_debug.enqueue = {
        ok: false,
        reason: "no_queue_or_no_ingredients"
      };
    }
  } catch (e) {
    recipe_debug.enqueue = { ok: false, reason: String(e?.message || e) };
  }

  try {
    console.log(JSON.stringify({ at: "organs:return", dish: finalDish }));
  } catch {}
  return okJson(result);
}

async function handleDebugEcho(url, request) {
  const body = await readJson(request);
  const query = {};
  for (const [k, v] of url.searchParams.entries()) query[k] = v;
  return okJson({
    ok: true,
    method: request.method,
    query,
    body: body ?? null
  });
}

// [38.10] — shared CORS headers  (HOISTED so it's available everywhere)
const CORS_ALL = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// Build a safe preview object for debug=1 (no CORS needed)
function buildDebugPreview(raw, env, rowsUS = null, titles = null) {
  const usedHost =
    env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const sample =
    (Array.isArray(raw?.results) && raw.results[0]) ||
    (Array.isArray(raw?.data?.results) && raw.data.results[0]) ||
    (Array.isArray(raw?.data?.data?.results) && raw.data.data.results[0]) ||
    (Array.isArray(raw?.payload?.results) && raw.payload.results[0]) ||
    (Array.isArray(raw?.job?.results) && raw.job.results[0]) ||
    (rowsUS && Array.isArray(rowsUS) && rowsUS[0]) ||
    raw;

  return {
    ok: true,
    source: "debug-preview",
    host: usedHost,
    topLevelKeys: raw && typeof raw === "object" ? Object.keys(raw) : [],
    has_results: Array.isArray(raw?.results),
    has_data_results: Array.isArray(raw?.data?.results),
    has_data_data_results: Array.isArray(raw?.data?.data?.results),
    has_payload_results: Array.isArray(raw?.payload?.results),
    has_job_results: Array.isArray(raw?.job?.results),
    has_returnvalue_data: Array.isArray(raw?.returnvalue?.data),
    ...(Array.isArray(titles)
      ? { count: titles.length, titles: titles.slice(0, 25) }
      : {}),
    sample
  };
}

// Safe helper: always returns an object (never throws if 'trace' is missing)
function safeTrace(t) {
  return t && typeof t === "object" ? t : {};
}
// ==========================================================================

// Simple sleep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== LLM SAFE GLOBAL HELPERS (always defined) =====
(function ensureLLMHelpers() {
  function _isValidUrl(u) {
    try {
      new URL(String(u || "").trim());
      return true;
    } catch {
      return false;
    }
  }

  if (typeof globalThis.normalizeLLMItems !== "function") {
    globalThis.normalizeLLMItems = function normalizeLLMItems(
      rawItems = [],
      tag = "llm"
    ) {
      return (Array.isArray(rawItems) ? rawItems : [])
        .map((it) => ({
          title: String(it.title || it.name || "").trim() || null,
          description: String(it.description || it.desc || "").trim() || null,
          section: String(it.section || it.category || "").trim() || null,
          price_cents: Number.isFinite(Number(it.price_cents))
            ? Number(it.price_cents)
            : null,
          price_text: it.price_text
            ? String(it.price_text)
            : Number.isFinite(it.price_cents)
              ? `$${(Number(it.price_cents) / 100).toFixed(2)}`
              : null,
          calories_text: it.calories_text ? String(it.calories_text) : null,
          source: tag,
          confidence: typeof it.confidence === "number" ? it.confidence : 0.7
        }))
        .filter((r) => r.title);
    };
  }

  if (typeof globalThis.dedupeItemsByTitleSection !== "function") {
    globalThis.dedupeItemsByTitleSection = function dedupeItemsByTitleSection(
      items = []
    ) {
      const seen = new Map(),
        keep = [];
      for (const it of items) {
        const k = `${(it.section || "").toLowerCase()}|${(it.title || "").toLowerCase()}`;
        if (!seen.has(k)) {
          seen.set(k, keep.length);
          keep.push(it);
        } else {
          const i = seen.get(k),
            cur = keep[i];
          const curScore =
            (cur.price_cents ? 1 : 0) +
            (cur.price_text ? 1 : 0) +
            (cur.description ? cur.description.length / 100 : 0);
          const nxtScore =
            (it.price_cents ? 1 : 0) +
            (it.price_text ? 1 : 0) +
            (it.description ? it.description.length / 100 : 0);
          if (nxtScore > curScore) keep[i] = it;
        }
      }
      return keep;
    };
  }

  if (typeof globalThis.callGrokExtract !== "function") {
    globalThis.callGrokExtract = async function callGrokExtract(
      env,
      query,
      address
    ) {
      const url = (env.GROK_API_URL || "").trim();
      const key = (env.GROK_API_KEY || env.Tummy_Buddy_Grok || "").trim();
      if (!url) return { ok: true, items: [], note: "grok_missing_url" };
      if (!_isValidUrl(url))
        return { ok: true, items: [], note: "grok_invalid_url" };
      if (!key) return { ok: true, items: [], note: "grok_missing_key" };
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`
          },
          body: JSON.stringify({
            task: "menu_extract",
            query,
            address,
            schema: "menu_items_v1"
          })
        });
        if (!res.ok)
          return { ok: false, items: [], error: `grok HTTP ${res.status}` };
        const js = await res.json().catch(() => ({}));
        const items = Array.isArray(js.items) ? js.items : [];
        return { ok: true, items };
      } catch (e) {
        return {
          ok: false,
          items: [],
          error: `grok fetch error: ${String(e?.message || e)}`
        };
      }
    };
  }

  if (typeof globalThis.callOpenAIExtract !== "function") {
    globalThis.callOpenAIExtract = async function callOpenAIExtract(
      env,
      query,
      address
    ) {
      const key = (env.OPENAI_API_KEY || "").trim();
      const base = (
        (env.OPENAI_API_BASE || "https://api.openai.com") + ""
      ).replace(/\/+$/, "");
      if (!key) return { ok: true, items: [], note: "openai_missing_key" };
      try {
        new URL(base);
      } catch {
        return { ok: true, items: [], note: "openai_invalid_base" };
      }

      const prompt = `You are extracting a restaurant's MENU ITEMS.
Restaurant: ${query}
Location: ${address}
Return JSON with an "items" array. Each item: {title, description, section, price_text?, calories_text?}.`;

      try {
        const res = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`
          },
          body: JSON.stringify({
            model: env.OPENAI_MODEL || "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            response_format: { type: "json_object" }
          })
        });
        if (!res.ok)
          return { ok: false, items: [], error: `openai HTTP ${res.status}` };
        const js = await res.json().catch(() => ({}));
        let payload = {};
        try {
          payload = JSON.parse(js?.choices?.[0]?.message?.content || "{}");
        } catch {}
        const items = Array.isArray(payload.items) ? payload.items : [];
        return { ok: true, items };
      } catch (e) {
        return {
          ok: false,
          items: [],
          error: `openai fetch error: ${String(e?.message || e)}`
        };
      }
    };
  }
})();

const normalizeLLMItems = globalThis.normalizeLLMItems;
const dedupeItemsByTitleSection = globalThis.dedupeItemsByTitleSection;
const callGrokExtract = globalThis.callGrokExtract;
const callOpenAIExtract = globalThis.callOpenAIExtract;

// [37B] ── Tiny validators + friendly 400 helper
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

// Accepts: "City, ST" or "City, ST 12345"  (e.g., "Miami, FL" / "Miami, FL 33131")
const looksLikeCityState = (s) => {
  if (typeof s !== "string") return false;
  return /^[A-Za-z .'-]+,\s*[A-Z]{2}(\s*\d{5})?$/.test(s.trim());
};

// Address helpers used by /menu/search
function hasLowercaseState(address) {
  // Detect ", fl" or ", ny" etc.
  const m = String(address || "").match(/,\s*([A-Za-z]{2})(\b|[^A-Za-z]|$)/);
  if (!m) return false;
  const st = m[1];
  return st !== st.toUpperCase();
}
function normalizeCityStateAddress(address) {
  // Convert ", fl" -> ", FL" (keep the rest intact)
  return String(address || "").replace(
    /,\s*([A-Za-z]{2})(\b|[^A-Za-z]|$)/,
    (_, st, tail) => `, ${st.toUpperCase()}${tail || ""}`
  );
}

function badRequest(
  message,
  hint,
  envOrCtx,
  request_id = null,
  examples = null
) {
  const body = { ok: false, error: message, hint };
  if (Array.isArray(examples) && examples.length) body.examples = examples;
  return errorResponseWith(body, 400, envOrCtx, {}, request_id);
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init
  });
}

// === New helpers (ported from newer index) ================================
function slimTopDrivers(drivers) {
  // Input shape (V6): { OrganName: ["+ Compound A", "- Compound B"], ... }
  // Output: compact array of up to 8 entries [{ organ, label }]
  const out = [];
  if (!drivers || typeof drivers !== "object") return out;
  for (const [organ, arr] of Object.entries(drivers)) {
    if (!Array.isArray(arr)) continue;
    for (const label of arr) {
      out.push({ organ, label: String(label) });
    }
  }
  return out.slice(0, 8);
}

function topDriversText(slim) {
  // Turn first two items into a short natural label: "Compound A; Compound B"
  if (!Array.isArray(slim) || slim.length === 0) return "";
  const names = slim.map((x) => {
    // strip "+ " / "- " prefix for readability
    const t = String(x?.label || "");
    return t.replace(/^([+\-]\s*)/, "");
  });
  const firstTwo = names.slice(0, 2).filter(Boolean);
  return firstTwo.join("; ");
}
// ========================================================================

// [37B] ── Flag/number validators
const is01 = (v) => v === "0" || v === "1";
const isPositiveInt = (s) => /^\d+$/.test(String(s));

// Simple request-id helper (used by /meta, /debug/status, etc.)
function newRequestId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isOcrEnabled(env) {
  return String(env.OCR_TIER_ENABLED || "").trim() === "1";
}

// Friendly upstream error explainer (maps vendor HTTP to user-facing text)
function friendlyUpstreamMessage(status) {
  switch (Number(status)) {
    case 429:
      return "Our menu provider is rate-limiting right now.";
    case 502:
    case 503:
    case 504:
      return "Our menu provider is temporarily unavailable.";
    default:
      return "Upstream error.";
  }
}

// Flatten Uber Eats to simple items (normalized + deduped)
function extractMenuItemsFromUber(raw, queryText = "") {
  const q = (queryText || "").toLowerCase().trim();

  const results =
    (raw?.data?.results &&
      Array.isArray(raw.data.results) &&
      raw.data.results) ||
    (Array.isArray(raw?.results) && raw.results) ||
    (Array.isArray(raw?.data?.data?.results) && raw.data.data.results) ||
    [];

  // Choose best-matching restaurant(s) if query given
  let chosen = results;
  if (q && results.length) {
    const scored = results.map((r) => {
      const title = (r.title || r.sanitizedTitle || r.name || "").toLowerCase();
      let score = 0;
      if (title === q) score = 3;
      else if (title.startsWith(q)) score = 2;
      else if (title.includes(q)) score = 1;
      return { r, score, title };
    });
    scored.sort((a, b) => b.score - a.score);
    const bestScore = scored[0]?.score || 0;
    chosen =
      bestScore > 0
        ? scored.filter((s) => s.score === bestScore).map((s) => s.r)
        : [scored[0].r];
  }

  // --- normalization helpers ---
  function normalizePriceFields(mi) {
    // vendor sometimes gives cents as number; sometimes only a display string
    const asNum = typeof mi.price === "number" ? mi.price : undefined;
    const price = Number.isFinite(asNum) ? asNum : undefined;
    const price_display =
      mi.priceTagline ||
      (Number.isFinite(price)
        ? `$${(price / 100).toFixed(2)}`
        : mi.price_display || "") ||
      "";
    return { price, price_display };
  }

  function deriveCaloriesDisplay(mi, price_display) {
    // Prefer explicit numeric calories if vendor exposes them
    // (some shapes may have mi.nutrition?.calories or mi.calories)
    const calNum =
      (mi?.nutrition &&
        Number.isFinite(mi.nutrition.calories) &&
        mi.nutrition.calories) ||
      (Number.isFinite(mi?.calories) && mi.calories) ||
      null;

    if (Number.isFinite(calNum)) return `${Math.round(calNum)} Cal`;

    // Fallback: parse from price_display (e.g., "$4.79 • 320 Cal.")
    const t = String(
      price_display || mi?.itemDescription || mi?.description || ""
    );
    const m = t.match(/\b(\d{2,4})\s*Cal\.?\b/i);
    return m ? `${m[1]} Cal` : null;
  }

  function normalizeItemFields(it) {
    const clean = (s) =>
      String(s ?? "")
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim();
    const out = { ...it };
    out.name = clean(it.name);
    out.section = clean(it.section);
    out.description = clean(it.description);
    out.price_display = clean(it.price_display);
    if (out.calories_display != null)
      out.calories_display = clean(out.calories_display);
    out.restaurant_name = clean(it.restaurant_name);

    // keep price only if it’s a non-negative finite number
    if (!(Number.isFinite(out.price) && out.price >= 0)) delete out.price;

    // enforce source field
    out.source = "uber_eats";
    return out;
  }

  function makeItem(mi, sectionName, restaurantName) {
    const { price, price_display } = normalizePriceFields(mi);
    const calories_display = deriveCaloriesDisplay(mi, price_display);
    return {
      name: mi.title || mi.name || "",
      description: mi.itemDescription || mi.description || "",
      price,
      price_display,
      section: sectionName || "",
      calories_display,
      restaurant_name: restaurantName || "",
      source: "uber_eats"
    };
  }

  // prefer items that have price/calories/longer description when de-duping
  function better(a, b) {
    const ap = hasPrice(a) ? 1 : 0;
    const bp = hasPrice(b) ? 1 : 0;
    if (ap !== bp) return ap > bp;
    const ac = hasCalories(a) ? 1 : 0;
    const bc = hasCalories(b) ? 1 : 0;
    if (ac !== bc) return ac > bc;
    const ad = (a.description || "").length;
    const bd = (b.description || "").length;
    if (ad !== bd) return ad > bd;
    // keep earlier (stable) otherwise
    return false;
  }

  const items = [];
  const seen = new Map(); // key = `${section}|${name}` lowercased

  function addItem(it) {
    const item = normalizeItemFields(it);
    const key = `${(item.section || "").toLowerCase()}|${(item.name || "").toLowerCase()}`;
    const prevIdx = seen.get(key);
    if (prevIdx == null) {
      seen.set(key, items.length);
      items.push(item);
    } else {
      const prev = items[prevIdx];
      if (better(item, prev)) items[prevIdx] = item;
    }
  }

  // --- collect items from all vendor shapes, then dedupe via addItem() ---
  for (const r of chosen) {
    const restaurantName = r.title || r.sanitizedTitle || r.name || "";

    // catalogs / menu sections
    let sections = [];
    if (Array.isArray(r.menu)) sections = r.menu;
    else if (Array.isArray(r.catalogs)) sections = r.catalogs;

    for (const section of sections) {
      const sectionName = section.catalogName || section.name || "";
      const catalogItems =
        (Array.isArray(section.catalogItems) && section.catalogItems) ||
        (Array.isArray(section.items) && section.items) ||
        [];
      for (const mi of catalogItems)
        addItem(makeItem(mi, sectionName, restaurantName));
    }

    // featured
    if (Array.isArray(r.featuredItems)) {
      for (const mi of r.featuredItems)
        addItem(makeItem(mi, "Featured", restaurantName));
    }
  }

  return items;
}

const SECTION_PRIORITY = [
  "most popular",
  "popular items",
  "featured",
  "bestsellers",
  "recommended"
];

function sectionScore(section = "") {
  const s = section.toLowerCase();
  for (let i = 0; i < SECTION_PRIORITY.length; i++) {
    if (s.includes(SECTION_PRIORITY[i])) return 100 - i * 2; // 100,98,96...
  }
  return 0;
}

function hasCalories(item) {
  // Many Uber items expose "Cal." inside price_display, e.g. "$4.79 • 320 Cal."
  const t = `${item.price_display || item.description || ""}`.toLowerCase();
  return /\bcal\b|\bcal\.\b/.test(t);
}

function hasPrice(item) {
  return (
    typeof item.price === "number" || /\$\d/.test(item.price_display || "")
  );
}

function baseNameScore(name = "") {
  // Prefer clearer names over generic—simple heuristic
  const n = name.toLowerCase();
  let sc = 0;
  if (/\bcombo\b|\bmeal\b/.test(n)) sc += 2; // combos often user-intent
  if (/\bfamily\b|\bparty\b/.test(n)) sc -= 2; // de-prioritize huge packs
  if (/\bside\b/.test(n)) sc -= 1;
  return sc;
}

function scoreItem(item) {
  let score = 0;
  score += sectionScore(item.section);
  if (hasCalories(item)) score += 4;
  if (hasPrice(item)) score += 3;
  score += baseNameScore(item.name || item.title || "");
  return score;
}

function rankTop(items, n) {
  return (
    [...items]
      .map((it, idx) => ({ it, idx, score: scoreItem(it) }))
      // stable: by score desc, then original index asc
      .sort((a, b) => b.score - a.score || a.idx - b.idx)
      .slice(0, Math.max(0, n))
      .map((x) => x.it)
  );
}

// ---- Step 41.7: normalize filters + ranking for analyze ----
function filterAndRankItems(items, searchParams, env) {
  let candidates = Array.isArray(items) ? items : [];

  const skipDrinks = searchParams.get("skip_drinks") === "1";
  const skipParty = searchParams.get("skip_party") === "1";

  if (skipDrinks) {
    candidates = candidates.filter(
      (it) => !isDrink(it.name || it.title || "", it.section)
    );
  }
  if (skipParty) {
    candidates = candidates.filter(
      (it) => !isPartyPack(it.name || it.title || "")
    );
  }

  const HITS_LIMIT = Number(searchParams.get("top") || env.HITS_LIMIT || "25");
  return rankTop(candidates, HITS_LIMIT);
}

function isDrink(name = "", section = "") {
  const n = name.toLowerCase();
  const s = (section || "").toLowerCase();
  return (
    /\b(drink|beverage|soda|coke|sprite|fanta|tea|coffee|juice|shake|mcflurry|water)\b/.test(
      n
    ) || /\b(drinks|beverages)\b/.test(s)
  );
}

function isPartyPack(name = "") {
  const n = name.toLowerCase();
  // Look for big counts or party/family cues
  return (
    /\b(20|30|40|50)\s*(pc|piece|pieces)\b/.test(n) ||
    /\b(family|party|bundle|pack)\b/.test(n)
  );
}

// Turns Uber items into our simple, clean shape
function normalizeUberItems(rawItems = []) {
  return rawItems.map((it) => ({
    title: it.name || "",
    description: it.description || "",
    section: it.section || "",
    price_cents: typeof it.price === "number" ? it.price : null,
    price_text: it.price_display || null,
    calories_text: it.calories_display || null,
    source: "uber",
    confidence: 1.0
  }));
}

// Canonical item shape for /menu/extract
// { title, description, section, price_cents, price_text, calories_text, source, confidence }
function toCanonFromUber(it) {
  return {
    title: it.name || "",
    description: it.description || "",
    section: it.section || "",
    price_cents: typeof it.price === "number" ? it.price : null,
    price_text: it.price_display || null,
    calories_text: it.calories_display || null,
    source: "uber",
    confidence: 1.0
  };
}
function toCanonFromLLM(it) {
  return {
    title: (it.title || it.name || "").trim(),
    description: (it.description || it.desc || "").trim() || null,
    section: (it.section || it.category || "").trim() || "",
    price_cents: Number.isFinite(Number(it.price_cents))
      ? Number(it.price_cents)
      : null,
    price_text: it.price_text ? String(it.price_text) : null,
    calories_text: it.calories_text ? String(it.calories_text) : null,
    source: it.source || "llm",
    confidence: typeof it.confidence === "number" ? it.confidence : 0.7
  };
}

function toCanonFromOCR(it) {
  return {
    title: (it.title || it.name || "").trim(),
    description: null,
    section: (it.section || "").trim(),
    price_cents: null,
    price_text: it.price_text ? String(it.price_text) : null,
    calories_text: null,
    source: "ocr",
    confidence: 0.6
  };
}

function parseOCRToCandidates(fullText) {
  const text = String(fullText || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  const KNOWN_SECTIONS = new Set([
    "APPETIZERS",
    "STARTERS",
    "SIDES",
    "SALADS",
    "SOUPS",
    "ENTREES",
    "MAINS",
    "DESSERTS",
    "DRINKS",
    "BEVERAGES",
    "PASTA",
    "PIZZA",
    "SANDWICHES",
    "BURGERS",
    "SPECIALS",
    "BREAKFAST",
    "LUNCH",
    "DINNER"
  ]);

  let currentSection = null;
  const items = [];
  const lines = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  function pushItem(title, price, section) {
    const t = String(title || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) return;
    let name = t;
    const firstWord = t.split(" ")[0];
    if (KNOWN_SECTIONS.has(firstWord)) name = t.slice(firstWord.length).trim();
    if (!name) return;
    items.push({
      title: name,
      price_text: `$${price}`,
      section: section || null
    });
  }

  if (lines.length > 1) {
    for (const line of lines) {
      const cap = line.toUpperCase();
      if (!/\$/.test(line) && KNOWN_SECTIONS.has(cap)) {
        currentSection = cap;
        continue;
      }
      const m = line.match(/(.+?)\s*\$?\s*([0-9]+(?:\.[0-9]{2})?)\b/);
      if (m) pushItem(m[1], m[2], currentSection);
    }
  }

  if (items.length === 0) {
    const re = /([A-Z0-9][A-Z0-9 &'’\-]+?)\s*\$?\s*([0-9]+(?:\.[0-9]{2})?)\b/g;
    let m;
    while ((m = re.exec(text))) pushItem(m[1], m[2], currentSection);
  }

  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = `${(it.section || "").toLowerCase()}|${it.title.toLowerCase()}|${it.price_text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

// Tiny bridge: image URL -> Vision full text -> parsed OCR menu items
async function fetchOCRCandidates(env, imageUrl) {
  const { fullText } = await callVisionForText(env, imageUrl);
  const parsed = parseOCRToCandidates(fullText);
  return Array.isArray(parsed) ? parsed : [];
}

// ---- WEB SCRAPER TINY HELPERS (HTML -> best menu image URL) ----

// Download an HTML page as text (best-effort)
async function fetchHtml(env, pageUrl) {
  const res = await fetch(pageUrl, {
    headers: {
      "User-Agent": "TummyBuddyWorker/1.0 (+https://tummybuddy.app)",
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!res.ok) throw new Error(`html fetch failed: ${res.status}`);
  return await res.text();
}

// Parse srcset and pick the largest candidate
function pickLargestFromSrcset(srcset, baseUrl) {
  try {
    const parts = String(srcset || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let best = null;
    for (const p of parts) {
      // formats like: "image.jpg 800w" or "image.jpg 2x"
      const m = p.match(/(.+?)\s+(\d+)(w|x)\b/i);
      const urlPart = m ? m[1].trim() : p;
      const size = m ? parseInt(m[2], 10) : 0;
      const abs = new URL(urlPart, baseUrl).toString();
      if (!best || size > best.size) best = { url: abs, size };
    }
    return best ? best.url : null;
  } catch {
    return null;
  }
}

// Pick the most likely menu image from <img> tags
function pickMenuImageFromHtml(html, baseUrl) {
  if (typeof html !== "string" || !html) return null;

  // 0) Try OpenGraph first (very reliable on many sites)
  const og =
    /<meta\s+(?:property|name)\s*=\s*["']og:image["'][^>]*?\scontent\s*=\s*["']([^"']+)["'][^>]*?>/i.exec(
      html
    ) ||
    /<meta\s+content\s*=\s*["']([^"']+)["'][^>]*?(?:property|name)\s*=\s*["']og:image["'][^>]*?>/i.exec(
      html
    );
  if (og && og[1]) {
    try {
      return new URL(og[1].trim(), baseUrl).toString();
    } catch {
      /* fall through */
    }
  }

  // 1) Collect <img> candidates from src and (if present) srcset
  const candidates = [];
  const imgRe = /<img\b([^>]+)>/gi;
  let m;
  while ((m = imgRe.exec(html))) {
    const tag = m[1] || "";
    const srcM = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
    const setM = /\bsrcset\s*=\s*["']([^"']+)["']/i.exec(tag);

    let abs = null;

    if (setM && setM[1]) {
      const picked = pickLargestFromSrcset(setM[1], baseUrl);
      if (picked) abs = picked;
    }
    if (!abs && srcM && srcM[1]) {
      try {
        abs = new URL(srcM[1].trim(), baseUrl).toString();
      } catch {}
    }

    if (abs) candidates.push(abs);
  }

  if (!candidates.length) return null;

  // 2) Score images by menu-like hints and deprioritize obvious non-menus
  function score(url) {
    const u = url.toLowerCase();
    let s = 0;
    if (/\bmenu\b/.test(u)) s += 6;
    if (
      /\b(food|foods|dishes|lunch|dinner|brunch|dessert|beverage|drinks|wine|beer)\b/.test(
        u
      )
    )
      s += 3;
    if (/\.(jpg|jpeg|png|webp)(\?|$)/.test(u)) s += 2;

    // down-rank sprites, logos, favicons, tiny thumbs, social, tracking
    if (
      /sprite|icon|logo|favicon|thumb|tracking|pixel|social|twitter|facebook|instagram/.test(
        u
      )
    )
      s -= 5;

    // mild up-rank if looks like a full-size image
    if (/(\bfull\b|\blarge\b|\bxl\b|@2x|@3x)/.test(u)) s += 1;

    return s;
  }

  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0] || null;
}

// Turn common gallery/page URLs into a direct image URL when possible
function normalizeGalleryToDirectImage(pageUrl) {
  try {
    const u = new URL(pageUrl);
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean); // e.g., ["gallery","abc123"] or ["abc123"]

    // Imgur patterns:
    // https://imgur.com/abc123       -> https://i.imgur.com/abc123.jpg
    // https://imgur.com/gallery/abc  -> https://i.imgur.com/abc.jpg
    if (host === "imgur.com" && parts.length >= 1) {
      const id = parts[parts.length - 1];
      if (/^[A-Za-z0-9]+$/.test(id)) {
        return `https://i.imgur.com/${id}.jpg`;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Decide which of two items with the same (section|title) to keep
function preferBetter(a, b) {
  const score = (x) =>
    (x.price_cents ? 3 : 0) +
    (x.price_text ? 2 : 0) +
    (x.calories_text ? 1 : 0) +
    Math.min(3, (x.description || "").length / 60) +
    (x.source === "uber" ? 1 : 0) +
    (typeof x.confidence === "number" ? x.confidence : 0);
  return score(b) > score(a) ? b : a;
}

// Merge + de-dup by (section|title), keeping the richer one
function mergeCanonItems(uberItems = [], llmItems = [], ocrItems = []) {
  const all = [];

  for (const u of uberItems || []) all.push(toCanonFromUber(u));
  for (const l of llmItems || []) all.push(toCanonFromLLM(l));
  for (const o of ocrItems || []) all.push(toCanonFromOCR(o));

  const byKey = new Map();
  for (const it of all) {
    const key = `${(it.section || "").toLowerCase()}|${(it.title || "").toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, it);
    else byKey.set(key, preferBetter(byKey.get(key), it));
  }
  return Array.from(byKey.values());
}

function rankCanon(items = [], topN = 25) {
  const scored = items.map((it, idx) => {
    let score = 0;
    const s = (it.section || "").toLowerCase();
    if (
      /\bmost popular\b|\bpopular items\b|\bfeatured\b|\bbestsellers\b|\brecommended\b/.test(
        s
      )
    )
      score += 100;
    if (it.price_cents) score += 6;
    if (it.price_text) score += 3;
    if (it.calories_text) score += 2;
    if ((it.description || "").length > 30) score += 2;
    if (it.source === "uber") score += 2;
    if (typeof it.confidence === "number") score += Math.min(4, it.confidence);
    return { it, idx, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, Math.max(0, topN))
    .map((x) => x.it);
}

// ---- Recipe cache helpers (KV) ----
function recipeCacheKey(dish, lang = "en") {
  const base = String(dish || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `recipe/${lang}/${base || "unknown"}.json`;
}

async function recipeCacheRead(env, key) {
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function recipeCacheWrite(env, key, payload) {
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
  if (!kv) return false;
  try {
    await kv.put(
      key,
      JSON.stringify({ savedAt: new Date().toISOString(), ...payload }),
      {
        expirationTtl: 365 * 24 * 3600
      }
    );
    return true;
  } catch {
    return false;
  }
}

function defaultPrefs() {
  return { allergens: [], fodmap: {}, units: "us" };
}

function normalizePrefs(input) {
  const out = defaultPrefs();
  const src = input?.prefs ? input.prefs : input || {};
  if (Array.isArray(src.allergens)) out.allergens = src.allergens.map(String);
  if (src.fodmap && typeof src.fodmap === "object")
    out.fodmap = { ...src.fodmap };
  if (Array.isArray(src.pills)) {
    const al = new Set(out.allergens);
    const fm = { ...(out.fodmap || {}) };
    for (const p of src.pills) {
      const s = String(p);
      if (s.startsWith("allergen:")) al.add(s.slice(9));
      if (s.startsWith("fodmap:")) fm[s.slice(7)] = true;
    }
    out.allergens = Array.from(al);
    out.fodmap = fm;
  }
  if (typeof src.units === "string") out.units = src.units;
  return out;
}

async function loadUserPrefs(env, user_id) {
  const id = (user_id || "").trim();
  if (!id || !env?.USER_PREFS_KV) return defaultPrefs();
  try {
    const raw = await env.USER_PREFS_KV.get(`user_prefs:${id}`, "json");
    return normalizePrefs(raw || {});
  } catch {
    return defaultPrefs();
  }
}

function derivePillsForUser(hits = [], prefs = { allergens: [], fodmap: {} }) {
  const safeHits = Array.isArray(hits) ? hits : [];
  const safePrefs =
    prefs && typeof prefs === "object" ? prefs : { allergens: [], fodmap: {} };

  const baseAllergens = new Set();
  const baseClasses = new Set();

  for (const hit of safeHits) {
    if (Array.isArray(hit?.allergens)) {
      for (const allergen of hit.allergens) {
        if (allergen != null && allergen !== "")
          baseAllergens.add(String(allergen));
      }
    }
    if (Array.isArray(hit?.classes)) {
      for (const cls of hit.classes) {
        if (cls != null && cls !== "")
          baseClasses.add(String(cls).toLowerCase());
      }
    }
  }

  const pills = [];
  const allergenPrefs = new Set(
    Array.isArray(safePrefs.allergens)
      ? safePrefs.allergens.map((a) => String(a))
      : []
  );

  for (const allergen of baseAllergens) {
    pills.push({
      key: `allergen:${allergen}`,
      label: allergen,
      active: allergenPrefs.has(allergen)
    });
  }

  const fodmapPrefs =
    safePrefs.fodmap && typeof safePrefs.fodmap === "object"
      ? safePrefs.fodmap
      : {};
  if (baseClasses.has("onion"))
    pills.push({
      key: "fodmap:onion",
      label: "Onion",
      active: !!fodmapPrefs.onion
    });
  if (baseClasses.has("garlic"))
    pills.push({
      key: "fodmap:garlic",
      label: "Garlic",
      active: !!fodmapPrefs.garlic
    });

  return pills;
}

function inferHitsFromRecipeCard(card = {}) {
  const text = JSON.stringify(card).toLowerCase();
  const hits = [];

  const push = (o) =>
    hits.push({
      allergens: o.allergens || [],
      classes: o.classes || [],
      source: "infer"
    });

  if (/\bgarlic\b/.test(text)) push({ classes: ["garlic"] });
  if (/\bonion\b|shallot|scallion/.test(text)) push({ classes: ["onion"] });

  if (
    /(milk|cream|butter|cheese|parmesan|mozzarella|yogurt|whey|casein)\b/.test(
      text
    )
  )
    push({ allergens: ["dairy"] });

  if (/\bshrimp|prawn|lobster|crab|shellfish\b/.test(text))
    push({ allergens: ["shellfish"] });

  return hits;
}

function inferHitsFromText(title = "", desc = "") {
  const text = `${title} ${desc}`.toLowerCase();
  const hits = [];
  const push = (o) =>
    hits.push({
      allergens: o.allergens || [],
      classes: o.classes || [],
      source: "infer:title"
    });

  if (/\bgarlic\b/.test(text)) push({ classes: ["garlic"] });
  if (/\bonion\b|shallot|scallion/.test(text)) push({ classes: ["onion"] });
  if (
    /(milk|cream|butter|cheese|parmesan|mozzarella|yogurt|whey|casein)\b/.test(
      text
    )
  )
    push({ allergens: ["dairy"] });
  if (/\bshrimp|prawn|lobster|crab|shellfish\b/.test(text))
    push({ allergens: ["shellfish"] });

  return hits;
}

function inferHitsFromIngredients(ingredients = []) {
  const hits = [];
  const push = (o) =>
    hits.push({
      allergens: o.allergens || [],
      classes: o.classes || [],
      source: "infer:ingredients"
    });

  for (const ing of ingredients) {
    const name = String(ing?.name || "").toLowerCase();

    if (
      /(milk|cream|butter|cheese|parmesan|mozzarella|yogurt|whey|casein)\b/.test(
        name
      )
    )
      push({ allergens: ["dairy"] });
    if (/\bgarlic\b/.test(name)) push({ classes: ["garlic"] });
    if (/\bonion\b|shallot|scallion/.test(name)) push({ classes: ["onion"] });
    if (/\bshrimp|prawn|lobster|crab|shellfish\b/.test(name))
      push({ allergens: ["shellfish"] });
    if (/\bflour|wheat\b/.test(name)) push({ allergens: ["gluten"] });
  }
  return hits;
}

async function fetchRecipeCard(env, dishTitle) {
  try {
    const base =
      env.WORKER_BASE_URL ||
      "https://tb-dish-processor-production.tummybuddy.workers.dev";
    const u = new URL("/recipe/resolve", base);
    u.searchParams.set("dish", dishTitle);
    u.searchParams.set("shape", "recipe_card");
    u.searchParams.set("force_reanalyze", "1");
    const r = await fetch(u, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
}

// ============== EDAMAM: RECIPE SEARCH V2 + NUTRITION ANALYSIS ==============
async function callEdamamRecipe(dish, env, opts = {}) {
  const id = env.EDAMAM_APP_ID;
  const key = env.EDAMAM_APP_KEY;
  if (!id || !key)
    return { ingredients: [], reason: "EDAMAM_APP_ID/KEY missing" };

  const url = new URL("https://api.edamam.com/api/recipes/v2");
  url.searchParams.set("type", "public");
  url.searchParams.set("q", dish);
  url.searchParams.set("app_id", id);
  url.searchParams.set("app_key", key);

  let data;
  const accountUser =
    typeof opts?.user_id === "string" && opts.user_id.trim()
      ? opts.user_id.trim()
      : "anon";

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
        "Edamam-Account-User": accountUser
      }
    });
    data = await parseResSafe(res);
    if (res.status === 401) {
      return {
        ingredients: [],
        reason: "edamam 401 unauthorized - check Recipe v2 app_id/app_key",
        debug: data
      };
    }
    if (!res.ok) {
      return {
        ingredients: [],
        reason: `edamam http ${res.status}`,
        debug: data
      };
    }
  } catch (e) {
    return {
      ingredients: [],
      reason: `edamam fetch err ${String(e?.message || e)}`
    };
  }

  const hit = data?.hits?.[0]?.recipe;
  const lines = Array.isArray(hit?.ingredientLines) ? hit.ingredientLines : [];
  const ingredients = lines.map((s) => String(s).trim()).filter(Boolean);

  return {
    ingredients,
    reason: ingredients.length ? "ok" : "no ingredients",
    raw: { label: hit?.label || null }
  };
}

async function callEdamamNutritionAnalyze(payload, env) {
  const nid = env.EDAMAM_NUTRITION_APP_ID || env.EDAMAM_APP_ID;
  const nkey = env.EDAMAM_NUTRITION_APP_KEY || env.EDAMAM_APP_KEY;
  if (!nid || !nkey)
    return { ingredients: [], reason: "nutrition keys missing" };

  const body = {
    title: payload?.title || "Recipe",
    ingr: Array.isArray(payload?.ingr) ? payload.ingr : []
  };

  const url = `https://api.edamam.com/api/nutrition-details?app_id=${encodeURIComponent(
    nid
  )}&app_key=${encodeURIComponent(nkey)}`;

  let data = null;
  let status = 0;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    status = res.status;
    data = await parseResSafe(res);
  } catch (e) {
    data = { error: String(e?.message || e) };
  }

  const norm = [];
  const src = Array.isArray(data?.ingredients) ? data.ingredients : [];
  for (const ing of src) {
    const name = String(ing?.parsed?.[0]?.food || ing?.text || "").trim();
    const grams = Number(ing?.parsed?.[0]?.weight || ing?.weight || 0);
    if (!name) continue;
    norm.push({
      name: name.toLowerCase(),
      grams: grams > 0 ? grams : undefined
    });
  }

  let calories =
    typeof data?.calories === "number" ? Math.round(data.calories) : null;

  const needFallback =
    calories === null ||
    !Array.isArray(body.ingr) ||
    body.ingr.length === 0 ||
    !Array.isArray(data?.ingredients) ||
    data.ingredients.length === 0 ||
    (status && status !== 200);

  if (needFallback && Array.isArray(body.ingr) && body.ingr.length) {
    let sum = 0;
    for (const line of body.ingr) {
      try {
        const u = `https://api.edamam.com/api/nutrition-data?app_id=${encodeURIComponent(
          nid
        )}&app_key=${encodeURIComponent(nkey)}&ingr=${encodeURIComponent(line)}`;
        const r = await fetch(u);
        const d = await r.json();
        if (typeof d?.calories === "number") sum += d.calories;
      } catch {}
    }
    if (sum > 0) {
      calories = Math.round(sum);
    }
  }

  return {
    ingredients: norm,
    nutrition: {
      calories,
      totalNutrients: data?.totalNutrients ?? null,
      totalWeight: data?.totalWeight ?? null
    },
    calories,
    reason:
      calories !== null ? "ok" : `no calories (status ${status || "n/a"})`,
    debug: calories === null ? data : undefined
  };
}

function normalizeIngredientLine(s) {
  let x = String(s || "")
    .toLowerCase()
    .trim();
  x = x.replace(/^[•\-\–\—\*]+\s*/g, "");
  x = x.replace(/\([^)]*\)/g, " ");
  x = x.replace(
    /\b(\d+[\/\.\-]?\d*)\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounce?s?|lb|pounds?|g|grams?|kg|ml|l|liters?)\b/gi,
    " "
  );
  x = x.replace(
    /\b(to taste|optional|finely|roughly|minced|chopped|fresh|juice of|zest of|divided)\b/gi,
    " "
  );
  x = x
    .replace(/\s*,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  x = x
    .replace(/\bparm(e|a)san\b/g, "parmesan")
    .replace(/\bboneless\b/g, "")
    .replace(/\bskinless\b/g, "");
  x = x
    .replace(/\b(cloves?|bunch|bunches|handful|pinch|pinches)\b/g, "")
    .trim();
  return x;
}
function guessGrams(name) {
  const n = String(name || "").toLowerCase();
  if (/(chicken|beef|pork|salmon|tuna|shrimp)\b/.test(n)) return 120;
  if (/(pasta|fettuccine|spaghetti|noodle|rice)\b/.test(n)) return 180;
  if (/(heavy cream|cream|milk)\b/.test(n)) return 60;
  if (/(parmesan|cheese)\b/.test(n)) return 28;
  if (/\bbutter\b/.test(n)) return 14;
  if (/(olive oil|oil)\b/.test(n)) return 10;
  if (/\bgarlic\b/.test(n)) return 6;
  if (/(onion|shallot)\b/.test(n)) return 50;
  if (
    /(salt|black pepper|pepper|paprika|cumin|oregano|parsley|basil|chili)\b/.test(
      n
    )
  )
    return 2;
  if (/(tomato|mushroom|spinach|broccoli|bell pepper)\b/.test(n)) return 60;
  return 12;
}
function normalizeIngredientsArray(raw) {
  const out = [];
  const seen = new Set();
  for (const it of raw || []) {
    const text =
      typeof it === "string" ? it : it?.original || it?.name || it?.text || "";
    const name = normalizeIngredientLine(text);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, grams: guessGrams(name) });
  }
  return out;
}
function safeJson(s, fallback) {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}
function barometerFromOrgans(levelsObj) {
  const vals = Object.values(levelsObj || {});
  if (!vals.length) return 0;
  const map = {
    "High Benefit": 40,
    Benefit: 20,
    Neutral: 0,
    Caution: -20,
    "High Caution": -40
  };
  const nums = vals.map((v) => map[v] ?? 0);
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.max(-100, Math.min(100, Math.round(avg)));
}

async function getOrgans(env) {
  const fallback = ["gut", "liver", "heart"];
  if (!env?.D1_DB) return fallback;
  try {
    const { results } = await env.D1_DB.prepare(
      "SELECT organ FROM organ_systems"
    ).all();
    const arr = (results || []).map((r) => r?.organ).filter(Boolean);
    return arr.length ? arr : fallback;
  } catch {
    return fallback;
  }
}

function computeBarometerFromLevelsAll(ORGANS, lv) {
  const levelToBar = (s) =>
    ({
      "High Benefit": 80,
      Benefit: 40,
      Neutral: 0,
      Caution: -40,
      "High Caution": -80
    })[s] ?? 0;
  if (!Array.isArray(ORGANS) || !ORGANS.length) return 0;
  const nums = ORGANS.map((o) => levelToBar(lv?.[o]));
  const sum = nums.reduce((acc, val) => acc + val, 0);
  return Math.round(sum / Math.max(nums.length, 1));
}

async function fetchRecipeCardWithFallback(dish, env, opts = {}) {
  const attempts = [];

  async function tryEdamam() {
    if (typeof callEdamamRecipe !== "function") return null;
    const r = await callEdamamRecipe(dish, env, opts);
    const count = Array.isArray(r?.ingredients) ? r.ingredients.length : 0;
    attempts.push({
      provider: "edamam",
      ok: count > 0,
      reason: r?.reason,
      count
    });
    if (count > 0) {
      return {
        provider: "edamam",
        reason: r?.reason,
        ingredients: r.ingredients,
        attempts,
        label: r?.raw?.label || null
      };
    }
    return null;
  }

  async function trySpoonacular() {
    if (typeof callSpoonacularRecipe !== "function") return null;
    const r = await callSpoonacularRecipe(dish, env, opts);
    const count = Array.isArray(r?.ingredients) ? r.ingredients.length : 0;
    attempts.push({
      provider: "spoonacular",
      ok: count > 0,
      reason: r?.reason,
      count
    });
    if (count > 0) {
      return {
        provider: "spoonacular",
        reason: r?.reason,
        ingredients: r.ingredients,
        attempts
      };
    }
    return null;
  }

  async function tryOpenAI() {
    if (typeof callOpenAIRecipe !== "function") return null;
    const r = await callOpenAIRecipe(dish, env, opts);
    const count = Array.isArray(r?.ingredients) ? r.ingredients.length : 0;
    attempts.push({
      provider: "openai",
      ok: count > 0,
      reason: r?.reason,
      count
    });
    if (count > 0) {
      return {
        provider: "openai",
        reason: r?.reason,
        ingredients: r.ingredients,
        attempts
      };
    }
    return null;
  }

  let hit = await tryEdamam();
  if (hit) return hit;
  hit = await trySpoonacular();
  if (hit) return hit;
  hit = await tryOpenAI();
  if (hit) return hit;

  return {
    provider: null,
    reason: "all providers yielded no ingredients",
    ingredients: [],
    attempts
  };
}

function personalizeDishForUser(dish, prefs) {
  if (!dish || typeof dish !== "object") return dish;
  const safePrefs =
    prefs && typeof prefs === "object" ? prefs : { allergens: [], fodmap: {} };

  const hits = Array.isArray(dish.hits) ? dish.hits : [];
  const hasHits = hits.length > 0;

  const pills_user = hasHits ? derivePillsForUser(hits, safePrefs) : [];

  let baseScore = dish?.score?.base ?? null;
  let personalScore = dish?.score?.personal ?? null;

  if (baseScore == null && typeof scoreDishFromHits === "function" && hasHits) {
    const base = scoreDishFromHits(hits);
    baseScore = base?.tummy_barometer?.score ?? null;
  }

  if (personalScore == null && baseScore != null && hasHits) {
    const tracked = new Set(
      Array.isArray(safePrefs.allergens) ? safePrefs.allergens.map(String) : []
    );
    const anyTracked = hits.some(
      (h) =>
        Array.isArray(h.allergens) &&
        h.allergens.some((a) => tracked.has(String(a)))
    );
    const onionFlag =
      !!safePrefs?.fodmap?.onion &&
      hits.some((h) => (h.classes || []).map(String).includes("onion"));
    const garlicFlag =
      !!safePrefs?.fodmap?.garlic &&
      hits.some((h) => (h.classes || []).map(String).includes("garlic"));

    let penalty = 0;
    if (anyTracked) penalty += 5;
    if (onionFlag) penalty += 2;
    if (garlicFlag) penalty += 2;
    personalScore = Math.max(1, Math.min(100, baseScore - penalty));
  }

  const personal_reasons = (() => {
    const out = [];
    const tracked = new Set(
      Array.isArray(safePrefs.allergens) ? safePrefs.allergens.map(String) : []
    );
    if (tracked.size)
      out.push(`You're tracking: ${Array.from(tracked).join(", ")}`);
    if (safePrefs?.fodmap?.onion) out.push("You track onion.");
    if (safePrefs?.fodmap?.garlic) out.push("You track garlic.");
    if (!out.length) out.push("No tracked triggers selected.");
    return out;
  })();

  dish.score = { base: baseScore, personal: personalScore };
  dish.pills_user = pills_user;
  dish.personal_reasons = personal_reasons;
  return dish;
}

// ==== Step 47.1 — Forever-cache skip helpers (R2 preflight) ====

function normalizeTitle(s = "") {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function resultIdForDish(place_id, title) {
  const base = `${(place_id || "").trim()}::${normalizeTitle(title || "")}`;
  // Deterministic tiny hash (no crypto import needed in CF)
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash << 5) - hash + base.charCodeAt(i);
    hash |= 0;
  }
  return `dish_${Math.abs(hash)}`;
}

async function r2Head(env, key) {
  if (!env?.R2_BUCKET) return false;
  try {
    const obj = await env.R2_BUCKET.head(key);
    return !!obj;
  } catch {
    return false;
  }
}

function normKey(s = "") {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function getCachedNutrition(env, name) {
  if (!env?.R2_BUCKET) return null;
  const key = `nutrition/${normKey(name)}.json`;
  const head = await r2Head(env, key);
  if (!head) return null;
  const obj = await env.R2_BUCKET.get(key);
  if (!obj) return null;
  try {
    return await obj.json();
  } catch {
    return null;
  }
}

async function putCachedNutrition(env, name, data) {
  if (!env?.R2_BUCKET) return null;
  const key = `nutrition/${normKey(name)}.json`;
  const payload = { ...data, _cachedAt: new Date().toISOString() };
  await r2WriteJSON(env, key, payload);
  return payload;
}

async function enrichWithNutrition(env, rows = []) {
  for (const row of rows) {
    const q = (row?.name || row?.original || "").trim();
    if (!q) continue;
    let hit = await getCachedNutrition(env, q);
    if (!hit) {
      hit = await callUSDAFDC(env, q);
      if (!hit) hit = await callOFF(env, q);
      if (hit) {
        try {
          await putCachedNutrition(env, q, hit);
        } catch {}
      }
    }
    if (hit?.nutrients) {
      row.nutrition = hit.nutrients;
      row._fdc = {
        id: hit.fdcId,
        description: hit.description || null,
        dataType: hit.dataType || null,
        source: hit.source || "USDA_FDC"
      };
    }
  }
  return rows;
}

async function maybeReturnCachedResult(req, env, { place_id, title }) {
  if (!env?.R2_BUCKET) return null;
  const url = new URL(req.url);
  const force = url.searchParams.get("force_reanalyze") === "1";
  if (!place_id || !title || force) return null;

  const id = resultIdForDish(place_id, title);
  const key = `results/${id}.json`;
  const exists = await r2Head(env, key);
  if (!exists) return null;

  const obj = await env.R2_BUCKET.get(key);
  if (!obj) return null;

  const body = await obj.text();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-tb-source": "cache:r2",
      "x-tb-result-id": id,
      "x-tb-skip": "1"
    }
  });
}

async function callVisionForText(env, imageUrl) {
  if (!env.GCP_VISION_API_KEY) throw new Error("Missing GCP_VISION_API_KEY");
  const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${env.GCP_VISION_API_KEY}`;

  const imgRes = await fetch(imageUrl, {
    headers: {
      "User-Agent": "TummyBuddyWorker/1.0 (+https://tummybuddy.app)",
      Accept: "image/*,*/*;q=0.8"
    }
  });
  if (!imgRes.ok) throw new Error(`fetch image failed: ${imgRes.status}`);
  const buf = await imgRes.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));

  const body = {
    requests: [
      {
        image: { content: b64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        imageContext: { languageHints: ["en", "es"] }
      }
    ]
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Vision HTTP ${res.status}: ${msg.slice(0, 500)}`);
  }

  const data = await res.json();
  const resp =
    data && data.responses && data.responses[0] ? data.responses[0] : {};

  const fullText =
    (resp.fullTextAnnotation && resp.fullTextAnnotation.text) ||
    (Array.isArray(resp.textAnnotations) &&
      resp.textAnnotations[0] &&
      resp.textAnnotations[0].description) ||
    "";

  const lines = fullText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  return { fullText, lines, raw: resp };
}

async function handleDebugVision(request, env) {
  const url = new URL(request.url);
  const img = (url.searchParams.get("url") || "").trim();
  if (!img) return json({ ok: false, error: "Missing ?url=" }, { status: 400 });
  if (!env.GCP_VISION_API_KEY)
    return json(
      { ok: false, error: "Missing GCP_VISION_API_KEY" },
      { status: 500 }
    );

  const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${env.GCP_VISION_API_KEY}`;
  const body = {
    requests: [
      {
        image: { source: { imageUri: img } },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        imageContext: { languageHints: ["en", "es"] }
      }
    ]
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const rawText = await r.text();
  return json(
    {
      ok: r.ok,
      status: r.status,
      raw_text_first_800: rawText.slice(0, 800)
    },
    { status: r.ok ? 200 : 502 }
  );
}

function classifyStampKey(dish, place_id = "", lang = "en") {
  const base = String(dish || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const pid = String(place_id || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `classify/${lang}/${pid || "unknown"}/${base || "unknown"}.json`;
}

async function getClassifyStamp(env, key) {
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function setClassifyStamp(env, key, payload, ttlSeconds = 6 * 3600) {
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
  if (!kv) return false;
  try {
    await kv.put(
      key,
      JSON.stringify({ savedAt: new Date().toISOString(), ...payload }),
      {
        expirationTtl: ttlSeconds
      }
    );
    return true;
  } catch {
    return false;
  }
}

// ---- Edamam Tier 1 (safe) ----
// expects env.EDAMAM_APP_ID and env.EDAMAM_APP_KEY
async function callEdamam(env, dish, cuisine = "", lang = "en") {
  const appId = (env.EDAMAM_APP_ID || "").trim();
  const appKey = (env.EDAMAM_APP_KEY || "").trim();
  if (!appId || !appKey) {
    return {
      ok: true,
      items: [],
      note: "edamam_missing_keys",
      provider: "edamam"
    };
  }

  const base = "https://api.edamam.com/api/recipes/v2";
  const u = new URL(base);
  u.searchParams.set("type", "public");
  u.searchParams.set("q", dish);
  u.searchParams.set("app_id", appId);
  u.searchParams.set("app_key", appKey);
  if (cuisine) u.searchParams.set("cuisineType", cuisine);

  const accountUser = "anon";

  try {
    const r = await fetch(u.toString(), {
      headers: {
        accept: "application/json",
        "Edamam-Account-User": accountUser
      }
    });
    if (!r.ok) {
      return {
        ok: false,
        items: [],
        error: `edamam HTTP ${r.status}`,
        provider: "edamam"
      };
    }
    const js = await r.json().catch(() => ({}));
    const hits = Array.isArray(js.hits) ? js.hits : [];
    const items = hits.map((h) => h.recipe).filter(Boolean);
    return { ok: true, items, provider: "edamam" };
  } catch (e) {
    return {
      ok: false,
      items: [],
      error: `edamam fetch error: ${String(e?.message || e)}`,
      provider: "edamam"
    };
  }
}

function normalizeEdamamRecipe(rec) {
  const name = String(rec?.label || "").trim();
  const lines = Array.isArray(rec?.ingredientLines) ? rec.ingredientLines : [];
  const ingredients = (Array.isArray(rec?.ingredients) ? rec.ingredients : [])
    .map((it) => ({
      name: String(it?.food || it?.text || "").trim(),
      qty: typeof it?.quantity === "number" ? it.quantity : null,
      unit: String(it?.measure || "").trim() || null
    }))
    .filter((x) => x.name);

  const steps = lines.length ? [`Combine: ${lines.join("; ")}`] : [];

  return {
    recipe: { name: name || null, steps, notes: lines.length ? lines : null },
    ingredients
  };
}

function ingredientEntryToLine(entry) {
  if (typeof entry === "string") return entry.trim();
  if (!entry || typeof entry !== "object") return "";
  const qty =
    entry.qty ?? entry.quantity ?? entry.amount ?? entry.count ?? undefined;
  const unit = entry.unit || entry.measure || entry.metricUnit || "";
  const name =
    entry.name ||
    entry.product ||
    entry.ingredient ||
    entry.original ||
    entry.food ||
    entry.text ||
    "";
  const comment =
    entry.comment ||
    entry.preparation ||
    entry.preparationNotes ||
    entry.note ||
    entry.extra ||
    "";
  const parts = [];
  if (qty !== undefined && qty !== null && qty !== "") {
    parts.push(String(qty).trim());
  }
  if (unit) parts.push(String(unit).trim());
  if (name) parts.push(String(name).trim());
  let line = parts.join(" ").trim();
  const commentTxt = String(comment || "").trim();
  if (commentTxt) line = line ? `${line}, ${commentTxt}` : commentTxt;
  return line.trim();
}

function normalizeProviderRecipe(
  payload = {},
  fallbackDish = "",
  provider = "unknown"
) {
  const base = payload && typeof payload === "object" ? { ...payload } : {};
  const structuredCandidates = Array.isArray(base.ingredients_structured)
    ? base.ingredients_structured
    : Array.isArray(base.ingredients) &&
        base.ingredients.every((row) => row && typeof row === "object")
      ? base.ingredients
      : null;
  const rawIngredients = Array.isArray(base.ingredients)
    ? base.ingredients
    : Array.isArray(base.ingredients_lines)
      ? base.ingredients_lines
      : Array.isArray(structuredCandidates)
        ? structuredCandidates
        : [];
  const ingredients = rawIngredients
    .map((entry) => ingredientEntryToLine(entry))
    .filter(Boolean);

  const recipeSrc = base.recipe || {};
  const recipe = {
    name: recipeSrc.name || recipeSrc.title || fallbackDish || null,
    steps: Array.isArray(recipeSrc.steps)
      ? recipeSrc.steps
      : recipeSrc.instructions
        ? [recipeSrc.instructions]
        : [],
    notes:
      Array.isArray(recipeSrc.notes) && recipeSrc.notes.length
        ? recipeSrc.notes
        : recipeSrc.image
          ? [recipeSrc.image]
          : null
  };

  const extras = { ...base };
  delete extras.ingredients;
  delete extras.ingredients_lines;
  delete extras.ingredients_structured;
  delete extras.recipe;

  return {
    ...extras,
    provider,
    recipe,
    ingredients,
    ingredients_structured: structuredCandidates || null
  };
}

// ---- OpenAI Recipe fallback (safe) ----

// === PATCH 3: Minimal Spoonacular recipe shim (skip if you already have one) ===
// === PATCH A: provider adapters (map old names to new) ===
// === PATCH C: OpenAI recipe extractor (JSON output) ===
// Needs env.OPENAI_API_KEY
async function callOpenAIRecipe(dish, env, opts = {}) {
  const key = env.OPENAI_API_KEY;
  if (!key) return { ingredients: [], reason: "OPENAI_API_KEY missing" };

  const system =
    'You extract probable ingredient lines for a named dish. Respond ONLY as strict JSON: {"ingredients": ["..."]}. No prose.';
  const user = `Dish: ${dish}
Return 10-25 concise ingredient lines a home cook would list (no steps). Use plain names (e.g., "fettuccine", "heavy cream", "parmesan", "chicken breast", "garlic", "butter", "olive oil", "salt", "black pepper").`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
    const data = await parseResSafe(res);
    if (!res.ok)
      return {
        ingredients: [],
        reason: `openai http ${res.status}`,
        debug: data
      };
    const txt = data?.choices?.[0]?.message?.content || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(txt);
    } catch {
      parsed = data && data.ingredients ? data : {};
    }
    const ingredients = Array.isArray(parsed.ingredients)
      ? parsed.ingredients.map((s) => String(s).trim()).filter(Boolean)
      : [];
    return {
      ingredients,
      reason: ingredients.length ? "ok" : "no ingredients",
      debug: data && data.__nonjson__ ? { nonjson: true } : undefined
    };
  } catch (e) {
    return { ingredients: [], reason: String(e?.message || e) };
  }
}

// === PATCH C: OpenAI recipe extractor (JSON output) ===
// Needs env.OPENAI_API_KEY

async function callSpoonacularRecipe(dish, env) {
  const key = env.SPOONACULAR_KEY;
  if (!key) return { ingredients: [], reason: "SPOONACULAR_KEY missing" };

  const searchUrl = new URL(
    "https://api.spoonacular.com/recipes/complexSearch"
  );
  searchUrl.searchParams.set("query", dish);
  searchUrl.searchParams.set("number", "1");
  searchUrl.searchParams.set("addRecipeInformation", "true");
  searchUrl.searchParams.set("fillIngredients", "true");
  searchUrl.searchParams.set("instructionsRequired", "false");
  searchUrl.searchParams.set("apiKey", key);

  let search;
  try {
    const r = await fetch(searchUrl, { method: "GET" });
    search = await parseResSafe(r);
    if (!r.ok)
      return {
        ingredients: [],
        reason: `spoonacular search http ${r.status}`,
        debug: search
      };
  } catch (e) {
    return {
      ingredients: [],
      reason: `spoonacular search err ${String(e?.message || e)}`
    };
  }

  const item = search?.results?.[0];
  if (!item) return { ingredients: [], reason: "no results" };

  const ext = Array.isArray(item.extendedIngredients)
    ? item.extendedIngredients
    : [];
  const ingredients = ext
    .map((x) => {
      const original = typeof x?.original === "string" ? x.original.trim() : "";
      if (original) return original;
      const fallback = [x?.amount, x?.unit, x?.nameClean || x?.name]
        .filter(Boolean)
        .join(" ")
        .trim();
      return fallback || null;
    })
    .filter(Boolean);

  return { ingredients, reason: ingredients.length ? "ok" : "no ingredients" };
}

async function spoonacularFetch(env, dish, cuisine = "", lang = "en") {
  const apiKey = (env.SPOONACULAR_API_KEY || "").trim();
  if (!apiKey) return null;

  const searchUrl = `https://api.spoonacular.com/recipes/complexSearch?query=${encodeURIComponent(dish)}&number=1&addRecipeInformation=true&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const r = await fetch(searchUrl, {
      headers: { "x-api-key": apiKey, accept: "application/json" }
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.log("Spoonacular error", r.status, t.slice(0, 180));
      return null;
    }
    const data = await r.json();
    const res = data?.results?.[0];
    if (!res) return null;

    let extended = Array.isArray(res.extendedIngredients)
      ? res.extendedIngredients
      : null;
    if (!extended || !extended.length) {
      try {
        const infoUrl = `https://api.spoonacular.com/recipes/${res.id}/information?includeNutrition=false&apiKey=${encodeURIComponent(apiKey)}`;
        const infoRes = await fetch(infoUrl, {
          headers: { "x-api-key": apiKey, accept: "application/json" }
        });
        if (infoRes.ok) {
          const info = await infoRes.json();
          extended = Array.isArray(info.extendedIngredients)
            ? info.extendedIngredients
            : null;
        } else {
          const t = await infoRes.text().catch(() => "");
          console.log(
            "Spoonacular info error",
            infoRes.status,
            t.slice(0, 180)
          );
        }
      } catch (e) {
        console.log("Spoonacular info fetch failed:", e?.message || String(e));
      }
    }

    const ingredientsLines = extended
      ? extended.map((i) => i.original || i.name || "").filter(Boolean)
      : [];

    return {
      recipe: {
        title: res.title || dish,
        instructions: res.instructions || "",
        image: res.image || null,
        cuisine: (res.cuisines && res.cuisines[0]) || cuisine || null
      },
      ingredients: ingredientsLines,
      provider: "spoonacular"
    };
  } catch (err) {
    console.log("Spoonacular fail:", err?.message || String(err));
    return null;
  }
}

async function fetchFromEdamam(env, dish, cuisine = "", lang = "en") {
  await recordMetric(env, "provider:edamam:hit");
  try {
    const res = await callEdamam(env, dish, cuisine, lang);
    const best = Array.isArray(res?.items) ? res.items[0] : null;
    if (!best) {
      const reason = res?.error || res?.note || "no_edamam_hits";
      return { ingredients: [], provider: "edamam", reason, _skip: "edamam" };
    }
    const normalized = normalizeEdamamRecipe(best);
    return normalizeProviderRecipe(
      {
        recipe: normalized.recipe,
        ingredients: normalized.ingredients,
        raw: best
      },
      dish,
      "edamam"
    );
  } catch (err) {
    console.warn("edamam_fail", err?.message || err);
    return { ingredients: [], provider: "edamam", _skip: "edamam" };
  }
}

async function fetchFromSpoonacular(env, dish, cuisine = "", lang = "en") {
  await recordMetric(env, "provider:spoonacular:hit");
  try {
    const r = await spoonacularFetch(env, dish, cuisine, lang);
    if (!r || !Array.isArray(r.ingredients)) {
      throw new Error("Bad spoonacular shape");
    }
    return normalizeProviderRecipe(r, dish, "spoonacular");
  } catch (e) {
    console.warn("spoonacular_fail", e?.message || e);
    return { ingredients: [], provider: "spoonacular", _skip: "spoonacular" };
  }
}

async function fetchFromOpenAI(env, dish, cuisine = "", lang = "en") {
  await recordMetric(env, "provider:openai:hit");
  try {
    const res = await callOpenAIRecipe(dish, env, { cuisine, lang });
    if (!Array.isArray(res?.ingredients) || !res.ingredients.length) {
      return {
        ingredients: [],
        provider: "openai",
        reason: res?.reason || "openai_empty",
        _skip: "openai"
      };
    }
    const payload = {
      recipe: res.recipe || { name: dish, steps: [], notes: null },
      ingredients: res.ingredients,
      reason: res.reason,
      debug: res.debug
    };
    return normalizeProviderRecipe(payload, dish, "openai");
  } catch (err) {
    console.warn("openai_fail", err?.message || err);
    return { ingredients: [], provider: "openai", _skip: "openai" };
  }
}

async function callZestful(env, lines = []) {
  if (!lines?.length) return null;

  const host = (env.ZESTFUL_RAPID_HOST || "zestful.p.rapidapi.com").trim();
  const url = `https://${host}/parseIngredients`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": env.ZESTFUL_RAPID_KEY,
        "X-RapidAPI-Host": host
      },
      body: JSON.stringify({ ingredients: lines })
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.log("Zestful error", res.status, t.slice(0, 180));
      return null;
    }
    const data = await res.json();

    const parsed = (data.results || []).map((r, i) => ({
      original:
        lines[i] || r.ingredientRaw || r.ingredientParsed?.ingredient || "",
      name:
        r.ingredientParsed?.product ||
        r.ingredientParsed?.ingredient ||
        r.ingredient ||
        r.name ||
        "",
      qty: r.ingredientParsed?.quantity ?? r.quantity ?? null,
      unit: r.ingredientParsed?.unit ?? r.unit ?? null,
      comment:
        r.ingredientParsed?.preparationNotes ??
        r.ingredientParsed?.comment ??
        r.comment ??
        null,
      _conf: r.confidence ?? null
    }));

    return parsed.length ? parsed : null;
  } catch (err) {
    console.log("Zestful fail:", err?.message || String(err));
    return null;
  }
}

// --- Open Food Facts fallback ---
async function callOFF(env, name) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(name)}&search_simple=1&action=process&json=1&page_size=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "TummyBuddyApp/1.0" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const p = data?.products?.[0];
    if (!p) return null;

    return {
      description: p.product_name || p.generic_name || name,
      brand: p.brands || null,
      source: "OPEN_FOOD_FACTS",
      nutrients: {
        energyKcal: p.nutriments["energy-kcal_100g"] ?? null,
        protein_g: p.nutriments.proteins_100g ?? null,
        fat_g: p.nutriments.fat_100g ?? null,
        carbs_g: p.nutriments.carbohydrates_100g ?? null,
        sugar_g: p.nutriments.sugars_100g ?? null,
        fiber_g: p.nutriments.fiber_100g ?? null,
        sodium_mg:
          p.nutriments.sodium_100g != null
            ? p.nutriments.sodium_100g * 1000
            : null
      }
    };
  } catch (err) {
    return null;
  }
}

function sumNutrition(rows = []) {
  const keys = [
    "energyKcal",
    "protein_g",
    "fat_g",
    "carbs_g",
    "sugar_g",
    "fiber_g",
    "sodium_mg"
  ];
  const total = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const n = r?.nutrition || {};
    for (const k of keys) {
      if (typeof n[k] === "number") total[k] += n[k];
    }
  }
  for (const k of keys) total[k] = Math.round(total[k] * 100) / 100;
  return total;
}

function extractMacrosFromFDC(full) {
  const empty = () => ({
    energyKcal: null,
    protein_g: null,
    fat_g: null,
    carbs_g: null,
    sugar_g: null,
    fiber_g: null,
    sodium_mg: null
  });

  const scaleMacros = (macros, factor) => {
    if (!macros || !Number.isFinite(factor) || factor <= 0) return null;
    const out = empty();
    for (const key of Object.keys(out)) {
      const val = macros[key];
      out[key] = val == null ? null : Math.round(val * factor * 1000) / 1000;
    }
    return out;
  };

  const deriveServing = () => {
    let grams = null;
    let unit = null;
    let size = null;

    const rawSize = Number(full?.servingSize);
    if (Number.isFinite(rawSize) && rawSize > 0) size = rawSize;

    const rawUnit =
      typeof full?.servingSizeUnit === "string"
        ? full.servingSizeUnit.trim()
        : "";
    if (rawUnit) unit = rawUnit;
    if (size != null && rawUnit && rawUnit.toLowerCase() === "g") grams = size;

    const portions = Array.isArray(full?.foodPortions) ? full.foodPortions : [];
    let picked = null;
    for (const portion of portions) {
      if (!Number.isFinite(portion?.gramWeight) || portion.gramWeight <= 0)
        continue;
      const desc = String(
        portion.portionDescription || portion.modifier || ""
      ).toLowerCase();
      const isServing =
        desc.includes("serving") ||
        desc.includes("portion") ||
        desc.includes("piece");
      if (!picked || isServing) {
        picked = portion;
        if (isServing) break;
      }
    }

    if (picked) {
      if (grams == null) grams = Number(picked.gramWeight);
      if (!unit) {
        const mu = picked.measureUnit?.abbreviation || picked.measureUnit?.name;
        if (mu) unit = String(mu);
        else if (picked.portionDescription)
          unit = String(picked.portionDescription);
        else if (picked.modifier) unit = String(picked.modifier);
      }
      if (size == null && Number.isFinite(picked.amount))
        size = Number(picked.amount);
    }

    if (grams != null) grams = Math.round(grams * 1000) / 1000;

    if (grams == null && unit == null && size == null) return null;
    return {
      grams,
      unit: unit ? unit.toLowerCase() : null,
      size
    };
  };

  const serving = deriveServing();
  const servingGrams =
    serving?.grams && Number.isFinite(serving.grams) && serving.grams > 0
      ? serving.grams
      : null;

  const ln = full?.labelNutrients;
  if (ln) {
    const v = (k) => ln[k]?.value ?? null;
    const perServing = empty();
    perServing.energyKcal =
      v("calories") != null ? Math.round(v("calories")) : null;
    perServing.protein_g = v("protein") != null ? Number(v("protein")) : null;
    perServing.fat_g = v("fat") != null ? Number(v("fat")) : null;
    perServing.carbs_g =
      v("carbohydrates") != null ? Number(v("carbohydrates")) : null;
    perServing.sugar_g = v("sugars") != null ? Number(v("sugars")) : null;
    perServing.fiber_g = v("fiber") != null ? Number(v("fiber")) : null;
    perServing.sodium_mg = v("sodium") != null ? Math.round(v("sodium")) : null;

    const per100g = servingGrams
      ? scaleMacros(perServing, 100 / servingGrams)
      : null;

    return {
      perServing,
      per100g,
      serving
    };
  }

  const list = Array.isArray(full?.foodNutrients) ? full.foodNutrients : [];
  const rows = list.map((n) => {
    const name = (n.nutrient?.name || n.nutrientName || "").toLowerCase();
    const number = (n.nutrient?.number || "").toString();
    const unit = (n.nutrient?.unitName || n.unitName || "").toLowerCase();
    const value = n.amount ?? n.value ?? null;
    return { name, number, unit, value };
  });

  const find = (preds) => {
    for (const r of rows) {
      for (const p of preds) {
        if (typeof p === "string") {
          if (r.name.includes(p)) return r;
        } else if (p.number && r.number === p.number) {
          return r;
        }
      }
    }
    return null;
  };

  const energy = find(["energy (kcal)", "energy", { number: "1008" }]);
  let energyKcal = null;
  if (energy?.value != null) {
    if (energy.unit === "kj") energyKcal = energy.value / 4.184;
    else energyKcal = energy.value;
  }

  const prot = find(["protein", { number: "1003" }]);
  const fat = find(["total lipid (fat)", "fat", { number: "1004" }]);
  const carb = find([
    "carbohydrate, by difference",
    "carbohydrate",
    { number: "1005" }
  ]);
  const sug = find([
    "sugars, total including nlea",
    "sugars, total",
    "sugars",
    { number: "2000" }
  ]);
  const fib = find(["fiber, total dietary", "fiber", { number: "1079" }]);
  const sod = find(["sodium, na", "sodium", { number: "1093" }]);

  const norm = (r, to = "g") => {
    if (!r || r.value == null) return null;
    if (to === "g") {
      if (r.unit === "mg") return r.value / 1000;
      return r.value;
    }
    if (to === "mg") {
      if (r.unit === "g") return r.value * 1000;
      return r.value;
    }
    return r.value;
  };

  const per100g = empty();
  per100g.energyKcal = energyKcal != null ? Math.round(energyKcal) : null;
  per100g.protein_g = norm(prot, "g");
  per100g.fat_g = norm(fat, "g");
  per100g.carbs_g = norm(carb, "g");
  per100g.sugar_g = norm(sug, "g");
  per100g.fiber_g = norm(fib, "g");
  per100g.sodium_mg = norm(sod, "mg");

  const perServing = servingGrams
    ? scaleMacros(per100g, servingGrams / 100)
    : null;

  return {
    perServing: perServing || (per100g ? { ...per100g } : empty()),
    per100g,
    serving
  };
}

// --- USDA FoodData Central: search + prefer SR/Foundation + detail fetch ---
async function callUSDAFDC(env, name) {
  const host = env.USDA_FDC_HOST || "api.nal.usda.gov";
  const key = env.USDA_FDC_API_KEY;
  if (!key || !name) return null;

  const searchUrl = `https://${host}/fdc/v1/foods/search?query=${encodeURIComponent(name)}&pageSize=5&dataType=SR%20Legacy,Survey%20(FNDDS),Foundation,Branded&api_key=${key}`;
  const sres = await fetch(searchUrl, {
    headers: { accept: "application/json" }
  });
  if (!sres.ok) return null;

  const sdata = await sres.json();
  const foods = Array.isArray(sdata?.foods) ? sdata.foods : [];
  if (!foods.length) return null;

  const makeEmpty = () => ({
    energyKcal: null,
    protein_g: null,
    fat_g: null,
    carbs_g: null,
    sugar_g: null,
    fiber_g: null,
    sodium_mg: null
  });

  const lowerName = name.toLowerCase();
  const nameTokens = lowerName.split(/\s+/).filter(Boolean);
  const matchThreshold = lowerName ? (nameTokens.length >= 2 ? 4 : 2) : 1;

  const dataTypePriority = new Map([
    ["sr legacy", 4],
    ["survey (fndds)", 3],
    ["foundation", 2],
    ["branded", 1]
  ]);

  const processedTerms = [
    "marinated",
    "brined",
    "seasoned",
    "brine",
    "breaded",
    "fried",
    "smoked",
    "bbq",
    "glazed",
    "teriyaki",
    "sauce",
    "gravy",
    "rotisserie",
    "canned",
    "frozen",
    "packaged",
    "pre-cooked",
    "fully cooked",
    "smothered"
  ];

  const looksProcessed = (text = "") => {
    const lower = String(text || "").toLowerCase();
    return processedTerms.some((term) => lower.includes(term));
  };

  const scoreName = (text = "") => {
    const lower = String(text || "").toLowerCase();
    if (!lower) return 0;
    let score = 0;
    if (lower === lowerName) score += 6;
    if (lower.includes(lowerName)) score += 4;
    for (const token of nameTokens) {
      if (token.length < 3) continue;
      if (lower.includes(token)) score += 1;
    }
    return score;
  };

  const qualityScore = (f) => {
    const dt = (f.dataType || "").toLowerCase();
    const combined = [
      f.description,
      f.additionalDescriptions,
      f.ingredientStatement
    ]
      .filter(Boolean)
      .join(" ");

    let score = (dataTypePriority.get(dt) || 0) * 10;
    score += scoreName(combined);
    if (!f.brandOwner) score += 1;
    else if (dt.includes("branded")) score -= 1;
    if (Array.isArray(f.foodNutrients) && f.foodNutrients.length > 0)
      score += 2;
    if (looksProcessed(combined)) score -= 6;
    return score;
  };

  foods.sort((a, b) => qualityScore(b) - qualityScore(a));

  let bestMatchEvenIfProcessed = null;
  let bestWithMacros = null;
  let firstPayload = null;

  for (const food of foods) {
    const detail = await fetch(
      `https://${host}/fdc/v1/food/${food.fdcId}?api_key=${key}`,
      {
        headers: { accept: "application/json" }
      }
    );
    if (!detail.ok) continue;
    const full = await detail.json();
    const macros = extractMacrosFromFDC(full);
    const nutrients = macros?.perServing
      ? { ...macros.perServing }
      : macros?.per100g
        ? { ...macros.per100g }
        : makeEmpty();
    const payload = {
      fdcId: full.fdcId,
      description: full.description,
      brand: full.brandOwner || null,
      dataType: full.dataType || null,
      nutrients,
      nutrients_per_serving: macros?.perServing
        ? { ...macros.perServing }
        : null,
      nutrients_per_100g: macros?.per100g ? { ...macros.per100g } : null,
      serving: macros?.serving || null,
      source: "USDA_FDC"
    };

    const combinedDesc = [
      full.description,
      full.additionalDescriptions,
      full.ingredientStatement
    ]
      .filter(Boolean)
      .join(" ");
    const processed = looksProcessed(combinedDesc);
    const nameScore = scoreName(combinedDesc);
    const matches = nameScore >= matchThreshold;
    const hasMacros =
      nutrients.energyKcal != null || nutrients.protein_g != null;

    if (!firstPayload) firstPayload = payload;
    if (!bestWithMacros && hasMacros) bestWithMacros = payload;
    if (!bestMatchEvenIfProcessed && hasMacros && matches)
      bestMatchEvenIfProcessed = payload;

    if (hasMacros && matches && !processed) {
      return payload;
    }
  }

  if (bestMatchEvenIfProcessed) return bestMatchEvenIfProcessed;
  if (bestWithMacros) return bestWithMacros;
  if (firstPayload) return firstPayload;

  const best = foods[0];
  if (!best) return null;
  return {
    fdcId: best.fdcId,
    description: best.description,
    brand: best.brandOwner || null,
    dataType: best.dataType || null,
    nutrients: makeEmpty(),
    nutrients_per_serving: null,
    nutrients_per_100g: null,
    serving: null,
    source: "USDA_FDC"
  };
}

// Calls our own /menu/uber-test INTERNALLY (no network), returns { ok, source, items: [...] }
async function callUberForMenu(env, query, address, opts = {}, ctx) {
  const params = new URLSearchParams({
    query,
    address,
    maxRows: String(opts.maxRows || 250),
    page: String(opts.page || 1),
    us: "1",
    locale: opts.locale || "en-US"
  });

  const innerReq = new Request(
    `https://dummy.local/menu/uber-test?${params.toString()}`,
    {
      method: "GET",
      headers: { accept: "application/json" }
    }
  );

  const innerRes = await _worker_impl.fetch(innerReq, env, ctx);
  if (!innerRes || !innerRes.ok) {
    return { ok: false, error: `uber-test HTTP ${innerRes?.status || 500}` };
  }
  const js = await innerRes.json();

  const items =
    (js && js.data && Array.isArray(js.data.items) && js.data.items) ||
    (Array.isArray(js.items) && js.items) ||
    [];

  return { ok: true, source: js?.source || "live", items };
}

async function r2WriteJSON(env, key, obj) {
  if (!env?.R2_BUCKET) throw new Error("R2_BUCKET not bound");
  await env.R2_BUCKET.put(key, JSON.stringify(obj), {
    httpMetadata: { contentType: "application/json" }
  });
}

async function handleDebugFetchBytes(request) {
  const u = new URL(request.url);
  const img = (u.searchParams.get("url") || "").trim();
  if (!img) return json({ ok: false, error: "Missing ?url=" }, { status: 400 });

  try {
    const r = await fetch(img, {
      headers: {
        "User-Agent": "TummyBuddyWorker/1.0 (+https://tummybuddy.app)",
        Accept: "image/*,*/*;q=0.8"
      }
    });
    const ct = r.headers.get("content-type") || "";
    const ab = await r.arrayBuffer();
    const len = ab.byteLength;

    const view = new Uint8Array(ab.slice(0, Math.min(2048, len)));
    let s = "";
    for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
    const b64_head = btoa(s).slice(0, 120);

    return json({
      ok: true,
      status: r.status,
      content_type: ct,
      byte_length: len,
      b64_head_sample: b64_head
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, { status: 502 });
  }
}

// Replace the old HTTP-based helper with a direct Queue send:
async function enqueueDishDirect(env, payload) {
  const id =
    (globalThis.crypto?.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // The consumer expects an `id` and the job body. Adjust keys to match your consumer.
  const message = { id, ...payload };
  await env.ANALYSIS_QUEUE.send(JSON.stringify(message));
  return { ok: true, id };
}

// ---- Step 41.12: enqueue top items + write lean placeholders ----
async function enqueueTopItems(
  env,
  topItems,
  { place_id, cuisine, query, address, forceUS }
) {
  const jobs = await Promise.allSettled(
    (Array.isArray(topItems) ? topItems : []).map(async (item) => {
      const dish_name = item.name || item.title || "Unknown Dish";
      const dish_desc = item.description || "";
      const { ok, id } = await enqueueDishDirect(env, {
        place_id,
        dish_name,
        dish_desc,
        cuisine
      });

      const now = new Date().toISOString();
      const lean = {
        id,
        status: "queued",
        created_at: now,
        updated_at: now,
        place_id,
        dish_name,
        dish_desc,
        cuisine,
        source: "uber-us",
        meta: { query, address, forceUS: !!forceUS }
      };
      await r2WriteJSON(env, `results/${id}.json`, lean);

      return { id, dish_name, status: ok ? "queued" : "error" };
    })
  );

  const enqueued = jobs.map((j) =>
    j.status === "fulfilled" ? j.value : { error: String(j.reason) }
  );
  return { enqueued };
}

async function handleMenuExtract(env, request, url, ctx) {
  try {
    const query = (
      url.searchParams.get("q") ||
      url.searchParams.get("query") ||
      ""
    ).trim();

    const address = (url.searchParams.get("address") || "Miami, FL").trim();
    const userId = (url.searchParams.get("user_id") || "").trim();
    let cachedUserPrefs = null;
    const getUserPrefs = async () => {
      if (cachedUserPrefs) return cachedUserPrefs;
      cachedUserPrefs = await loadUserPrefs(env, userId);
      return cachedUserPrefs;
    };

    // NEW: optional web page that contains a menu image
    const webUrlRaw = (url.searchParams.get("web_url") || "").trim();

    let ocrUrl = (url.searchParams.get("ocr_url") || "").trim();
    const forceReanalyze = url.searchParams.get("force_reanalyze") === "1";
    const analyze = url.searchParams.get("analyze") === "1";
    const debug = (url.searchParams.get("debug") || "").trim();
    const ocrParse = url.searchParams.get("ocr_parse") === "1";
    const forceLLM = url.searchParams.get("force_llm") === "1";
    const dry = url.searchParams.get("dry") === "1";

    // If caller gave a web page but no ocr_url, try to extract a good image link
    if (!ocrUrl && webUrlRaw) {
      let picked = null;

      // First: try HTML parse (og:image, srcset, imgs)
      try {
        const html = await fetchHtml(env, webUrlRaw);
        picked = pickMenuImageFromHtml(html, webUrlRaw);
      } catch (e) {
        // ignore here; we’ll try a heuristic next
      }

      // Second: if still nothing, try a direct-image heuristic (e.g., Imgur)
      if (!picked) {
        const guess = normalizeGalleryToDirectImage(webUrlRaw);
        if (guess) picked = guess;
      }

      if (picked) {
        ocrUrl = picked;
        if (debug === "web") {
          return json({
            ok: true,
            source: "web_adapter",
            web_url: webUrlRaw,
            picked_image_url: picked,
            note: "picked_via_html_or_heuristic"
          });
        }
      } else if (debug === "web") {
        return json(
          {
            ok: false,
            source: "web_adapter",
            web_url: webUrlRaw,
            error: "no_image_found"
          },
          { status: 404 }
        );
      }
    }

    if (ocrUrl && !isOcrEnabled(env)) {
      return json(
        {
          ok: false,
          error: "OCR tier is disabled. Set OCR_TIER_ENABLED=1 to enable.",
          hint: "Remove ?ocr_url=... or enable the flag."
        },
        { status: 400 }
      );
    }

    if (ocrUrl && isOcrEnabled(env)) {
      try {
        console.log("[OCR] calling Vision for:", ocrUrl);
        const { fullText, lines, raw } = await callVisionForText(env, ocrUrl);

        let parsed = null;
        if (ocrParse) {
          parsed = parseOCRToCandidates(fullText);
        }

        return json({
          ok: true,
          source: "ocr_vision_text",
          received: {
            query,
            address,
            ocr_url: ocrUrl,
            force_reanalyze: forceReanalyze,
            analyze
          },
          counts: { lines: lines.length, chars: fullText.length },
          preview: fullText.slice(0, 200),
          lines_first_20: lines.slice(0, 20),
          ...(ocrParse
            ? {
                parsed_count: parsed.length,
                parsed_first_10: parsed.slice(0, 10)
              }
            : {}),
          ...(debug === "vision"
            ? {
                vision_keys: raw ? Object.keys(raw) : [],
                vision_raw_first: raw || null
              }
            : {})
        });
      } catch (err) {
        console.warn("[OCR] Vision error:", err);
        return json(
          {
            ok: false,
            source: "ocr_vision_text",
            error: String(err?.message || err)
          },
          { status: 502 }
        );
      }
    }

    if (!query || !address) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Missing required parameters: query and address",
          hint: "/menu/extract?query=McDonald's&address=Miami, FL"
        }),
        {
          status: 400,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*"
          }
        }
      );
    }

    let pickedSource = "pending";
    let items = [];
    let notes = {};
    let uberResult = null;
    let gItems = [];
    let oItems = [];

    if (dry) {
      pickedSource = forceLLM ? "none" : "none";
      const rawPrefs = await getUserPrefs();
      const safePrefs =
        rawPrefs && typeof rawPrefs === "object"
          ? rawPrefs
          : { allergens: [], fodmap: {} };
      const itemsPersonal = Array.isArray(items)
        ? items.map((it) => personalizeDishForUser({ ...it }, safePrefs))
        : [];
      return json(
        {
          ok: true,
          source: pickedSource,
          query,
          address,
          items: itemsPersonal,
          user_prefs: safePrefs,
          ...(debug ? { notes: { dry_mode: true } } : {})
        },
        { status: 200, headers: { "access-control-allow-origin": "*" } }
      );
    }

    if (!forceLLM) {
      try {
        const uber = await callUberForMenu(
          env,
          query,
          address,
          { maxRows: 250, page: 1, locale: "en-US" },
          ctx
        );
        uberResult = uber;
        if (
          uber &&
          uber.ok &&
          Array.isArray(uber.items) &&
          uber.items.length > 0
        ) {
          pickedSource = "uber";
        } else {
          pickedSource = "none";
          notes.uber = "empty";
        }
      } catch (e) {
        pickedSource = "none";
        notes.uber_error = String(e?.message || e);
      }
    } else {
      notes.forced = "llm";
      pickedSource = "none";
    }

    if (pickedSource === "none" || forceLLM) {
      try {
        const [grokRes, openaiRes] = await Promise.allSettled([
          callGrokExtract(env, query, address),
          callOpenAIExtract(env, query, address)
        ]);

        const grok =
          grokRes.status === "fulfilled"
            ? grokRes.value
            : { ok: false, items: [], error: String(grokRes.reason) };
        const openai =
          openaiRes.status === "fulfilled"
            ? openaiRes.value
            : { ok: false, items: [], error: String(openaiRes.reason) };

        gItems = normalizeLLMItems(grok.items, "grok");
        oItems = normalizeLLMItems(openai.items, "openai");

        if (gItems.length > 0 && oItems.length > 0) pickedSource = "mixed";
        else if (gItems.length > 0) pickedSource = "grok";
        else if (oItems.length > 0) pickedSource = "openai";
        else pickedSource = "none";

        if (debug) {
          notes.grok_ok = !!grok.ok;
          if (grok.error) notes.grok_error = grok.error;
          if (grok.note) notes.grok_note = grok.note;
          notes.openai_ok = !!openai.ok;
          if (openai.error) notes.openai_error = openai.error;
          if (openai.note) notes.openai_note = openai.note;
        }
      } catch (e) {
        notes.llm_block_error = String(e?.message || e);
        pickedSource = pickedSource === "pending" ? "none" : pickedSource;
        items = Array.isArray(items) ? items : [];
      }
    }

    const uberCanon =
      pickedSource === "uber" || pickedSource === "mixed"
        ? Array.isArray(uberResult?.items)
          ? uberResult.items
          : []
        : [];

    const llmCanon =
      pickedSource === "grok" ||
      pickedSource === "openai" ||
      pickedSource === "mixed"
        ? [...(gItems || []), ...(oItems || [])]
        : [];

    // ----- Auto-fallback: if Uber+LLM empty, try web_url -> OCR (even without ocr_url)
    const totalPre =
      (Array.isArray(uberCanon) ? uberCanon.length : 0) +
      (Array.isArray(llmCanon) ? llmCanon.length : 0);
    if (totalPre === 0 && !ocrUrl && webUrlRaw && isOcrEnabled(env)) {
      let picked = null;
      let fetchError = null;

      try {
        const html = await fetchHtml(env, webUrlRaw);
        picked = pickMenuImageFromHtml(html, webUrlRaw);
      } catch (e) {
        fetchError = String(e?.message || e);
      }

      if (!picked) {
        const guess = normalizeGalleryToDirectImage(webUrlRaw);
        if (guess) picked = guess;
      }

      if (picked) {
        ocrUrl = picked;
        if (debug) {
          const note = {
            picked_image_url: picked,
            note: "picked_via_html_or_heuristic"
          };
          if (fetchError) note.fetch_error = fetchError;
          notes.web_adapter = note;
        }
      } else if (debug) {
        const note = { error: "no_image_found" };
        if (fetchError) note.fetch_error = fetchError;
        notes.web_adapter = note;
      }
    }

    // --- SMART OCR: only trigger if needed or explicitly forced ---
    const forceOCR = url.searchParams.get("force_ocr") === "1";
    let ocrItemsCanon = [];
    const uberCount = Array.isArray(uberCanon) ? uberCanon.length : 0;
    const llmCount = Array.isArray(llmCanon) ? llmCanon.length : 0;
    const shouldTryOCR =
      isOcrEnabled(env) &&
      ocrUrl &&
      (forceOCR || pickedSource === "none" || uberCount + llmCount === 0);

    if (shouldTryOCR) {
      try {
        const ocrCandidates = await fetchOCRCandidates(env, ocrUrl);
        ocrItemsCanon = Array.isArray(ocrCandidates)
          ? ocrCandidates.map(toCanonFromOCR)
          : [];
        if (debug)
          notes.ocr_items = Array.isArray(ocrItemsCanon)
            ? ocrItemsCanon.length
            : 0;
        if (ocrItemsCanon.length) {
          if (pickedSource === "none" || pickedSource === "pending")
            pickedSource = "ocr";
          else pickedSource = "mixed";
        } else {
          if (debug) notes.ocr_note = "ocr_no_items";
        }
      } catch (e) {
        if (debug) notes.ocr_error = String(e?.message || e);
      }
    }

    if (Array.isArray(uberCanon) && !uberCanon.length)
      notes.uber_note = "no_uber_items";
    if (Array.isArray(llmCanon) && !llmCanon.length)
      notes.llm_note = "no_llm_items";

    const merged = mergeCanonItems(uberCanon, llmCanon, ocrItemsCanon);
    const MAX = 250;
    items = merged.slice(0, MAX);

    if (uberCanon.length && (gItems?.length || oItems?.length)) {
      pickedSource = "mixed";
    }

    if (analyze && Array.isArray(items) && items.length) {
      const top = rankCanon(items, Number(url.searchParams.get("top") || 25));
      const place_id = url.searchParams.get("place_id") || "place.unknown";
      const cuisine = url.searchParams.get("cuisine") || "";

      const filteredTop = [];
      for (const it of top) {
        const cached = await maybeReturnCachedResult(request, env, {
          place_id,
          title: it.title || it.name
        });
        if (cached) {
          try {
            const cachedJson = JSON.parse(await cached.clone().text());
            it.analysis = cachedJson;
            it.source = "cache:r2";
          } catch {}
          continue;
        }
        filteredTop.push(it);
      }

      const shimUberShape = filteredTop.map((it) => ({
        name: it.title || "",
        description: it.description || "",
        section: it.section || "",
        price: typeof it.price_cents === "number" ? it.price_cents : null,
        price_display: it.price_text || null
      }));

      const { enqueued } = await enqueueTopItems(env, shimUberShape, {
        place_id,
        cuisine,
        query,
        address,
        forceUS: true
      });

      for (const dish of Array.isArray(items) ? items : []) {
        if (!Array.isArray(dish.hits)) {
          dish.hits = [];
        }
        if (dish.hits.length === 0) {
          const inferredText = inferHitsFromText(
            dish.title || dish.name || "",
            dish.description || ""
          );
          if (inferredText.length) {
            dish.hits = inferredText;
          }
        }
        if (dish.hits.length === 0) {
          const card = await fetchRecipeCard(
            env,
            dish.title || dish.name || query
          );
          if (card) {
            if (Array.isArray(card.ingredients)) {
              const inferredIngredients = inferHitsFromIngredients(
                card.ingredients
              );
              if (inferredIngredients.length) dish.hits = inferredIngredients;
            }
            if (dish.hits.length === 0) {
              const inferred = inferHitsFromRecipeCard(card);
              if (inferred.length) dish.hits = inferred;
            }
          }
        }
      }

      for (const dish of Array.isArray(top) ? top : []) {
        if (!Array.isArray(dish.hits)) {
          dish.hits = [];
        }
        if (dish.hits.length === 0) {
          const inferredText = inferHitsFromText(
            dish.title || dish.name || "",
            dish.description || ""
          );
          if (inferredText.length) {
            dish.hits = inferredText;
          }
        }
        if (dish.hits.length === 0) {
          const card = await fetchRecipeCard(
            env,
            dish.title || dish.name || query
          );
          if (card) {
            if (Array.isArray(card.ingredients)) {
              const inferredIngredients = inferHitsFromIngredients(
                card.ingredients
              );
              if (inferredIngredients.length) dish.hits = inferredIngredients;
            }
            if (dish.hits.length === 0) {
              const inferred = inferHitsFromRecipeCard(card);
              if (inferred.length) dish.hits = inferred;
            }
          }
        }
      }
      const rawPrefs = await getUserPrefs();
      const safePrefs =
        rawPrefs && typeof rawPrefs === "object"
          ? rawPrefs
          : { allergens: [], fodmap: {} };
      const itemsPersonal = Array.isArray(items)
        ? items.map((it) => personalizeDishForUser({ ...it }, safePrefs))
        : [];
      const topPersonal = Array.isArray(top)
        ? top
            .slice(0, 3)
            .map((it) => personalizeDishForUser({ ...it }, safePrefs))
        : [];
      return json(
        {
          ok: true,
          source: pickedSource,
          query,
          address,
          total: items.length,
          enqueued,
          top_sample: topPersonal,
          user_prefs: safePrefs,
          items: itemsPersonal
        },
        { status: 200, headers: { "access-control-allow-origin": "*" } }
      );
    }

    for (const dish of Array.isArray(items) ? items : []) {
      if (!Array.isArray(dish.hits)) {
        dish.hits = [];
      }
      if (dish.hits.length === 0) {
        const inferred = inferHitsFromText(
          dish.title || dish.name || "",
          dish.description || ""
        );
        if (inferred.length) {
          dish.hits = inferred;
        }
      }
      if (dish.hits.length === 0) {
        const card = await fetchRecipeCard(
          env,
          dish.title || dish.name || query
        );
        if (card) {
          if (Array.isArray(card.ingredients)) {
            const inferredIngredients = inferHitsFromIngredients(
              card.ingredients
            );
            if (inferredIngredients.length) dish.hits = inferredIngredients;
          }
          if (dish.hits.length === 0) {
            const inferredCard = inferHitsFromRecipeCard(card);
            if (inferredCard.length) dish.hits = inferredCard;
          }
        }
      }
    }

    const prefs = await getUserPrefs();
    const safePrefs =
      prefs && typeof prefs === "object"
        ? prefs
        : { allergens: [], fodmap: {} };
    const itemsPersonal = Array.isArray(items)
      ? items.map((it) => personalizeDishForUser(it, safePrefs))
      : [];

    return json(
      {
        ok: true,
        source: pickedSource,
        query,
        address,
        items: itemsPersonal,
        user_prefs: safePrefs,
        ...(debug ? { notes } : {})
      },
      { status: 200, headers: { "access-control-allow-origin": "*" } }
    );
  } catch (fatal) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "extract_handler_failed",
        message: String(fatal?.message || fatal)
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*"
        }
      }
    );
  }
}

async function handleRecipeResolve(env, request, url, ctx) {
  const method = request.method || "GET";
  let dish =
    url.searchParams.get("dish") || url.searchParams.get("title") || "";
  let place_id = url.searchParams.get("place_id") || "";
  let cuisine = url.searchParams.get("cuisine") || "";
  let lang = url.searchParams.get("lang") || "en";
  let body = {};

  const providersParse = (
    env.PROVIDERS_PARSE ||
    env.provider_parse ||
    "zestful,openai"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const recipeProviderFns = {
    edamam: fetchFromEdamam,
    spoonacular: fetchFromSpoonacular,
    openai: fetchFromOpenAI
  };

  const parseProviderFns = {
    zestful: async (env, ingLines) => callZestful(env, ingLines),
    openai: async () => null // placeholder (skip for now)
  };

  if (method === "POST") {
    try {
      body = await request.json();
    } catch {}
    dish = String(body.dish || body.title || dish || "");
    place_id = String(body.place_id || place_id || "");
    cuisine = String(body.cuisine || cuisine || "");
    lang = String(body.lang || lang || "en");
  }

  if (!dish.trim()) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Missing "dish" (dish name).',
        hint: "Use: /recipe/resolve?dish=Chicken%20Alfredo"
      }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*"
        }
      }
    );
  }

  const cacheKey = recipeCacheKey(dish, lang);
  const force = url.searchParams.get("force_reanalyze") === "1";
  const classify = url.searchParams.get("classify") === "1";
  const wantShape = (url.searchParams.get("shape") || "").toLowerCase();
  let pickedSource = "cache";
  let recipe = null;
  let ingredients = [];
  let notes = {};
  let out = null;
  let selectedProvider = null;
  let cacheHit = false;

  const cached = await recipeCacheRead(env, cacheKey);
  if (cached && cached.recipe && Array.isArray(cached.ingredients) && !force) {
    cacheHit = true;
    pickedSource = cached.from || cached.provider || "cache";
    recipe = cached.recipe;
    ingredients = Array.isArray(cached.ingredients)
      ? [...cached.ingredients]
      : [];
    notes =
      typeof cached.notes === "object" && cached.notes
        ? { ...cached.notes }
        : {};
    out = {
      ...cached,
      cache: true,
      recipe,
      ingredients
    };
    selectedProvider = pickedSource;

    if (wantShape === "recipe_card") {
      const dishTitle = dish;
      const rc = {
        ok: true,
        component: "RecipeCard",
        version: "v1",
        dish: { name: dishTitle, cuisine: cuisine || null },
        ingredients: ingredients.map((i) => ({
          name: i.name,
          qty: i.qty ?? null,
          unit: i.unit ?? null
        })),
        recipe: {
          steps:
            recipe?.steps && Array.isArray(recipe.steps) ? recipe.steps : [],
          notes:
            recipe?.notes && Array.isArray(recipe.notes) ? recipe.notes : null
        },
        molecular: { compounds: [], organs: {}, organ_summary: {} } // will fill if Premium
      };

      // Premium gate (same logic as non-cached branch)
      let isPremium = false;
      const gateParams = new URLSearchParams(url.search);
      const userId = (gateParams.get("user_id") || "").trim();
      if (gateParams.get("dev") === "1") isPremium = true;
      else if (userId && env.LEXICON_CACHE) {
        const kvKey = `tier/user:${userId}`;
        const tier = await env.LEXICON_CACHE.get(kvKey);
        isPremium = String(tier || "").toLowerCase() === "premium";
      }

      if (isPremium && Array.isArray(ingredients) && ingredients.length) {
        const foundCompounds = [];
        const organMap = {};
        // Quick bridge: map common ingredients to likely compounds before DB lookups
        const BRIDGE = {
          garlic: ["allicin"],
          "olive oil": ["oleocanthal"],
          turmeric: ["curcumin"],
          parmesan: ["histamine"],
          "aged cheese": ["histamine"],
          cream: ["lactose"],
          butter: ["lactose"],
          milk: ["lactose"],
          parsley: ["apigenin"],
          nutmeg: ["myristicin"]
        };
        const seenCompounds = new Set();
        for (const ing of ingredients) {
          const term = (ing?.name || "").toLowerCase().trim();
          if (!term) continue;

          // Use ingredient term + any bridged compound hints
          const searchTerms = [term, ...(BRIDGE[term] || [])];
          for (const sTerm of searchTerms) {
            const cRes = await env.D1_DB.prepare(
              `SELECT id, name, common_name, cid
                        FROM compounds
                        WHERE LOWER(name) = ? OR LOWER(common_name) = ?
                           OR LOWER(name) LIKE ? OR LOWER(common_name) LIKE ?
                        ORDER BY name LIMIT 5`
            )
              .bind(sTerm, sTerm, `%${sTerm}%`, `%${sTerm}%`)
              .all();

            const comps = cRes?.results || [];
            for (const c of comps) {
              const key = (c.name || "").toLowerCase();
              if (seenCompounds.has(key)) continue;
              seenCompounds.add(key);

              const eRes = await env.D1_DB.prepare(
                `SELECT organ, effect, strength, notes
                          FROM compound_organ_effects
                          WHERE compound_id = ?`
              )
                .bind(c.id)
                .all();
              const effs = eRes?.results || [];

              foundCompounds.push({
                name: c.name,
                from_ingredient: ing.name,
                cid: c.cid || null
              });
              for (const e of effs) {
                const k = e.organ || "unknown";
                if (!organMap[k]) organMap[k] = [];
                organMap[k].push({
                  compound: c.name,
                  effect: e.effect,
                  strength: e.strength,
                  notes: e.notes || null
                });
              }
            }
          }
        }
        // De-duplicate organ effects (ignore notes)
        for (const [org, list] of Object.entries(organMap)) {
          const seen = new Set();
          organMap[org] = list.filter((row) => {
            const key = `${org}|${row.compound}|${row.effect}`.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
        const organSummary = {};
        for (const [org, list] of Object.entries(organMap)) {
          let plus = 0,
            minus = 0,
            neutral = 0;
          for (const row of list) {
            if (row.effect === "benefit") plus++;
            else if (row.effect === "risk") minus++;
            else neutral++;
          }
          organSummary[org] = { plus, minus, neutral };
        }
        // Build human headlines from organ_summary
        function headlineFor({ plus = 0, minus = 0 }) {
          if (minus > 0 && plus === 0) return "⚠️ Risk";
          if (plus > 0 && minus === 0) return "👍 Benefit";
          if (plus > 0 && minus > 0) return "↔️ Mixed";
          return "ℹ️ Neutral";
        }
        const organ_headlines = Object.entries(organSummary).map(
          ([org, counts]) =>
            `${org[0].toUpperCase()}${org.slice(1)}: ${headlineFor(counts)}`
        );

        // UI: organ icons (fallback to 🧬)
        const ORG_ICON = {
          heart: "❤️",
          gut: "🦠",
          liver: "🧪",
          brain: "🧠",
          immune: "🛡️"
        };
        rc.molecular_icons = Object.keys(organSummary).reduce((m, org) => {
          m[org] = ORG_ICON[org] || "🧬";
          return m;
        }, {});

        // Humanized Biology: simple, friendly tips per organ
        function humanizeOrgans(summary) {
          const tips = [];
          for (const [org, { plus = 0, minus = 0 }] of Object.entries(
            summary
          )) {
            const Org = org.charAt(0).toUpperCase() + org.slice(1);
            let line = `${Org}: `;
            if (minus > 0 && plus === 0)
              line +=
                "may bother sensitive tummies—consider smaller portions or swaps.";
            else if (plus > 0 && minus === 0)
              line += "generally friendly in normal portions.";
            else if (plus > 0 && minus > 0)
              line += "mixed signal—portion size and add-ons matter.";
            else line += "no clear signal—use your judgment.";
            tips.push(line);
          }
          return tips;
        }
        rc.molecular_human = { organ_tips: humanizeOrgans(organSummary) };

        // ---- Polishing block: overall summary + sentiment + version/timestamp ----
        const totals = Object.entries(organSummary).reduce(
          (a, [org, c]) => {
            a.plus += c.plus || 0;
            a.minus += c.minus || 0;
            if ((c.minus || 0) > 0) a.riskOrgs.push(org);
            if ((c.plus || 0) > 0) a.benefitOrgs.push(org);
            return a;
          },
          { plus: 0, minus: 0, riskOrgs: [], benefitOrgs: [] }
        );

        function titleize(s) {
          return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
        }
        const riskStr = totals.riskOrgs.map(titleize).join(", ");
        const benefitStr = totals.benefitOrgs.map(titleize).join(", ");
        let overall_label = "Neutral";
        if (totals.minus > 0 && totals.plus === 0) overall_label = "Caution";
        else if (totals.plus > 0 && totals.minus === 0)
          overall_label = "Supportive";
        else if (totals.plus > 0 && totals.minus > 0) overall_label = "Mixed";

        const summary_sentence =
          overall_label === "Caution"
            ? `⚠️ May bother ${riskStr || "sensitive tummies"}.`
            : overall_label === "Supportive"
              ? `👍 Generally friendly for ${benefitStr || "wellbeing"} in normal portions.`
              : overall_label === "Mixed"
                ? `↔️ Mixed signal — supportive for ${benefitStr || "some organs"}, but caution for ${riskStr || "others"}.`
                : `ℹ️ No clear signal — use your judgment.`;

        // Add polished fields
        rc.molecular_human = {
          ...(rc.molecular_human || {}),
          summary: summary_sentence,
          sentiment: overall_label
        };

        // Version + timestamp for the card payload
        rc.payload_version = "recipe_card.v1.1";
        rc.generated_at = new Date().toISOString();

        // Optional: tweak the badge when gated vs premium (keep your existing logic if present)
        if (rc?.molecular?.compounds?.length >= 0 && !rc.molecular.gated) {
          rc.molecular_badge = `Molecular Insights: ${rc.molecular.compounds.length} compounds • ${Object.keys(rc.molecular.organ_summary || {}).length} organs`;
        } else if (rc?.molecular?.gated) {
          rc.molecular_badge = "Molecular Insights: upgrade for details";
        }

        // include in payload
        rc.molecular = {
          compounds: foundCompounds,
          organs: organMap,
          organ_summary: organSummary,
          organ_headlines
        };
        rc.molecular_badge = `Molecular Insights: ${foundCompounds.length} compounds • ${Object.keys(organSummary).length} organs`;

        // Flags & counts (must run after rc.molecular is set)
        rc.has_molecular =
          !rc?.molecular?.gated &&
          Array.isArray(rc?.molecular?.compounds) &&
          rc.molecular.compounds.length > 0;

        rc.molecular_counts = {
          compounds: Array.isArray(rc?.molecular?.compounds)
            ? rc.molecular.compounds.length
            : 0,
          organs: rc?.molecular?.organ_summary
            ? Object.keys(rc.molecular.organ_summary).length
            : 0
        };

        // If caller asked to classify, enqueue a job and include enqueued[]
        const wantClassify = url.searchParams.get("classify") === "1";
        if (wantClassify) {
          const dishTitleCard = rc?.dish?.name || dish || "Unknown Dish";
          const payload = {
            place_id: place_id || "place.unknown",
            dish_name: dishTitleCard,
            dish_desc:
              (Array.isArray(rc?.recipe?.notes)
                ? rc.recipe.notes.join("; ")
                : rc?.recipe?.steps?.[0] || "") || "",
            cuisine: cuisine || "",
            ingredients: (rc?.ingredients || []).map((i) => ({
              name: i.name,
              qty: i.qty ?? null,
              unit: i.unit ?? null
            }))
          };
          const { ok: enqOk, id } = await enqueueDishDirect(env, payload);
          rc.enqueued =
            enqOk && id ? [{ id, dish_name: payload.dish_name }] : [];
        }
      } else {
        rc.molecular = {
          compounds: [],
          organs: {},
          organ_summary: {},
          gated: true
        };
        rc.molecular_badge = "Molecular Insights: upgrade for details";
      }

      // attach dish nutrition to the card
      if (!out?.nutrition_summary && Array.isArray(out?.ingredients_parsed)) {
        out.nutrition_summary = sumNutrition(out.ingredients_parsed);
      }
      rc.nutrition_summary = out?.nutrition_summary || null;
      if (rc.nutrition_summary) {
        rc.nutrition_badges = [
          `${Math.round(rc.nutrition_summary.energyKcal)} kcal`,
          `${Math.round(rc.nutrition_summary.protein_g)} g protein`,
          `${Math.round(rc.nutrition_summary.fat_g)} g fat`,
          `${Math.round(rc.nutrition_summary.carbs_g)} g carbs`,
          `${Math.round(rc.nutrition_summary.sodium_mg)} mg sodium`
        ];
      }

      return new Response(JSON.stringify(rc, null, 2), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*"
        }
      });
    }
  } else {
    // Provider loop (deterministic order)
    let lastAttempt = null;
    for (const p of providerOrder(env)) {
      const fn = recipeProviderFns[p];
      if (!fn) continue;
      let candidate = null;
      try {
        candidate = await fn(env, dish, cuisine, lang);
      } catch (err) {
        console.warn(`[provider:${p}]`, err?.message || err);
        continue;
      }
      if (candidate) {
        lastAttempt = candidate;
      }
      if (
        candidate &&
        Array.isArray(candidate.ingredients) &&
        candidate.ingredients.length
      ) {
        out = candidate;
        selectedProvider = candidate.provider || p;
        break;
      }
    }
    if (!out && lastAttempt) {
      out = lastAttempt;
      if (!selectedProvider) {
        selectedProvider = lastAttempt.provider || null;
      }
    }
  }

  if (!cacheHit) {
    if (
      selectedProvider &&
      out &&
      Array.isArray(out.ingredients) &&
      out.ingredients.length
    ) {
      recipe = out.recipe || recipe;
      pickedSource = selectedProvider;
    } else {
      pickedSource = "pending";
      if (out?.note) notes.openai_note = out.note;
      if (out?.error) notes.openai_error = out.error;
      if (out?.reason) notes.provider_reason = out.reason;
    }
  }

  const wantParse = url.searchParams.get("parse") !== "0";
  // Normalize to lines no matter which provider filled 'out'
  const sourceLines = Array.isArray(out?.ingredients)
    ? out.ingredients
    : Array.isArray(out?.ingredients_lines)
      ? out.ingredients_lines
      : [];

  const ingLines = Array.isArray(sourceLines)
    ? sourceLines.map(ingredientEntryToLine).filter(Boolean)
    : [];

  if (!out) out = {};
  out.ingredients_lines = ingLines;

  let parsed = null;
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
  const dailyCap = parseInt(env.ZESTFUL_DAILY_CAP || "0", 10);

  if (wantParse && ingLines.length && env.ZESTFUL_RAPID_KEY) {
    const cached = [];
    const missingIdx = [];
    if (kv) {
      for (let i = 0; i < ingLines.length; i++) {
        const k = `zestful:${ingLines[i].toLowerCase()}`;
        let row = null;
        try {
          row = await kv.get(k, "json");
        } catch {}
        if (row) cached[i] = row;
        else missingIdx.push(i);
      }
    }

    let filled = cached.slice();
    if (missingIdx.length === ingLines.length || !kv) {
      const linesToParse = ingLines;
      const toParse = linesToParse.length;
      if (dailyCap) {
        const usedNow = await getZestfulCount(env);
        if (usedNow + toParse > dailyCap) {
          console.log(
            "[parse] zestful cap guard",
            usedNow,
            "+",
            toParse,
            ">",
            dailyCap
          );
          return json(
            {
              ok: false,
              error: "ZESTFUL_CAP_REACHED",
              used: usedNow,
              toParse,
              cap: dailyCap
            },
            { status: 429 }
          );
        }
      }
      const zest = await callZestful(env, linesToParse);
      if (Array.isArray(zest) && zest.length) {
        filled = zest;
        if (kv) {
          for (let i = 0; i < linesToParse.length; i++) {
            const k = `zestful:${linesToParse[i].toLowerCase()}`;
            if (zest[i]) {
              await kv.put(k, JSON.stringify(zest[i]), {
                expirationTtl: 60 * 60 * 24 * 30
              });
            }
          }
        }
        await incZestfulCount(env, toParse);
      }
    } else if (missingIdx.length) {
      const linesToParse = missingIdx.map((i) => ingLines[i]);
      const toParse = linesToParse.length;
      if (dailyCap) {
        const usedNow = await getZestfulCount(env);
        if (usedNow + toParse > dailyCap) {
          console.log(
            "[parse] zestful cap guard",
            usedNow,
            "+",
            toParse,
            ">",
            dailyCap
          );
          return json(
            {
              ok: false,
              error: "ZESTFUL_CAP_REACHED",
              used: usedNow,
              toParse,
              cap: dailyCap
            },
            { status: 429 }
          );
        }
      }
      const zest = await callZestful(env, linesToParse);
      if (Array.isArray(zest) && zest.length) {
        for (let j = 0; j < linesToParse.length; j++) {
          const i = missingIdx[j];
          filled[i] = zest[j];
          if (kv && zest[j]) {
            const k = `zestful:${ingLines[i].toLowerCase()}`;
            await kv.put(k, JSON.stringify(zest[j]), {
              expirationTtl: 60 * 60 * 24 * 30
            });
          }
        }
        await incZestfulCount(env, toParse);
      }
    }

    if (filled.filter(Boolean).length === ingLines.length) parsed = filled;
  }

  if (!parsed && wantParse && ingLines.length) {
    for (const p of providersParse) {
      if (p === "zestful") continue;
      const fn = parseProviderFns[p];
      if (!fn) continue;
      try {
        const got = await fn(env, ingLines);
        if (Array.isArray(got) && got.length) {
          parsed = got;
          break;
        }
      } catch (e) {
        console.log(`[parse] provider ${p} error:`, e?.message || String(e));
      }
    }
  }

  if (parsed?.length) {
    await enrichWithNutrition(env, parsed);
    ingredients = parsed.map((row) => ({
      name: row.name || row.original || "",
      qty:
        typeof row.qty === "number"
          ? row.qty
          : row.qty != null
            ? Number(row.qty) || null
            : null,
      unit: row.unit || null,
      comment: row.comment || row.preparationNotes || null
    }));
    out.ingredients_parsed = parsed;
    out.nutrition_summary = sumNutrition(parsed);
  } else if (
    Array.isArray(out?.ingredients_structured) &&
    out.ingredients_structured.length
  ) {
    ingredients = out.ingredients_structured.map((row) => ({
      name: row.name || row.original || "",
      qty: row.qty ?? row.quantity ?? null,
      unit: row.unit ?? null,
      comment: row.comment || row.preparation || row.preparationNotes || null
    }));
  } else if (
    Array.isArray(out?.ingredients) &&
    out.ingredients.every(
      (x) => x && typeof x === "object" && ("name" in x || "original" in x)
    )
  ) {
    ingredients = out.ingredients.map((row) => ({
      name: row.name || row.original || "",
      qty: row.qty ?? row.quantity ?? null,
      unit: row.unit ?? null,
      comment: row.comment || row.preparation || row.preparationNotes || null
    }));
  } else if (ingLines.length) {
    ingredients = ingLines.map((text) => ({
      name: text,
      qty: null,
      unit: null,
      comment: null
    }));
  }

  if (!cacheHit && recipe && Array.isArray(ingredients) && ingredients.length) {
    await recipeCacheWrite(env, cacheKey, {
      recipe,
      ingredients,
      from: pickedSource
    });
  }

  const responseSource = cacheHit ? "cache" : pickedSource;

  // --- normalize cached payloads to the new shape ---
  if (out) {
    if (out.recipe && !out.recipe.title && out.recipe.name) {
      out.recipe.title = out.recipe.name;
    }
    if (
      Array.isArray(out.ingredients_structured) &&
      out.ingredients_structured.length
    ) {
      out.ingredients_parsed = out.ingredients_structured;
      if (
        !Array.isArray(out.ingredients_lines) ||
        !out.ingredients_lines.length
      ) {
        out.ingredients_lines = out.ingredients_structured
          .map((x) => ingredientEntryToLine(x))
          .filter(Boolean);
      }
    }
    if (!Array.isArray(out.ingredients_lines)) {
      if (Array.isArray(out.ingredients)) {
        const looksStructured = out.ingredients.every(
          (x) => x && typeof x === "object" && "name" in x
        );
        if (looksStructured) {
          out.ingredients_parsed = out.ingredients;
          out.ingredients_lines = out.ingredients.map((x) => {
            const qty = x.qty !== undefined && x.qty !== null ? `${x.qty}` : "";
            const unit = x.unit ? ` ${x.unit}` : "";
            const name = x.name || "";
            const comment = x.comment ? `, ${x.comment}` : "";
            return [qty, unit, name, comment].join("").trim();
          });
        } else {
          out.ingredients_lines = out.ingredients;
        }
      } else {
        out.ingredients_lines = [];
      }
    }
  }

  if (classify && recipe && Array.isArray(ingredients) && ingredients.length) {
    const stampKey = classifyStampKey(dish, place_id, lang);
    const recent = await getClassifyStamp(env, stampKey);
    if (recent && recent.id) {
      return new Response(
        JSON.stringify({
          ok: true,
          source: responseSource || "cache",
          dish,
          place_id: place_id || null,
          cuisine: cuisine || null,
          lang,
          cache: cacheHit,
          enqueued: [{ id: recent.id, dish_name: dish, recent: true }],
          recipe,
          ingredients
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*"
          }
        }
      );
    }

    const classifySource =
      out?.ingredients_parsed || out?.ingredients_lines || ingredients;
    const payload = {
      place_id: place_id || "place.unknown",
      dish_name: dish,
      dish_desc:
        (Array.isArray(recipe?.notes)
          ? recipe.notes.join("; ")
          : recipe?.steps?.[0] || "") || "",
      cuisine: cuisine || "",
      ingredients: (Array.isArray(classifySource) ? classifySource : []).map(
        (i) => {
          if (typeof i === "string") {
            return { name: i, qty: null, unit: null };
          }
          return {
            name: i.name || i.original || "",
            qty: i.qty ?? null,
            unit: i.unit ?? null
          };
        }
      )
    };
    const { ok: enqueuedOk, id } = await enqueueDishDirect(env, payload);

    if (enqueuedOk && id) {
      await setClassifyStamp(
        env,
        stampKey,
        { id, dish, place_id, when: Date.now() },
        6 * 3600
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        source: responseSource || "edamam",
        dish,
        place_id: payload.place_id,
        cuisine,
        cache: true,
        enqueued: enqueuedOk ? [{ id, dish_name: payload.dish_name }] : [],
        recipe,
        ingredients
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*"
        }
      }
    );
  }

  if (out && !out.provider) {
    out.provider = out.cache ? "cache" : (out.provider ?? null);
  }

  const reply = {
    ok: true,
    source: responseSource,
    dish,
    place_id: place_id || null,
    cuisine: cuisine || null,
    lang,
    cache: cacheHit,
    recipe,
    ingredients,
    ...(out?.ingredients_lines
      ? { ingredients_lines: out.ingredients_lines }
      : {}),
    ...(out?.ingredients_parsed
      ? { ingredients_parsed: out.ingredients_parsed }
      : {}),
    ...(Object.keys(notes).length ? { notes } : {})
  };

  out = out ? { ...out, ...reply } : { ...reply };

  // ==== OPTIONAL SHAPE: RecipeCard ===================================
  // If caller requests ?shape=recipe_card, return the fixed UI payload.
  if (wantShape === "recipe_card") {
    const dishTitle =
      dish || body?.dish || url.searchParams.get("dish") || "Unknown Dish";
    const rc = {
      ok: true,
      component: "RecipeCard",
      version: "v1",
      dish: { name: dishTitle, cuisine: cuisine || null },
      ingredients: Array.isArray(ingredients)
        ? ingredients.map((i) => ({
            name: i.name,
            qty: i.qty ?? null,
            unit: i.unit ?? null
          }))
        : [],
      recipe: {
        steps: recipe?.steps && Array.isArray(recipe.steps) ? recipe.steps : [],
        notes:
          recipe?.notes && Array.isArray(recipe.notes) ? recipe.notes : null
      },
      molecular: { compounds: [], organs: {}, organ_summary: {} } // filled only for Premium
    };

    // Premium enrichment (ingredient -> compounds -> organ effects)
    const gateParams = new URLSearchParams(url.search);
    const userId = (gateParams.get("user_id") || "").trim();
    let isPremium = false;
    if (gateParams.get("dev") === "1") isPremium = true;
    else if (userId) {
      const kvKey = `tier/user:${userId}`;
      const tier = await (env.LEXICON_CACHE
        ? env.LEXICON_CACHE.get(kvKey)
        : null);
      isPremium = String(tier || "").toLowerCase() === "premium";
    }

    if (isPremium && Array.isArray(ingredients) && ingredients.length) {
      const foundCompounds = [];
      const organMap = {};
      // Quick bridge: map common ingredients to likely compounds before DB lookups
      const BRIDGE = {
        garlic: ["allicin"],
        "olive oil": ["oleocanthal"],
        turmeric: ["curcumin"],
        parmesan: ["histamine"],
        "aged cheese": ["histamine"],
        cream: ["lactose"],
        butter: ["lactose"],
        milk: ["lactose"],
        parsley: ["apigenin"],
        nutmeg: ["myristicin"]
      };
      const seenCompounds = new Set();
      for (const ing of ingredients) {
        const term = (ing?.name || "").toLowerCase().trim();
        if (!term) continue;

        const cRes = await env.D1_DB.prepare(
          `SELECT id, name, common_name, cid
           FROM compounds
           WHERE LOWER(name) LIKE ? OR LOWER(common_name) LIKE ?
           ORDER BY name LIMIT 5`
        )
          .bind(`%${term}%`, `%${term}%`)
          .all();

        const comps = cRes?.results || [];
        for (const c of comps) {
          const eRes = await env.D1_DB.prepare(
            `SELECT organ, effect, strength, notes
             FROM compound_organ_effects
             WHERE compound_id = ?`
          )
            .bind(c.id)
            .all();
          const effs = eRes?.results || [];

          foundCompounds.push({
            name: c.name,
            from_ingredient: ing.name,
            cid: c.cid || null
          });
          for (const e of effs) {
            const k = e.organ || "unknown";
            if (!organMap[k]) organMap[k] = [];
            organMap[k].push({
              compound: c.name,
              effect: e.effect,
              strength: e.strength,
              notes: e.notes || null
            });
          }
        }
      }

      const organSummary = {};
      for (const [org, list] of Object.entries(organMap)) {
        let plus = 0,
          minus = 0,
          neutral = 0;
        for (const row of list) {
          if (row.effect === "benefit") plus++;
          else if (row.effect === "risk") minus++;
          else neutral++;
        }
        organSummary[org] = { plus, minus, neutral };
      }

      rc.molecular = {
        compounds: foundCompounds,
        organs: organMap,
        organ_summary: organSummary
      };
    } else {
      rc.molecular = {
        compounds: [],
        organs: {},
        organ_summary: {},
        gated: true
      };
    }

    // attach dish nutrition to the card
    if (!out?.nutrition_summary && Array.isArray(out?.ingredients_parsed)) {
      out.nutrition_summary = sumNutrition(out.ingredients_parsed);
    }
    rc.nutrition_summary = out?.nutrition_summary || null;
    if (rc.nutrition_summary) {
      rc.nutrition_badges = [
        `${Math.round(rc.nutrition_summary.energyKcal)} kcal`,
        `${Math.round(rc.nutrition_summary.protein_g)} g protein`,
        `${Math.round(rc.nutrition_summary.fat_g)} g fat`,
        `${Math.round(rc.nutrition_summary.carbs_g)} g carbs`,
        `${Math.round(rc.nutrition_summary.sodium_mg)} mg sodium`
      ];
    }

    return new Response(JSON.stringify(rc, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*"
      }
    });
  }
  // ==================================================================

  if (out) {
    if (!out.provider && out.cache) out.provider = "cache";
    if (!out.provider && !out.cache) out.provider = "unknown";
  }

  if (wantShape === "insights_feed") {
    if (!out?.nutrition_summary && Array.isArray(out?.ingredients_parsed)) {
      out.nutrition_summary = sumNutrition(out.ingredients_parsed);
    }
    if (out?.nutrition_summary) {
      out.nutrition_badges = [
        `${Math.round(out.nutrition_summary.energyKcal)} kcal`,
        `${Math.round(out.nutrition_summary.protein_g)} g protein`,
        `${Math.round(out.nutrition_summary.fat_g)} g fat`,
        `${Math.round(out.nutrition_summary.carbs_g)} g carbs`
      ];
    }
  }

  return new Response(JSON.stringify(out), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}

// ========== Uber Eats (RapidAPI) — Address + GPS job/search, retries & polling ==========
async function fetchMenuFromUberEats(
  env,
  query,
  address = "Miami, FL, USA",
  maxRows = 15,
  lat = null,
  lng = null,
  radius = 5000
) {
  const rapidKey = env.RAPIDAPI_KEY;
  const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const base = `https://${host}`;

  async function postJob() {
    const url = `${base}/api/job`;
    const body = {
      scraper: { maxRows, query, address, locale: "en-US", page: 1 }
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": rapidKey,
        "X-RapidAPI-Host": host,
        Accept: "application/json",
        "User-Agent": "TummyBuddyWorker/1.0"
      },
      body: JSON.stringify(body)
    });
    return res;
  }

  async function postJobByLocation() {
    const url = `${base}/api/job/location`;
    const body = {
      scraper: {
        maxRows,
        query,
        locale: "en-US",
        page: 1,
        location:
          lat != null && lng != null ? { latitude: lat, longitude: lng } : null,
        radius
      }
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": rapidKey,
        "X-RapidAPI-Host": host,
        Accept: "application/json",
        "User-Agent": "TummyBuddyWorker/1.0"
      },
      body: JSON.stringify(body)
    });
    return res;
  }

  async function getById(id) {
    const url = `${base}/api/job/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": rapidKey,
        "X-RapidAPI-Host": host,
        Accept: "application/json",
        "User-Agent": "TummyBuddyWorker/1.0"
      }
    });
    return res;
  }

  // 1) create job once
  const create = await postJob();
  const created = await create.json();
  const jobId =
    created?.data?.jobId || created?.jobId || created?.id || created?.data?.id;
  if (!jobId) throw new Error("UberEats: no jobId returned");

  // 2) poll job until results
  let tries = 0,
    resultsPayload = null;
  while (tries++ < 10) {
    const res = await fetch(`${base}/api/job/${jobId}`, {
      headers: {
        "X-RapidAPI-Key": rapidKey,
        "X-RapidAPI-Host": host,
        Accept: "application/json",
        "User-Agent": "TummyBuddyWorker/1.0"
      }
    });
    const j = await res.json().catch(() => ({}));
    const results =
      j?.data?.results || j?.results || j?.data?.data?.results || [];
    if (Array.isArray(results) && results.length) {
      resultsPayload = j;
      break;
    }
    await sleep(800 * tries); // backoff
  }

  if (!resultsPayload)
    throw new Error("UberEats: job finished with no results");
  let parsed = resultsPayload; // keep using `parsed` below

  const hasCandidates =
    (Array.isArray(parsed?.data?.results) && parsed.data.results.length) ||
    (Array.isArray(parsed?.results) && parsed.results.length) ||
    (Array.isArray(parsed?.data?.data?.results) &&
      parsed.data.data.results.length);

  if (!hasCandidates && lat != null && lng != null) {
    const resLoc = await postJobByLocation();
    const ctypeLoc = (resLoc.headers.get("content-type") || "").toLowerCase();
    if (ctypeLoc.includes("application/json")) {
      const locJson = await resLoc.json();
      if (resLoc.ok) parsed = locJson;
    }
  }

  return parsed;
}

// ---- UBER EATS: CREATE A LOCATION-BASED JOB (robust path-fallback) ----
async function postJobByLocation(
  { query, lat, lng, radius = 6000, maxRows = 25 },
  env
) {
  const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const key = env.RAPIDAPI_KEY;
  if (!key) throw new Error("Missing RAPIDAPI_KEY");
  if (!host) throw new Error("Missing UBER_RAPID_HOST");
  if (lat == null || lng == null) throw new Error("Missing lat/lng");

  const candidatePaths = [
    "/api/job/location",
    "/api/jobs/location",
    "/api/location",
    "/api/search/location",
    "/api/job",
    "/location"
  ];

  const body = {
    query: query || "",
    latitude: Number(lat),
    longitude: Number(lng),
    radius: Number(radius),
    max: Number(maxRows) || 25
  };

  async function attemptOnce(url) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-rapidapi-key": key,
        "x-rapidapi-host": host
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    const safeErr = () => {
      if (text && text.startsWith("<"))
        return `UberEats non-JSON response (${res.status}): ${text.slice(0, 120)}...`;
      return `UberEats ${res.status}: ${text}`;
    };
    if (res.status === 429) {
      const retryAfter =
        Number(res.headers.get("retry-after")) ||
        Number(res.headers.get("x-ratelimit-reset")) ||
        0;
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1500;
      await sleep(waitMs);
      throw new Error(
        `RETRYABLE_429:${Math.max(0, Math.floor(waitMs / 1000))}`
      );
    }
    if ([502, 503, 504].includes(res.status)) throw new Error(safeErr());
    if (res.status === 404) throw new Error("HARD_404");
    if (!res.ok) throw new Error(safeErr());
    let js;
    try {
      js = JSON.parse(text);
    } catch {
      throw new Error("UberEats: response was not JSON.");
    }
    return js;
  }

  let lastErr;
  for (const p of candidatePaths) {
    const url = `https://${host}${p}`;
    for (let i = 0; i < 4; i++) {
      try {
        const js = await attemptOnce(url);
        const jobId =
          js?.job_id || js?.id || js?.jobId || js?.data?.job_id || js?.data?.id;
        if (!jobId) return js;
        return { ok: true, job_id: jobId, raw: js, path: p };
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || err);
        if (msg === "HARD_404") break;
        const retryable =
          msg.includes("RETRYABLE_429") || /UberEats (502|503|504)/.test(msg);
        if (!retryable) break;
        const backoff = 400 * (i + 1) + Math.floor(Math.random() * 200);
        await sleep(backoff);
      }
    }
  }
  throw new Error(
    lastErr ? String(lastErr) : "UberEats: no working location endpoint found."
  );
}

// ---- UBER EATS: SEARCH BY GPS (fallback when job/location 404s) ----
async function searchNearbyCandidates(
  { query, lat, lng, radius = 6000, maxRows = 25 },
  env
) {
  const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const key = env.RAPIDAPI_KEY;
  if (!key) throw new Error("Missing RAPIDAPI_KEY");
  if (!host) throw new Error("Missing UBER_RAPID_HOST");
  if (lat == null || lng == null) throw new Error("Missing lat/lng");

  const candidatePaths = [
    "/api/search",
    "/api/restaurants/search",
    "/api/stores/search",
    "/api/search/location",
    "/search"
  ];

  const params = (p) => {
    const u = new URL(`https://${host}${p}`);
    u.searchParams.set("latitude", String(Number(lat)));
    u.searchParams.set("longitude", String(Number(lng)));
    if (query) u.searchParams.set("query", query);
    u.searchParams.set("radius", String(Number(radius)));
    u.searchParams.set("max", String(Number(maxRows) || 25));
    return u.toString();
  };

  async function attemptOnce(url) {
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-rapidapi-key": key, "x-rapidapi-host": host }
    });
    const text = await res.text();
    const safeErr = () => {
      if (text && text.startsWith("<"))
        return `UberEats non-JSON response (${res.status}): ${text.slice(0, 120)}...`;
      return `UberEats ${res.status}: ${text}`;
    };
    if (res.status === 429) {
      const retryAfter =
        Number(res.headers.get("retry-after")) ||
        Number(res.headers.get("x-ratelimit-reset")) ||
        0;
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1200;
      await sleep(waitMs);
      throw new Error(
        `RETRYABLE_429:${Math.max(0, Math.floor(waitMs / 1000))}`
      );
    }
    if (res.status === 404) throw new Error("HARD_404");
    if ([502, 503, 504].includes(res.status)) throw new Error(safeErr());
    if (!res.ok) throw new Error(safeErr());
    let js;
    try {
      js = JSON.parse(text);
    } catch {
      throw new Error("UberEats: response was not JSON.");
    }
    return js;
  }

  for (const p of candidatePaths) {
    const url = params(p);
    for (let i = 0; i < 4; i++) {
      try {
        const data = await attemptOnce(url);
        const arrays = [
          data?.stores,
          data?.restaurants,
          data?.data?.stores,
          data?.data?.restaurants,
          Array.isArray(data) ? data : null
        ].filter(Boolean);

        const flat = [];
        for (const arr of arrays) {
          for (const it of arr) {
            flat.push({
              id:
                it?.id ||
                it?.uuid ||
                it?.storeUuid ||
                it?.storeId ||
                it?.restaurantId ||
                it?.slug ||
                it?.url,
              title:
                it?.title ||
                it?.name ||
                it?.displayName ||
                it?.storeName ||
                it?.restaurantName,
              raw: it
            });
          }
        }

        const seen = new Set();
        const clean = flat
          .filter((x) => x && x.title)
          .filter((x) => {
            const k = (x.title + "|" + (x.id || "")).toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .slice(0, Number(maxRows) || 25);

        return {
          ok: true,
          pathTried: p,
          count: clean.length,
          candidates: clean,
          raw: data
        };
      } catch (err) {
        const msg = String(err?.message || err);
        const retryable =
          msg.includes("RETRYABLE_429") || /UberEats (502|503|504)/.test(msg);
        if (!retryable) break;
        await sleep(400 * (i + 1) + Math.floor(Math.random() * 200));
      }
    }
  }
  return { ok: false, error: "No working GPS search endpoint found." };
}

// ---- UBER EATS: CREATE A JOB BY ADDRESS (exact vendor format) ----
async function postJobByAddress(
  { query, address, maxRows = 15, locale = "en-US", page = 1, webhook = null },
  env
) {
  const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const key = env.RAPIDAPI_KEY || env.RAPID_API_KEY;
  if (!key) throw new Error("Missing RAPIDAPI_KEY");
  if (!host) throw new Error("Missing UBER_RAPID_HOST");
  if (!address) throw new Error("Missing address");

  const url = `https://${host}/api/job`;

  // ✅ Exact body per vendor docs
  const body = {
    scraper: {
      maxRows: Number(maxRows) || 15,
      query: String(query || ""),
      address: String(address),
      locale: String(locale || "en-US"),
      page: Number(page) || 1
    },
    ...(webhook ? { webhook } : {})
  };

  async function attemptOnce() {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-rapidapi-key": key,
        "x-rapidapi-host": host
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    const safeErr = () => {
      if (text && text.startsWith("<"))
        return `UberEats non-JSON response (${res.status}): ${text.slice(0, 120)}...`;
      return `UberEats ${res.status}: ${text}`;
    };

    if (res.status === 429) {
      const retryAfter =
        Number(res.headers.get("retry-after")) ||
        Number(res.headers.get("x-ratelimit-reset")) ||
        0;
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1500;
      await new Promise((r) => setTimeout(r, waitMs));
      throw new Error(
        `RETRYABLE_429:${Math.max(0, Math.floor(waitMs / 1000))}`
      );
    }
    if ([500, 502, 503, 504].includes(res.status)) throw new Error(safeErr());
    if (!res.ok) throw new Error(safeErr());

    let js;
    try {
      js = JSON.parse(text);
    } catch {
      throw new Error("UberEats: response was not JSON.");
    }
    return js; // may contain returnvalue.data OR id/job_id
  }

  for (let i = 0; i < 6; i++) {
    try {
      const js = await attemptOnce();

      const immediateData = js?.returnvalue?.data;
      if (immediateData) return { ok: true, immediate: true, raw: js };

      const jobId = js?.id || js?.job_id || js?.data?.id;
      if (!jobId) return { ok: true, immediate: true, raw: js };
      return { ok: true, job_id: jobId, raw: js };
    } catch (e) {
      const msg = String(e?.message || e);
      const retryable =
        msg.includes("RETRYABLE") || /UberEats (500|502|503|504)/.test(msg);
      if (!retryable) throw e;
      const backoff = 500 * Math.pow(1.8, i) + Math.floor(Math.random() * 300);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw new Error("UberEats: address job failed after retries.");
}

// ---- U.S. helpers (address hinting + result filtering) ----
const US_STATES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
  "PR",
  "GU",
  "VI",
  "AS",
  "MP"
]);
function looksLikeUSAddress(addr) {
  const raw = String(addr || "");
  const s = raw.toLowerCase();
  // crude: contains "usa" / "united states" / ", us" OR uppercase state code
  return /usa|united states|, us\b/.test(s) || /\b[A-Z]{2}\b/.test(raw);
}
function isUSRow(row) {
  const country = (
    row?.location?.country ||
    row?.location?.geo?.country ||
    row?.country ||
    ""
  )
    .toString()
    .toLowerCase();
  const region = (
    row?.location?.region ||
    row?.location?.geo?.region ||
    row?.region ||
    ""
  )
    .toString()
    .toUpperCase();
  const currency = (row?.currencyCode || row?.currency || "")
    .toString()
    .toUpperCase();
  const url = String(row?.url || row?.link || "").toLowerCase();
  if (country === "united states" || country === "us" || country === "usa")
    return true;
  if (US_STATES.has(region)) return true;
  if (currency === "USD") return true;
  if (/\/us\//.test(url)) return true;
  return false;
}
function filterRowsUS(rows, force) {
  if (!Array.isArray(rows)) return [];
  const filtered = rows.filter(isUSRow);
  return force && filtered.length > 0
    ? filtered
    : filtered.length
      ? filtered
      : rows;
}

// ---- UBER EATS: POLL A JOB UNTIL COMPLETED ----
async function pollUberJobUntilDone({ jobId, env, maxTries = 12 }) {
  const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const key = env.RAPIDAPI_KEY;
  if (!key) throw new Error("Missing RAPIDAPI_KEY");
  if (!host) throw new Error("Missing UBER_RAPID_HOST");
  if (!jobId) throw new Error("Missing jobId");

  for (let i = 0; i < maxTries; i++) {
    const res = await fetch(
      `https://${host}/api/job/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-rapidapi-key": key,
          "x-rapidapi-host": host
        }
      }
    );

    const text = await res.text();
    if (!res.ok) {
      if ([429, 500, 502, 503, 504].includes(res.status)) {
        await sleep(500 * (i + 1));
        continue;
      }
      throw new Error(`UberEats ${res.status}: ${text.slice(0, 200)}`);
    }

    let js;
    try {
      js = JSON.parse(text);
    } catch {
      throw new Error("UberEats: poll returned non-JSON");
    }
    if (js?.state === "completed") return js;
    await sleep(600 * (i + 1));
  }
  throw new Error("UberEats: poll timed out before completion.");
}

// ---- POST /api/job exactly like the working debug route ----
async function runAddressJobRaw(
  {
    query = "seafood",
    address = "South Miami, FL, USA",
    maxRows = 3,
    locale = "en-US",
    page = 1
  },
  env
) {
  const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const key = env.RAPIDAPI_KEY || "";
  const body = {
    scraper: {
      maxRows: Number(maxRows) || 3,
      query,
      address,
      locale,
      page: Number(page) || 1
    }
  };

  const res = await fetch(`https://${host}/api/job`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-rapidapi-key": key,
      "x-rapidapi-host": host
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let js;
  try {
    js = JSON.parse(text);
  } catch {
    js = null;
  }
  return { status: res.status, text, json: js };
}

// ---- Choose the single best restaurant match by title similarity ----
function pickBestRestaurant({ rows, query }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const q = (query || "").trim().toLowerCase();

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{N}\s&'-]/gu, "")
      .trim();
  }

  function scoreRow(r) {
    const title = norm(r?.title || r?.name || r?.displayName || r?.storeName);
    if (!q || !title) return 0;
    if (title === norm(q)) return 100;
    if (title.startsWith(norm(q))) return 90;
    if (title.includes(norm(q))) return 80;
    const qtoks = new Set(norm(q).split(" ").filter(Boolean));
    const ttoks = new Set(title.split(" ").filter(Boolean));
    let overlap = 0;
    for (const t of qtoks) if (ttoks.has(t)) overlap++;
    const ratio = overlap / Math.max(1, qtoks.size);
    return Math.round(60 * ratio);
  }

  let best = null;
  for (const r of rows) {
    const s = scoreRow(r);
    if (!best || s > best.score) best = { row: r, score: s };
  }
  return best?.row || null;
}

// [38.6] — explain how we score/choose the best restaurant
function explainRestaurantChoices({ rows, query, limit = 10 }) {
  const q = (query || "").trim().toLowerCase();

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{N}\s&'-]/gu, "")
      .trim();
  }

  function scoreRow(r) {
    const title = norm(
      r?.title || r?.name || r?.displayName || r?.storeName || ""
    );
    const qn = norm(q);
    if (!qn || !title) return { score: 0, kind: "no-query" };
    if (title === qn) return { score: 100, kind: "exact" };
    if (title.startsWith(qn)) return { score: 90, kind: "starts-with" };
    if (title.includes(qn)) return { score: 80, kind: "contains" };
    const qtoks = new Set(qn.split(" ").filter(Boolean));
    const ttoks = new Set(title.split(" ").filter(Boolean));
    let overlap = 0;
    for (const t of qtoks) if (ttoks.has(t)) overlap++;
    const ratio = overlap / Math.max(1, qtoks.size);
    return {
      score: Math.round(60 * ratio),
      kind: "token-overlap",
      overlap,
      denom: qtoks.size
    };
  }

  const explained = (Array.isArray(rows) ? rows : []).map((r) => {
    const s = scoreRow(r);
    return {
      title: r?.title || r?.name || r?.displayName || r?.storeName || "",
      region: r?.region || r?.location?.region || null,
      city: r?.city || r?.location?.city || null,
      url: r?.url || null,
      score: s.score,
      match_kind: s.kind,
      ...(s.overlap != null ? { overlap: s.overlap, tokens: s.denom } : {})
    };
  });

  explained.sort((a, b) => b.score - a.score);
  const top = explained.slice(0, Math.max(1, limit));
  const winner = top[0] || null;
  return { winner, top };
}

// ========== Lexicon & Shards (KV-backed with live fallback) ==========
const INDEX_KV_KEY = "shards/INDEX.json";

const STATIC_INGREDIENT_SHARDS = [
  "en_global_ingredients",
  "en_global_oils_fats",
  "en_global_noodles_pastas",
  "en_global_grains_flours",
  "en_global_bakery_desserts",
  "en_global_condiments",
  "en_global_herbs_spices",
  "en_global_broths_stocks",
  "en_global_batters_breading",
  "en_global_beverages",
  "en_global_cheeses_expanded"
];

async function refreshShardIndex(env) {
  const base = normalizeBase(env.LEXICON_API_URL);
  const key = env.LEXICON_API_KEY;
  if (!base || !key)
    throw new Error("Missing LEXICON_API_URL or LEXICON_API_KEY");

  const candidates = [`${base}/v1/index`, `${base}/v1/shards`];
  let text = null;
  const statusTried = [];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { headers: { "x-api-key": key } });
      statusTried.push({ url, status: r.status });
      if (!r.ok) continue;
      text = await r.text();
      break;
    } catch (e) {
      statusTried.push({ url, status: 0, error: String(e?.message || e) });
    }
  }
  if (!text)
    return {
      ok: false,
      error: "No index endpoint succeeded",
      tried: statusTried
    };

  const js = parseJsonSafe(text, null);
  if (!js)
    return { ok: false, error: "Index JSON invalid", tried: statusTried };

  if (env.LEXICON_CACHE) {
    await env.LEXICON_CACHE.put(INDEX_KV_KEY, text, { expirationTtl: 86400 });
  }
  const size = Array.isArray(js) ? js.length : Object.keys(js).length;
  return { ok: true, tried: statusTried, index_len: size };
}

async function readShardIndexFromKV(env) {
  if (!env.LEXICON_CACHE) return null;
  const raw = await env.LEXICON_CACHE.get(INDEX_KV_KEY);
  if (!raw) return null;
  return parseJsonSafe(raw, null);
}

function pickIngredientShardNamesFromIndex(indexJson) {
  const names = new Set();
  if (Array.isArray(indexJson)) {
    for (const n of indexJson) {
      const s = String(n || "").trim();
      if (s.startsWith("en_global_")) names.add(s);
    }
  } else if (indexJson && typeof indexJson === "object") {
    if (Array.isArray(indexJson.shards)) {
      for (const n of indexJson.shards) {
        const s = String(n || "").trim();
        if (s.startsWith("en_global_")) names.add(s);
      }
    } else {
      for (const k of Object.keys(indexJson)) {
        const s = String(k || "").trim();
        if (s.startsWith("en_global_")) names.add(s);
      }
    }
  }
  if (names.size === 0) for (const s of STATIC_INGREDIENT_SHARDS) names.add(s);
  return Array.from(names);
}

async function loadIngredientShards(env) {
  const used_shards = [];
  const used_shards_meta = {};
  const entriesAll = [];

  const indexJson = await readShardIndexFromKV(env);
  const names = pickIngredientShardNamesFromIndex(indexJson) || [];
  const list = names.length ? names : STATIC_INGREDIENT_SHARDS;

  for (const name of list) {
    let shard = null;
    const key = `shards/${name}.json`;

    if (env.LEXICON_CACHE) {
      try {
        const cached = await env.LEXICON_CACHE.get(key);
        shard = cached ? parseJsonSafe(cached, null) : null;
      } catch {}
    }

    if (!shard) {
      const base = normalizeBase(env.LEXICON_API_URL);
      const apiKey = env.LEXICON_API_KEY;
      if (base && apiKey) {
        try {
          const res = await fetch(`${base}/v1/shards/${name}`, {
            headers: { "x-api-key": apiKey, accept: "application/json" }
          });
          if (res.ok) {
            shard = await res.json();
            if (env.LEXICON_CACHE && shard) {
              try {
                await env.LEXICON_CACHE.put(key, JSON.stringify(shard), {
                  expirationTtl: 86400
                });
              } catch {}
            }
          }
        } catch (err) {
          console.log(
            "[lexicon] shard fetch failed",
            name,
            err?.message || err
          );
        }
      }
    }

    if (shard && Array.isArray(shard.entries)) {
      used_shards.push(name);
      used_shards_meta[name] = {
        version: shard.version ?? null,
        entries_len: shard.entries.length
      };
      for (const e of shard.entries) entriesAll.push(e);
    }
  }

  return { used_shards, used_shards_meta, entriesAll };
}

// ---- MINI FALLBACK TERMS ----
const FALLBACK_INGREDIENTS = [
  { term: "pasta", canonical: "pasta", classes: ["gluten"], tags: ["wheat"] },
  {
    term: "noodles",
    canonical: "noodles",
    classes: ["gluten"],
    tags: ["wheat"]
  },
  {
    term: "flour",
    canonical: "wheat flour",
    classes: ["gluten"],
    tags: ["wheat", "flour"]
  },
  { term: "wheat", canonical: "wheat", classes: ["gluten"], tags: ["wheat"] },
  {
    term: "cream",
    canonical: "cream",
    classes: ["dairy"],
    tags: ["milk", "dairy"]
  },
  {
    term: "butter",
    canonical: "butter",
    classes: ["dairy"],
    tags: ["milk", "dairy"]
  },
  {
    term: "parmesan",
    canonical: "parmesan",
    classes: ["dairy"],
    tags: ["cheese", "milk", "dairy"]
  },
  {
    term: "cheese",
    canonical: "cheese",
    classes: ["dairy"],
    tags: ["milk", "dairy"]
  },
  {
    term: "garlic",
    canonical: "garlic",
    classes: ["allium"],
    tags: ["garlic"]
  },
  { term: "onion", canonical: "onion", classes: ["allium"], tags: ["onion"] }
];

function fallbackEntriesFromText(corpus) {
  const entries = [];
  for (const f of FALLBACK_INGREDIENTS) {
    const t = lc(f.term);
    if (!t) continue;
    if (termMatches(corpus, t)) {
      entries.push({
        term: t,
        canonical: f.canonical,
        classes: f.classes,
        tags: f.tags,
        terms: [t],
        source: "fallback"
      });
    }
  }
  return entries;
}

// --- Tidy helpers ---
function tidyIngredientHits(hits, limit = 25) {
  const byCanon = new Map();
  for (const h of hits) {
    const key = lc(h.canonical || h.term || "");
    if (!key) continue;
    const prev = byCanon.get(key);
    if (!prev || scoreHit(h) > scoreHit(prev)) byCanon.set(key, h);
  }
  const out = Array.from(byCanon.values()).sort((a, b) => {
    const sa = scoreHit(a),
      sb = scoreHit(b);
    if (sb !== sa) return sb - sa;
    const la = (a.term || "").length,
      lb = (b.term || "").length;
    if (lb !== la) return lb - la;
    return (a.canonical || a.term || "").localeCompare(
      b.canonical || b.term || ""
    );
  });
  return out.slice(0, limit);
}

function scoreHit(h) {
  const classes = Array.isArray(h.classes) ? h.classes.map(lc) : [];
  let s = 0;
  if (classes.includes("dairy")) s += 3;
  if (classes.includes("gluten")) s += 3;
  if (classes.includes("allium")) s += 2;
  if (h.source === "kv_multi_shards") s += 0.6;
  if (h.source === "fallback") s += 0.2;
  s += Math.min(2, (h.term || "").length / 10);
  if (typeof h.weight === "number")
    s += Math.max(-1, Math.min(1, h.weight - 0.5));
  return s;
}

// ========== Queue Consumer + HTTP Router ==========
const _worker_impl = {
  // ---- Queue consumer: pulls messages from tb-dish-analysis-queue ----
  async queue(batch, env, ctx) {
    console.log("[QUEUE] handler enter", {
      batchSize: (batch && batch.messages && batch.messages.length) || 0
    });
    for (const msg of batch.messages) {
      let id = null;
      try {
        const job =
          typeof msg.body === "string" ? JSON.parse(msg.body) : msg.body;
        const body = (job && job.body) || job || {};
        const {
          kind,
          user_id,
          dish,
          dish_name,
          ingredients,
          organ_levels,
          organ_top_drivers,
          tummy_barometer,
          calories_kcal = null,
          created_at
        } = body;
        // --- Minimal meal_log handler: write to D1 and ACK ---
        if (kind === "meal_log") {
          try {
            const dishName = dish || dish_name || job?.dish_name || "unknown";
            const userId = user_id || job?.user_id || "UNKNOWN_USER";
            const createdAt =
              created_at || job?.created_at || new Date().toISOString();
            const calories = job?.calories_kcal ?? calories_kcal ?? null;

            const organLevelsObj =
              organ_levels ||
              body?.organ_levels ||
              (body?.organs_summary && body.organs_summary.levels) ||
              (job?.organs_summary && job.organs_summary.levels) ||
              {};
            const topDriversObj =
              organ_top_drivers ||
              body?.organ_top_drivers ||
              (body?.organs_summary && body.organs_summary.top_drivers) ||
              (job?.organs_summary && job.organs_summary.top_drivers) ||
              {};
            const tummyBarometer =
              tummy_barometer ||
              body?.tummy_barometer ||
              job?.tummy_barometer ||
              barometerFromOrgans(organLevelsObj);

            const ingredientList =
              ingredients || body?.ingredients || job?.ingredients || [];
            const ingredientsJson = JSON.stringify(ingredientList);
            const organLevelsJson = JSON.stringify(organLevelsObj);
            const topDriversJson = JSON.stringify(topDriversObj);
            console.log("[QUEUE] meal_log preview:", {
              has_levels: !!Object.keys(organLevelsObj).length,
              has_top: !!Object.keys(topDriversObj).length
            });
            console.log("[CONSUMER] calories_kcal =", calories);

            if (!env.D1_DB) throw new Error("D1_DB not bound");

            await env.D1_DB.prepare(
              `INSERT INTO user_meal_logs
       (user_id, dish, ingredients_json, organ_levels_json, top_drivers_json, calories_kcal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
              .bind(
                userId,
                dishName,
                ingredientsJson,
                organLevelsJson,
                topDriversJson,
                calories,
                createdAt
              )
              .run();
            await recordMetric(env, "d1:user_meal_logs:insert_ok");

            console.log("[QUEUE] meal_log wrote to D1:", {
              dish,
              userId,
              createdAt
            });
            msg.ack();
            continue;
          } catch (e) {
            await recordMetric(env, "d1:user_meal_logs:insert_fail");
            console.error("[QUEUE] meal_log failed:", e);
            msg.retry();
            continue;
          }
        }
        // 47.1: Skip if result already exists in R2
        const dummyUrl = new URL("https://dummy.local/cache-check");
        if (job?.force_reanalyze)
          dummyUrl.searchParams.set("force_reanalyze", "1");
        const cachedResult = await maybeReturnCachedResult(
          new Request(dummyUrl.toString()),
          env,
          {
            place_id: job?.place_id,
            title: job?.dish_name
          }
        );
        if (cachedResult) {
          console.log("[QUEUE] skip existing results in R2");
          msg.ack();
          continue;
        }

        id = job?.id || crypto.randomUUID();
        const key = `jobs/${id}.json`;

        console.log("[QUEUE] received:", { id, dish: job?.dish_name });

        // Load shards (venue + ingredients)
        const venueShard = await getShardFromKV(env, "venue_mitigations");
        const { used_shards, used_shards_meta, entriesAll } =
          await loadIngredientShards(env);
        if (venueShard.ok) {
          used_shards.push("venue_mitigations");
          used_shards_meta["venue_mitigations"] = {
            version: venueShard.version ?? null,
            entries_len: venueShard.entries.length
          };
        }

        // Build text corpus
        const dishName = lc(job?.dish_name);
        const dishDesc = lc(job?.dish_desc || job?.dish_description || "");
        const cuisine = lc(job?.cuisine || "");
        const ingNames = Array.isArray(job?.ingredients)
          ? job.ingredients
              .map((i) => i?.name || "")
              .filter(Boolean)
              .join(" ")
          : "";
        const corpus = [dishName, dishDesc, cuisine, lc(ingNames)]
          .filter(Boolean)
          .join(" ");

        // Ingredient matching from KV shards
        const ingredient_hits_raw = [];
        const seenCanon = new Set();
        if (entriesAll.length > 0) {
          const stoplist = new Set([
            "and",
            "with",
            "of",
            "in",
            "a",
            "the",
            "or"
          ]);
          for (const entry of entriesAll) {
            const canonical = lc(
              entry?.canonical ?? entry?.name ?? entry?.term ?? ""
            );
            const classes = Array.isArray(entry?.classes)
              ? entry.classes.map(lc)
              : [];
            const tags = Array.isArray(entry?.tags) ? entry.tags.map(lc) : [];
            const weight =
              typeof entry?.weight === "number" ? entry.weight : undefined;

            const terms = entryTerms(entry).filter((t) => !stoplist.has(t));
            let matchedTerm = null;
            for (const t of terms) {
              if (t.length < 2) continue;
              if (termMatches(corpus, t)) {
                matchedTerm = t;
                break;
              }
            }
            if (!matchedTerm) continue;

            const canonKey = canonical || matchedTerm;
            if (seenCanon.has(canonKey)) continue;
            seenCanon.add(canonKey);

            ingredient_hits_raw.push({
              term: matchedTerm,
              canonical: canonical || matchedTerm,
              classes,
              tags,
              weight,
              allergens: Array.isArray(entry?.allergens)
                ? entry.allergens
                : undefined,
              fodmap: entry?.fodmap ?? entry?.fodmap_level,
              source: "kv_multi_shards"
            });
          }
        }

        // Fallback preview/application when shards are skinny
        const FALLBACK_TRIGGER = getEnvInt(env, "FALLBACK_TRIGGER_UNDER", 50);
        const fallback_debug = fallbackEntriesFromText(corpus);
        let ingredient_hits = ingredient_hits_raw.slice();
        if (entriesAll.length < FALLBACK_TRIGGER) {
          for (const fh of fallback_debug) ingredient_hits.push(fh);
        }

        // Tidy (dedupe + prioritize + top N)
        const HITS_LIMIT = getEnvInt(env, "HITS_LIMIT", 25);
        ingredient_hits = tidyIngredientHits(ingredient_hits, HITS_LIMIT);

        // ---- Primary brain: Lexicon API (always runs first) ----
        let lexiconResult = null;
        try {
          lexiconResult = await callLexicon(
            env,
            `${job?.dish_name ?? ""} ${job?.dish_desc ?? ""}`,
            "en"
          );
          console.log("[LEXICON] success");
        } catch (e) {
          lexiconResult = {
            error: `Lexicon failed: ${e?.message || String(e)}`
          };
          console.log("[LEXICON] error:", e?.message || e);
        }

        // Prefer Lexicon hits if present; else local ingredient_hits.
        let resolvedHits = [];
        if (lexiconResult?.ok && Array.isArray(lexiconResult?.data?.hits)) {
          resolvedHits = lexiconResult.data.hits.map((h) => ({
            term: h.term,
            canonical: h.canonical,
            classes: Array.isArray(h.classes) ? h.classes : [],
            tags: Array.isArray(h.tags) ? h.tags : [],
            allergens: Array.isArray(h.allergens) ? h.allergens : undefined,
            fodmap: h.fodmap ?? h.fodmap_level
          }));
        } else {
          resolvedHits = (ingredient_hits || []).map((h) => ({
            term: h.term,
            canonical: h.canonical,
            classes: Array.isArray(h.classes) ? h.classes : [],
            tags: Array.isArray(h.tags) ? h.tags : [],
            allergens: Array.isArray(h.allergens) ? h.allergens : undefined,
            fodmap: h.fodmap ?? h.fodmap_level
          }));
        }

        const scoring = scoreDishFromHits(resolvedHits);

        const legacyFlags = deriveFlags(ingredient_hits);
        const tb_score = scoring.tummy_barometer;
        const flags = {
          ...legacyFlags,
          allergens: scoring.flags.allergens,
          fodmap: scoring.flags.fodmap
        };
        const sentences = buildHumanSentences(flags, tb_score);

        // ---- Secondary (fallback) call: RapidAPI mirror (simple counter) ----
        let rapidResult = null;
        try {
          rapidResult = await callRapid(
            env,
            job?.dish_name ?? "",
            job?.address || ""
          );
          console.log("[RAPID] success");
        } catch (e) {
          rapidResult = {
            error: `RapidAPI failed: ${e?.message || String(e)}`
          };
          console.log("[RAPID] error:", e?.message || e);
        }

        // Stats (best-effort)
        try {
          await bumpDaily(env, { jobs: 1 });
          if (lexiconResult?.ok) {
            const isLive = lexiconResult?.mode === "live_shards";
            await bumpDaily(env, {
              lex_ok: isLive ? 0 : 1,
              lex_live: isLive ? 1 : 0
            });
            await bumpApi(env, "lexicon", { calls: 1, ok: 1 });
          } else {
            await bumpDaily(env, { lex_err: 1 });
            await bumpApi(env, "lexicon", { calls: 1, err: 1 });
          }
          if (rapidResult && !rapidResult.error) {
            await bumpDaily(env, { rap_ok: 1 });
            await bumpApi(env, "rapid", { calls: 1, ok: 1 });
          } else {
            await bumpDaily(env, { rap_err: 1 });
            await bumpApi(env, "rapid", { calls: 1, err: 1 });
          }
        } catch (e) {
          console.log(
            "[STATS] bump error (non-fatal):",
            e?.message || String(e)
          );
        }

        // Persist record to R2
        if (env.R2_BUCKET) {
          const lean = {
            id,
            receivedAt: Date.now(),
            job,
            dish_name: job?.dish_name ?? null,
            dish_desc: job?.dish_desc ?? job?.dish_description ?? null,
            cuisine: job?.cuisine ?? null,
            used_shards,
            used_shards_meta,
            entries_all_len: entriesAll.length,
            corpus,
            fallback_terms_preview: fallback_debug.map((h) => h.term),
            ingredient_hits: (ingredient_hits || []).map((h) => ({
              term: h.term,
              canonical: h.canonical,
              classes: h.classes,
              tags: h.tags,
              allergens: h.allergens,
              fodmap: h.fodmap,
              source: h.source
            })),
            flags,
            tummy_barometer: tb_score,
            sentences,
            rapidResult
          };

          const resultsKey = `results/${id}.json`;
          await env.R2_BUCKET.put(resultsKey, JSON.stringify(lean, null, 2), {
            httpMetadata: { contentType: "application/json" }
          });
        }

        // KV bookmarks
        if (env.LEXICON_CACHE) {
          await env.LEXICON_CACHE.put("last_job_id", id, {
            expirationTtl: 3600
          });
          await env.LEXICON_CACHE.put("last_job_ts", String(Date.now()), {
            expirationTtl: 3600
          });
        }

        // D1 log
        if (env.D1_DB) {
          try {
            await env.D1_DB.prepare(
              "INSERT INTO logs (kind, ref, created_at) VALUES (?, ?, ?)"
            )
              .bind("dish_job", key, Date.now())
              .run();
            await recordMetric(env, "d1:logs:insert_ok");
          } catch (e2) {
            await recordMetric(env, "d1:logs:insert_fail");
            console.log(
              "[QUEUE] D1 log error (non-fatal):",
              e2?.message || String(e2)
            );
          }
        }

        console.log("[QUEUE] done:", { id, dish: job?.dish_name });
        msg.ack();
      } catch (e3) {
        console.log("[QUEUE] error:", { id, error: e3?.message || String(e3) });
        msg.retry();
      }
    }
  },

  // ---- HTTP routes (health + debug + enqueue + results + uber-test) ----
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = normPathname(url);
    const searchParams = url.searchParams;

    if (!(pathname === "/healthz" && request.method === "GET")) {
      const limited = await rateLimit(env, request, { limit: 60 });
      if (limited) return limited;
    }

    if (pathname === "/healthz" && request.method === "GET") {
      return handleHealthz(env);
    }

    if (pathname === "/organs/from-dish" && request.method === "GET") {
      return handleOrgansFromDish(url, env, request);
    }
    if (pathname === "/organs/list" && request.method === "GET") {
      const ORGANS = await getOrgans(env);
      return json({ ok: true, organs: ORGANS });
    }
    if (pathname === "/debug/echo") {
      return handleDebugEcho(url, request);
    }
    if (pathname === "/debug/edamam-recipe") {
      const dish = (url.searchParams.get("dish") || "Chicken Alfredo").trim();
      const debugUser =
        (url.searchParams.get("user_id") || "").trim() || "anon";
      const edamam =
        typeof callEdamamRecipe === "function"
          ? await callEdamamRecipe(dish, env, { user_id: debugUser })
          : { error: "callEdamamRecipe not available" };
      return okJson({ dish, edamam });
    }
    if (pathname === "/debug/edamam-nutrition" && request.method === "POST") {
      const body = await readJsonSafe(request);
      const edamam =
        typeof callEdamamNutritionAnalyze === "function"
          ? await callEdamamNutritionAnalyze(
              {
                title: body?.title || "Recipe",
                ingr: Array.isArray(body?.lines) ? body.lines : []
              },
              env
            )
          : { error: "callEdamamNutritionAnalyze not available" };
      return okJson(edamam);
    }
    if (pathname === "/user/meals/recent") {
      const userId = url.searchParams.get("user_id");
      const limit = Math.max(
        1,
        Math.min(50, Number(url.searchParams.get("limit") || 20))
      );
      if (!userId)
        return okJson({ ok: false, error: "user_id is required" }, 400);
      if (!env.D1_DB)
        return okJson({ ok: false, error: "D1_DB not bound" }, 500);

      const ORGANS = await getOrgans(env);

      const { results } = await env.D1_DB.prepare(
        `SELECT id, user_id, dish,
            ingredients_json,
            organ_levels_json,
            top_drivers_json,
            calories_kcal,
            created_at
     FROM user_meal_logs
     WHERE user_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`
      )
        .bind(userId, limit)
        .all();

      const levelToBar = (s) =>
        ({
          "High Benefit": 80,
          Benefit: 40,
          Neutral: 0,
          Caution: -40,
          "High Caution": -80
        })[s] ?? 0;
      const levelToColor = (s) =>
        ({
          "High Benefit": "#16a34a",
          Benefit: "#22c55e",
          Neutral: "#a1a1aa",
          Caution: "#f59e0b",
          "High Caution": "#dc2626"
        })[s] ?? "#a1a1aa";
      const barometerToColor = (n) =>
        n >= 40
          ? "#16a34a"
          : n > 0
            ? "#22c55e"
            : n === 0
              ? "#a1a1aa"
              : n <= -40
                ? "#dc2626"
                : "#f59e0b";
      const titleFor = (key) => {
        if (!key) return "";
        const nice = key.replace(/_/g, " ");
        return nice.charAt(0).toUpperCase() + nice.slice(1);
      };
      const items = [];
      for (const row of results || []) {
        const organ_levels = safeJson(row.organ_levels_json, {});
        const top_drivers = safeJson(row.top_drivers_json, {});
        const organ_bars = Object.fromEntries(
          Object.entries(organ_levels).map(([k, v]) => [k, levelToBar(v)])
        );
        const organ_colors = Object.fromEntries(
          Object.entries(organ_levels).map(([k, v]) => [k, levelToColor(v)])
        );
        const tummy = computeBarometerFromLevelsAll(ORGANS, organ_levels);
        const barometer_color = barometerToColor(tummy);
        const insight_lines = ORGANS.map((key) => {
          if (!organ_levels[key]) return null;
          const drivers = Array.isArray(top_drivers[key])
            ? top_drivers[key]
            : [];
          if (!drivers.length) return null;
          return `${titleFor(key)}: ${drivers.join(", ")}`;
        })
          .filter(Boolean)
          .slice(0, 3);
        const dish_summary = `${
          tummy >= 60 ? "🟢" : tummy >= 40 ? "🟡" : "🟠"
        } ${insight_lines[0] || "See details"}`;
        const item = {
          id: row.id,
          user_id: row.user_id,
          dish: row.dish,
          ingredients: safeJson(row.ingredients_json, []),
          organ_levels,
          organ_bars,
          organ_colors,
          top_drivers,
          calories_kcal: row.calories_kcal ?? null,
          tummy_barometer: tummy,
          barometer_color,
          created_at: row.created_at
        };
        item.insight_lines = insight_lines;
        item.dish_summary = dish_summary;
        items.push(item);
      }
      return json({ ok: true, count: items.length, items });
    }
    if (pathname === "/debug/nutrition") {
      const test = await callEdamamNutritionAnalyze(
        { title: "Test", ingr: ["1 cup milk"] },
        env
      );
      return okJson({
        ok: true,
        reason: test?.reason,
        calories: test?.calories ?? test?.nutrition?.calories ?? null,
        has_ingredients: Array.isArray(test?.ingredients)
          ? test.ingredients.length
          : 0
      });
    }

    // Enqueue (producer)
    if (request.method === "POST" && pathname === "/enqueue") {
      const body = await request.json().catch(() => ({}));
      const id = body?.id || crypto.randomUUID();
      body.id = id;

      if (!env.ANALYSIS_QUEUE)
        return jsonResponse(
          { ok: false, error: "ANALYSIS_QUEUE not bound" },
          500
        );
      await env.ANALYSIS_QUEUE.send(body);
      return jsonResponse({ ok: true, id });
    }

    if (pathname === "/health") {
      const version = getVersion(env);
      return new Response(JSON.stringify({ ok: true, version }), {
        headers: { "content-type": "application/json" }
      });
    }

    if (pathname === "/debug/vision") {
      return handleDebugVision(request, env);
    }

    if (pathname === "/debug/fetch-bytes") {
      return handleDebugFetchBytes(request);
    }

    if (pathname === "/metrics") {
      if (!env.D1_DB) {
        return json({ ok: false, error: "D1_DB not bound" }, { status: 500 });
      }
      const ready = await ensureMetricsTable(env);
      if (!ready) {
        return json(
          { ok: false, error: "metrics_table_unavailable" },
          { status: 500 }
        );
      }
      const totals = await env.D1_DB.prepare(
        "SELECT name, SUM(value) AS total FROM metrics GROUP BY name ORDER BY name"
      ).all();
      const recent = await env.D1_DB.prepare(
        "SELECT ts, name, value FROM metrics ORDER BY ts DESC LIMIT 50"
      ).all();
      return json({
        ok: true,
        totals: totals?.results || [],
        recent: recent?.results || []
      });
    }

    if (pathname === "/meta") {
      const ctx = {
        served_at: new Date().toISOString(),
        version: getVersion(env)
      };
      const bootAt = await ensureBootTime(env);
      const uptime_seconds = bootAt
        ? Math.max(0, Math.floor((Date.now() - Date.parse(bootAt)) / 1000))
        : null;

      const body = {
        ok: true,
        version: ctx.version,
        served_at: ctx.served_at,
        uptime_seconds,
        bindings: {
          r2: !!env.R2_BUCKET,
          kv: !!env.LEXICON_CACHE,
          d1: !!env.D1_DB,
          queue: !!env.ANALYSIS_QUEUE,
          rapidapi_host: !!env.RAPIDAPI_HOST || !!env.UBER_RAPID_HOST,
          rapidapi_key: !!env.RAPIDAPI_KEY,
          lexicon_api_url: !!env.LEXICON_API_URL,
          lexicon_api_key: !!env.LEXICON_API_KEY
        }
      };

      const rid = newRequestId();
      return jsonResponseWithTB(
        withBodyAnalytics(body, ctx, rid, { endpoint: "meta" }),
        200,
        { ctx, rid, source: "meta", cache: "" }
      );
    }

    if (pathname === "/debug/status") {
      const ctx = {
        served_at: new Date().toISOString(),
        version: getVersion(env)
      };
      const status = (await readStatusKV(env)) || {
        updated_at: null,
        counts: {}
      };
      const rid = newRequestId();
      const body = withBodyAnalytics({ ok: true, status }, ctx, rid, {
        endpoint: "debug-status"
      });
      return jsonResponseWithTB(body, 200, {
        ctx,
        rid,
        source: "debug-status"
      });
    }

    if (pathname === "/debug/ping") {
      const version = getVersion(env);
      return new Response(
        JSON.stringify({
          ok: true,
          version,
          bindings: {
            r2: !!env.R2_BUCKET,
            kv: !!env.LEXICON_CACHE,
            d1: !!env.D1_DB,
            RAPIDAPI_HOST: !!env.RAPIDAPI_HOST,
            RAPIDAPI_KEY: !!env.RAPIDAPI_KEY,
            LEXICON_API_URL: !!env.LEXICON_API_URL,
            LEXICON_API_KEY: !!env.LEXICON_API_KEY
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (pathname === "/debug/env") {
      return json({
        ZESTFUL_DAILY_CAP: env.ZESTFUL_DAILY_CAP || null,
        PROVIDERS_RECIPE: env.PROVIDERS_RECIPE || null,
        PROVIDERS_PARSE: env.PROVIDERS_PARSE || null,
        USDA_FDC_HOST: env.USDA_FDC_HOST || null,
        has_SPOONACULAR_API_KEY: !!env.SPOONACULAR_API_KEY,
        has_EDAMAM_KEYS: !!env.EDAMAM_APP_ID && !!env.EDAMAM_APP_KEY,
        has_ZESTFUL_KEY: !!env.ZESTFUL_RAPID_KEY,
        has_FDC_KEY: !!env.USDA_FDC_API_KEY
      });
    }

    if (pathname === "/debug/fdc") {
      const name = url.searchParams.get("name") || "";
      if (!name)
        return json({ ok: false, error: "MISSING_NAME" }, { status: 400 });
      const hit = await callUSDAFDC(env, name);
      return json({ ok: !!hit, name, hit });
    }

    if (pathname === "/debug/fdc-cache") {
      if (!env?.R2_BUCKET)
        return json(
          { ok: false, error: "R2_BUCKET not bound" },
          { status: 400 }
        );
      const u = new URL(request.url);
      const name = (u.searchParams.get("name") || "").trim();
      const prefix = (u.searchParams.get("prefix") || "nutrition/").trim();
      const limit = Math.min(
        parseInt(u.searchParams.get("limit") || "50", 10),
        200
      );

      if (name) {
        const key = `nutrition/${normKey(name)}.json`;
        const head = await r2Head(env, key);
        if (!head) return json({ ok: true, cached: false, key, data: null });
        const obj = await env.R2_BUCKET.get(key);
        const data = obj ? await obj.json().catch(() => null) : null;
        return json({ ok: true, cached: !!data, key, data });
      }

      const listing = await env.R2_BUCKET.list({ prefix, limit });
      return json({
        ok: true,
        prefix,
        limit,
        count: listing.objects?.length || 0,
        objects: (listing.objects || []).map((o) => ({
          key: o.key,
          size: o.size,
          uploaded: o.uploaded || null
        }))
      });
    }

    if (pathname === "/debug/off") {
      const u = new URL(request.url);
      const name = (u.searchParams.get("name") || "").trim();
      if (!name)
        return json({ ok: false, error: "missing name" }, { status: 400 });
      const hit = await callOFF(env, name);
      return json({ ok: true, name, hit });
    }

    if (pathname === "/debug/last") {
      const id = env.LEXICON_CACHE
        ? await env.LEXICON_CACHE.get("last_job_id")
        : null;
      const ts = env.LEXICON_CACHE
        ? await env.LEXICON_CACHE.get("last_job_ts")
        : null;
      return jsonResponse({ ok: true, last_job_id: id, last_job_ts: ts });
    }

    if (pathname === "/debug/job") {
      const id = searchParams.get("id");
      if (!id) return jsonResponse({ ok: false, error: "missing id" }, 400);
      if (!env.R2_BUCKET)
        return jsonResponse({ ok: false, error: "R2 not bound" }, 500);

      const keyNew = `jobs/${id}.json`;
      const keyOld = `results/${id}.json`;
      let obj = await env.R2_BUCKET.get(keyNew);
      let keyUsed = keyNew;
      if (!obj) {
        obj = await env.R2_BUCKET.get(keyOld);
        keyUsed = keyOld;
      }
      if (!obj)
        return jsonResponse(
          { ok: false, error: "not_found", key: keyNew },
          404
        );
      const body = await obj.text();
      return jsonResponse({ ok: true, key: keyUsed, data: JSON.parse(body) });
    }

    if (pathname === "/debug/config") {
      const rapidHost = cleanHost(env.RAPIDAPI_HOST);
      const lexBase = normalizeBase(env.LEXICON_API_URL);
      const builtLexURL = buildLexiconAnalyzeURL(lexBase);
      return jsonResponse({
        ok: true,
        rapidapi_host_preview: rapidHost || null,
        lexicon_url_preview: lexBase || null,
        lexicon_analyze_url_built: builtLexURL || null,
        has_kv: !!env.LEXICON_CACHE,
        has_queue: !!env.ANALYSIS_QUEUE,
        has_d1: !!env.D1_DB,
        has_r2: !!env.R2_BUCKET
      });
    }

    if (pathname === "/debug/llm-config") {
      return jsonResponse({
        ok: true,
        grok: {
          has_url: !!(env.GROK_API_URL || "").trim(),
          has_key: !!(env.GROK_API_KEY || env.Tummy_Buddy_Grok || "").trim()
        },
        openai: {
          has_key: !!(env.OPENAI_API_KEY || "").trim(),
          base: env.OPENAI_API_BASE || "https://api.openai.com"
        }
      });
    }

    if (pathname === "/debug/ping-lexicon") {
      const lexBase = normalizeBase(env.LEXICON_API_URL);
      const urlToCall = buildLexiconAnalyzeURL(lexBase);
      const key = env.LEXICON_API_KEY;
      if (!lexBase || !key)
        return jsonResponse(
          { ok: false, error: "Missing LEXICON_API_URL or LEXICON_API_KEY" },
          400
        );

      const tryXKey = await fetch(urlToCall, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "Accept-Language": "en"
        },
        body: JSON.stringify({
          text: "test chicken with rice",
          lang: "en",
          normalize: { diacritics: "fold" }
        })
      }).catch((e) => ({ ok: false, status: 0, _err: e?.message }));
      const tryBearer = await fetch(urlToCall, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "Accept-Language": "en"
        },
        body: JSON.stringify({
          text: "test chicken with rice",
          lang: "en",
          normalize: { diacritics: "fold" }
        })
      }).catch((e) => ({ ok: false, status: 0, _err: e?.message }));

      let bodyX = "";
      try {
        bodyX = typeof tryXKey.text === "function" ? await tryXKey.text() : "";
      } catch {}
      let bodyB = "";
      try {
        bodyB =
          typeof tryBearer.text === "function" ? await tryBearer.text() : "";
      } catch {}

      return jsonResponse({
        ok: (tryXKey?.ok || tryBearer?.ok) ?? false,
        url_called: urlToCall,
        used_env_LEXICON_API_URL: env.LEXICON_API_URL || null,
        results: {
          x_api_key: {
            ok: !!tryXKey?.ok,
            status: tryXKey?.status ?? 0,
            preview: (bodyX || "").slice(0, 200)
          },
          bearer: {
            ok: !!tryBearer?.ok,
            status: tryBearer?.status ?? 0,
            preview: (bodyB || "").slice(0, 200)
          }
        }
      });
    }

    if (pathname === "/debug/read-kv-shard") {
      const name = (searchParams.get("name") || "").trim();
      if (!name) return jsonResponse({ ok: false, error: "missing name" }, 400);
      if (!env.LEXICON_CACHE)
        return jsonResponse({ ok: false, error: "KV not bound" }, 500);

      const key = `shards/${name}.json`;
      const raw = await env.LEXICON_CACHE.get(key);
      if (!raw)
        return jsonResponse({ ok: false, error: "not_in_kv", key }, 404);

      let js;
      try {
        js = JSON.parse(raw);
      } catch {
        return jsonResponse({ ok: false, error: "bad_json" }, 500);
      }

      const total = Array.isArray(js?.entries) ? js.entries.length : 0;
      const sample = Array.isArray(js?.entries) ? js.entries.slice(0, 25) : [];
      return jsonResponse({
        ok: true,
        name,
        version: js?.version ?? null,
        entries_len: total,
        sample_count: sample.length,
        sample_terms: sample.map((e) => ({
          canonical: e?.canonical ?? e?.name ?? e?.term ?? null,
          term: e?.term ?? null,
          terms: Array.isArray(e?.terms) ? e.terms.slice(0, 5) : null,
          synonyms: Array.isArray(e?.synonyms) ? e.synonyms.slice(0, 5) : null,
          classes: e?.classes ?? null,
          tags: e?.tags ?? null
        }))
      });
    }

    if (pathname === "/debug/warm-lexicon") {
      const list = lc(searchParams.get("names") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!list.length)
        return jsonResponse({ ok: false, error: "missing names" }, 400);

      const base = normalizeBase(env.LEXICON_API_URL);
      const key = env.LEXICON_API_KEY;
      if (!base || !key)
        return jsonResponse(
          { ok: false, error: "Missing LEXICON_API_URL or LEXICON_API_KEY" },
          400
        );

      const out = [];
      for (const name of list) {
        const url = `${base}/v1/shards/${name}`;
        try {
          const r = await fetch(url, { headers: { "x-api-key": key } });
          if (!r.ok) {
            out.push({ shard: name, url, status: r.status, ok: false });
            continue;
          }
          const text = await r.text();
          const js = parseJsonSafe(text, null);
          const entries_len = Array.isArray(js?.entries)
            ? js.entries.length
            : 0;
          if (env.LEXICON_CACHE) {
            await env.LEXICON_CACHE.put(`shards/${name}.json`, text, {
              expirationTtl: 86400
            });
          }
          out.push({
            shard: name,
            url,
            status: 200,
            ok: true,
            entries_len,
            version: js?.version ?? null
          });
        } catch (e) {
          out.push({
            shard: name,
            url,
            status: 0,
            ok: false,
            error: e?.message || String(e)
          });
        }
      }
      return jsonResponse({ ok: true, warmed: out });
    }

    if (pathname === "/debug/refresh-ingredient-shards") {
      try {
        const idx = await refreshShardIndex(env);
        const indexFromKV = await readShardIndexFromKV(env);
        const names = indexFromKV
          ? pickIngredientShardNamesFromIndex(indexFromKV)
          : STATIC_INGREDIENT_SHARDS;

        const base = normalizeBase(env.LEXICON_API_URL);
        const key = env.LEXICON_API_KEY;
        if (!base || !key)
          return jsonResponse(
            { ok: false, error: "Missing LEXICON_API_URL or LEXICON_API_KEY" },
            400
          );

        const warmed = [];
        for (const name of names) {
          const url = `${base}/v1/shards/${name}`;
          try {
            const r = await fetch(url, { headers: { "x-api-key": key } });
            if (!r.ok) {
              warmed.push({ shard: name, url, status: r.status, ok: false });
              continue;
            }
            const text = await r.text();
            const js = parseJsonSafe(text, null);
            const entries_len = Array.isArray(js?.entries)
              ? js.entries.length
              : 0;
            if (env.LEXICON_CACHE) {
              await env.LEXICON_CACHE.put(`shards/${name}.json`, text, {
                expirationTtl: 86400
              });
            }
            warmed.push({
              shard: name,
              url,
              status: 200,
              ok: true,
              entries_len,
              version: js?.version ?? null
            });
          } catch (e) {
            warmed.push({
              shard: name,
              url,
              status: 0,
              ok: false,
              error: e?.message || String(e)
            });
          }
        }

        return jsonResponse({
          ok: true,
          index_refresh: idx,
          warmed_count: warmed.length,
          warmed
        });
      } catch (e) {
        return jsonResponse({ ok: false, error: e?.message || String(e) }, 500);
      }
    }

    // --- Public lean results with CORS: GET /results/<id>.json (+ preflight) ---
    if (pathname.startsWith("/results/")) {
      const CORS = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      };
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers: CORS });

      if (request.method === "GET") {
        if (!env.R2_BUCKET) {
          return new Response(
            JSON.stringify({ ok: false, error: "R2 not bound" }),
            {
              status: 500,
              headers: { ...CORS, "content-type": "application/json" }
            }
          );
        }
        const parts = pathname.split("/");
        const file = parts[parts.length - 1] || "";
        const id = file.endsWith(".json") ? file.slice(0, -5) : file;
        const key = `results/${id}.json`;
        const obj = await env.R2_BUCKET.get(key);
        if (!obj) {
          return new Response(
            JSON.stringify({ ok: false, error: "not_found", key }),
            {
              status: 404,
              headers: { ...CORS, "content-type": "application/json" }
            }
          );
        }
        const body = await obj.text();
        let payload = null;
        try {
          payload = JSON.parse(body);
        } catch {}

        if (payload) {
          const userId = (url.searchParams.get("user_id") || "").trim();
          const rawPrefs = await loadUserPrefs(env, userId);
          const safePrefs =
            rawPrefs && typeof rawPrefs === "object"
              ? rawPrefs
              : { allergens: [], fodmap: {} };
          const pills = derivePillsForUser(payload.ingredient_hits, safePrefs);
          payload.pills_user = pills;
          if (payload.dish && typeof payload.dish === "object") {
            payload.dish.pills_user = pills;
          }
          payload.user_prefs = safePrefs;
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: {
              ...CORS,
              "content-type": "application/json",
              "cache-control": "public, max-age=30"
            }
          });
        }

        return new Response(body, {
          status: 200,
          headers: {
            ...CORS,
            "content-type": "application/json",
            "cache-control": "public, max-age=30"
          }
        });
      }
    }

    // --- DEBUG: RapidAPI health check ---
    if (pathname === "/debug/rapid") {
      const host =
        env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
      const key = env.RAPIDAPI_KEY || "";
      let status = 0,
        text = "",
        probe;

      async function tryPath(p) {
        const res = await fetch(`https://${host}${p}`, {
          headers: {
            "x-rapidapi-key": key,
            "x-rapidapi-host": host,
            accept: "application/json"
          }
        });
        return { status: res.status, text: await res.text(), path: p };
      }

      try {
        probe = await tryPath("/health");
        if (probe.status === 404) probe = await tryPath("/health/public");
        status = probe.status;
        text = probe.text;
      } catch (e) {
        text = String(e);
      }

      return new Response(
        JSON.stringify(
          {
            ok: status >= 200 && status < 400,
            used_host: host,
            has_key: !!key,
            upstream_path: probe?.path || null,
            upstream_status: status,
            upstream_text: text.slice(0, 400)
          },
          null,
          2
        ),
        { headers: { "content-type": "application/json" } }
      );
    }

    // --- DEBUG: direct RapidAPI POST to /api/job ---
    if (pathname === "/debug/rapid-job") {
      const host =
        env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
      const key = env.RAPIDAPI_KEY || "";

      const q = searchParams.get("query") || "seafood";
      const addr = searchParams.get("address") || "South Miami, FL, USA";
      const max = Number(searchParams.get("maxRows") || 3);
      const locale = searchParams.get("locale") || "en-US";
      const page = Number(searchParams.get("page") || 1);

      const body = {
        scraper: { maxRows: max, query: q, address: addr, locale, page }
      };

      let status = 0,
        text = "",
        js = null;
      try {
        const res = await fetch(`https://${host}/api/job`, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-rapidapi-key": key,
            "x-rapidapi-host": host
          },
          body: JSON.stringify(body)
        });
        status = res.status;
        text = await res.text();
        try {
          js = JSON.parse(text);
        } catch {}
      } catch (e) {
        text = String(e);
      }

      return new Response(
        JSON.stringify(
          {
            used_host: host,
            has_key: !!key,
            sent_body: body,
            upstream_status: status,
            upstream_json: js ?? null,
            upstream_text_sample: text.slice(0, 400)
          },
          null,
          2
        ),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (pathname === "/debug/r2-list") {
      const prefix = searchParams.get("prefix") || "";
      const limit = Number(searchParams.get("limit") || "25");
      const cursor = searchParams.get("cursor") || undefined;

      const listing = await env.R2_BUCKET.list({ prefix, limit, cursor });

      return jsonResponse({
        ok: true,
        prefix,
        limit,
        truncated: listing.truncated,
        cursor: listing.truncated ? listing.cursor : null,
        objects: listing.objects.map((o) => ({
          key: o.key,
          size: o.size,
          uploaded: o.uploaded ? new Date(o.uploaded).toISOString() : null
        }))
      });
    }

    if (pathname === "/debug/r2-get") {
      const key = searchParams.get("key");
      if (!key) return jsonResponse({ ok: false, error: "missing ?key=" }, 400);

      const obj = await env.R2_BUCKET.get(key);
      if (!obj)
        return jsonResponse({ ok: false, error: "not_found", key }, 404);

      const text = await obj.text();
      try {
        return jsonResponse({ ok: true, key, json: JSON.parse(text) });
      } catch {
        return new Response(text, {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }

    if (pathname === "/menu/extract")
      return handleMenuExtract(env, request, url, ctx);
    if (pathname === "/recipe/resolve")
      return handleRecipeResolve(env, request, url, ctx);

    // Cleaner Uber Eats test endpoint (returns flattened items)
    if (pathname === "/menu/uber-test" && request.method === "GET") {
      let ctx = makeCtx(env);
      let rid = newRequestId();
      let trace = {}; // ensure 'trace' exists immediately
      try {
        const query = searchParams.get("query") || "";
        const addressRaw = searchParams.get("address") || "";
        const locale = searchParams.get("locale") || "en-US";
        const page = Number(searchParams.get("page") || 1);
        const maxRows = parseInt(searchParams.get("maxRows") || "15", 10);
        const lat = searchParams.get("lat");
        const lng = searchParams.get("lng");
        const radius = parseInt(searchParams.get("radius") || "5000", 10);
        const latNum = lat !== null ? parseFloat(lat) : null;
        const lngNum = lng !== null ? parseFloat(lng) : null;
        const debug = searchParams.get("debug");
        const forceUSFlag =
          searchParams.get("us") === "1" || looksLikeUSAddress(addressRaw);
        // [41.2] — analytics context + ids + trace
        trace = makeTrace("uber-test", searchParams, env);
        // --- make warning + respondTB available BEFORE any early returns (like debug=limits)
        let _warnMsg = null;
        function setWarn(msg) {
          if (!msg) return;
          _warnMsg = _warnMsg ? `${_warnMsg} ${msg}` : String(msg);
        }
        const warnPart = () => (_warnMsg ? { warning: _warnMsg } : {});
        function respondTB(body, status = 200, opts = {}, extraHeaders = {}) {
          // body should already be run through withBodyAnalytics(...) before calling here
          const source = body?.source || opts.source || "";
          const cache = body?.cache || opts.cache || "";
          const warning = Boolean(body?.warning || opts.warning);
          return jsonResponseWithTB(
            body,
            status,
            { ctx, rid, source, cache, warning },
            extraHeaders
          );
        }
        trace.host =
          trace.host ||
          env.UBER_RAPID_HOST ||
          "uber-eats-scraper-api.p.rapidapi.com"; // [38.9]

        // [40.3] — local rate-limit simulation
        if (searchParams.get("debug") === "ratelimit") {
          const secs = Number(searchParams.get("after") || 42);
          trace.used_path = "debug-ratelimit";
          return rateLimitResponse(ctx, rid, trace, secs, "debug-ratelimit");
        }
        // [39.1a] Early validation: require ?query for address/GPS search
        if (!isNonEmptyString(query)) {
          await bumpStatusKV(env, { errors_4xx: 1 });
          return errorResponseWith(
            {
              ok: false,
              error: 'Missing "query" (restaurant name).',
              hint: "Example: /menu/uber-test?query=McDonald%27s&address=Miami,%20FL",
              examples: [
                "/menu/uber-test?query=McDonald%27s&address=Miami,%20FL",
                "/menu/uber-test?query=Starbucks&address=Seattle,%20WA",
                "/menu/uber-test?query=Chipotle&address=Austin,%20TX"
              ]
            },
            400,
            ctx,
            {
              "X-TB-Source": "input-missing",
              trace: safeTrace(trace)
            },
            rid
          );
        }
        if ((lat && !lng) || (!lat && lng)) {
          await bumpStatusKV(env, { errors_4xx: 1 });
          return errorResponseWith(
            {
              ok: false,
              error: 'GPS search needs both "lat" and "lng".',
              hint: "Example: /menu/uber-test?query=Pizza&lat=25.7617&lng=-80.1918&radius=5000&maxRows=10",
              examples: [
                "/menu/uber-test?query=McDonald%27s&address=Miami,%20FL",
                "/menu/uber-test?query=Pizza&lat=25.7617&lng=-80.1918&radius=5000&maxRows=10"
              ]
            },
            400,
            ctx,
            {
              "X-TB-Source": "input-missing",
              trace: safeTrace(trace)
            },
            rid
          );
        }
        // [38.8] — quick QA view of effective limits
        if (debug === "limits") {
          const snap = limitsSnapshot({ maxRows, radius });
          await bumpStatusKV(env, { debug: 1 });
          return respondTB(
            withBodyAnalytics(
              {
                ok: true,
                source: "debug-limits",
                query,
                address: addressRaw,
                limits: snap
              },
              ctx,
              rid,
              trace
            ),
            200
          );
        }
        // [38.3] — warning collector (already defined above; kept for clarity)

        // --- Menu cache lookup ---
        const cacheKey = cacheKeyForMenu(query, addressRaw, !!forceUSFlag);
        const wantDebugCache = debug === "cache";
        let cacheStatus = "miss";
        let cached = null;
        let cachedItems = null;
        let cacheAgeSec = null;
        try {
          cached = await readMenuFromCache(env, cacheKey);
          // [38.7] compute cache age (seconds)
          cacheAgeSec = null;
          if (cached?.savedAt) {
            cacheAgeSec = Math.max(
              0,
              Math.floor((Date.now() - Date.parse(cached.savedAt)) / 1000)
            );
          }
          // [38.3] age warning for cached data (>20h considered stale-ish)
          if (cached?.savedAt) {
            const ageSec = Math.max(
              0,
              (Date.now() - Date.parse(cached.savedAt)) / 1000
            );
            if (ageSec > 20 * 3600)
              setWarn("Cached data is older than ~20 hours (may be stale).");
          }
          // Allow inspecting the cached payload directly
          if (wantDebugCache) {
            return respondTB(
              withBodyAnalytics(
                {
                  ok: true,
                  source: "cache",
                  cache: cached ? "hit" : "miss",
                  cache_age_seconds: cacheAgeSec,
                  ...cached,
                  ...warnPart()
                },
                ctx,
                rid,
                trace
              ),
              200
            );
          }

          // If cache has usable items, hydrate them as a fast-path
          if (cached?.data) {
            cachedItems = Array.isArray(cached.data.items)
              ? cached.data.items
              : null;
            if (cachedItems) cacheStatus = "hit";

            // Hydrate a local flattenedItems from cache so the same enqueue logic can use it
            if (cachedItems) {
              const flattenedItems = cachedItems;
              // If the caller requested analysis, run the enqueue block against flattenedItems
              // (this mirrors the enqueue behavior used for live fetches).
              const wantAnalyze = searchParams.get("analyze") === "1";
              let enqueued = [];
              if (flattenedItems && wantAnalyze) {
                const top = filterAndRankItems(
                  flattenedItems,
                  searchParams,
                  env
                );
                const place_id =
                  searchParams.get("place_id") || "place.unknown";
                const cuisine = searchParams.get("cuisine") || "";
                ({ enqueued } = await enqueueTopItems(env, top, {
                  place_id,
                  cuisine,
                  query,
                  address: addressRaw,
                  forceUS: !!forceUSFlag
                }));
              }

              // If analyze was requested we consumed the cache and can return it with enqueued[]
              if (flattenedItems && wantAnalyze) {
                const address = addressRaw;
                const forceUS = !!forceUSFlag;
                trace.used_path = "/api/job"; // [38.9]
                await bumpStatusKV(env, { cache: 1 });
                return respondTB(
                  withBodyAnalytics(
                    {
                      ok: true,
                      source: "cache",
                      cache: cacheStatus,
                      cache_age_seconds: cacheAgeSec,
                      data: {
                        query,
                        address,
                        forceUS,
                        items: flattenedItems.slice(0, maxRows)
                      },
                      enqueued,
                      ...warnPart()
                    },
                    ctx,
                    rid,
                    trace
                  ),
                  200
                );
              }
            }
          }
        } catch (e) {
          // ignore cache errors and proceed to live
        }

        // Address-based job path
        if (addressRaw) {
          // US hint: append ", USA" once if forcing US but address lacks it
          let address = addressRaw;
          if (forceUSFlag && !/usa|united states/i.test(address))
            address = `${addressRaw}, USA`;

          const job = await postJobByAddress(
            { query, address, maxRows, locale, page },
            env
          );

          // Immediate data
          if (job?.immediate) {
            let rows = job.raw?.returnvalue?.data || [];
            const rowsUS = filterRowsUS(rows, forceUSFlag);
            const titles = rowsUS.map((r) => r?.title).filter(Boolean);

            if (debug === "titles") {
              return respondTB(
                withBodyAnalytics(
                  {
                    ok: true,
                    source: "address-immediate",
                    count: titles.length,
                    titles,
                    ...warnPart()
                  },
                  ctx,
                  rid,
                  trace
                ),
                200
              );
            }

            // [38.11b] debug=1 preview for address-immediate
            if (debug === "1") {
              trace.used_path = "/api/job";
              await bumpStatusKV(env, { debug: 1 });
              const preview = buildDebugPreview(
                job?.raw || {},
                env,
                rowsUS,
                titles
              );
              return respondTB(
                withBodyAnalytics(preview, ctx, rid, trace),
                200
              );
            }

            const best = pickBestRestaurant({ rows: rowsUS, query });
            const chosen =
              best ||
              (Array.isArray(rowsUS) && rowsUS.length ? rowsUS[0] : null);
            if (debug === "why") {
              const exp = explainRestaurantChoices({
                rows: rowsUS,
                query,
                limit: 10
              });
              await bumpStatusKV(env, { debug: 1 });
              return respondTB(
                withBodyAnalytics(
                  {
                    ok: true,
                    source: "debug-why-immediate",
                    explain: exp,
                    query,
                    address: addressRaw,
                    ...warnPart()
                  },
                  ctx,
                  rid,
                  trace
                ),
                200
              );
            }
            if (!chosen) {
              await bumpStatusKV(env, { errors_4xx: 1 });
              return notFoundCandidates(ctx, rid, trace, {
                query,
                address: addressRaw
              });
            }

            const fake = { data: { results: [chosen] } };
            const flattenedItems = extractMenuItemsFromUber(fake, query);

            // Optional: enqueue for analysis when requested
            const analyze = searchParams.get("analyze") === "1";
            let enqueued = [];
            if (
              analyze &&
              Array.isArray(flattenedItems) &&
              flattenedItems.length
            ) {
              const top = filterAndRankItems(flattenedItems, searchParams, env);
              const place_id = searchParams.get("place_id") || "place.unknown";
              const cuisine = searchParams.get("cuisine") || "";
              ({ enqueued } = await enqueueTopItems(env, top, {
                place_id,
                cuisine,
                query,
                address: addressRaw,
                forceUS: !!forceUSFlag
              }));
            }

            // 2) Write to cache (best-effort)
            try {
              await writeMenuToCache(env, cacheKey, {
                query,
                address: addressRaw,
                forceUS: !!forceUSFlag,
                items: flattenedItems
              });
              cacheStatus = "stored";
            } catch (e) {
              cacheStatus = "store-failed";
              setWarn("Could not store fresh cache (non-fatal).");
            }

            // 3) Respond (include enqueued[] when present)
            trace.used_path = "/api/job"; // [38.9]
            await bumpStatusKV(env, { address_immediate: 1 });
            return respondTB(
              withBodyAnalytics(
                {
                  ok: true,
                  source: "address-immediate",
                  cache: cacheStatus,
                  data: {
                    query,
                    address: addressRaw,
                    forceUS: !!forceUSFlag,
                    items: flattenedItems.slice(0, maxRows)
                  },
                  enqueued,
                  ...warnPart()
                },
                ctx,
                rid,
                trace
              ),
              200
            );
          }

          // Poll by job id
          const jobId = job?.job_id;
          if (!jobId) {
            await bumpStatusKV(env, { errors_5xx: 1 });
            return errorResponseWith(
              {
                ok: false,
                error:
                  "Upstream didn’t return a job_id for the address search.",
                hint: "Please try again in a moment. If this keeps happening, try a nearby ZIP code.",
                raw: job
              },
              502,
              ctx,
              {
                "X-TB-Source": "job-missing-id",
                "X-TB-Upstream-Status": "502",
                trace: safeTrace(trace)
              },
              rid
            );
          }

          const finished = await pollUberJobUntilDone({ jobId, env });

          let rows =
            finished?.returnvalue?.data ||
            finished?.data?.data ||
            finished?.data ||
            [];
          const rowsUS = filterRowsUS(rows, forceUSFlag);

          const best = pickBestRestaurant({ rows: rowsUS, query });
          const chosen =
            best || (Array.isArray(rowsUS) && rowsUS.length ? rowsUS[0] : null);
          if (debug === "why") {
            const exp = explainRestaurantChoices({
              rows: rowsUS,
              query,
              limit: 10
            });
            await bumpStatusKV(env, { debug: 1 });
            return respondTB(
              withBodyAnalytics(
                {
                  ok: true,
                  source: "debug-why-job",
                  explain: exp,
                  query,
                  address: addressRaw,
                  ...warnPart()
                },
                ctx,
                rid,
                trace
              ),
              200
            );
          }
          if (!chosen) {
            await bumpStatusKV(env, { errors_4xx: 1 });
            return notFoundCandidates(ctx, rid, trace, {
              query,
              address: addressRaw
            });
          }

          if (debug === "titles") {
            const titles = (Array.isArray(rowsUS) ? rowsUS : [])
              .map((r) => r?.title)
              .filter(Boolean);
            return respondTB(
              withBodyAnalytics(
                {
                  ok: true,
                  source: "address-job",
                  picked: chosen?.title || null,
                  count: titles.length,
                  titles,
                  ...warnPart()
                },
                ctx,
                rid,
                trace
              ),
              200
            );
          }

          // [38.11b] debug=1 preview for address-job
          if (debug === "1") {
            trace.used_path = "/api/job";
            const titles = (Array.isArray(rowsUS) ? rowsUS : [])
              .map((r) => r?.title)
              .filter(Boolean);
            await bumpStatusKV(env, { debug: 1 });
            const preview = buildDebugPreview(
              finished || {},
              env,
              rowsUS,
              titles
            );
            return respondTB(withBodyAnalytics(preview, ctx, rid, trace), 200);
          }

          const fake = { data: { results: [chosen] } };
          const flattenedItems = extractMenuItemsFromUber(fake, query);

          // Optional analyze enqueue
          const analyze = searchParams.get("analyze") === "1";
          let enqueued = [];
          if (
            analyze &&
            Array.isArray(flattenedItems) &&
            flattenedItems.length
          ) {
            const top = filterAndRankItems(flattenedItems, searchParams, env);
            const place_id = searchParams.get("place_id") || "place.unknown";
            const cuisine = searchParams.get("cuisine") || "";
            ({ enqueued } = await enqueueTopItems(env, top, {
              place_id,
              cuisine,
              query,
              address: addressRaw,
              forceUS: !!forceUSFlag
            }));
          }

          try {
            await writeMenuToCache(env, cacheKey, {
              query,
              address: addressRaw,
              forceUS: !!forceUSFlag,
              items: flattenedItems
            });
            cacheStatus = "stored";
          } catch (e) {
            cacheStatus = "store-failed";
            setWarn("Could not store fresh cache (non-fatal).");
          }
          trace.used_path = "/api/job"; // [38.9]
          await bumpStatusKV(env, { address_job: 1 });
          return respondTB(
            withBodyAnalytics(
              {
                ok: true,
                source: "address-job",
                cache: cacheStatus,
                data: {
                  query,
                  address: addressRaw,
                  forceUS: !!forceUSFlag,
                  items: flattenedItems.slice(0, maxRows)
                },
                enqueued,
                ...warnPart()
              },
              ctx,
              rid,
              trace
            ),
            200
          );
        }

        // GPS flow
        if (lat && lng) {
          try {
            const jobRes = await postJobByLocation(
              { query, lat: Number(lat), lng: Number(lng), radius, maxRows },
              env
            );
            if (jobRes?.path) trace.used_path = jobRes.path; // [38.9]
            const jobId = jobRes?.job_id || jobRes?.id || jobRes?.jobId;
            if (!jobId) {
              await bumpStatusKV(env, { errors_5xx: 1 });
              return errorResponseWith(
                {
                  ok: false,
                  error:
                    "Upstream didn’t return a job_id for the location search.",
                  hint: "Please try again shortly. If it keeps failing, widen the radius or include a ZIP.",
                  raw: jobRes
                },
                502,
                ctx,
                {
                  "X-TB-Source": "job-missing-id",
                  "X-TB-Upstream-Status": "502",
                  trace: safeTrace(trace)
                },
                rid
              );
            }

            const finished = await pollUberJobUntilDone({ jobId, env });
            const buckets = [
              finished?.data?.stores,
              finished?.data?.restaurants,
              finished?.stores,
              finished?.restaurants,
              finished?.data
            ].filter(Boolean);
            const candidates = [];
            for (const b of buckets)
              if (Array.isArray(b)) candidates.push(...b);
            const titles = candidates
              .map((c) => c?.title || c?.name || c?.storeName || c?.displayName)
              .filter(Boolean);

            if (debug === "titles") {
              return respondTB(
                withBodyAnalytics(
                  {
                    ok: true,
                    source: "location-job",
                    count: titles.length,
                    titles,
                    ...warnPart()
                  },
                  ctx,
                  rid,
                  trace
                ),
                200
              );
            }

            await bumpStatusKV(env, { location_job: 1 });
            return respondTB(
              withBodyAnalytics(
                {
                  ok: true,
                  source: "location-job",
                  candidates: titles.slice(0, maxRows),
                  raw: finished,
                  ...warnPart()
                },
                ctx,
                rid,
                trace
              ),
              200
            );
          } catch (e) {
            const msg = String(e?.message || e);
            if (msg.includes("HARD_404")) {
              const nearby = await searchNearbyCandidates(
                { query, lat: Number(lat), lng: Number(lng), radius, maxRows },
                env
              );
              setWarn(
                "Used GPS search fallback (vendor location job unavailable)."
              );
              trace.used_path = nearby?.pathTried || "gps-search"; // [38.9]
              if (debug === "titles") {
                return respondTB(
                  withBodyAnalytics(
                    {
                      ok: nearby.ok,
                      source: "gps-search",
                      count: nearby?.count || 0,
                      titles: (nearby?.candidates || []).map((c) => c.title),
                      ...warnPart()
                    },
                    ctx,
                    rid,
                    trace
                  ),
                  200
                );
              }
              if (debug === "raw") {
                return respondTB(
                  withBodyAnalytics(
                    {
                      ok: nearby.ok,
                      source: "gps-search",
                      pathTried: nearby?.pathTried,
                      raw: nearby?.raw,
                      ...warnPart()
                    },
                    ctx,
                    rid,
                    trace
                  ),
                  200
                );
              }
              await bumpStatusKV(env, { gps_search: 1 });
              return respondTB(
                withBodyAnalytics(
                  {
                    ok: nearby.ok,
                    source: "gps-search",
                    candidates: nearby?.candidates || [],
                    ...warnPart()
                  },
                  ctx,
                  rid,
                  trace
                ),
                200
              );
            }
            if (/\b429\b/.test(msg)) {
              const mSecs = msg.match(/RETRYABLE_429:(\d+)/);
              const secs = mSecs ? Number(mSecs[1] || 0) : 30;
              await bumpStatusKV(env, { ratelimits_429: 1 });
              return rateLimitResponse(
                ctx,
                rid,
                trace,
                secs > 0 ? secs : 30,
                "upstream-failure"
              );
            }
            await bumpStatusKV(env, { errors_5xx: 1 });
            return errorResponseWith(
              {
                ok: false,
                error: friendlyUpstreamMessage(502),
                upstream_error: msg.slice(0, 300),
                hint: "Please try again shortly."
              },
              502,
              ctx,
              {
                "X-TB-Source": "upstream-failure",
                "X-TB-Upstream-Status": "502",
                trace: safeTrace(trace)
              },
              rid
            );
          }
        }

        if (!query) {
          await bumpStatusKV(env, { errors_4xx: 1 });
          return errorResponseWith(
            {
              ok: false,
              error: 'Missing "query" (restaurant name).',
              hint: "Example: /menu/uber-test?query=McDonald%27s&address=Miami,%20FL",
              examples: [
                "/menu/uber-test?query=McDonald%27s&address=Miami,%20FL",
                "/menu/uber-test?query=Starbucks&address=Seattle,%20WA",
                "/menu/uber-test?query=Chipotle&address=Austin,%20TX"
              ]
            },
            400,
            ctx,
            {
              "X-TB-Source": "input-missing",
              trace: safeTrace(trace)
            },
            rid
          );
        }

        const raw = await fetchMenuFromUberEats(
          env,
          query,
          addressRaw,
          maxRows,
          latNum,
          lngNum,
          radius
        );
        if (searchParams.get("debug") === "1") {
          trace.used_path = trace.used_path || "fetchMenuFromUberEats"; // keep trace detail
          await bumpStatusKV(env, { debug: 1 });
          const preview = buildDebugPreview(raw || {}, env);
          return respondTB(withBodyAnalytics(preview, ctx, rid, trace), 200);
        }

        const usedHost =
          env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
        const flattenedItems = extractMenuItemsFromUber(raw, query);

        if (debug === "rank") {
          const preview = rankTop(flattenedItems, 10).map((x) => ({
            section: x.section,
            name: x.name || x.title,
            price_display: x.price_display || null
          }));
          return respondTB(
            withBodyAnalytics(
              {
                ok: true,
                source: "live",
                cache: cacheStatus,
                preview,
                ...warnPart()
              },
              ctx,
              rid,
              trace
            ),
            200,
            {},
            CORS_ALL
          );
        }

        // Optional analyze enqueue
        const analyze = searchParams.get("analyze") === "1";
        let enqueued = [];
        if (analyze && Array.isArray(flattenedItems) && flattenedItems.length) {
          const top = filterAndRankItems(flattenedItems, searchParams, env);
          const place_id = searchParams.get("place_id") || "place.unknown";
          const cuisine = searchParams.get("cuisine") || "";
          ({ enqueued } = await enqueueTopItems(env, top, {
            place_id,
            cuisine,
            query,
            address: addressRaw,
            forceUS: !!forceUSFlag
          }));
        }

        // store into cache (best-effort)
        try {
          await writeMenuToCache(env, cacheKey, {
            query,
            address: addressRaw,
            forceUS: !!forceUSFlag,
            items: flattenedItems
          });
          cacheStatus = "stored";
        } catch (e) {
          cacheStatus = "store-failed";
          setWarn("Could not store fresh cache (non-fatal).");
        }

        if (!trace.used_path) trace.used_path = "fetchMenuFromUberEats"; // [38.9]
        await bumpStatusKV(env, { live: 1 });
        return respondTB(
          withBodyAnalytics(
            {
              ok: true,
              source: "live",
              cache: cacheStatus,
              data: {
                query,
                address: addressRaw,
                forceUS: !!forceUSFlag,
                maxRows,
                host: usedHost,
                count: flattenedItems.length,
                items: flattenedItems.slice(0, 25)
              },
              enqueued,
              ...warnPart()
            },
            ctx,
            rid,
            trace
          ),
          200,
          {},
          CORS_ALL
        );
      } catch (err) {
        // [40.2] friendlier upstream error with analytics + real Retry-After on 429
        const msg = String(err?.message || err || "");
        const m = msg.match(/\b(429|500|502|503|504)\b/);
        const upstreamStatus = m ? Number(m[1]) : 500;

        // Pull seconds if the message was like "RETRYABLE_429:NN"
        let retrySecs = 0;
        const mSecs = msg.match(/RETRYABLE_429:(\d+)/);
        if (mSecs) retrySecs = Number(mSecs[1] || 0);

        if (upstreamStatus === 429) {
          await bumpStatusKV(env, { ratelimits_429: 1 });
          return rateLimitResponse(
            ctx,
            rid,
            trace,
            retrySecs > 0 ? retrySecs : 30,
            "upstream-failure"
          );
        }

        await bumpStatusKV(env, { errors_5xx: 1 });
        const hint =
          upstreamStatus === 429
            ? "Please retry in ~30–60 seconds."
            : "Please try again shortly.";

        return errorResponseWith(
          {
            ok: false,
            error: friendlyUpstreamMessage(upstreamStatus),
            upstream_error: msg.slice(0, 300),
            hint
          },
          upstreamStatus,
          ctx,
          {
            "X-TB-Source": "upstream-failure",
            "X-TB-Upstream-Status": String(upstreamStatus),
            trace: safeTrace(trace)
          },
          rid
        );
      }
    }

    // Demo examples for clients
    if (pathname === "/menu/search/examples" && request.method === "GET") {
      const examples = [
        "/menu/search?query=McDonald%27s&address=Miami,%20FL&top=10",
        "/menu/search?query=Starbucks&address=Seattle,%20WA&top=8",
        "/menu/search?query=Chipotle&address=Austin,%20TX&skip_drinks=1&top=12",
        "/menu/search?query=Panera&address=Orlando,%20FL&analyze=1&top=15",
        "/menu/search?query=Chick-fil-A&address=Atlanta,%20GA&top=10",
        "/menu/search?query=Shake%20Shack&address=New%20York,%20NY&skip_party=1&top=10"
      ];
      // Reuse ctx for consistent headers
      const ctx = {
        served_at: new Date().toISOString(),
        version: getVersion(env)
      };
      return jsonResponseWith(
        { ok: true, examples, served_at: ctx.served_at, version: ctx.version },
        200,
        {
          "X-TB-Version": String(ctx.version),
          "X-TB-Served-At": String(ctx.served_at)
        }
      );
    }

    // NEW: App-friendly wrapper that internally calls our own handler (no external fetch)
    if (pathname === "/menu/search") {
      const query = (searchParams.get("query") || "").trim();
      const address = (searchParams.get("address") || "").trim();
      const top = searchParams.get("top") || "";
      const analyze = searchParams.get("analyze") || "";
      const place_id = searchParams.get("place_id") || "";
      const skip_drinks = searchParams.get("skip_drinks") || "";
      const skip_party = searchParams.get("skip_party") || "";
      // [41.13] unified ctx/rid helpers
      const ctx = makeCtx(env);
      const request_id = newRequestId();

      function respondTB(body, status = 200, opts = {}, extraHeaders = {}) {
        const source = body?.source || opts.source || "";
        const cache = body?.cache || opts.cache || "";
        const warning = Boolean(body?.warning || opts.warning);
        return jsonResponseWithTB(
          body,
          status,
          { ctx, rid: request_id, source, cache, warning },
          extraHeaders
        );
      }

      // [37B] ── Validate inputs with friendly hints
      if (!isNonEmptyString(query) && !isNonEmptyString(address)) {
        return badRequest(
          'Missing "query" and "address".',
          [
            "Example 1: /menu/search?query=McDonald%27s&address=Miami,%20FL",
            "Example 2: /menu/search?query=Starbucks&address=New%20York,%20NY"
          ].join("\n"),
          ctx,
          null,
          [
            "/menu/search?query=McDonald%27s&address=Miami,%20FL",
            "/menu/search?query=Chipotle&address=Austin,%20TX"
          ]
        );
      }

      if (!isNonEmptyString(query)) {
        return badRequest(
          'Missing "query" (restaurant name).',
          "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL",
          ctx,
          null,
          [
            "/menu/search?query=Starbucks&address=Seattle,%20WA",
            "/menu/search?query=Panera&address=Orlando,%20FL"
          ]
        );
      }

      if (!isNonEmptyString(address)) {
        return badRequest(
          'Missing "address" (city, state).',
          "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL",
          ctx,
          null,
          [
            "/menu/search?query=McDonald%27s&address=Miami,%20FL",
            "/menu/search?query=Chick-fil-A&address=Atlanta,%20GA"
          ]
        );
      }

      // Soft warning if address shape looks unusual
      let inputWarning = null;
      if (!looksLikeCityState(address)) {
        inputWarning =
          'Address looks unusual. Try "City, ST" or "City, ST 12345".';
      }

      // [37B] ── If a ZIP is present but no state code, hard error with a friendly hint
      const hasZip = /\b\d{5}\b/.test(address);
      const hasState = /,\s*[A-Za-z]{2}\b/.test(address);
      if (hasZip && !hasState) {
        return badRequest(
          "Address has a ZIP but no state code (use two-letter state).",
          "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL%2033131",
          ctx,
          null,
          ["/menu/search?query=McDonald%27s&address=Miami,%20FL%2033131"]
        );
      }

      // [37B] ── If state code is lowercase, warn and create a preview with uppercased state
      let address_preview = null;
      if (hasLowercaseState(address)) {
        const fixed = normalizeCityStateAddress(address);
        if (fixed && fixed !== address) {
          address_preview = fixed;
          inputWarning = inputWarning
            ? `${inputWarning} Also, we adjusted the state code to uppercase in address_preview.`
            : 'State code looks lowercase; see "address_preview" for the uppercased version.';
        }
      }

      // [37B] ── Validate optional flags with friendly messages
      if (analyze && !is01(analyze)) {
        return badRequest(
          'Bad "analyze" value. Use 0 or 1.',
          "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL&analyze=1",
          ctx,
          null,
          ["/menu/search?query=McDonald%27s&address=Miami,%20FL&analyze=1"]
        );
      }

      if (skip_drinks && !is01(skip_drinks)) {
        return badRequest(
          'Bad "skip_drinks" value. Use 0 or 1.',
          "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL&skip_drinks=1",
          ctx,
          null,
          ["/menu/search?query=McDonald%27s&address=Miami,%20FL&skip_drinks=1"]
        );
      }

      if (skip_party && !is01(skip_party)) {
        return badRequest(
          'Bad "skip_party" value. Use 0 or 1.',
          "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL&skip_party=1",
          ctx,
          null,
          ["/menu/search?query=McDonald%27s&address=Miami,%20FL&skip_party=1"]
        );
      }

      if (top) {
        if (!isPositiveInt(top)) {
          return badRequest(
            'Bad "top" value. Must be a whole number.',
            "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL&top=25",
            ctx,
            null,
            ["/menu/search?query=McDonald%27s&address=Miami,%20FL&top=5"]
          );
        }
        const n = parseInt(top, 10);
        if (n < 1) {
          return badRequest(
            'Out-of-range "top". Minimum is 1.',
            "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL&top=5",
            ctx,
            null,
            ["/menu/search?query=McDonald%27s&address=Miami,%20FL&top=5"]
          );
        }
        if (n > LIMITS.TOP_MAX) {
          inputWarning = inputWarning
            ? `${inputWarning} "top" was capped at ${LIMITS.TOP_MAX}.`
            : `"top" was capped at ${LIMITS.TOP_MAX}.`;
        }
      }

      // [37B] ── Clamp top within safe range
      const topNum = Math.min(
        LIMITS.TOP_MAX,
        Math.max(LIMITS.TOP_MIN, parseInt(top || LIMITS.DEFAULT_TOP, 10))
      );
      const trace = makeTrace("menu-search", searchParams, env, {
        place_id,
        top: topNum,
        analyze: analyze ? Number(analyze) : 0,
        skip_drinks: skip_drinks ? Number(skip_drinks) : 0,
        skip_party: skip_party ? Number(skip_party) : 0
      });

      // Always force U.S. for this endpoint
      const params = new URLSearchParams({
        query,
        address,
        us: "1"
      });
      params.set("top", String(topNum));
      if (analyze) params.set("analyze", analyze);
      if (place_id) params.set("place_id", place_id);
      if (skip_drinks) params.set("skip_drinks", skip_drinks);
      if (skip_party) params.set("skip_party", skip_party);

      // 🔧 INTERNAL DISPATCH: call our own route directly (no network), avoiding 404s
      const innerReq = new Request(
        new URL(`/menu/uber-test?${params.toString()}`, url),
        {
          method: "GET",
          headers: { accept: "application/json" }
        }
      );
      const innerRes = await _worker_impl.fetch(innerReq, env, ctx);
      if (!innerRes || !innerRes.ok) {
        const status = innerRes?.status ?? 502;

        // Try to parse JSON body; fall back to text
        let upstreamError = null;
        try {
          const raw = await innerRes.text();
          try {
            const parsed = JSON.parse(raw);
            upstreamError = parsed?.error || parsed?.message || raw;
          } catch {
            upstreamError = raw;
          }
        } catch {
          upstreamError = null;
        }

        const msg = friendlyUpstreamMessage(status);
        const hint =
          status === 429
            ? "Please retry in ~30–60 seconds."
            : "Please try again shortly.";

        return errorResponseWith(
          {
            ok: false,
            error: msg,
            status,
            upstream_error: upstreamError
              ? String(upstreamError).slice(0, 300)
              : null,
            hint
          },
          status,
          ctx,
          {
            "X-TB-Source": "inner-failure",
            "X-TB-Upstream-Status": String(status),
            trace: safeTrace(trace)
          },
          request_id
        );
      }

      const data = await innerRes.json();
      if (data?.trace?.host) trace.host = data.trace.host;
      if (data?.trace?.used_path) trace.used_path = data.trace.used_path;

      const items = (data?.data?.items || []).map((it) => ({
        name: it.name || it.title || "",
        section: it.section || "",
        price: typeof it.price === "number" ? it.price : null,
        price_display: it.price_display || null,
        calories_display:
          (it.price_display || "").match(/\b\d+\s*Cal/i)?.[0] || null,
        source: "uber_us"
      }));

      return respondTB(
        withBodyAnalytics(
          {
            ok: true,
            source: String(data.source || "search"),
            cache: String(data.cache || ""),
            query,
            address,
            total: items.length,
            items,
            enqueued: data.enqueued || [],
            ...(inputWarning ? { warning: inputWarning } : {}),
            ...(address_preview ? { address_preview } : {}),
            limits: LIMITS
          },
          ctx,
          request_id,
          trace
        ),
        200
      );
    }

    // --- /molecular/analyze (Phase 1 MVP) ---
    // Usage examples:
    //   /molecular/analyze?ingredient=garlic
    //   /molecular/analyze?compound=curcumin
    if (pathname === "/molecular/analyze") {
      const gate = await requirePremium(env, url);
      if (!gate.ok) {
        return new Response(JSON.stringify(gate.body), {
          status: gate.status,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*"
          }
        });
      }
      try {
        const byIngredient = (url.searchParams.get("ingredient") || "").trim();
        const byCompound = (url.searchParams.get("compound") || "").trim();

        if (!byIngredient && !byCompound) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "Provide ?ingredient= or ?compound=",
              examples: [
                "/molecular/analyze?ingredient=garlic",
                "/molecular/analyze?compound=curcumin"
              ]
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json",
                "access-control-allow-origin": "*"
              }
            }
          );
        }

        // 1) Pick a search term (lowercased)
        const term = (byCompound || byIngredient).toLowerCase();

        // 2) Find matching compounds (name/common_name LIKE)
        const compRes = await env.D1_DB.prepare(
          `SELECT id, name, common_name, formula, cid, description
           FROM compounds
           WHERE LOWER(name) LIKE ? OR LOWER(common_name) LIKE ?
           ORDER BY name LIMIT 10`
        )
          .bind(`%${term}%`, `%${term}%`)
          .all();

        const compounds = compRes?.results || [];

        // 3) Fetch organ effects for those compounds
        let effects = [];
        if (compounds.length) {
          const ids = compounds.map((c) => c.id);
          // Build a simple IN (?, ?, ?) clause
          const qs = ids.map(() => "?").join(", ");
          const effRes = await env.D1_DB.prepare(
            `SELECT e.compound_id, e.organ, e.effect, e.strength, e.notes,
                    c.name AS compound_name, c.common_name, c.cid
             FROM compound_organ_effects e
             JOIN compounds c ON c.id = e.compound_id
             WHERE e.compound_id IN (${qs})
             ORDER BY c.name, e.organ`
          )
            .bind(...ids)
            .all();
          effects = effRes?.results || [];
        }

        // 4) Organize a tiny summary (organs → list of (compound, effect, strength))
        const organs = {};
        for (const row of effects) {
          const key = row.organ || "unknown";
          if (!organs[key]) organs[key] = [];
          organs[key].push({
            compound: row.compound_name,
            common_name: row.common_name,
            cid: row.cid,
            effect: row.effect,
            strength: row.strength,
            notes: row.notes || null
          });
        }

        const body = {
          ok: true,
          query: {
            ingredient: byIngredient || null,
            compound: byCompound || null
          },
          found_compounds: compounds.length,
          compounds,
          organs
        };

        return new Response(JSON.stringify(body, null, 2), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*"
          }
        });
      } catch (e) {
        return new Response(
          JSON.stringify({ ok: false, error: String(e?.message || e) }),
          {
            status: 500,
            headers: {
              "content-type": "application/json",
              "access-control-allow-origin": "*"
            }
          }
        );
      }
    }

    // --- /molecular/map (ingredient -> compounds + organ summary) ---
    // Usage:
    //   /molecular/map?ingredient=garlic
    if (pathname === "/molecular/map") {
      const gate = await requirePremium(env, url);
      if (!gate.ok) {
        return new Response(JSON.stringify(gate.body), {
          status: gate.status,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*"
          }
        });
      }
      try {
        const ingredient = (url.searchParams.get("ingredient") || "")
          .trim()
          .toLowerCase();
        if (!ingredient) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "Provide ?ingredient=",
              example: "/molecular/map?ingredient=garlic"
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json",
                "access-control-allow-origin": "*"
              }
            }
          );
        }

        // Find compounds where name or common_name matches the ingredient term
        const compRes = await env.D1_DB.prepare(
          `SELECT id, name, common_name, formula, cid, description
           FROM compounds
           WHERE LOWER(name) LIKE ? OR LOWER(common_name) LIKE ?
           ORDER BY name LIMIT 15`
        )
          .bind(`%${ingredient}%`, `%${ingredient}%`)
          .all();

        const compounds = compRes?.results || [];
        const ids = compounds.map((c) => c.id);

        // Pull organ effects for those compounds
        let effects = [];
        if (ids.length) {
          const qs = ids.map(() => "?").join(", ");
          const effRes = await env.D1_DB.prepare(
            `SELECT e.compound_id, e.organ, e.effect, e.strength, e.notes,
                    c.name AS compound_name, c.common_name, c.cid
             FROM compound_organ_effects e
             JOIN compounds c ON c.id = e.compound_id
             WHERE e.compound_id IN (${qs})
             ORDER BY c.name, e.organ`
          )
            .bind(...ids)
            .all();
          effects = effRes?.results || [];
        }

        // Build organ -> [effects] map
        const organs = {};
        for (const row of effects) {
          const key = row.organ || "unknown";
          if (!organs[key]) organs[key] = [];
          organs[key].push({
            compound: row.compound_name,
            common_name: row.common_name,
            cid: row.cid,
            effect: row.effect,
            strength: row.strength,
            notes: row.notes || null
          });
        }

        // Tiny “headline” summary for UI: organ -> (+benefit / -risk) counts
        const organSummary = {};
        for (const [org, list] of Object.entries(organs)) {
          let plus = 0,
            minus = 0,
            neutral = 0;
          for (const e of list) {
            if (e.effect === "benefit") plus++;
            else if (e.effect === "risk") minus++;
            else neutral++;
          }
          organSummary[org] = { plus, minus, neutral };
        }

        return new Response(
          JSON.stringify(
            {
              ok: true,
              query: { ingredient },
              found_compounds: compounds.length,
              compounds,
              organs,
              organ_summary: organSummary
            },
            null,
            2
          ),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "access-control-allow-origin": "*"
            }
          }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ ok: false, error: String(e?.message || e) }),
          {
            status: 500,
            headers: {
              "content-type": "application/json",
              "access-control-allow-origin": "*"
            }
          }
        );
      }
    }

    // --- /molecular/compound (get one compound + its organ effects) ---
    // Usage:
    //   /molecular/compound?cid=969516
    //   /molecular/compound?name=curcumin
    if (pathname === "/molecular/compound") {
      const gate = await requirePremium(env, url);
      if (!gate.ok) {
        return new Response(JSON.stringify(gate.body), {
          status: gate.status,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*"
          }
        });
      }
      try {
        const cid = (url.searchParams.get("cid") || "").trim();
        const name = (url.searchParams.get("name") || "").trim().toLowerCase();

        if (!cid && !name) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "Provide ?cid= or ?name=",
              examples: [
                "/molecular/compound?cid=969516",
                "/molecular/compound?name=curcumin"
              ]
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json",
                "access-control-allow-origin": "*"
              }
            }
          );
        }

        // 1) Find the compound (prefer cid if given; else exact name match fallback to LIKE)
        let compRow = null;
        if (cid) {
          const rs = await env.D1_DB.prepare(
            `SELECT id, name, common_name, formula, cid, description
             FROM compounds WHERE cid = ? LIMIT 1`
          )
            .bind(cid)
            .all();
          compRow = rs?.results?.[0] || null;
        }
        if (!compRow && name) {
          const rsExact = await env.D1_DB.prepare(
            `SELECT id, name, common_name, formula, cid, description
             FROM compounds WHERE LOWER(name) = ? LIMIT 1`
          )
            .bind(name)
            .all();
          compRow = rsExact?.results?.[0] || null;

          if (!compRow) {
            const rsLike = await env.D1_DB.prepare(
              `SELECT id, name, common_name, formula, cid, description
               FROM compounds WHERE LOWER(name) LIKE ? OR LOWER(common_name) LIKE ? 
               ORDER BY name LIMIT 1`
            )
              .bind(`%${name}%`, `%${name}%`)
              .all();
            compRow = rsLike?.results?.[0] || null;
          }
        }

        if (!compRow) {
          return new Response(
            JSON.stringify({ ok: false, error: "compound_not_found" }),
            {
              status: 404,
              headers: {
                "content-type": "application/json",
                "access-control-allow-origin": "*"
              }
            }
          );
        }

        // 2) Fetch organ effects for that compound
        const effRes = await env.D1_DB.prepare(
          `SELECT organ, effect, strength, notes
           FROM compound_organ_effects
           WHERE compound_id = ?
           ORDER BY organ`
        )
          .bind(compRow.id)
          .all();

        const effects = effRes?.results || [];

        // 3) Organize a friendly summary counts
        const organ_summary = {};
        for (const e of effects) {
          const k = e.organ || "unknown";
          if (!organ_summary[k])
            organ_summary[k] = { plus: 0, minus: 0, neutral: 0 };
          if (e.effect === "benefit") organ_summary[k].plus++;
          else if (e.effect === "risk") organ_summary[k].minus++;
          else organ_summary[k].neutral++;
        }

        return new Response(
          JSON.stringify(
            {
              ok: true,
              compound: compRow,
              effects,
              organ_summary
            },
            null,
            2
          ),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "access-control-allow-origin": "*"
            }
          }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ ok: false, error: String(e?.message || e) }),
          {
            status: 500,
            headers: {
              "content-type": "application/json",
              "access-control-allow-origin": "*"
            }
          }
        );
      }
    }

    // --- DEBUG: /debug/kv-tier?user_id=...  (reads KV tier directly)
    if (pathname === "/debug/kv-tier") {
      const uid = (url.searchParams.get("user_id") || "").trim();
      if (!uid) {
        return new Response(
          JSON.stringify({ ok: false, error: "missing user_id" }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
              "access-control-allow-origin": "*"
            }
          }
        );
      }
      try {
        const key = `tier/user:${uid}`;
        const val = await (env.LEXICON_CACHE
          ? env.LEXICON_CACHE.get(key)
          : null);
        return new Response(
          JSON.stringify({ ok: true, user_id: uid, key, value: val ?? null }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "access-control-allow-origin": "*"
            }
          }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ ok: false, error: String(e?.message || e) }),
          {
            status: 500,
            headers: {
              "content-type": "application/json",
              "access-control-allow-origin": "*"
            }
          }
        );
      }
    }

    // --- DEBUG: /debug/kv-set?user_id=...&tier=premium  (writes KV from the worker)
    if (pathname === "/debug/kv-set") {
      const uid = (url.searchParams.get("user_id") || "").trim();
      const tier = (url.searchParams.get("tier") || "").trim();
      if (!uid || !tier) {
        return new Response(
          JSON.stringify({ ok: false, error: "missing user_id or tier" }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
              "access-control-allow-origin": "*"
            }
          }
        );
      }
      const key = `tier/user:${uid}`;
      await env.LEXICON_CACHE.put(key, tier);
      return new Response(JSON.stringify({ ok: true, wrote: { key, tier } }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*"
        }
      });
    }

    // --- /schema/examples (returns example payloads the iOS UI can rely on)
    if (pathname === "/schema/examples") {
      const MolecularDrawer = {
        ok: true,
        component: "MolecularDrawer",
        version: "v1",
        dish: {
          id: "dish_abc123",
          place_id: "place.test.001",
          title: "Garlic Shrimp",
          cuisine: "Seafood"
        },
        compounds: [
          { name: "Allicin", common_name: "Garlic active", cid: "65036" },
          { name: "Histamine", common_name: "Biogenic amine", cid: "774" }
        ],
        organs: {
          gut: [
            {
              compound: "Allicin",
              effect: "benefit",
              strength: 3,
              notes: "Traditional GI support"
            },
            {
              compound: "Histamine",
              effect: "risk",
              strength: 3,
              notes: "Sensitivity in aged items"
            }
          ],
          liver: [
            {
              compound: "Curcumin",
              effect: "benefit",
              strength: 2,
              notes: "General antioxidant link"
            }
          ]
        },
        organ_summary: {
          gut: { plus: 1, minus: 1, neutral: 0 },
          liver: { plus: 1, minus: 0, neutral: 0 }
        }
      };

      const RecipeCard = {
        ok: true,
        component: "RecipeCard",
        version: "v1",
        dish: {
          name: "Chicken Alfredo",
          cuisine: "Italian"
        },
        ingredients: [
          { name: "Pasta", qty: 200, unit: "g" },
          { name: "Cream", qty: 1, unit: "cup" },
          { name: "Butter", qty: 2, unit: "tbsp" },
          { name: "Parmesan", qty: 60, unit: "g" },
          { name: "Garlic", qty: 2, unit: "cloves" }
        ],
        recipe: {
          steps: [
            "Boil pasta until al dente.",
            "Melt butter, add cream, simmer gently.",
            "Stir in parmesan until smooth.",
            "Combine pasta with sauce; finish with garlic."
          ],
          notes: ["Salt to taste", "Reserve pasta water to loosen sauce"]
        },
        molecular: {
          compounds: [
            { name: "Allicin", from_ingredient: "Garlic", cid: "65036" },
            { name: "Histamine", from_ingredient: "Parmesan", cid: "774" }
          ],
          organs: {
            gut: [
              {
                compound: "Histamine",
                effect: "risk",
                strength: 3,
                notes: "Biogenic amine in aged cheese"
              }
            ]
          },
          organ_summary: { gut: { plus: 0, minus: 1, neutral: 0 } },
          organ_headlines: ["Gut: ⚠️ Risk"]
        },
        molecular_human: {
          organ_tips: [
            "Gut: may bother sensitive tummies—consider smaller portions or swaps."
          ]
        },
        molecular_badge: "Molecular Insights: 2 compounds • 1 organ"
      };

      const InsightsFeed = {
        ok: true,
        component: "InsightsFeed",
        version: "v1",
        period: { range: "last_7_days" },
        generated_at: new Date().toISOString(),
        items: [
          {
            organ: "heart",
            icon: "❤️",
            headline: "Heart: 👍 Benefit",
            tip: "Generally friendly in normal portions.",
            sentiment: "Supportive"
          },
          {
            organ: "gut",
            icon: "🦠",
            headline: "Gut: ⚠️ Risk",
            tip: "May bother sensitive tummies—consider smaller portions or swaps.",
            sentiment: "Caution"
          }
        ],
        badge: "This week: 2 insights"
      };

      const payload = {
        ok: true,
        schemas: { MolecularDrawer, RecipeCard, InsightsFeed }
      };
      return new Response(JSON.stringify(payload, null, 2), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*"
        }
      });
    }

    if (pathname === "/insights/feed") {
      const gate = await requirePremium(env, url);
      if (!gate.ok) {
        return new Response(JSON.stringify(gate.body), {
          status: gate.status,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*"
          }
        });
      }
      const ORG_ICON = {
        heart: "❤️",
        gut: "🦠",
        liver: "🧪",
        brain: "🧠",
        immune: "🛡️"
      };
      const userId = (url.searchParams.get("user_id") || "").trim();
      const userPrefsRaw = await loadUserPrefs(env, userId);
      const userPrefs =
        userPrefsRaw && typeof userPrefsRaw === "object"
          ? userPrefsRaw
          : { allergens: [], fodmap: {} };

      // === Step 20C: live aggregation from R2 results (sorted newest-first, richer items)
      const liveItems = [];
      let next_cursor = null;
      const limitR2 = Math.max(
        1,
        Math.min(50, parseInt(url.searchParams.get("r2_limit") || "10", 10))
      );
      if (env.R2_BUCKET) {
        const r2Cursor = url.searchParams.get("r2_cursor") || undefined;
        const listing = await env.R2_BUCKET.list({
          prefix: "results/",
          limit: Math.max(limitR2, 25),
          cursor: r2Cursor
        });
        const objs = (listing.objects || [])
          .map((o) => ({
            key: o.key,
            uploaded: o.uploaded ? new Date(o.uploaded).getTime() : 0
          }))
          .sort((a, b) => b.uploaded - a.uploaded)
          .slice(0, limitR2);

        for (const obj of objs) {
          const r = await env.R2_BUCKET.get(obj.key);
          if (!r) continue;
          try {
            const js = JSON.parse(await r.text());
            const out = js;
            const tb = js?.tummy_barometer || {};
            const rawLabel = (tb.label || "Unknown").toLowerCase();

            const sentiment =
              rawLabel === "avoid"
                ? "Avoid"
                : rawLabel === "caution"
                  ? "Caution"
                  : rawLabel === "mixed"
                    ? "Mixed"
                    : rawLabel === "likely ok"
                      ? "Supportive"
                      : "Unknown";

            const icon =
              sentiment === "Avoid"
                ? "⚠️"
                : sentiment === "Caution"
                  ? "⚠️"
                  : sentiment === "Mixed"
                    ? "↔️"
                    : sentiment === "Supportive"
                      ? "❤️"
                      : "🧬";

            const flags = js?.flags || {};
            let organ = "gut";
            if (flags.cardiac_hint) organ = "heart";
            else if (flags.neuro_hint) organ = "brain";
            else if (flags.hepatic_hint) organ = "liver";
            else if (flags.immune_hint) organ = "immune";
            const tip =
              sentiment === "Avoid"
                ? "May bother sensitive tummies—consider smaller portions or swaps."
                : sentiment === "Caution"
                  ? "Moderate risk—portion size matters."
                  : "Generally friendly in normal portions.";

            const details_url = new URL(`/${obj.key}`, url).toString();
            const id = (obj.key || "").replace(/^results\/|\.json$/g, "");

            const feedItem = {
              id,
              organ,
              icon,
              headline: `${tb.label || "Unknown"}: ${js.dish_name || "Unknown Dish"}`,
              tip,
              sentiment,
              result_key: obj.key,
              uploaded_at: new Date(obj.uploaded || Date.now()).toISOString(),
              details_url,
              dish_name: js?.dish_name || "Unknown Dish",
              place_id: js?.place_id || null
            };
            const pills = derivePillsForUser(js?.ingredient_hits, userPrefs);
            feedItem.pills_user = pills;
            if (out?.nutrition_summary) {
              feedItem.nutrition_summary = out.nutrition_summary;
              feedItem.nutrition_badges = [
                `${Math.round(out.nutrition_summary.energyKcal)} kcal`,
                `${Math.round(out.nutrition_summary.protein_g)} g protein`,
                `${Math.round(out.nutrition_summary.fat_g)} g fat`,
                `${Math.round(out.nutrition_summary.carbs_g)} g carbs`
              ];
            }

            liveItems.push(feedItem);
          } catch {
            continue;
          }
        }
        next_cursor = listing.truncated ? listing.cursor : null;
      }

      // De-duplicate by (place_id|dish_name)
      const seen = new Set();
      const liveItemsDedup = [];
      for (const it of liveItems) {
        const key = `${it.place_id || "unknown"}|${(it.dish_name || "").toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        liveItemsDedup.push(it);
      }

      const liveSourceItems = liveItemsDedup.length
        ? liveItemsDedup
        : liveItems;
      const staticItems = [
        {
          organ: "gut",
          icon: ORG_ICON.gut,
          headline: "Gut: ⚠️ Risk",
          tip: "May bother sensitive tummies—consider smaller portions or swaps.",
          sentiment: "Caution"
        }
      ];

      const source = (url.searchParams.get("source") || "auto").toLowerCase();
      const items =
        source === "live"
          ? liveSourceItems
          : source === "static"
            ? staticItems
            : liveSourceItems.length
              ? liveSourceItems
              : staticItems;
      const limit = Math.max(
        1,
        Math.min(10, parseInt(url.searchParams.get("limit") || "5", 10))
      );
      const p = (url.searchParams.get("period") || "").toLowerCase().trim();
      const ALLOWED = new Set(["last_7_days", "last_30_days", "all_time"]);
      const period = ALLOWED.has(p) ? p : "last_7_days";
      const organParam = (url.searchParams.get("organ") || "")
        .toLowerCase()
        .trim();
      const filtered = organParam
        ? items.filter((it) => (it.organ || "").toLowerCase() === organParam)
        : items;
      const ORDER = {
        Supportive: 1,
        Mixed: 2,
        Caution: 3,
        Avoid: 4,
        Unknown: 0
      };
      const minParam = (
        url.searchParams.get("min_sentiment") || ""
      ).toLowerCase();
      const MIN =
        { supportive: 1, mixed: 2, caution: 3, avoid: 4 }[minParam] ?? 0;
      const filteredItems = filtered.filter(
        (it) => (ORDER[it.sentiment] || 0) >= MIN
      );
      const sliced = filteredItems.slice(0, limit);

      const body = {
        ok: true,
        component: "InsightsFeed",
        version: "v1",
        period: { range: period },
        generated_at: new Date().toISOString(),
        items: sliced,
        badge: `This week: ${sliced.length} insights`,
        ...(organParam ? { filter: { organ: organParam } } : {}),
        user_prefs: userPrefs
      };
      body.r2_next_cursor = next_cursor;
      // Quick totals from current items (not full R2 yet)
      const summary_counts = { Supportive: 0, Mixed: 0, Caution: 0, Avoid: 0 };
      for (const it of sliced) {
        if (summary_counts[it.sentiment] != null)
          summary_counts[it.sentiment]++;
      }
      body.summary_counts = summary_counts;
      const humanHeadline =
        period === "last_7_days"
          ? "Your recent wellness snapshot"
          : period === "last_30_days"
            ? "Monthly wellness summary"
            : "All-time molecular insights";
      body.human_headline = humanHeadline;
      return new Response(JSON.stringify(body, null, 2), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*"
        }
      });
    }

    if (pathname === "/insights/debug/r2-list") {
      const gate = await requirePremium(env, url);
      if (!gate.ok) {
        return new Response(JSON.stringify(gate.body), {
          status: gate.status,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*"
          }
        });
      }
      if (!env.R2_BUCKET) {
        return new Response(
          JSON.stringify({ ok: false, error: "R2 not bound" }),
          {
            status: 500,
            headers: { "content-type": "application/json" }
          }
        );
      }

      const limit = Math.max(
        1,
        Math.min(50, parseInt(url.searchParams.get("limit") || "10", 10))
      );
      const prefix = "results/";
      const listing = await env.R2_BUCKET.list({
        prefix,
        limit,
        include: ["httpMetadata"]
      });
      const items = (listing.objects || []).map((o) => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded ? new Date(o.uploaded).toISOString() : null
      }));
      return new Response(
        JSON.stringify({ ok: true, count: items.length, items }, null, 2),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*"
          }
        }
      );
    }

    if (pathname === "/insights/debug/status") {
      const gate = await requirePremium(env, url);
      if (!gate.ok)
        return new Response(JSON.stringify(gate.body), {
          status: gate.status,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*"
          }
        });

      const okR2 = !!env.R2_BUCKET;
      const okD1 = !!env.D1_DB;
      const okKV = !!env.LEXICON_CACHE;
      const modeHint = okR2 ? "live" : "static";

      const body = {
        ok: true,
        version: "v1",
        active_sources: { R2: okR2, D1: okD1, KV: okKV },
        default_mode: modeHint,
        note: okR2
          ? "Live Insights pulling from R2 results."
          : "Static Insights mode (no R2 bucket bound)."
      };
      return new Response(JSON.stringify(body, null, 2), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*"
        }
      });
    }

    if (pathname === "/insights/debug/sample") {
      const gate = await requirePremium(env, url);
      if (!gate.ok) {
        return new Response(JSON.stringify(gate.body), {
          status: gate.status,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*"
          }
        });
      }

      const key =
        url.searchParams.get("key") ||
        "results/0032d323-560f-469f-a496-195812a9efd4.json";
      const obj = await env.R2_BUCKET.get(key);
      if (!obj) {
        return new Response(
          JSON.stringify({ ok: false, error: "not_found", key }),
          {
            status: 404,
            headers: { "content-type": "application/json" }
          }
        );
      }

      const text = await obj.text();
      let js;
      try {
        js = JSON.parse(text);
      } catch {
        js = null;
      }

      // Extract key metrics
      const tb = js?.tummy_barometer || {};
      const flags = js?.flags || {};
      const summary = {
        label: tb.label || "Unknown",
        score: tb.score ?? null,
        fodmap: flags.fodmap || "unknown",
        gluten: !!flags.gluten_hint,
        dairy: !!flags.dairy_hint
      };

      return new Response(
        JSON.stringify(
          { ok: true, key, summary, preview: js?.sentences?.slice(0, 3) || [] },
          null,
          2
        ),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*"
          }
        }
      );
    }

    if (pathname === "/insights/debug/aggregate") {
      const gate = await requirePremium(env, url);
      if (!gate.ok) {
        return new Response(JSON.stringify(gate.body), {
          status: gate.status,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*"
          }
        });
      }
      if (!env.R2_BUCKET) {
        return new Response(
          JSON.stringify({ ok: false, error: "R2 not bound" }),
          {
            status: 500,
            headers: { "content-type": "application/json" }
          }
        );
      }

      const limit = Math.max(
        1,
        Math.min(50, parseInt(url.searchParams.get("limit") || "10", 10))
      );
      const listing = await env.R2_BUCKET.list({ prefix: "results/", limit });
      const counts = {
        Supportive: 0,
        Mixed: 0,
        Caution: 0,
        Avoid: 0,
        Unknown: 0
      };
      const sample = [];
      for (const obj of listing.objects || []) {
        const r = await env.R2_BUCKET.get(obj.key);
        if (!r) continue;
        try {
          const js = JSON.parse(await r.text());
          const label = js?.tummy_barometer?.label || "Unknown";
          counts[label] = (counts[label] || 0) + 1;
          if (sample.length < 5) {
            sample.push({
              key: obj.key,
              label,
              score: js?.tummy_barometer?.score ?? null
            });
          }
        } catch {
          counts.Unknown = (counts.Unknown || 0) + 1;
        }
      }

      return new Response(
        JSON.stringify(
          { ok: true, scanned: (listing.objects || []).length, counts, sample },
          null,
          2
        ),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*"
          }
        }
      );
    }

    // --- DEBUG: probe Spoonacular directly ---
    if (pathname === "/debug/spoonacular") {
      const dish = url.searchParams.get("dish") || "Crunchwrap Supreme";
      try {
        const apiKey = env.SPOONACULAR_API_KEY;
        const endpoint = `https://api.spoonacular.com/recipes/complexSearch?query=${encodeURIComponent(dish)}&number=1&addRecipeInformation=true&apiKey=${encodeURIComponent(apiKey)}`;
        const res = await fetch(endpoint, { headers: { "x-api-key": apiKey } });
        const text = await res.text();
        let jsonOut = null;
        try {
          jsonOut = JSON.parse(text);
        } catch {}
        return json({
          ok: res.ok,
          status: res.status,
          dish,
          provider: "spoonacular",
          title: jsonOut?.results?.[0]?.title || null,
          lines: (jsonOut?.results?.[0]?.extendedIngredients || []).length || 0,
          body_preview: text.slice(0, 180)
        });
      } catch (e) {
        return json({ ok: false, dish, error: String(e?.message || e) });
      }
    }

    // --- DEBUG: probe Zestful by first pulling a recipe then parsing its lines ---
    if (pathname === "/debug/zestful") {
      const dish = url.searchParams.get("dish") || "Chicken Alfredo";
      try {
        const spoon = await spoonacularFetch(env, dish, null, "en");
        const lines = Array.isArray(spoon?.ingredients)
          ? spoon.ingredients
          : [];

        let parsed = null;
        if (lines.length && env.ZESTFUL_RAPID_KEY && env.ZESTFUL_RAPID_HOST) {
          parsed = await callZestful(env, lines);
        }

        return json({
          ok: !!parsed,
          dish,
          lines_in: lines.length,
          parsed_count: Array.isArray(parsed) ? parsed.length : 0,
          sample: Array.isArray(parsed) ? parsed.slice(0, 3) : null
        });
      } catch (e) {
        return json({ ok: false, dish, error: String(e?.message || e) });
      }
    }

    // --- DEBUG: raw Zestful (RapidAPI) call with status + body preview ---
    if (pathname === "/debug/zestful-raw") {
      const dish = url.searchParams.get("dish") || "Chicken Alfredo";
      const host = (env.ZESTFUL_RAPID_HOST || "zestful.p.rapidapi.com").trim();

      try {
        const sp = await spoonacularFetch(env, dish, null, "en");
        const lines = Array.isArray(sp?.ingredients)
          ? sp.ingredients.slice(0, 10)
          : [];
        if (!lines.length)
          return json({ ok: false, note: "no lines from provider", host });

        const res = await fetch(`https://${host}/parseIngredients`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-RapidAPI-Key": env.ZESTFUL_RAPID_KEY,
            "X-RapidAPI-Host": host
          },
          body: JSON.stringify({ ingredients: lines })
        });

        const text = await res.text();
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {}

        return json({
          ok: res.ok,
          status: res.status,
          host,
          lines_in: lines.length,
          body_preview: text.slice(0, 240),
          results_len: Array.isArray(parsed?.results)
            ? parsed.results.length
            : null,
          first_result: Array.isArray(parsed?.results)
            ? parsed.results[0]
            : null
        });
      } catch (e) {
        return json({ ok: false, error: String(e?.message || e) });
      }
    }

    if (pathname === "/restaurants/search" && request.method === "GET") {
      let ctxTB = makeCtx(env);
      const rid = newRequestId();
      let trace = {};

      try {
        const query = searchParams.get("query") || searchParams.get("q") || "";
        const addressRaw = searchParams.get("address") || "";
        const page = Number(searchParams.get("page") || 1);
        const maxRows = parseInt(searchParams.get("maxRows") || "15", 10);

        const lat = searchParams.get("lat");
        const lng = searchParams.get("lng");
        const radius = parseInt(searchParams.get("radius") || "5000", 10);

        const latNum = lat !== null ? parseFloat(lat) : null;
        const lngNum = lng !== null ? parseFloat(lng) : null;

        if (!query) {
          return jsonResponseWithTB(
            withBodyAnalytics(
              { ok: false, error: "missing_query_param" },
              ctxTB,
              rid,
              { endpoint: "restaurants-search" },
              trace
            ),
            400,
            {},
            CORS_ALL
          );
        }

        // Prefer address job if provided; otherwise try location; otherwise 400
        let finished = null;
        let usedHost =
          env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";

        if (addressRaw) {
          const job = await postJobByAddress(
            {
              query,
              address: addressRaw,
              maxRows,
              locale: searchParams.get("locale") || "en-US",
              page
            },
            env
          );
          if (!job) {
            return notFoundCandidates(ctxTB, rid, trace, {
              query,
              address: addressRaw
            });
          }
          // Wait for completion if needed
          finished = job?.immediate
            ? job
            : await waitForJob(env, job, { attempts: 6 });
        } else if (latNum != null && lngNum != null) {
          // Location job path first
          try {
            const job = await postJobByLocation(
              { query, lat: latNum, lng: lngNum, radius, maxRows },
              env
            );
            finished = job?.immediate
              ? job
              : await waitForJob(env, job, { attempts: 6 });
          } catch (e) {
            // Fallback to direct nearby search if job approach fails
            const nearby = await searchNearbyCandidates(
              { query, lat: latNum, lng: lngNum, radius, maxRows },
              env
            );
            if (nearby?.ok && Array.isArray(nearby?.rows)) {
              return jsonResponseWithTB(
                withBodyAnalytics(
                  {
                    ok: true,
                    source: "nearby-fallback",
                    count: nearby.rows.length,
                    restaurants: nearby.rows.map((r) => ({
                      id: r.id || r.slug || r.url || null,
                      title:
                        r.title ||
                        r.name ||
                        r.displayName ||
                        r.storeName ||
                        r.restaurantName ||
                        null,
                      raw: r.raw || r
                    }))
                  },
                  ctxTB,
                  rid,
                  { endpoint: "restaurants-search" },
                  trace
                ),
                200,
                {},
                CORS_ALL
              );
            }
            throw e;
          }
        } else {
          return jsonResponseWithTB(
            withBodyAnalytics(
              { ok: false, error: "missing_address_or_latlng" },
              ctxTB,
              rid,
              { endpoint: "restaurants-search" },
              trace
            ),
            400,
            {},
            CORS_ALL
          );
        }

        // Collect candidates from the finished job
        const buckets = [
          finished?.data?.stores,
          finished?.data?.restaurants,
          finished?.stores,
          finished?.restaurants,
          finished?.data
        ].filter(Boolean);

        const candidates = [];
        for (const b of buckets) if (Array.isArray(b)) candidates.push(...b);

        const restaurants = candidates
          .map((it) => ({
            id:
              it?.id ||
              it?.storeUuid ||
              it?.storeId ||
              it?.restaurantId ||
              it?.slug ||
              it?.url ||
              null,
            title:
              it?.title ||
              it?.name ||
              it?.displayName ||
              it?.storeName ||
              it?.restaurantName ||
              null,
            raw: it
          }))
          .filter((x) => x.title);

        return jsonResponseWithTB(
          withBodyAnalytics(
            {
              ok: true,
              source: addressRaw ? "address-job" : "location-job",
              count: restaurants.length,
              restaurants
            },
            ctxTB,
            rid,
            { endpoint: "restaurants-search", host: usedHost },
            trace
          ),
          200,
          {},
          CORS_ALL
        );
      } catch (err) {
        return errorResponseWith(
          { ok: false, error: String(err?.message || err) },
          ctxTB,
          rid,
          500,
          { endpoint: "restaurants-search" },
          trace
        );
      }
    }

    if (pathname === "/restaurants/find" && request.method === "GET") {
      const query = url.searchParams.get("query") || "";
      const address = url.searchParams.get("address") || "";
      const lat = url.searchParams.get("lat");
      const lng = url.searchParams.get("lng");
      const maxRows = Number(url.searchParams.get("maxRows")) || 10;

      const rapidKey = env.RAPIDAPI_KEY;
      const host =
        env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
      const base = `https://${host}`;

      const postJob = async () =>
        fetch(`${base}/api/job`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-RapidAPI-Key": rapidKey,
            "X-RapidAPI-Host": host,
            Accept: "application/json",
            "User-Agent": "TummyBuddyWorker/1.0"
          },
          body: JSON.stringify({
            scraper: {
              maxRows,
              query,
              address,
              locale: "en-US",
              page: 1,
              lat: lat ? Number(lat) : undefined,
              lng: lng ? Number(lng) : undefined
            }
          })
        });

      // 1) create job
      const createdRes = await postJob();
      const created = await createdRes.json().catch(() => ({}));
      const jobId =
        created?.data?.jobId ||
        created?.jobId ||
        created?.id ||
        created?.data?.id;
      if (!jobId)
        return json(
          { ok: false, error: "No jobId from RapidAPI", detail: created },
          { status: 502 }
        );

      // 2) poll job
      let tries = 0,
        payload = null;
      while (tries++ < 10) {
        const r = await fetch(`${base}/api/job/${jobId}`, {
          headers: {
            "X-RapidAPI-Key": rapidKey,
            "X-RapidAPI-Host": host,
            Accept: "application/json",
            "User-Agent": "TummyBuddyWorker/1.0"
          }
        });
        const j = await r.json().catch(() => ({}));
        const results =
          j?.data?.results || j?.results || j?.data?.data?.results || [];
        if (Array.isArray(results) && results.length) {
          payload = results;
          break;
        }
        await sleep(800 * tries);
      }
      if (!payload)
        return json({
          ok: true,
          source: "address-job",
          count: 0,
          restaurants: []
        });

      // 3) map → dedupe restaurants (V5-style filters)
      const isPackageOrDrink = (s = "") =>
        /family|pack|bundle|beverage|drink|soda|water/i.test(s);
      const byName = new Map();
      for (const item of payload) {
        const name =
          item?.restaurant?.name || item?.restaurant_name || item?.name || "";
        const rUrl = item?.restaurant?.url || item?.restaurant_url || "";
        if (!name || isPackageOrDrink(name)) continue;
        if (!byName.has(name))
          byName.set(name, { name, url: rUrl, source: "uber_eats" });
      }
      const restaurants = Array.from(byName.values()).slice(0, maxRows);

      return json({
        ok: true,
        source: "address-job",
        count: restaurants.length,
        restaurants,
        served_at: new Date().toISOString(),
        trace: { endpoint: "restaurants-search", host }
      });
    }

    if (pathname === "/debug/zestful-usage") {
      const today = new Date().toISOString().slice(0, 10);
      const key = `zestful:count:${today}`;
      let raw = null;
      if (env.MENUS_CACHE) {
        try {
          raw = await env.MENUS_CACHE.get(key);
        } catch {}
      }
      const count = raw ? parseInt(raw, 10) : 0;
      const cap = parseInt(env.ZESTFUL_DAILY_CAP || "0", 10);
      return json({ date: today, count, cap });
    }

    if (pathname === "/organs/assess" && request.method === "POST") {
      if (!env?.D1_DB) {
        return json({ error: "D1_DB not bound" }, { status: 500 });
      }

      const ORGANS = await getOrgans(env);

      let body = {};
      try {
        body = await request.json();
      } catch {}

      const {
        user_id = null,
        ingredients = [],
        method: methodRaw = "saute",
        weight_kg: weightRaw = 70
      } = body || {};

      if (!Array.isArray(ingredients) || ingredients.length === 0) {
        return json(
          { error: "ingredients required (array of names or {name, grams})" },
          { status: 400 }
        );
      }

      const expanded = (ingredients || [])
        .map((entry) => {
          if (typeof entry === "string") {
            return { name: entry.trim(), grams: 100 };
          }
          const name = String(entry?.name || "").trim();
          const grams = Number(entry?.grams);
          return {
            name,
            grams: Number.isFinite(grams) && grams > 0 ? grams : 100
          };
        })
        .filter((it) => it.name);

      if (!expanded.length) {
        return json(
          { error: "ingredients required (array of names or {name, grams})" },
          { status: 400 }
        );
      }

      const gramsByName = new Map();
      for (const item of expanded) {
        const key = item.name.toLowerCase();
        gramsByName.set(key, (gramsByName.get(key) || 0) + item.grams);
      }

      const names = Array.from(gramsByName.keys());
      const qMarks = names.map(() => "?").join(",");
      // ---- EARLY DEBUG: prove we're in patched /organs/assess ----
      try {
        const __sp = new URL(request.url).searchParams;
        if (__sp.get("echo_names") === "1") {
          return json({
            ok: true,
            names,
            note: "early-echo from /organs/assess"
          });
        }
      } catch {}

      async function aliasForName(env, raw) {
        const name = String(raw || "").toLowerCase();
        try {
          const row = await env.D1_DB.prepare(
            "SELECT to_slug FROM ingredient_aliases WHERE ? LIKE pattern ORDER BY priority ASC LIMIT 1"
          )
            .bind(name)
            .first();
          return row?.to_slug || null;
        } catch {
          return null;
        }
      }

      // build slug list via alias table AND accumulate grams by slug
      const slugs = [];
      const gramsBySlug = new Map();

      for (const n of names) {
        const grams = Number(gramsByName.get(n) || 0);
        let s = await aliasForName(env, n);

        // NEW: if alias not found, treat already-sluggy names as slugs (e.g., "rolled_oats", "blueberries")
        if (!s) {
          const sluggy = /^[a-z0-9_]+$/.test(String(n));
          if (sluggy) s = String(n);
        }

        // --- Lactose resolver: map each input name->dairy alias->lactose band
        const lactose_hits = [];
        for (const n of names) {
          const nameLC = String(n).toLowerCase();
          try {
            const row = await env.D1_DB.prepare(
              `SELECT da.item_slug, dl.item_name, dl.lactose_g_per_100g,
                      CASE
                        WHEN dl.lactose_g_per_100g <= 0.5 THEN 'Low'
                        WHEN dl.lactose_g_per_100g <= 3.5 THEN 'Medium'
                        ELSE 'High'
                      END AS lactose_band
                 FROM dairy_aliases da
                 JOIN dairy_lactose_levels dl ON dl.item_slug = da.item_slug
                WHERE ?1 LIKE da.pattern
                ORDER BY LENGTH(da.pattern) DESC
                LIMIT 1`
            )
              .bind(nameLC)
              .first();
            if (row) {
              lactose_hits.push({
                name: nameLC,
                item_slug: row.item_slug,
                item_name: row.item_name,
                lactose_g_per_100g: row.lactose_g_per_100g,
                lactose_band: row.lactose_band
              });
            }
          } catch {}
        }
        // Debug switch: return lactose resolution if requested
        try {
          const __spl = new URL(request.url).searchParams;
          if (__spl.get("echo_lactose") === "1") {
            return json({ ok: true, names, lactose_hits });
          }
        } catch {}
        // TEMP FALLBACK: if alias misses, force common slugs from name substrings
        try {
          const namesLC = names.map((n) => String(n).toLowerCase());
          for (const n of namesLC) {
            const g = Number(gramsByName.get(n) || 0);
            if (
              n.includes("rolled oats") ||
              n.includes("old-fashioned rolled oats")
            ) {
              slugs.push("rolled_oats");
              gramsBySlug.set(
                "rolled_oats",
                (gramsBySlug.get("rolled_oats") || 0) + g
              );
            }
            if (n.includes("blueberr")) {
              slugs.push("blueberries");
              gramsBySlug.set(
                "blueberries",
                (gramsBySlug.get("blueberries") || 0) + g
              );
            }
          }
        } catch {}
        if (s) {
          const key = s.toLowerCase();
          slugs.push(key);
          gramsBySlug.set(key, (gramsBySlug.get(key) || 0) + grams);
        }
      }

      let yields = { results: [] };
      if (names.length) {
        try {
          const slugQ = slugs.length
            ? ` OR LOWER(icy.ingredient_slug) IN (${slugs
                .map(() => "?")
                .join(",")})`
            : "";
          const sql = `
      SELECT
        icy.ingredient,
        icy.ingredient_slug,
        COALESCE(icy.compound_id, c.id) AS compound_id,
        COALESCE(icy.mg_per_100g, icy.amount_per_100g) AS mg_per_100g
      FROM ingredient_compound_yields icy
      LEFT JOIN compounds c ON c.slug = icy.compound_slug
      WHERE LOWER(icy.ingredient) IN (${qMarks}) ${slugQ}
    `;
          yields = await env.D1_DB.prepare(sql)
            .bind(
              ...names.map((n) => String(n).toLowerCase()),
              ...slugs.map((s) => String(s).toLowerCase())
            )
            .all();
          try {
            const __sp2 = new URL(request.url).searchParams;
            if (__sp2.get("echo2") === "1") {
              return json({
                ok: true,
                names,
                slugs,
                yields: (yields && yields.results) || []
              });
            }
          } catch {}
        } catch (err) {
          return json(
            {
              error: "d1_query_failed",
              stage: "yields_join",
              detail: String(err?.message || err)
            },
            { status: 500 }
          );
        }
      }

      // DEBUG: if echo_yields=1, return the names/slugs and raw yields to verify matching
      try {
        const __sp = new URL(request.url).searchParams;
        if (__sp.get("echo_yields") === "1") {
          return json({
            ok: true,
            names,
            slugs,
            yields: (yields && yields.results) || []
          });
        }
      } catch {}

      const debugYields = [];
      for (const row of yields.results || []) {
        const slug = String(row?.ingredient_slug || "").toLowerCase();
        const grams = Number(gramsBySlug.get(slug) || 0);
        const mg100 = Number(row?.mg_per_100g || 0);
        const doseMg = mg100 * (grams / 100);
        debugYields.push({
          slug,
          compound_id: row?.compound_id || null,
          mg_per_100g: mg100,
          grams,
          dose_mg: doseMg
        });
      }

      const byCompoundMg = new Map();
      for (const row of yields.results || []) {
        const ingredientName = String(row?.ingredient || "").toLowerCase();
        const slugKey = String(row?.ingredient_slug || "").toLowerCase();
        const key = slugKey || ingredientName;
        const grams =
          gramsBySlug.get(key) ?? gramsByName.get(ingredientName) ?? 0;
        const mgPer100 = Number(row?.mg_per_100g) || 0;
        const totalMg = mgPer100 * (grams / 100);
        const cid = String(row?.compound_id || "");
        if (!cid) continue;
        byCompoundMg.set(cid, (byCompoundMg.get(cid) || 0) + totalMg);
      }

      // --- Build lactose summary + pill triggers (for optional return)
      const lactose_summary = Array.isArray(lactose_hits)
        ? lactose_hits.map((h) => ({
            name: h.name,
            item_slug: h.item_slug,
            item_name: h.item_name,
            lactose_g_per_100g: h.lactose_g_per_100g,
            lactose_band: h.lactose_band
          }))
        : [];

      const pill_triggers = {
        lactose: lactose_summary.map((h) => ({
          item: h.item_slug,
          band: h.lactose_band
        }))
      };

      // Optional return gate: ?include_lactose=1 (do NOT depend on variables defined later)
      try {
        const __spL = new URL(request.url).searchParams;
        if (__spL.get("include_lactose") === "1") {
          const __method =
            typeof method !== "undefined"
              ? method
              : String(methodRaw || "saute").toLowerCase();
          const __weight =
            typeof weight_kg !== "undefined"
              ? weight_kg
              : Number(weightRaw) && Number(weightRaw) > 0
                ? Number(weightRaw)
                : 70;
          const __inputs = Array.isArray(expanded) ? expanded : [];
          const __compounds =
            typeof byCompoundMg !== "undefined" &&
            byCompoundMg &&
            typeof byCompoundMg.entries === "function"
              ? Object.fromEntries(byCompoundMg.entries())
              : {};
          return json({
            ok: true,
            method: __method,
            weight_kg: __weight,
            inputs: __inputs,
            compounds_mg: __compounds,
            lactose_summary,
            pill_triggers
          });
        }
      } catch {}
      // DEBUG: expose doses + compound slugs if echo3=1
      try {
        const __sp3 = new URL(request.url).searchParams;
        if (__sp3.get("echo3") === "1") {
          const cids = Array.from(byCompoundMg.keys());
          let comp = { results: [] };
          if (cids.length) {
            const marks = cids.map(() => "?").join(",");
            try {
              comp = await env.D1_DB.prepare(
                `SELECT id, slug, name FROM compounds WHERE id IN (${marks})`
              )
                .bind(...cids)
                .all();
            } catch (err) {
              return json(
                { ok: false, stage: "echo3_compounds", err: String(err) },
                { status: 500 }
              );
            }
          }
          const doses = {};
          for (const [cid, mg] of byCompoundMg.entries()) doses[cid] = mg;
          return json({
            ok: true,
            names,
            slugs,
            yields: (yields && yields.results) || [],
            doses_mg: doses,
            compounds: comp.results || []
          });
        }
      } catch {}
      const method = String(methodRaw || "saute").toLowerCase();
      const weight_kg =
        Number(weightRaw) && Number(weightRaw) > 0 ? Number(weightRaw) : 70;

      let factors = { results: [] };
      try {
        factors = await env.D1_DB.prepare(
          `SELECT compound_id, factor FROM cooking_factors WHERE method=?1`
        )
          .bind(method)
          .all();
      } catch (err) {
        return json(
          {
            error: "d1_query_failed",
            stage: "cooking_factors",
            detail: String(err?.message || err)
          },
          { status: 500 }
        );
      }

      const cookMap = new Map(
        (factors.results || []).map((r) => [
          String(r.compound_id || ""),
          Number(r.factor) || 1
        ])
      );
      for (const [cid, mg] of Array.from(byCompoundMg.entries())) {
        const factor = cookMap.get(cid) || 1;
        byCompoundMg.set(cid, mg * factor);
      }

      const cids = Array.from(byCompoundMg.keys());
      if (!cids.length) {
        return json({
          ok: true,
          method,
          weight_kg,
          inputs: expanded,
          compounds_mg: {},
          organs_raw: {},
          organs_normalized: {},
          organs_named: {}
        });
      }

      const marks = cids.map(() => "?").join(",");
      let edges = { results: [] };
      try {
        edges = await env.D1_DB.prepare(
          `SELECT e.compound_id, e.organ_id, e.sign, e.strength, e.evidence
             FROM compound_organ_edges e
            WHERE e.compound_id IN (${marks})`
        )
          .bind(...cids)
          .all();
      } catch (err) {
        return json(
          {
            error: "d1_query_failed",
            stage: "organ_edges",
            detail: String(err?.message || err)
          },
          { status: 500 }
        );
      }

      const organs = {};
      const drivers = {};
      for (const edge of edges.results || []) {
        const cid = String(edge?.compound_id || "");
        if (!cid) continue;
        const organId = String(edge?.organ_id || "");
        if (!organId) continue;

        const mg = byCompoundMg.get(cid) || 0;
        if (!mg) continue;

        const strength = Number(edge?.strength) || 0;
        const sign = Number(edge?.sign) || 1;
        const doseMgPerKg = mg / Math.max(1, weight_kg);
        const contrib = doseMgPerKg * strength * sign;

        organs[organId] = (organs[organId] || 0) + contrib;

        if (!drivers[organId]) drivers[organId] = [];
        drivers[organId].push({
          compound_id: cid,
          sign,
          contrib
        });
      }

      // 5) Normalize to -100..+100 with soft saturation
      function softNorm(x) {
        const k = 0.02; // scale factor to tune the tanh slope
        const y = Math.tanh(k * x);
        return Math.round(y * 100);
      }

      const normalized = {};
      for (const [orgId, val] of Object.entries(organs)) {
        normalized[orgId] = softNorm(val);
      }

      let organRows = { results: [] };
      try {
        organRows = await env.D1_DB.prepare(
          `SELECT id, organ FROM organ_systems`
        ).all();
      } catch (err) {
        return json(
          {
            error: "d1_query_failed",
            stage: "organ_lookup",
            detail: String(err?.message || err)
          },
          { status: 500 }
        );
      }

      const idToName = new Map(
        (organRows.results || []).map((r) => [String(r.id), r.organ])
      );

      function levelForScore(score) {
        if (score >= 30) return "High Benefit";
        if (score >= 10) return "Benefit";
        if (score > -10) return "Neutral";
        if (score > -30) return "Caution";
        return "High Caution";
      }

      let compoundRows = { results: [] };
      try {
        compoundRows = await env.D1_DB.prepare(
          "SELECT id, name FROM compounds"
        ).all();
      } catch (err) {
        return json(
          {
            error: "d1_query_failed",
            stage: "compound_lookup",
            detail: String(err?.message || err)
          },
          { status: 500 }
        );
      }

      const idToCompound = new Map(
        (compoundRows.results || []).map((r) => [String(r.id), r.name])
      );
      const organTopDrivers = {};
      for (const [orgId, list] of Object.entries(drivers)) {
        const sorted = [...list]
          .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
          .slice(0, 2);
        const label = idToName.get(String(orgId)) || orgId;
        organTopDrivers[label] = sorted.map((entry) => {
          const nm =
            idToCompound.get(String(entry.compound_id)) || entry.compound_id;
          return `${entry.sign > 0 ? "+" : "-"} ${nm}`;
        });
      }
      for (const organSlug of ORGANS) {
        if (!Array.isArray(organTopDrivers[organSlug])) {
          organTopDrivers[organSlug] = [];
        }
      }

      const organNamed = {};
      const organLevels = {};
      for (const [id, score] of Object.entries(normalized)) {
        const label = idToName.get(String(id)) || id;
        organNamed[label] = score;
        organLevels[label] = levelForScore(score);
      }
      for (const organSlug of ORGANS) {
        if (!(organSlug in organLevels)) {
          organLevels[organSlug] = "Neutral";
        }
      }

      const edgeScores = {};
      for (const edge of edges.results || []) {
        const organId = String(edge?.organ_id || "");
        if (!organId) continue;
        const organSlug = idToName.get(organId) || organId;
        const strength = Number(edge?.strength) || 0;
        const sign = Number(edge?.sign) >= 0 ? 1 : -1;
        const delta = sign * strength * 100;
        edgeScores[organSlug] = (edgeScores[organSlug] || 0) + delta;
      }
      const numToLevel = (n) =>
        n >= 60
          ? "High Benefit"
          : n >= 20
            ? "Benefit"
            : n <= -60
              ? "High Caution"
              : n <= -20
                ? "Caution"
                : "Neutral";
      for (const organSlug of ORGANS) {
        organLevels[organSlug] = numToLevel(edgeScores[organSlug] || 0);
      }

      let scoring =
        body && typeof body.scoring === "object" && body.scoring !== null
          ? { ...body.scoring }
          : {};
      let levels = organLevels;
      let top_drivers = organTopDrivers;
      (() => {
        const prefs = body?.user_prefs || {};
        const avoidDairy = prefs?.allergens?.dairy === false;

        if (!avoidDairy) return;

        const names = (body?.ingredients || []).map((i) =>
          (i?.name || i || "").toLowerCase()
        );
        const dairyTerms = [
          "cream",
          "butter",
          "parmesan",
          "cheese",
          "milk",
          "yogurt"
        ];
        const hasDairy = dairyTerms.some((term) =>
          names.some((n) => n.includes(term))
        );

        if (!hasDairy) return;

        levels = levels || {};
        top_drivers = top_drivers || {};
        scoring = scoring || {};

        levels.gut = "High Caution";
        top_drivers.gut = Array.from(
          new Set([...(top_drivers.gut || []), "- Dairy (prefs)"])
        );
        scoring.tummy_barometer = Math.min(
          Number(scoring.tummy_barometer ?? 0),
          -40
        );
      })();
      (() => {
        const prefs = body?.user_prefs || {};
        const sensitive =
          prefs?.allergens?.garlic_onion === true ||
          prefs?.fodmap?.strict === true;
        if (!sensitive) return;

        const names = (body?.ingredients || []).map((i) =>
          (i?.name || i || "").toLowerCase()
        );
        const fodmapTerms = ["garlic", "onion", "shallot", "scallion", "chive"];
        const hasFodmap = fodmapTerms.some((term) =>
          names.some((n) => n.includes(term))
        );
        if (!hasFodmap) return;

        levels = levels || {};
        top_drivers = top_drivers || {};
        scoring = scoring || {};

        levels.gut = "High Caution";
        top_drivers.gut = Array.from(
          new Set([
            ...(top_drivers.gut || []),
            "- FODMAP: garlic/onion (prefs)"
          ])
        );
        scoring.tummy_barometer = Math.min(
          Number(scoring.tummy_barometer ?? 0),
          -40
        );
      })();
      if (body && typeof body === "object") body.scoring = scoring;

      const compoundsObj = Object.fromEntries(byCompoundMg.entries());

      const isDev =
        url.searchParams.get("dev") === "1" ||
        body?.dev === 1 ||
        body?.dev === "1";

      const responsePayload = {
        ok: true,
        method,
        weight_kg,
        user_id,
        inputs: expanded,
        compounds_mg: compoundsObj,
        organs_raw: organs,
        organs_normalized: normalized,
        organs_named: organNamed,
        organ_levels: organLevels,
        organ_top_drivers: organTopDrivers
      };
      if (isDev) responsePayload.debug_yields = debugYields;

      return json(responsePayload);
    }

    if (pathname === "/user/prefs") {
      if (!env.USER_PREFS_KV) {
        return json(
          { ok: false, error: "USER_PREFS_KV not bound" },
          { status: 500 }
        );
      }

      if (request.method === "GET") {
        const user_id = url.searchParams.get("user_id") || "anon";
        const key = `prefs:user:${user_id}`;
        const raw = await env.USER_PREFS_KV.get(key, "json");
        const defaults = {
          allergens: {
            dairy: true,
            gluten: true,
            soy: false,
            shellfish: false,
            garlic_onion: true
          },
          fodmap: { strict: false },
          units: "us"
        };
        return json({
          ok: true,
          user_id,
          prefs: { ...defaults, ...(raw || {}) }
        });
      }

      if (request.method === "POST") {
        const user_id = url.searchParams.get("user_id") || "anon";
        const body = (await request.json().catch(() => ({}))) || {};
        const key = `prefs:user:${user_id}`;
        const existing = (await env.USER_PREFS_KV.get(key, "json")) || {};
        const merged = { ...existing, ...body };
        await env.USER_PREFS_KV.put(key, JSON.stringify(merged));
        return json({ ok: true, user_id, saved: merged });
      }

      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, POST" }
      });
    }
    if (pathname === "/debug/providers") {
      return new Response(
        JSON.stringify(
          {
            providers_order: providerOrder(env),
            has: {
              EDAMAM_APP_ID: !!env.EDAMAM_APP_ID,
              EDAMAM_APP_KEY: !!env.EDAMAM_APP_KEY,
              SPOONACULAR_KEY: !!env.SPOONACULAR_KEY,
              OPENAI_API_KEY: !!env.OPENAI_API_KEY
            }
          },
          null,
          2
        ),
        { headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }

    // === Step 20B: future upgrade ===
    // TODO: read recent R2 analysis files (e.g., results/*.json),
    // aggregate organ_summary across all recent dishes,
    // compute average plus/minus counts, derive sentiment, and build items[] dynamically.

    // Welcome / help text
    return new Response(
      "HELLO — tb-dish-processor is running.\n" +
        "Try: GET /health, /debug/config, /debug/ping-lexicon, /debug/read-kv-shard?name=..., /debug/warm-lexicon?names=...,\n" +
        "/debug/refresh-ingredient-shards, /debug/read-index, /debug/job?id=..., /results/<id>.json, /menu/uber-test;\n" +
        "POST /enqueue",
      { status: 200, headers: { "content-type": "text/plain" } }
    );
  }
};

// ========== Helper utilities ==========
const lc = (s) => (s ?? "").toLowerCase().normalize("NFKC").trim();

// [39.2] — mark first-seen boot time in KV (best-effort)
async function ensureBootTime(env) {
  if (!env?.LEXICON_CACHE) return null;
  try {
    const key = "meta/boot_at";
    let boot = await env.LEXICON_CACHE.get(key);
    if (!boot) {
      boot = new Date().toISOString();
      await env.LEXICON_CACHE.put(key, boot, { expirationTtl: 30 * 24 * 3600 });
    }
    return boot;
  } catch {
    return null;
  }
}

function parseJsonSafe(raw, fallback) {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function canonicalizeIngredientName(name = "") {
  const s = String(name ?? "")
    .toLowerCase()
    .trim();
  if (s.includes("skim milk") || s.endsWith(" milk") || s === "milk")
    return "milk";
  if (s.includes("parmesan")) return "parmesan cheese";
  if (s.includes("garlic")) return "garlic";
  if (s.includes("onion")) return "onion";
  if (s.includes("butter")) return "butter";
  if (
    s.includes("heavy cream") ||
    s.includes("whipping cream") ||
    s.includes("cream")
  )
    return "cream";
  if (s.includes("salt")) return "salt";
  if (s.includes("tomato")) return "tomato";
  if (s.includes("flour") || s.includes("wheat") || s.includes("pasta"))
    return "flour";
  return s;
}

// ==== Global limits & TTLs (safe defaults) ====
const MENU_TTL_SECONDS = 18 * 3600; // 18 hours cache TTL for menu snapshots
const LIMITS = {
  DEFAULT_TOP: 10,
  TOP_MIN: 1,
  TOP_MAX: 25
};

// [38.8] — snapshot of effective limits (for QA)
function limitsSnapshot({ maxRows, radius }) {
  const reqMax = Number.isFinite(Number(maxRows)) ? Number(maxRows) : null;
  const reqRad = Number.isFinite(Number(radius)) ? Number(radius) : null;

  const effectiveMax = Number.isFinite(Number(maxRows)) ? Number(maxRows) : 15;
  const effectiveRad = Number.isFinite(Number(radius)) ? Number(radius) : 5000;

  return {
    maxRows: {
      requested: reqMax,
      effective: effectiveMax,
      min: 1,
      max: 50,
      default: 15
    },
    radius: {
      requested: reqRad,
      effective: effectiveRad,
      min: 500,
      max: 25000,
      default: 5000
    },
    cache_ttl_seconds: MENU_TTL_SECONDS
  };
}

async function getZestfulCount(env) {
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
  if (!kv) return 0;

  const today = new Date().toISOString().slice(0, 10);
  const key = `zestful:count:${today}`;

  try {
    const raw = await kv.get(key);
    return parseInt(raw || "0", 10) || 0;
  } catch (err) {
    console.log(
      "[parse] zestful counter read error:",
      err?.message || String(err)
    );
    return 0;
  }
}

async function incZestfulCount(env, linesCount = 0) {
  if (!linesCount || linesCount <= 0) return 0;

  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
  if (!kv) return 0;

  const today = new Date().toISOString().slice(0, 10);
  const key = `zestful:count:${today}`;
  let current = 0;

  try {
    current = parseInt((await kv.get(key)) || "0", 10) || 0;
  } catch (err) {
    console.log(
      "[parse] zestful counter read error:",
      err?.message || String(err)
    );
  }

  const next = current + linesCount;
  try {
    await kv.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 31 });
  } catch (err) {
    console.log(
      "[parse] zestful counter put error:",
      err?.message || String(err)
    );
  }

  return next;
}

async function getShardFromKV(env, name) {
  if (!env?.LEXICON_CACHE) return { ok: false, name, reason: "KV not bound" };
  const key = `shards/${name}.json`;
  const raw = await env.LEXICON_CACHE.get(key);
  if (!raw) return { ok: false, name, reason: "not_in_kv" };
  const js = parseJsonSafe(raw, null);
  if (!js || !Array.isArray(js.entries))
    return { ok: false, name, reason: "bad_format" };
  return { ok: true, name, version: js.version ?? null, entries: js.entries };
}

// Gather terms from one entry
function entryTerms(entry) {
  const out = new Set();
  const t = lc(entry?.term);
  if (t && t.length >= 2) out.add(t);
  if (Array.isArray(entry?.terms))
    for (const v of entry.terms) {
      const s = lc(String(v));
      if (s && s.length >= 2) out.add(s);
    }
  if (Array.isArray(entry?.synonyms))
    for (const v of entry.synonyms) {
      const s = lc(String(v));
      if (s && s.length >= 2) out.add(s);
    }
  const alias = lc(entry?.alias);
  if (alias && alias.length >= 2) out.add(alias);
  return Array.from(out);
}

// Word-boundary match for a term
function termMatches(corpus, term) {
  const t = lc(term);
  if (t.length < 2) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}\\b`, "i");
  return re.test(corpus);
}

// === Risk scoring (allergens + FODMAP -> flags + tummy_barometer) ===
const RISK = {
  allergenWeights: {
    milk: 18,
    egg: 12,
    fish: 16,
    shellfish: 20,
    tree_nut: 20,
    peanut: 22,
    wheat: 15,
    soy: 12,
    sesame: 15,
    mustard: 8,
    celery: 8,
    lupin: 10,
    sulphite: 6,
    mollusc: 16,
    gluten: 15
  },
  fodmapWeights: { high: 20, medium: 12, low: 3, unknown: 5 },
  labels: [
    { max: 39, name: "Avoid" },
    { max: 69, name: "Caution" },
    { max: 100, name: "Likely OK" }
  ],
  maxRaw: 100
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const toScore = (raw, maxRaw = RISK.maxRaw) =>
  Math.round(clamp01(raw / maxRaw) * 100);
const labelFor = (score) =>
  score <= 39 ? "Avoid" : score <= 69 ? "Caution" : "Likely OK";

function extractAllergenKeys(hit) {
  return inferAllergensFromClassesTags(hit).map((x) =>
    x.trim().toLowerCase().replace(/\s+/g, "_")
  );
}

function extractFodmapLevel(hit) {
  return normalizeFodmapValue(hit.fodmap ?? hit.fodmap_level);
}
function normalizeFodmapValue(v) {
  let lvl = v;
  if (v && typeof v === "object") lvl = v.level ?? v.fodmap_level ?? v.value;
  lvl = String(lvl || "").toLowerCase();
  if (["very_high", "ultra_high", "high"].includes(lvl)) return "high";
  if (["medium", "moderate"].includes(lvl)) return "medium";
  if (["low", "very_low", "trace"].includes(lvl)) return "low";
  return "unknown";
}
function inferAllergensFromClassesTags(hit) {
  const out = new Set(
    Array.isArray(hit.allergens)
      ? hit.allergens.map((a) => String(a).toLowerCase())
      : []
  );
  const classes = Array.isArray(hit.classes)
    ? hit.classes.map((x) => String(x).toLowerCase())
    : [];
  const tags = Array.isArray(hit.tags)
    ? hit.tags.map((x) => String(x).toLowerCase())
    : [];
  const canon = String(hit.canonical || "").toLowerCase();
  if (
    classes.includes("dairy") ||
    tags.includes("dairy") ||
    tags.includes("milk") ||
    /milk|cheese|butter|cream|parmesan|mozzarella|yogurt|yoghurt/.test(canon)
  )
    out.add("milk");
  if (classes.includes("gluten") || tags.includes("gluten")) out.add("gluten");
  if (
    tags.includes("wheat") ||
    /wheat|semolina|breadcrumbs|pasta|flour/.test(canon)
  )
    out.add("wheat");
  if (classes.includes("shellfish") || tags.includes("shellfish"))
    out.add("shellfish");
  if (classes.includes("fish") || tags.includes("fish")) out.add("fish");
  if (classes.includes("soy") || tags.includes("soy")) out.add("soy");
  if (classes.includes("egg") || tags.includes("egg")) out.add("egg");
  if (classes.includes("sesame") || tags.includes("sesame")) out.add("sesame");
  return Array.from(out);
}
function scoreDishFromHits(hits) {
  const allergenSet = new Set();
  const rank = { high: 3, medium: 2, low: 1, unknown: 0 };
  let worstFodmap = "unknown";
  for (const h of hits || []) {
    for (const k of extractAllergenKeys(h)) allergenSet.add(k);
    const f = extractFodmapLevel(h);
    if (rank[f] > rank[worstFodmap]) worstFodmap = f;
  }
  let rawRisk = 0;
  const reasons = [];
  for (const k of Array.from(allergenSet).sort()) {
    let w = RISK.allergenWeights[k] || 0;
    if (k === "milk" && worstFodmap === "low") {
      w = Math.round(w * 0.6);
      reasons.push({
        kind: "allergen",
        key: k,
        weight: w,
        note: "trace/low-lactose dairy"
      });
    } else {
      reasons.push({ kind: "allergen", key: k, weight: w });
    }
    rawRisk += w;
  }
  const fWeight = RISK.fodmapWeights[worstFodmap] || 0;
  if (fWeight > 0) {
    reasons.push({ kind: "fodmap", level: worstFodmap, weight: fWeight });
    rawRisk += fWeight;
  }
  const score = toScore(rawRisk);
  const label = labelFor(score);
  return {
    flags: { allergens: Array.from(allergenSet).sort(), fodmap: worstFodmap },
    tummy_barometer: { score, label, reasons },
    _debug: { rawRisk, worstFodmap }
  };
}

// Human-friendly sentences
function buildHumanSentences(flags, tummy_barometer) {
  const out = [];
  if (Array.isArray(flags?.allergens) && flags.allergens.length) {
    const list = flags.allergens.slice(0, 4).join(", ");
    out.push(`Allergen risk: ${list}.`);
  }
  const f = String(flags?.fodmap || "unknown").toLowerCase();
  if (f === "high")
    out.push(
      "FODMAP level appears high; sensitive users should avoid or confirm."
    );
  else if (f === "medium")
    out.push("FODMAP level appears medium; portion size may matter.");
  else if (f === "low")
    out.push("FODMAP level appears low; small portions are often tolerated.");
  else out.push("FODMAP level is unclear from ingredients.");

  if (flags?.onion || flags?.garlic) {
    const parts = [];
    if (flags.onion) parts.push("onion");
    if (flags.garlic) parts.push("garlic");
    out.push(`Contains allium indicators (${parts.join(" & ")}).`);
  }
  if (flags?.gluten_hint)
    out.push(
      "Gluten indicators present (e.g., pasta/wheat/flour). Ask for gluten-free options if needed."
    );

  const reasons = Array.isArray(tummy_barometer?.reasons)
    ? tummy_barometer.reasons
    : [];
  const notes = [];
  for (const r of reasons) {
    if (r.kind === "allergen" && r.key)
      notes.push(`allergen: ${r.key}${r.note ? ` (${r.note})` : ""}`);
    else if (r.kind === "fodmap" && r.level) notes.push(`FODMAP: ${r.level}`);
  }
  if (notes.length) out.push(`Why: ${notes.join("; ")}.`);
  if (typeof tummy_barometer?.score === "number" && tummy_barometer?.label) {
    out.push(
      `Overall: ${tummy_barometer.label} (score ${tummy_barometer.score}).`
    );
  }

  const MAX = 120;
  const trimmed = out.map((s) => {
    if (s.length <= MAX) return s;
    const core = s.slice(0, MAX - 1).replace(/\s+$/, "");
    return core.endsWith(".") ? core : core + "…";
  });
  return trimmed.slice(0, 4);
}

function deriveFlags(hits) {
  let onion = false,
    garlic = false,
    dairy_hint = false,
    gluten_hint = false;
  for (const h of hits) {
    const canon = lc(h.canonical || "");
    const term = lc(h.term || "");
    const classes = Array.isArray(h.classes) ? h.classes.map(lc) : [];
    const tags = Array.isArray(h.tags) ? h.tags.map(lc) : [];
    if (
      canon.includes("onion") ||
      term.includes("onion") ||
      classes.includes("allium") ||
      tags.includes("onion")
    )
      onion = true;
    if (
      canon.includes("garlic") ||
      term.includes("garlic") ||
      classes.includes("allium") ||
      tags.includes("garlic")
    )
      garlic = true;
    if (
      classes.includes("dairy") ||
      tags.includes("dairy") ||
      tags.includes("milk") ||
      canon.includes("milk") ||
      canon.includes("cheese") ||
      canon.includes("butter") ||
      canon.includes("cream") ||
      term.includes("milk") ||
      term.includes("cheese") ||
      term.includes("butter") ||
      term.includes("cream")
    )
      dairy_hint = true;
    if (
      classes.includes("gluten") ||
      tags.includes("gluten") ||
      tags.includes("wheat") ||
      canon.includes("gluten") ||
      canon.includes("wheat") ||
      canon.includes("flour") ||
      canon.includes("pasta") ||
      canon.includes("breadcrumbs") ||
      canon.includes("semolina") ||
      term.includes("wheat") ||
      term.includes("flour") ||
      term.includes("pasta") ||
      term.includes("breadcrumbs") ||
      term.includes("semolina")
    )
      gluten_hint = true;
  }
  return { onion, garlic, dairy_hint, gluten_hint };
}

// Env int helper
function getEnvInt(env, name, defVal) {
  const raw = env && env[name] != null ? String(env[name]).trim() : "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : defVal;
}

async function rateLimit(env, request, { limit = 60 } = {}) {
  const kv = env?.USER_PREFS_KV;
  if (!kv || !request) return null;
  try {
    const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
    const now = new Date();
    const bucket = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
    const key = `rl:${ip}:${bucket}`;
    const currentRaw = await kv.get(key);
    const current = Number.parseInt(currentRaw || "0", 10) || 0;
    if (current >= limit) {
      return new Response(
        JSON.stringify({ ok: false, error: "rate_limited", limit }),
        {
          status: 429,
          headers: { "content-type": "application/json; charset=utf-8" }
        }
      );
    }
    await kv.put(key, String(current + 1), { expirationTtl: 60 });
    return null;
  } catch (err) {
    console.warn("[rateLimit] error", err?.message || err);
    return null;
  }
}

async function handleHealthz(env) {
  let d1 = "ok";
  try {
    if (!env?.D1_DB) throw new Error("no D1");
    await env.D1_DB.prepare("SELECT 1").first();
  } catch (err) {
    if (err) console.warn("[healthz] d1 ping failed", err?.message || err);
    d1 = "fail";
  }

  const missing = [];
  for (const name of [
    "RAPIDAPI_KEY",
    "LEXICON_API_KEY",
    "OPENAI_API_KEY",
    "SPOONACULAR_KEY",
    "EDAMAM_APP_ID",
    "EDAMAM_APP_KEY"
  ]) {
    if (!env?.[name]) missing.push(name);
  }

  return okJson({
    ok: true,
    d1,
    secrets_missing: missing,
    ts: Math.floor(Date.now() / 1000)
  });
}

// --- Metrics helpers (D1) -------------------------------------------------
const METRICS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS metrics (
  ts INTEGER DEFAULT (strftime('%s','now')),
  name TEXT,
  value INTEGER
)`;

async function ensureMetricsTable(env) {
  if (!env?.D1_DB) return false;
  if (ensureMetricsTable._ready) return true;
  try {
    await env.D1_DB.prepare(METRICS_TABLE_SQL).run();
    ensureMetricsTable._ready = true;
    return true;
  } catch (err) {
    console.warn("[metrics] ensure table failed", err?.message || err);
    return false;
  }
}
ensureMetricsTable._ready = false;

async function recordMetric(env, name, delta = 1) {
  if (!env?.D1_DB || !name) return;
  const ready = await ensureMetricsTable(env);
  if (!ready) return;
  try {
    await env.D1_DB.prepare("INSERT INTO metrics (name, value) VALUES (?, ?)")
      .bind(name, delta)
      .run();
  } catch (err) {
    console.warn("[metrics] write failed", err?.message || err);
  }
}

// --- Stats helpers (D1) ---
function dayStrUTC(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}
async function bumpDaily(
  env,
  {
    jobs = 0,
    lex_ok = 0,
    lex_live = 0,
    lex_err = 0,
    rap_ok = 0,
    rap_err = 0
  } = {}
) {
  if (!env.D1_DB) return;
  const day = dayStrUTC();
  try {
    await env.D1_DB.prepare(
      `
    INSERT INTO daily_stats(day, jobs, lexicon_ok, lexicon_live, lexicon_err, rapid_ok, rapid_err)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET
      jobs = jobs + excluded.jobs,
      lexicon_ok = lexicon_ok + excluded.lexicon_ok,
      lexicon_live = lexicon_live + excluded.lexicon_live,
      lexicon_err = lexicon_err + excluded.lexicon_err,
      rapid_ok = rapid_ok + excluded.rapid_ok,
      rapid_err = rapid_err + excluded.rapid_err
  `
    )
      .bind(day, jobs, lex_ok, lex_live, lex_err, rap_ok, rap_err)
      .run();
    await recordMetric(env, "d1:daily_stats:upsert_ok");
  } catch (err) {
    await recordMetric(env, "d1:daily_stats:upsert_fail");
    throw err;
  }
}
async function bumpApi(env, service, { calls = 0, ok = 0, err = 0 } = {}) {
  if (!env.D1_DB) return;
  const day = dayStrUTC();
  try {
    await env.D1_DB.prepare(
      `
    INSERT INTO api_usage(day, service, calls, ok, err)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(day, service) DO UPDATE SET
      calls = calls + excluded.calls,
      ok    = ok    + excluded.ok,
      err   = err   + excluded.err
  `
    )
      .bind(day, service, calls, ok, err)
      .run();
    await recordMetric(env, "d1:api_usage:upsert_ok");
  } catch (error) {
    await recordMetric(env, "d1:api_usage:upsert_fail");
    throw error;
  }
}

// [40.4] — lightweight status counters in KV (best-effort)
const STATUS_KV_KEY = "meta/uber_test_status_v1";

async function readStatusKV(env) {
  if (!env?.LEXICON_CACHE) return null;
  try {
    const raw = await env.LEXICON_CACHE.get(STATUS_KV_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function bumpStatusKV(env, delta = {}) {
  if (!env?.LEXICON_CACHE) return;
  try {
    const cur = (await readStatusKV(env)) || {
      updated_at: null,
      counts: {
        live: 0,
        cache: 0,
        address_immediate: 0,
        address_job: 0,
        location_job: 0,
        gps_search: 0,
        debug: 0,
        errors_4xx: 0,
        errors_5xx: 0,
        ratelimits_429: 0
      }
    };
    for (const [k, v] of Object.entries(delta)) {
      if (typeof cur.counts[k] !== "number") cur.counts[k] = 0;
      cur.counts[k] += Number(v) || 0;
    }
    cur.updated_at = new Date().toISOString();
    await env.LEXICON_CACHE.put(STATUS_KV_KEY, JSON.stringify(cur), {
      expirationTtl: 7 * 24 * 3600
    });
  } catch {}
}

// === Menu cache helpers (KV) ===============================================
// Key format is stable so identical (query,address,us) requests reuse the same value.
function cacheKeyForMenu(query, address, forceUS = false) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  const a = String(address || "")
    .trim()
    .toLowerCase();
  const u = forceUS ? "us1" : "us0";
  return `menu/${encodeURIComponent(q)}|${encodeURIComponent(a)}|${u}.json`;
}

// Read a cached menu snapshot from KV. Returns { savedAt, data } or null.
async function readMenuFromCache(env, key) {
  if (!env?.LEXICON_CACHE) return null;
  try {
    const raw = await env.LEXICON_CACHE.get(key);
    if (!raw) return null;
    const js = JSON.parse(raw);
    // Expect shape: { savedAt: ISO, data: { query, address, forceUS, items: [...] } }
    if (!js || typeof js !== "object" || !js.data) return null;
    return js;
  } catch {
    return null;
  }
}

// Write a cached menu snapshot to KV (best-effort).
async function writeMenuToCache(env, key, data) {
  if (!env?.LEXICON_CACHE) return false;
  try {
    const body = JSON.stringify({ savedAt: new Date().toISOString(), data });
    await env.LEXICON_CACHE.put(key, body, { expirationTtl: MENU_TTL_SECONDS });
    return true;
  } catch {
    return false;
  }
}
// ==========================================================================

// ---- Network helpers ----
function cleanHost(h) {
  const s = (h || "").trim();
  return s.replace(/\s+/g, "");
}
function normalizeBase(u) {
  return (u || "").trim().replace(/\/+$/, "");
}
function buildLexiconAnalyzeCandidates(base) {
  const b = normalizeBase(base);
  if (!b) return [];
  // Try the usual suspects, in order of likelihood
  return [
    `${b}/v1/analyze`,
    `${b}/analyze`,
    `${b}/api/analyze`,
    `${b}/v1/lexicon/analyze`
  ];
}

async function callRapid(env, query, address) {
  const host = cleanHost(env.RAPIDAPI_HOST);
  const apiKey = env.RAPIDAPI_KEY || env.RAPID_API_KEY;
  if (!host || !apiKey) throw new Error("RapidAPI bindings missing");
  const qs = new URLSearchParams({ query, address }).toString();
  const url = `https://${host}/v1/search?${qs}`;
  const r = await fetch(url, {
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": host,
      Accept: "application/json"
    }
  });
  if (!r.ok) throw new Error(`RapidAPI ${r.status}`);
  return r.json();
}
async function callLexicon(env, text, lang = "en") {
  const base = normalizeBase(env.LEXICON_API_URL);
  const key = env.LEXICON_API_KEY;
  if (!base || !key)
    throw new Error("LEXICON_API_URL or LEXICON_API_KEY missing");

  const candidates = buildLexiconAnalyzeCandidates(base);
  const headersVariants = [
    // Bearer first (some servers prefer this)
    (k) => ({
      Authorization: `Bearer ${k}`,
      "Content-Type": "application/json",
      "Accept-Language": lang
    }),
    // x-api-key header fallback
    (k) => ({
      "x-api-key": k,
      "Content-Type": "application/json",
      "Accept-Language": lang
    })
  ];

  const payload = { text, lang, normalize: { diacritics: "fold" } };

  // Try POST first, then GET fallback with ?text=...
  for (const url of candidates) {
    // POST variants
    for (const mkHeaders of headersVariants) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: mkHeaders(key),
          body: JSON.stringify(payload)
        });
        // Some servers respond 404 for wrong path → continue trying others
        if (r.status === 404) continue;
        if (r.status === 401) continue; // try next header style/path
        if (!r.ok) continue;

        const js = await r.json().catch(() => null);
        if (js)
          return {
            ok: true,
            mode: "endpoint_analyze",
            data: js,
            endpoint: url,
            auth: r.headers.get("www-authenticate") || "ok"
          };
      } catch (_) {
        /* keep trying */
      }
    }

    // GET variants (?text=..., &lang=...)
    const u = new URL(url);
    u.searchParams.set("text", String(text || ""));
    u.searchParams.set("lang", String(lang || "en"));
    u.searchParams.set("normalize", "diacritics:fold");

    for (const mkHeaders of headersVariants) {
      try {
        const r = await fetch(u.toString(), {
          method: "GET",
          headers: mkHeaders(key)
        });
        if (r.status === 404) continue;
        if (r.status === 401) continue;
        if (!r.ok) continue;

        const js = await r.json().catch(() => null);
        if (js)
          return {
            ok: true,
            mode: "endpoint_analyze",
            data: js,
            endpoint: u.toString(),
            auth: r.headers.get("www-authenticate") || "ok"
          };
      } catch (_) {
        /* keep trying */
      }
    }
  }

  // If all direct calls fail, gracefully fall back to live shards
  const js = await lexiconAnalyzeViaShards(env, text, lang);
  return { ok: true, mode: "live_shards", data: js };
}
async function lexiconAnalyzeViaShards(env, text, lang = "en") {
  const base = normalizeBase(env.LEXICON_API_URL);
  const key = env.LEXICON_API_KEY;

  let index = null;
  for (const url of [`${base}/v1/index`, `${base}/v1/shards`]) {
    try {
      const r = await fetch(url, { headers: { "x-api-key": key } });
      if (!r.ok) continue;
      index = await r.json();
      break;
    } catch {}
  }

  const names = index
    ? pickIngredientShardNamesFromIndex(index)
    : STATIC_INGREDIENT_SHARDS;

  const entries = [];
  for (const name of names) {
    try {
      const url = `${base}/v1/shards/${name}`;
      const r = await fetch(url, { headers: { "x-api-key": key } });
      if (!r.ok) continue;
      const js = await r.json();
      if (Array.isArray(js?.entries)) {
        for (const e of js.entries) entries.push(e);
      }
    } catch {}
  }

  const corpus = lc(text || "");
  const stoplist = new Set(["and", "with", "of", "in", "a", "the", "or"]);
  const ingredient_hits_raw = [];
  const seenCanon = new Set();

  for (const entry of entries) {
    const canonical = lc(entry?.canonical ?? entry?.name ?? entry?.term ?? "");
    const classes = Array.isArray(entry?.classes) ? entry.classes.map(lc) : [];
    const tags = Array.isArray(entry?.tags) ? entry.tags.map(lc) : [];
    const weight = typeof entry?.weight === "number" ? entry.weight : undefined;

    const terms = entryTerms(entry).filter((t) => !stoplist.has(t));
    let matchedTerm = null;
    for (const t of terms) {
      if (t.length < 2) continue;
      if (termMatches(corpus, t)) {
        matchedTerm = t;
        break;
      }
    }
    if (!matchedTerm) continue;

    const canonKey = canonical || matchedTerm;
    if (seenCanon.has(canonKey)) continue;
    seenCanon.add(canonKey);

    ingredient_hits_raw.push({
      term: matchedTerm,
      canonical: canonical || matchedTerm,
      classes,
      tags,
      weight,
      allergens: Array.isArray(entry?.allergens) ? entry.allergens : undefined,
      fodmap: entry?.fodmap ?? entry?.fodmap_level,
      source: "lexicon_live_shards"
    });
  }

  const HITS_LIMIT = 25;
  const hits = tidyIngredientHits(ingredient_hits_raw, HITS_LIMIT).map((h) => ({
    term: h.term,
    canonical: h.canonical,
    classes: h.classes,
    tags: h.tags,
    allergens: h.allergens,
    fodmap: h.fodmap,
    source: h.source
  }));

  return {
    hits,
    from: "lexicon_live_shards",
    shard_count: names.length,
    entries_scanned: entries.length
  };
}

// ---- Response helpers ----
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}
// [37C] ── Same as jsonResponse, but lets us add extra headers
function jsonResponseWith(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders }
  });
}
// [38.12] — JSON response with TummyBuddy analytics headers (+ trace mirrors)
function jsonResponseWithTB(
  bodyObj,
  status = 200,
  { ctx, rid, source = "", cache = "", warning = false } = {},
  extraHeaders = {}
) {
  const version = ctx?.version || "unknown";
  const served_at = ctx?.served_at || new Date().toISOString();
  const requestId =
    rid ||
    (crypto?.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const traceHost = bodyObj?.trace?.host || "";
  const traceUsed = bodyObj?.trace?.used_path || "";

  const base = {
    "content-type": "application/json",
    "X-TB-Version": String(version),
    "X-TB-Served-At": String(served_at),
    "X-TB-Request-Id": String(requestId),
    "X-TB-Source": String(source || ""),
    "X-TB-Cache": String(cache || ""),
    ...(traceHost ? { "X-TB-Trace-Host": String(traceHost) } : {}),
    ...(traceUsed ? { "X-TB-Trace-Used-Path": String(traceUsed) } : {})
  };
  if (warning) base["X-TB-Warning"] = "1";

  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: { ...base, ...extraHeaders }
  });
}
// [38.1] — attach analytics fields to any JSON body (success paths only)
function withBodyAnalytics(body, ctx, request_id, trace = {}) {
  return {
    ...body,
    served_at: ctx?.served_at || new Date().toISOString(),
    version: ctx?.version || "unknown",
    request_id:
      request_id ||
      (crypto?.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    trace
  };
}
// [37C] ── Error response with analytics headers
// [37C] ── Error response with analytics headers (accepts ctx OR env)
function errorResponseWith(
  errBody,
  status = 400,
  envOrCtx,
  meta = {},
  request_id = null
) {
  const hasCtx =
    envOrCtx &&
    typeof envOrCtx === "object" &&
    "served_at" in envOrCtx &&
    "version" in envOrCtx;
  const served_at = hasCtx ? envOrCtx.served_at : new Date().toISOString();
  const version = hasCtx ? envOrCtx.version : getVersion(envOrCtx);

  const rid =
    request_id ||
    (typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const body = {
    ...errBody,
    served_at,
    version,
    request_id: rid,
    ...(meta?.trace ? { trace: meta.trace } : {})
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "X-TB-Version": String(version),
      "X-TB-Served-At": String(served_at),
      "X-TB-Error": "1",
      "X-TB-Request-Id": String(rid),
      ...(meta || {})
    }
  });
}
// [40.1] — friendly 429 response with Retry-After header
function rateLimitResponse(
  ctxOrEnv,
  rid,
  trace,
  secs = 30,
  source = "upstream-failure"
) {
  const safeSecs = Math.max(1, Number(secs) || 30);
  return errorResponseWith(
    {
      ok: false,
      error: "Our menu provider is rate-limiting right now.",
      hint: `Please retry in ~${safeSecs} seconds.`,
      retry_after_seconds: safeSecs
    },
    429,
    ctxOrEnv,
    {
      "X-TB-Source": source,
      "X-TB-Upstream-Status": "429",
      "Retry-After": String(safeSecs),
      trace: safeTrace(trace)
    },
    rid
  );
}
// [38.4] — Friendly "no candidates" 404 with analytics + examples
function notFoundCandidates(ctxOrEnv, rid, trace, { query, address }) {
  const examples = [
    "/menu/uber-test?query=McDonald%27s&address=Miami,%20FL",
    "/menu/uber-test?query=Starbucks&address=Seattle,%20WA",
    "/menu/uber-test?query=Chipotle&address=Austin,%20TX"
  ];
  return errorResponseWith(
    {
      ok: false,
      error: "No candidates found near that address.",
      hint: "Try a nearby city, add ZIP, or pick a more exact restaurant name.",
      echo: { query, address },
      examples
    },
    404,
    ctxOrEnv,
    { "X-TB-Source": "no-candidates", trace: safeTrace(trace) },
    rid
  );
}
function corsJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      ...CORS_ALL
    }
  });
}

// ---- Handler wrappers (clarity) ----
function handleFetch(request, env, ctx) {
  return _worker_impl.fetch(request, env, ctx);
}
function handleQueue(batch, env, ctx) {
  return _worker_impl.queue ? _worker_impl.queue(batch, env, ctx) : undefined;
}
function handleScheduled(controller, env, ctx) {
  return _worker_impl.scheduled
    ? _worker_impl.scheduled(controller, env, ctx)
    : undefined;
}
function normPathname(u) {
  let p = u.pathname || "/";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

const _exports = {
  async fetch(request, env, ctx) {
    return handleFetch(request, env, ctx);
  },
  async queue(batch, env, ctx) {
    return handleQueue(batch, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return handleScheduled(controller, env, ctx);
  }
};
export default _exports;
