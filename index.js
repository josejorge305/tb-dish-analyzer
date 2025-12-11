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
function tbWhoamiHeaders(env) {
  return {
    "x-tb-worker": env.WORKER_NAME || "tb-dish-processor-production",
    "x-tb-env": env.ENV || "production",
    "x-tb-git": env.GIT_SHA || "n/a",
    "x-tb-built": env.BUILT_AT || "n/a"
  };
}
function tbWhoami(env) {
  const body = JSON.stringify(
    {
      worker: env.WORKER_NAME || "tb-dish-processor-production",
      env: env.ENV || "production",
      git_sha: env.GIT_SHA || "n/a",
      built_at: env.BUILT_AT || "n/a"
    },
    null,
    2
  );
  return new Response(body, {
    headers: { "content-type": "application/json", ...tbWhoamiHeaders(env) }
  });
}
function cid(h) {
  return h.get("x-correlation-id") || crypto.randomUUID();
}
const _cid = (h) => h.get("x-correlation-id") || crypto.randomUUID();
function isBinaryContentType(contentType = "") {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return (
    ct.includes("application/octet-stream") ||
    ct.includes("application/pdf") ||
    ct.includes("application/zip") ||
    ct.startsWith("image/") ||
    ct.startsWith("audio/") ||
    ct.startsWith("video/") ||
    ct.startsWith("font/")
  );
}
function withTbWhoamiHeaders(response, env) {
  if (!(response instanceof Response)) return response;
  const ct =
    (response.headers && response.headers.get
      ? response.headers.get("content-type")
      : "") || "";
  if (isBinaryContentType(ct)) return response;
  const headers = new Headers(response.headers || undefined);
  const baseHeaders = tbWhoamiHeaders(env);
  for (const [key, value] of Object.entries(baseHeaders)) {
    if (value == null) continue;
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
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
  const tier = await (env.MENUS_CACHE ? env.MENUS_CACHE.get(kvKey) : null);
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

const EVIDENCE_GUIDELINES = `
EVIDENCE & EXPLANATION RULES (VERY IMPORTANT):

- Every reason or explanation you output must briefly say WHAT you are claiming and WHY you think it.
- Always mention WHERE your evidence comes from when relevant:
  - "menu description mentions ..." if you relied on the dish name or menuDescription.
  - "the recipe used for this analysis includes ..." if you relied on the resolved ingredient list (ingredients from recipe / providers).
  - "the nutrition summary for this dish shows ..." if you used the numeric nutrition_summary (kcal, grams, mg).
  - "typical recipes for this dish usually include ..." only when you are using common recipe patterns.
  - "based on general nutritional / medical knowledge" for organ impact explanations.
- Do NOT just say "contains X" without context. Always mention whether the evidence is from:
  - menu text,
  - recipe ingredients,
  - nutrition databases,
  - or typical recipes and general knowledge.
- Example for meatballs:
  - Good: "Typical meatball recipes use egg as a binder, and the recipe used for this analysis includes egg yolks."
  - Bad: "Contains egg yolks." (this hides where the information came from).
`;

/**
 * @typedef {string} TbComponentId
 */

/**
 * @typedef {Object} TbSelectionAnalysisInput
 * @property {Array<any>|null|undefined} plate_components
 * @property {Array<any>|null|undefined} allergen_breakdown
 * @property {any|null|undefined} organs
 * @property {any|null|undefined} nutrition_summary
 * @property {any|null|undefined} nutrition_breakdown
 * @property {Array<any>|null|undefined} [allergen_flags]
 * @property {any|null|undefined} [fodmap_flags]
 * @property {any|null|undefined} [lactose_flags]
 */

/**
 * @typedef {Object} TbSelectionAnalysisResult
 * @property {TbComponentId[]} componentIds
 * @property {Array<any>} [components]
 * @property {Array<any>} [allergens]
 * @property {Array<any>} [nutrition]
 * @property {any} [combined_nutrition]
 * @property {Array<any>} [combined_allergens]
 * @property {any} [combined_fodmap]
 * @property {any} [combined_lactose]
 * @property {any} [fodmap]
 * @property {any} [lactose]
 * @property {any} [lifestyle]
 * @property {any} [organs]
 */

/** @type {string|null} */
let fatSecretCachedToken = null;
/** @type {number|null} */
let fatSecretTokenExpiresAt = null;

/**
 * Fetches an image from a URL and returns a base64-encoded string.
 *
 * @param {string} imageUrl
 * @returns {Promise<string|null>}
 */
async function fetchImageAsBase64(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl) {
    return null;
  }

  const resp = await fetch(imageUrl);
  if (!resp.ok) {
    return null;
  }

  const arrayBuffer = await resp.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

const DEFAULT_SERVINGS_BY_CATEGORY = {
  "Pasta & Pizza": 1.3,
  "Sandwiches & Burgers": 1.2,
  Salads: 1.1,
  Mains: 1.2,
  Kids: 1.0,
  Desserts: 1.0,
  Appetizers: 1.0,
  Other: 1.0
};

const DIET_TITLE_KEYWORDS = [
  "lighter",
  "light ",
  " light-",
  "low fat",
  "low-fat",
  "low calorie",
  "low-calorie",
  "lean ",
  "healthy ",
  "healthy-",
  "skinny",
  "diet ",
  "diet-"
];

function isDietTitle(title) {
  if (!title || typeof title !== "string") return false;
  const t = title.toLowerCase();
  return DIET_TITLE_KEYWORDS.some((kw) => t.includes(kw));
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

/**
 * Fetches (and caches) a FatSecret OAuth2 access token using client_credentials.
 *
 * @param {any} env
 * @returns {Promise<string|null>} access token or null if unavailable
 */
async function getFatSecretAccessToken(env) {
  const clientId = env.FATSECRET_CLIENT_ID;
  const clientSecret = env.FATSECRET_CLIENT_SECRET;
  const scope = "image-recognition";

  if (!clientId || !clientSecret) {
    // No credentials configured; do not throw, just return null.
    return null;
  }

  const now = Date.now();

  // Return cached token if still valid (with small safety margin)
  if (
    fatSecretCachedToken &&
    fatSecretTokenExpiresAt &&
    now < fatSecretTokenExpiresAt - 60_000
  ) {
    return fatSecretCachedToken;
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("scope", scope);

  let resp;
  try {
    resp = await fetch("https://oauth.fatsecret.com/connect/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
  } catch (e) {
    return null;
  }

  if (!resp.ok) {
    return null;
  }

  /** @type {{ access_token?: string, expires_in?: number }} */
  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }

  if (!data.access_token) {
    return null;
  }

  const expiresInSec =
    typeof data.expires_in === "number" ? data.expires_in : 86400;
  fatSecretCachedToken = data.access_token;
  fatSecretTokenExpiresAt = Date.now() + expiresInSec * 1000;

  return fatSecretCachedToken;
}

/**
 * Calls FatSecret Image Recognition v2 for a given image URL.
 *
 * @param {any} env
 * @param {string} imageUrl
 * @returns {Promise<{ ok: boolean, raw?: any, error?: string }>}
 */
async function callFatSecretImageRecognition(env, imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl) {
    return { ok: false, error: "invalid_image_url" };
  }

  const token = await getFatSecretAccessToken(env);
  if (!token) {
    return { ok: false, error: "fatsecret_token_unavailable" };
  }

  const imageB64 = await fetchImageAsBase64(imageUrl);
  if (!imageB64) {
    return { ok: false, error: "image_fetch_failed" };
  }

  const region = env.FATSECRET_REGION || "US";
  const language = env.FATSECRET_LANGUAGE || "en";

  const body = {
    image_b64: imageB64,
    include_food_data: true,
    region,
    language
  };

  let resp;
  try {
    resp = await fetch(
      "https://platform.fatsecret.com/rest/image-recognition/v2",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );
  } catch (e) {
    return {
      ok: false,
      error: "fatsecret_fetch_error:" + String(e && e.message ? e.message : e)
    };
  }

  if (!resp.ok) {
    return { ok: false, error: "fatsecret_http_" + resp.status };
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return {
      ok: false,
      error: "fatsecret_json_error:" + String(e && e.message ? e.message : e)
    };
  }

  return { ok: true, raw: data };
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
async function callJson(url, opts = {}) {
  const fetcher = opts.fetcher || fetch;
  const resp = await fetcher(url, {
    method: opts.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(opts.headers || {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).catch((err) => {
    return { _fetchError: err?.message || String(err) };
  });

  if (!resp || resp._fetchError) {
    return {
      ok: false,
      error: "fetch_failed",
      detail: resp && resp._fetchError
    };
  }

  const text = await resp.text().catch(() => "");
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return {
    ok: resp.ok,
    status: resp.status,
    data: json
  };
}
function okJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
// --- Simple Google Places search for /restaurants/find (gateway inline) ---
async function handleRestaurantsFindGateway(env, url) {
  const searchParams = url.searchParams;
  const q = (searchParams.get("query") || "").trim();
  const latStr = searchParams.get("lat");
  const lngStr = searchParams.get("lng");
  const radiusStr = searchParams.get("radius") || "6000";

  const apiKey = env.GOOGLE_MAPS_API_KEY;
  // If we don't have a key, just return an empty stub so the app doesn't explode
  if (!apiKey) {
    return okJson({
      ok: true,
      source: "google_places.stub",
      items: []
    });
  }

  try {
    const params = new URLSearchParams();
    params.set("query", q || "restaurant");
    if (latStr && lngStr) {
      params.set("location", `${latStr},${lngStr}`);
      params.set("radius", String(radiusStr));
    }
    params.set("type", "restaurant");
    params.set("key", apiKey);

    const gUrl =
      "https://maps.googleapis.com/maps/api/place/textsearch/json?" +
      params.toString();

    const res = await fetch(gUrl);
    const txt = await res.text();

    if (!res.ok) {
      return okJson({
        ok: false,
        source: "google_places_http_error",
        status: res.status,
        body: txt.slice(0, 500)
      });
    }

    let data = {};
    try {
      data = txt ? JSON.parse(txt) : {};
    } catch {
      return okJson({
        ok: false,
        source: "google_places_non_json",
        body: txt.slice(0, 500)
      });
    }

    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) {
      return okJson({
        ok: true,
        source: "google_places",
        items: []
      });
    }

    const items = results.map((r, idx) => {
      const loc = r.geometry && r.geometry.location ? r.geometry.location : {};
      return {
        id: r.place_id || `google-${idx}`,
        name: r.name || "Unnamed place",
        provider: "google",
        address: r.formatted_address || "",
        city: "",
        country: "",
        lat: loc.lat ?? null,
        lng: loc.lng ?? null,
        placeId: r.place_id || `google-${idx}`,
        url: r.website || ""
      };
    });

    return okJson({
      ok: true,
      source: "google_places",
      items
    });
  } catch (err) {
    return okJson({
      ok: false,
      source: "google_places_error",
      error: String(err?.message || err)
    });
  }
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

  const forceReanalyze = url.searchParams.get("force_reanalyze") === "1";
  const recipeResult = await resolveRecipeWithCache(env, {
    dishTitle: finalDish,
    placeId: "",
    cuisine: url.searchParams.get("cuisine") || "",
    lang: url.searchParams.get("lang") || "en",
    forceReanalyze,
    classify: false,
    shape: null,
    parse: true,
    userId: userId || "",
    devFlag: url.searchParams.get("dev") === "1"
  });
  const rawIngredients = Array.isArray(recipeResult?.ingredients)
    ? recipeResult.ingredients
    : [];
  const recipe_debug = {
    provider:
      recipeResult?.out?.provider ??
      recipeResult?.source ??
      recipeResult?.responseSource ??
      null,
    reason: recipeResult?.notes || null,
    card_ingredients: rawIngredients.length,
    providers_order: providerOrder(env),
    attempts: recipeResult?.attempts ?? [],
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
  try {
    const fatsecretResult = await classifyIngredientsWithFatSecret(
      env,
      ingredients.map((i) => i?.name || "").filter(Boolean),
      "en"
    );
    const fatsecretHits =
      fatsecretResult && fatsecretResult.ok
        ? fatsecretResult.allIngredientHits || []
        : [];
    const inferredTextHits = inferHitsFromText(finalDish, "");
    const inferredIngredientHits = inferHitsFromIngredients(ingredients);
    const combinedHits = [
      ...fatsecretHits,
      ...(Array.isArray(inferredTextHits) ? inferredTextHits : []),
      ...(Array.isArray(inferredIngredientHits) ? inferredIngredientHits : [])
    ];

    organ = await assessOrgansLocally(env, {
      ingredients,
      user_flags: user_prefs,
      lex_hits: combinedHits
    });
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

// ---------- STRICT RESTAURANT IDENTITY HELPERS ----------

// basic text normalization: lowercase, remove punctuation, collapse spaces
function normalizeText(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9\\s]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

// remove generic filler words from restaurant names
const GENERIC_NAME_TOKENS = new Set([
  "the",
  "restaurant",
  "kitchen",
  "cafe",
  "cafeteria",
  "bar",
  "grill",
  "house",
  "food",
  "eatery",
  "diner",
  "co",
  "company",
  "llc",
  "inc"
]);

function nameTokens(str) {
  const norm = normalizeText(str);
  if (!norm) return [];
  return norm.split(" ").filter((t) => t && !GENERIC_NAME_TOKENS.has(t));
}

function tokenSetSimilarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);

  let intersect = 0;
  for (const t of aSet) {
    if (bSet.has(t)) intersect++;
  }
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersect / union;
}

// simple Levenshtein distance for small strings
function levenshtein(a, b) {
  a = normalizeText(a);
  b = normalizeText(b);
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;

  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1, // deletion
        dp[j - 1] + 1, // insertion
        prev + cost // substitution
      );
      prev = tmp;
    }
  }
  return dp[n];
}

// strict-ish restaurant name match
function strictNameMatch(googleName, uberName) {
  if (!googleName || !uberName) return false;
  const gNorm = normalizeText(googleName);
  const uNorm = normalizeText(uberName);
  if (!gNorm || !uNorm) return false;

  if (gNorm === uNorm) return true;

  const dist = levenshtein(gNorm, uNorm);
  if (dist <= 2) return true;

  const gTokens = nameTokens(googleName);
  const uTokens = nameTokens(uberName);
  const sim = tokenSetSimilarity(gTokens, uTokens);
  return sim >= 0.8; // high overlap
}

// address normalization: keep digits + letters, drop punctuation
function normalizeAddress(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\\s]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

// try to build a comparable street+zip "signature"
function addressSignature(addrObjOrString) {
  if (!addrObjOrString) return "";
  if (typeof addrObjOrString === "string") {
    return normalizeAddress(addrObjOrString);
  }
  const parts = [];
  if (addrObjOrString.streetAddress || addrObjOrString.address) {
    parts.push(addrObjOrString.streetAddress || addrObjOrString.address);
  }
  if (addrObjOrString.city) parts.push(addrObjOrString.city);
  if (addrObjOrString.postalCode || addrObjOrString.zip) {
    parts.push(addrObjOrString.postalCode || addrObjOrString.zip);
  }
  return normalizeAddress(parts.join(" "));
}

function strictAddressMatch(googleAddress, uberLocation) {
  const gSig = addressSignature(googleAddress);
  const uSig = addressSignature(uberLocation);
  if (!gSig || !uSig) return false;

  // require at least the same street + zip-ish tokens
  const gTokens = gSig.split(" ");
  const uTokens = uSig.split(" ");
  const gSet = new Set(gTokens);
  let overlap = 0;
  for (const t of uTokens) {
    if (gSet.has(t)) overlap++;
  }
  const minLen = Math.min(gTokens.length, uTokens.length);
  if (!minLen) return false;

  const ratio = overlap / minLen;
  return ratio >= 0.7;
}

// ---------- GATEWAY: Section-level noise filter ----------
function isBannedSectionName(sectionName) {
  const s = (sectionName || "").toLowerCase().trim();
  if (!s) return false;

  const bannedExact = [
    "drinks",
    "beverages",
    "soft drinks",
    "sodas",
    "cocktails",
    "beer",
    "wine",
    "bar",
    "alcohol",
    "utensils",
    "cutlery",
    "plasticware",
    "plastic ware",
    "silverware",
    "napkins",
    "packaging",
    "extras",
    "extra sauces",
    "add-ons",
    "addons",
    "add ons",
    "sauces",
    "sauces & dressings",
    "dressings",
    "condiments",
    "fees",
    "charges"
  ];

  const bannedContains = [
    "utensil",
    "cutlery",
    "plastic",
    "silverware",
    "napkin",
    "straw",
    "extra",
    "add-on",
    "addon",
    "add on",
    "sauce",
    "condiment",
    "dressing",
    "fee",
    "charge",
    "packaging",
    "service fee",
    "delivery fee"
  ];

  if (bannedExact.includes(s)) return true;
  if (bannedContains.some((w) => s.includes(w))) return true;

  return false;
}

// ---------- GATEWAY: Item-level noise filters ----------

const NOISE_KEYWORDS = [
  // drinks
  "coke",
  "sprite",
  "soda",
  "juice",
  "oj",
  "orange juice",
  "redbull",
  "red bull",
  "perrier",
  "sparkling",
  "bottle",
  "water",
  "tea",
  "coffee",
  "lemonade",
  "iced",
  "energy",
  // merch / bottles
  "5oz",
  "btl",
  "merch",
  // raw counts of wings / boneless (not plated dishes)
  "5 wings",
  "10 wings",
  "5 boneless",
  "10 boneless",
  // pure sides
  "side",
  "fries",
  "tots",
  "waffle",
  "onion rings",
  "chips"
];

function isNoiseItem(name, description = "") {
  const text = `${name} ${description}`.toLowerCase();
  return NOISE_KEYWORDS.some((k) => text.includes(k));
}

// Final hard blocklist — removes ANY item containing these tokens, no exceptions.
const HARD_BLOCKLIST = [
  // drinks / beverages
  "oj",
  "orange juice",
  "juice",
  "soda",
  "redbull",
  "red bull",
  "perrier",
  "sparkling",
  "water",
  "iced tea",
  "tea",
  "coffee",
  "energy",
  "drink",

  // merch / bottles / sauces only
  "5oz",
  "btl",
  "bottle",
  "merch",

  // wings / boneless counted portions only (not platters)
  "5 wings",
  "10 wings",
  "5 boneless",
  "10 boneless",
  "5 bone",
  "10 bone",

  // pure sides that should NOT show unless part of a composed dish
  "side of",
  "side fries",
  "side tots",
  "side waffle",
  "side chips",
  "fries only",
  "tots only",

  // pure add-ons
  "add cheese",
  "extra",
  "add-on"
];

function hardBlockItem(name, description = "") {
  const text = `${name} ${description}`.toLowerCase();
  return HARD_BLOCKLIST.some((k) => text.includes(k));
}

function isLikelyDrink(name, section) {
  const n = (name || "").toLowerCase().trim();
  const s = (section || "").toLowerCase().trim();

  const drinkSections = [
    "drinks",
    "beverages",
    "soft drinks",
    "sodas",
    "juices",
    "coffee",
    "tea",
    "bar",
    "cocktails",
    "beer",
    "wine"
  ];

  const drinkKeywords = [
    "water",
    "bottled water",
    "sparkling water",
    "mineral water",
    "soda",
    "soft drink",
    "coke",
    "coca cola",
    "pepsi",
    "sprite",
    "fanta",
    "ginger ale",
    "root beer",
    "juice",
    "orange juice",
    "apple juice",
    "lemonade",
    "iced tea",
    "ice tea",
    "tea",
    "coffee",
    "latte",
    "espresso",
    "cappuccino",
    "mocha",
    "hot chocolate",
    "hot cocoa",
    "milk",
    "milkshake",
    "shake",
    "smoothie",
    "energy drink",
    "gatorade",
    "powerade",
    "sports drink",
    "beer",
    "wine",
    "margarita",
    "cocktail"
  ];

  if (drinkSections.some((w) => s.includes(w))) return true;
  if (drinkKeywords.some((w) => n === w || n.includes(w))) return true;

  // Size/packaging hints
  if (/\b(2 ?l|20 ?oz|16 ?oz|12 ?oz|bottle|can|canned)\b/.test(n)) return true;

  return false;
}

function isLikelyUtensilOrPackaging(name, section) {
  const n = (name || "").toLowerCase().trim();
  const s = (section || "").toLowerCase().trim();

  const utensilSections = [
    "utensils",
    "cutlery",
    "plasticware",
    "plastic ware",
    "silverware",
    "napkins",
    "packaging"
  ];

  const utensilKeywords = [
    "utensil",
    "utensils",
    "plasticware",
    "plastic ware",
    "silverware",
    "cutlery",
    "fork",
    "knife",
    "spoon",
    "spoons",
    "chopsticks",
    "chopstick",
    "napkin",
    "napkins",
    "straw",
    "straws",
    "with utensils",
    "without utensils",
    "no utensils"
  ];

  const feeKeywords = [
    "service fee",
    "delivery fee",
    "packaging fee",
    "bag fee",
    "processing fee",
    "surcharge",
    "convenience fee",
    "extra fee",
    "misc fee",
    "charge",
    "charges"
  ];

  if (utensilSections.some((w) => s.includes(w))) return true;
  if (utensilKeywords.some((w) => n === w || n.includes(w))) return true;
  if (feeKeywords.some((w) => n === w || n.includes(w) || s.includes(w)))
    return true;

  return false;
}

function isLikelySideOrAddon(name, section, description) {
  const n = (name || "").toLowerCase().trim();
  const s = (section || "").toLowerCase().trim();
  const d = (description || "").toLowerCase().trim();

  const sideSections = [
    "sides",
    "side orders",
    "extras",
    "add-ons",
    "addons",
    "add ons",
    "sauces",
    "condiments",
    "dressings"
  ];

  const sideKeywords = [
    "side",
    "side of",
    "extra",
    "add",
    "add-on",
    "addon",
    "add on"
  ];

  const pureCondiments = [
    "sauce",
    "ketchup",
    "mustard",
    "mayo",
    "mayonnaise",
    "aioli",
    "ranch",
    "bbq",
    "barbecue",
    "hot sauce",
    "buffalo sauce",
    "blue cheese",
    "bleu cheese",
    "chipotle",
    "chipotle mayo",
    "guacamole",
    "sour cream",
    "salsa",
    "relish",
    "relish packet",
    "packet of relish"
  ];

  if (sideSections.some((w) => s.includes(w))) return true;

  if (n.startsWith("side ") || n.startsWith("side of ")) return true;
  if (n.startsWith("extra ") || n.startsWith("add ") || n.startsWith("add-on "))
    return true;

  const wordCount = n.split(/\s+/).filter(Boolean).length;
  if (wordCount === 1 && !d && pureCondiments.includes(n)) return true;

  if (pureCondiments.some((w) => n === w || n.includes(w))) return true;

  if (n.includes("packet") || n.includes("sachet")) return true;

  return false;
}

function filterMenuForDisplay(dishes = []) {
  if (!Array.isArray(dishes)) return [];

  const filtered = dishes.filter((d) => {
    const name = d.name || d.title || "";
    const section = d.section || "";
    const desc = d.description || "";

    if (!name) return false;

    // 1) Drop entire bad sections
    if (isBannedSectionName(section)) return false;

    // 2) Item-level checks
    if (isNoiseItem(name, desc)) return false;
    if (isLikelyDrink(name, section)) return false;
    if (isLikelyUtensilOrPackaging(name, section)) return false;
    if (isLikelySideOrAddon(name, section, desc)) return false;

    return true;
  });

  return dedupeItems(filtered);
}

// Remove duplicates by name + price + description
function dedupeItems(items) {
  const seen = new Set();
  const output = [];

  for (const it of items) {
    const key = `${(it.name || "").toLowerCase()}|${(it.description || "").toLowerCase()}|${it.rawPrice || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(it);
    }
  }
  return output;
}

// -----------------------------
// Batch LLM Menu Classifier (Tier 3)
// -----------------------------

// Normalize KV keys
function classifierCacheKey(name, description) {
  const key = `${name}||${description || ""}`.toLowerCase();
  return "menu-classifier:" + key;
}

// Fetch many items from KV
async function batchReadClassifierCache(env, items) {
  const results = {};
  for (const it of items) {
    const key = classifierCacheKey(it.name, it.description);
    const cached = await env.MENU_CLASSIFIER_CACHE.get(key, "json");
    if (cached) results[key] = cached;
  }
  return results;
}

// Write classifications back to KV
async function batchWriteClassifierCache(env, classified) {
  const ops = [];
  for (const entry of classified) {
    const key = classifierCacheKey(entry.name, entry.description);
    ops.push(
      env.MENU_CLASSIFIER_CACHE.put(
        key,
        JSON.stringify({
          category: entry.category,
          noise: entry.noise
        })
      )
    );
  }
  await Promise.all(ops);
}

// Batch LLM call
async function classifyMenuItemsLLM(env, items) {
  if (!items.length) return [];

  const payload = items.map((it) => ({
    name: it.name,
    description: it.description || ""
  }));

  const messages = [
    {
      role: "system",
      content:
        "You are a strict JSON menu item classifier. " +
        "You MUST return ONLY a valid JSON array of objects. No text outside JSON. " +
        'Each object MUST have: {"category": string, "noise": boolean}. ' +
        "No explanations, no markdown, no commentary."
    },
    {
      role: "user",
      content: JSON.stringify(payload)
    }
  ];

  const raw = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages });

  const text = raw?.output_text;
  if (!text || text.trim().length === 0) {
    return items.map(() => ({ category: "Other", noise: false }));
  }

  let clean = text
    .trim()
    .replace(/```json/gi, "")
    .replace(/```/g, "");

  let result;
  try {
    result = JSON.parse(clean);
  } catch (err) {
    result = items.map(() => ({ category: "Other", noise: false }));
  }

  return result;
}

// -----------------------------
// Tier 3 — Integrate Batch LLM Classification
// -----------------------------
async function applyLLMClassification(env, items) {
  // 1. Read from KV cache (fast path)
  const cachedMap = await batchReadClassifierCache(env, items);

  const needLLM = [];
  const final = [];

  for (const it of items) {
    const key = classifierCacheKey(it.name, it.description);
    const cached = cachedMap[key];

    if (cached) {
      final.push({
        ...it,
        llmCategory: cached.category,
        llmNoise: cached.noise
      });
    } else {
      needLLM.push(it);
    }
  }

  if (needLLM.length === 0) return final;

  const llmResults = await classifyMenuItemsLLM(env, needLLM);
  const toCache = [];

  for (let i = 0; i < needLLM.length; i++) {
    const it = needLLM[i];
    const llm = llmResults[i];

    final.push({
      ...it,
      llmCategory: llm.category,
      llmNoise: llm.noise
    });

    toCache.push({
      name: it.name,
      description: it.description || "",
      category: llm.category,
      noise: llm.noise
    });
  }

  await batchWriteClassifierCache(env, toCache);

  return final;
}

// -----------------------------
// Apply LLM Overrides to Final Categories
// -----------------------------
function applyLLMOverrides(items) {
  return items
    .filter((it) => !it.llmNoise)
    .map((it) => {
      const llmCat = it.llmCategory?.trim();

      const strongHeuristic = [
        "Mains",
        "Sandwiches & Burgers",
        "Appetizers",
        "Pasta & Pizza",
        "Salads",
        "Soups",
        "Desserts",
        "Kids"
      ].includes(it.canonicalCategory);

      const finalCategory = strongHeuristic
        ? it.canonicalCategory
        : llmCat || it.canonicalCategory;
      return {
        ...it,
        canonicalCategory: finalCategory
      };
    });
}

// Final normalization for wraps & salad bowls
function normalizeWrapsAndSaladBowls(items) {
  return items.map((it) => {
    const name = (it.name || "").toLowerCase();
    const section = (it.section || "").toLowerCase();
    let cat = it.canonicalCategory;

    if (name.includes("wrap") || section.includes("wrap")) {
      cat = "Sandwiches & Burgers";
    }

    if (
      name.includes("salad bowl") ||
      (name.includes("salad") && section.includes("bowl"))
    ) {
      cat = "Salads";
    }

    return {
      ...it,
      canonicalCategory: cat
    };
  });
}

// Final normalization for wraps & salad bowls (runs at the very end)
function finalNormalizeCategories(items) {
  return items.map((it) => {
    const name = (it.name || "").toLowerCase();
    const section = (it.section || "").toLowerCase();
    let cat = it.canonicalCategory;

    if (name.includes("wrap") || section.includes("wrap")) {
      cat = "Sandwiches & Burgers";
    }

    if (
      name.includes("salad bowl") ||
      (name.includes("salad") && section.includes("bowl"))
    ) {
      cat = "Salads";
    }

    return { ...it, canonicalCategory: cat };
  });
}

// ---------- GATEWAY: Canonical category classifier ----------

function canonicalCategoryFromSectionAndName(sectionName, dishName) {
  const s = (sectionName || "").toLowerCase();
  const n = (dishName || "").toLowerCase();

  if (
    /\b(appetizer|appetizers|starter|starters|small plates?|snacks?|tapas)\b/.test(
      s
    )
  ) {
    return "Appetizers";
  }

  if (/\b(salad|salads)\b/.test(s) || /\bsalad\b/.test(n)) {
    return "Salads";
  }

  if (/\b(soup|soups)\b/.test(s) || /\bsoup\b/.test(n)) {
    return "Soups";
  }

  if (
    /\b(breakfast|brunch)\b/.test(s) ||
    /\b(omelette|pancake|waffle|french toast|scramble)\b/.test(n)
  ) {
    return "Breakfast & Brunch";
  }

  if (/\b(kids|children|kid's|kid menu)\b/.test(s) || /\bkid\b/.test(n)) {
    return "Kids";
  }

  if (
    /\b(dessert|desserts|sweets|treats)\b/.test(s) ||
    /\b(cheesecake|brownie|cake|pie|ice cream|sundae|pudding|tiramisu)\b/.test(
      n
    )
  ) {
    return "Desserts";
  }

  if (
    /\b(side|sides|side orders?)\b/.test(s) ||
    /\b(fries|chips|onion rings|mashed potatoes|mac and cheese)\b/.test(n)
  ) {
    return "Sides";
  }

  if (
    /\b(sandwiches|sandwich|burgers?|subs?|hoagies|tacos?|wraps?)\b/.test(s) ||
    /\b(burger|sandwich|sub|taco|wrap|panini|po ?boy)\b/.test(n)
  ) {
    return "Sandwiches & Burgers";
  }

  if (
    /\b(pizzas?|pasta)\b/.test(s) ||
    /\b(pizza|penne|spaghetti|lasagna)\b/.test(n)
  ) {
    return "Pasta & Pizza";
  }

  if (
    /\b(entrees?|mains?|main courses?|specialties|specials|plates?|bowls?)\b/.test(
      s
    ) ||
    /\b(steak|chicken|salmon|ribs|grill|grilled|filet|fillet)\b/.test(n)
  ) {
    return "Mains";
  }

  return "Other";
}

// Enhanced canonical menu category classifier (rule-based)
function classifyCanonicalCategory(item) {
  const name = (item.name || "").toLowerCase();
  const section = (item.section || "").toLowerCase();

  // --- Wings ---
  if (section.includes("wings") || name.includes("wing")) {
    return "Mains";
  }

  // --- Bowls / Wraps ---
  if (section.includes("bowl") || section.includes("wrap")) {
    return "Mains";
  }

  // --- Quesadillas / Sandwiches / Burgers ---
  if (
    name.includes("burger") ||
    name.includes("sandwich") ||
    name.includes("patty melt") ||
    name.includes("tuna melt") ||
    name.includes("quesadilla") ||
    name.includes("philly") ||
    name.includes("dog")
  ) {
    return "Sandwiches & Burgers";
  }

  // --- Salads ---
  if (section.includes("salad") || name.includes("salad")) {
    return "Salads";
  }

  // --- Kids menu ---
  if (section.includes("kids") || name.includes("kid ")) {
    return "Kids";
  }

  // --- Desserts ---
  if (
    section.includes("dessert") ||
    name.includes("pie") ||
    name.includes("cheesecake") ||
    name.includes("cookie") ||
    name.includes("brownie") ||
    name.includes("ice cream") ||
    name.includes("fried oreo")
  ) {
    return "Desserts";
  }

  // --- Appetizers ---
  if (
    section.includes("starter") ||
    section.includes("appetizer") ||
    name.includes("shrimp") ||
    name.includes("tots") ||
    name.includes("nachos") ||
    name.includes("rings") ||
    name.includes("poppers") ||
    name.includes("fritters") ||
    name.includes("chips") ||
    name.includes("fries")
  ) {
    return "Appetizers";
  }

  // --- Sides (fallback for things like "tenders & fries" etc.) ---
  if (
    section.includes("side") ||
    name.includes("side") ||
    name.includes("tenders") ||
    name.includes("grilled tenders") ||
    name.includes("fish & chips")
  ) {
    return "Sides";
  }

  // Fallback: keep old canonicalCategory if present, else Other
  return item.canonicalCategory || "Other";
}

// Wing platter classifier — overrides canonical category
function classifyWingPlatter(item) {
  const name = (item.name || "").toLowerCase();
  const section = (item.section || "").toLowerCase();

  const isWing =
    section.includes("wing") ||
    name.includes("wing") ||
    name.includes("boneless") ||
    name.includes("buffalo wings");

  if (isWing) {
    return "Mains";
  }

  return null;
}

// Bowl classifier — overrides canonical category for all bowl-type dishes
function classifyBowl(item) {
  const name = (item.name || "").toLowerCase();
  const section = (item.section || "").toLowerCase();

  const isBowl =
    name.includes("bowl") ||
    section.includes("bowl") ||
    name.includes("all star") ||
    name.includes("all-star") ||
    name.includes("rice bowl");

  if (isBowl) {
    return "Mains";
  }

  return null;
}

// Wrap / Quesadilla / Melt classifier
function classifyWrapQuesadilla(item) {
  const name = (item.name || "").toLowerCase();
  const section = (item.section || "").toLowerCase();

  const signals = ["wrap", "quesadilla", "melt", "philly"];

  const matches = signals.some(
    (sig) => name.includes(sig) || section.includes(sig)
  );
  if (matches) {
    return "Sandwiches & Burgers";
  }

  return null;
}

// Section → Category remapping table (Uber sections → canonical categories)

// Normalize section names & override canonical category
function classifyBySectionFallback(item) {
  const section = (item.section || "").toLowerCase();

  for (const key in SECTION_CANONICAL_MAP) {
    if (section.includes(key)) {
      return SECTION_CANONICAL_MAP[key];
    }
  }
  return null;
}

// Canonical ordering for menu sections
const CANONICAL_ORDER = [
  "Appetizers",
  "Pasta & Pizza",
  "Mains",
  "Sandwiches & Burgers",
  "Salads",
  "Soups",
  "Sides",
  "Breakfast & Brunch",
  "Kids",
  "Desserts",
  "Other"
];

const SECTION_CANONICAL_MAP = {
  // wings & boneless
  wings: "Mains",
  "boneless wings": "Mains",

  // bowls / wraps
  "all star bowls": "Mains",
  "*build your own bowl/wrap*": "Mains",
  "*build your own bowl": "Mains",
  "*build your own wrap": "Mains",

  // salads
  salads: "Salads",

  // burgers / specialties
  "burger & specialties": "Sandwiches & Burgers",

  // wraps (sometimes separate)
  wraps: "Sandwiches & Burgers",

  // kids
  "kids catch": "Kids",

  // desserts
  desserts: "Desserts",

  // italian-specific
  antipasti: "Appetizers",
  pasta: "Pasta & Pizza",
  seafood: "Mains",
  entrees: "Mains",
  entree: "Mains",

  // sodas / beverages — REMOVE completely via noise, but map fallback here
  "soda, etc": "Other",

  // merch never belongs in menu
  merch: "Other"
};

// Group items by canonicalCategory
function groupItemsIntoSections(items) {
  const map = {};
  for (const cat of CANONICAL_ORDER) map[cat] = [];

  for (const it of items) {
    const cat = CANONICAL_ORDER.includes(it.canonicalCategory)
      ? it.canonicalCategory
      : "Other";
    map[cat].push(it);
  }

  // Build final array in order, removing empty sections
  return CANONICAL_ORDER.filter((cat) => map[cat] && map[cat].length > 0).map(
    (cat) => ({
      id: `cat-${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: cat,
      items: map[cat]
    })
  );
}
// haversine distance in meters
function computeDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;

  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// main predicate: does this Uber row match the Google Place?
function passesStrictRestaurantMatch(googleCtx, row) {
  if (!row || !googleCtx) return false;

  const uberName = row.title || row.sanitizedTitle || row.name || "";
  const googleName = googleCtx.name || googleCtx.query || "";

  if (!strictNameMatch(googleName, uberName)) return false;

  // address check
  const uberLoc =
    row.location && (row.location.address || row.location.streetAddress)
      ? row.location
      : row.location || {};
  if (!strictAddressMatch(googleCtx.address, uberLoc)) {
    return false;
  }

  // distance check (soft)
  const gLat = googleCtx.lat;
  const gLng = googleCtx.lng;
  const uLat = row.location && (row.location.latitude || row.location.lat);
  const uLng = row.location && (row.location.longitude || row.location.lng);

  const dist = computeDistanceMeters(gLat, gLng, uLat, uLng);
  if (dist != null && dist > 60) {
    // >60m away → very likely a different place
    return false;
  }

  return true;
}

// Flatten Uber Eats to simple items (normalized + deduped)
function extractMenuItemsFromUber(raw, queryText = "") {
  const out = [];
  const seen = new Map(); // key -> item

  const results =
    raw && raw.data && Array.isArray(raw.data.results) ? raw.data.results : [];

  if (!results.length) return out;

  let chosenRestaurants = [];

  if (results.length === 1) {
    chosenRestaurants = [results[0]];
  } else {
    // legacy scoring, but choose only ONE best
    const scored = results.map((r) => {
      const name = (r.title || r.sanitizedTitle || r.name || "").toLowerCase();
      const q = (queryText || "").toLowerCase();

      let score = 0;
      if (name && q) {
        if (name === q) score = 100;
        else if (name.startsWith(q)) score = 90;
        else if (name.includes(q)) score = 80;
        else {
          const nTokens = name.split(/\s+/);
          const qTokens = q.split(/\s+/);
          const nSet = new Set(nTokens);
          let overlap = 0;
          for (const t of qTokens) {
            if (nSet.has(t)) overlap++;
          }
          const ratio = overlap / Math.max(1, qTokens.length);
          score = Math.round(60 * ratio);
        }
      }
      return { r, score };
    });

    scored.sort((a, b) => b.score - a.score);
    if (scored[0]) {
      chosenRestaurants = [scored[0].r]; // ONLY top one
    }
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

  function extractCaloriesFromText(txt) {
    if (!txt || typeof txt !== "string") return null;
    const m = txt.match(/([\d,.]+)\s*Cal/i);
    if (!m) return null;
    const num = parseInt(m[1].replace(/,/g, ""), 10);
    if (!Number.isFinite(num) || num <= 0) return null;
    return num;
  }

  function normalizeItemFields(it) {
    const clean = (s) =>
      String(s ?? "")
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim();
    const outItem = { ...it };
    outItem.name = clean(it.name);
    outItem.section = clean(it.section);
    outItem.description = clean(it.description);
    outItem.price_display = clean(it.price_display);
    if (outItem.calories_display != null)
      outItem.calories_display = clean(outItem.calories_display);
    outItem.restaurant_name = clean(it.restaurant_name);

    // keep price only if it’s a non-negative finite number
    if (!(Number.isFinite(outItem.price) && outItem.price >= 0))
      delete outItem.price;

    // enforce source field
    outItem.source = "uber_eats";
    return outItem;
  }

  function makeItem(mi, sectionName, restaurantName) {
    const { price, price_display } = normalizePriceFields(mi);
    const calories_display = deriveCaloriesDisplay(mi, price_display);
    const restaurantCalories =
      (mi?.nutrition && typeof mi.nutrition.calories === "number"
        ? mi.nutrition.calories
        : null) ??
      (typeof mi?.calories === "number" ? mi.calories : null) ??
      extractCaloriesFromText(price_display) ??
      extractCaloriesFromText(mi?.itemDescription || mi?.description || "") ??
      null;
    return {
      name: mi.title || mi.name || "",
      description: mi.itemDescription || mi.description || "",
      price,
      price_display,
      section: sectionName || "",
      calories_display,
      restaurantCalories,
      restaurant_name: restaurantName || "",
      source: "uber_eats"
    };
  }

  const addItem = (item) => {
    if (!item || !item.name) return;
    const sectionKey = (item.section || "").toLowerCase();
    const nameKey = item.name.toLowerCase();
    const priceKey = item.price_display || String(item.price || "");
    const restaurantKey = item.restaurant_id || item.restaurant_name || "";
    const key = `${restaurantKey}|${sectionKey}|${nameKey}|${priceKey}`;

    const normalizedItem = normalizeItemFields(item);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, normalizedItem);
      out.push(normalizedItem);
      return;
    }

    const existingDesc = existing.description || "";
    const newDesc = normalizedItem.description || "";
    const existingHasCalories = !!existing.calories_display;
    const newHasCalories = !!normalizedItem.calories_display;
    const existingHasPrice = existing.price != null || !!existing.price_display;
    const newHasPrice =
      normalizedItem.price != null || !!normalizedItem.price_display;

    let replace = false;
    if (!existingHasPrice && newHasPrice) replace = true;
    else if (
      existingHasPrice === newHasPrice &&
      !existingHasCalories &&
      newHasCalories
    )
      replace = true;
    else if (
      existingHasPrice === newHasPrice &&
      existingHasCalories === newHasCalories &&
      newDesc.length > existingDesc.length + 10
    ) {
      replace = true;
    }

    if (replace) {
      const idx = out.indexOf(existing);
      if (idx >= 0) out[idx] = normalizedItem;
      seen.set(key, normalizedItem);
    }
  };

  for (const r of chosenRestaurants) {
    const restaurantName = r.title || r.sanitizedTitle || r.name || "";
    const restaurantId = r.uuid || r.id || r.url || restaurantName;

    let sections = [];
    if (Array.isArray(r.menu)) sections = r.menu;
    else if (Array.isArray(r.catalogs)) sections = r.catalogs;

    for (const section of sections) {
      const sectionName = section.catalogName || section.name || "";
      const catalogItems =
        (Array.isArray(section.catalogItems) && section.catalogItems) ||
        (Array.isArray(section.items) && section.items) ||
        [];

      for (const mi of catalogItems) {
        const item = makeItem(mi, sectionName, restaurantName);
        if (item) {
          item.restaurant_id = restaurantId;
          addItem(item);
        }
      }
    }

    if (Array.isArray(r.featuredItems)) {
      for (const mi of r.featuredItems) {
        const item = makeItem(mi, "Featured", restaurantName);
        if (item) {
          item.restaurant_id = restaurantId;
          addItem(item);
        }
      }
    }
  }

  return out;
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
  const kv = env.MENUS_CACHE;
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function recipeCacheWrite(env, key, payload) {
  const kv = env.MENUS_CACHE;
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
      term: o.term || o.canonical || o.label || null,
      canonical: o.canonical || o.term || o.label || null,
      allergens: o.allergens || [],
      classes: o.classes || [],
      fodmap: o.fodmap,
      tags: o.tags || [],
      source: "infer:title"
    });

  if (/\bgarlic\b/.test(text)) {
    push({
      term: "garlic",
      canonical: "garlic",
      classes: ["garlic", "allium"],
      fodmap: {
        level: "high",
        relevant: true,
        drivers: ["garlic", "fructans"]
      }
    });
  }
  if (/\bonion\b|shallot|scallion/.test(text)) {
    push({
      term: "onion",
      canonical: "onion",
      classes: ["onion", "allium"],
      fodmap: {
        level: "high",
        relevant: true,
        drivers: ["onion", "fructans"]
      }
    });
  }
  if (
    /(milk|cream|butter|cheese|parmesan|mozzarella|yogurt|whey|casein)\b/.test(
      text
    )
  ) {
    push({
      term: "dairy",
      canonical: "dairy",
      allergens: ["milk"],
      classes: ["dairy"],
      fodmap: {
        level: "low",
        relevant: true,
        drivers: ["lactose"]
      }
    });
  }
  if (/\bshrimp|prawn|lobster|crab|shellfish\b/.test(text)) {
    push({
      term: "shellfish",
      canonical: "shellfish",
      allergens: ["shellfish"],
      classes: ["shellfish"]
    });
  }

  return hits;
}

function inferHitsFromIngredients(ingredients = []) {
  const hits = [];
  for (const ing of ingredients) {
    const nameRaw =
      typeof ing === "string"
        ? ing
        : ing?.name || ing?.original || ing?.text || "";
    const name = String(nameRaw || "").toLowerCase();
    if (!name) continue;

    const push = (o) =>
      hits.push({
        term: o.term || o.canonical || name,
        canonical: o.canonical || o.term || name,
        allergens: o.allergens || [],
        classes: o.classes || [],
        fodmap: o.fodmap,
        tags: o.tags || [],
        source: "infer:ingredients"
      });

    if (
      /(milk|cream|butter|cheese|parmesan|mozzarella|yogurt|whey|casein)\b/.test(
        name
      )
    ) {
      push({
        term: "dairy",
        canonical: "dairy",
        allergens: ["milk"],
        classes: ["dairy"],
        fodmap: {
          level: "low",
          relevant: true,
          drivers: ["lactose"]
        }
      });
    }

    if (/\bgarlic\b/.test(name)) {
      push({
        term: "garlic",
        canonical: "garlic",
        classes: ["garlic", "allium"],
        fodmap: {
          level: "high",
          relevant: true,
          drivers: ["garlic", "fructans"]
        }
      });
    }

    if (/\bonion\b|shallot|scallion/.test(name)) {
      push({
        term: "onion",
        canonical: "onion",
        classes: ["onion", "allium"],
        fodmap: {
          level: "high",
          relevant: true,
          drivers: ["onion", "fructans"]
        }
      });
    }

    if (/\bshrimp|prawn|lobster|crab|shellfish\b/.test(name)) {
      push({
        term: "shellfish",
        canonical: "shellfish",
        allergens: ["shellfish"],
        classes: ["shellfish"]
      });
    }

    if (/\bflour\b|\bwheat\b|\bpasta\b|\bspaghetti\b|\bnoodles?\b/.test(name)) {
      push({
        term: "gluten",
        canonical: "gluten",
        allergens: ["gluten", "wheat"],
        classes: ["gluten"]
      });
    }
  }
  return hits;
}

async function fetchRecipeCard(env, dishTitle, urlOrigin) {
  try {
    const base = (
      urlOrigin || "https://tb-dish-processor.tummybuddy.workers.dev"
    ).replace(/\/$/, "");
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

function titleizeIngredient(text) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function sanitizeIngredientForCookbook(raw) {
  const base =
    typeof raw === "string"
      ? raw
      : raw?.name || raw?.original || raw?.text || "";
  const lower = String(base || "").toLowerCase();
  const optional =
    /\boptional\b/.test(lower) ||
    /\bfor (serving|garnish)\b/.test(lower) ||
    /\bto taste\b/.test(lower);

  const cleaned = normalizeIngredientLine(base)
    .replace(/\b(optional|undefined|to taste)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const withoutPrefix = cleaned.replace(
    /^\s*[\d\/\.\-¼½¾⅓⅔⅛⅜⅝⅞]+\s*(cups?|cup|tbsp|tablespoons?|tsp|teaspoons?|ounces?|oz|grams?|g|kg|pounds?|lb|ml|l|liters?)?\s+/i,
    ""
  );
  const name = titleizeIngredient(
    withoutPrefix
      .replace(/^[\d\s\.\/\-]+/, "")
      .replace(/\s+/g, " ")
      .trim()
  );
  if (!name) return null;

  const entry = { name, optional };
  const n = name.toLowerCase();
  const catMatch = (patterns) => patterns.some((re) => re.test(n));
  if (
    catMatch([
      /\b(chicken|beef|pork|salmon|tuna|shrimp|lobster|crab|prawn|turkey|lamb|tofu|tempeh|egg|steak|ham|bacon|sausage)\b/
    ])
  ) {
    entry.category = "protein";
  } else if (
    catMatch([
      /\b(rice|noodles?|pasta|spaghetti|fettuccine|linguine|macaroni|quinoa|couscous|tortilla|bread|bun|potato|potatoes|yuca|cassava|gnocchi|grain|lentils?)\b/,
      /\b(greens?|spinach|kale|lettuce|arugula|cabbage)\b/
    ])
  ) {
    entry.category = "base";
  } else if (
    catMatch([
      /\b(onion|garlic|shallot|scallion|leek|ginger|chili|jalapeno|pepper|bell pepper)\b/,
      /\b(parsley|cilantro|basil|oregano|thyme|rosemary|sage|dill)\b/
    ])
  ) {
    entry.category = "aromatic";
  } else if (
    catMatch([
      /\b(oil|olive oil|vinegar|broth|stock|soy sauce|coconut milk|milk|cream|wine)\b/,
      /\b(sauce|dressing)\b/
    ])
  ) {
    entry.category = "liquid";
  } else if (
    catMatch([
      /\b(salt|black pepper|pepper|paprika|cumin|turmeric|curry|chili powder|flakes|oregano|parsley|basil|spice|seasoning|sugar|honey)\b/
    ])
  ) {
    entry.category = "seasoning";
  } else {
    entry.category = "other";
  }

  return entry;
}

function arrangeCookbookIngredients(rawList = []) {
  const cleaned = [];
  const seen = new Set();
  for (const it of rawList) {
    const entry = sanitizeIngredientForCookbook(it);
    if (!entry) continue;
    const key = entry.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(entry);
  }

  const order = (cat) =>
    cleaned.filter((c) => c.category === cat && !c.optional);
  const optional = cleaned.filter((c) => c.optional);
  const others = cleaned.filter(
    (c) =>
      !c.optional &&
      !["protein", "base", "aromatic", "liquid", "seasoning"].includes(
        c.category
      )
  );

  const ordered = [
    ...order("protein"),
    ...order("base"),
    ...order("aromatic"),
    ...order("liquid"),
    ...order("seasoning"),
    ...others
  ];

  const bullets = ordered.map((c) => `- ${c.name}`);
  if (optional.length) {
    bullets.push(`- Optional: ${optional.map((c) => c.name).join(", ")}`);
  }
  return bullets.length ? bullets : ["- Ingredients not available"];
}

function naturalList(arr = [], fallback = "the ingredients") {
  const clean = arr.map((s) => s.trim()).filter(Boolean);
  if (!clean.length) return fallback;
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function inferCookbookDescription(dishName, bullets = []) {
  const name = (dishName || "").trim();
  const proteins = bullets
    .filter(
      (b) =>
        b.startsWith("- ") &&
        /chicken|beef|pork|salmon|shrimp|tofu|egg/i.test(b)
    )
    .map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));
  const bases = bullets
    .filter(
      (b) =>
        b.startsWith("- ") &&
        /rice|pasta|noodle|potato|quinoa|couscous|tortilla|greens|spinach|kale/i.test(
          b
        )
    )
    .map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));
  const accents = bullets
    .filter(
      (b) =>
        b.startsWith("- ") &&
        /garlic|onion|herb|oregano|basil|parsley|sauce|broth|oil|vinegar/i.test(
          b
        )
    )
    .map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));

  const subject = name || "This dish";
  if (proteins.length && bases.length) {
    return `*${subject} brings ${naturalList(proteins)} together with ${naturalList(bases)} and warm pantry flavors.*`;
  }
  if (proteins.length) {
    return `*${subject} highlights ${naturalList(proteins)} with simple herbs and spices.*`;
  }
  if (bases.length) {
    return `*${subject} leans on ${naturalList(bases)} with cozy aromatics and a gentle sauce.*`;
  }
  const accent = accents.length ? naturalList(accents) : "bright aromatics";
  return `*${subject} uses everyday ingredients with ${accent} for an easy, cozy plate.*`;
}

function cleanCookbookStep(text) {
  let s = String(text || "");
  s = s.replace(/^\s*(step\s*\d+[:\.\)]?\s*)/i, "");
  s = s.replace(/^\s*\d+[\.\)]\s*/, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s
    .replace(/\byou\b/gi, "")
    .replace(/\byour\b/gi, "")
    .trim();
  if (!s) return null;
  const capped = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

function inferCookbookSteps(rawSteps = [], ingredientBullets = []) {
  const cleanedRaw = Array.isArray(rawSteps)
    ? rawSteps.map((s) => cleanCookbookStep(s)).filter(Boolean)
    : [];

  const proteins = ingredientBullets
    .filter(
      (b) =>
        /^- /.test(b) && /chicken|beef|pork|salmon|shrimp|tofu|egg/i.test(b)
    )
    .map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));
  const bases = ingredientBullets
    .filter(
      (b) =>
        /^- /.test(b) &&
        /rice|pasta|noodle|potato|quinoa|couscous|tortilla|greens|spinach|kale/i.test(
          b
        )
    )
    .map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));
  const aromatics = ingredientBullets
    .filter(
      (b) => /^- /.test(b) && /garlic|onion|shallot|ginger|herb|pepper/i.test(b)
    )
    .map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));
  const liquids = ingredientBullets
    .filter(
      (b) =>
        /^- /.test(b) && /oil|vinegar|broth|stock|sauce|milk|cream/i.test(b)
    )
    .map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));

  const inferred = [];
  if (aromatics.length || bases.length) {
    inferred.push(
      `Ingredients are prepped; aromatics like ${naturalList(aromatics, "onion and garlic")} and vegetables are chopped.`
    );
  } else {
    inferred.push("Ingredients are prepped and cut into bite-size pieces.");
  }

  if (proteins.length) {
    inferred.push(
      `${naturalList(proteins)} ${proteins.length > 1 ? "are" : "is"} seasoned and cooked until browned.`
    );
  }

  if (bases.length) {
    inferred.push(
      `${naturalList(bases)} ${bases.length > 1 ? "are" : "is"} cooked until tender.`
    );
  }

  if (liquids.length || aromatics.length) {
    inferred.push(
      `${liquids.length ? naturalList(liquids) : "Sauce"} is stirred in with the cooked ingredients until flavors meld.`
    );
  }

  inferred.push("The dish is assembled, tasted, and served warm.");

  let steps = cleanedRaw.length && cleanedRaw.length <= 6 ? cleanedRaw : [];
  if (!steps.length || steps.length > 6) {
    steps = inferred;
  }

  if (steps.length < 3) {
    for (const inf of inferred) {
      if (steps.length >= 3) break;
      if (!steps.includes(inf)) steps.push(inf);
    }
  }

  return steps.slice(0, 6);
}

function formatLikelyRecipeMarkdown({
  dishName,
  rawIngredients = [],
  rawSteps = [],
  servingInfo = null
}) {
  const title = dishName
    ? `### Likely recipe: ${dishName}`
    : "### Likely recipe";
  const ingredients = arrangeCookbookIngredients(rawIngredients);
  const description = inferCookbookDescription(dishName, ingredients);
  const steps = inferCookbookSteps(rawSteps, ingredients);

  const lines = [
    title,
    description,
    "",
    "**Ingredients**",
    ...ingredients,
    "",
    "**How it's prepared**",
    ...steps.map((s, idx) => `${idx + 1}. ${s}`)
  ];

  if (servingInfo && (servingInfo.servings || servingInfo.grams)) {
    const bits = [];
    if (servingInfo.servings)
      bits.push(
        `${servingInfo.servings} serving${servingInfo.servings > 1 ? "s" : ""}`
      );
    if (servingInfo.grams) bits.push(`${servingInfo.grams} g`);
    const joined =
      bits.length === 2 ? `${bits[0]} (${bits[1]})` : bits.join("");
    if (joined) lines.push("", `**Estimated serving size:** about ${joined}`);
  }

  lines.push(
    "",
    "**Based on typical recipes from Edamam and Spoonacular. Restaurant versions may vary.**"
  );

  return lines.join("\n");
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
  const kv = env.MENUS_CACHE;
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function setClassifyStamp(env, key, payload, ttlSeconds = 6 * 3600) {
  const kv = env.MENUS_CACHE;
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

// --- LLM organ engine: GPT-4o-mini ---
//
// payload must include:
// {
//   dishName: string,
//   restaurantName?: string,
//   ingredientLines: string[],
//   ingredientsNormalized?: any[],
//   existingFlags?: any,
//   userFlags?: any,
//   locale?: string,
//   vision_insights?: {
//     portion?: {
//       servings_on_plate?: number,
//       portionFactor?: number,
//       confidence?: number,
//       reason?: string
//     },
//     visual_ingredients?: Array<{
//       guess: string,
//       category: string,
//       confidence: number,
//       evidence: string
//     }>,
//     visual_cooking_method?: {
//       primary: string,
//       secondary: string[],
//       confidence: number,
//       reason: string
//     },
//     visual_lifestyle_cues?: {
//       contains_red_meat?: "yes"|"no"|"maybe",
//       processed_meat_level?: "none"|"some"|"heavy",
//       dessert_like?: boolean,
//       plant_forward?: boolean
//     }
//   },
//   plate_components?: Array<{
//     role?: "main"|"side"|"unknown",
//     label?: string,
//     category?: "sandwich"|"burger"|"pasta"|"fried_potatoes"|"salad"|"other",
//     confidence?: number,
//     area_ratio?: number
//   }>
// }
//
// Returns: { ok: boolean, data?: any, error?: string }

async function runOrgansLLM(env, payload) {
  if (!env.OPENAI_API_KEY) {
    return { ok: false, error: "missing-openai-api-key" };
  }

  const model = "gpt-4o-mini";

  const systemPrompt = `
You are a diet and organ comfort analysis assistant for an IBS / gut-sensitivity app.
You work at a wellness / educational level (not medical advice).

You MUST:
- Analyze ONLY the dish provided (no external knowledge).
- Score organ comfort, not exact clinical risk.
- Be conservative: when unsure, choose a milder negative level instead of the worst.
- Always return VALID JSON only, with no extra commentary.

INPUT ALSO INCLUDES (OPTIONAL):
- vision_insights: object with:
  - portion: servings_on_plate, portionFactor, confidence, reason.
  - visual_ingredients: visible items such as "fried egg", "melted cheese", "bacon strips", "shrimp pieces", "nuts on top".
  - visual_cooking_method: primary cooking method and tags like "deep_fried", "breaded", "cheesy_top".
  - visual_lifestyle_cues: contains_red_meat, processed_meat_level, dessert_like, plant_forward.
- plate_components: optional list describing what is on the plate:
  - Each component has:
    - role: "main" | "side" | "unknown"
    - label: short name (e.g., "Brisket Melt", "Hash Browns", "Side salad")
    - category: "sandwich" | "burger" | "pasta" | "fried_potatoes" | "salad" | "other"
    - confidence: 0–1
    - area_ratio: fraction of visible plate area (0–1) this component takes.
  - Use this to understand mains vs sides and their relative size on the plate.

Organs: always exactly these 7 IDs:
- gut
- liver
- heart
- metabolic
- immune
- brain
- kidney

Severity levels:
- high_negative, moderate_negative, mild_negative, neutral,
  mild_positive, moderate_positive, high_positive

VISION-BASED ORGAN RULES:
- Treat deep-fried / breaded foods (from visual_cooking_method) as more negative for gut, liver, heart, and metabolic than boiled/baked/grilled.
- If visual_ingredients shows:
  - processed meats (bacon, sausage, pepperoni, deli meats): increase negative impact for heart and metabolic.
  - large melted cheese/cream: increase negative impact for gut (lactose) and heart/liver (saturated fat).
  - visible red meat portions (steak, meatballs, burger patties): reflect red-meat concerns appropriately.
- Use portion.servings_on_plate or portionFactor:
  - Larger portions (>1.0) generally increase negative impact for metabolic and gut.
  - Very small portions (<0.75) may soften impact slightly.
- Never ignore nutrition_summary; use vision_insights as an extra evidence layer to refine organ scores and reasons.
- If plate_components show a large fried side (e.g., fries/hash browns "fried_potatoes" with high area_ratio), bump gut/metabolic (and heart) negatives accordingly. If a side salad/veggies is present, you may slightly soften gut/heart/metabolic but do not overrule unhealthy mains.
- When writing reasons, mention if a side contributes (e.g., "Fried potatoes plus a rich burger increases metabolic load").

FODMAP & lactose:
- Levels: high, medium, low, unknown.
- Treat onion, garlic, wheat/gluten, many beans, some dairy, honey, high-fructose fruits,
  and inulin-type fibers as potential FODMAP triggers.

Allergens kinds:
- milk, egg, fish, shellfish, peanut, tree_nut, soy, wheat, gluten, sesame, sulfites, other.

You MUST return JSON with this shape:

{
  "tummy_barometer": { "score": number, "label": string },
  "organs": [
    {
      "organ": "gut" | "liver" | "heart" | "metabolic" | "immune" | "brain" | "kidney",
      "score": number,
      "level": "high_negative" | "moderate_negative" | "mild_negative" | "neutral" | "mild_positive" | "moderate_positive" | "high_positive",
      "reasons": string[]
    },
    ... 6 more organs ...
  ],
  "flags": {
    "allergens": [
      {
        "kind": "milk" | "egg" | "fish" | "shellfish" | "peanut" | "tree_nut" | "soy" | "wheat" | "gluten" | "sesame" | "sulfites" | "other",
        "message": string
      }
    ],
    "fodmap": {
      "level": "high" | "medium" | "low" | "unknown",
      "reason": string,
      "triggers": string[]
    },
    "lactose": {
      "level": "high" | "medium" | "low" | "unknown",
      "reason": string,
      "examples": string[]
    },
    "onion_garlic": boolean,
    "spicy": boolean,
    "alcohol": boolean
  },
  "sentences": {
    "overall": string,
    "allergens": string,
    "fodmap": string,
    "organs_overview": string
  }
}

${EVIDENCE_GUIDELINES}
`;

  const body = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt.trim() },
      {
        role: "user",
        content: JSON.stringify(payload, null, 2)
      }
    ]
  };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        error: `openai-organ-error-${res.status}`,
        details: text
      };
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return {
        ok: false,
        error: "openai-organ-json-parse-error",
        details: String(e),
        raw: content
      };
    }

    return { ok: true, data: parsed };
  } catch (err) {
    return {
      ok: false,
      error: "openai-organ-exception",
      details: String(err)
    };
  }
}

/**
 * @typedef {Object} AllergenLLMInput
 * @property {string} dishName
 * @property {string} [restaurantName]
 * @property {string} [menuSection]
 * @property {string} [menuDescription]
 * @property {Array<{name: string, normalized?: string, quantity?: string, language?: string}>} ingredients
 * @property {string[]} [tags]
 * @property {{
 *   portion?: {
 *     servings_on_plate?: number,
 *     portionFactor?: number,
 *     confidence?: number,
 *     reason?: string
 *   },
 *   visual_ingredients?: Array<{
 *     guess: string,
 *     category: string,
 *     confidence: number,
 *     evidence: string
 *   }>,
 *   visual_cooking_method?: {
 *     primary: string,
 *     secondary: string[],
 *     confidence: number,
 *     reason: string
 *   },
 *   visual_lifestyle_cues?: {
 *     contains_red_meat?: "yes"|"no"|"maybe",
 *     processed_meat_level?: "none"|"some"|"heavy",
 *     dessert_like?: boolean,
 *     plant_forward?: boolean
 *   }
 * }} [vision_insights]
 */

/**
 * @typedef {Object} AllergenLLMResult
 * @property {Object} allergens
 * @property {{present: "yes"|"no"|"maybe", reason: string}} allergens.gluten
 * @property {{present: "yes"|"no"|"maybe", reason: string}} allergens.milk
 * @property {{present: "yes"|"no"|"maybe", reason: string}} allergens.egg
 * @property {{present: "yes"|"no"|"maybe", reason: string}} allergens.soy
 * @property {{present: "yes"|"no"|"maybe", reason: string}} allergens.peanut
 * @property {{present: "yes"|"no"|"maybe", reason: string}} allergens.tree_nut
 * @property {{present: "yes"|"no"|"maybe", reason: string}} allergens.fish
 * @property {{present: "yes"|"no"|"maybe", reason: string}} allergens.shellfish
 * @property {{present: "yes"|"no"|"maybe", reason: string}} allergens.sesame
 * @property {{level: "none"|"trace"|"low"|"medium"|"high", reason: string}} lactose
 * @property {{level: "low"|"medium"|"high", reason: string}} fodmap
 * @property {Object} extra_flags
 * @property {{present: "yes"|"no"|"maybe", reason: string}} extra_flags.pork
 * @property {{present: "yes"|"no"|"maybe", reason: string}} extra_flags.beef
 * @property {{present: "yes"|"no"|"maybe", reason: string}} extra_flags.alcohol
 * @property {{present: "yes"|"no"|"maybe", reason: string}} extra_flags.spicy
 * @property {Array<{
 *   component_label: string,
 *   role: string,
 *   category: string,
 *   allergens: Object,
 *   lactose: Object,
 *   fodmap: Object
 * }>} [component_allergens]
 * @property {{confidence: number, notes?: string}} meta
 */

// --- LLM allergen engine: GPT-4.1-mini (configurable) ---
async function runAllergenMiniLLM(env, input) {
  if (!env.OPENAI_API_KEY) {
    return { ok: false, error: "missing-openai-api-key" };
  }

  const model = env.OPENAI_MODEL_ALLERGEN || "gpt-4.1-mini";

  const systemPrompt = `
You are an expert allergen, FODMAP, and lactose analyst for restaurant dishes.

INPUT:
- dishName
- restaurantName
- menuSection
- menuDescription
- ingredients: structured list of parsed ingredients (may contain multiple languages)
- tags: optional labels such as "gluten-free", "vegan", "vegetarian", "lactose-free", "sin gluten", etc.
- plate_components: optional list describing what is on the plate:
  - Each component has:
    - role: "main" | "side" | "unknown"
    - label: short human name (e.g., "Brisket Melt", "Hash Browns", "Side salad")
    - category: coarse bucket ("sandwich", "burger", "pasta", "fried_potatoes", "salad", "other")
    - confidence: 0–1
    - area_ratio: fraction of visible plate area (0–1) this component takes.
  - Use this to understand mains vs sides; if an allergen risk comes from a side (e.g., fries with bun), mention that in reasons.
- plate_components: optional list describing what is on the plate:
  - Each component has:
    - role: "main" | "side" | "unknown"
    - label: short human name (e.g., "Brisket Melt", "Hash Browns", "Side salad")
    - category: coarse bucket ("sandwich", "burger", "pasta", "fried_potatoes", "salad", "other")
    - confidence: 0–1
    - area_ratio: fraction of visible plate area (0–1) this component takes.
  - Use this to understand mains vs sides; if an allergen risk comes from a side (e.g., fries with bun), mention that in reasons.

YOUR TASKS:
1. Determine presence of these allergens:
   - gluten, milk, egg, soy, peanut, tree_nut, fish, shellfish, sesame
2. Estimate lactose level:
   - "none" | "trace" | "low" | "medium" | "high"
3. Estimate overall FODMAP level for the dish:
   - "low" | "medium" | "high"
4. Set extra flags:
   - pork, beef, alcohol, spicy
5. ALWAYS give a short, concrete reason for each allergen, lactose, and FODMAP decision.
PLATE COMPONENT REASONING:
- If plate_components suggests recognizable sides (fries, hash browns, salad, veggies), incorporate that when judging allergens/FODMAP/lactose and writing reasons.
- Mention if a risk comes from a side vs the main (e.g., "gluten from the bun, fried potatoes on the side").

ALLERGEN STRICTNESS RULES:
- You MUST NOT invent ingredients that are not clearly implied by the input.
- You may only set "present": "yes" for an allergen if there is explicit textual evidence in the dish name, menu description, ingredients, or tags.
- Examples of explicit evidence:
  - "egg", "eggs", "egg yolk", "yolk", "huevo" → egg allergen yes.
  - "cream", "milk", "cheese", "queso", "butter" → milk allergen yes.
  - "shrimp", "prawns", "camarón", "gambas" → shellfish allergen yes.
- Do NOT set "present": "yes" just because a recipe often contains an allergen (e.g., meatballs often contain egg; aioli often contains egg). In such cases, use "present": "maybe" with a reason like "Often contains egg, but egg is not listed here."
- If the text does not mention an allergen and there is no clear indication, usually set "present": "no" and note it is not listed.
- Example: "Spaghetti and meatballs in tomato sauce" with no egg mentioned:
  - "egg": { "present": "maybe", "reason": "Meatballs often use egg as binder, but egg is not listed here." }
  - NOT allowed: "egg": { "present": "yes", "reason": "Contains egg yolks." } because egg/yolk is never mentioned.

LIFESTYLE RULES:
- Use dishName + menuDescription + ingredients + tags together.
- Identify if the dish contains red meat (beef, veal, lamb, goat, meatballs, bolognese/ragu di carne), poultry (chicken, turkey), pork, fish, shellfish.
- Detect processed meats (bacon, sausage, hot dog, pepperoni, salami, ham, pancetta, chorizo).
- Detect desserts/high-sugar treats; detect comfort food (pasta, cheesy, fried, heavy sauces).
- Spaghetti & meatballs / bolognese: treat as red meat even if ingredients list is incomplete; not red-meat-free or vegetarian.
- Vegetarian: no meat/fish/shellfish. Vegan: also no dairy/eggs. If red meat present → not red-meat-free/vegetarian.

LIFESTYLE TAGS:
- Emit lifestyle_tags as concise codes based on BOTH the recipe/ingredient list AND the dish name/description.
- Common tags to use:
  - "contains_red_meat" (beef, lamb, veal, goat, meatballs, bolognese/ragu di carne, carne)
  - "processed_meat" (bacon, sausage, pancetta, salami, pepperoni, hot dogs, ham)
  - "contains_poultry" (chicken, turkey)
  - "contains_pork" (pork, pancetta, bacon)
  - "contains_fish" (fish, salmon, tuna, cod, etc.)
  - "contains_shellfish" (shrimp, prawns, crab, lobster, clams, mussels, oysters, scallops)
  - "comfort_food" (fried/cheesy/creamy/heavy pasta, casseroles, burgers)
  - "high_sugar_dessert" (cakes, pies, ice cream, milkshakes, very sweet desserts)
  - "plant_forward" (mostly vegetables/legumes/whole grains with little or no meat)
- Example: "Spaghetti and meatballs" with beef/pork and pancetta:
  - lifestyle_checks.contains_red_meat = "yes"
  - lifestyle_tags should include at least "contains_red_meat" and "processed_meat", and optionally "comfort_food".
- Use plate_components (role, label, category, area_ratio) to fill component_allergens:
  - For each recognized component, produce a component entry.
  - component_label should be the most useful short name (e.g., "Brisket Melt", "Hash Browns", "Side salad").
  - The per-component allergens/lactose/fodmap fields use the SAME structure as global ones, but describe risk mainly from that component.
  - The GLOBAL allergens/lactose/fodmap must still describe the ENTIRE plate overall.

${EVIDENCE_GUIDELINES}

IMPORTANT RULES – GLUTEN:
- If any ingredient includes wheat, flour, bread, bun, brioche, baguette, pasta, noodles (in any language) and is NOT explicitly gluten-free:
  -> gluten.present = "yes".
- "pan" (Spanish/Italian for bread), "pain" (French), "panino", etc., usually indicate gluten unless explicitly "sin gluten"/"senza glutine"/"gluten-free".
- If ingredients include rice bun, rice bread, corn tortilla, arepa, polenta, yuca bread, cassava bread and do NOT mention wheat/flour:
  -> gluten.present = "no".
- If dish or tags are labeled gluten-free / "GF" / "sin gluten" / "senza glutine":
  -> By default, gluten.present = "no" unless an explicit wheat/flour ingredient is listed (in which case explain the conflict).
- If a component is ambiguous like just "bun" or "bread" with no further info and no gluten-free tags:
  -> gluten.present = "maybe" with a reason like "Bun usually contains wheat; menu does not clarify."

IMPORTANT RULES – MILK & LACTOSE:
- Treat dairy ingredients (milk, cream, butter, cheese, queso, nata, crema, yogurt, leche, etc.) as milk = "yes".
- Lactose level:
  - High: fresh milk, cream, fresh cheeses, ice cream, condensed milk, sweetened dairy sauces.
  - Medium: butter, soft cheeses, yogurt (unless explicitly lactose-free).
  - Low/Trace: aged hard cheeses (parmesan, gruyère, aged cheddar, manchego curado).
  - None: plant milks (soy, almond, oat, coconut) or items labeled lactose-free.
- If tags or description explicitly say "lactose-free" / "sin lactosa":
  -> lactose.level = "none" even if dairy words appear, unless clearly contradictory.

IMPORTANT RULES – FODMAP:
- Consider these common high-FODMAP ingredients:
  - Wheat-based bread/pasta, garlic, onions, honey, agave, apples, pears, mango, stone fruits, many beans, certain sweeteners.
- FODMAP level guidelines:
  - "high": multiple strong high-FODMAP ingredients (e.g., garlic + onion + wheat bun).
  - "medium": some high-FODMAP components but in a mixed dish that also has low-FODMAP ingredients.
  - "low": primarily low-FODMAP items (meat, fish, eggs, rice, potatoes, carrots, zucchini, tomatoes, oil) with minimal or no obvious high-FODMAP triggers.

IMPORTANT RULES – EXTRA FLAGS:
- pork: set present = "yes" if there is pork, bacon, jamón, pancetta, chorizo, or similar.
- beef: set present = "yes" if beef, carne de res, steak, hamburger patty, etc.
- alcohol: set present = "yes" if wine, beer, sake, liquor, rum, vodka, tequila, etc. are ingredients.
- spicy: set present = "yes" if ingredients indicate chilies, jalapeño, habanero, "picante", spicy sauce, etc.

MULTI-LANGUAGE AWARENESS:
- Recognize common food words in Spanish, Italian, French, Portuguese, etc.
- Examples:
  - "queso", "nata", "crema", "leche" -> dairy.
  - "pan", "brioche", "baguette", "pasta" -> likely gluten.
  - "mariscos", "gambas", "camarón", "langostino" -> shellfish.
- Use tags like "vegan", "vegetarian", "gluten-free", "lactose-free", "sin gluten", "sin lactosa" to refine decisions.

OUTPUT FORMAT:
- You MUST return exactly ONE JSON object with this shape:

{
  "allergens": {
    "gluten":    { "present": "yes" | "no" | "maybe", "reason": string },
    "milk":      { "present": "yes" | "no" | "maybe", "reason": string },
    "egg":       { "present": "yes" | "no" | "maybe", "reason": string },
    "soy":       { "present": "yes" | "no" | "maybe", "reason": string },
    "peanut":    { "present": "yes" | "no" | "maybe", "reason": string },
    "tree_nut":  { "present": "yes" | "no" | "maybe", "reason": string },
    "fish":      { "present": "yes" | "no" | "maybe", "reason": string },
    "shellfish": { "present": "yes" | "no" | "maybe", "reason": string },
    "sesame":    { "present": "yes" | "no" | "maybe", "reason": string }
  },
  "lactose": {
    "level": "none" | "trace" | "low" | "medium" | "high",
    "reason": string
  },
  "fodmap": {
    "level": "low" | "medium" | "high",
    "reason": string
  },
  "extra_flags": {
    "pork":    { "present": "yes" | "no" | "maybe", "reason": string },
    "beef":    { "present": "yes" | "no" | "maybe", "reason": string },
    "alcohol": { "present": "yes" | "no" | "maybe", "reason": string },
    "spicy":   { "present": "yes" | "no" | "maybe", "reason": string }
  },
  "lifestyle_tags": string[],
  "lifestyle_checks": {
    "contains_red_meat": "yes" | "no" | "maybe",
    "red_meat_free": "yes" | "no" | "maybe",
    "vegetarian": "yes" | "no" | "maybe",
    "vegan": "yes" | "no" | "maybe"
  },
  "component_allergens": [
    {
      "component_label": string,
      "role": "main" | "side" | "unknown",
      "category": string,
      "allergens": {
        "gluten":    { "present": "yes" | "no" | "maybe", "reason": string },
        "milk":      { "present": "yes" | "no" | "maybe", "reason": string },
        "egg":       { "present": "yes" | "no" | "maybe", "reason": string },
        "soy":       { "present": "yes" | "no" | "maybe", "reason": string },
        "peanut":    { "present": "yes" | "no" | "maybe", "reason": string },
        "tree_nut":  { "present": "yes" | "no" | "maybe", "reason": string },
        "fish":      { "present": "yes" | "no" | "maybe", "reason": string },
        "shellfish": { "present": "yes" | "no" | "maybe", "reason": string },
        "sesame":    { "present": "yes" | "no" | "maybe", "reason": string }
      },
      "lactose": {
        "level": "none" | "trace" | "low" | "medium" | "high",
        "reason": string
      },
      "fodmap": {
        "level": "low" | "medium" | "high",
        "reason": string
      }
    }
  ],
  "meta": {
    "confidence": number,
    "notes"?: string
  }
}

- Do NOT include any additional keys.
- Do NOT include commentary outside of JSON.
`;

  const body = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt.trim() },
      { role: "user", content: JSON.stringify(input, null, 2) }
    ]
  };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        error: `openai-allergen-error-${res.status}`,
        details: text
      };
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return {
        ok: false,
        error: "openai-allergen-json-parse-error",
        details: String(e),
        raw: content
      };
    }

    return { ok: true, data: parsed };
  } catch (err) {
    return {
      ok: false,
      error: "openai-allergen-exception",
      details: String(err)
    };
  }
}

function mapOrgansLLMToOrgansBlock(llm, existingOrgansBlock) {
  if (!llm || typeof llm !== "object") {
    return existingOrgansBlock || null;
  }

  const tummy = llm.tummy_barometer || llm.tummyBarometer || null;
  const organsArray = Array.isArray(llm.organs) ? llm.organs : [];
  const flags = llm.flags || {};

  const normalizedOrgans = organsArray.map((o) => ({
    organ: o.organ || "gut",
    score: typeof o.score === "number" ? o.score : 0,
    level: o.level || "neutral",
    reasons: Array.isArray(o.reasons) ? o.reasons : []
  }));

  const block = {
    ok: true,
    tummy_barometer: tummy ||
      (existingOrgansBlock && existingOrgansBlock.tummy_barometer) || {
        score: 0,
        label: "Unknown comfort"
      },
    flags: {
      ...(existingOrgansBlock && existingOrgansBlock.flags
        ? existingOrgansBlock.flags
        : {}),
      ...flags
    },
    organs: normalizedOrgans.length
      ? normalizedOrgans
      : (existingOrgansBlock && existingOrgansBlock.organs) || []
  };

  return block;
}

/**
 * @typedef {Object} NutritionLLMInput
 * @property {string} dishName
 * @property {string} [restaurantName]
 * @property {{
 *   energyKcal?: number|null,
 *   protein_g?: number|null,
 *   fat_g?: number|null,
 *   carbs_g?: number|null,
 *   sugar_g?: number|null,
 *   fiber_g?: number|null,
 *   sodium_mg?: number|null
 * }} nutrition_summary
 * @property {string[]} [tags]
 */

/**
 * @typedef {Object} NutritionLLMResult
 * @property {string} summary
 * @property {string[]} highlights
 * @property {string[]} cautions
 * @property {{
 *   calories: "low"|"medium"|"high",
 *   protein: "low"|"medium"|"high",
 *   carbs: "low"|"medium"|"high",
 *   sugar: "low"|"medium"|"high",
 *   fiber: "low"|"medium"|"high",
 *   fat: "low"|"medium"|"high",
 *   sodium: "low"|"medium"|"high"
 * }} classifications
 */

async function runNutritionMiniLLM(env, input) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("missing-openai-api-key");
  }

  const model = env.OPENAI_MODEL_NUTRITION || "gpt-4.1-mini";

  const systemPrompt = `
You are a nutrition coach analyzing a single restaurant dish.

You will receive:
- dishName, restaurantName
- a nutrition_summary per serving:
  - energyKcal (kcal)
  - protein_g, fat_g, carbs_g, sugar_g, fiber_g (grams)
  - sodium_mg (milligrams)
- optional tags from existing heuristics.

Tasks:
1. Classify each of these as "low", "medium", or "high" for ONE MEAL:
   - calories, protein, carbs, sugar, fiber, fat, sodium.
   (Use reasonable ranges; you do not need to output the thresholds.)

2. Produce:
   - summary: 1–2 sentences that describe the overall nutrition profile in plain language.
   - highlights: 2–5 short positive or neutral points (e.g. "Good protein", "Low sugar").
   - cautions: 1–3 short points about things to watch (e.g. "High sodium", "Very high calories").

${EVIDENCE_GUIDELINES}

OUTPUT FORMAT:
Return exactly one JSON object with shape:

{
  "summary": string,
  "highlights": string[],
  "cautions": string[],
  "classifications": {
    "calories": "low"|"medium"|"high",
    "protein": "low"|"medium"|"high",
    "carbs": "low"|"medium"|"high",
    "sugar": "low"|"medium"|"high",
    "fiber": "low"|"medium"|"high",
    "fat": "low"|"medium"|"high",
    "sodium": "low"|"medium"|"high"
  }
}

Do not include any extra text outside the JSON.`;

  const body = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(input) }
    ]
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`openai-nutrition-error-${res.status}: ${text}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content || "";
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`openai-nutrition-json-parse-error: ${String(e)}`);
  }
}

async function runPortionVisionLLM(env, input) {
  const imageUrl = input && input.imageUrl ? String(input.imageUrl) : null;

  if (!imageUrl) {
    return {
      ok: true,
      source: "portion_vision_no_image",
      portionFactor: 1,
      confidence: 0,
      reason: "No image provided; defaulting to 1.0 serving.",
      input: {
        dishName: input && input.dishName ? String(input.dishName) : null,
        restaurantName:
          input && input.restaurantName ? String(input.restaurantName) : null,
        menuSection:
          input && input.menuSection ? String(input.menuSection) : null,
        hasImage: false,
        imageUrl: null
      },
      insights: null
    };
  }

  if (!env.OPENAI_API_KEY) {
    return {
      ok: false,
      source: "portion_vision_openai",
      error: "missing-openai-api-key",
      portionFactor: 1,
      confidence: 0,
      reason: "Missing OPENAI_API_KEY; cannot call vision model.",
      input: {
        dishName: input && input.dishName ? String(input.dishName) : null,
        restaurantName:
          input && input.restaurantName ? String(input.restaurantName) : null,
        menuSection:
          input && input.menuSection ? String(input.menuSection) : null,
        hasImage: true,
        imageUrl
      },
      insights: null
    };
  }

  const model =
    env.OPENAI_MODEL_PORTION ||
    env.OPENAI_MODEL_ALLERGEN ||
    env.OPENAI_MODEL_NUTRITION ||
    "gpt-4.1-mini";

  const systemPrompt = `
You are a vision assistant for a food-health app.

You will receive:
- dishName, restaurantName, menuSection, menuDescription
- ONE photo of the plated dish.

Your tasks:

1) PORTION / SERVINGS
- Assume there is a "standard restaurant serving" for this dish.
- Estimate how many such servings are on the plate (servings_on_plate).
  - 1.0 = typical single restaurant serving.
  - 0.5 = light/small serving.
  - 2.0 = clearly oversized double serving.
- Also provide a portionFactor field that can be used as a multiplier for calories (usually == servings_on_plate).
- confidence: 0.0–1.0
- reason: 1–2 short sentences.

2) VISUAL INGREDIENTS (for allergens/lifestyle)
- From the image, list visible ingredients that are strong visual signals:
  - eggs (fried egg, scrambled egg),
  - cheese / cream / dairy toppings,
  - shellfish (shrimp, prawns, crab, mussels),
  - red meat (steak, meatballs, burger patties),
  - processed meat (bacon strips, sausages, deli slices, pepperoni),
  - nuts (almond slices, peanuts, walnuts, pistachios),
  - seeds (sesame on buns or toppings),
  - obvious sauces (white cream sauce, red tomato sauce, chocolate syrup, etc.).
- For each, provide:
  - guess: short human label ("fried egg", "melted cheese on top", "shrimp pieces", "bacon strips").
  - category: one of:
    "egg", "dairy", "shellfish", "fish", "red_meat", "poultry",
    "processed_meat", "nut", "sesame", "sauce", "vegetable", "fruit", "grain", "unknown".
  - confidence: 0.0–1.0
  - evidence: short phrase describing the visual cue.

3) VISUAL COOKING METHOD
- Estimate primary cooking method for the main visible item(s):
  - primary: "fried" | "deep_fried" | "baked" | "grilled" | "broiled" |
             "boiled" | "steamed" | "raw" | "roasted" | "sautéed" | "mixed" | "unknown"
- secondary: list of extra tags, e.g.:
  - ["breaded", "crispy", "cheesy_top", "saucy", "charred"]
- confidence: 0.0–1.0
- reason: short phrase ("golden breaded crust in oil suggests deep-fried", "charred grill marks").

4) VISUAL LIFESTYLE CUES
Based ONLY on what you SEE (do NOT trust menu tags),
estimate:
- contains_red_meat: "yes" | "no" | "maybe"
- processed_meat_level: "none" | "some" | "heavy"
- dessert_like: boolean
- plant_forward: boolean

IMPORTANT:
- When in doubt, keep confidence lower and use "maybe".
- Do NOT invent invisible ingredients (e.g. do not assume egg in sauce unless you see egg).
- Prefer high-confidence visual signals: visible eggs, bacon, cheese, shrimp, etc.

${EVIDENCE_GUIDELINES}

OUTPUT:
Return ONE JSON object with this exact shape:

{
  "portion": {
    "servings_on_plate": number,
    "portionFactor": number,
    "confidence": number,
    "reason": string
  },
  "visual_ingredients": [
    {
      "guess": string,
      "category": string,
      "confidence": number,
      "evidence": string
    }
  ],
  "visual_cooking_method": {
    "primary": string,
    "secondary": string[],
    "confidence": number,
    "reason": string
  },
  "visual_lifestyle_cues": {
    "contains_red_meat": "yes"|"no"|"maybe",
    "processed_meat_level": "none"|"some"|"heavy",
    "dessert_like": boolean,
    "plant_forward": boolean
  },
  "plate_components": [
    {
      "role": "main" | "side" | "unknown",
      "label": string,
      "category": "sandwich" | "burger" | "pasta" | "fried_potatoes" | "salad" | "other",
      "confidence": number,
      "area_ratio": number
    }
  ]
}

PLATE COMPONENT RULES:
- Identify distinct components on the plate: usually 1 main (sandwich, burger, pasta, big protein) and 0–2 sides (fries, hash browns, salad, veggies).
- "role": use "main" for the primary dish, "side" for side dishes, "unknown" if unclear.
- "label": short human-readable description ("Hash Browns", "French fries", "Side salad").
- "category": coarse bucket such as "sandwich", "burger", "pasta", "fried_potatoes", "salad", "other".
- "area_ratio": rough fraction of visible plate area taken by this component (0–1); components together usually total 0.8–1.1.
- If unsure, still return a best-effort list with lower confidence and role "unknown".
- Almost always there is EXACTLY ONE "main" and 0–2 "side" components.
  - "main": primary dish (burger, sandwich, pasta, large protein) and should be largest/central.
  - "side": smaller accompaniments (fries, hash browns, salad, veggies, small sauces).
- Fried potatoes: if you clearly see hash browns, fries, tots, wedges, create a component with role "side" and category "fried_potatoes" (label e.g., "Hash browns", "French fries").
- Salads/veggies: if you see a side salad or veggies, use role "side" and category "salad" (leafy) or "other" (mixed vegetables).
- Confidence/pruning: only create a component if confidence >= 0.4 and it seems distinct; do NOT invent extras.
- area_ratio: keep totals roughly 0.8–1.1; main usually largest; fried potato sides often ~0.2–0.5.

No extra keys, no commentary outside JSON.
`.trim();

  const base = env.OPENAI_API_BASE || "https://api.openai.com";

  const userContent = [
    {
      type: "text",
      text: JSON.stringify(
        {
          dishName: input && input.dishName ? String(input.dishName) : null,
          restaurantName:
            input && input.restaurantName ? String(input.restaurantName) : null,
          menuSection:
            input && input.menuSection ? String(input.menuSection) : null,
          menuDescription:
            input && input.menuDescription
              ? String(input.menuDescription)
              : null
        },
        null,
        2
      )
    },
    {
      type: "image_url",
      image_url: {
        url: imageUrl
      }
    }
  ];

  const body = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent }
    ]
  };

  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        source: "portion_vision_openai",
        error: `openai-portion-error-${res.status}`,
        details: text,
        portionFactor: 1,
        confidence: 0,
        reason: "Vision call failed; defaulting to factor 1.",
        input: {
          dishName: input && input.dishName ? String(input.dishName) : null,
          restaurantName:
            input && input.restaurantName ? String(input.restaurantName) : null,
          menuSection:
            input && input.menuSection ? String(input.menuSection) : null,
          hasImage: true,
          imageUrl
        },
        insights: null
      };
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return {
        ok: false,
        source: "portion_vision_openai",
        error: "openai-portion-json-parse-error",
        details: String(e),
        raw: content,
        portionFactor: 1,
        confidence: 0,
        reason: "JSON parse error from vision model; defaulting to factor 1.",
        input: {
          dishName: input && input.dishName ? String(input.dishName) : null,
          restaurantName:
            input && input.restaurantName ? String(input.restaurantName) : null,
          menuSection:
            input && input.menuSection ? String(input.menuSection) : null,
          hasImage: true,
          imageUrl
        },
        insights: null
      };
    }

    const portion = parsed && parsed.portion ? parsed.portion : {};
    const plateComponentsRaw = Array.isArray(parsed?.plate_components)
      ? parsed.plate_components
      : [];
    const pf =
      typeof portion.portionFactor === "number" &&
      isFinite(portion.portionFactor)
        ? portion.portionFactor
        : typeof portion.servings_on_plate === "number" &&
            isFinite(portion.servings_on_plate)
          ? portion.servings_on_plate
          : 1;

    const conf =
      typeof portion.confidence === "number" && isFinite(portion.confidence)
        ? portion.confidence
        : 0;

    const reason =
      typeof portion.reason === "string"
        ? portion.reason
        : "No portion reason provided.";

    // Normalize plate components: drop low-confidence, enforce at most one main, normalize area_ratio
    let plate_components = plateComponentsRaw
      .filter((c) => {
        if (!c || typeof c !== "object") return false;
        const conf = typeof c.confidence === "number" ? c.confidence : 0;
        return conf >= 0.35;
      })
      .map((c) => {
        const role = typeof c.role === "string" && c.role ? c.role : "unknown";
        const category =
          typeof c.category === "string" && c.category ? c.category : "other";
        const label =
          (typeof c.label === "string" && c.label) ||
          (typeof c.component === "string" && c.component) ||
          (typeof c.name === "string" && c.name) ||
          "Component";
        const confidence = typeof c.confidence === "number" ? c.confidence : 0;
        const area_ratio =
          typeof c.area_ratio === "number" && c.area_ratio > 0
            ? c.area_ratio
            : 0;

        return {
          role,
          category,
          label,
          confidence,
          area_ratio
        };
      });

    const mains = plate_components.filter((c) => c.role === "main");
    if (mains.length > 1) {
      const mainKeep = mains.reduce((best, c) => {
        if (!best) return c;
        if (c.area_ratio > best.area_ratio) return c;
        if (c.area_ratio === best.area_ratio && c.confidence > best.confidence)
          return c;
        return best;
      }, null);

      plate_components = plate_components.map((c) => {
        if (c === mainKeep) return c;
        if (c.role === "main") {
          return { ...c, role: "side" };
        }
        return c;
      });
    }

    let sumAreas = plate_components.reduce(
      (sum, c) =>
        sum +
        (typeof c.area_ratio === "number" && c.area_ratio > 0
          ? c.area_ratio
          : 0),
      0
    );

    if (plate_components.length > 0) {
      if (!sumAreas || sumAreas <= 0) {
        const equal = 1 / plate_components.length;
        plate_components = plate_components.map((c) => ({
          ...c,
          area_ratio: equal
        }));
      } else {
        plate_components = plate_components.map((c) => {
          const raw =
            typeof c.area_ratio === "number" && c.area_ratio > 0
              ? c.area_ratio
              : 0;
          return {
            ...c,
            area_ratio: raw / sumAreas
          };
        });
      }
    }

    const insights = {
      portion: {
        servings_on_plate:
          typeof portion.servings_on_plate === "number" &&
          isFinite(portion.servings_on_plate)
            ? portion.servings_on_plate
            : pf,
        portionFactor: pf,
        confidence: conf,
        reason
      },
      visual_ingredients:
        Array.isArray(parsed.visual_ingredients) &&
        parsed.visual_ingredients.length > 0
          ? parsed.visual_ingredients
          : [],
      visual_cooking_method:
        parsed.visual_cooking_method &&
        typeof parsed.visual_cooking_method === "object"
          ? parsed.visual_cooking_method
          : {
              primary: "unknown",
              secondary: [],
              confidence: 0,
              reason: ""
            },
      visual_lifestyle_cues:
        parsed.visual_lifestyle_cues &&
        typeof parsed.visual_lifestyle_cues === "object"
          ? parsed.visual_lifestyle_cues
          : {
              contains_red_meat: "maybe",
              processed_meat_level: "none",
              dessert_like: false,
              plant_forward: false
            },
      plate_components
    };

    return {
      ok: true,
      source: "portion_vision_openai",
      portionFactor: pf,
      confidence: conf,
      reason,
      input: {
        dishName: input && input.dishName ? String(input.dishName) : null,
        restaurantName:
          input && input.restaurantName ? String(input.restaurantName) : null,
        menuSection:
          input && input.menuSection ? String(input.menuSection) : null,
        hasImage: true,
        imageUrl
      },
      insights
    };
  } catch (err) {
    return {
      ok: false,
      source: "portion_vision_openai",
      error: "openai-portion-exception",
      details: String(err),
      portionFactor: 1,
      confidence: 0,
      reason: "Exception during vision call; defaulting to factor 1.",
      input: {
        dishName: input && input.dishName ? String(input.dishName) : null,
        restaurantName:
          input && input.restaurantName ? String(input.restaurantName) : null,
        menuSection:
          input && input.menuSection ? String(input.menuSection) : null,
        hasImage: true,
        imageUrl
      },
      insights: null
    };
  }
}

async function handleAllergenMini(request, env) {
  const body = (await readJsonSafe(request)) || {};

  const ingredients =
    Array.isArray(body.ingredients) && body.ingredients.length
      ? body.ingredients
          .map((it) => {
            if (typeof it === "string") return { name: it };
            if (it && typeof it === "object") {
              const name =
                it.name ||
                it.ingredient ||
                it.text ||
                it.original ||
                it.line ||
                "";
              return {
                name,
                normalized: it.normalized || it.canonical || undefined,
                quantity: it.quantity || it.qty || it.amount || undefined,
                language: it.language || it.lang || undefined
              };
            }
            return null;
          })
          .filter((r) => r && r.name)
      : [];

  const input = {
    dishName: body.dishName || body.dish || "",
    restaurantName: body.restaurantName || body.restaurant || "",
    menuSection: body.menuSection || body.section || "",
    menuDescription:
      body.menuDescription || body.description || body.desc || "",
    ingredients,
    tags: Array.isArray(body.tags)
      ? body.tags.map((t) => String(t || "").trim()).filter(Boolean)
      : []
  };

  if (!input.dishName && !ingredients.length) {
    return badJson(
      {
        ok: false,
        source: "llm-mini",
        error: "dishName or ingredients are required"
      },
      400
    );
  }

  try {
    const llmResult = await runAllergenMiniLLM(env, input);
    if (!llmResult || llmResult.ok !== true || !llmResult.data) {
      return okJson(
        {
          ok: false,
          source: "llm-mini",
          error:
            llmResult?.error ||
            (llmResult && llmResult.ok === false
              ? "allergen analysis failed"
              : "unknown-error"),
          details: llmResult?.details || null
        },
        500
      );
    }

    const data = llmResult.data || {};
    const allergen_flags = [];
    const allergenKeys = [
      "gluten",
      "milk",
      "egg",
      "soy",
      "peanut",
      "tree_nut",
      "fish",
      "shellfish",
      "sesame"
    ];
    for (const key of allergenKeys) {
      const slot = data?.allergens?.[key];
      if (slot && slot.present && slot.present !== "no") {
        allergen_flags.push({
          kind: key,
          present: slot.present,
          message: slot.reason || "",
          source: "llm-mini"
        });
      }
    }

    const fodmap_flags = data?.fodmap
      ? {
          level: data.fodmap.level || "unknown",
          reason: data.fodmap.reason || "",
          source: "llm-mini"
        }
      : null;

    const lactose_flags = data?.lactose
      ? {
          level: data.lactose.level || "unknown",
          reason: data.lactose.reason || "",
          source: "llm-mini"
        }
      : null;

    const responsePayload = {
      ok: true,
      source: "llm-mini",
      allergens_raw: data,
      allergen_flags,
      fodmap_flags,
      lactose_flags,
      lifestyle_tags: Array.isArray(data.lifestyle_tags)
        ? data.lifestyle_tags
        : [],
      lifestyle_checks: data.lifestyle_checks || null
    };

    return okJson(responsePayload, 200);
  } catch (err) {
    return okJson(
      {
        ok: false,
        source: "llm-mini",
        error: String(err?.message || err)
      },
      500
    );
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

function nutritionSummaryFromEdamamTotalNutrients(totalNutrients) {
  if (!totalNutrients || typeof totalNutrients !== "object") return null;

  const energy = totalNutrients.ENERC_KCAL?.quantity;
  const protein = totalNutrients.PROCNT?.quantity;
  const fat = totalNutrients.FAT?.quantity;
  const carbs = totalNutrients.CHOCDF?.quantity;
  const sugar = totalNutrients.SUGAR?.quantity;
  const fiber = totalNutrients.FIBTG?.quantity;
  const sodium = totalNutrients.NA?.quantity;

  return {
    energyKcal: typeof energy === "number" ? energy : null,
    protein_g: typeof protein === "number" ? protein : null,
    fat_g: typeof fat === "number" ? fat : null,
    carbs_g: typeof carbs === "number" ? carbs : null,
    sugar_g: typeof sugar === "number" ? sugar : null,
    fiber_g: typeof fiber === "number" ? fiber : null,
    sodium_mg: typeof sodium === "number" ? sodium : null
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

async function resolveNutritionFromUSDA(env, dishName, description) {
  if (!dishName && !description) return null;

  let hit = null;
  try {
    hit = await callUSDAFDC(env, dishName || "");
  } catch {}

  if (!hit && description) {
    const shortDesc = description.split(/[.,;]/)[0].slice(0, 80);
    try {
      hit = await callUSDAFDC(env, shortDesc);
    } catch {}
  }

  if (hit && hit.nutrients && typeof hit.nutrients === "object") {
    return hit.nutrients;
  }

  return null;
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
            dish.title || dish.name || query,
            url.origin
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
            dish.title || dish.name || query,
            url.origin
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
          dish.title || dish.name || query,
          url.origin
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

async function resolveRecipeWithCache(
  env,
  {
    dishTitle,
    placeId = "",
    cuisine = "",
    lang = "en",
    forceReanalyze = false,
    classify = false,
    shape = null,
    providersOverride = null,
    parse = true,
    userId = "",
    devFlag = false
  }
) {
  const dish = String(dishTitle || "").trim();
  if (!dish) {
    return {
      ok: false,
      status: 400,
      error: 'Missing "dish" (dish name).',
      hint: "Use: /recipe/resolve?dish=Chicken%20Alfredo"
    };
  }

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

  const cacheKey = recipeCacheKey(dish, lang);
  const force = !!forceReanalyze;
  let pickedSource = "cache";
  let recipe = null;
  let ingredients = [];
  let notes = {};
  let out = null;
  let selectedProvider = null;
  let cacheHit = false;
  let attempts = [];

  async function resolveFromProviders() {
    let selected = null;
    let candidateOut = null;
    let lastAttempt = null;
    const providerList = Array.isArray(providersOverride)
      ? providersOverride
      : providerOrder(env);
    for (const p of providerList) {
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
        candidateOut = candidate;
        selected = candidate.provider || p;
        break;
      }
    }
    if (!candidateOut && lastAttempt) {
      candidateOut = lastAttempt;
      if (!selected) selected = lastAttempt.provider || null;
    }
    return { candidateOut, selected };
  }

  const cached = !force ? await recipeCacheRead(env, cacheKey) : null;
  if (cached && cached.recipe && Array.isArray(cached.ingredients)) {
    cacheHit = true;
    pickedSource = cached.from || cached.provider || "cache";
    recipe = cached.recipe;
    ingredients = [...cached.ingredients];
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
  } else {
    const { candidateOut, selected } = await resolveFromProviders();
    out = candidateOut;
    selectedProvider = selected;
  }

  const cachedTitle =
    (out && out.recipe && (out.recipe.title || out.recipe.name)) || "";
  const dishLower = dish.toLowerCase();
  if (
    cacheHit &&
    cachedTitle &&
    isDietTitle(cachedTitle) &&
    !isDietTitle(dishLower)
  ) {
    cacheHit = false;
    out = null;
    recipe = null;
    ingredients = [];
    notes = { ...(notes || {}), skipped_cached_diet: cachedTitle };
    pickedSource = "cache_skip_diet";

    const { candidateOut, selected } = await resolveFromProviders();
    out = candidateOut;
    selectedProvider = selected;
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

  const wantParse = parse !== false;
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
  const kv = env.MENUS_CACHE;
  const dailyCap = parseInt(env.ZESTFUL_DAILY_CAP || "0", 10);

  if (wantParse && ingLines.length && env.ZESTFUL_RAPID_KEY) {
    const cachedParsed = [];
    const missingIdx = [];
    if (kv) {
      for (let i = 0; i < ingLines.length; i++) {
        const k = `zestful:${ingLines[i].toLowerCase()}`;
        let row = null;
        try {
          row = await kv.get(k, "json");
        } catch {}
        if (row) cachedParsed[i] = row;
        else missingIdx.push(i);
      }
    }

    let filled = cachedParsed.slice();
    if (missingIdx.length === ingLines.length || !kv) {
      const linesToParse = ingLines;
      const toParse = linesToParse.length;
      if (dailyCap) {
        const usedNow = await getZestfulCount(env);
        if (usedNow + toParse > dailyCap) {
          return {
            ok: false,
            status: 429,
            error: "ZESTFUL_CAP_REACHED",
            used: usedNow,
            toParse,
            cap: dailyCap
          };
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
          return {
            ok: false,
            status: 429,
            error: "ZESTFUL_CAP_REACHED",
            used: usedNow,
            toParse,
            cap: dailyCap
          };
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

    // Derive Edamam-based nutrition summary once, so it survives caching
    if (
      out &&
      out.raw &&
      out.raw.totalNutrients &&
      !out.nutrition_summary &&
      typeof nutritionSummaryFromEdamamTotalNutrients === "function"
    ) {
      const ns = nutritionSummaryFromEdamamTotalNutrients(
        out.raw.totalNutrients
      );
      if (ns) {
        out.nutrition_summary = ns;
      }
    }
  }

  const reply = {
    ok: true,
    source: responseSource,
    dish,
    place_id: placeId || null,
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

  const mergedOut = out ? { ...out, ...reply } : { ...reply };

  return {
    ...reply,
    responseSource,
    cacheHit,
    out: mergedOut,
    notes,
    parsed,
    ingLines,
    attempts,
    classify,
    shape,
    userId,
    devFlag
  };
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
      else if (userId && env.MENUS_CACHE) {
        const kvKey = `tier/user:${userId}`;
        const tier = await env.MENUS_CACHE.get(kvKey);
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
  const kv = env.MENUS_CACHE;
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

  if (wantShape === "likely_recipe" || wantShape === "likely_recipe_md") {
    const ingForCookbook =
      (out?.ingredients_lines && out.ingredients_lines.length
        ? out.ingredients_lines
        : ingredients) || [];
    const stepSource =
      (Array.isArray(recipe?.steps) && recipe.steps.length
        ? recipe.steps
        : Array.isArray(out?.recipe?.steps)
          ? out.recipe.steps
          : []) || [];
    const servingInfo =
      recipe && typeof recipe === "object"
        ? {
            servings: recipe.servings ?? recipe.yield ?? null,
            grams: recipe.grams ?? null
          }
        : null;
    const md = formatLikelyRecipeMarkdown({
      dishName: dish,
      rawIngredients: ingForCookbook,
      rawSteps: stepSource,
      servingInfo
    });
    return new Response(md, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "access-control-allow-origin": "*"
      }
    });
  }

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
      const tier = await (env.MENUS_CACHE ? env.MENUS_CACHE.get(kvKey) : null);
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

    let j = {};
    try {
      j = await res.clone().json();
    } catch {
      await res.text().catch(() => {});
    } finally {
      if (res.body && typeof res.body.cancel === "function") {
        res.body.cancel();
      }
    }

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

// ---------- GATEWAY: Google Place Details (no restaurant_core) ----------
// After fetching Google Place details, extract photo_reference if available
function extractPlacePhotoReference(place) {
  const photos = place?.photos;
  if (!photos || !photos.length) return null;
  return photos[0].photo_reference || null;
}

function extractGooglePhotoUrl(place, apiKey) {
  const photos = place.photos;
  if (!photos || !photos.length) return null;

  const ref = photos[0].photo_reference;
  if (!ref) return null;

  const params = new URLSearchParams({
    maxwidth: "1200",
    photoreference: ref,
    key: apiKey
  });

  return `https://maps.googleapis.com/maps/api/place/photo?${params.toString()}`;
}

async function fetchGooglePlaceDetailsGateway(env, placeId) {
  console.log(
    "DEBUG: fetchGooglePlaceDetailsGateway called with placeId:",
    placeId
  );

  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Missing GOOGLE_MAPS_API_KEY" };
  }

  const params = new URLSearchParams();
  params.set("place_id", placeId);
  params.set("key", apiKey);
  const url =
    "https://maps.googleapis.com/maps/api/place/details/json?" +
    params.toString();

  try {
    const resp = await fetch(url);
    console.log("DEBUG: Google details status:", resp.status);

    const txt = await resp.text();
    console.log("DEBUG: Google details raw:", txt);

    if (!resp.ok) {
      return {
        ok: false,
        error: `Google Place Details HTTP ${resp.status}: ${txt.slice(0, 200)}`
      };
    }

    let data;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch {
      return {
        ok: false,
        error: "Google Place Details: response was not JSON."
      };
    }

    const result = data.result || {};
    const loc =
      result.geometry && result.geometry.location
        ? result.geometry.location
        : {};

    return {
      ok: true,
      name: result.name || "",
      address:
        result.formatted_address ||
        [result.vicinity, result.formatted_address].filter(Boolean).join(", "),
      lat: loc.lat ?? null,
      lng: loc.lng ?? null,
      raw: data
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ---------- GATEWAY: Wait for Uber Job (wrapper around pollUberJobUntilDone) ----------
async function waitForUberJobGateway(env, job, { attempts = 6 } = {}) {
  if (!job || job.immediate) return job;

  const jobId =
    job?.job_id ||
    job?.id ||
    job?.data?.job_id ||
    job?.data?.id ||
    job?.returnvalue?.job_id ||
    job?.returnvalue?.id;

  if (!jobId) return job;

  return pollUberJobUntilDone({
    jobId,
    env,
    maxTries: Math.max(1, attempts)
  });
}

// ---------- GATEWAY: Flatten Uber payload -> item list ----------
function flattenUberPayloadToItemsGateway(payload, opts = {}) {
  if (!payload) return [];

  const targetName = (opts.targetName || "").toLowerCase().trim();
  const candidateStores = [];

  function maybePushStore(obj) {
    if (!obj || typeof obj !== "object") return;
    const menu = Array.isArray(obj.menu) ? obj.menu : null;
    if (!menu) return;

    const title =
      obj.title || obj.name || obj.sanitizedTitle || obj.storeName || "";
    if (!title) return;

    candidateStores.push(obj);
  }

  const containers = [
    payload,
    payload.data,
    payload.data?.data,
    payload.data?.items,
    payload.items,
    payload.stores,
    payload.data?.stores,
    payload.returnvalue,
    payload.returnvalue?.data
  ].filter(Boolean);

  for (const c of containers) {
    if (Array.isArray(c)) {
      for (const item of c) maybePushStore(item);
    } else if (typeof c === "object") {
      maybePushStore(c);
      if (Array.isArray(c.items)) {
        for (const item of c.items) maybePushStore(item);
      }
      if (Array.isArray(c.data)) {
        for (const item of c.data) maybePushStore(item);
      }
      if (Array.isArray(c.stores)) {
        for (const item of c.stores) maybePushStore(item);
      }
    }
  }

  let stores = candidateStores;

  if (targetName && stores.length > 1) {
    const scored = stores.map((s) => {
      const title = (s.title || s.name || s.sanitizedTitle || s.storeName || "")
        .toLowerCase()
        .trim();
      let score = 0;
      if (title === targetName) score += 100;
      if (title.includes(targetName)) score += 50;
      if (targetName.includes(title) && title.length > 0) score += 40;
      return { s, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const bestScore = scored[0]?.score ?? 0;

    if (bestScore > 0) {
      const best = scored.filter((x) => x.score === bestScore).map((x) => x.s);
      stores = best.length ? best : stores;
    }
  }

  const flat = [];

  for (const store of stores) {
    const restaurantTitle =
      store.title ||
      store.name ||
      store.sanitizedTitle ||
      store.storeName ||
      "";
    const restaurantAddress =
      store.location?.address ||
      store.location?.streetAddress ||
      store.location?.formattedAddress ||
      "";

    const menus = Array.isArray(store.menu) ? store.menu : [];

    for (const section of menus) {
      const sectionName = section.catalogName || section.sectionName || "";
      const items = Array.isArray(section.catalogItems)
        ? section.catalogItems
        : [];

      for (const item of items) {
        if (!item) continue;
        const name = item.title || item.name || "";
        if (!name) continue;

        let imageUrl = null;
        if (item.imageUrl || item.image_url || item.image) {
          imageUrl = item.imageUrl || item.image_url || item.image;
        } else if (Array.isArray(item.images) && item.images.length > 0) {
          imageUrl =
            item.images[0].url ||
            item.images[0].imageUrl ||
            item.images[0].image_url ||
            null;
        } else if (item.photo && typeof item.photo === "object") {
          imageUrl =
            item.photo.url ||
            item.photo.imageUrl ||
            item.photo.image_url ||
            null;
        }

        flat.push({
          name,
          description: item.itemDescription || item.description || "",
          section: sectionName,
          price: typeof item.price === "number" ? item.price : null,
          price_display: item.priceTagline || null,
          calories_display: item.calories || item.calories_display || null,
          restaurantTitle,
          restaurantAddress,
          imageUrl,
          raw: item
        });
      }
    }
  }

  return flat;
}

// ---------- GATEWAY: Strict filter items to this Google restaurant ----------
// ---------- GATEWAY: Strict filter + scored fallback to a single restaurant ----------
function filterUberItemsByGoogleContextGateway(items, googleContext) {
  if (!Array.isArray(items) || !items.length || !googleContext) return [];

  const gName = googleContext.name || "";
  const gAddr = googleContext.address || "";

  // If we somehow don't have either, we can't reliably match.
  if (!gName && !gAddr) return [];

  // 1) Primary: strict Google-based filter (same as before)
  const strict = items.filter((it) => {
    const rName =
      it.restaurantTitle ||
      it.restaurant_name ||
      (it.restaurant && it.restaurant.name) ||
      "";
    const rAddr =
      it.restaurantAddress ||
      it.restaurant_address ||
      (it.restaurant && it.restaurant.address) ||
      "";

    if (gName && !strictNameMatch(gName, rName)) return false;
    if (gAddr && !strictAddressMatch(gAddr, rAddr)) return false;

    return true;
  });

  if (strict.length) {
    return strict;
  }

  // 2) Fallback: choose ONE best restaurant group by similarity to Google name+address.
  //    Still guarantees "one restaurant only", but not empty if Uber labels differ.

  // Group items by restaurant identity
  const groups = new Map();
  for (const it of items) {
    const rName =
      it.restaurantTitle ||
      it.restaurant_name ||
      (it.restaurant && it.restaurant.name) ||
      "";
    const rAddr =
      it.restaurantAddress ||
      it.restaurant_address ||
      (it.restaurant && it.restaurant.address) ||
      "";

    const key = `${rName}||${rAddr}`;
    if (!groups.has(key)) {
      groups.set(key, { name: rName, address: rAddr, items: [] });
    }
    groups.get(key).items.push(it);
  }

  if (!groups.size) {
    return [];
  }

  // Helper: name similarity using the same token machinery we already have
  function nameSimilarity(a, b) {
    const aTokens = nameTokens(a);
    const bTokens = nameTokens(b);
    if (!aTokens.length || !bTokens.length) return 0;
    return tokenSetSimilarity(aTokens, bTokens); // 0..1
  }

  // Helper: address similarity by token overlap
  function addressSimilarity(a, b) {
    const aNorm = normalizeAddress(a || "");
    const bNorm = normalizeAddress(b || "");
    if (!aNorm || !bNorm) return 0;
    const aTokens = aNorm.split(" ");
    const bTokens = bNorm.split(" ");
    const aSet = new Set(aTokens);
    let intersect = 0;
    for (const t of bTokens) {
      if (aSet.has(t)) intersect++;
    }
    const minLen = Math.min(aTokens.length, bTokens.length);
    if (!minLen) return 0;
    return intersect / minLen; // 0..1
  }

  let bestGroup = null;
  let bestScore = 0;

  for (const [, group] of groups.entries()) {
    const rName = group.name || "";
    const rAddr = group.address || "";

    const nSim = gName ? nameSimilarity(gName, rName) : 0;
    const aSim = gAddr ? addressSimilarity(gAddr, rAddr) : 0;

    // Weighted score: name is more important than address
    const score = nSim * 0.7 + aSim * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestGroup = group;
    }
  }

  // Threshold: if it's really not similar, better return no menu than wrong menu
  const MIN_SCORE = 0.4; // you can tweak this after testing
  if (!bestGroup || bestScore < MIN_SCORE) {
    return [];
  }

  return bestGroup.items || [];
}

// ---------- GATEWAY: Uber menu caller (single-restaurant, strict) ----------
async function callUberMenuGateway(env, googleContext, opts = {}) {
  const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const key = env.RAPIDAPI_KEY || env.RAPID_API_KEY;
  if (!key) {
    return {
      ok: false,
      source: "uber_gateway_menu",
      error: "Missing RAPIDAPI_KEY"
    };
  }
  if (!host) {
    return {
      ok: false,
      source: "uber_gateway_menu",
      error: "Missing UBER_RAPID_HOST"
    };
  }

  const query = googleContext.name || "";
  const address = googleContext.address || "";

  if (!query || !address) {
    return {
      ok: false,
      source: "uber_gateway_menu",
      error: "Missing query or address for Uber menu"
    };
  }

  const maxRows = opts.maxRows ?? 150;
  const locale = opts.locale || "en-US";
  const page = opts.page || 1;
  const attempts = opts.attempts || 8;

  let job = await postJobByAddress(
    { query, address, maxRows, locale, page, webhook: null },
    env
  );
  let payload = await waitForUberJobGateway(env, job, { attempts });
  payload = payload?.raw || payload || job?.raw || job;

  let uberItems = flattenUberPayloadToItemsGateway(payload, {
    targetName: ""
  });
  if (!Array.isArray(uberItems)) {
    uberItems = [];
  }

  if (!uberItems.length) {
    return {
      ok: false,
      source: "uber_gateway_menu",
      error: "Uber job completed but no items were found in payload."
    };
  }

  const strictItems = filterUberItemsByGoogleContextGateway(
    uberItems,
    googleContext
  );
  if (!strictItems.length) {
    return {
      ok: false,
      source: "uber_gateway_menu",
      error: "No items matched Google restaurant after strict filter."
    };
  }

  return { ok: true, source: "uber_gateway_menu", items: strictItems };
}

// ---------- GATEWAY: Full menu extractor (used by /menu/extract) ----------
async function extractMenuGateway(
  env,
  { placeId, url, restaurantName, address, lat, lng }
) {
  if (!placeId) {
    return {
      ok: false,
      source: "menu_extract",
      error: "Missing placeId"
    };
  }

  const place = await fetchGooglePlaceDetailsGateway(env, placeId);
  if (!place.ok) {
    return {
      ok: false,
      source: "google_place_details_failed",
      restaurant: {
        id: placeId,
        name: restaurantName || "Unknown Restaurant",
        address: address || "",
        url: url || ""
      },
      googleError: place.error || null
    };
  }

  const {
    name: placeName,
    address: placeAddress,
    lat: placeLat,
    lng: placeLng
  } = place;
  const placePhotoRef = extractPlacePhotoReference(place?.raw?.result || {});
  const placePhotoUrl = extractGooglePhotoUrl(
    place?.raw?.result || {},
    env.GOOGLE_MAPS_API_KEY
  );

  // Prefer Google lat/lng; only fall back to query params if Google is missing
  const resolvedLat =
    typeof placeLat === "number" && Number.isFinite(placeLat)
      ? placeLat
      : typeof lat === "number" && Number.isFinite(lat)
        ? lat
        : null;

  const resolvedLng =
    typeof placeLng === "number" && Number.isFinite(placeLng)
      ? placeLng
      : typeof lng === "number" && Number.isFinite(lng)
        ? lng
        : null;

  // ✅ Ground truth: Google Place wins. Frontend is only a weak fallback.
  const finalName = placeName || restaurantName || "";
  const finalAddress = placeAddress || address || "";

  const googleCtx = {
    name: finalName,
    address: finalAddress,
    lat: resolvedLat ?? null,
    lng: resolvedLng ?? null,
    photoUrl: placePhotoUrl || null,
    photoRef: placePhotoRef || null
  };

  const uber = await callUberMenuGateway(env, googleCtx, {
    maxRows: 150,
    locale: "en-US",
    attempts: 8
  });

  if (!uber.ok || !Array.isArray(uber.items) || uber.items.length === 0) {
    return {
      ok: false,
      source: "uber_gateway_menu_failed",
      restaurant: {
        id: placeId,
        name: finalName || "Unknown Restaurant",
        address: finalAddress || "",
        url: url || ""
      },
      uberDebug: uber
    };
  }

  function extractCaloriesFromText(txt) {
    if (!txt || typeof txt !== "string") return null;
    const m = txt.match(/([\d,.]+)\s*Cal/i);
    if (!m) return null;
    const num = parseInt(m[1].replace(/,/g, ""), 10);
    if (!Number.isFinite(num) || num <= 0) return null;
    return num;
  }

  const dishes = (uber.items || []).map((it, idx) => {
    const raw = it.raw || {};
    const imageUrl =
      it.imageUrl || raw.imageUrl || raw.image_url || raw.image || null;

    const numericRestaurantCalories =
      (typeof it.restaurantCalories === "number"
        ? it.restaurantCalories
        : null) ??
      (raw?.nutrition && typeof raw.nutrition.calories === "number"
        ? raw.nutrition.calories
        : null) ??
      (typeof it.calories === "number" ? it.calories : null) ??
      extractCaloriesFromText(it.price_display) ??
      extractCaloriesFromText(it.priceText) ??
      extractCaloriesFromText(it.description || raw.description || "") ??
      null;

    return {
      id: `canon-${idx + 1}`,
      name: it.name || `Item ${idx + 1}`,
      description: it.description || "",
      section: it.section || null,
      source: "uber",
      rawPrice: typeof it.price === "number" ? it.price : null,
      priceText: it.price_display || null,
      imageUrl,
      restaurantCalories: numericRestaurantCalories
    };
  });

  // 1) Drop noise items (drinks, sides, utensils, etc.)
  const filteredDishes = filterMenuForDisplay(dishes);

  // 2) Assign canonicalCategory to each dish
  const classified = filteredDishes.map((d) => {
    const category = canonicalCategoryFromSectionAndName(d.section, d.name);
    return {
      ...d,
      canonicalCategory: classifyCanonicalCategory({
        ...d,
        canonicalCategory: category
      })
    };
  });

  // Wing-specific override
  const withWingOverride = classified.map((it) => {
    const override = classifyWingPlatter(it);
    return {
      ...it,
      canonicalCategory: override || it.canonicalCategory
    };
  });

  // Bowl-specific override (after wing override)
  const withBowlOverride = withWingOverride.map((it) => {
    const override = classifyBowl(it);
    return {
      ...it,
      canonicalCategory: override || it.canonicalCategory
    };
  });

  // Wrap/Quesadilla/Melt/Philly override (after bowl override)
  const withWrapOverride = withBowlOverride.map((it) => {
    const override = classifyWrapQuesadilla(it);
    return {
      ...it,
      canonicalCategory: override || it.canonicalCategory
    };
  });

  // Section-based remap (fallback) after wraps
  const withSectionRemap = withWrapOverride.map((it) => {
    const override = classifyBySectionFallback(it);
    return {
      ...it,
      canonicalCategory: override || it.canonicalCategory
    };
  });

  // Tier 3 LLM classification + overrides
  const withLLM =
    env.MENU_CLASSIFIER_CACHE && env.AI
      ? await applyLLMClassification(env, withSectionRemap)
      : withSectionRemap;
  const hardFilteredLLM = normalizeWrapsAndSaladBowls(
    applyLLMOverrides(withLLM)
  ).filter((it) => !hardBlockItem(it.name, it.description));

  // Final hard blocklist (no exceptions)
  const hardFiltered = hardFilteredLLM;

  const normalizedFinal = finalNormalizeCategories(hardFiltered);
  const sections = groupItemsIntoSections(normalizedFinal);

  return {
    ok: true,
    source: "uber_gateway_menu",
    restaurant: {
      id: placeId,
      name: finalName,
      address: finalAddress,
      url,
      imageUrl: googleCtx.photoUrl || null,
      imageRef: googleCtx.photoRef || null
    },
    sections
  };
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
function pickBestRestaurant({ rows, query, googleContext }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  // 1) Strict identity filter using Google info (name + address + lat/lng)
  if (googleContext) {
    const strictMatches = rows.filter((r) =>
      passesStrictRestaurantMatch(
        {
          name: googleContext.name || query,
          address: googleContext.address,
          lat: googleContext.lat,
          lng: googleContext.lng
        },
        r
      )
    );

    if (strictMatches.length === 1) {
      return strictMatches[0];
    }
    if (strictMatches.length > 1) {
      // choose closest by distance among strict matches
      let best = strictMatches[0];
      let bestDist = Infinity;
      for (const r of strictMatches) {
        const uLat = r.location && (r.location.latitude || r.location.lat);
        const uLng = r.location && (r.location.longitude || r.location.lng);
        const d = computeDistanceMeters(
          googleContext.lat,
          googleContext.lng,
          uLat,
          uLng
        );
        if (d != null && d < bestDist) {
          bestDist = d;
          best = r;
        }
      }
      return best;
    }
    // if no strict matches → fall through to legacy scoring as a fallback
  }

  // 2) Legacy scoring fallback (keeps system working if no googleContext)
  function scoreRow(row) {
    const name = (
      row.title ||
      row.sanitizedTitle ||
      row.name ||
      ""
    ).toLowerCase();
    const q = (query || "").toLowerCase();
    if (!name || !q) return 0;

    if (name === q) return 100;
    if (name.startsWith(q)) return 90;
    if (name.includes(q)) return 80;

    const nameTokens = name.split(/\s+/);
    const qTokens = q.split(/\s+/);
    const nSet = new Set(nameTokens);
    let overlap = 0;
    for (const t of qTokens) {
      if (nSet.has(t)) overlap++;
    }
    const ratio = overlap / Math.max(1, qTokens.length);
    return Math.round(60 * ratio);
  }

  const scored = rows.map((r) => ({
    row: r,
    score: scoreRow(r)
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0] ? scored[0].row : null;
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

const _worker_impl = {
  // ---- HTTP routes (health + debug + enqueue + results + uber-test) ----
  fetch: async (request, env, ctx) => {
    const url = new URL(request.url);
    // async fire-and-forget metrics logging
    try {
      const bodyPreview =
        request.method === "POST"
          ? (await request.clone().text()).slice(0, 300)
          : "";
      const logPayload = JSON.stringify({
        ts: Date.now(),
        method: request.method,
        path: url.pathname,
        user_id: url.searchParams.get("user_id") || null,
        correlation_id:
          request.headers.get("x-correlation-id") || crypto.randomUUID(),
        preview: bodyPreview
      });
      // NOTE: metrics_core is used as a BEST-EFFORT logging sink only.
      // The canonical app data (analysis jobs, meal logs, etc.) lives in the gateway D1_DB.
      // Nothing in the main pipeline depends on metrics_core responses.
      // It is safe to treat failures here as non-fatal.
      ctx.waitUntil(
        env.metrics_core.fetch(
          "https://tb-metrics-core.tummybuddy.workers.dev/metrics/ingest",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: logPayload
          }
        )
      );
    } catch (err) {
      console.error("metrics error", err);
    }
    const pathname = normPathname(url);
    const searchParams = url.searchParams;

    if (!(pathname === "/healthz" && request.method === "GET")) {
      const limited = await rateLimit(env, request, { limit: 60 });
      if (limited) return limited;
    }

    if (pathname === "/healthz" && request.method === "GET") {
      return handleHealthz(env);
    }

    if (pathname === "/analyze/allergens-mini" && request.method === "POST") {
      return handleAllergenMini(request, env, ctx);
    }

    if (pathname === "/pipeline/analyze-dish" && request.method === "POST") {
      try {
        const body = (await readJson(request)) || {};

        const { status, result } = await runDishAnalysis(env, body, ctx);
        return okJson(result, status);
      } catch (err) {
        return new Response(
          JSON.stringify({
            ok: false,
            source: "pipeline.analyze-dish",
            error: "pipeline_analyze_dish_exception",
            details: err && err.message ? String(err.message) : String(err)
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
    }
    if (
      pathname === "/pipeline/analyze-dish/card" &&
      request.method === "POST"
    ) {
      try {
        const body = (await readJson(request)) || {};

        const { status, result } = await runDishAnalysis(env, body, ctx);
        if (status !== 200) return okJson(result, status);
        const card = {
          apiVersion: result.apiVersion || "v1",
          dishName: result.dishName || body?.dishName || body?.dish || null,
          restaurantName:
            result.restaurantName ||
            body?.restaurantName ||
            body?.restaurant ||
            null,
          summary: result.summary || null
        };
        return okJson(card, status);
      } catch (err) {
        return new Response(
          JSON.stringify({
            ok: false,
            source: "pipeline.analyze-dish/card",
            error: "pipeline_analyze_dish_card_exception",
            details: err && err.message ? String(err.message) : String(err)
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
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
    if (pathname === "/debug/whoami" && request.method === "GET") {
      return tbWhoami(env);
    }
    // DEBUG ONLY: calls whoami on bound cores
    if (pathname === "/debug/brain-health" && request.method === "GET") {
      const urlBase = new URL(request.url).origin;
      const results = {};

      results.gateway = {
        ok: true,
        env: env?.ENV || "production",
        built_at: env?.BUILT_AT || "n/a",
        base: urlBase
      };

      const metricsFetch =
        env.metrics_core?.fetch?.bind(env.metrics_core) || null;

      const metricsUrl =
        env.METRICS_CORE_URL || "https://tb-metrics-core.internal/debug/whoami";

      // Legacy recipe core worker has been demoted; main gateway now owns recipe resolution.
      results.recipeCoreLegacy = {
        ok: true,
        note: "legacy recipe core demoted; using main gateway only"
      };

      // Legacy allergen core worker has been demoted; main gateway now owns organ scoring.
      results.allergenCoreLegacy = {
        ok: true,
        note: "legacy allergen core demoted; using main gateway only"
      };

      results.metrics_core = await callJson(metricsUrl, {
        fetcher: metricsFetch
      }).catch((e) => ({
        ok: false,
        error: String(e)
      }));

      const overallOk = results.gateway.ok && results.metrics_core.ok;

      return new Response(
        JSON.stringify(
          {
            ok: overallOk,
            results
          },
          null,
          2
        ),
        {
          status: overallOk ? 200 : 503,
          headers: { "content-type": "application/json" }
        }
      );
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
          kv: !!env.MENUS_CACHE,
          d1: !!env.D1_DB,
          queue: !!env.ANALYSIS_QUEUE,
          rapidapi_host: !!env.RAPIDAPI_HOST || !!env.UBER_RAPID_HOST,
          rapidapi_key: !!env.RAPIDAPI_KEY
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
            kv: !!env.MENUS_CACHE,
            d1: !!env.D1_DB,
            RAPIDAPI_HOST: !!env.RAPIDAPI_HOST,
            RAPIDAPI_KEY: !!env.RAPIDAPI_KEY
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

    if (pathname === "/menu/extract" && request.method === "GET") {
      const url = new URL(request.url);
      const placeId = url.searchParams.get("placeId") || "";
      const urlParam = url.searchParams.get("url") || "";
      const restaurantName = url.searchParams.get("restaurantName") || "";
      const address = url.searchParams.get("address") || "";

      const latParam = url.searchParams.get("lat");
      const lngParam = url.searchParams.get("lng");
      const lat = latParam != null ? Number(latParam) : undefined;
      const lng = lngParam != null ? Number(lngParam) : undefined;

      try {
        const result = await extractMenuGateway(env, {
          placeId,
          url: urlParam,
          lat,
          lng,
          restaurantName,
          address
        });

        return okJson(result);
      } catch (err) {
        console.error("MENU_EXTRACT_UNHANDLED_ERROR_GATEWAY", {
          placeId,
          restaurantName,
          address,
          lat,
          lng,
          error: String(err?.message || err)
        });

        return new Response(
          JSON.stringify({
            ok: false,
            source: "menu_extract_gateway",
            error: String(err?.message || err)
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" }
          }
        );
      }
    }
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

            const googleContext = {
              name: query,
              address: addressRaw,
              lat: lat ? Number(lat) : null,
              lng: lng ? Number(lng) : null
            };

            const best = pickBestRestaurant({
              rows: rowsUS,
              query,
              googleContext
            });
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

          const googleContext = {
            name: query,
            address: addressRaw,
            lat: lat ? Number(lat) : null,
            lng: lng ? Number(lng) : null
          };

          const best = pickBestRestaurant({
            rows: rowsUS,
            query,
            googleContext
          });
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
        const val = await (env.MENUS_CACHE ? env.MENUS_CACHE.get(key) : null);
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
      if (!env.MENUS_CACHE)
        return new Response(
          JSON.stringify({ ok: false, error: "MENUS_CACHE not bound" }),
          {
            status: 500,
            headers: {
              "content-type": "application/json",
              "access-control-allow-origin": "*"
            }
          }
        );
      await env.MENUS_CACHE.put(key, tier);
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
      const okKV = !!env.MENUS_CACHE;
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

    // /restaurants/find → inline Google Places (no more recursive service call)
    if (pathname === "/restaurants/find") {
      return handleRestaurantsFindGateway(env, url);
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
      const id = _cid(request.headers);
      const body = (await readJsonSafe(request)) || {};

      const ingredients = Array.isArray(body.ingredients)
        ? body.ingredients
        : [];
      const user_flags = body.user_flags || body.userFlags || {};
      const lex_hits = Array.isArray(body.lex_hits) ? body.lex_hits : [];

      const organs = await assessOrgansLocally(env, {
        ingredients,
        user_flags,
        lex_hits
      });

      const headers = new Headers({
        "content-type": "application/json; charset=utf-8",
        "x-correlation-id": id,
        "x-tb-worker": env.WORKER_NAME || "tb-dish-processor-production",
        "x-tb-env": env.ENV || "production",
        "x-tb-git": env.GIT_SHA || "n/a",
        "x-tb-built": env.BUILT_AT || "n/a"
      });

      return new Response(JSON.stringify(organs), {
        status: 200,
        headers
      });
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
        "Try: GET /health, /debug/ping, /debug/job?id=..., /results/<id>.json, /menu/uber-test;\n" +
        "POST /enqueue",
      { status: 200, headers: { "content-type": "text/plain" } }
    );
  }
};

// ========== Helper utilities ==========
const lc = (s) => (s ?? "").toLowerCase().normalize("NFKC").trim();

// [39.2] — mark first-seen boot time in KV (best-effort)
async function ensureBootTime(env) {
  if (!env?.MENUS_CACHE) return null;
  try {
    const key = "meta/boot_at";
    let boot = await env.MENUS_CACHE.get(key);
    if (!boot) {
      boot = new Date().toISOString();
      await env.MENUS_CACHE.put(key, boot, { expirationTtl: 30 * 24 * 3600 });
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
  const kv = env.MENUS_CACHE;
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

  const kv = env.MENUS_CACHE;
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
    { max: 30, name: "Likely OK" },
    { max: 69, name: "Caution" },
    { max: 100, name: "Avoid" }
  ],
  maxRaw: 100
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const toScore = (raw, maxRaw = RISK.maxRaw) =>
  Math.round(clamp01(raw / maxRaw) * 100);
const labelFor = (score) =>
  score >= 70 ? "Avoid" : score >= 40 ? "Caution" : "Likely OK";

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
function getEdamamHealthLabelsFromRecipe(recipeResult) {
  if (!recipeResult || !recipeResult.out) return [];

  const raw = recipeResult.out.raw || {};
  let labels = raw.healthLabels;

  if (
    !Array.isArray(labels) &&
    raw.recipe &&
    Array.isArray(raw.recipe.healthLabels)
  ) {
    labels = raw.recipe.healthLabels;
  }

  if (!Array.isArray(labels)) return [];

  return labels.map((l) => (l || "").toString().trim()).filter(Boolean);
}
function getEdamamFodmapOverrideFromRecipe(recipeResult) {
  if (!recipeResult || !recipeResult.out) return null;

  const raw = recipeResult.out.raw || {};
  let labels = raw.healthLabels;

  if (
    !Array.isArray(labels) &&
    raw.recipe &&
    Array.isArray(raw.recipe.healthLabels)
  ) {
    labels = raw.recipe.healthLabels;
  }

  if (!Array.isArray(labels) || !labels.length) {
    return null;
  }

  const normalized = labels
    .map((l) => (l || "").toString().toLowerCase().replace(/[_-]/g, " ").trim())
    .filter(Boolean);

  const hasFodmapFree = normalized.some(
    (l) => l.includes("fodmap") && l.includes("free")
  );

  if (!hasFodmapFree) {
    return null;
  }

  return {
    level: "low",
    reason: "Edamam healthLabels include FODMAP-free.",
    source: "edamam"
  };
}
function extractLactoseFromLexHits(rawHits) {
  for (const h of rawHits || []) {
    const lac = h && h.lactose;
    if (lac && typeof lac.level === "string") {
      return {
        level: String(lac.level).toLowerCase(),
        reason: lac.reason || "Lactose level from classifier.",
        source: "classifier"
      };
    }
  }
  return null;
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

function extractLactoseFromHits(hits) {
  if (!Array.isArray(hits) || !hits.length) return null;

  const rank = { high: 3, moderate: 2, medium: 2, low: 1, none: 0, unknown: 0 };
  let bestLevel = null;
  const examples = new Set();

  for (const h of hits) {
    const fod = h.fodmap || {};
    const bandRaw = h.lactose_band || (fod && fod.lactose_band) || "";
    const band = String(bandRaw || "").toLowerCase();
    const drivers = Array.isArray(fod.drivers) ? fod.drivers.map(String) : [];
    const mentionsLactose =
      drivers.some((d) => d.toLowerCase() === "lactose") || !!band;

    if (!mentionsLactose) continue;

    // derive normalized lactose level
    let lvl = (band || String(fod.level || "")).toLowerCase();
    if (lvl === "very_high" || lvl === "ultra_high") lvl = "high";
    if (lvl === "medium") lvl = "moderate";
    if (!lvl) lvl = "unknown";

    if (!bestLevel || rank[lvl] > rank[bestLevel]) bestLevel = lvl;

    const name = h.canonical || h.term || (fod && fod.note) || "";
    if (name) examples.add(name);
  }

  // If we saw no lactose-related hits at all, return null
  if (!bestLevel) return null;

  // Even if bestLevel is "none", we still want to expose that to the frontend
  const level = bestLevel;

  let reason;
  if (level === "none") {
    reason = "Dairy appears effectively lactose-free or very low in lactose.";
  } else if (level === "low") {
    reason = "Includes low-lactose dairy ingredients.";
  } else if (level === "moderate") {
    reason = "Includes moderate-lactose dairy ingredients.";
  } else if (level === "high") {
    reason = "Includes high-lactose dairy ingredients.";
  } else {
    reason = "Lactose level inferred from classifier output.";
  }

  return {
    level,
    source: "classifier",
    reason,
    examples: Array.from(examples)
  };
}
function scoreDishFromHits(hits) {
  const safeHits = Array.isArray(hits) ? hits : [];

  // Prefer non-inference hits; only fall back to inference if none exist
  const primaryHits = safeHits.filter((h) => {
    const src = String(h?.source || "").toLowerCase();
    if (!src) return true;
    if (src.startsWith("infer:")) return false;
    return true;
  });
  const effectiveHits = primaryHits.length ? primaryHits : safeHits;

  const allergenSet = new Set();
  const rank = { high: 3, medium: 2, low: 1, unknown: 0 };
  let worstFodmap = "unknown";

  for (const h of effectiveHits) {
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
  const f = String(
    (flags && flags.fodmap && flags.fodmap.level) || flags?.fodmap || "unknown"
  ).toLowerCase();
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

function buildOrganSentences(organsArr = []) {
  const out = [];
  if (!Array.isArray(organsArr) || !organsArr.length) return out;

  for (const o of organsArr) {
    const key = o.organ || "";
    if (!key) continue;
    const organName =
      key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
    const plus = typeof o.plus === "number" ? o.plus : 0;
    const minus = typeof o.minus === "number" ? o.minus : 0;
    const neutral = typeof o.neutral === "number" ? o.neutral : 0;
    const compounds = Array.isArray(o.compounds) ? o.compounds : [];

    const countsText = `benefit: ${plus}, risk: ${minus}, neutral: ${neutral}`;
    const compoundsText = compounds.length
      ? ` [compounds: ${compounds.join(", ")}]`
      : "";

    out.push(`${organName}: ${countsText}${compoundsText}.`);
  }

  return out;
}

async function getOrganEffectsForIngredients(env, ingredients = []) {
  if (!env?.D1_DB) return { organs: {}, compoundsByOrgan: {} };

  const names = Array.from(
    new Set(
      (ingredients || [])
        .map((ing) =>
          (ing && ing.name
            ? ing.name
            : ing && ing.original
              ? ing.original
              : ing && ing.text
                ? ing.text
                : ""
          )
            .toString()
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  );

  const organs = {};
  const compoundsByOrgan = {};

  for (const name of names) {
    try {
      const like = `%${name}%`;
      const compRes = await env.D1_DB.prepare(
        `SELECT id, name, common_name, cid
         FROM compounds
         WHERE LOWER(name) LIKE ? OR LOWER(common_name) LIKE ?
         ORDER BY name LIMIT 3`
      )
        .bind(like, like)
        .all();
      const comps = compRes?.results || [];
      for (const c of comps) {
        const effRes = await env.D1_DB.prepare(
          `SELECT organ, effect, strength
           FROM compound_organ_effects
           WHERE compound_id = ?`
        )
          .bind(c.id)
          .all();
        const effs = effRes?.results || [];
        for (const e of effs) {
          const organKey = (e.organ || "unknown").toLowerCase().trim();
          if (!organKey) continue;
          if (!organs[organKey]) {
            organs[organKey] = { plus: 0, minus: 0, neutral: 0 };
            compoundsByOrgan[organKey] = new Set();
          }
          if (e.effect === "benefit") organs[organKey].plus++;
          else if (e.effect === "risk") organs[organKey].minus++;
          else organs[organKey].neutral++;

          compoundsByOrgan[organKey].add(c.name || c.common_name || name);
        }
      }
    } catch {
      // ignore individual ingredient failures
    }
  }

  const compoundsByOrganOut = {};
  for (const [org, set] of Object.entries(compoundsByOrgan)) {
    compoundsByOrganOut[org] = Array.from(set);
  }

  return { organs, compoundsByOrgan: compoundsByOrganOut };
}

function organLevelFromCounts({ plus = 0, minus = 0 }) {
  if (plus === 0 && minus === 0) return "Neutral";
  if (plus > 0 && minus === 0) {
    if (plus >= 3) return "High Benefit";
    return "Benefit";
  }
  if (minus > 0 && plus === 0) {
    if (minus >= 3) return "High Caution";
    return "Caution";
  }
  // mixed
  if (minus > plus) return "Caution";
  if (plus > minus) return "Benefit";
  return "Neutral";
}

async function assessOrgansLocally(
  env,
  { ingredients = [], user_flags = {}, lex_hits = [] }
) {
  const hits = Array.isArray(lex_hits) ? lex_hits : [];
  const scoring = scoreDishFromHits(hits);
  const baseFlags = deriveFlags(hits);
  const lactoseInfo = extractLactoseFromHits(hits);

  const fodmapLevel = scoring.flags?.fodmap || "unknown";

  const organsFlags = {
    ...baseFlags,
    allergens: Array.isArray(scoring.flags?.allergens)
      ? scoring.flags.allergens
      : [],
    fodmap: {
      level: fodmapLevel,
      reason: `FODMAP level ${fodmapLevel} inferred from classifier hits.`,
      source: "classifier"
    },
    ...(lactoseInfo ? { lactose: lactoseInfo } : {})
  };

  // --- Molecular organ graph (D1): ingredient -> compounds -> organ effects ---
  let organGraph = { organs: {}, compoundsByOrgan: {} };
  try {
    organGraph = await getOrganEffectsForIngredients(env, ingredients);
  } catch {
    // ignore graph failures, keep flags-only
  }

  const organsArr = [];
  for (const [organKey, counts] of Object.entries(organGraph.organs || {})) {
    const level = organLevelFromCounts(counts);
    organsArr.push({
      organ: organKey,
      level,
      plus: counts.plus,
      minus: counts.minus,
      neutral: counts.neutral,
      compounds: organGraph.compoundsByOrgan?.[organKey] || []
    });
  }

  const organs = {
    ok: true,
    source: "assessOrgansLocally",
    tummy_barometer: scoring.tummy_barometer,
    flags: organsFlags,
    organs: organsArr,
    user_flags: user_flags || {},
    ingredients
  };

  // lightweight debug block
  organs.debug = organs.debug || {};
  organs.debug.molecular_summary = {
    organ_count: organsArr.length,
    organs: organsArr.map((o) => ({
      organ: o.organ,
      level: o.level,
      plus: o.plus,
      minus: o.minus
    }))
  };

  return organs;
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
  if (!env?.MENUS_CACHE) return null;
  try {
    const raw = await env.MENUS_CACHE.get(STATUS_KV_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function bumpStatusKV(env, delta = {}) {
  if (!env?.MENUS_CACHE) return;
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
    await env.MENUS_CACHE.put(STATUS_KV_KEY, JSON.stringify(cur), {
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
  if (!env?.MENUS_CACHE) return null;
  try {
    const raw = await env.MENUS_CACHE.get(key);
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
  if (!env?.MENUS_CACHE) return false;
  try {
    const body = JSON.stringify({ savedAt: new Date().toISOString(), data });
    await env.MENUS_CACHE.put(key, body, { expirationTtl: MENU_TTL_SECONDS });
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
function filterLexHitsForIngredient(ingredientName, hits) {
  if (!ingredientName || !Array.isArray(hits)) return [];

  const lowerName = String(ingredientName || "").toLowerCase();
  const fishKeywords = [
    "fish",
    "salmon",
    "tuna",
    "cod",
    "anchovy",
    "sardine",
    "bacalao",
    "bacalhau",
    "trout",
    "tilapia",
    "shrimp",
    "prawn",
    "crab",
    "lobster"
  ];

  return hits.filter((hit) => {
    if (!hit) return false;

    const term = (hit.term || "").toLowerCase();
    const canonical = (hit.canonical || "").toLowerCase();
    const tags = Array.isArray(hit.tags)
      ? hit.tags.map((t) => (t || "").toLowerCase())
      : [];
    const classes = Array.isArray(hit.classes)
      ? hit.classes.map((c) => (c || "").toLowerCase())
      : [];

    if (tags.includes("brand_label_exception")) return false;

    const nameHasTerm = term && lowerName.includes(term);
    const termHasName = term && term.includes(lowerName);
    const nameHasCanonical = canonical && lowerName.includes(canonical);
    const canonicalHasName = canonical && canonical.includes(lowerName);

    const overlapsTextually =
      nameHasTerm || termHasName || nameHasCanonical || canonicalHasName;
    if (!overlapsTextually) return false;

    const isFishClass = classes.includes("fish");
    if (isFishClass) {
      const ingredientLooksLikeFish = fishKeywords.some((w) =>
        lowerName.includes(w)
      );
      if (!ingredientLooksLikeFish) return false;
    }

    return true;
  });
}
// Shared helper for /pipeline/analyze-dish and /pipeline/analyze-dish/card
async function runDishAnalysis(env, body, ctx) {
  const correlationId =
    (body && body.correlationId) || (body && body.cid) || null;
  let debug = {};
  const useParallel = env && env.PARALLEL_LLM === "true";
  const lang = body.lang || body.language || "en";
  let devFlag =
    body.dev === true || body.dev === 1 || body.dev === "1" || false;
  const restaurantCalories = body.restaurantCalories;
  const portionFactor = body.portionFactor;
  const dishImageUrl = body.imageUrl ?? null;
  const selectionComponentIdsInput = Array.isArray(
    body.selection_component_ids
  )
    ? body.selection_component_ids
    : null;

  const dishName = (body.dishName || body.dish || "").trim();
  const restaurantName = (body.restaurantName || body.restaurant || "").trim();
  const menuDescription = (
    body.menuDescription ||
    body.description ||
    body.dishDescription ||
    ""
  ).trim();
  const menuSection = body.menuSection || body.section || null;
  const canonicalCategory = body.canonicalCategory || body.category || null;

  // cache keys for tracing
  debug.request_tags = {
    dishName,
    restaurantName,
    menuSection,
    canonicalCategory,
    cid: correlationId
  };

  // FatSecret env snapshot (no secrets, just presence + settings)
  const fatsecretScopeEffective = "image-recognition";

  debug.fatsecret_env = {
    hasClientId: !!env.FATSECRET_CLIENT_ID,
    hasClientSecret: !!env.FATSECRET_CLIENT_SECRET,
    scopesEnv: env.FATSECRET_SCOPES || null,
    scopeEffective: fatsecretScopeEffective,
    region: env.FATSECRET_REGION || null,
    language: env.FATSECRET_LANGUAGE || null
  };

  var summary = null;
  var organs = null;
  var allergen_flags = [];
  var fodmap_flags = null;
  var lactose_flags = null;
  var lifestyle_tags = [];
  var lifestyle_checks = null;
  var nutrition_badges = null;
  let plateComponents = [];

  // FatSecret vision state
  let fatsecretImageResult = null;
  let fatsecretNormalized = null;
  let fatsecretNutritionBreakdown = null;
  let fsComponentAllergens = null;

  if (!dishName) {
    return {
      status: 400,
      result: {
        ok: false,
        error: "dishName is required",
        hint: "Include dishName (or dish) in the request body."
      }
    };
  }

  const recipeResult = await resolveRecipeWithCache(env, {
    dishTitle: dishName,
    placeId: body.placeId || body.place_id || "",
    cuisine: body.cuisine || "",
    lang: body.lang || "en",
    forceReanalyze:
      body.force_reanalyze === true ||
      body.forceReanalyze === true ||
      body.force_reanalyze === 1,
    classify: true,
    shape: "recipe_card",
    providersOverride: Array.isArray(body.providers)
      ? body.providers.map((p) => String(p || "").toLowerCase())
      : null,
    parse: true,
    userId: body.user_id || body.userId || "",
    devFlag
  });

  devFlag =
    devFlag || recipeResult?.devFlag || recipeResult?.out?.devFlag || false;

  const nutritionSummaryFromRecipe =
    (recipeResult && recipeResult.out && recipeResult.out.nutrition_summary) ||
    recipeResult.nutrition_summary ||
    null;
  let finalNutritionSummary = nutritionSummaryFromRecipe || null;
  let nutrition_source = null;

  if (recipeResult?.out?.nutrition_summary) {
    nutrition_source = "recipe_out";
  } else if (recipeResult?.nutrition_summary) {
    nutrition_source = "recipe_legacy";
  }

  if (
    !finalNutritionSummary &&
    recipeResult &&
    recipeResult.out &&
    recipeResult.out.raw &&
    recipeResult.out.raw.totalNutrients
  ) {
    try {
      const ns = nutritionSummaryFromEdamamTotalNutrients(
        recipeResult.out.raw.totalNutrients
      );
      if (ns) {
        finalNutritionSummary = ns;
        nutrition_source = "edamam_totalNutrients";
        if (recipeResult.out) {
          recipeResult.out.nutrition_summary = ns;
        }
      }
    } catch {
      // non-fatal
    }
  }

  if (
    !finalNutritionSummary &&
    recipeResult &&
    recipeResult.out &&
    recipeResult.out.raw &&
    recipeResult.out.raw.totalNutrients
  ) {
    try {
      const tn = recipeResult.out.raw.totalNutrients || {};
      const energy = tn.ENERC_KCAL?.quantity;
      const protein = tn.PROCNT?.quantity;
      const fat = tn.FAT?.quantity;
      const carbs = tn.CHOCDF?.quantity;
      const sugar = tn.SUGAR?.quantity;
      const fiber = tn.FIBTG?.quantity;
      const sodium = tn.NA?.quantity;

      finalNutritionSummary = {
        energyKcal: typeof energy === "number" ? energy : null,
        protein_g: typeof protein === "number" ? protein : null,
        fat_g: typeof fat === "number" ? fat : null,
        carbs_g: typeof carbs === "number" ? carbs : null,
        sugar_g: typeof sugar === "number" ? sugar : null,
        fiber_g: typeof fiber === "number" ? fiber : null,
        sodium_mg: typeof sodium === "number" ? sodium : null
      };
      nutrition_source = nutrition_source || "edamam_manual";

      if (recipeResult.out) {
        recipeResult.out.nutrition_summary = finalNutritionSummary;
      }
    } catch {
      // non-fatal
    }
  }

  const ingredientsParsed =
    recipeResult?.out && Array.isArray(recipeResult.out.ingredients_parsed)
      ? recipeResult.out.ingredients_parsed
      : Array.isArray(recipeResult?.parsed)
        ? recipeResult.parsed
        : null;

  // Rebuild ingredients from parsed rows if present
  let ingredients = Array.isArray(recipeResult?.ingredients)
    ? recipeResult.ingredients
    : [];
  if (
    (!ingredients || !ingredients.length) &&
    Array.isArray(ingredientsParsed)
  ) {
    ingredients = ingredientsParsed.map((row) => ({
      name: row.name || row.original || "",
      qty:
        typeof row.qty === "number"
          ? row.qty
          : row.qty != null
            ? Number(row.qty) || null
            : null,
      unit: row.unit || null,
      comment: row.comment || row.preparation || row.preparationNotes || null
    }));
  }

  if (!finalNutritionSummary) {
    try {
      // Tier 2 fallback: use parsed rows if available
      if (Array.isArray(ingredientsParsed) && ingredientsParsed.length) {
        await enrichWithNutrition(env, ingredientsParsed);
        finalNutritionSummary = sumNutrition(ingredientsParsed);
        if (finalNutritionSummary) {
          nutrition_source = "enriched_ingredients_parsed";
        }
      }
    } catch (e) {
      // non-fatal; leave nutrition summary null
      // swallow fallback errors
    }
  }

  if (
    !finalNutritionSummary &&
    recipeResult &&
    recipeResult.out &&
    recipeResult.out.reason === "no_edamam_hits"
  ) {
    try {
      const usdaSummary = await resolveNutritionFromUSDA(
        env,
        dishName,
        menuDescription || description || ""
      );
      if (usdaSummary) {
        finalNutritionSummary = usdaSummary;
        nutrition_source = "usda";
        if (recipeResult.out) {
          recipeResult.out.nutrition_summary = finalNutritionSummary;
        }
      }
    } catch (e) {
      // non-fatal; leave nutrition summary null
    }
  }

  let servingsUsed = 1;
  function getServingsFromRecipe(recipeResult) {
    try {
      const recipe =
        recipeResult && recipeResult.out && recipeResult.out.recipe;
      if (!recipe) return 1;
      const yieldValue =
        recipe.yield ?? recipe.servings ?? recipe.serving ?? recipe.portions;
      const n = Number(yieldValue);
      if (Number.isFinite(n) && n > 0) return n;
      return 1;
    } catch {
      return 1;
    }
  }

  const normalized = {
    ok: true,
    source: recipeResult?.responseSource || recipeResult?.source || null,
    cache: recipeResult?.cacheHit || recipeResult?.cache || false,
    items: ingredients,
    ingredients_lines:
      (recipeResult?.out && recipeResult.out.ingredients_lines) ||
      recipeResult?.ingLines ||
      [],
    ingredients_parsed:
      recipeResult?.out?.ingredients_parsed || recipeResult?.parsed || null
  };

  if (
    !finalNutritionSummary &&
    normalized &&
    Array.isArray(normalized.items) &&
    normalized.items.length
  ) {
    try {
      await enrichWithNutrition(env, normalized.items);
      finalNutritionSummary = sumNutrition(normalized.items);
      if (finalNutritionSummary) {
        nutrition_source = "enriched_normalized_items";
      }
      if (recipeResult?.out) {
        recipeResult.out.nutrition_summary = finalNutritionSummary;
      }
    } catch (e) {
      if (!debug) debug = {};
      debug.nutrition_fallback_error = String(e?.message || e);
    }
  }

  if (finalNutritionSummary) {
    servingsUsed = getServingsFromRecipe(recipeResult);
    if (servingsUsed && servingsUsed > 0 && servingsUsed !== 1) {
      finalNutritionSummary = {
        energyKcal:
          finalNutritionSummary.energyKcal != null
            ? finalNutritionSummary.energyKcal / servingsUsed
            : null,
        protein_g:
          finalNutritionSummary.protein_g != null
            ? finalNutritionSummary.protein_g / servingsUsed
            : null,
        fat_g:
          finalNutritionSummary.fat_g != null
            ? finalNutritionSummary.fat_g / servingsUsed
            : null,
        carbs_g:
          finalNutritionSummary.carbs_g != null
            ? finalNutritionSummary.carbs_g / servingsUsed
            : null,
        sugar_g:
          finalNutritionSummary.sugar_g != null
            ? finalNutritionSummary.sugar_g / servingsUsed
            : null,
        fiber_g:
          finalNutritionSummary.fiber_g != null
            ? finalNutritionSummary.fiber_g / servingsUsed
            : null,
        sodium_mg:
          finalNutritionSummary.sodium_mg != null
            ? finalNutritionSummary.sodium_mg / servingsUsed
            : null
      };
      if (recipeResult?.out) {
        recipeResult.out.nutrition_summary = finalNutritionSummary;
      }
    }
  }

  if (restaurantCalories != null && !Number.isNaN(Number(restaurantCalories))) {
    const kcalFromRestaurant = Number(restaurantCalories);

    if (!finalNutritionSummary) {
      finalNutritionSummary = {
        energyKcal: kcalFromRestaurant,
        protein_g: null,
        fat_g: null,
        carbs_g: null,
        sugar_g: null,
        fiber_g: null,
        sodium_mg: null
      };
      nutrition_source = nutrition_source || "restaurant_kcal_only";
    } else {
      const baseKcal =
        typeof finalNutritionSummary.energyKcal === "number"
          ? finalNutritionSummary.energyKcal
          : 0;

      debug.restaurant_calories = kcalFromRestaurant;

      if (baseKcal > 0) {
        const ratio = kcalFromRestaurant / baseKcal;

        finalNutritionSummary = {
          energyKcal: kcalFromRestaurant,
          protein_g: (finalNutritionSummary.protein_g || 0) * ratio,
          fat_g: (finalNutritionSummary.fat_g || 0) * ratio,
          carbs_g: (finalNutritionSummary.carbs_g || 0) * ratio,
          sugar_g: (finalNutritionSummary.sugar_g || 0) * ratio,
          fiber_g: (finalNutritionSummary.fiber_g || 0) * ratio,
          sodium_mg: (finalNutritionSummary.sodium_mg || 0) * ratio
        };

        debug.nutrition_restaurant_ratio = ratio;

        if (nutrition_source && !nutrition_source.startsWith("restaurant_")) {
          nutrition_source = `${nutrition_source}+restaurant_kcal_scaled`;
        } else if (!nutrition_source) {
          nutrition_source = "restaurant_kcal_scaled";
        } else {
          nutrition_source = `${nutrition_source}_scaled`;
        }
      } else {
        // No base kcal; we can only set energy and mark source
        finalNutritionSummary = {
          ...finalNutritionSummary,
          energyKcal: kcalFromRestaurant
        };
        if (nutrition_source && !nutrition_source.startsWith("restaurant_")) {
          nutrition_source = `${nutrition_source}+restaurant_kcal`;
        } else if (!nutrition_source) {
          nutrition_source = "restaurant_kcal";
        }
      }
    }

    if (!debug) debug = {};
    debug.restaurant_calories = kcalFromRestaurant;
  }

  const ingredientsForLex = (() => {
    // Prefer parsed/enriched rows first
    const parsed = Array.isArray(ingredientsParsed) ? ingredientsParsed : [];
    if (parsed.length) {
      return parsed
        .map((it) => it.name || it.text || it.original || "")
        .filter((s) => s && s.trim().length > 1);
    }

    // Fallback to normalized items/lines if needed
    if (Array.isArray(normalized.items) && normalized.items.length) {
      return normalized.items
        .map((it) => it.name || it.text || it.original || "")
        .filter((s) => s && s.trim().length > 1);
    }
    if (
      Array.isArray(normalized.ingredients_lines) &&
      normalized.ingredients_lines.length
    ) {
      return normalized.ingredients_lines.filter(
        (s) => s && s.trim().length > 1
      );
    }
    const parts = [dishName, menuDescription]
      .filter(Boolean)
      .map((s) => s.trim());
    return parts.length ? parts : [];
  })();

  const fatsecretResult = await classifyIngredientsWithFatSecret(
    env,
    ingredientsForLex,
    "en"
  );
  const fatsecretHits =
    fatsecretResult && fatsecretResult.ok
      ? fatsecretResult.allIngredientHits || []
      : [];
  const inferredTextHits = inferHitsFromText(dishName, menuDescription);
  const inferredIngredientHits = inferHitsFromIngredients(
    Array.isArray(ingredients) && ingredients.length
      ? ingredients
      : normalized.items || []
  );
  const combinedHits = [
    ...fatsecretHits,
    ...(Array.isArray(inferredTextHits) ? inferredTextHits : []),
    ...(Array.isArray(inferredIngredientHits) ? inferredIngredientHits : [])
  ];

  const user_flags = body.user_flags || body.userFlags || {};

  allergen_flags = [];
  fodmap_flags = null;
  lactose_flags = null;
  let allergenMiniDebug = null;
  let allergen_lifestyle_tags = [];
  let allergen_lifestyle_checks = null;

  const allergenEvidenceText = [
    dishName,
    restaurantName,
    menuDescription,
    Array.isArray(body.tags) ? body.tags.join(" ") : "",
    Array.isArray(body.ingredients) ? JSON.stringify(body.ingredients) : ""
  ]
    .join(" ")
    .toLowerCase();

  const hasEvidenceForAllergen = (kind, text) => {
    if (!text) return false;
    const t = text.toLowerCase();
    const table = {
      gluten: [
        "wheat",
        "flour",
        "bread",
        "bun",
        "brioche",
        "baguette",
        "pasta",
        "noodle",
        "spaghetti",
        "fettuccine",
        "penne",
        "udon",
        "ramen"
      ],
      milk: [
        "milk",
        "cream",
        "cheese",
        "butter",
        "queso",
        "lactose",
        "yogurt",
        "nata",
        "crema",
        "leche"
      ],
      egg: ["egg", "eggs", "yolk", "huevo", "huevos"],
      soy: ["soy", "soya", "tofu", "soybean", "edamame"],
      peanut: ["peanut", "cacahuate", "cacahuetes"],
      tree_nut: [
        "almond",
        "cashew",
        "walnut",
        "pecan",
        "pistachio",
        "hazelnut",
        "macadamia",
        "pine nut"
      ],
      fish: ["fish", "salmon", "tuna", "cod", "trout", "tilapia", "anchovy"],
      shellfish: [
        "shrimp",
        "prawn",
        "crab",
        "lobster",
        "clam",
        "mussel",
        "oyster",
        "scallop",
        "camarón",
        "gambas",
        "mariscos"
      ],
      sesame: ["sesame", "tahini", "ajonjoli"]
    };
    const terms = table[kind] || [];
    return terms.some((w) => t.includes(w));
  };

  const allergenInput = {
    dishName,
    restaurantName,
    menuSection,
    menuDescription,
    ingredients: Array.isArray(ingredients)
      ? ingredients
          .map((ing) => {
            if (typeof ing === "string") return { name: ing };
            if (!ing || typeof ing !== "object") return null;
            const name =
              ing.name ||
              ing.ingredient ||
              ing.text ||
              ing.original ||
              ing.line ||
              "";
            return {
              name,
              normalized: ing.normalized || ing.canonical || undefined,
              quantity:
                ing.quantity ||
                ing.qty ||
                ing.amount ||
                ing.quantity_str ||
                undefined,
              language: ing.language || ing.lang || undefined
            };
          })
          .filter((r) => r && r.name)
      : [],
    tags: Array.isArray(body.tags)
      ? body.tags.map((t) => String(t || "").trim()).filter(Boolean)
      : [],
    vision_insights: debug.vision_insights || null,
    plate_components: plateComponents
  };

  let allergenMiniResult = null;
  if (allergenMiniResult && allergenMiniResult.ok && allergenMiniResult.data) {
    const data = allergenMiniResult.data || {};
    const allergenKeys = [
      "gluten",
      "milk",
      "egg",
      "soy",
      "peanut",
      "tree_nut",
      "fish",
      "shellfish",
      "sesame"
    ];
    for (const key of allergenKeys) {
      const slot = data?.allergens?.[key];
      if (slot && slot.present && slot.present !== "no") {
        let present = slot.present;
        let message = slot.reason || "";
        const hasEvidence = hasEvidenceForAllergen(key, allergenEvidenceText);
        if (present === "yes" && !hasEvidence) {
          present = "maybe";
          message =
            slot.reason && slot.reason.length
              ? `${slot.reason} (not explicitly listed; marking as maybe)`
              : "Often contains this allergen, but it is not explicitly listed.";
        }
        allergen_flags.push({
          kind: key,
          present,
          message,
          source: "llm-mini"
        });
      }
    }
    fodmap_flags = data?.fodmap
      ? {
          level: data.fodmap.level || "unknown",
          reason: data.fodmap.reason || "",
          source: "llm-mini"
        }
      : null;
    lactose_flags = data?.lactose
      ? {
          level: data.lactose.level || "unknown",
          reason: data.lactose.reason || "",
          source: "llm-mini"
        }
      : null;
    allergenMiniDebug = data;
    allergen_lifestyle_tags = Array.isArray(data.lifestyle_tags)
      ? data.lifestyle_tags
      : [];
    allergen_lifestyle_checks = data.lifestyle_checks || null;
  } else {
    allergenMiniDebug = allergenMiniResult || null;
  }

  organs = null;
  let organsLLMDebug = null;
  let nutrition_insights = null;

  const llmPayload = {
    dishName,
    restaurantName,
    ingredientLines: normalized?.ingredients_lines || normalized?.lines || [],
    ingredientsNormalized: normalized?.items || ingredients || [],
    existingFlags: {},
    userFlags: user_flags,
    locale: lang,
    vision_insights: debug.vision_insights || null,
    plate_components: plateComponents
  };

  let organsLLMResult = null;

  const tLLMsStart = Date.now();

  if (useParallel) {
    const nutritionInput = finalNutritionSummary
      ? {
          dishName,
          restaurantName,
          nutrition_summary: finalNutritionSummary,
          tags: nutrition_badges || []
        }
      : null;

    const promises = [
      runAllergenMiniLLM(env, allergenInput),
      runOrgansLLM(env, llmPayload),
      nutritionInput ? runNutritionMiniLLM(env, nutritionInput) : null
    ];

    const [allergenSettled, organsSettled, nutritionSettled] =
      await Promise.allSettled(promises);

    if (allergenSettled.status === "fulfilled") {
      allergenMiniResult = allergenSettled.value;
    } else {
      allergenMiniResult = {
        ok: false,
        error: String(allergenSettled.reason || "allergen_llm_error")
      };
    }

    if (organsSettled.status === "fulfilled") {
      organsLLMResult = organsSettled.value;
    } else {
      organsLLMResult = {
        ok: false,
        error: String(organsSettled.reason || "organs_llm_error")
      };
    }

    if (nutritionSettled && nutritionSettled.status === "fulfilled") {
      nutrition_insights = nutritionSettled.value;
    } else {
      nutrition_insights = null;
    }
  } else {
    allergenMiniResult = await runAllergenMiniLLM(env, allergenInput);
    organsLLMResult = await runOrgansLLM(env, llmPayload);

    if (finalNutritionSummary) {
      const nutritionInput = {
        dishName,
        restaurantName,
        nutrition_summary: finalNutritionSummary,
        tags: nutrition_badges || []
      };
      nutrition_insights = await runNutritionMiniLLM(env, nutritionInput);
    }
  }

  const tLLMsEnd = Date.now();
  debug.llms_ms = tLLMsEnd - tLLMsStart;
  debug.llms_parallel = !!useParallel;

  // --- Map allergen LLM result ---
  allergen_flags = [];
  fodmap_flags = null;
  lactose_flags = null;
  lifestyle_tags = [];
  lifestyle_checks = null;
  let allergen_breakdown = null;

  if (
    allergenMiniResult &&
    allergenMiniResult.ok &&
    allergenMiniResult.data &&
    typeof allergenMiniResult.data === "object"
  ) {
    const a = allergenMiniResult.data;
    debug.allergen_llm_raw = a;

    if (a.allergens && typeof a.allergens === "object") {
      for (const [kind, info] of Object.entries(a.allergens)) {
        if (!info || typeof info !== "object") continue;
        const present = info.present || "no";
        const reason = info.reason || "";
        if (present === "yes" || present === "maybe") {
          allergen_flags.push({
            kind,
            present,
            message: reason,
            source: "llm-mini"
          });
        }
      }
    }

    if (a.fodmap && typeof a.fodmap === "object") {
      fodmap_flags = {
        level: a.fodmap.level || "unknown",
        reason: a.fodmap.reason || "",
        source: "llm-mini"
      };
    }

    if (a.lactose && typeof a.lactose === "object") {
      lactose_flags = {
        level: a.lactose.level || "unknown",
        reason: a.lactose.reason || "",
        source: "llm-mini"
      };
    }

    try {
      const componentAllergensRaw = a.component_allergens;
      if (
        Array.isArray(componentAllergensRaw) &&
        componentAllergensRaw.length > 0 &&
        plateComponents &&
        plateComponents.length > 0
      ) {
        allergen_breakdown = componentAllergensRaw.map((compEntry, idx) => {
          const pc = plateComponents[idx] || {};
          const label =
            compEntry?.component_label ||
            pc.label ||
            pc.component ||
            pc.name ||
            `Component ${idx + 1}`;

          const role = compEntry?.role || pc.role || "unknown";
          const category = compEntry?.category || pc.category || "other";

          const componentAllergens = compEntry?.allergens || {};
          const componentFodmap = compEntry?.fodmap || null;
          const componentLactose = compEntry?.lactose || null;

          const componentFlags = [];
          if (componentAllergens && typeof componentAllergens === "object") {
            for (const key of Object.keys(componentAllergens)) {
              const v = componentAllergens[key];
              if (!v || typeof v !== "object") continue;
              const present = v.present;
              const reason = v.reason;
              if (present === "yes" || present === "maybe") {
                componentFlags.push({
                  kind: key,
                  present,
                  message: reason || "",
                  source: "llm-mini-component"
                });
              }
            }
          }

          let componentFodmapFlags = null;
          if (componentFodmap && typeof componentFodmap === "object") {
            const level = componentFodmap.level || null;
            const reason = componentFodmap.reason || "";
            if (level) {
              componentFodmapFlags = {
                level,
                reason,
                source: "llm-mini-component"
              };
            }
          }

          let componentLactoseFlags = null;
          if (componentLactose && typeof componentLactose === "object") {
            const level = componentLactose.level || null;
            const reason = componentLactose.reason || "";
            if (level) {
              componentLactoseFlags = {
                level,
                reason,
                source: "llm-mini-component"
              };
            }
          }

          return {
            component_id: (pc && pc.component_id) || (pc && pc.id) || `c${idx}`,
            component: label,
            role,
            category,
            allergen_flags: componentFlags,
            fodmap_flags: componentFodmapFlags,
            lactose_flags: componentLactoseFlags
          };
        });
        debug.allergen_component_raw = componentAllergensRaw;
      }
    } catch (err) {
      allergen_breakdown = null;
      debug.allergen_breakdown_error = String(
        (err && (err.stack || err.message)) || err
      );
    }

    // Fallback: if component_allergens missing, run per-component allergen LLMs
    if (
      !allergen_breakdown &&
      Array.isArray(plateComponents) &&
      plateComponents.length > 0
    ) {
      debug.allergen_component_block_entered = true;

      if (allergenInput) {
        const componentPromises = plateComponents.map((pc, idx) => {
          const compInput = buildComponentAllergenInput(allergenInput, pc, idx);
          return runAllergenMiniLLM(env, compInput);
        });

        const settled = await Promise.allSettled(componentPromises);
        debug.allergen_component_settled_statuses = settled.map((r, idx) => ({
          component_id:
            plateComponents[idx] &&
            (plateComponents[idx].component_id ||
              plateComponents[idx].id ||
              `c${idx}`),
          status: r.status
        }));

        const breakdown = [];

        settled.forEach((r, idx) => {
          if (r.status !== "fulfilled") return;
          const value = r.value;
          if (!value || !value.ok || !value.data || typeof value.data !== "object") {
            return;
          }
          const aComp = value.data;
          const pc = plateComponents[idx] || {};
          const label =
            pc.label || pc.component || pc.name || `Component ${idx + 1}`;
          const role = pc.role || "unknown";
          const category = pc.category || "other";

          const componentFlags = [];
          if (aComp.allergens && typeof aComp.allergens === "object") {
            for (const [kind, info] of Object.entries(aComp.allergens)) {
              if (!info || typeof info !== "object") continue;
              const present = info.present || "no";
              const reason = info.reason || "";
              if (present === "yes" || present === "maybe") {
                componentFlags.push({
                  kind,
                  present,
                  message: reason,
                  source: "llm-mini-component"
                });
              }
            }
          }

          let componentFodmapFlags = null;
          if (aComp.fodmap && typeof aComp.fodmap === "object") {
            const level = aComp.fodmap.level || null;
            const reason = aComp.fodmap.reason || "";
            if (level) {
              componentFodmapFlags = {
                level,
                reason,
                source: "llm-mini-component"
              };
            }
          }

          let componentLactoseFlags = null;
          if (aComp.lactose && typeof aComp.lactose === "object") {
            const level = aComp.lactose.level || null;
            const reason = aComp.lactose.reason || "";
            if (level) {
              componentLactoseFlags = {
                level,
                reason,
                source: "llm-mini-component"
              };
            }
          }

          breakdown.push({
            component_id: pc.component_id || pc.id || `c${idx}`,
            component: label,
            role,
            category,
            allergen_flags: componentFlags,
            fodmap_flags: componentFodmapFlags,
            lactose_flags: componentLactoseFlags
          });
        });

        if (breakdown.length > 0) {
          allergen_breakdown = breakdown;
          debug.allergen_components_seen = breakdown.map((b) => b.component_id);
          debug.allergen_component_raw = breakdown;
        }
      }
    }

    lifestyle_tags = Array.isArray(a.lifestyle_tags) ? a.lifestyle_tags : [];
    lifestyle_checks =
      a.lifestyle_checks && typeof a.lifestyle_checks === "object"
        ? a.lifestyle_checks
        : null;
  } else {
    debug.allergen_llm_raw = allergenMiniResult || null;
  }

  // --- Map organs LLM result ---
  organs = null;

  if (
    organsLLMResult &&
    organsLLMResult.ok &&
    organsLLMResult.data &&
    typeof organsLLMResult.data === "object"
  ) {
    const o = organsLLMResult.data;
    debug.organs_llm_raw = o;
    organs = mapOrgansLLMToOrgansBlock(o, organs);
  } else {
    debug.organs_llm_raw = organsLLMResult || null;
  }

  // --- Build summary ---
  summary = null;
  if (organs && organs.ok) {
    const tb = organs.tummy_barometer || organs.tummyBarometer || null;
    const flags = organs.flags || {};
    const organsList = Array.isArray(organs.organs) ? organs.organs : [];

    const allergenKinds = Array.isArray(flags.allergens)
      ? flags.allergens
          .map((a) => {
            if (typeof a === "string") return a;
            if (a && typeof a === "object" && typeof a.kind === "string") {
              return a.kind;
            }
            return null;
          })
          .filter(Boolean)
      : [];

    const fodmapReason =
      Array.isArray(tb?.reasons) && tb.reasons.length
        ? tb.reasons.find((r) => r && r.kind === "fodmap")
        : null;

    const fodmapLevel =
      (flags.fodmap && flags.fodmap.level) ||
      (fodmapReason && fodmapReason.level) ||
      null;

    const onionGarlic = !!flags.onion || !!flags.garlic || !!flags.onion_garlic;

    summary = {
      tummyBarometer: {
        score: tb?.score ?? null,
        label: tb?.label ?? null
      },
      organs: organsList.map((o) => ({
        organ: o.organ ?? null,
        level: o.level ?? null,
        plus:
          typeof o.plus === "number"
            ? o.plus
            : typeof o.counts?.plus === "number"
              ? o.counts.plus
              : null,
        minus:
          typeof o.minus === "number"
            ? o.minus
            : typeof o.counts?.minus === "number"
              ? o.counts.minus
              : null,
        neutral:
          typeof o.neutral === "number"
            ? o.neutral
            : typeof o.counts?.neutral === "number"
              ? o.counts.neutral
              : null,
        compounds: Array.isArray(o.compounds) ? o.compounds : []
      })),
      keyFlags: {
        allergens: allergenKinds,
        fodmapLevel,
        lactoseLevel: flags.lactose?.level ?? null,
        onionGarlic,
        spicy: !!flags.spicy,
        alcohol: !!flags.alcohol
      }
    };

    let summarySentences = [];
    try {
      if (summary && summary.tummyBarometer) {
        summarySentences = buildHumanSentences(
          organs.flags || {},
          summary.tummyBarometer
        );

        let organSentences = [];
        if (Array.isArray(organs.organs) && organs.organs.length) {
          organSentences = buildOrganSentences(organs.organs);
        }

        summary.sentences = [...summarySentences, ...organSentences];
      }
    } catch {}

    const edamamHealthLabels = getEdamamHealthLabelsFromRecipe(recipeResult);
    if (summary) {
      summary.edamamLabels = edamamHealthLabels;
    }
    debug.edamam_healthLabels = getEdamamHealthLabelsFromRecipe(recipeResult);
  }
  const edamamFodmap = getEdamamFodmapOverrideFromRecipe(recipeResult);

  if (edamamFodmap && organs && organs.flags) {
    const prev = organs.flags.fodmap || null;
    organs.flags.fodmap = {
      level: edamamFodmap.level,
      reason: edamamFodmap.reason,
      source: edamamFodmap.source,
      previous: prev
    };
  }

  try {
    if (!organs || typeof organs !== "object") organs = {};
    if (!organs.flags) organs.flags = {};
    if (!Array.isArray(organs.flags.allergens)) organs.flags.allergens = [];
    if (!organs.debug) organs.debug = {};
  } catch (e) {
    if (!organs || typeof organs !== "object") {
      organs = {
        ok: false,
        error: "organs_post_process_failed",
        debug: { error: String(e?.message || e) }
      };
    }
  }

  summary = (() => {
    if (!organs || !organs.ok) {
      return null;
    }

    const tb = organs.tummy_barometer || {};
    const flags = organs.flags || {};
    const organsList = Array.isArray(organs.organs) ? organs.organs : [];

    const allergenKinds = Array.isArray(flags.allergens)
      ? flags.allergens
          .map((a) => {
            if (typeof a === "string") return a;
            if (a && typeof a === "object" && typeof a.kind === "string") {
              return a.kind;
            }
            return null;
          })
          .filter(Boolean)
      : [];

    const fodmapReason =
      Array.isArray(tb.reasons) && tb.reasons.length
        ? tb.reasons.find((r) => r && r.kind === "fodmap")
        : null;

    const fodmapLevel =
      (flags.fodmap && flags.fodmap.level) ||
      (fodmapReason && fodmapReason.level) ||
      null;

    const onionGarlic = !!flags.onion || !!flags.garlic || !!flags.onion_garlic;

    return {
      tummyBarometer: {
        score: tb.score ?? null,
        label: tb.label ?? null
      },
      organs: organsList.map((o) => ({
        organ: o.organ ?? null,
        level: o.level ?? null,
        plus:
          typeof o.plus === "number"
            ? o.plus
            : typeof o.counts?.plus === "number"
              ? o.counts.plus
              : null,
        minus:
          typeof o.minus === "number"
            ? o.minus
            : typeof o.counts?.minus === "number"
              ? o.counts.minus
              : null,
        neutral:
          typeof o.neutral === "number"
            ? o.neutral
            : typeof o.counts?.neutral === "number"
              ? o.counts.neutral
              : null,
        compounds: Array.isArray(o.compounds) ? o.compounds : []
      })),
      keyFlags: {
        allergens: allergenKinds,
        fodmapLevel,
        lactoseLevel: flags.lactose?.level ?? null,
        onionGarlic,
        spicy: !!flags.spicy,
        alcohol: !!flags.alcohol
      }
    };
  })();

  let summarySentences = [];
  try {
    if (summary && summary.tummyBarometer) {
      summarySentences = buildHumanSentences(
        organs.flags || {},
        summary.tummyBarometer
      );

      // Factual organ sentences from organ graph
      let organSentences = [];
      if (Array.isArray(organs.organs) && organs.organs.length) {
        organSentences = buildOrganSentences(organs.organs);
      }

      summary.sentences = [...summarySentences, ...organSentences];
    }
  } catch {}

  const edamamHealthLabels = getEdamamHealthLabelsFromRecipe(recipeResult);
  if (summary) {
    summary.edamamLabels = edamamHealthLabels;
  }

  const recipe_debug = {
    provider:
      recipeResult?.out?.provider ??
      recipeResult?.source ??
      recipeResult?.responseSource ??
      null,
    reason: recipeResult?.notes || null,
    card_ingredients: ingredients.length,
    providers_order: providerOrder(env),
    attempts: recipeResult?.attempts ?? []
  };

  debug = {
    ...debug,
    ...(organs && organs.debug ? organs.debug : {}),
    fatsecret_per_ingredient: fatsecretResult?.perIngredient || [],
    fatsecret_hits: fatsecretHits,
    inferred_text_hits: inferredTextHits,
    inferred_ingredient_hits: inferredIngredientHits,
    recipe_debug,
    fodmap_edamam: edamamFodmap || null,
    edamam_healthLabels: edamamHealthLabels,
    organs_llm_raw: organsLLMDebug || null,
    allergen_llm_raw: allergenMiniDebug || null,
    dish_image_url: dishImageUrl
  };

  // FatSecret image recognition (dev-only) for debug purposes
  if (devFlag && dishImageUrl) {
    try {
      const fsImageResult = await callFatSecretImageRecognition(
        env,
        dishImageUrl
      );
      if (fsImageResult && fsImageResult.ok && fsImageResult.raw) {
        debug.fatsecret_image_raw = fsImageResult.raw;
        try {
          const normalized = normalizeFatSecretImageResult(fsImageResult.raw);
          debug.fatsecret_image_normalized = normalized;
        } catch (e) {
          debug.fatsecret_image_normalized_error = String(
            e && e.message ? e.message : e
          );
        }
      } else if (fsImageResult && !fsImageResult.ok) {
        debug.fatsecret_image_error = fsImageResult.error || "unknown_error";
      }
    } catch (e) {
      debug.fatsecret_image_error =
        "exception:" + String(e && e.message ? e.message : e);
    }
  }

  let portionVisionDebug = null;
  try {
    if (dishImageUrl) {
      portionVisionDebug = await runPortionVisionLLM(env, {
        dishName,
        restaurantName,
        menuDescription,
        menuSection,
        imageUrl: dishImageUrl
      });
    }
  } catch (err) {
    portionVisionDebug = {
      ok: false,
      source: "portion_vision_stub",
      error: err && err.message ? String(err.message) : String(err)
    };
  }

  debug.portion_vision = portionVisionDebug;
  if (
    portionVisionDebug &&
    portionVisionDebug.ok &&
    portionVisionDebug.insights
  ) {
    debug.vision_insights = portionVisionDebug.insights;
  }

  // FatSecret image recognition (vision) for components + nutrition
  try {
    if (dishImageUrl) {
      const fsImageResult = await callFatSecretImageRecognition(
        env,
        dishImageUrl
      );
      fatsecretImageResult = fsImageResult;
      debug.fatsecret_image_result = fsImageResult;

      if (fsImageResult && fsImageResult.ok && fsImageResult.raw) {
        const normalized = normalizeFatSecretImageResult(fsImageResult.raw);
        fatsecretNormalized = normalized;
        debug.fatsecret_image_normalized = normalized;

        if (
          normalized &&
          Array.isArray(normalized.nutrition_breakdown) &&
          normalized.nutrition_breakdown.length > 0
        ) {
          fatsecretNutritionBreakdown = normalized.nutrition_breakdown;
        }

        if (normalized && normalized.component_allergens) {
          debug.fatsecret_component_allergens = normalized.component_allergens;
          fsComponentAllergens = normalized.component_allergens;
        }
      }
    }
  } catch (err) {
    debug.fatsecret_image_error = String(
      (err && (err.stack || err.message)) || err
    );
  }

  try {
    if (
      portionVisionDebug &&
      portionVisionDebug.insights &&
      Array.isArray(portionVisionDebug.insights.plate_components)
    ) {
      plateComponents = portionVisionDebug.insights.plate_components;
    } else {
      plateComponents = [];
    }
  } catch (err) {
    plateComponents = [];
    debug.plate_components_error = String(
      (err && (err.stack || err.message)) || err
    );
  }

  // If FatSecret vision produced components, keep them for debug/backend use only.
  // Do NOT override the UI plate_components from OpenAI vision; we want high-level
  // meal parts (e.g., "burger", "fries") rather than individual ingredients.
  try {
    if (
      fatsecretNormalized &&
      Array.isArray(fatsecretNormalized.plate_components) &&
      fatsecretNormalized.plate_components.length > 0
    ) {
      debug.plate_components_source = "fatsecret_image";
      debug.fs_plate_components = fatsecretNormalized.plate_components;
    }
  } catch (err) {
    debug.plate_components_fatsecret_error = String(
      (err && (err.stack || err.message)) || err
    );
  }

  // Attach stable component_ids for downstream mapping
  plateComponents = Array.isArray(plateComponents)
    ? plateComponents.map((comp, idx) => ({
        component_id:
          (comp && comp.component_id) || (comp && comp.id) || `c${idx}`,
        ...comp
      }))
    : [];

  // If recipe came from OpenAI and has no explicit servings/yield, assume 4 servings per recipe
  try {
    let openaiServingsDivisor = 1;
    const recipeProvider =
      recipeResult?.out?.provider ??
      recipeResult?.source ??
      recipeResult?.responseSource ??
      null;
    const recipeOut = recipeResult?.out;
    const hasYield =
      recipeOut &&
      typeof recipeOut.yield === "number" &&
      recipeOut.yield > 0;
    const hasServings =
      recipeOut &&
      typeof recipeOut.servings === "number" &&
      recipeOut.servings > 0;

    if (recipeProvider === "openai" && !hasYield && !hasServings) {
      openaiServingsDivisor = 4;
    }

    if (
      openaiServingsDivisor > 1 &&
      finalNutritionSummary &&
      typeof finalNutritionSummary === "object"
    ) {
      finalNutritionSummary = {
        energyKcal:
          typeof finalNutritionSummary.energyKcal === "number"
            ? finalNutritionSummary.energyKcal / openaiServingsDivisor
            : finalNutritionSummary.energyKcal,
        protein_g:
          typeof finalNutritionSummary.protein_g === "number"
            ? finalNutritionSummary.protein_g / openaiServingsDivisor
            : finalNutritionSummary.protein_g,
        fat_g:
          typeof finalNutritionSummary.fat_g === "number"
            ? finalNutritionSummary.fat_g / openaiServingsDivisor
            : finalNutritionSummary.fat_g,
        carbs_g:
          typeof finalNutritionSummary.carbs_g === "number"
            ? finalNutritionSummary.carbs_g / openaiServingsDivisor
            : finalNutritionSummary.carbs_g,
        sugar_g:
          typeof finalNutritionSummary.sugar_g === "number"
            ? finalNutritionSummary.sugar_g / openaiServingsDivisor
            : finalNutritionSummary.sugar_g,
        fiber_g:
          typeof finalNutritionSummary.fiber_g === "number"
            ? finalNutritionSummary.fiber_g / openaiServingsDivisor
            : finalNutritionSummary.fiber_g,
        sodium_mg:
          typeof finalNutritionSummary.sodium_mg === "number"
            ? finalNutritionSummary.sodium_mg / openaiServingsDivisor
            : finalNutritionSummary.sodium_mg
      };

      debug.openai_servings_divisor = openaiServingsDivisor;
    }
  } catch {
    // non-fatal; keep existing summary
  }

  // Heuristic multi-serving divisor for oversized base recipes (when no restaurantCalories)
  try {
    let nutritionMultiServingsDivisor = 1;
    const baseKcal =
      finalNutritionSummary &&
      typeof finalNutritionSummary.energyKcal === "number"
        ? finalNutritionSummary.energyKcal
        : null;
    const hasRestaurantCalories =
      typeof restaurantCalories === "number" && restaurantCalories > 0;

    if (!hasRestaurantCalories && baseKcal != null && baseKcal > 2000) {
      nutritionMultiServingsDivisor = 4;
    }

    if (
      nutritionMultiServingsDivisor > 1 &&
      finalNutritionSummary &&
      typeof finalNutritionSummary === "object"
    ) {
      const d = nutritionMultiServingsDivisor;
      finalNutritionSummary = {
        energyKcal:
          typeof finalNutritionSummary.energyKcal === "number"
            ? finalNutritionSummary.energyKcal / d
            : finalNutritionSummary.energyKcal,
        protein_g:
          typeof finalNutritionSummary.protein_g === "number"
            ? finalNutritionSummary.protein_g / d
            : finalNutritionSummary.protein_g,
        fat_g:
          typeof finalNutritionSummary.fat_g === "number"
            ? finalNutritionSummary.fat_g / d
            : finalNutritionSummary.fat_g,
        carbs_g:
          typeof finalNutritionSummary.carbs_g === "number"
            ? finalNutritionSummary.carbs_g / d
            : finalNutritionSummary.carbs_g,
        sugar_g:
          typeof finalNutritionSummary.sugar_g === "number"
            ? finalNutritionSummary.sugar_g / d
            : finalNutritionSummary.sugar_g,
        fiber_g:
          typeof finalNutritionSummary.fiber_g === "number"
            ? finalNutritionSummary.fiber_g / d
            : finalNutritionSummary.fiber_g,
        sodium_mg:
          typeof finalNutritionSummary.sodium_mg === "number"
            ? finalNutritionSummary.sodium_mg / d
            : finalNutritionSummary.sodium_mg
      };

      if (debug) {
        debug.nutrition_multi_servings_divisor = nutritionMultiServingsDivisor;
        debug.nutrition_multi_servings_base_kcal = baseKcal;
      }
    }
  } catch {
    // non-fatal
  }

  // Manual portion factor currently not used (no user selector in UI)
  const manualPortionFactor = 1;

  let aiPortionFactor = 1;
  if (
    dishImageUrl &&
    !restaurantCalories &&
    portionVisionDebug &&
    portionVisionDebug.ok &&
    portionVisionDebug.source === "portion_vision_openai"
  ) {
    const insights = portionVisionDebug.insights || {};
    const portionInsights = insights.portion || {};

    let pfCandidate = null;

    if (
      typeof portionInsights.servings_on_plate === "number" &&
      isFinite(portionInsights.servings_on_plate)
    ) {
      pfCandidate = portionInsights.servings_on_plate;
    } else if (
      typeof portionInsights.portionFactor === "number" &&
      isFinite(portionInsights.portionFactor)
    ) {
      pfCandidate = portionInsights.portionFactor;
    } else if (
      typeof portionVisionDebug.portionFactor === "number" &&
      isFinite(portionVisionDebug.portionFactor)
    ) {
      pfCandidate = portionVisionDebug.portionFactor;
    }

    const pfConfidence =
      typeof portionInsights.confidence === "number" &&
      isFinite(portionInsights.confidence)
        ? portionInsights.confidence
        : typeof portionVisionDebug.confidence === "number" &&
            isFinite(portionVisionDebug.confidence)
          ? portionVisionDebug.confidence
          : 0;

    if (
      typeof pfCandidate === "number" &&
      isFinite(pfCandidate) &&
      pfCandidate > 0.25 &&
      pfCandidate < 3 &&
      pfConfidence >= 0.6
    ) {
      aiPortionFactor = pfCandidate;
    }
  } else if (!dishImageUrl && !restaurantCalories) {
    const catKey = canonicalCategory || menuSection || "Other";
    let defaultFactor = 1;
    if (typeof catKey === "string") {
      if (DEFAULT_SERVINGS_BY_CATEGORY[catKey]) {
        defaultFactor = DEFAULT_SERVINGS_BY_CATEGORY[catKey];
      } else {
        const lower = catKey.toLowerCase();
        if (lower.includes("pasta") || lower.includes("pizza")) {
          defaultFactor = DEFAULT_SERVINGS_BY_CATEGORY["Pasta & Pizza"];
        } else if (
          lower.includes("burger") ||
          lower.includes("sandwich") ||
          lower.includes("sandwiches & burgers")
        ) {
          defaultFactor = DEFAULT_SERVINGS_BY_CATEGORY["Sandwiches & Burgers"];
        } else if (lower.includes("salad")) {
          defaultFactor = DEFAULT_SERVINGS_BY_CATEGORY["Salads"];
        } else if (lower.includes("kids")) {
          defaultFactor = DEFAULT_SERVINGS_BY_CATEGORY["Kids"];
        } else if (lower.includes("dessert")) {
          defaultFactor = DEFAULT_SERVINGS_BY_CATEGORY["Desserts"];
        } else if (
          lower.includes("mains") ||
          lower.includes("dinners") ||
          lower.includes("skillets")
        ) {
          defaultFactor = DEFAULT_SERVINGS_BY_CATEGORY["Mains"];
        } else {
          defaultFactor = DEFAULT_SERVINGS_BY_CATEGORY["Other"];
        }
      }
    }
    aiPortionFactor = defaultFactor;
  }

  const effectivePortionFactor = manualPortionFactor * aiPortionFactor;

  debug.portion_manual_factor = manualPortionFactor;
  debug.portion_ai_factor = aiPortionFactor;
  debug.portion_effective_factor = effectivePortionFactor;

  if (
    finalNutritionSummary &&
    typeof effectivePortionFactor === "number" &&
    isFinite(effectivePortionFactor) &&
    effectivePortionFactor !== 1
  ) {
    finalNutritionSummary = {
      energyKcal:
        finalNutritionSummary.energyKcal != null
          ? finalNutritionSummary.energyKcal * effectivePortionFactor
          : null,
      protein_g:
        finalNutritionSummary.protein_g != null
          ? finalNutritionSummary.protein_g * effectivePortionFactor
          : null,
      fat_g:
        finalNutritionSummary.fat_g != null
          ? finalNutritionSummary.fat_g * effectivePortionFactor
          : null,
      carbs_g:
        finalNutritionSummary.carbs_g != null
          ? finalNutritionSummary.carbs_g * effectivePortionFactor
          : null,
      sugar_g:
        finalNutritionSummary.sugar_g != null
          ? finalNutritionSummary.sugar_g * effectivePortionFactor
          : null,
      fiber_g:
        finalNutritionSummary.fiber_g != null
          ? finalNutritionSummary.fiber_g * effectivePortionFactor
          : null,
      sodium_mg:
        finalNutritionSummary.sodium_mg != null
          ? finalNutritionSummary.sodium_mg * effectivePortionFactor
          : null
    };
    debug.nutrition_portion_factor_used = effectivePortionFactor;
  }

  if (finalNutritionSummary) {
    const n = finalNutritionSummary;
    nutrition_badges = [
      typeof n.energyKcal === "number"
        ? `${Math.round(n.energyKcal)} kcal`
        : null,
      typeof n.protein_g === "number"
        ? `${Math.round(n.protein_g)} g protein`
        : null,
      typeof n.fat_g === "number" ? `${Math.round(n.fat_g)} g fat` : null,
      typeof n.carbs_g === "number" ? `${Math.round(n.carbs_g)} g carbs` : null,
      typeof n.sodium_mg === "number"
        ? `${Math.round(n.sodium_mg)} mg sodium`
        : null
    ].filter(Boolean);
  }

  debug.nutrition_servings_used = servingsUsed;
  debug.nutrition_source = nutrition_source;

  const portion = {
    manual_factor: manualPortionFactor,
    ai_factor: aiPortionFactor,
    effective_factor: effectivePortionFactor
  };

  // --- nutrition_breakdown by plate_components ---
  let nutritionBreakdown = null;
  try {
    if (
      Array.isArray(fatsecretNutritionBreakdown) &&
      fatsecretNutritionBreakdown.length > 0
    ) {
      // Prefer FatSecret per-component nutrition when available
      nutritionBreakdown = fatsecretNutritionBreakdown;
    } else if (
      finalNutritionSummary &&
      plateComponents &&
      plateComponents.length > 0
    ) {
      const macros = {
        energyKcal: finalNutritionSummary.energyKcal || 0,
        protein_g: finalNutritionSummary.protein_g || 0,
        fat_g: finalNutritionSummary.fat_g || 0,
        carbs_g: finalNutritionSummary.carbs_g || 0,
        sugar_g: finalNutritionSummary.sugar_g || 0,
        fiber_g: finalNutritionSummary.fiber_g || 0,
        sodium_mg: finalNutritionSummary.sodium_mg || 0
      };

      const rawAreas = plateComponents.map((c) => {
        const v =
          c && typeof c.area_ratio === "number" && c.area_ratio > 0
            ? c.area_ratio
            : 0;
        return v;
      });

      let sumAreas = rawAreas.reduce((sum, v) => sum + v, 0);
      if (!sumAreas || sumAreas <= 0) {
        const equal = 1 / plateComponents.length;
        for (let i = 0; i < rawAreas.length; i++) rawAreas[i] = equal;
        sumAreas = 1;
      }

      nutritionBreakdown = plateComponents.map((comp, idx) => {
        const weight = rawAreas[idx] / sumAreas;
        const safeWeight = Number.isFinite(weight) && weight > 0 ? weight : 0;
        const componentLabel =
          (comp && comp.label) || (comp && comp.role) || `component_${idx + 1}`;

        return {
          component_id:
            (comp && comp.component_id) || (comp && comp.id) || `c${idx}`,
          component: componentLabel,
          role: comp && comp.role ? comp.role : "unknown",
          category: comp && comp.category ? comp.category : "other",
          share_ratio: safeWeight,
          energyKcal: macros.energyKcal * safeWeight,
          protein_g: macros.protein_g * safeWeight,
          fat_g: macros.fat_g * safeWeight,
          carbs_g: macros.carbs_g * safeWeight,
          sugar_g: macros.sugar_g * safeWeight,
          fiber_g: macros.fiber_g * safeWeight,
          sodium_mg: macros.sodium_mg * safeWeight
        };
      });
    }
  } catch (err) {
    nutritionBreakdown = null;
    debug.nutrition_breakdown_error = String(
      (err && (err.stack || err.message)) || err
    );
  }

  if (nutritionBreakdown) {
    debug.nutrition_breakdown = nutritionBreakdown;
  }

  // --- selection_default: whole-dish selection using all component_ids ---
  let selection_default = null;
  let selection_components = null;
  let selection_custom = null;
  try {
    const pcs = Array.isArray(plateComponents) ? plateComponents : [];
    const selectedIds = pcs
      .map((comp) => comp && comp.component_id)
      .filter((id) => typeof id === "string");

    if (selectedIds.length > 0) {
      const selectionInput = {
        plate_components: plateComponents,
        allergen_breakdown,
        fs_component_allergens: fsComponentAllergens,
        organs,
        nutrition_summary: finalNutritionSummary,
        nutrition_breakdown: nutritionBreakdown,
        allergen_flags,
        fodmap_flags,
        lactose_flags
      };

      selection_default = buildSelectionAnalysisResult(
        selectionInput,
        selectedIds
      );

      // Build per-component selection map
      const map = {};
      for (const comp of pcs) {
        const compId = comp && comp.component_id;
        if (typeof compId !== "string" || !compId) continue;
        try {
          const sel = buildSelectionAnalysisResult(selectionInput, [compId]);
          map[compId] = sel;
        } catch (e) {
          if (debug) {
            const key = "selection_components_error_" + compId;
            debug[key] = String(e && e.message ? e.message : e);
          }
        }
      }
      if (Object.keys(map).length > 0) {
        selection_components = map;
      }
    }
  } catch (e) {
    if (debug) {
      debug.selection_default_error = String(e && e.message ? e.message : e);
    }
  }

  // selection_custom: optional selection based on request.selection_component_ids
  try {
    if (selectionComponentIdsInput && Array.isArray(selectionComponentIdsInput)) {
      const pcs = Array.isArray(plateComponents) ? plateComponents : [];
      const validIdsSet = new Set(
        pcs
          .map((comp) => comp && comp.component_id)
          .filter((id) => typeof id === "string")
      );

      const filteredIds = selectionComponentIdsInput.filter(
        (id) => typeof id === "string" && validIdsSet.has(id)
      );

      if (filteredIds.length > 0) {
        const selectionInput = {
          plate_components: plateComponents,
          allergen_breakdown,
          fs_component_allergens: fsComponentAllergens,
          organs,
          nutrition_summary: finalNutritionSummary,
          nutrition_breakdown: nutritionBreakdown,
          allergen_flags,
          fodmap_flags,
          lactose_flags
        };

        selection_custom = buildSelectionAnalysisResult(
          selectionInput,
          filteredIds
        );
      }
    }
  } catch (e) {
    if (debug) {
      debug.selection_custom_error = String(e && e.message ? e.message : e);
    }
  }

  const result = {
    ok: true,
    apiVersion: "v1",
    source: "pipeline.analyze-dish",
    dishName,
    restaurantName,
    imageUrl: dishImageUrl,
    summary,
    recipe: recipeResult,
    normalized,
    organs,
    allergen_flags,
    allergen_breakdown,
    fodmap_flags,
    lactose_flags,
    lifestyle_tags: allergen_lifestyle_tags,
    lifestyle_checks: allergen_lifestyle_checks,
    portion,
    plate_components: plateComponents,
    nutrition_summary: finalNutritionSummary || null,
    nutrition_badges,
    nutrition_insights,
    nutrition_source,
    nutrition_breakdown: nutritionBreakdown,
    selection_default,
    selection_components,
    selection_custom: selection_custom || undefined,
    debug
  };

  return { status: 200, result };
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

// Per-ingredient Lexicon classification (phase 1 visibility)
// ---- FatSecret integration (proxy → lex-style hits) -----------------------
async function fetchFatSecretAllergensViaProxy(env, ingredients, lang = "en") {
  if (!env?.FATSECRET_PROXY_URL) {
    return {
      ok: false,
      reason: "missing-fatsecret-proxy-url",
      perIngredient: [],
      allIngredientHits: []
    };
  }

  let res;
  try {
    res = await fetch(`${env.FATSECRET_PROXY_URL}/fatsecret/allergens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.PROXY_API_KEY
      },
      body: JSON.stringify({ ingredients, lang })
    });
  } catch (e) {
    return {
      ok: false,
      reason: "fatsecret-proxy-error",
      status: 0,
      data: { error: e?.message || String(e) },
      perIngredient: [],
      allIngredientHits: []
    };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok || (data && data.ok === false)) {
    return {
      ok: false,
      reason: "fatsecret-proxy-error",
      status: res.status,
      data,
      perIngredient: [],
      allIngredientHits: []
    };
  }

  return { ok: true, results: data?.results || [] };
}

function mapFatSecretFoodAttributesToLexHits(ingredientName, foodAttributes) {
  const hit = {
    term: ingredientName,
    canonical: (ingredientName || "").toLowerCase(),
    classes: [],
    tags: [],
    allergens: [],
    fodmap: null,
    lactose_band: null,
    milk_source: null,
    source: "fatsecret:food_attributes"
  };

  const allergens =
    foodAttributes?.allergens &&
    Array.isArray(foodAttributes.allergens.allergen)
      ? foodAttributes.allergens.allergen
      : [];

  for (const a of allergens) {
    if (!a || !a.name || !a.value) continue;
    const name = String(a.name).toLowerCase();
    const value = Number(a.value);
    if (!value) continue;
    if (name === "milk") {
      hit.allergens.push("milk");
      hit.classes.push("dairy");
    } else if (name === "lactose") {
      hit.lactose_band = "high";
      hit.classes.push("dairy");
    } else if (name === "gluten") {
      hit.allergens.push("gluten");
      hit.classes.push("gluten");
    } else if (name === "egg") {
      hit.allergens.push("egg");
      hit.classes.push("egg");
    } else if (name === "fish") {
      hit.allergens.push("fish");
      hit.classes.push("fish");
    } else if (name === "shellfish") {
      hit.allergens.push("shellfish");
      hit.classes.push("shellfish");
    } else if (name === "nuts") {
      hit.allergens.push("tree_nuts");
      hit.classes.push("nuts");
    } else if (name === "peanuts") {
      hit.allergens.push("peanuts");
      hit.classes.push("nuts");
    } else if (name === "soy") {
      hit.allergens.push("soy");
      hit.classes.push("soy");
    } else if (name === "sesame") {
      hit.allergens.push("sesame");
      hit.classes.push("sesame");
    }
  }

  const preferences =
    foodAttributes?.preferences &&
    Array.isArray(foodAttributes.preferences.preference)
      ? foodAttributes.preferences.preference
      : [];
  for (const p of preferences) {
    if (!p || !p.name || !p.value) continue;
    const name = String(p.name).toLowerCase();
    const value = Number(p.value);
    if (!value) continue;
    if (name === "vegan") hit.tags.push("vegan");
    else if (name === "vegetarian") hit.tags.push("vegetarian");
  }

  if (!hit.allergens.length && !hit.lactose_band) return [];
  return [hit];
}

// classifyIngredientsWithFatSecret:
// Uses our FatSecret proxy (Render) to turn ingredient names into
// lex-style hits focused on allergens + lactose.
async function classifyIngredientsWithFatSecret(
  env,
  ingredientsForLex,
  lang = "en"
) {
  const ingredientNames = (ingredientsForLex || [])
    .map((ing) =>
      typeof ing === "string" ? ing : ing?.name || ing?.ingredient || ""
    )
    .filter(Boolean);

  const result = await fetchFatSecretAllergensViaProxy(
    env,
    ingredientNames,
    lang
  );
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason || "fatsecret-proxy-error",
      perIngredient: [],
      allIngredientHits: []
    };
  }

  const perIngredient = [];
  const allIngredientHits = [];

  for (const row of result.results || []) {
    const name = row?.ingredient || "";
    const hits = mapFatSecretFoodAttributesToLexHits(
      name,
      row?.food_attributes || {}
    );
    perIngredient.push({
      ingredient: name,
      ok: true,
      hits
    });
    if (hits && hits.length) {
      for (const h of hits) allIngredientHits.push(h);
    }
  }

  return {
    ok: true,
    perIngredient,
    allIngredientHits
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

/**
 * Build a component-focused allergen input for runAllergenMiniLLM.
 * Reuses the base input (dishName, ingredients, tags, vision_insights, etc.)
 * but makes it explicit that we only care about one plate component.
 *
 * @param {AllergenLLMInput} baseInput
 * @param {object} plateComponent
 * @param {number} idx
 * @returns {AllergenLLMInput}
 */
function buildComponentAllergenInput(baseInput, plateComponent, idx) {
  if (!baseInput || typeof baseInput !== "object") return baseInput;

  const label =
    (plateComponent &&
      (plateComponent.label ||
        plateComponent.component ||
        plateComponent.name)) ||
    `Component ${idx + 1}`;

  const dishName = baseInput.dishName || "";
  const baseDesc = baseInput.menuDescription || "";

  const note =
    `\n\nNOTE: For this analysis, consider ONLY the component "${label}"` +
    (dishName
      ? ` from the dish "${dishName}". Ignore other components on the plate.`
      : `. Ignore other components on the plate.`);

  return {
    ...baseInput,
    dishName: dishName ? `${dishName} – component: ${label}` : label,
    menuDescription: baseDesc + note
    // We intentionally keep ingredients, tags, vision_insights, etc. the same
  };
}

/**
 * INTERNAL helper to compute a selection-level analysis result
 * for a set of plate component IDs.
 *
 * NOTE:
 * - This helper is NOT wired into any routes yet.
 * - It MUST NOT throw; always return a safe, minimal object.
 * - Aggregation logic (allergens/FODMAP/lactose/organs/nutrition) will be
 *   added in later steps.
 *
 * @param {TbSelectionAnalysisInput} input
 * @param {TbComponentId[]} selectedComponentIds
 * @returns {TbSelectionAnalysisResult}
 */
function buildSelectionAnalysisResult(input, selectedComponentIds) {
  const ids = Array.isArray(selectedComponentIds)
    ? selectedComponentIds.filter(Boolean)
    : [];

  /** @type {TbSelectionAnalysisResult} */
  const result = {
    componentIds: ids
  };

  const hasNoSelection = ids.length === 0;

  if (hasNoSelection) {
    // Whole dish view:
    // In future steps we may pass through whole-dish allergen/organs/nutrition here.
    return result;
  }

  // Normalize input arrays
  const plateComponents = Array.isArray(input.plate_components)
    ? input.plate_components
    : [];

  const allergenBreakdown = Array.isArray(input.allergen_breakdown)
    ? input.allergen_breakdown
    : [];

  const nutritionBreakdown = Array.isArray(input.nutrition_breakdown)
    ? input.nutrition_breakdown
    : [];

  const fsComponentAllergens =
    input && input.fs_component_allergens ? input.fs_component_allergens : null;

  // Fast lookup set for IDs
  const idSet = new Set(ids);

  const selectedComponents = plateComponents.filter((comp) => {
    const compId = comp && comp.component_id;
    return typeof compId === "string" && idSet.has(compId);
  });

  const selectedAllergens = allergenBreakdown.filter((entry) => {
    const compId = entry && entry.component_id;
    return typeof compId === "string" && idSet.has(compId);
  });

  const totalComponentsCount = Array.isArray(plateComponents)
    ? plateComponents.length
    : 0;
  const isSubSelection =
    ids.length > 0 && totalComponentsCount > 0 && ids.length < totalComponentsCount;

  const selectedNutrition = nutritionBreakdown.filter((entry) => {
    const compId = entry && entry.component_id;
    return typeof compId === "string" && idSet.has(compId);
  });

  if (selectedComponents.length > 0) {
    result.components = selectedComponents;
  }

  if (selectedAllergens.length > 0) {
    result.allergens = selectedAllergens;
  }

  if (selectedNutrition.length > 0) {
    result.nutrition = selectedNutrition;

    // Aggregate numeric nutrition fields across the selection
    const combined = {
      energyKcal: 0,
      protein_g: 0,
      fat_g: 0,
      carbs_g: 0,
      sugar_g: 0,
      fiber_g: 0,
      sodium_mg: 0
    };

    for (const entry of selectedNutrition) {
      if (!entry || typeof entry !== "object") continue;
      const n = entry;
      if (typeof n.energyKcal === "number") combined.energyKcal += n.energyKcal;
      if (typeof n.protein_g === "number") combined.protein_g += n.protein_g;
      if (typeof n.fat_g === "number") combined.fat_g += n.fat_g;
      if (typeof n.carbs_g === "number") combined.carbs_g += n.carbs_g;
      if (typeof n.sugar_g === "number") combined.sugar_g += n.sugar_g;
      if (typeof n.fiber_g === "number") combined.fiber_g += n.fiber_g;
      if (typeof n.sodium_mg === "number") combined.sodium_mg += n.sodium_mg;
    }

    result.combined_nutrition = combined;
  }

  // Helpers for deduping and picking worst levels
  const dedupeAllergenFlags = (flags) => {
    if (!Array.isArray(flags)) return [];
    const seen = new Set();
    const out = [];
    for (const f of flags) {
      if (!f || typeof f !== "object") continue;
      const kind = f.kind || f.type || null;
      const present = f.present || null;
      const key = kind + "|" + present;
      if (kind && !seen.has(key)) {
        seen.add(key);
        out.push(f);
      }
    }
    return out;
  };

  const FODMAP_LEVEL_RANK = { none: 0, low: 1, medium: 2, high: 3 };
  const pickWorstFodmapFlag = (flagsArray) => {
    let best = null;
    let bestRank = -1;
    for (const f of flagsArray) {
      if (!f || typeof f !== "object") continue;
      const lvl = typeof f.level === "string" ? f.level : null;
      const rank =
        lvl && FODMAP_LEVEL_RANK[lvl] != null
          ? FODMAP_LEVEL_RANK[lvl]
          : -1;
      if (rank > bestRank) {
        bestRank = rank;
        best = f;
      }
    }
    return best;
  };

  const LACTOSE_LEVEL_RANK = { none: 0, low: 1, medium: 2, high: 3 };
  const pickWorstLactoseFlag = (flagsArray) => {
    let best = null;
    let bestRank = -1;
    for (const f of flagsArray) {
      if (!f || typeof f !== "object") continue;
      const lvl = typeof f.level === "string" ? f.level : null;
      const rank =
        lvl && LACTOSE_LEVEL_RANK[lvl] != null
          ? LACTOSE_LEVEL_RANK[lvl]
          : -1;
      if (rank > bestRank) {
        bestRank = rank;
        best = f;
      }
    }
    return best;
  };

  // Prefer per-component breakdown when available
  if (Array.isArray(selectedAllergens) && selectedAllergens.length > 0) {
    const componentAllergenFlags = [];
    const fodmapCandidates = [];
    const lactoseCandidates = [];

    for (const entry of selectedAllergens) {
      if (!entry || typeof entry !== "object") continue;

      if (Array.isArray(entry.allergen_flags)) {
        for (const f of entry.allergen_flags) {
          componentAllergenFlags.push(f);
        }
      }

      if (entry.fodmap_flags) {
        fodmapCandidates.push(entry.fodmap_flags);
      }

      if (entry.lactose_flags) {
        lactoseCandidates.push(entry.lactose_flags);
      }
    }

    const dedupedAllergens = dedupeAllergenFlags(componentAllergenFlags);
    if (dedupedAllergens.length > 0) {
      result.combined_allergens = dedupedAllergens;
    }

    const worstFodmap = pickWorstFodmapFlag(fodmapCandidates);
    if (worstFodmap) {
      result.combined_fodmap = worstFodmap;
    }

    const worstLactose = pickWorstLactoseFlag(lactoseCandidates);
    if (worstLactose) {
      result.combined_lactose = worstLactose;
    }
  }

  // Prefer FatSecret per-component allergens when a single component is selected
  if (
    !result.combined_allergens &&
    fsComponentAllergens &&
    Array.isArray(ids) &&
    ids.length === 1
  ) {
    const compId = ids[0];
    const fsEntry = fsComponentAllergens[compId];
    if (
      fsEntry &&
      Array.isArray(fsEntry.allergen_flags) &&
      fsEntry.allergen_flags.length > 0
    ) {
      result.combined_allergens = fsEntry.allergen_flags;
    } else {
      result.combined_allergens = [];
    }
  }

  // Fallback to global flags only when no per-component data was available
  if (
    !result.combined_allergens &&
    Array.isArray(input.allergen_flags) &&
    input.allergen_flags.length > 0
  ) {
    // If this is a sub-selection, avoid leaking whole-plate allergens; otherwise fall back to global
    if (!isSubSelection) {
      result.combined_allergens = input.allergen_flags;
    } else {
      result.combined_allergens = [];
    }
  }

  if (!result.combined_fodmap && input.fodmap_flags) {
    if (!isSubSelection) {
      result.combined_fodmap = input.fodmap_flags;
    }
  }

  if (!result.combined_lactose && input.lactose_flags) {
    if (!isSubSelection) {
      result.combined_lactose = input.lactose_flags;
    }
  }

  // FODMAP / lactose / lifestyle / organs aggregation will be added in later steps.

  return result;
}

/**
 * Normalize a FatSecret image recognition v2 response into internal
 * plate_components and nutrition_breakdown arrays.
 *
 * @param {any} fsRaw
 * @returns {{ plate_components: any[], nutrition_breakdown: any[] }}
 */
function normalizeFatSecretImageResult(fsRaw) {
  const plate_components = [];
  const nutrition_breakdown = [];
  const component_allergens = {};

  if (!fsRaw || typeof fsRaw !== "object") {
    return { plate_components, nutrition_breakdown, component_allergens };
  }

  const foodResponse = Array.isArray(fsRaw.food_response)
    ? fsRaw.food_response
    : [];

  if (foodResponse.length === 0) {
    return { plate_components, nutrition_breakdown, component_allergens };
  }

  const totalCalories = foodResponse.reduce((sum, entry) => {
    const eaten = entry && entry.eaten;
    const tnc = (eaten && eaten.total_nutritional_content) || {};
    const cal = Number(tnc.calories);
    return sum + (isNaN(cal) ? 0 : cal);
  }, 0);

  foodResponse.forEach((entry, idx) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const eaten = entry.eaten || {};
    const tnc = eaten.total_nutritional_content || {};
    const food = entry.food || {};

    const foodId = entry.food_id || food.food_id || idx;
    const component_id = `fs_c${idx}`;

    const label = entry.food_entry_name || food.food_name || "Unknown item";

    const rawCategory = food.food_type || "Generic";
    const category =
      rawCategory === "Brand"
        ? "fs_brand"
        : rawCategory === "Generic"
          ? "fs_generic"
          : "fs_food";

    const calories = Number(tnc.calories);
    const carbs = Number(tnc.carbohydrate);
    const protein = Number(tnc.protein);
    const fat = Number(tnc.fat);
    const sugar = Number(tnc.sugar);
    const fiber = Number(tnc.fiber);
    const sodium = Number(tnc.sodium);

    const energyKcal = isNaN(calories) ? 0 : calories;
    const carbs_g = isNaN(carbs) ? 0 : carbs;
    const protein_g = isNaN(protein) ? 0 : protein;
    const fat_g = isNaN(fat) ? 0 : fat;
    const sugar_g = isNaN(sugar) ? 0 : sugar;
    const fiber_g = isNaN(fiber) ? 0 : fiber;
    const sodium_mg = isNaN(sodium) ? 0 : sodium;

    const share_ratio =
      totalCalories > 0 ? energyKcal / totalCalories : 1 / foodResponse.length;

    plate_components.push({
      component_id,
      role: "side", // placeholder; will assign main after loop
      category,
      label,
      confidence: 1,
      area_ratio: share_ratio,
      fs_food_id: foodId
    });

    nutrition_breakdown.push({
      component_id,
      component: label,
      role: "side", // placeholder; will assign main after loop
      category,
      share_ratio,
      energyKcal,
      protein_g,
      fat_g,
      carbs_g,
      sugar_g,
      fiber_g,
      sodium_mg
    });

    // per-component allergen flags from FatSecret (food_attributes.allergens)
    try {
      const allergensRoot =
        food &&
        food.food_attributes &&
        food.food_attributes.allergens &&
        food.food_attributes.allergens.allergen;

      const allergenFlags = [];

      if (Array.isArray(allergensRoot)) {
        for (const al of allergensRoot) {
          if (!al || typeof al !== "object") continue;
          const rawName = String(al.name || "").toLowerCase();
          const value = al.value;

          // only take positives
          if (!(value === 1 || value === "1" || value === true)) continue;

          let kind = null;
          if (rawName.includes("gluten")) kind = "gluten";
          else if (rawName.includes("lactose") || rawName === "milk")
            kind = "milk";
          else if (rawName.includes("egg")) kind = "egg";
          else if (rawName.includes("fish")) kind = "fish";
          else if (rawName.includes("shellfish")) kind = "shellfish";
          else if (rawName.includes("peanut")) kind = "peanut";
          else if (rawName.includes("sesame")) kind = "sesame";
          else if (rawName.includes("soy")) kind = "soy";
          else if (rawName.includes("nut")) kind = "tree_nut";

          if (!kind) continue;

          allergenFlags.push({
            kind,
            present: "yes",
            message: `Contains ${rawName} based on FatSecret image data.`,
            source: "fatsecret-image"
          });
        }
      }

      if (allergenFlags.length) {
        component_allergens[component_id] = {
          allergen_flags: allergenFlags
        };
      }
    } catch (e) {
      // ignore FS allergen parsing issues
    }
  });

  // Ensure exactly one main component: the one with the largest energyKcal
  if (
    nutrition_breakdown.length > 0 &&
    plate_components.length === nutrition_breakdown.length
  ) {
    let mainIdx = 0;
    let maxEnergy = -Infinity;

    for (let i = 0; i < nutrition_breakdown.length; i++) {
      const n = nutrition_breakdown[i];
      const kcal =
        n && typeof n.energyKcal === "number" && isFinite(n.energyKcal)
          ? n.energyKcal
          : 0;
      if (kcal > maxEnergy) {
        maxEnergy = kcal;
        mainIdx = i;
      }
    }

    for (let i = 0; i < plate_components.length; i++) {
      const role = i === mainIdx ? "main" : "side";
      plate_components[i].role = role;
      nutrition_breakdown[i].role = role;
    }
  }

  return { plate_components, nutrition_breakdown, component_allergens };
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

export default {
  fetch: async (request, env, ctx) => {
    const response = await handleFetch(request, env, ctx);
    return withTbWhoamiHeaders(response, env);
  },
  queue: async (batch, env, ctx) => {
    return handleQueue(batch, env, ctx);
  },
  scheduled: async (controller, env, ctx) => {
    return handleScheduled(controller, env, ctx);
  }
};
