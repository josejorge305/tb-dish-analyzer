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

// ---- Pipeline versioning & cache helpers ----
const PIPELINE_VERSION = "analysis-v0.1"; // bump this when prompts/logic change

function hashShort(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

function normalizeForKey(str) {
  return (str || "").trim().toLowerCase();
}

function buildDishCacheKey(body) {
  const dishName = normalizeForKey(body.dishName || body.dish);
  const restaurantName = normalizeForKey(body.restaurantName || body.restaurant);
  const section = normalizeForKey(body.menuSection || body.section);
  const category = normalizeForKey(body.canonicalCategory || body.category);
  const menuDescription = (body.menuDescription || body.description || "").trim();
  const userFlags = body.user_flags || body.userFlags || [];
  const userFlagsSignature = userFlags.length ? JSON.stringify(userFlags) : "";

  const signature = menuDescription + "|" + userFlagsSignature;
  const sigHash = hashShort(signature);

  return [
    "dish-analysis",
    PIPELINE_VERSION,
    dishName || "no-dish",
    restaurantName || "no-restaurant",
    section || "no-section",
    category || "no-category",
    sigHash
  ].join("|");
}

// ---- fetch with timeout helper ----
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error(`fetch-timeout-${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
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
      // Build photo URL from photo_reference if available
      let photoUrl = null;
      if (Array.isArray(r.photos) && r.photos.length > 0 && r.photos[0].photo_reference) {
        const photoRef = r.photos[0].photo_reference;
        photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photoRef}&key=${apiKey}`;
      }
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
        url: r.website || "",
        photoUrl
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

// ========== Combo/Platter Dish Detection & Decomposition ==========

// Regex patterns that indicate a combo/platter dish
const COMBO_PATTERNS = [
  /\bgrand slam\b/i,
  /\blumberjack slam\b/i,
  /\bsuper slam\b/i,
  /\bbreakfast combo\b/i,
  /\bbreakfast platter\b/i,
  /\bfull english\b/i,
  /\bfull breakfast\b/i,
  /\bfry up\b/i,
  /\bsampler\b/i,
  /\bplatter\b/i,
  /\bmeze\b/i,
  /\bmezze\b/i,
  /\bdim sum\b/i,
  /\bappetizer combo\b/i,
  /\bsushi combo\b/i,
  /\btaco combo\b/i,
  /\bcombo meal\b/i,
  /\bfeast\b/i,
  /\bspread\b/i,
  /\bdinner for \d/i,
  /\bfamily meal\b/i,
  /\bparty pack\b/i
];

/**
 * Detects if a dish name matches combo/platter patterns
 * @param {string} dishName
 * @returns {boolean}
 */
function isComboPlatterDish(dishName) {
  if (!dishName) return false;
  const normalized = dishName.toLowerCase().trim();
  return COMBO_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Normalizes restaurant name for DB lookup
 * @param {string} restaurantName
 * @returns {string|null}
 */
function normalizeRestaurantChain(restaurantName) {
  if (!restaurantName) return null;
  const n = restaurantName.toLowerCase().trim();
  if (n.includes("denny")) return "dennys";
  if (n.includes("ihop")) return "ihop";
  if (n.includes("waffle house")) return "waffle_house";
  if (n.includes("cracker barrel")) return "cracker_barrel";
  if (n.includes("applebee")) return "applebees";
  if (n.includes("chili")) return "chilis";
  if (n.includes("tgi") || n.includes("friday")) return "tgi_fridays";
  return null;
}

/**
 * Looks up pre-computed combo dish components from D1
 * @param {object} env - Worker env with D1_DB binding
 * @param {string} dishName
 * @param {string} restaurantName
 * @returns {Promise<{found: boolean, combo: object|null, components: array}>}
 */
async function lookupComboFromDB(env, dishName, restaurantName) {
  if (!env || !env.D1_DB) {
    return { found: false, combo: null, components: [] };
  }

  const normalizedDish = dishName.toLowerCase().trim();
  const chain = normalizeRestaurantChain(restaurantName);

  try {
    // LATENCY OPTIMIZATION: Run all combo lookups in parallel
    // Then pick result in preference order: exact > generic > alias
    const [exactResult, genericResult, aliasResult] = await Promise.all([
      // Exact match with restaurant chain
      chain
        ? env.D1_DB.prepare(
            `SELECT * FROM combo_dishes WHERE dish_name = ? AND restaurant_chain = ?`
          )
            .bind(normalizedDish, chain)
            .first()
            .catch(() => null)
        : Promise.resolve(null),
      // Generic match (no chain)
      env.D1_DB.prepare(
        `SELECT * FROM combo_dishes WHERE dish_name = ? AND restaurant_chain IS NULL`
      )
        .bind(normalizedDish)
        .first()
        .catch(() => null),
      // Alias search
      env.D1_DB.prepare(
        `SELECT * FROM combo_dishes WHERE aliases_json LIKE ?`
      )
        .bind(`%"${normalizedDish}"%`)
        .first()
        .catch(() => null)
    ]);

    // Pick first match in preference order
    const combo = exactResult || genericResult || aliasResult;

    if (!combo) {
      return { found: false, combo: null, components: [] };
    }

    // Fetch components
    const componentsResult = await env.D1_DB.prepare(
      `SELECT * FROM combo_components WHERE combo_id = ? ORDER BY sort_order`
    )
      .bind(combo.id)
      .all();

    return {
      found: true,
      combo,
      components: componentsResult.results || []
    };
  } catch (e) {
    console.error("lookupComboFromDB error:", e);
    return { found: false, combo: null, components: [], error: String(e) };
  }
}

/**
 * Uses LLM to decompose an unknown combo/platter dish into components
 * @param {object} env - Worker env
 * @param {string} dishName
 * @param {string} restaurantName
 * @returns {Promise<{components: array, source: string}>}
 */
// LATENCY OPTIMIZATION: Cache combo decomposition results
// Same combo meal = same components (permanent knowledge)
function buildComboCacheKey(dishName, restaurantName) {
  const normalized = [
    (dishName || "").toLowerCase().trim(),
    (restaurantName || "").toLowerCase().trim()
  ].join("|");
  return `combo-llm:${hashShort(normalized)}`;
}

async function decomposeComboWithLLM(env, dishName, restaurantName) {
  // Check cache first
  const cacheKey = buildComboCacheKey(dishName, restaurantName);
  if (env?.MENUS_CACHE) {
    try {
      const cached = await env.MENUS_CACHE.get(cacheKey, "json");
      if (cached && Array.isArray(cached.components)) {
        return { ...cached, cached: true };
      }
    } catch {}
  }

  const prompt = `You are a food expert. The dish "${dishName}"${restaurantName ? ` from "${restaurantName}"` : ""} is a combo/platter meal.

List the individual food items that come with this meal. Return ONLY a JSON array of objects with this format:
[
  {"name": "Component Name", "role": "main" or "side", "quantity": 2, "unit": "pieces"}
]

Rules:
- role should be "main" for the primary protein or carb, "side" for accompaniments
- quantity and unit describe the typical serving (e.g., 2 strips of bacon)
- Be specific (e.g., "Buttermilk Pancakes" not just "Pancakes")
- Include ALL items that typically come with this meal
- Return valid JSON only, no explanation`;

  try {
    let result = null;

    // Try OpenAI first
    if (env.OPENAI_API_KEY) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 500
        })
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const components = JSON.parse(jsonMatch[0]);
          result = { components, source: "openai" };
        }
      }
    }

    // Fallback to Cloudflare AI
    if (!result && env.AI) {
      const aiResult = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
        messages: [{ role: "user", content: prompt }]
      });
      const content = aiResult?.response || "";
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const components = JSON.parse(jsonMatch[0]);
        result = { components, source: "cloudflare" };
      }
    }

    if (!result) {
      result = { components: [], source: "none" };
    }

    // Cache successful result (permanent - combo compositions don't change)
    if (result.components.length > 0 && env?.MENUS_CACHE) {
      try {
        await env.MENUS_CACHE.put(cacheKey, JSON.stringify({
          ...result,
          _cachedAt: new Date().toISOString()
        }));
      } catch {}
    }

    return result;
  } catch (e) {
    console.error("decomposeComboWithLLM error:", e);
    return { components: [], source: "error", error: String(e) };
  }
}

/**
 * LATENCY OPTIMIZATION: Cache FatSecret access token
 * Tokens last 3600s, so we cache for 3000s to be safe
 * Eliminates redundant OAuth calls (500ms each)
 */
async function getFatSecretTokenCached(env) {
  if (!env.FATSECRET_CLIENT_ID || !env.FATSECRET_CLIENT_SECRET) {
    return null;
  }

  // Try KV cache first
  const cacheKey = "fatsecret:access_token";
  if (env?.MENUS_CACHE) {
    try {
      const cached = await env.MENUS_CACHE.get(cacheKey, "json");
      if (cached?.token && cached.expiresAt > Date.now()) {
        return cached.token;
      }
    } catch {}
  }

  // Fetch new token
  const tokenResponse = await fetch("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${env.FATSECRET_CLIENT_ID}:${env.FATSECRET_CLIENT_SECRET}`)}`
    },
    body: "grant_type=client_credentials&scope=basic"
  });

  if (!tokenResponse.ok) return null;
  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;
  const expiresIn = tokenData.expires_in || 3600;

  // Cache token (with buffer before expiry)
  if (accessToken && env?.MENUS_CACHE) {
    try {
      await env.MENUS_CACHE.put(cacheKey, JSON.stringify({
        token: accessToken,
        expiresAt: Date.now() + (expiresIn - 300) * 1000 // 5min buffer
      }), {
        expirationTtl: expiresIn - 300 // Let KV expire it too
      });
    } catch {}
  }

  return accessToken;
}

/**
 * Fetches nutrition for a single component using FatSecret text search
 * @param {object} env
 * @param {string} componentName
 * @param {number} quantity
 * @returns {Promise<object>}
 */
async function fetchComponentNutrition(env, componentName, quantity = 1) {
  // Use existing FatSecret search if available
  if (!env.FATSECRET_CLIENT_ID || !env.FATSECRET_CLIENT_SECRET) {
    return null;
  }

  try {
    // LATENCY OPTIMIZATION: Use cached token instead of fetching every time
    const accessToken = await getFatSecretTokenCached(env);
    if (!accessToken) return null;

    // Search for the food
    const searchUrl = `https://platform.fatsecret.com/rest/server.api?method=foods.search&search_expression=${encodeURIComponent(componentName)}&format=json&max_results=1`;
    const searchResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!searchResponse.ok) return null;
    const searchData = await searchResponse.json();
    const food = searchData?.foods?.food?.[0] || searchData?.foods?.food;

    if (!food) return null;

    // Parse nutrition from food description
    const desc = food.food_description || "";
    const calMatch = desc.match(/Calories:\s*([\d.]+)/i);
    const fatMatch = desc.match(/Fat:\s*([\d.]+)g/i);
    const carbMatch = desc.match(/Carbs:\s*([\d.]+)g/i);
    const protMatch = desc.match(/Protein:\s*([\d.]+)g/i);

    return {
      food_id: food.food_id,
      food_name: food.food_name,
      brand: food.brand_name || null,
      energyKcal: calMatch ? parseFloat(calMatch[1]) * quantity : null,
      fat_g: fatMatch ? parseFloat(fatMatch[1]) * quantity : null,
      carbs_g: carbMatch ? parseFloat(carbMatch[1]) * quantity : null,
      protein_g: protMatch ? parseFloat(protMatch[1]) * quantity : null
    };
  } catch (e) {
    console.error("fetchComponentNutrition error:", e);
    return null;
  }
}

/**
 * Main combo decomposition function - orchestrates DB lookup + LLM fallback + nutrition fetch
 * @param {object} env
 * @param {string} dishName
 * @param {string} restaurantName
 * @returns {Promise<{isCombo: boolean, plate_components: array, nutrition_breakdown: array, debug: object}>}
 */
async function resolveComboComponents(env, dishName, restaurantName) {
  const debug = { combo_detection: {} };

  // Step 1: Check if this looks like a combo dish
  const matchesPattern = isComboPlatterDish(dishName);
  debug.combo_detection.matches_pattern = matchesPattern;

  if (!matchesPattern) {
    return { isCombo: false, plate_components: [], nutrition_breakdown: [], debug };
  }

  // Step 2: Try DB lookup first (fast path)
  const dbResult = await lookupComboFromDB(env, dishName, restaurantName);
  debug.combo_detection.db_lookup = {
    found: dbResult.found,
    combo_id: dbResult.combo?.id,
    component_count: dbResult.components.length
  };

  let components = [];
  let source = "none";

  if (dbResult.found && dbResult.components.length > 0) {
    components = dbResult.components.map((c) => ({
      name: c.component_name,
      role: c.role || "side",
      quantity: c.default_quantity || 1,
      unit: c.default_unit || "serving",
      cached_nutrition: {
        energyKcal: c.calories_per_unit,
        protein_g: c.protein_g,
        fat_g: c.fat_g,
        carbs_g: c.carbs_g
      },
      allergens_json: c.allergens_json,
      fodmap_level: c.fodmap_level,
      lactose_level: c.lactose_level
    }));
    source = "database";
  } else {
    // Step 3: LLM decomposition fallback
    const llmResult = await decomposeComboWithLLM(env, dishName, restaurantName);
    debug.combo_detection.llm_decomposition = {
      source: llmResult.source,
      component_count: llmResult.components.length
    };

    if (llmResult.components.length > 0) {
      components = llmResult.components;
      source = `llm_${llmResult.source}`;
    }
  }

  debug.combo_detection.source = source;
  debug.combo_detection.final_component_count = components.length;

  if (components.length === 0) {
    return { isCombo: false, plate_components: [], nutrition_breakdown: [], debug };
  }

  // Step 4: Fetch nutrition for each component (parallel)
  const nutritionPromises = components.map(async (comp, idx) => {
    // Skip if we have cached nutrition from DB
    if (comp.cached_nutrition && comp.cached_nutrition.energyKcal) {
      return {
        component_id: `combo_c${idx}`,
        component: comp.name,
        role: comp.role,
        category: "combo_component",
        quantity: comp.quantity,
        unit: comp.unit,
        ...comp.cached_nutrition
      };
    }

    // Fetch from FatSecret
    const nutrition = await fetchComponentNutrition(env, comp.name, comp.quantity || 1);
    return {
      component_id: `combo_c${idx}`,
      component: comp.name,
      role: comp.role,
      category: "combo_component",
      quantity: comp.quantity,
      unit: comp.unit,
      energyKcal: nutrition?.energyKcal || null,
      protein_g: nutrition?.protein_g || null,
      fat_g: nutrition?.fat_g || null,
      carbs_g: nutrition?.carbs_g || null,
      fs_food_id: nutrition?.food_id || null
    };
  });

  const nutritionBreakdown = await Promise.all(nutritionPromises);

  // Calculate totals and share ratios
  const totalCalories = nutritionBreakdown.reduce(
    (sum, n) => sum + (n.energyKcal || 0),
    0
  );

  const nutrition_breakdown = nutritionBreakdown.map((n) => ({
    ...n,
    share_ratio: totalCalories > 0 ? (n.energyKcal || 0) / totalCalories : 1 / nutritionBreakdown.length
  }));

  // Build plate_components array
  const plate_components = components.map((comp, idx) => ({
    component_id: `combo_c${idx}`,
    role: comp.role,
    category: "combo_component",
    label: comp.name,
    confidence: source === "database" ? 1 : 0.85,
    area_ratio: nutrition_breakdown[idx]?.share_ratio || 1 / components.length
  }));

  return {
    isCombo: true,
    plate_components,
    nutrition_breakdown,
    total_calories: totalCalories,
    source,
    debug
  };
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
    // Improved scoring with minimum threshold to avoid wrong matches
    const scored = results.map((r) => {
      const name = (r.title || r.sanitizedTitle || r.name || "").toLowerCase();
      const q = (queryText || "").toLowerCase();

      let score = 0;
      if (name && q) {
        if (name === q) score = 100;
        else if (name.startsWith(q)) score = 90;
        else if (name.includes(q)) score = 80;
        else if (q.includes(name) && name.length > 3) score = 75; // restaurant name is substring of query
        else {
          // Word overlap scoring - require significant overlap
          const nTokens = name.split(/\s+/);
          const qTokens = q.split(/\s+/);
          const nSet = new Set(nTokens);
          let overlap = 0;
          let keyWordMatch = false;
          for (const t of qTokens) {
            if (nSet.has(t)) {
              overlap++;
              // Check if this is a "key" word (not common words)
              if (t.length > 4 && !['the', 'and', 'restaurant', 'cafe', 'bar', 'grill'].includes(t)) {
                keyWordMatch = true;
              }
            }
          }
          const ratio = overlap / Math.max(1, qTokens.length);
          // Only give credit if key words match, not just common words like "factory"
          score = keyWordMatch ? Math.round(60 * ratio) : Math.round(30 * ratio);
        }
      }
      return { r, score };
    });

    scored.sort((a, b) => b.score - a.score);
    // Require minimum score of 50 to avoid picking completely wrong restaurants
    const MIN_MATCH_SCORE = 50;
    if (scored[0] && scored[0].score >= MIN_MATCH_SCORE) {
      chosenRestaurants = [scored[0].r]; // ONLY top one if score is good enough
    } else if (scored[0]) {
      // Log warning but still use best match if nothing better
      console.warn(`[extractMenuItemsFromUber] Low match score ${scored[0].score} for query "${queryText}" -> "${scored[0].r.title || scored[0].r.name}"`);
      chosenRestaurants = [scored[0].r];
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
      source: "uber_eats",
      imageUrl: mi.imageUrl || mi.image_url || mi.image || null
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

  const HITS_LIMIT = Number(searchParams.get("top") || env.HITS_LIMIT || "250");
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

// ============================================================================
// USER TRACKING & PERSONALIZATION ENGINE
// ============================================================================

// Activity level multipliers for TDEE calculation
const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,      // Little or no exercise
  light: 1.375,        // Light exercise 1-3 days/week
  moderate: 1.55,      // Moderate exercise 3-5 days/week
  active: 1.725,       // Hard exercise 6-7 days/week
  very_active: 1.9     // Very hard exercise, physical job
};

// Goal adjustments for calorie and macro targets
const GOAL_ADJUSTMENTS = {
  lose_weight: {
    calorie_adjustment: -500,
    protein_multiplier: 1.1,
    fiber_target_override: null
  },
  maintain: {
    calorie_adjustment: 0,
    protein_multiplier: 1.0,
    fiber_target_override: null
  },
  build_muscle: {
    calorie_adjustment: 300,
    protein_multiplier: 1.3,
    fiber_target_override: null
  },
  gut_health: {
    calorie_adjustment: 0,
    protein_multiplier: 1.0,
    fiber_target_override: 35
  },
  reduce_inflammation: {
    calorie_adjustment: 0,
    protein_multiplier: 1.0,
    fiber_target_override: null
  }
};

// Condition-based threshold overrides
const CONDITION_OVERRIDES = {
  hypertension: { sodium_limit_mg: 1500 },
  prediabetes: { sugar_limit_g: 25, glycemic_emphasis: true },
  gout: { purine_flag: true },
  fodmap: { fodmap_limit_g: 12 }
};

// Age-based organ sensitivity modifiers
const AGE_SENSITIVITY_MODIFIERS = {
  heart: { under_30: 1.0, '30_50': 1.1, '50_65': 1.25, over_65: 1.4 },
  kidneys: { under_30: 1.0, '30_50': 1.05, '50_65': 1.2, over_65: 1.35 },
  liver: { under_30: 1.0, '30_50': 1.0, '50_65': 1.1, over_65: 1.2 },
  pancreas: { under_30: 1.0, '30_50': 1.1, '50_65': 1.25, over_65: 1.35 }
};

// Calculate age from date of birth
function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

// Get age bracket for sensitivity modifiers
function getAgeBracket(age) {
  if (age == null) return 'under_30';
  if (age < 30) return 'under_30';
  if (age < 50) return '30_50';
  if (age < 65) return '50_65';
  return 'over_65';
}

// Calculate BMR using Mifflin-St Jeor equation
function calculateBMR(profile) {
  const { biological_sex, date_of_birth, height_cm, current_weight_kg } = profile;
  if (!biological_sex || !height_cm || !current_weight_kg) return null;

  const age = calculateAge(date_of_birth);
  if (age == null) return null;

  // Mifflin-St Jeor Equation
  if (biological_sex === 'male') {
    return Math.round((10 * current_weight_kg) + (6.25 * height_cm) - (5 * age) + 5);
  } else {
    return Math.round((10 * current_weight_kg) + (6.25 * height_cm) - (5 * age) - 161);
  }
}

// Calculate TDEE from BMR and activity level
function calculateTDEE(bmr, activityLevel) {
  if (!bmr) return null;
  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel] || ACTIVITY_MULTIPLIERS.moderate;
  return Math.round(bmr * multiplier);
}

// Calculate all macro targets based on profile
// Now supports multiple goals - combines adjustments from all selected goals
function calculateMacroTargets(profile, tdee) {
  if (!tdee || !profile.current_weight_kg) return null;

  const weight_kg = profile.current_weight_kg;

  // Parse goals - support both new goals array (JSON) and legacy primary_goal
  let goals = [];
  if (profile.goals) {
    try {
      goals = typeof profile.goals === 'string' ? JSON.parse(profile.goals) : profile.goals;
    } catch (e) {
      console.error('Failed to parse goals:', e);
    }
  }
  if (!Array.isArray(goals) || goals.length === 0) {
    goals = [profile.primary_goal || 'maintain'];
  }

  // Combine adjustments from all goals
  // For calorie_adjustment: sum them (e.g., lose_weight -500 + build_muscle +300 = -200)
  // For protein_multiplier: use the highest value (most protein-focused goal wins)
  // For fiber_target_override: use the highest override if any goal specifies one
  let totalCalorieAdjustment = 0;
  let maxProteinMultiplier = 1.0;
  let fiberOverride = null;

  for (const goal of goals) {
    const goalConfig = GOAL_ADJUSTMENTS[goal] || GOAL_ADJUSTMENTS.maintain;
    totalCalorieAdjustment += goalConfig.calorie_adjustment || 0;
    if ((goalConfig.protein_multiplier || 1.0) > maxProteinMultiplier) {
      maxProteinMultiplier = goalConfig.protein_multiplier;
    }
    if (goalConfig.fiber_target_override && (!fiberOverride || goalConfig.fiber_target_override > fiberOverride)) {
      fiberOverride = goalConfig.fiber_target_override;
    }
  }

  // Handle conflicting goals: if both lose_weight and build_muscle, moderate the adjustment
  // This prevents extreme calorie deficits/surpluses from stacking
  const hasLoseWeight = goals.includes('lose_weight');
  const hasBuildMuscle = goals.includes('build_muscle');
  if (hasLoseWeight && hasBuildMuscle) {
    // Recomposition mode: slight deficit with high protein
    totalCalorieAdjustment = -200; // Moderate deficit
    maxProteinMultiplier = Math.max(maxProteinMultiplier, 1.2); // Ensure adequate protein
  }

  const adjustedCalories = tdee + totalCalorieAdjustment;

  // Protein: base 1.0g per kg, adjusted by highest goal multiplier
  const proteinPerKg = 1.0 * maxProteinMultiplier;
  const protein_g = Math.round(weight_kg * proteinPerKg);

  // Fiber: 14g per 1000 kcal (Institute of Medicine) or override from goals
  const fiber_g = fiberOverride || Math.round((adjustedCalories / 1000) * 14);

  // Fat: 30% of calories
  const fat_calories = adjustedCalories * 0.30;
  const fat_g = Math.round(fat_calories / 9);

  // Carbs: remainder after protein and fat
  const protein_calories = protein_g * 4;
  const carb_calories = adjustedCalories - protein_calories - fat_calories;
  const carbs_g = Math.round(carb_calories / 4);

  return {
    calories_target: adjustedCalories,
    calories_min: Math.max(1200, adjustedCalories - 300),
    calories_max: adjustedCalories + 300,
    protein_target_g: protein_g,
    protein_min_g: Math.round(weight_kg * 0.8),
    carbs_target_g: carbs_g,
    fat_target_g: fat_g,
    fiber_target_g: fiber_g,
    goals_applied: goals // Include which goals were used for transparency
  };
}

// Calculate limit thresholds based on conditions
function calculateLimits(conditions, baseCalories) {
  // Default limits
  let limits = {
    sugar_limit_g: Math.round((baseCalories || 2000) * 0.10 / 4), // 10% of calories
    sodium_limit_mg: 2300,
    saturated_fat_limit_g: Math.round((baseCalories || 2000) * 0.10 / 9),
    fodmap_limit_g: null,
    purine_flag: 0,
    glycemic_emphasis: 0
  };

  // Apply condition overrides (most restrictive wins)
  const conditionCodes = Array.isArray(conditions) ? conditions : [];
  for (const code of conditionCodes) {
    const override = CONDITION_OVERRIDES[code];
    if (override) {
      if (override.sodium_limit_mg && override.sodium_limit_mg < limits.sodium_limit_mg) {
        limits.sodium_limit_mg = override.sodium_limit_mg;
      }
      if (override.sugar_limit_g && override.sugar_limit_g < limits.sugar_limit_g) {
        limits.sugar_limit_g = override.sugar_limit_g;
      }
      if (override.fodmap_limit_g) {
        limits.fodmap_limit_g = override.fodmap_limit_g;
      }
      if (override.purine_flag) {
        limits.purine_flag = 1;
      }
      if (override.glycemic_emphasis) {
        limits.glycemic_emphasis = 1;
      }
    }
  }

  return limits;
}

// Adjust organ score based on age
function adjustOrganScoreForAge(baseScore, organ, age) {
  const bracket = getAgeBracket(age);
  const modifiers = AGE_SENSITIVITY_MODIFIERS[organ];
  if (!modifiers) return baseScore;

  const modifier = modifiers[bracket] || 1.0;
  // Amplify negative impacts for sensitive organs
  if (baseScore < 0) {
    return Math.round(baseScore * modifier);
  }
  return baseScore;
}

// Infer meal type from hour of day
function inferMealType(hour) {
  if (hour == null) hour = new Date().getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 14) return 'lunch';
  if (hour < 17) return 'snack';
  return 'dinner';
}

// Get today's date as ISO string (YYYY-MM-DD)
function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Population defaults when no profile exists
function getPopulationDefaults() {
  return {
    calories_target: 2000,
    calories_min: 1500,
    calories_max: 2500,
    protein_target_g: 50,
    protein_min_g: 40,
    carbs_target_g: 250,
    fat_target_g: 65,
    fiber_target_g: 28,
    sugar_limit_g: 50,
    sodium_limit_mg: 2300,
    saturated_fat_limit_g: 22,
    fodmap_limit_g: null,
    purine_flag: 0,
    glycemic_emphasis: 0
  };
}

// ---- User Profile D1 Functions ----

async function getUserProfile(env, userId) {
  if (!env?.D1_DB || !userId) return null;
  try {
    const row = await env.D1_DB.prepare(
      'SELECT * FROM user_profiles WHERE user_id = ?'
    ).bind(userId).first();
    return row || null;
  } catch (e) {
    console.error('getUserProfile error:', e);
    return null;
  }
}

async function upsertUserProfile(env, userId, profileData) {
  if (!env?.D1_DB || !userId) return { ok: false, error: 'missing_db_or_user' };

  const now = Math.floor(Date.now() / 1000);
  const existing = await getUserProfile(env, userId);

  try {
    if (existing) {
      // Update existing profile
      const fields = [];
      const values = [];

      const allowedFields = [
        'biological_sex', 'date_of_birth', 'height_cm', 'current_weight_kg',
        'activity_level', 'unit_system', 'primary_goal', 'goals', 'bmr_kcal', 'tdee_kcal'
      ];

      for (const field of allowedFields) {
        if (profileData[field] !== undefined) {
          fields.push(`${field} = ?`);
          // Store goals array as JSON string
          if (field === 'goals' && Array.isArray(profileData[field])) {
            values.push(JSON.stringify(profileData[field]));
            // Also update primary_goal to first goal for backwards compatibility
            if (profileData[field].length > 0) {
              fields.push('primary_goal = ?');
              values.push(profileData[field][0]);
            }
          } else {
            values.push(profileData[field]);
          }
        }
      }

      if (fields.length === 0) return { ok: true, message: 'no_changes' };

      fields.push('updated_at = ?');
      values.push(now);

      // Mark profile as completed if key fields are present
      if (profileData.biological_sex && profileData.height_cm && profileData.current_weight_kg) {
        fields.push('profile_completed_at = ?');
        values.push(existing.profile_completed_at || now);
      }

      values.push(userId);

      await env.D1_DB.prepare(
        `UPDATE user_profiles SET ${fields.join(', ')} WHERE user_id = ?`
      ).bind(...values).run();

    } else {
      // Insert new profile
      // Handle goals array - store as JSON and set primary_goal for backwards compat
      const goalsArray = Array.isArray(profileData.goals) ? profileData.goals : ['maintain'];
      const goalsJson = JSON.stringify(goalsArray);
      const primaryGoal = goalsArray[0] || profileData.primary_goal || 'maintain';

      await env.D1_DB.prepare(`
        INSERT INTO user_profiles (
          user_id, biological_sex, date_of_birth, height_cm, current_weight_kg,
          activity_level, unit_system, primary_goal, goals, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        userId,
        profileData.biological_sex || null,
        profileData.date_of_birth || null,
        profileData.height_cm || null,
        profileData.current_weight_kg || null,
        profileData.activity_level || 'moderate',
        profileData.unit_system || 'imperial',
        primaryGoal,
        goalsJson,
        now,
        now
      ).run();
    }

    return { ok: true };
  } catch (e) {
    console.error('upsertUserProfile error:', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

async function getUserAllergens(env, userId) {
  if (!env?.D1_DB || !userId) return [];
  try {
    const { results } = await env.D1_DB.prepare(
      'SELECT allergen_code, severity FROM user_allergens WHERE user_id = ?'
    ).bind(userId).all();
    return results || [];
  } catch (e) {
    console.error('getUserAllergens error:', e);
    return [];
  }
}

async function setUserAllergens(env, userId, allergens) {
  if (!env?.D1_DB || !userId) return { ok: false, error: 'missing_db_or_user' };

  try {
    // Ensure user profile exists (foreign key requirement)
    const existing = await getUserProfile(env, userId);
    if (!existing) {
      const now = Math.floor(Date.now() / 1000);
      await env.D1_DB.prepare(`
        INSERT INTO user_profiles (user_id, created_at, updated_at)
        VALUES (?, ?, ?)
      `).bind(userId, now, now).run();
    }

    // Delete existing allergens
    await env.D1_DB.prepare(
      'DELETE FROM user_allergens WHERE user_id = ?'
    ).bind(userId).run();

    // Insert new allergens
    const now = Math.floor(Date.now() / 1000);
    for (const item of (allergens || [])) {
      const code = typeof item === 'string' ? item : item.allergen_code;
      const severity = (typeof item === 'object' && item.severity) ? item.severity : 'avoid';

      await env.D1_DB.prepare(`
        INSERT INTO user_allergens (user_id, allergen_code, severity, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(userId, code, severity, now).run();
    }

    return { ok: true };
  } catch (e) {
    console.error('setUserAllergens error:', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

async function getUserOrganPriorities(env, userId) {
  if (!env?.D1_DB || !userId) return [];
  try {
    const { results } = await env.D1_DB.prepare(
      'SELECT organ_code, priority_rank, is_starred FROM user_organ_priorities WHERE user_id = ? ORDER BY priority_rank ASC'
    ).bind(userId).all();
    return results || [];
  } catch (e) {
    console.error('getUserOrganPriorities error:', e);
    return [];
  }
}

async function setUserOrganPriorities(env, userId, organs) {
  if (!env?.D1_DB || !userId) return { ok: false, error: 'missing_db_or_user' };

  try {
    // Ensure user profile exists (foreign key requirement)
    const existing = await getUserProfile(env, userId);
    if (!existing) {
      const now = Math.floor(Date.now() / 1000);
      await env.D1_DB.prepare(`
        INSERT INTO user_profiles (user_id, created_at, updated_at)
        VALUES (?, ?, ?)
      `).bind(userId, now, now).run();
    }

    // Delete existing priorities
    await env.D1_DB.prepare(
      'DELETE FROM user_organ_priorities WHERE user_id = ?'
    ).bind(userId).run();

    // Insert new priorities
    const now = Math.floor(Date.now() / 1000);
    for (const item of (organs || [])) {
      const code = typeof item === 'string' ? item : item.organ_code;
      const rank = (typeof item === 'object' && item.priority_rank) ? item.priority_rank : null;
      const starred = (typeof item === 'object' && item.is_starred) ? 1 : 0;

      await env.D1_DB.prepare(`
        INSERT INTO user_organ_priorities (user_id, organ_code, priority_rank, is_starred, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(userId, code, rank, starred, now).run();
    }

    return { ok: true };
  } catch (e) {
    console.error('setUserOrganPriorities error:', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

async function addWeightEntry(env, userId, weightKg, source = 'manual') {
  if (!env?.D1_DB || !userId || !weightKg) return { ok: false, error: 'missing_params' };

  try {
    const now = Math.floor(Date.now() / 1000);

    // Insert weight history entry
    await env.D1_DB.prepare(`
      INSERT INTO weight_history (user_id, weight_kg, recorded_at, source)
      VALUES (?, ?, ?, ?)
    `).bind(userId, weightKg, now, source).run();

    // Update current weight in profile
    await env.D1_DB.prepare(`
      UPDATE user_profiles SET current_weight_kg = ?, updated_at = ? WHERE user_id = ?
    `).bind(weightKg, now, userId).run();

    return { ok: true };
  } catch (e) {
    console.error('addWeightEntry error:', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

async function getWeightHistory(env, userId, limit = 30) {
  if (!env?.D1_DB || !userId) return [];
  try {
    const { results } = await env.D1_DB.prepare(
      'SELECT weight_kg, recorded_at, source FROM weight_history WHERE user_id = ? ORDER BY recorded_at DESC LIMIT ?'
    ).bind(userId, limit).all();
    return results || [];
  } catch (e) {
    console.error('getWeightHistory error:', e);
    return [];
  }
}

// ---- User Daily Targets ----

async function calculateAndStoreTargets(env, userId) {
  if (!env?.D1_DB || !userId) return null;

  const profile = await getUserProfile(env, userId);
  if (!profile) return getPopulationDefaults();

  const allergens = await getUserAllergens(env, userId);
  const conditionCodes = allergens
    .filter(a => ['hypertension', 'prediabetes', 'gout', 'fodmap'].includes(a.allergen_code))
    .map(a => a.allergen_code);

  const bmr = calculateBMR(profile);
  const tdee = calculateTDEE(bmr, profile.activity_level);

  if (bmr && tdee) {
    // Update BMR/TDEE in profile
    await env.D1_DB.prepare(
      'UPDATE user_profiles SET bmr_kcal = ?, tdee_kcal = ?, updated_at = ? WHERE user_id = ?'
    ).bind(bmr, tdee, Math.floor(Date.now() / 1000), userId).run();
  }

  const macros = calculateMacroTargets(profile, tdee) || getPopulationDefaults();
  const limits = calculateLimits(conditionCodes, macros.calories_target);

  const targets = {
    ...macros,
    ...limits,
    calculation_basis: JSON.stringify({
      bmr,
      tdee,
      weight_kg: profile.current_weight_kg,
      activity_level: profile.activity_level,
      goal: profile.primary_goal,
      conditions: conditionCodes
    })
  };

  // Upsert targets
  try {
    const existing = await env.D1_DB.prepare(
      'SELECT user_id FROM user_daily_targets WHERE user_id = ?'
    ).bind(userId).first();

    const now = Math.floor(Date.now() / 1000);

    if (existing) {
      await env.D1_DB.prepare(`
        UPDATE user_daily_targets SET
          calories_target = ?, calories_min = ?, calories_max = ?,
          protein_target_g = ?, protein_min_g = ?, carbs_target_g = ?,
          fat_target_g = ?, fiber_target_g = ?, sugar_limit_g = ?,
          sodium_limit_mg = ?, saturated_fat_limit_g = ?, fodmap_limit_g = ?,
          purine_flag = ?, glycemic_emphasis = ?, calculation_basis = ?, calculated_at = ?
        WHERE user_id = ?
      `).bind(
        targets.calories_target, targets.calories_min, targets.calories_max,
        targets.protein_target_g, targets.protein_min_g, targets.carbs_target_g,
        targets.fat_target_g, targets.fiber_target_g, targets.sugar_limit_g,
        targets.sodium_limit_mg, targets.saturated_fat_limit_g, targets.fodmap_limit_g,
        targets.purine_flag, targets.glycemic_emphasis, targets.calculation_basis, now,
        userId
      ).run();
    } else {
      await env.D1_DB.prepare(`
        INSERT INTO user_daily_targets (
          user_id, calories_target, calories_min, calories_max,
          protein_target_g, protein_min_g, carbs_target_g, fat_target_g,
          fiber_target_g, sugar_limit_g, sodium_limit_mg, saturated_fat_limit_g,
          fodmap_limit_g, purine_flag, glycemic_emphasis, calculation_basis, calculated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        userId,
        targets.calories_target, targets.calories_min, targets.calories_max,
        targets.protein_target_g, targets.protein_min_g, targets.carbs_target_g,
        targets.fat_target_g, targets.fiber_target_g, targets.sugar_limit_g,
        targets.sodium_limit_mg, targets.saturated_fat_limit_g, targets.fodmap_limit_g,
        targets.purine_flag, targets.glycemic_emphasis, targets.calculation_basis, now
      ).run();
    }
  } catch (e) {
    console.error('calculateAndStoreTargets error:', e);
  }

  return targets;
}

async function getUserTargets(env, userId) {
  if (!env?.D1_DB || !userId) return getPopulationDefaults();

  try {
    const row = await env.D1_DB.prepare(
      'SELECT * FROM user_daily_targets WHERE user_id = ?'
    ).bind(userId).first();

    if (row) return row;

    // Calculate and store if not exists
    return await calculateAndStoreTargets(env, userId);
  } catch (e) {
    console.error('getUserTargets error:', e);
    return getPopulationDefaults();
  }
}

// ---- Meal Logging ----

async function logMeal(env, userId, mealData) {
  if (!env?.D1_DB || !userId) return { ok: false, error: 'missing_db_or_user' };

  const now = Math.floor(Date.now() / 1000);
  const mealDate = mealData.meal_date || getTodayISO();
  const hour = new Date().getHours();
  const mealType = mealData.meal_type || inferMealType(hour);

  try {
    // Ensure user profile exists (foreign key requirement)
    const existing = await getUserProfile(env, userId);
    if (!existing) {
      await env.D1_DB.prepare(`
        INSERT INTO user_profiles (user_id, created_at, updated_at)
        VALUES (?, ?, ?)
      `).bind(userId, now, now).run();
    }

    // Check for duplicate logging within 2 minutes
    const recentMeal = await env.D1_DB.prepare(`
      SELECT id FROM logged_meals
      WHERE user_id = ? AND dish_name = ? AND logged_at > ?
    `).bind(userId, mealData.dish_name, now - 120).first();

    if (recentMeal) {
      return { ok: false, error: 'duplicate_log', message: 'Already logged recently' };
    }

    // R2-as-source-of-truth: Store full_analysis in R2, keep only pointer in D1
    let r2AnalysisKey = null;
    if (mealData.full_analysis && env.R2_BUCKET) {
      r2AnalysisKey = `meals/${userId}/${crypto.randomUUID()}.json`;
      await r2WriteJSON(env, r2AnalysisKey, mealData.full_analysis);
    }

    // Insert the meal (r2_analysis_key instead of full_analysis blob)
    const result = await env.D1_DB.prepare(`
      INSERT INTO logged_meals (
        user_id, dish_id, dish_name, restaurant_name, logged_at, meal_date,
        meal_type, portion_factor, calories, protein_g, carbs_g, fat_g,
        fiber_g, sugar_g, sodium_mg, organ_impacts, risk_flags,
        analysis_confidence, analysis_version, r2_analysis_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      userId,
      mealData.dish_id || null,
      mealData.dish_name,
      mealData.restaurant_name || null,
      now,
      mealDate,
      mealType,
      mealData.portion_factor || 1.0,
      mealData.calories || null,
      mealData.protein_g || null,
      mealData.carbs_g || null,
      mealData.fat_g || null,
      mealData.fiber_g || null,
      mealData.sugar_g || null,
      mealData.sodium_mg || null,
      mealData.organ_impacts ? JSON.stringify(mealData.organ_impacts) : null,
      mealData.risk_flags ? JSON.stringify(mealData.risk_flags) : null,
      mealData.analysis_confidence || null,
      mealData.analysis_version || PIPELINE_VERSION,
      r2AnalysisKey
    ).run();

    // Update daily summary
    await updateDailySummary(env, userId, mealDate);

    // Update saved dish stats if this dish is saved
    if (mealData.dish_id) {
      await env.D1_DB.prepare(`
        UPDATE saved_dishes
        SET last_logged_at = ?, times_logged = times_logged + 1
        WHERE user_id = ? AND dish_id = ?
      `).bind(now, userId, mealData.dish_id).run();
    }

    return { ok: true, meal_id: result.meta?.last_row_id };
  } catch (e) {
    console.error('logMeal error:', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

async function getMealsForDate(env, userId, date) {
  if (!env?.D1_DB || !userId) return [];
  const targetDate = date || getTodayISO();

  try {
    const { results } = await env.D1_DB.prepare(`
      SELECT * FROM logged_meals
      WHERE user_id = ? AND meal_date = ?
      ORDER BY logged_at ASC
    `).bind(userId, targetDate).all();

    return (results || []).map(row => ({
      ...row,
      organ_impacts: row.organ_impacts ? JSON.parse(row.organ_impacts) : null,
      risk_flags: row.risk_flags ? JSON.parse(row.risk_flags) : []
    }));
  } catch (e) {
    console.error('getMealsForDate error:', e);
    return [];
  }
}

async function deleteMeal(env, userId, mealId) {
  if (!env?.D1_DB || !userId || !mealId) return { ok: false, error: 'missing_params' };

  try {
    // Get meal date before deletion for summary update
    const meal = await env.D1_DB.prepare(
      'SELECT meal_date FROM logged_meals WHERE id = ? AND user_id = ?'
    ).bind(mealId, userId).first();

    if (!meal) return { ok: false, error: 'meal_not_found' };

    await env.D1_DB.prepare(
      'DELETE FROM logged_meals WHERE id = ? AND user_id = ?'
    ).bind(mealId, userId).run();

    // Update daily summary
    await updateDailySummary(env, userId, meal.meal_date);

    return { ok: true };
  } catch (e) {
    console.error('deleteMeal error:', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

// ---- Daily Summary ----

async function updateDailySummary(env, userId, date) {
  if (!env?.D1_DB || !userId) return;

  const targetDate = date || getTodayISO();

  try {
    // Aggregate meals for the day
    const meals = await getMealsForDate(env, userId, targetDate);

    const totals = {
      total_calories: 0,
      total_protein_g: 0,
      total_carbs_g: 0,
      total_fat_g: 0,
      total_fiber_g: 0,
      total_sugar_g: 0,
      total_sodium_mg: 0,
      meals_logged: meals.length
    };

    const organImpactsNet = {};
    const allFlags = new Set();

    for (const meal of meals) {
      totals.total_calories += meal.calories || 0;
      totals.total_protein_g += meal.protein_g || 0;
      totals.total_carbs_g += meal.carbs_g || 0;
      totals.total_fat_g += meal.fat_g || 0;
      totals.total_fiber_g += meal.fiber_g || 0;
      totals.total_sugar_g += meal.sugar_g || 0;
      totals.total_sodium_mg += meal.sodium_mg || 0;

      // Aggregate organ impacts
      if (meal.organ_impacts) {
        for (const [organ, score] of Object.entries(meal.organ_impacts)) {
          organImpactsNet[organ] = (organImpactsNet[organ] || 0) + score;
        }
      }

      // Collect flags
      if (Array.isArray(meal.risk_flags)) {
        meal.risk_flags.forEach(f => allFlags.add(f));
      }
    }

    // Generate insight
    const targets = await getUserTargets(env, userId);
    const insight = generateDailyInsight(totals, targets);

    const now = Math.floor(Date.now() / 1000);

    // Check for exceeded limits and add flags
    if (totals.total_sugar_g > (targets.sugar_limit_g || 50)) {
      allFlags.add('exceeded_sugar');
    }
    if (totals.total_sodium_mg > (targets.sodium_limit_mg || 2300)) {
      allFlags.add('exceeded_sodium');
    }

    // Upsert summary
    const existing = await env.D1_DB.prepare(
      'SELECT user_id FROM daily_summaries WHERE user_id = ? AND summary_date = ?'
    ).bind(userId, targetDate).first();

    if (existing) {
      await env.D1_DB.prepare(`
        UPDATE daily_summaries SET
          total_calories = ?, total_protein_g = ?, total_carbs_g = ?, total_fat_g = ?,
          total_fiber_g = ?, total_sugar_g = ?, total_sodium_mg = ?, meals_logged = ?,
          organ_impacts_net = ?, flags_triggered = ?, daily_insight = ?, last_updated_at = ?
        WHERE user_id = ? AND summary_date = ?
      `).bind(
        totals.total_calories, totals.total_protein_g, totals.total_carbs_g, totals.total_fat_g,
        totals.total_fiber_g, totals.total_sugar_g, totals.total_sodium_mg, totals.meals_logged,
        JSON.stringify(organImpactsNet), JSON.stringify([...allFlags]), insight, now,
        userId, targetDate
      ).run();
    } else {
      await env.D1_DB.prepare(`
        INSERT INTO daily_summaries (
          user_id, summary_date, total_calories, total_protein_g, total_carbs_g,
          total_fat_g, total_fiber_g, total_sugar_g, total_sodium_mg, meals_logged,
          organ_impacts_net, flags_triggered, daily_insight, last_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        userId, targetDate,
        totals.total_calories, totals.total_protein_g, totals.total_carbs_g,
        totals.total_fat_g, totals.total_fiber_g, totals.total_sugar_g, totals.total_sodium_mg,
        totals.meals_logged, JSON.stringify(organImpactsNet), JSON.stringify([...allFlags]),
        insight, now
      ).run();
    }
  } catch (e) {
    console.error('updateDailySummary error:', e);
  }
}

function generateDailyInsight(totals, targets) {
  const parts = [];

  // Check fiber
  if (totals.total_fiber_g >= (targets.fiber_target_g || 28)) {
    parts.push(`Fiber intake on track (${Math.round(totals.total_fiber_g)}g).`);
  } else if (totals.total_fiber_g < (targets.fiber_target_g || 28) * 0.5) {
    parts.push(`Fiber intake low (${Math.round(totals.total_fiber_g)}g) — consider adding vegetables or whole grains.`);
  }

  // Check sugar
  const sugarLimit = targets.sugar_limit_g || 50;
  if (totals.total_sugar_g > sugarLimit) {
    const excess = Math.round(totals.total_sugar_g - sugarLimit);
    parts.push(`Sugar exceeded limit by ${excess}g — consider protein-focused option for next meal.`);
  }

  // Check sodium
  const sodiumLimit = targets.sodium_limit_mg || 2300;
  if (totals.total_sodium_mg > sodiumLimit) {
    parts.push(`Sodium intake elevated — consider lower-sodium options.`);
  }

  // Check protein
  if (totals.total_protein_g >= (targets.protein_target_g || 50)) {
    parts.push(`Protein target met (${Math.round(totals.total_protein_g)}g).`);
  }

  if (parts.length === 0) {
    return 'Nutrition intake within targets.';
  }

  return parts.join(' ');
}

async function getDailySummary(env, userId, date) {
  if (!env?.D1_DB || !userId) return null;
  const targetDate = date || getTodayISO();

  try {
    const row = await env.D1_DB.prepare(
      'SELECT * FROM daily_summaries WHERE user_id = ? AND summary_date = ?'
    ).bind(userId, targetDate).first();

    if (!row) {
      // Generate fresh summary
      await updateDailySummary(env, userId, targetDate);
      return await env.D1_DB.prepare(
        'SELECT * FROM daily_summaries WHERE user_id = ? AND summary_date = ?'
      ).bind(userId, targetDate).first();
    }

    return {
      ...row,
      organ_impacts_net: row.organ_impacts_net ? JSON.parse(row.organ_impacts_net) : {},
      flags_triggered: row.flags_triggered ? JSON.parse(row.flags_triggered) : []
    };
  } catch (e) {
    console.error('getDailySummary error:', e);
    return null;
  }
}

async function getWeeklySummaries(env, userId, days = 7) {
  if (!env?.D1_DB || !userId) return [];

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startISO = startDate.toISOString().slice(0, 10);

    const { results } = await env.D1_DB.prepare(`
      SELECT * FROM daily_summaries
      WHERE user_id = ? AND summary_date >= ?
      ORDER BY summary_date ASC
    `).bind(userId, startISO).all();

    return (results || []).map(row => ({
      ...row,
      organ_impacts_net: row.organ_impacts_net ? JSON.parse(row.organ_impacts_net) : {},
      flags_triggered: row.flags_triggered ? JSON.parse(row.flags_triggered) : []
    }));
  } catch (e) {
    console.error('getWeeklySummaries error:', e);
    return [];
  }
}

// ---- Saved Dishes ----

async function saveDish(env, userId, dishData) {
  if (!env?.D1_DB || !userId || !dishData.dish_id) {
    return { ok: false, error: 'missing_params' };
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    await env.D1_DB.prepare(`
      INSERT OR REPLACE INTO saved_dishes (
        user_id, dish_id, dish_name, restaurant_name, avg_calories,
        nutrition_snapshot, organ_impacts_snapshot, risk_flags,
        personal_notes, saved_at, times_logged
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(
      userId,
      dishData.dish_id,
      dishData.dish_name,
      dishData.restaurant_name || null,
      dishData.avg_calories || null,
      dishData.nutrition_snapshot ? JSON.stringify(dishData.nutrition_snapshot) : null,
      dishData.organ_impacts_snapshot ? JSON.stringify(dishData.organ_impacts_snapshot) : null,
      dishData.risk_flags ? JSON.stringify(dishData.risk_flags) : null,
      dishData.personal_notes || null,
      now
    ).run();

    return { ok: true };
  } catch (e) {
    console.error('saveDish error:', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

async function getSavedDishes(env, userId) {
  if (!env?.D1_DB || !userId) return [];

  try {
    const { results } = await env.D1_DB.prepare(`
      SELECT * FROM saved_dishes WHERE user_id = ? ORDER BY saved_at DESC
    `).bind(userId).all();

    return (results || []).map(row => ({
      ...row,
      nutrition_snapshot: row.nutrition_snapshot ? JSON.parse(row.nutrition_snapshot) : null,
      organ_impacts_snapshot: row.organ_impacts_snapshot ? JSON.parse(row.organ_impacts_snapshot) : null,
      risk_flags: row.risk_flags ? JSON.parse(row.risk_flags) : []
    }));
  } catch (e) {
    console.error('getSavedDishes error:', e);
    return [];
  }
}

async function removeSavedDish(env, userId, dishId) {
  if (!env?.D1_DB || !userId || !dishId) return { ok: false, error: 'missing_params' };

  try {
    await env.D1_DB.prepare(
      'DELETE FROM saved_dishes WHERE user_id = ? AND dish_id = ?'
    ).bind(userId, dishId).run();

    return { ok: true };
  } catch (e) {
    console.error('removeSavedDish error:', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

// ---- Allergen Definitions ----

async function getAllergenDefinitions(env) {
  if (!env?.D1_DB) return [];

  try {
    const { results } = await env.D1_DB.prepare(
      'SELECT * FROM allergen_definitions ORDER BY category, display_name'
    ).all();
    return results || [];
  } catch (e) {
    console.error('getAllergenDefinitions error:', e);
    return [];
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

  // Egg detection - critical for medical-grade accuracy
  if (/\beggs?\b|scrambled|omelette?|omelet|frittata|quiche|benedict|sunny.?side|over.?easy|poached\b/.test(text)) {
    push({
      term: "egg",
      canonical: "egg",
      allergens: ["egg"],
      classes: ["egg"]
    });
  }

  // Fish detection
  if (/\b(salmon|tuna|cod|tilapia|trout|halibut|mahi|bass|snapper|anchov|sardine|mackerel|swordfish|catfish|flounder|sole|haddock|perch|pike|carp|fish)\b/.test(text)) {
    push({
      term: "fish",
      canonical: "fish",
      allergens: ["fish"],
      classes: ["fish"]
    });
  }

  // Soy detection
  if (/\b(soy|soya|tofu|tempeh|edamame|miso|tamari)\b/.test(text)) {
    push({
      term: "soy",
      canonical: "soy",
      allergens: ["soy"],
      classes: ["soy"]
    });
  }

  // Peanut detection
  if (/\bpeanut/.test(text)) {
    push({
      term: "peanut",
      canonical: "peanut",
      allergens: ["peanut"],
      classes: ["peanut", "nuts"]
    });
  }

  // Tree nut detection
  if (/\b(almond|walnut|cashew|pistachio|pecan|hazelnut|macadamia|brazil.?nut|chestnut|pine.?nut)\b/.test(text)) {
    push({
      term: "tree_nut",
      canonical: "tree_nut",
      allergens: ["tree_nut"],
      classes: ["tree_nut", "nuts"]
    });
  }

  // Sesame detection
  if (/\b(sesame|tahini)\b/.test(text)) {
    push({
      term: "sesame",
      canonical: "sesame",
      allergens: ["sesame"],
      classes: ["sesame"]
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

    // Egg detection - critical for medical-grade accuracy
    if (/\beggs?\b|scrambled|omelette?|omelet|frittata|quiche|benedict|sunny.?side|over.?easy|poached\b/.test(name)) {
      push({
        term: "egg",
        canonical: "egg",
        allergens: ["egg"],
        classes: ["egg"]
      });
    }

    // Fish detection
    if (/\b(salmon|tuna|cod|tilapia|trout|halibut|mahi|bass|snapper|anchov|sardine|mackerel|swordfish|catfish|flounder|sole|haddock|perch|pike|carp|fish)\b/.test(name)) {
      push({
        term: "fish",
        canonical: "fish",
        allergens: ["fish"],
        classes: ["fish"]
      });
    }

    // Soy detection
    if (/\b(soy|soya|tofu|tempeh|edamame|miso|tamari)\b/.test(name)) {
      push({
        term: "soy",
        canonical: "soy",
        allergens: ["soy"],
        classes: ["soy"]
      });
    }

    // Peanut detection
    if (/\bpeanut/.test(name)) {
      push({
        term: "peanut",
        canonical: "peanut",
        allergens: ["peanut"],
        classes: ["peanut", "nuts"]
      });
    }

    // Tree nut detection
    if (/\b(almond|walnut|cashew|pistachio|pecan|hazelnut|macadamia|brazil.?nut|chestnut|pine.?nut)\b/.test(name)) {
      push({
        term: "tree_nut",
        canonical: "tree_nut",
        allergens: ["tree_nut"],
        classes: ["tree_nut", "nuts"]
      });
    }

    // Sesame detection
    if (/\b(sesame|tahini)\b/.test(name)) {
      push({
        term: "sesame",
        canonical: "sesame",
        allergens: ["sesame"],
        classes: ["sesame"]
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

// ============================================
// SUPER BRAIN: Ingredient Cache Lookup (D1)
// Queries our curated ingredient database before external APIs
// ============================================
async function lookupIngredientFromSuperBrain(env, ingredientName) {
  if (!env?.D1_DB || !ingredientName) return null;

  const normalized = ingredientName.toLowerCase().trim();

  try {
    // Step 1: Find ingredient by canonical name or synonym
    let ingredient = await env.D1_DB.prepare(`
      SELECT i.id, i.canonical_name, i.description
      FROM ingredients i
      WHERE i.canonical_name = ? OR i.canonical_name LIKE ?
      LIMIT 1
    `).bind(normalized, `%${normalized}%`).first();

    // Try synonyms if not found directly
    if (!ingredient) {
      ingredient = await env.D1_DB.prepare(`
        SELECT i.id, i.canonical_name, i.description
        FROM ingredients i
        JOIN ingredient_synonyms s ON s.ingredient_id = i.id
        WHERE s.synonym = ? OR s.synonym LIKE ?
        LIMIT 1
      `).bind(normalized, `%${normalized}%`).first();
    }

    if (!ingredient) return null;

    const ingredientId = ingredient.id;

    // LATENCY OPTIMIZATION: Run all 5 detail queries in parallel using Promise.all
    // This reduces 5 sequential round-trips (~250-500ms) to 1 parallel batch (~50-100ms)
    const [
      { results: nutrients },
      { results: allergens },
      glycemic,
      { results: bioactives },
      { results: categories }
    ] = await Promise.all([
      // Query 1: Fetch nutrients
      env.D1_DB.prepare(`
        SELECT nutrient_code, nutrient_name, amount_per_100g, unit
        FROM ingredient_nutrients
        WHERE ingredient_id = ?
      `).bind(ingredientId).all(),
      // Query 2: Fetch allergens
      env.D1_DB.prepare(`
        SELECT af.allergen_code, ad.display_name, af.confidence
        FROM ingredient_allergen_flags af
        LEFT JOIN allergen_definitions ad ON ad.allergen_code = af.allergen_code
        WHERE af.ingredient_id = ?
      `).bind(ingredientId).all(),
      // Query 3: Fetch glycemic index
      env.D1_DB.prepare(`
        SELECT glycemic_index, glycemic_load, gi_category, serving_size_g
        FROM ingredient_glycemic
        WHERE ingredient_id = ?
        LIMIT 1
      `).bind(ingredientId).first(),
      // Query 4: Fetch bioactives
      env.D1_DB.prepare(`
        SELECT compound_name, compound_class, amount_per_100g, unit, health_effects, target_organs
        FROM ingredient_bioactives
        WHERE ingredient_id = ?
      `).bind(ingredientId).all(),
      // Query 5: Fetch categories
      env.D1_DB.prepare(`
        SELECT fc.category_code, fc.category_name
        FROM ingredient_categories ic
        JOIN food_categories fc ON fc.category_code = ic.category_code
        WHERE ic.ingredient_id = ?
      `).bind(ingredientId).all()
    ]);

    // Build nutrition object in expected format
    const nutritionMap = {};
    for (const n of nutrients || []) {
      nutritionMap[n.nutrient_code] = {
        name: n.nutrient_name,
        amount: n.amount_per_100g,
        unit: n.unit
      };
    }

    return {
      source: 'super_brain',
      ingredientId,
      description: ingredient.canonical_name,
      nutrients: {
        energyKcal: nutritionMap.energy?.amount || nutritionMap.calories?.amount || null,
        protein_g: nutritionMap.protein?.amount || null,
        fat_g: nutritionMap.fat?.amount || nutritionMap.total_fat?.amount || null,
        carbs_g: nutritionMap.carbohydrate?.amount || nutritionMap.carbs?.amount || null,
        fiber_g: nutritionMap.fiber?.amount || null,
        sugar_g: nutritionMap.sugar?.amount || nutritionMap.sugars?.amount || null,
        sodium_mg: nutritionMap.sodium?.amount || null,
        saturatedFat_g: nutritionMap.saturated_fat?.amount || null,
        cholesterol_mg: nutritionMap.cholesterol?.amount || null,
        // Extended nutrients
        vitaminA_mcg: nutritionMap.vitamin_a?.amount || null,
        vitaminC_mg: nutritionMap.vitamin_c?.amount || null,
        vitaminD_mcg: nutritionMap.vitamin_d?.amount || null,
        calcium_mg: nutritionMap.calcium?.amount || null,
        iron_mg: nutritionMap.iron?.amount || null,
        potassium_mg: nutritionMap.potassium?.amount || null,
      },
      allergens: (allergens || []).map(a => ({
        code: a.allergen_code,
        name: a.display_name,
        confidence: a.confidence
      })),
      glycemic: glycemic ? {
        gi: glycemic.glycemic_index,
        gl: glycemic.glycemic_load,
        category: glycemic.gi_category,
        servingSize: glycemic.serving_size_g
      } : null,
      bioactives: (bioactives || []).map(b => ({
        compound: b.compound_name,
        class: b.compound_class,
        amount: b.amount_per_100g,
        unit: b.unit,
        effects: safeJsonParse(b.health_effects, []),
        organs: safeJsonParse(b.target_organs, [])
      })),
      categories: (categories || []).map(c => c.category_code)
    };
  } catch (e) {
    console.error('SuperBrain lookup error:', e);
    return null;
  }
}

function safeJsonParse(str, fallback = null) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

async function getCachedNutrition(env, name) {
  if (!env?.R2_BUCKET) return null;
  const key = `nutrition/${normKey(name)}.json`;
  // LATENCY OPTIMIZATION: Skip r2Head() - just try get() directly
  // This eliminates one unnecessary round-trip (~30-60ms saved)
  try {
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) return null;
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

// LATENCY OPTIMIZATION: Process all ingredients in parallel instead of sequential
// Priority: Super Brain (D1) → R2 Cache → USDA FDC → Open Food Facts
// Added: Ingredient deduplication - same ingredient looked up once, result shared
async function enrichWithNutrition(env, rows = []) {
  // LATENCY OPTIMIZATION: Deduplicate ingredients before lookup
  // "2 cups flour" and "1 cup flour" both normalize to "flour" - only look up once
  const ingredientToRows = new Map(); // normalized name → [row indices]

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const q = (row?.name || row?.original || "").trim().toLowerCase();
    if (!q) continue;

    if (!ingredientToRows.has(q)) {
      ingredientToRows.set(q, []);
    }
    ingredientToRows.get(q).push(i);
  }

  // Fetch unique ingredients in parallel
  const uniqueIngredients = Array.from(ingredientToRows.keys());
  const results = await Promise.all(uniqueIngredients.map(async (q) => {
    // Try Super Brain cache first (our curated D1 database)
    const superBrainHit = await lookupIngredientFromSuperBrain(env, q);
    if (superBrainHit) {
      return { type: 'superBrain', data: superBrainHit, q };
    }

    // Fallback: R2 cache → external APIs
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
    return hit ? { type: 'fdc', data: hit, q } : { type: 'none', q };
  }));

  // Apply results to all rows that share the same ingredient
  for (const result of results) {
    const rowIndices = ingredientToRows.get(result.q) || [];

    for (const idx of rowIndices) {
      const row = rows[idx];

      if (result.type === 'superBrain') {
        const superBrainHit = result.data;
        row.nutrition = superBrainHit.nutrients;
        row._superBrain = {
          ingredientId: superBrainHit.ingredientId,
          description: superBrainHit.description,
          source: 'super_brain',
          allergens: superBrainHit.allergens,
          glycemic: superBrainHit.glycemic,
          bioactives: superBrainHit.bioactives,
          categories: superBrainHit.categories
        };
      } else if (result.type === 'fdc' && result.data?.nutrients) {
        const hit = result.data;
        row.nutrition = hit.nutrients;
        row._fdc = {
          id: hit.fdcId,
          description: hit.description || null,
          dataType: hit.dataType || null,
          source: hit.source || "USDA_FDC"
        };
      }
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

  // Extract image - Edamam provides 'image' (string) and 'images' (object with sizes)
  const image = rec?.image || rec?.images?.REGULAR?.url || rec?.images?.SMALL?.url || rec?.images?.THUMBNAIL?.url || null;

  return {
    recipe: { name: name || null, image, steps, notes: lines.length ? lines : null },
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
  const recipeImage = recipeSrc.image || null;
  const recipe = {
    name: recipeSrc.name || recipeSrc.title || fallbackDish || null,
    image: recipeImage,
    steps: Array.isArray(recipeSrc.steps)
      ? recipeSrc.steps
      : recipeSrc.instructions
        ? [recipeSrc.instructions]
        : [],
    notes:
      Array.isArray(recipeSrc.notes) && recipeSrc.notes.length
        ? recipeSrc.notes
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

// LATENCY OPTIMIZATION: Organs LLM response caching
// PIPELINE_VERSION in key auto-invalidates when prompts/scoring logic changes
// IMPORTANT: Include vision_insights to prevent stale cache when image data differs
function buildOrgansCacheKey(payload) {
  const parts = [
    PIPELINE_VERSION, // Auto-invalidate when analysis logic changes
    (payload.dishName || "").toLowerCase().trim(),
    (payload.restaurantName || "").toLowerCase().trim(),
    JSON.stringify((payload.ingredientLines || []).map(l => l.toLowerCase().trim()).sort()),
    JSON.stringify((payload.ingredientsNormalized || []).map(i =>
      (i.name || i.normalized || "").toLowerCase().trim()
    ).sort()),
    // Include vision data in cache key for correctness
    payload.vision_insights ? hashShort(JSON.stringify(payload.vision_insights)) : "no-vision",
    payload.plate_components?.length ? hashShort(JSON.stringify(payload.plate_components)) : "no-components"
  ];
  return `organs-llm:${hashShort(parts.join("|"))}`;
}

async function getOrgansLLMCached(env, cacheKey) {
  if (!env?.MENUS_CACHE) return null;
  try {
    return await env.MENUS_CACHE.get(cacheKey, "json");
  } catch {
    return null;
  }
}

async function putOrgansLLMCached(env, cacheKey, result) {
  if (!env?.MENUS_CACHE) return;
  try {
    // NO TTL - LLM output for same inputs is deterministic
    // PIPELINE_VERSION in cache key handles invalidation when prompts change
    await env.MENUS_CACHE.put(cacheKey, JSON.stringify({
      ...result,
      _cachedAt: new Date().toISOString()
    }));
  } catch {
    // Cache write failure is non-fatal
  }
}

async function runOrgansLLM(env, payload) {
  // LATENCY OPTIMIZATION: Check cache first (1500-3000ms → 50ms on cache hit)
  const cacheKey = buildOrgansCacheKey(payload);
  const cached = await getOrgansLLMCached(env, cacheKey);
  if (cached && cached.ok && cached.data) {
    return { ...cached, cached: true };
  }

  const model = "gpt-4o-mini";

  const systemPrompt = `
You are an organ comfort analysis assistant for an IBS / gut-sensitivity app.
You give wellness / educational guidance only (not medical advice).
You analyze ONE dish at a time using ONLY the provided input (no external knowledge).
Return VALID JSON ONLY, no extra text.

INPUT:
- nutrition_summary per serving (energyKcal, protein_g, fat_g, carbs_g, sugar_g, fiber_g, sodium_mg).
- ingredient data and tags (may include FODMAP triggers and allergens).
- vision_insights (optional): portion info, visible ingredients, cooking method, lifestyle cues.
- plate_components (optional): list of items on the plate with role ("main"/"side"), label, category, confidence, area_ratio.

Goals:
- Score organ COMFORT (not clinical risk).
- Match severity level to the actual impact described in reasons. If describing "high" amounts or "significant" effects, use moderate_negative or high_negative appropriately.
- Use nutrition_summary as the primary signal; vision_insights and plate_components refine the scores.

Severity calibration (IMPORTANT - match level to description):
- high_negative: Major concerns (very high sat fat, sodium, sugar; multiple harmful factors combined; fried + processed + large portions)
- moderate_negative: Notable concerns (high sat fat OR sodium OR sugar; processed meats; significant portion of unhealthy item)
- mild_negative: Minor concerns (some sat fat, moderate sodium; small portion of less healthy item)
- neutral: Balanced or negligible impact
- mild_positive: Minor benefits (some vitamins/fiber; small healthy component)
- moderate_positive: Notable benefits (good protein source; significant vegetables/fiber; heart-healthy fats)
- high_positive: Major benefits (nutrient-dense whole foods; excellent vitamin/mineral profile)

Organs (always exactly these 11 IDs):
- gut, liver, heart, metabolic, immune, brain, kidney, eyes, skin, bones, thyroid

Additional organ guidelines:
- eyes: Beta-carotene (carrots, sweet potato), lutein (leafy greens), omega-3 (fish) are positive. High sugar/processed foods are mildly negative.
- skin: Vitamin C, E, zinc, omega-3 are positive. Excessive sugar, processed foods, fried foods are negative.
- bones: Calcium, vitamin D, K, magnesium are positive. Excessive sodium, caffeine, alcohol are negative.
- thyroid: Iodine (seafood, seaweed), selenium are positive. Excessive soy, raw cruciferous in large amounts may be mildly negative.

Severity levels:
- high_negative, moderate_negative, mild_negative, neutral,
  mild_positive, moderate_positive, high_positive

GUIDELINES (high level):
- Deep-fried / breaded and very fatty dishes: more negative for gut, liver, heart, metabolic.
- Large portions (portionFactor or servings_on_plate > 1.0): increase negative impact, especially metabolic and gut.
- Very small portions (< 0.75): slightly soften negative impact.
- Processed meats (bacon, sausage, deli meats): negative for heart and metabolic.
- Red meats: moderate negatives for heart/metabolic; harsher if portions are large or combined with fried sides.
- Large visible cheese/cream: negative for gut (lactose-sensitive users) and for heart/liver (saturated fat).
- If a plate_component is a large fried side (e.g. fries/hash browns with high area_ratio): add extra negatives to gut, metabolic (and heart).
- A side salad / mostly vegetables can mildly soften negatives but should NOT fully cancel an unhealthy main.
- When writing reasons, mention important contributors (e.g. fried potatoes, rich sauces, heavy cheese).

FODMAP & lactose flags:
- FODMAP level should reflect common triggers like wheat/gluten, onion, garlic, honey, high-FODMAP fruits, many beans.
- Lactose: consider dairy intensity and type (cream/milk vs aged cheese) when summarizing lactose-related impact.

You MUST return JSON with this shape:

{
  "tummy_barometer": { "score": number, "label": string },
  "organs": [
    {
      "organ": "gut" | "liver" | "heart" | "metabolic" | "immune" | "brain" | "kidney" | "eyes" | "skin" | "bones" | "thyroid",
      "score": number,
      "level": "high_negative" | "moderate_negative" | "mild_negative" | "neutral" | "mild_positive" | "moderate_positive" | "high_positive",
      "reasons": string[]
    }
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

  const messages = [
    { role: "system", content: systemPrompt.trim() },
    { role: "user", content: JSON.stringify(payload) }
  ];

  // LATENCY OPTIMIZATION: Race OpenAI and Cloudflare AI in parallel
  const racingProviders = [];

  // OpenAI provider
  if (env.OPENAI_API_KEY) {
    racingProviders.push(
      (async () => {
        const body = {
          model,
          response_format: { type: "json_object" },
          max_completion_tokens: 1200,
          messages
        };
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENAI_API_KEY}`
          },
          body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`openai-organ-error-${res.status}`);
        const json = await res.json();
        const content = json?.choices?.[0]?.message?.content || "";
        const parsed = JSON.parse(content);
        return { ok: true, data: parsed, provider: "openai" };
      })()
    );
  }

  // Cloudflare AI provider
  if (env.AI) {
    racingProviders.push(
      (async () => {
        const cfMessages = messages.map(m => ({
          role: m.role,
          content: m.content
        }));
        const aiResult = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: cfMessages,
          max_tokens: 1200
        });
        if (!aiResult?.response) throw new Error("cloudflare-organ-empty");
        // Extract JSON from response (may have markdown wrapping)
        let content = aiResult.response;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) content = jsonMatch[0];
        const parsed = JSON.parse(content);
        return { ok: true, data: parsed, provider: "cloudflare" };
      })()
    );
  }

  if (racingProviders.length === 0) {
    return { ok: false, error: "no-llm-providers-available" };
  }

  try {
    const result = await Promise.any(racingProviders);
    // Cache successful result (non-blocking)
    putOrgansLLMCached(env, cacheKey, result);
    return result;
  } catch (aggregateError) {
    return {
      ok: false,
      error: "all-organ-llms-failed",
      details: aggregateError.errors?.map(e => e.message).join("; ")
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
You analyze ONE dish at a time using ONLY the provided input (no external knowledge).
Return exactly ONE JSON object in the required shape, with no extra text.

INPUT:
- dishName, restaurantName, menuSection, menuDescription.
- ingredients: structured list of parsed ingredients (multi-language possible).
- tags: labels like "gluten-free", "vegan", "vegetarian", "lactose-free", "sin gluten", etc.
- plate_components (optional):
  - Each component: role ("main" | "side" | "unknown"), label, category ("sandwich", "burger", "pasta", "fried_potatoes", "salad", "other"),
    confidence (0–1), area_ratio (0–1).
  - Use this to understand mains vs sides, and mention when risk comes from a side vs the main.

YOUR TASKS:
1. Decide presence of allergens:
   - gluten, milk, egg, soy, peanut, tree_nut, fish, shellfish, sesame.
   For each: "present": "yes" | "no" | "maybe" + short concrete reason.
2. Estimate lactose level:
   - "none" | "trace" | "low" | "medium" | "high" with a short reason.
3. Estimate overall FODMAP level for the dish:
   - "low" | "medium" | "high" with a short reason.
4. Set extra flags:
   - pork, beef, alcohol, spicy (each: "yes" | "no" | "maybe" with reason).
5. Emit lifestyle_tags and lifestyle_checks for red meat, vegetarian/vegan.
6. Emit component_allergens describing key components on the plate using the SAME allergen/lactose/FODMAP structure as the global ones.

STRICTNESS RULES (IMPORTANT):
- DO NOT invent ingredients that are not clearly implied or typical by name/description.
- Only set "present": "yes" when:
  - An allergen is explicitly mentioned in dishName, menuDescription, ingredients, or tags,
  - OR when it is overwhelmingly implied (e.g. "shrimp tacos" → shellfish).
- When a recipe often contains an allergen but the text does not mention it:
  - Use "present": "maybe" with a clear explanation (e.g. "Meatballs often use egg as a binder, but egg is not listed here.").
- If the text gives no indication for an allergen and no tags imply it:
  - Prefer "present": "no" and mention that it is not listed or implied.

MULTI-LANGUAGE AWARENESS:
- Recognize common food words in Spanish, Italian, French, Portuguese, etc.
  - "queso", "nata", "crema", "leche" → dairy (milk).
  - "pan", "brioche", "baguette", "pasta" → usually gluten unless clearly gluten-free.
  - "mariscos", "gambas", "camarón", "langostino" → shellfish.
- Use tags such as "vegan", "vegetarian", "gluten-free", "lactose-free", "sin gluten", "sin lactosa" to refine decisions.
  - Vegan: no meat, fish, shellfish, dairy, eggs.
  - Vegetarian: no meat/fish/shellfish but dairy/eggs allowed.

GLUTEN RULES (SUMMARY):
- If ingredients include wheat, flour, bread, bun, brioche, baguette, pasta, noodles (any language) and not explicitly gluten-free:
  → gluten.present = "yes".
- If dish or tags include clear gluten-free indicators and NO explicit wheat/flour:
  → gluten.present = "no" with explanation.
- If a component is ambiguous (e.g. just "bun") and there is no gluten-free tag:
  → gluten.present = "maybe" with a reason like "Bun usually contains wheat; menu does not clarify."

MILK & LACTOSE RULES (SUMMARY):
- Dairy words (milk, cream, butter, cheese, queso, yogurt, nata, crema, leche, etc.) imply milk allergen = "yes".
- Lactose level:
  - High: fresh milk, cream, fresh cheeses, ice cream, sweetened dairy sauces.
  - Medium: butter, soft cheeses, yogurt (unless explicitly lactose-free).
  - Low/Trace: aged hard cheeses.
  - None: plant milks or explicit lactose-free products.

FODMAP RULES (SUMMARY):
- Common high-FODMAP: wheat bread/pasta, garlic, onions, honey, some fruits (apples, pears, mango), many beans, certain sweeteners.
- "high": multiple strong high-FODMAP ingredients (e.g. garlic + onion + wheat bun).
- "medium": some high-FODMAP components but balanced with low-FODMAP ingredients.
- "low": mostly low-FODMAP foods (meat, fish, eggs, rice, potatoes, many vegetables) with no obvious strong triggers.

ALLERGEN CLASSIFICATION (CRITICAL - DO NOT CONFUSE):
- TREE NUTS: almonds, cashews, walnuts, pecans, pistachios, hazelnuts, macadamia, brazil nuts, pine nuts.
- SESAME: sesame seeds, tahini, sesame oil. SESAME IS NOT A TREE NUT - it is a SEPARATE allergen category.
- PEANUTS: peanuts, peanut butter. PEANUTS ARE LEGUMES, NOT TREE NUTS.
- Never classify sesame as tree_nut. Never classify peanuts as tree_nut. These are medically distinct categories.

OUTPUT FORMAT:
Return exactly ONE JSON object with this shape:

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

${EVIDENCE_GUIDELINES}
`;

  const body = {
    model,
    response_format: { type: "json_object" },
    max_completion_tokens: 900,
    messages: [
      { role: "system", content: systemPrompt.trim() },
      {
        role: "user",
        // send minified JSON to reduce tokens
        content: JSON.stringify(input)
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

    return { ok: true, data: parsed, provider: "openai" };
  } catch (err) {
    return {
      ok: false,
      error: "openai-allergen-exception",
      details: String(err)
    };
  }
}

// --- Grok (xAI) allergen analysis ---
async function runAllergenGrokLLM(env, input, systemPrompt) {
  const url = (env.GROK_API_URL || "https://api.x.ai/v1/chat/completions").trim();
  const key = (env.GROK_API_KEY || env.XAI_API_KEY || "").trim();

  if (!key) {
    return { ok: false, error: "missing-grok-api-key" };
  }

  const body = {
    model: env.GROK_MODEL || "grok-2-latest",
    messages: [
      { role: "system", content: systemPrompt.trim() },
      { role: "user", content: JSON.stringify(input) }
    ],
    temperature: 0.1
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        error: `grok-allergen-error-${res.status}`,
        details: text
      };
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      // Try to extract JSON from response (Grok may include markdown)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (e) {
      return {
        ok: false,
        error: "grok-allergen-json-parse-error",
        details: String(e),
        raw: content
      };
    }

    return { ok: true, data: parsed, provider: "grok" };
  } catch (err) {
    return {
      ok: false,
      error: "grok-allergen-exception",
      details: String(err)
    };
  }
}

// --- Cloudflare AI (Llama) allergen analysis ---
async function runAllergenCloudflareLLM(env, input, systemPrompt) {
  if (!env.AI) {
    return { ok: false, error: "missing-cloudflare-ai-binding" };
  }

  try {
    // Use Llama 3.1 70B for best quality
    const response = await env.AI.run("@cf/meta/llama-3.1-70b-instruct", {
      messages: [
        { role: "system", content: systemPrompt.trim() + "\n\nIMPORTANT: Return ONLY valid JSON, no markdown or explanations." },
        { role: "user", content: JSON.stringify(input) }
      ],
      max_tokens: 1500,
      temperature: 0.1
    });

    const content = response?.response || "";

    let parsed;
    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (e) {
      return {
        ok: false,
        error: "cloudflare-allergen-json-parse-error",
        details: String(e),
        raw: content
      };
    }

    return { ok: true, data: parsed, provider: "cloudflare-llama" };
  } catch (err) {
    return {
      ok: false,
      error: "cloudflare-allergen-exception",
      details: String(err)
    };
  }
}

// LATENCY OPTIMIZATION: LLM response caching for allergen analysis
// Same dish + ingredients + vision data + pipeline version = same allergen output
// PIPELINE_VERSION in key auto-invalidates cache when prompts/logic change
// IMPORTANT: Include vision_insights to prevent stale cache when image data differs
function buildAllergenCacheKey(input) {
  const parts = [
    PIPELINE_VERSION, // Auto-invalidate when analysis logic changes
    (input.dishName || "").toLowerCase().trim(),
    (input.restaurantName || "").toLowerCase().trim(),
    (input.menuSection || "").toLowerCase().trim(),
    JSON.stringify((input.ingredients || []).map(i =>
      (i.name || i.normalized || "").toLowerCase().trim()
    ).sort()),
    JSON.stringify((input.tags || []).map(t => t.toLowerCase().trim()).sort()),
    // Include vision data in cache key for correctness
    input.vision_insights ? hashShort(JSON.stringify(input.vision_insights)) : "no-vision",
    input.plate_components?.length ? hashShort(JSON.stringify(input.plate_components)) : "no-components"
  ];
  return `allergen-llm:${hashShort(parts.join("|"))}`;
}

async function getAllergenLLMCached(env, cacheKey) {
  if (!env?.MENUS_CACHE) return null;
  try {
    return await env.MENUS_CACHE.get(cacheKey, "json");
  } catch {
    return null;
  }
}

async function putAllergenLLMCached(env, cacheKey, result) {
  if (!env?.MENUS_CACHE) return;
  try {
    // NO TTL - LLM output for same inputs is deterministic
    // PIPELINE_VERSION in cache key handles invalidation when prompts change
    await env.MENUS_CACHE.put(cacheKey, JSON.stringify({
      ...result,
      _cachedAt: new Date().toISOString()
    }));
  } catch {
    // Cache write failure is non-fatal
  }
}

// --- Tiered LLM allergen analysis: OpenAI → Grok → Cloudflare ---
// LATENCY OPTIMIZATION: Race OpenAI + Cloudflare in parallel, use first success
async function runAllergenTieredLLM(env, input) {
  // Check cache first
  const cacheKey = buildAllergenCacheKey(input);
  const cached = await getAllergenLLMCached(env, cacheKey);
  if (cached && cached.ok && cached.data) {
    return { ...cached, cached: true };
  }

  // Build the shared system prompt
  const systemPrompt = buildAllergenSystemPrompt();

  // LATENCY OPTIMIZATION: Race OpenAI and Cloudflare AI in parallel
  // Use whichever responds successfully first
  const racingProviders = [];

  if (env.OPENAI_API_KEY) {
    racingProviders.push(
      (async () => {
        const result = await runAllergenMiniLLM(env, input);
        if (result.ok) {
          result.tier = 1;
          result.provider = "openai";
          return result;
        }
        throw new Error(result.error || "openai_failed");
      })()
    );
  }

  if (env.AI) {
    racingProviders.push(
      (async () => {
        const result = await runAllergenCloudflareLLM(env, input, systemPrompt);
        if (result.ok) {
          result.tier = 3;
          result.provider = "cloudflare";
          return result;
        }
        throw new Error(result.error || "cloudflare_failed");
      })()
    );
  }

  let result = null;

  if (racingProviders.length > 0) {
    try {
      // Promise.any returns the first successful result
      result = await Promise.any(racingProviders);
    } catch (aggregateError) {
      // All racing providers failed, log but continue to Grok fallback
      console.warn("All racing allergen LLMs failed:", aggregateError.errors?.map(e => e.message));
    }
  }

  // Fallback to Grok if racing failed
  if (!result) {
    const grokKey = (env.GROK_API_KEY || env.XAI_API_KEY || "").trim();
    if (grokKey) {
      const grokResult = await runAllergenGrokLLM(env, input, systemPrompt);
      if (grokResult.ok) {
        grokResult.tier = 2;
        result = grokResult;
      } else {
        console.warn("Grok allergen LLM failed:", grokResult.error);
      }
    }
  }

  // Cache successful result (non-blocking)
  if (result && result.ok) {
    putAllergenLLMCached(env, cacheKey, result);
    return result;
  }

  // All tiers failed - this should never happen in production
  return {
    ok: false,
    error: "all-allergen-llm-tiers-failed",
    details: "OpenAI, Cloudflare AI, and Grok all failed to analyze allergens"
  };
}

// Extract the allergen system prompt for reuse across providers
function buildAllergenSystemPrompt() {
  return `
You are an expert allergen, FODMAP, and lactose analyst for restaurant dishes.
You analyze ONE dish at a time using ONLY the provided input (no external knowledge).
Return exactly ONE JSON object in the required shape, with no extra text.

INPUT:
- dishName, restaurantName, menuSection, menuDescription.
- ingredients: structured list of parsed ingredients (multi-language possible).
- tags: labels like "gluten-free", "vegan", "vegetarian", "lactose-free", "sin gluten", etc.
- plate_components (optional):
  - Each component: role ("main" | "side" | "unknown"), label, category ("sandwich", "burger", "pasta", "fried_potatoes", "salad", "other"),
    confidence (0–1), area_ratio (0–1).
  - Use this to understand mains vs sides, and mention when risk comes from a side vs the main.

YOUR TASKS:
1. Decide presence of allergens:
   - gluten, milk, egg, soy, peanut, tree_nut, fish, shellfish, sesame.
   For each: "present": "yes" | "no" | "maybe" + short concrete reason.
2. Estimate lactose level:
   - "none" | "trace" | "low" | "medium" | "high" with a short reason.
3. Estimate overall FODMAP level for the dish:
   - "low" | "medium" | "high" with a short reason.
4. Set extra flags:
   - pork, beef, alcohol, spicy (each: "yes" | "no" | "maybe" with reason).
5. Emit lifestyle_tags and lifestyle_checks for red meat, vegetarian/vegan.
6. Emit component_allergens describing key components on the plate using the SAME allergen/lactose/FODMAP structure as the global ones.

STRICTNESS RULES (IMPORTANT):
- DO NOT invent ingredients that are not clearly implied or typical by name/description.
- Only set "present": "yes" when:
  - An allergen is explicitly mentioned in dishName, menuDescription, ingredients, or tags,
  - OR when it is overwhelmingly implied (e.g. "shrimp tacos" → shellfish).
- When a recipe often contains an allergen but the text does not mention it:
  - Use "present": "maybe" with a clear explanation (e.g. "Meatballs often use egg as a binder, but egg is not listed here.").
- If the text gives no indication for an allergen and no tags imply it:
  - Prefer "present": "no" and mention that it is not listed or implied.

MULTI-LANGUAGE AWARENESS:
- Recognize common food words in Spanish, Italian, French, Portuguese, etc.
  - "queso", "nata", "crema", "leche" → dairy (milk).
  - "pan", "brioche", "baguette", "pasta" → usually gluten unless clearly gluten-free.
  - "mariscos", "gambas", "camarón", "langostino" → shellfish.
  - "huevos", "oeufs", "uova" → eggs.
  - "pescado", "poisson", "pesce" → fish.
- Use tags such as "vegan", "vegetarian", "gluten-free", "lactose-free", "sin gluten", "sin lactosa" to refine decisions.
  - Vegan: no meat, fish, shellfish, dairy, eggs.
  - Vegetarian: no meat/fish/shellfish but dairy/eggs allowed.

GLUTEN RULES (SUMMARY):
- If ingredients include wheat, flour, bread, bun, brioche, baguette, pasta, noodles (any language) and not explicitly gluten-free:
  → gluten.present = "yes".
- If dish or tags include clear gluten-free indicators and NO explicit wheat/flour:
  → gluten.present = "no" with explanation.
- If a component is ambiguous (e.g. just "bun") and there is no gluten-free tag:
  → gluten.present = "maybe" with a reason like "Bun usually contains wheat; menu does not clarify."

MILK & LACTOSE RULES (SUMMARY):
- Dairy words (milk, cream, butter, cheese, queso, yogurt, nata, crema, leche, etc.) imply milk allergen = "yes".
- Lactose level:
  - High: fresh milk, cream, fresh cheeses, ice cream, sweetened dairy sauces.
  - Medium: butter, soft cheeses, yogurt (unless explicitly lactose-free).
  - Low/Trace: aged hard cheeses.
  - None: plant milks or explicit lactose-free products.

FODMAP RULES (SUMMARY):
- Common high-FODMAP: wheat bread/pasta, garlic, onions, honey, some fruits (apples, pears, mango), many beans, certain sweeteners.
- "high": multiple strong high-FODMAP ingredients (e.g. garlic + onion + wheat bun).
- "medium": some high-FODMAP components but balanced with low-FODMAP ingredients.
- "low": mostly low-FODMAP foods (meat, fish, eggs, rice, potatoes, many vegetables) with no obvious strong triggers.

ALLERGEN CLASSIFICATION (CRITICAL - DO NOT CONFUSE):
- TREE NUTS: almonds, cashews, walnuts, pecans, pistachios, hazelnuts, macadamia, brazil nuts, pine nuts.
- SESAME: sesame seeds, tahini, sesame oil. SESAME IS NOT A TREE NUT - it is a SEPARATE allergen category.
- PEANUTS: peanuts, peanut butter. PEANUTS ARE LEGUMES, NOT TREE NUTS.
- Never classify sesame as tree_nut. Never classify peanuts as tree_nut. These are medically distinct categories.

OUTPUT FORMAT:
Return exactly ONE JSON object with this shape:

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
      "allergens": { ... same structure ... },
      "lactose": { "level": string, "reason": string },
      "fodmap": { "level": string, "reason": string }
    }
  ],
  "meta": {
    "confidence": number,
    "notes": string
  }
}

${EVIDENCE_GUIDELINES}
`;
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
- dishName, restaurantName,
- nutrition_summary per serving:
  - energyKcal,
  - protein_g, fat_g, carbs_g, sugar_g, fiber_g,
  - sodium_mg.
Optionally you may also receive simple tags (e.g. "high_protein", "low_carb"), but you do not need them to work.

Tasks:
1. Classify each of these for ONE MEAL as "low", "medium", or "high":
   - calories, protein, carbs, sugar, fiber, fat, sodium.
   Use reasonable ranges; you do NOT need to output the thresholds.
2. Produce:
   - summary: 1–2 sentences in plain language about the overall nutrition profile.
   - highlights: 2–5 short positive or neutral points (e.g. "Good protein", "Moderate calories").
   - cautions: 1–3 short points about things to watch (e.g. "High sodium", "Very high calories").

OUTPUT FORMAT:
Return exactly ONE JSON object with this shape:

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
}`;

  const body = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(input) }
    ]
  };

  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    8000 // 8s timeout for nutrition LLM
  );

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

// LATENCY OPTIMIZATION: Cache portion vision results
// Same image = same visual analysis (permanent knowledge)
function buildPortionVisionCacheKey(imageUrl) {
  return `portion-vision:${hashShort(imageUrl)}`;
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

  // Check cache first (same image = same visual analysis)
  const cacheKey = buildPortionVisionCacheKey(imageUrl);
  if (env?.MENUS_CACHE) {
    try {
      const cached = await env.MENUS_CACHE.get(cacheKey, "json");
      if (cached && cached.ok && cached.insights) {
        return { ...cached, cached: true };
      }
    } catch {}
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

${getVisionCorrectionPromptAddendum()}

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

    const result = {
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

    // Cache successful result (permanent - same image = same visual analysis)
    if (env?.MENUS_CACHE) {
      try {
        await env.MENUS_CACHE.put(cacheKey, JSON.stringify({
          ...result,
          _cachedAt: new Date().toISOString()
        }));
      } catch {}
    }

    return result;
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

/**
 * Score an Edamam recipe result against the requested dish name.
 * Higher score = better match. Used to pick the best result from multiple hits.
 */
function scoreEdamamRecipe(recipe, dishName) {
  if (!recipe || !dishName) return 0;

  const label = String(recipe.label || "").toLowerCase();
  const dish = String(dishName).toLowerCase();
  const dishWords = dish.split(/\s+/).filter(w => w.length > 2);

  let score = 0;

  // 1. Word overlap score: +10 per matching word
  for (const word of dishWords) {
    if (label.includes(word)) score += 10;
  }

  // 2. Exact/close label match bonus: +50 if label contains core dish name
  const coreNameMatch = dishWords.slice(0, 3).join(" ");
  if (label.includes(coreNameMatch)) score += 50;

  // 3. Yield sanity check: penalize unreasonable yields
  // Typical main dishes: 1-8 servings. Cookies/snacks often 12-48.
  const yield_ = typeof recipe.yield === "number" ? recipe.yield : 4;
  if (yield_ > 12) score -= 30;  // Likely a batch recipe (cookies, etc.)
  if (yield_ > 24) score -= 30;  // Very likely wrong category

  // 4. Mismatch penalty: if label contains food types NOT in dish name
  const foodTypeKeywords = [
    "cookie", "cookies", "cake", "cupcake", "muffin", "brownie", "bar", "bars",
    "soup", "stew", "salad", "smoothie", "drink", "cocktail", "ice cream"
  ];
  for (const keyword of foodTypeKeywords) {
    // Penalize if label has this food type but dish name doesn't
    if (label.includes(keyword) && !dish.includes(keyword)) {
      score -= 40;
    }
  }

  // 5. mealType alignment bonus
  const mealTypes = Array.isArray(recipe.mealType) ? recipe.mealType : [];
  const dishLower = dish.toLowerCase();
  // Breakfast dishes should match breakfast mealType
  if (/pancake|waffle|omelet|breakfast|eggs?\b|bacon|toast/.test(dishLower)) {
    if (mealTypes.includes("breakfast")) score += 20;
  }
  // Lunch/dinner alignment
  if (/burger|steak|pasta|curry|rice|chicken|salmon|pork/.test(dishLower)) {
    if (mealTypes.some(m => m.includes("lunch") || m.includes("dinner"))) score += 15;
  }

  // 6. CUISINE MISMATCH PENALTY: Penalize if recipe cuisine doesn't match dish cuisine
  // This prevents "Tiramisu" from matching "Thai Sweet Potato Dessert"
  const cuisineLabels = Array.isArray(recipe.cuisineType) ? recipe.cuisineType.map(c => c.toLowerCase()) : [];

  const cuisineMap = {
    italian: ["tiramisu", "pasta", "risotto", "pizza", "lasagna", "alfredo", "parmigiana", "gnocchi", "ravioli", "carbonara", "bolognese", "pesto", "caprese", "prosciutto", "bruschetta", "cannoli", "panna cotta", "gelato"],
    thai: ["pad thai", "tom yum", "green curry", "red curry", "massaman", "panang", "papaya salad", "sticky rice", "khao", "pad see ew", "larb", "satay"],
    mexican: ["taco", "burrito", "enchilada", "quesadilla", "guacamole", "salsa", "fajita", "tamale", "mole", "pozole", "carnitas", "al pastor", "ceviche"],
    japanese: ["sushi", "sashimi", "ramen", "udon", "tempura", "teriyaki", "miso", "edamame", "gyoza", "katsu", "yakitori", "okonomiyaki"],
    indian: ["curry", "tikka", "masala", "biryani", "samosa", "naan", "dal", "paneer", "tandoori", "korma", "vindaloo", "butter chicken", "murgh makhani"],
    french: ["croissant", "baguette", "crepe", "souffle", "quiche", "ratatouille", "bouillabaisse", "coq au vin", "escargot", "moules", "frites", "bisque", "bearnaise", "bechamel"],
    chinese: ["kung pao", "lo mein", "chow mein", "fried rice", "dim sum", "dumpling", "wonton", "mapo tofu", "peking duck", "sweet and sour", "general tso", "orange chicken"],
    vietnamese: ["pho", "banh mi", "spring roll", "bun", "vermicelli", "nuoc mam"],
    korean: ["bibimbap", "bulgogi", "kimchi", "japchae", "gochujang", "korean bbq", "tteokbokki"],
    spanish: ["paella", "tapas", "gazpacho", "churros", "tortilla espanola", "gambas", "jamon"],
    portuguese: ["bacalhau", "pastel de nata", "caldo verde", "piri piri"],
    mediterranean: ["falafel", "hummus", "shawarma", "kebab", "tabbouleh", "baba ganoush", "gyro", "souvlaki"]
  };

  // Detect dish cuisine from keywords
  let detectedCuisine = null;
  for (const [cuisine, keywords] of Object.entries(cuisineMap)) {
    if (keywords.some(kw => dish.includes(kw))) {
      detectedCuisine = cuisine;
      break;
    }
  }

  // If we detected a cuisine, penalize recipes from wrong cuisines
  if (detectedCuisine && cuisineLabels.length > 0) {
    const cuisineMatches = cuisineLabels.some(c => c.includes(detectedCuisine) || detectedCuisine.includes(c));
    if (!cuisineMatches) {
      // Heavy penalty for cuisine mismatch
      score -= 100;
    } else {
      // Bonus for cuisine match
      score += 30;
    }
  }

  // 7. KEY INGREDIENT SANITY CHECK: Penalize if expected key ingredients are missing
  const ingredients = Array.isArray(recipe.ingredientLines) ? recipe.ingredientLines.join(" ").toLowerCase() : "";

  // Classic dishes with required ingredients
  const requiredIngredients = {
    tiramisu: ["mascarpone", "ladyfinger", "espresso", "coffee", "cocoa"],
    "lobster bisque": ["cream", "butter", "lobster"],
    "butter chicken": ["cream", "butter", "chicken", "tomato"],
    "chicken alfredo": ["cream", "parmesan", "butter", "pasta", "fettuccine"],
    croissant: ["butter", "flour"],
    "mango sticky rice": ["mango", "coconut", "sticky rice", "glutinous rice"],
    "margherita pizza": ["mozzarella", "tomato", "basil", "flour", "dough"],
    "pizza": ["flour", "dough", "mozzarella", "tomato"],
    "burrito": ["tortilla", "beans", "rice"],
    "super burrito": ["tortilla", "beans", "rice", "guacamole", "sour cream"]
  };

  for (const [dishKey, required] of Object.entries(requiredIngredients)) {
    if (dish.includes(dishKey)) {
      const matches = required.filter(ing => ingredients.includes(ing));
      if (matches.length < Math.ceil(required.length / 2)) {
        // Missing too many key ingredients - likely wrong recipe
        score -= 80;
      } else if (matches.length >= required.length - 1) {
        // Has most key ingredients - bonus
        score += 25;
      }
    }
  }

  // 8. FORBIDDEN INGREDIENTS CHECK: Penalize keto/low-carb variants and protein mismatches
  const forbiddenIngredients = {
    "margherita pizza": ["almond flour", "cauliflower", "fathead", "keto"],
    "pizza": ["almond flour", "cauliflower", "fathead", "keto"],
    "croissant": ["almond flour", "coconut flour", "keto"],
    "pasta": ["zucchini noodle", "shirataki", "konjac", "cauliflower"],
    "bread": ["almond flour", "coconut flour", "keto", "cloud bread"],
    "tiramisu": ["sweet potato", "yam", "coconut cream"],
    "super burrito": ["fish", "fish stick", "salmon", "tuna", "shrimp", "cod", "tilapia", "seafood"],
    "burrito": ["fish stick", "fish fillet"],
    "carne asada": ["fish", "shrimp", "salmon", "seafood"],
    "carnitas": ["fish", "shrimp", "salmon", "seafood"],
    "al pastor": ["fish", "shrimp", "salmon", "seafood"]
  };

  for (const [dishKey, forbidden] of Object.entries(forbiddenIngredients)) {
    if (dish.includes(dishKey)) {
      const hasForbidden = forbidden.some(f => ingredients.includes(f));
      if (hasForbidden) {
        // Heavy penalty for keto/variant recipes when user asked for traditional dish
        score -= 150;
      }
    }
  }

  // 9. HEALTH LABEL PROTEIN MISMATCH CHECK
  const healthLabels = Array.isArray(recipe.healthLabels)
    ? recipe.healthLabels.map(h => h.toLowerCase())
    : [];

  // Dishes that expect meat (beef, pork, chicken) - should NOT be Pescatarian
  const meatDishKeywords = [
    "burrito", "taco", "enchilada", "quesadilla", "fajita", "carnitas", "al pastor", "carne asada",
    "burger", "steak", "beef", "pork", "chicken", "lamb", "bacon", "sausage", "ham",
    "meatball", "bolognese", "lasagna", "gyro", "kebab", "shawarma",
    "pulled pork", "ribs", "brisket", "roast", "chop"
  ];

  const dishExpectsMeat = meatDishKeywords.some(kw => dish.includes(kw));

  // Pescatarian = has fish but no meat. If dish expects meat, this is wrong recipe
  if (dishExpectsMeat && healthLabels.includes("pescatarian")) {
    score -= 200;
  }

  // Red-Meat-Free check for beef dishes specifically
  const beefDishKeywords = ["steak", "beef", "burger", "brisket", "carne asada"];
  const dishExpectsBeef = beefDishKeywords.some(kw => dish.includes(kw));
  if (dishExpectsBeef && healthLabels.includes("red-meat-free")) {
    score -= 200;
  }

  // Pork-Free check for pork dishes
  const porkDishKeywords = ["carnitas", "pulled pork", "bacon", "ham", "pork", "al pastor"];
  const dishExpectsPork = porkDishKeywords.some(kw => dish.includes(kw));
  if (dishExpectsPork && healthLabels.includes("pork-free")) {
    score -= 200;
  }

  // Vegetarian recipe should not match meat dishes
  if (dishExpectsMeat && healthLabels.includes("vegetarian")) {
    score -= 250;
  }

  // Vegan recipe should not match dishes with dairy/eggs/meat
  const dairyDishKeywords = ["cheese", "cream", "alfredo", "mac and cheese", "queso"];
  const dishExpectsDairy = dairyDishKeywords.some(kw => dish.includes(kw));
  if ((dishExpectsMeat || dishExpectsDairy) && healthLabels.includes("vegan")) {
    score -= 250;
  }

  return score;
}

async function fetchFromEdamam(env, dish, cuisine = "", lang = "en") {
  await recordMetric(env, "provider:edamam:hit");
  try {
    const res = await callEdamam(env, dish, cuisine, lang);
    const items = Array.isArray(res?.items) ? res.items : [];
    if (!items.length) {
      const reason = res?.error || res?.note || "no_edamam_hits";
      return { ingredients: [], provider: "edamam", reason, _skip: "edamam" };
    }

    // Score and select the best matching recipe (not just first result)
    let best = items[0];
    let bestScore = scoreEdamamRecipe(items[0], dish);
    for (let i = 1; i < Math.min(items.length, 10); i++) {
      const score = scoreEdamamRecipe(items[i], dish);
      if (score > bestScore) {
        best = items[i];
        bestScore = score;
      }
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

// LATENCY OPTIMIZATION: Cache Zestful parsing results
// Ingredient parsing is deterministic - same inputs always give same outputs
function buildZestfulCacheKey(lines) {
  const sorted = [...lines].map(l => (l || "").toLowerCase().trim()).sort();
  return `zestful:${PIPELINE_VERSION}:${hashShort(sorted.join("|"))}`;
}

async function getZestfulCached(env, cacheKey) {
  if (!env?.MENUS_CACHE) return null;
  try {
    return await env.MENUS_CACHE.get(cacheKey, "json");
  } catch {
    return null;
  }
}

async function putZestfulCached(env, cacheKey, data) {
  if (!env?.MENUS_CACHE || !data) return;
  try {
    // No TTL - parsing results are permanent knowledge
    await env.MENUS_CACHE.put(cacheKey, JSON.stringify(data));
  } catch {}
}

async function callZestful(env, lines = []) {
  if (!lines?.length) return null;

  // Check cache first
  const cacheKey = buildZestfulCacheKey(lines);
  const cached = await getZestfulCached(env, cacheKey);
  if (cached) return cached;

  const host = (env.ZESTFUL_RAPID_HOST || "zestful.p.rapidapi.com").trim();
  const url = `https://${host}/parseIngredients`;

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RapidAPI-Key": env.ZESTFUL_RAPID_KEY,
          "X-RapidAPI-Host": host
        },
        body: JSON.stringify({ ingredients: lines })
      },
      4000 // 4s timeout for Zestful
    );

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

    if (parsed.length) {
      // Cache successful result (non-blocking)
      putZestfulCached(env, cacheKey, parsed);
      return parsed;
    }
    return null;
  } catch (err) {
    console.log("Zestful fail:", err?.message || String(err));
    return null;
  }
}

// --- Open Food Facts fallback ---
// LATENCY OPTIMIZATION: Cache OFF results - nutrition data is permanent knowledge
async function getOFFCached(env, name) {
  if (!env?.MENUS_CACHE || !name) return null;
  const key = `off:${PIPELINE_VERSION}:${name.toLowerCase().trim()}`;
  try {
    return await env.MENUS_CACHE.get(key, "json");
  } catch {
    return null;
  }
}

async function putOFFCached(env, name, data) {
  if (!env?.MENUS_CACHE || !name) return;
  const key = `off:${PIPELINE_VERSION}:${name.toLowerCase().trim()}`;
  try {
    await env.MENUS_CACHE.put(key, JSON.stringify(data));
  } catch {}
}

async function callOFF(env, name) {
  // Check cache first
  const cached = await getOFFCached(env, name);
  if (cached) return cached;

  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(name)}&search_simple=1&action=process&json=1&page_size=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "TummyBuddyApp/1.0" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const p = data?.products?.[0];
    if (!p) return null;

    const result = {
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

    // Cache result (non-blocking)
    putOFFCached(env, name, result);
    return result;
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
// LATENCY OPTIMIZATION: Cache USDA FDC results - nutrition data is permanent knowledge
async function getUSDAFDCCached(env, name) {
  if (!env?.MENUS_CACHE || !name) return null;
  const key = `usda-fdc:${PIPELINE_VERSION}:${name.toLowerCase().trim()}`;
  try {
    return await env.MENUS_CACHE.get(key, "json");
  } catch {
    return null;
  }
}

async function putUSDAFDCCached(env, name, data) {
  if (!env?.MENUS_CACHE || !name) return;
  const key = `usda-fdc:${PIPELINE_VERSION}:${name.toLowerCase().trim()}`;
  try {
    await env.MENUS_CACHE.put(key, JSON.stringify(data));
  } catch {}
}

async function callUSDAFDC(env, name) {
  const host = env.USDA_FDC_HOST || "api.nal.usda.gov";
  const key = env.USDA_FDC_API_KEY;
  if (!key || !name) return null;

  // Check cache first
  const cached = await getUSDAFDCCached(env, name);
  if (cached) return cached;

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

  // LATENCY OPTIMIZATION: Fetch all food details in parallel
  const detailResults = await Promise.all(
    foods.map(async (food) => {
      try {
        const detail = await fetch(
          `https://${host}/fdc/v1/food/${food.fdcId}?api_key=${key}`,
          { headers: { accept: "application/json" } }
        );
        if (!detail.ok) return null;
        return await detail.json();
      } catch {
        return null;
      }
    })
  );

  let bestMatchEvenIfProcessed = null;
  let bestWithMacros = null;
  let firstPayload = null;

  // Process results in sorted order (same logic as before)
  for (const full of detailResults) {
    if (!full) continue;
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
      // Cache and return
      putUSDAFDCCached(env, name, payload);
      return payload;
    }
  }

  let result = null;
  if (bestMatchEvenIfProcessed) {
    result = bestMatchEvenIfProcessed;
  } else if (bestWithMacros) {
    result = bestWithMacros;
  } else if (firstPayload) {
    result = firstPayload;
  } else {
    const best = foods[0];
    if (best) {
      result = {
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
  }

  // Cache successful result (non-blocking)
  if (result) {
    putUSDAFDCCached(env, name, result);
  }
  return result;
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

async function r2ReadJSON(env, key) {
  if (!env?.R2_BUCKET || !key) return null;
  try {
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) return null;
    return await obj.json();
  } catch {
    return null;
  }
}

// Helper: Get full meal analysis from R2
async function getMealFullAnalysis(env, r2Key) {
  if (!r2Key) return null;
  return await r2ReadJSON(env, r2Key);
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

  // LATENCY OPTIMIZATION: Run primary providers (edamam, spoonacular) in parallel
  // OpenAI is kept as final fallback since it's typically slower
  async function resolveFromProviders() {
    let selected = null;
    let candidateOut = null;
    let lastAttempt = null;
    const providerList = Array.isArray(providersOverride)
      ? providersOverride
      : providerOrder(env);

    // Separate primary providers from OpenAI fallback
    const primaryProviders = providerList.filter(p => p !== 'openai' && recipeProviderFns[p]);
    const hasOpenAIFallback = providerList.includes('openai') && recipeProviderFns.openai;

    if (primaryProviders.length > 0) {
      // Run primary providers in parallel
      const results = await Promise.allSettled(
        primaryProviders.map(async (p) => {
          try {
            const result = await recipeProviderFns[p](env, dish, cuisine, lang);
            return { provider: p, result };
          } catch (err) {
            console.warn(`[provider:${p}]`, err?.message || err);
            return { provider: p, result: null, error: err };
          }
        })
      );

      // Find first successful result in order of preference (maintains configured priority)
      for (const p of primaryProviders) {
        const settledResult = results.find(r =>
          r.status === 'fulfilled' && r.value.provider === p
        );
        if (settledResult?.value?.result) {
          const candidate = settledResult.value.result;
          lastAttempt = candidate;
          if (Array.isArray(candidate.ingredients) && candidate.ingredients.length) {
            candidateOut = candidate;
            selected = candidate.provider || p;
            break;
          }
        }
      }
    }

    // OpenAI fallback only if no primary provider succeeded
    if (!candidateOut && hasOpenAIFallback) {
      try {
        const candidate = await recipeProviderFns.openai(env, dish, cuisine, lang);
        if (candidate) {
          lastAttempt = candidate;
          if (Array.isArray(candidate.ingredients) && candidate.ingredients.length) {
            candidateOut = candidate;
            selected = candidate.provider || 'openai';
          }
        }
      } catch (err) {
        console.warn('[provider:openai]', err?.message || err);
      }
    }

    if (!candidateOut && lastAttempt) {
      candidateOut = lastAttempt;
      if (!selected) selected = lastAttempt.provider || null;
    }
    return { candidateOut, selected };
  }

  // LATENCY OPTIMIZATION: Run cache read and provider fetch in parallel
  // On cache miss, we save the cache lookup latency (~50-200ms)
  // On cache hit, we use cached result (provider call is discarded)
  let cached = null;
  let providerResultPromise = null;

  if (force) {
    // Force reanalyze: skip cache entirely
    const { candidateOut, selected } = await resolveFromProviders();
    out = candidateOut;
    selectedProvider = selected;
  } else {
    // Start both cache read and provider call in parallel
    const cachePromise = recipeCacheRead(env, cacheKey).catch(() => null);
    providerResultPromise = resolveFromProviders();

    cached = await cachePromise;

    if (cached && cached.recipe && Array.isArray(cached.ingredients)) {
      // Check for diet title mismatch before accepting cache
      const cachedTitle = (cached.recipe.title || cached.recipe.name || "");
      const dishLower = dish.toLowerCase();
      const isDietMismatch = cachedTitle && isDietTitle(cachedTitle) && !isDietTitle(dishLower);

      if (!isDietMismatch) {
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
        // Diet title mismatch - use provider result
        notes = { ...(notes || {}), skipped_cached_diet: cachedTitle };
        pickedSource = "cache_skip_diet";
        const { candidateOut, selected } = await providerResultPromise;
        out = candidateOut;
        selectedProvider = selected;
      }
    } else {
      // Cache miss - use provider result (already running in parallel)
      const { candidateOut, selected } = await providerResultPromise;
      out = candidateOut;
      selectedProvider = selected;
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

  // LATENCY OPTIMIZATION: Batch KV lookups in parallel instead of sequential
  if (wantParse && ingLines.length && env.ZESTFUL_RAPID_KEY) {
    const cachedParsed = [];
    const missingIdx = [];
    if (kv) {
      // Parallel KV reads instead of sequential loop
      const kvPromises = ingLines.map((line, i) => {
        const k = `zestful:${line.toLowerCase()}`;
        return kv.get(k, "json").then(row => ({ i, row })).catch(() => ({ i, row: null }));
      });
      const kvResults = await Promise.all(kvPromises);
      for (const { i, row } of kvResults) {
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
          // Parallel KV writes instead of sequential loop
          const putPromises = linesToParse.map((line, i) => {
            if (!zest[i]) return Promise.resolve();
            const k = `zestful:${line.toLowerCase()}`;
            return kv.put(k, JSON.stringify(zest[i]), { expirationTtl: 60 * 60 * 24 * 30 });
          });
          await Promise.all(putPromises);
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
        // Parallel filling and KV writes
        const putPromises = [];
        for (let j = 0; j < linesToParse.length; j++) {
          const i = missingIdx[j];
          filled[i] = zest[j];
          if (kv && zest[j]) {
            const k = `zestful:${ingLines[i].toLowerCase()}`;
            putPromises.push(kv.put(k, JSON.stringify(zest[j]), { expirationTtl: 60 * 60 * 24 * 30 }));
          }
        }
        if (putPromises.length) await Promise.all(putPromises);
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

        // LATENCY OPTIMIZATION: Parallelize compound lookups
        // Step 1: Gather all search terms with their ingredient context
        const searchTasks = [];
        for (const ing of ingredients) {
          const term = (ing?.name || "").toLowerCase().trim();
          if (!term) continue;
          const searchTerms = [term, ...(BRIDGE[term] || [])];
          for (const sTerm of searchTerms) {
            searchTasks.push({ sTerm, ingName: ing.name });
          }
        }

        // Step 2: Run all compound lookups in parallel
        const compoundResults = await Promise.all(
          searchTasks.map(async ({ sTerm, ingName }) => {
            try {
              const cRes = await env.D1_DB.prepare(
                `SELECT id, name, common_name, cid
                 FROM compounds
                 WHERE LOWER(name) = ? OR LOWER(common_name) = ?
                    OR LOWER(name) LIKE ? OR LOWER(common_name) LIKE ?
                 ORDER BY name LIMIT 5`
              )
                .bind(sTerm, sTerm, `%${sTerm}%`, `%${sTerm}%`)
                .all();
              return { comps: cRes?.results || [], ingName };
            } catch {
              return { comps: [], ingName };
            }
          })
        );

        // Step 3: Collect unique compounds needing organ effect lookup
        const uniqueCompounds = new Map(); // id -> { compound, ingName }
        for (const { comps, ingName } of compoundResults) {
          for (const c of comps) {
            const key = (c.name || "").toLowerCase();
            if (seenCompounds.has(key)) continue;
            seenCompounds.add(key);
            uniqueCompounds.set(c.id, { compound: c, ingName });
          }
        }

        // Step 4: Run all organ effect lookups in parallel
        const effectResults = await Promise.all(
          Array.from(uniqueCompounds.entries()).map(async ([compId, { compound, ingName }]) => {
            try {
              const eRes = await env.D1_DB.prepare(
                `SELECT organ, effect, strength, notes
                 FROM compound_organ_effects
                 WHERE compound_id = ?`
              )
                .bind(compId)
                .all();
              return { compound, ingName, effects: eRes?.results || [] };
            } catch {
              return { compound, ingName, effects: [] };
            }
          })
        );

        // Step 5: Build results from parallel lookups
        for (const { compound: c, ingName, effects } of effectResults) {
          foundCompounds.push({
            name: c.name,
            from_ingredient: ingName,
            cid: c.cid || null
          });
          for (const e of effects) {
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

      // LATENCY OPTIMIZATION: Parallelize compound lookups
      // Step 1: Gather all ingredient terms
      const searchTasks = [];
      for (const ing of ingredients) {
        const term = (ing?.name || "").toLowerCase().trim();
        if (!term) continue;
        searchTasks.push({ term, ingName: ing.name });
      }

      // Step 2: Run all compound lookups in parallel
      const compoundResults = await Promise.all(
        searchTasks.map(async ({ term, ingName }) => {
          try {
            const cRes = await env.D1_DB.prepare(
              `SELECT id, name, common_name, cid
               FROM compounds
               WHERE LOWER(name) LIKE ? OR LOWER(common_name) LIKE ?
               ORDER BY name LIMIT 5`
            )
              .bind(`%${term}%`, `%${term}%`)
              .all();
            return { comps: cRes?.results || [], ingName };
          } catch {
            return { comps: [], ingName };
          }
        })
      );

      // Step 3: Collect unique compounds needing organ effect lookup
      const uniqueCompounds = new Map(); // id -> { compound, ingName }
      for (const { comps, ingName } of compoundResults) {
        for (const c of comps) {
          if (!uniqueCompounds.has(c.id)) {
            uniqueCompounds.set(c.id, { compound: c, ingName });
          }
        }
      }

      // Step 4: Run all organ effect lookups in parallel
      const effectResults = await Promise.all(
        Array.from(uniqueCompounds.entries()).map(async ([compId, { compound, ingName }]) => {
          try {
            const eRes = await env.D1_DB.prepare(
              `SELECT organ, effect, strength, notes
               FROM compound_organ_effects
               WHERE compound_id = ?`
            )
              .bind(compId)
              .all();
            return { compound, ingName, effects: eRes?.results || [] };
          } catch {
            return { compound, ingName, effects: [] };
          }
        })
      );

      // Step 5: Build results from parallel lookups
      for (const { compound: c, ingName, effects } of effectResults) {
        foundCompounds.push({
          name: c.name,
          from_ingredient: ingName,
          cid: c.cid || null
        });
        for (const e of effects) {
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

// ========== Uber Eats (Apify) — Tier 1 Scraper ==========
// ========== Apify Async with Webhooks ==========
// Start an async Apify run and get notified via webhook when complete
async function startApifyRunAsync(env, query, address, maxRows = 250, locale = "en-US", jobId = null) {
  const token = env.APIFY_TOKEN;
  const actorId = env.APIFY_UBER_ACTOR_ID || "borderline~ubereats-scraper";

  if (!token) {
    throw new Error("Apify: Missing APIFY_TOKEN");
  }

  // Generate a unique job ID if not provided
  const apifyJobId = jobId || `apify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Build webhook URL - this worker will receive the callback
  const webhookUrl = `https://tb-dish-processor-production.tummybuddy.workers.dev/webhook/apify?jobId=${encodeURIComponent(apifyJobId)}`;

  // Ad-hoc webhook config (base64 encoded)
  const webhookConfig = [{
    eventTypes: ["ACTOR.RUN.SUCCEEDED"],
    requestUrl: webhookUrl,
    payloadTemplate: `{"jobId": "${apifyJobId}", "runId": "{{resource.id}}", "datasetId": "{{resource.defaultDatasetId}}", "status": "{{resource.status}}"}`
  }];
  const webhooksParam = btoa(JSON.stringify(webhookConfig));

  // Start async run (returns immediately with run info)
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(token)}&memory=4096&webhooks=${webhooksParam}`;

  const input = {
    query: String(query || ""),
    address: String(address),
    locale: String(locale || "en-US"),
    maxRows: Number(maxRows) || 15,
    proxy: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"]
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify async start failed: ${res.status} - ${text.slice(0, 200)}`);
  }

  const runInfo = await res.json();

  // Store job metadata in KV for tracking
  if (env.MENUS_CACHE) {
    await env.MENUS_CACHE.put(
      `apify-job:${apifyJobId}`,
      JSON.stringify({
        jobId: apifyJobId,
        runId: runInfo.data?.id,
        status: "running",
        query,
        address,
        maxRows,
        startedAt: new Date().toISOString()
      }),
      { expirationTtl: 3600 } // 1 hour TTL
    );
  }

  return {
    jobId: apifyJobId,
    runId: runInfo.data?.id,
    status: "running",
    pollUrl: `/api/apify-job/${apifyJobId}`
  };
}

// Fetch dataset items from a completed Apify run
async function fetchApifyDataset(env, datasetId) {
  const token = env.APIFY_TOKEN;
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(token)}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" }
  });

  if (!res.ok) {
    throw new Error(`Apify dataset fetch failed: ${res.status}`);
  }

  return res.json();
}

// Synchronous Apify call (original - kept for fallback/testing)
async function fetchMenuFromApify(
  env,
  query,
  address = "Miami, FL, USA",
  maxRows = 250,
  locale = "en-US"
) {
  const token = env.APIFY_TOKEN;
  const actorId = env.APIFY_UBER_ACTOR_ID || "borderline~ubereats-scraper";

  if (!token) {
    throw new Error("Apify: Missing APIFY_TOKEN");
  }

  // Use synchronous endpoint with increased memory for faster response
  // memory=4096 gives 1 full CPU core, timeout=60s to fail fast
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&memory=4096&timeout=60`;

  const input = {
    query: String(query || ""),
    address: String(address),
    locale: String(locale || "en-US"),
    maxRows: Number(maxRows) || 15,
    proxy: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"]
    }
  };

  // Use AbortController for client-side timeout (15s) to fail fast to tier 2
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(input),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await res.text();

  if (res.status === 408) {
    throw new Error("Apify: Request timeout (exceeded 300s)");
  }
  if (res.status === 400) {
    throw new Error(`Apify: Bad request - ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`Apify ${res.status}: ${text.slice(0, 200)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Apify: Response was not valid JSON");
  }

  // Apify returns dataset items as an array directly
  // Normalize to match RapidAPI response structure for compatibility
  if (Array.isArray(data)) {
    return {
      data: {
        results: data
      },
      _source: "apify"
    };
  }

  // If already in expected format
  return { ...data, _source: "apify" };
}

// ========== Uber Eats Tiered Scraper — RapidAPI (Tier 1, faster) → Apify (Tier 2, fallback) ==========
async function fetchMenuFromUberEatsTiered(
  env,
  query,
  address = "Miami, FL, USA",
  maxRows = 250,
  lat = null,
  lng = null,
  radius = 5000
) {
  const rapidEnabled = !!env.RAPIDAPI_KEY;
  const apifyEnabled = !!env.APIFY_TOKEN;

  // Tier 1: RapidAPI (faster, ~9s typical response)
  if (rapidEnabled) {
    try {
      const result = await fetchMenuFromUberEats(
        env,
        query,
        address,
        maxRows,
        lat,
        lng,
        radius
      );
      result._tier = "rapidapi";
      return result;
    } catch (err) {
      const msg = String(err?.message || err);
      console.error(`[UberEats Tier1 RapidAPI] Failed: ${msg}`);
      if (!apifyEnabled) {
        throw err;
      }
    }
  }

  // Tier 2: Apify (fallback, slower but cleaner data)
  if (apifyEnabled) {
    try {
      const result = await fetchMenuFromApify(env, query, address, maxRows);
      result._tier = "apify";
      return result;
    } catch (err) {
      throw err;
    }
  }

  throw new Error("UberEats: No scraper tier available (missing RAPIDAPI_KEY and APIFY_TOKEN)");
}

// ========== Uber Eats Tiered Job by Address — Race Apify & RapidAPI ==========
// Returns same interface as postJobByAddress: { ok, immediate, raw, job_id?, _tier }
// Runs both scrapers in parallel and returns the first successful response
async function postJobByAddressTiered(
  { query, address, maxRows = 250, locale = "en-US", page = 1, webhook = null },
  env
) {
  const apifyEnabled = !!env.APIFY_TOKEN;
  const rapidEnabled = !!env.RAPIDAPI_KEY;

  if (!apifyEnabled && !rapidEnabled) {
    throw new Error("UberEats: No scraper available (missing APIFY_TOKEN and RAPIDAPI_KEY)");
  }

  // Build array of scraper promises
  const scrapers = [];

  if (rapidEnabled) {
    // RapidAPI - generally faster, add first
    scrapers.push(
      postJobByAddress({ query, address, maxRows, locale, page, webhook }, env)
        .then(result => ({ ...result, _tier: "rapidapi" }))
        .catch(err => {
          console.error(`[RapidAPI] Failed: ${err?.message || err}`);
          return null;
        })
    );
  }

  if (apifyEnabled) {
    // Apify - cleaner data but slower
    scrapers.push(
      fetchMenuFromApify(env, query, address, maxRows, locale)
        .then(apifyResult => {
          const results = apifyResult?.data?.results || apifyResult?.results || [];
          if (!results.length) return null; // Treat empty as failure
          return {
            ok: true,
            immediate: true,
            raw: { returnvalue: { data: results }, _source: "apify" },
            _tier: "apify"
          };
        })
        .catch(err => {
          console.error(`[Apify] Failed: ${err?.message || err}`);
          return null;
        })
    );
  }

  // Race: return first successful (non-null) result
  // Use Promise.any-like behavior: resolve on first success, reject if all fail
  return new Promise((resolve, reject) => {
    let completed = 0;
    let resolved = false;
    const total = scrapers.length;

    scrapers.forEach(promise => {
      promise.then(result => {
        completed++;
        if (!resolved && result !== null && result.ok) {
          resolved = true;
          resolve(result);
        } else if (completed === total && !resolved) {
          reject(new Error("UberEats: All scrapers failed"));
        }
      });
    });
  });
}

// ========== Uber Eats Tiered Job by Location (GPS) — Apify (Tier 1) → RapidAPI (Tier 2) ==========
// Returns same interface as postJobByLocation: { ok, data/results, _tier }
async function postJobByLocationTiered(
  { query, lat, lng, radius = 6000, maxRows = 250 },
  env
) {
  const tier1Enabled = !!env.APIFY_TOKEN;
  const tier2Enabled = !!env.RAPIDAPI_KEY;

  // Tier 1: Apify - use address from lat/lng (Apify doesn't support direct GPS)
  // We'll reverse-geocode or use a generic address format
  if (tier1Enabled && lat != null && lng != null) {
    try {
      // Apify doesn't support GPS directly, but we can try with coordinates as address
      const gpsAddress = `${lat},${lng}`;
      const apifyResult = await fetchMenuFromApify(env, query, gpsAddress, maxRows);
      const results = apifyResult?.data?.results || apifyResult?.results || [];
      return {
        ok: true,
        data: { results },
        results,
        _tier: "apify"
      };
    } catch (err) {
      const msg = String(err?.message || err);
      console.error(`[postJobByLocationTiered Tier1 Apify] Failed: ${msg}`);
      if (!tier2Enabled) {
        throw err;
      }
    }
  }

  // Tier 2: RapidAPI (fallback)
  if (tier2Enabled) {
    const result = await postJobByLocation(
      { query, lat, lng, radius, maxRows },
      env
    );
    result._tier = "rapidapi";
    return result;
  }

  throw new Error("UberEats: No scraper tier available (missing APIFY_TOKEN and RAPIDAPI_KEY)");
}

// ========== Uber Eats (RapidAPI) — Address + GPS job/search, retries & polling — TIER 2 ==========
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
      j?.returnvalue?.data || j?.data?.results || j?.results || j?.data?.data?.results || [];
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
    (Array.isArray(parsed?.returnvalue?.data) && parsed.returnvalue.data.length) ||
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
  { query, address, maxRows = 250, locale = "en-US", page = 1, webhook = null },
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
      maxRows: Number(maxRows) || 250,
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
      else if (title.startsWith(targetName)) score += 90;
      else if (title.includes(targetName)) score += 80;
      else if (targetName.includes(title) && title.length > 3) score += 70;
      else {
        // Word overlap scoring with key word matching
        const titleTokens = title.split(/\s+/);
        const targetTokens = targetName.split(/\s+/);
        const titleSet = new Set(titleTokens);
        let overlap = 0;
        let keyWordMatch = false;
        for (const t of targetTokens) {
          if (titleSet.has(t)) {
            overlap++;
            if (t.length > 4 && !['the', 'and', 'restaurant', 'cafe', 'bar', 'grill'].includes(t)) {
              keyWordMatch = true;
            }
          }
        }
        const ratio = overlap / Math.max(1, targetTokens.length);
        score = keyWordMatch ? Math.round(60 * ratio) : Math.round(25 * ratio);
      }
      return { s, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const bestScore = scored[0]?.score ?? 0;
    const MIN_MATCH_SCORE = 50;

    if (bestScore >= MIN_MATCH_SCORE) {
      const best = scored.filter((x) => x.score === bestScore).map((x) => x.s);
      stores = best.length ? best : stores;
    } else if (bestScore > 0) {
      console.warn(`[flattenUberPayloadToItemsGateway] Low match score ${bestScore} for "${targetName}"`);
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

  let job = await postJobByAddressTiered(
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
    maxRows = 250,
    locale = "en-US",
    page = 1
  },
  env
) {
  const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const key = env.RAPIDAPI_KEY || "";
  const body = {
    scraper: {
      maxRows: Number(maxRows) || 250,
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

    // GET /uploads/* - Serve uploaded images from R2
    if (pathname.startsWith("/uploads/") && request.method === "GET") {
      if (!env.R2_BUCKET) {
        return new Response("R2 not configured", { status: 503 });
      }
      const key = pathname.slice(1); // Remove leading slash: "uploads/..."
      const obj = await env.R2_BUCKET.get(key);
      if (!obj) {
        return new Response("Not found", { status: 404 });
      }
      const headers = new Headers();
      headers.set("Content-Type", obj.httpMetadata?.contentType || "image/jpeg");
      headers.set("Cache-Control", "public, max-age=31536000"); // 1 year cache
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(obj.body, { status: 200, headers });
    }

    // OPTIONS preflight for /api/upload-image (CORS)
    if (pathname === "/api/upload-image" && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // POST /api/upload-image - Upload image to R2 and return public URL
    if (pathname === "/api/upload-image" && request.method === "POST") {
      try {
        const body = (await readJson(request)) || {};
        const imageB64 = body.image || body.imageB64 || body.image_b64 || null;
        const mimeType = body.mimeType || body.mime_type || "image/jpeg";

        if (!imageB64) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "missing_image",
              hint: "Provide 'image' (base64) in the request body."
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json", ...CORS_ALL }
            }
          );
        }

        if (!env.R2_BUCKET) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "r2_not_configured",
              hint: "R2 storage is not configured."
            }),
            {
              status: 503,
              headers: { "Content-Type": "application/json", ...CORS_ALL }
            }
          );
        }

        // Strip data URL prefix if present
        let cleanBase64 = imageB64;
        if (imageB64.includes(",")) {
          cleanBase64 = imageB64.split(",")[1];
        }

        // Decode base64 to binary
        const binaryString = atob(cleanBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Generate unique key
        const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
        const timestamp = Date.now();
        const randomId = crypto.randomUUID().slice(0, 8);
        const key = `uploads/${timestamp}-${randomId}.${ext}`;

        // Upload to R2
        await env.R2_BUCKET.put(key, bytes.buffer, {
          httpMetadata: {
            contentType: mimeType
          }
        });

        // Build public URL - serve through this worker
        const workerHost = new URL(request.url).origin;
        const publicUrl = `${workerHost}/uploads/${timestamp}-${randomId}.${ext}`;

        return new Response(
          JSON.stringify({
            ok: true,
            url: publicUrl,
            key: key,
            size: bytes.length,
            mimeType: mimeType
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS_ALL }
          }
        );
      } catch (err) {
        console.error("upload-image error:", err);
        return new Response(
          JSON.stringify({
            ok: false,
            error: "upload_failed",
            details: err && err.message ? String(err.message) : String(err)
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS_ALL }
          }
        );
      }
    }

    // OPTIONS preflight for /api/analyze/image (CORS)
    if (pathname === "/api/analyze/image" && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // POST /api/analyze/image - Image recognition for food photos
    if (pathname === "/api/analyze/image" && request.method === "POST") {
      try {
        const body = (await readJson(request)) || {};
        const imageUrl = body.imageUrl || body.image_url || null;
        const imageB64 = body.imageB64 || body.image_b64 || null;

        // Validate input
        if (!imageUrl && !imageB64) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "missing_image",
              hint: "Provide imageUrl or imageB64 in the request body."
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json", ...CORS_ALL }
            }
          );
        }

        let fsResult;

        if (imageB64) {
          // Direct base64 image - call FatSecret API directly
          const token = await getFatSecretAccessToken(env);
          if (!token) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: "fatsecret_token_unavailable",
                hint: "FatSecret credentials are not configured."
              }),
              {
                status: 503,
                headers: { "Content-Type": "application/json", ...CORS_ALL }
              }
            );
          }

          const region = env.FATSECRET_REGION || "US";
          const language = env.FATSECRET_LANGUAGE || "en";

          const fsBody = {
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
                body: JSON.stringify(fsBody)
              }
            );
          } catch (e) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: "fatsecret_fetch_error",
                details: String(e && e.message ? e.message : e)
              }),
              {
                status: 502,
                headers: { "Content-Type": "application/json", ...CORS_ALL }
              }
            );
          }

          if (!resp.ok) {
            const errorText = await resp.text().catch(() => "");
            return new Response(
              JSON.stringify({
                ok: false,
                error: "fatsecret_http_error",
                status: resp.status,
                details: errorText.slice(0, 500)
              }),
              {
                status: 502,
                headers: { "Content-Type": "application/json", ...CORS_ALL }
              }
            );
          }

          let data;
          try {
            data = await resp.json();
          } catch (e) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: "fatsecret_json_error",
                details: String(e && e.message ? e.message : e)
              }),
              {
                status: 502,
                headers: { "Content-Type": "application/json", ...CORS_ALL }
              }
            );
          }

          fsResult = { ok: true, raw: data };
        } else {
          // Use existing image URL function
          fsResult = await callFatSecretImageRecognition(env, imageUrl);
        }

        if (!fsResult.ok) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: fsResult.error || "image_recognition_failed",
              hint: "Failed to analyze image. Please try again with a clearer photo."
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json", ...CORS_ALL }
            }
          );
        }

        // Normalize the FatSecret response
        const normalized = normalizeFatSecretImageResult(fsResult.raw);

        // Calculate total nutrition from components
        let totalNutrition = {
          energyKcal: 0,
          protein_g: 0,
          fat_g: 0,
          carbs_g: 0,
          sugar_g: 0,
          fiber_g: 0,
          sodium_mg: 0
        };

        if (Array.isArray(normalized.nutrition_breakdown)) {
          for (const comp of normalized.nutrition_breakdown) {
            totalNutrition.energyKcal += comp.energyKcal || 0;
            totalNutrition.protein_g += comp.protein_g || 0;
            totalNutrition.fat_g += comp.fat_g || 0;
            totalNutrition.carbs_g += comp.carbs_g || 0;
            totalNutrition.sugar_g += comp.sugar_g || 0;
            totalNutrition.fiber_g += comp.fiber_g || 0;
            totalNutrition.sodium_mg += comp.sodium_mg || 0;
          }
        }

        // Round values
        totalNutrition = {
          energyKcal: Math.round(totalNutrition.energyKcal),
          protein_g: Math.round(totalNutrition.protein_g * 10) / 10,
          fat_g: Math.round(totalNutrition.fat_g * 10) / 10,
          carbs_g: Math.round(totalNutrition.carbs_g * 10) / 10,
          sugar_g: Math.round(totalNutrition.sugar_g * 10) / 10,
          fiber_g: Math.round(totalNutrition.fiber_g * 10) / 10,
          sodium_mg: Math.round(totalNutrition.sodium_mg)
        };

        // Build response
        const result = {
          ok: true,
          source: "fatsecret_image_recognition",
          foods_detected: normalized.plate_components.length,
          plate_components: normalized.plate_components,
          nutrition_breakdown: normalized.nutrition_breakdown,
          nutrition_summary: totalNutrition,
          component_allergens: normalized.component_allergens || {}
        };

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_ALL }
        });
      } catch (err) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "analyze_image_exception",
            details: err && err.message ? String(err.message) : String(err)
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS_ALL }
          }
        );
      }
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

    // Lightweight endpoint for polling organs status (used with skip_organs flow)
    if (pathname === "/pipeline/organs-status" && request.method === "GET") {
      try {
        const pollKey = url.searchParams.get("key");
        if (!pollKey) {
          return okJson({ ok: false, error: "missing_key_param" }, 400);
        }

        if (!env?.MENUS_CACHE) {
          return okJson({ ok: false, error: "cache_unavailable" }, 500);
        }

        const cached = await env.MENUS_CACHE.get(pollKey, "json");
        if (cached && cached.ok && cached.data) {
          return okJson({
            ok: true,
            ready: true,
            organs: cached.data,
            timestamp: cached.timestamp
          });
        }

        // Not ready yet
        return okJson({
          ok: true,
          ready: false,
          message: "Organs analysis still processing"
        });
      } catch (err) {
        return okJson({
          ok: false,
          error: "organs_status_exception",
          details: String(err?.message || err)
        }, 500);
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

    // --- DEBUG: Apify Uber Eats scraper (Tier 1) ---
    if (pathname === "/debug/apify") {
      const token = env.APIFY_TOKEN || "";
      const actorId = env.APIFY_UBER_ACTOR_ID || "borderline~ubereats-scraper";

      const q = searchParams.get("query") || "pizza";
      const addr = searchParams.get("address") || "Miami, FL, USA";
      const max = Number(searchParams.get("maxRows") || 3);

      if (!token) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Missing APIFY_TOKEN secret",
            hint: "Run: wrangler secret put APIFY_TOKEN --env production"
          }, null, 2),
          { headers: { "content-type": "application/json" } }
        );
      }

      let status = 0, js = null, text = "";
      try {
        const result = await fetchMenuFromApify(env, q, addr, max);
        js = result;
        status = 200;
      } catch (e) {
        text = String(e?.message || e);
        status = 500;
      }

      return new Response(
        JSON.stringify({
          ok: status === 200,
          actor_id: actorId,
          has_token: !!token,
          query: q,
          address: addr,
          maxRows: max,
          status,
          result: js ?? null,
          error: text || null
        }, null, 2),
        { headers: { "content-type": "application/json" } }
      );
    }

    // --- DEBUG: Tiered scraper test (Apify → RapidAPI fallback) ---
    if (pathname === "/debug/uber-tiered") {
      const q = searchParams.get("query") || "pizza";
      const addr = searchParams.get("address") || "Miami, FL, USA";
      const max = Number(searchParams.get("maxRows") || 3);

      const hasApify = !!env.APIFY_TOKEN;
      const hasRapid = !!env.RAPIDAPI_KEY;

      let status = 0, js = null, text = "", tier = null;
      try {
        const result = await fetchMenuFromUberEatsTiered(env, q, addr, max);
        js = result;
        tier = result?._tier || "unknown";
        status = 200;
      } catch (e) {
        text = String(e?.message || e);
        status = 500;
      }

      return new Response(
        JSON.stringify({
          ok: status === 200,
          tiers: {
            tier1_apify: hasApify,
            tier2_rapidapi: hasRapid
          },
          used_tier: tier,
          query: q,
          address: addr,
          maxRows: max,
          status,
          result_preview: js ? {
            _tier: js._tier,
            _source: js._source,
            has_results: !!(js?.returnvalue?.data?.length || js?.data?.results?.length || js?.results?.length)
          } : null,
          error: text || null
        }, null, 2),
        { headers: { "content-type": "application/json" } }
      );
    }

    // ========== APIFY WEBHOOK RECEIVER ==========
    // Called by Apify when async run completes
    if (pathname === "/webhook/apify" && request.method === "POST") {
      try {
        const payload = await request.json();
        const jobId = searchParams.get("jobId") || payload.jobId;

        console.log(`[Apify Webhook] Received payload for jobId=${jobId}:`, JSON.stringify(payload).slice(0, 500));

        if (!jobId) {
          return new Response(JSON.stringify({ ok: false, error: "Missing jobId" }), {
            status: 400,
            headers: { "content-type": "application/json" }
          });
        }

        // Get existing job data from KV (contains real runId from when job was started)
        const existing = env.MENUS_CACHE ? await env.MENUS_CACHE.get(`apify-job:${jobId}`, "json") : null;
        console.log(`[Apify Webhook] Existing job data:`, JSON.stringify(existing || {}).slice(0, 300));

        // Extract run info - prefer stored runId (real ID), then try payload
        // 1. Stored runId from job start (most reliable)
        // 2. Apify default format: { resource: { id, defaultDatasetId, ... } }
        // 3. Our template (if interpolated): { jobId, runId, datasetId, status }
        let runId = existing?.runId; // First priority: stored real runId
        let datasetId = null;

        // Try to get from Apify's default webhook format (resource object)
        if (payload.resource) {
          if (!runId) runId = payload.resource.id;
          datasetId = payload.resource.defaultDatasetId;
        }

        // Fallback to template payload values if they're not placeholders
        if (!runId && payload.runId && !payload.runId.includes("{{")) {
          runId = payload.runId;
        }
        if (!datasetId && payload.datasetId && !payload.datasetId.includes("{{")) {
          datasetId = payload.datasetId;
        }

        console.log(`[Apify Webhook] Using runId=${runId}, datasetId=${datasetId}`);

        // If we still don't have datasetId but have runId, fetch run info from Apify
        if (!datasetId && runId && env.APIFY_TOKEN) {
          try {
            console.log(`[Apify Webhook] Fetching run info for runId=${runId}`);
            const runInfoRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${env.APIFY_TOKEN}`);
            if (runInfoRes.ok) {
              const runInfo = await runInfoRes.json();
              datasetId = runInfo.data?.defaultDatasetId;
              console.log(`[Apify Webhook] Got datasetId=${datasetId} from Apify API`);
            } else {
              console.error(`[Apify Webhook] Apify API returned ${runInfoRes.status}`);
            }
          } catch (e) {
            console.error(`[Apify Webhook] Failed to fetch run info: ${e.message}`);
          }
        }

        // Fetch the actual data from the dataset
        let data = [];
        if (datasetId) {
          try {
            data = await fetchApifyDataset(env, datasetId);
            console.log(`[Apify Webhook] Fetched ${data.length} items from dataset`);
          } catch (e) {
            console.error(`[Apify Webhook] Failed to fetch dataset: ${e.message}`);
          }
        } else {
          console.error(`[Apify Webhook] No datasetId available to fetch results`);
        }

        // Update job status in KV with results
        if (env.MENUS_CACHE) {
          await env.MENUS_CACHE.put(
            `apify-job:${jobId}`,
            JSON.stringify({
              ...(existing || {}),
              status: "completed",
              datasetId: datasetId,
              runId: runId, // Keep the real runId
              completedAt: new Date().toISOString(),
              resultCount: Array.isArray(data) ? data.length : 0,
              data: data // Store the actual results
            }),
            { expirationTtl: 3600 }
          );
        }

        // Return 200 to acknowledge webhook
        return new Response(JSON.stringify({ ok: true, jobId, received: true, datasetId, resultCount: data.length }), {
          headers: { "content-type": "application/json" }
        });
      } catch (e) {
        console.error(`Apify webhook error: ${e.message}`);
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });
      }
    }

    // ========== APIFY JOB STATUS / RESULTS ==========
    // GET /api/apify-job/:jobId - Check status and get results
    if (pathname.startsWith("/api/apify-job/")) {
      const jobId = pathname.replace("/api/apify-job/", "");

      if (!jobId) {
        return new Response(JSON.stringify({ ok: false, error: "Missing jobId" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }

      const job = await env.MENUS_CACHE?.get(`apify-job:${jobId}`, "json");

      if (!job) {
        return new Response(JSON.stringify({ ok: false, error: "Job not found", jobId }), {
          status: 404,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response(JSON.stringify({
        ok: true,
        ...job
      }, null, 2), {
        headers: { "content-type": "application/json" }
      });
    }

    // ========== DISH IMAGE LOOKUP ==========
    // GET /api/dish-image?dish=Chicken%20Alfredo - Fetch dish image from providers
    if (pathname === "/api/dish-image" && request.method === "GET") {
      const dish = searchParams.get("dish") || searchParams.get("dishName") || "";
      if (!dish.trim()) {
        return new Response(JSON.stringify({ ok: false, error: "Missing dish parameter" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }

      try {
        // Race Spoonacular and Edamam in parallel for speed
        const imagePromises = [];

        // Spoonacular
        if (env.SPOONACULAR_API_KEY || env.SPOONACULAR_KEY) {
          imagePromises.push(
            (async () => {
              try {
                const apiKey = (env.SPOONACULAR_API_KEY || env.SPOONACULAR_KEY || "").trim();
                const searchUrl = `https://api.spoonacular.com/recipes/complexSearch?query=${encodeURIComponent(dish)}&number=1&apiKey=${encodeURIComponent(apiKey)}`;
                const res = await fetch(searchUrl, { headers: { accept: "application/json" } });
                if (!res.ok) return null;
                const data = await res.json();
                const image = data?.results?.[0]?.image;
                return image ? { image, provider: "spoonacular" } : null;
              } catch { return null; }
            })()
          );
        }

        // Edamam
        if (env.EDAMAM_APP_ID && env.EDAMAM_APP_KEY) {
          imagePromises.push(
            (async () => {
              try {
                const appId = (env.EDAMAM_APP_ID || "").trim();
                const appKey = (env.EDAMAM_APP_KEY || "").trim();
                const url = `https://api.edamam.com/api/recipes/v2?type=public&q=${encodeURIComponent(dish)}&app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}`;
                const res = await fetch(url, { headers: { accept: "application/json" } });
                if (!res.ok) return null;
                const data = await res.json();
                const recipe = data?.hits?.[0]?.recipe;
                const image = recipe?.image || recipe?.images?.REGULAR?.url || recipe?.images?.SMALL?.url;
                return image ? { image, provider: "edamam" } : null;
              } catch { return null; }
            })()
          );
        }

        if (imagePromises.length === 0) {
          return new Response(JSON.stringify({ ok: false, error: "No image providers configured" }), {
            status: 503,
            headers: { "content-type": "application/json" }
          });
        }

        // Race - first successful result wins
        const results = await Promise.all(imagePromises);
        const winner = results.find(r => r && r.image);

        if (winner) {
          return new Response(JSON.stringify({
            ok: true,
            dish,
            image: winner.image,
            provider: winner.provider
          }), {
            headers: { "content-type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ ok: false, dish, error: "No image found" }), {
          status: 404,
          headers: { "content-type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });
      }
    }

    // ========== DISH AUTOCOMPLETE / SPELL SUGGEST ==========
    // GET /api/dish-suggest?q=chiken%20parm&limit=10 - Typo-tolerant dish search
    if (pathname === "/api/dish-suggest" && request.method === "GET") {
      const query = (searchParams.get("q") || searchParams.get("query") || "").trim();
      const limit = Math.min(Number(searchParams.get("limit") || 10), 50);
      const cuisine = searchParams.get("cuisine") || null;

      if (!query || query.length < 2) {
        return new Response(JSON.stringify({
          ok: true,
          query,
          suggestions: [],
          message: "Query too short (min 2 characters)"
        }), {
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      try {
        const suggestions = await searchDishSuggestions(env, query, { limit, cuisine });
        return new Response(JSON.stringify({
          ok: true,
          query,
          suggestions,
          count: suggestions.length
        }), {
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      } catch (e) {
        console.error("dish-suggest error:", e);
        return new Response(JSON.stringify({
          ok: false,
          error: e.message || "Search failed"
        }), {
          status: 500,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }
    }

    // ========== USER TRACKING API ENDPOINTS ==========

    // OPTIONS preflight for /api/profile/* (CORS)
    if (pathname.startsWith("/api/profile") && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // GET /api/profile - Get user profile
    if (pathname === "/api/profile" && request.method === "GET") {
      const userId = url.searchParams.get("user_id");
      if (!userId) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const profile = await getUserProfile(env, userId);
      const targets = await getUserTargets(env, userId);
      const allergens = await getUserAllergens(env, userId);
      const organs = await getUserOrganPriorities(env, userId);

      // Parse goals JSON string to array for frontend
      let profileWithParsedGoals = profile || {};
      if (profileWithParsedGoals.goals) {
        try {
          profileWithParsedGoals = {
            ...profileWithParsedGoals,
            goals: typeof profileWithParsedGoals.goals === 'string'
              ? JSON.parse(profileWithParsedGoals.goals)
              : profileWithParsedGoals.goals
          };
        } catch (e) {
          console.error('Failed to parse goals:', e);
          // Fall back to primary_goal as array
          profileWithParsedGoals.goals = [profileWithParsedGoals.primary_goal || 'maintain'];
        }
      }

      return new Response(JSON.stringify({
        ok: true,
        profile: profileWithParsedGoals,
        targets,
        allergens,
        organ_priorities: organs
      }, null, 2), {
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // PUT /api/profile - Update user profile
    if (pathname === "/api/profile" && request.method === "PUT") {
      const body = await readJsonSafe(request);
      const userId = body?.user_id || url.searchParams.get("user_id");

      if (!userId) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const result = await upsertUserProfile(env, userId, body);
      if (result.ok) {
        // Recalculate targets after profile update
        await calculateAndStoreTargets(env, userId);
        // Fetch updated profile and targets to return to frontend
        const updatedProfile = await getUserProfile(env, userId);
        const updatedTargets = await getUserTargets(env, userId);
        return new Response(JSON.stringify({
          ok: true,
          profile: updatedProfile,
          targets: updatedTargets
        }), {
          status: 200,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // POST /api/profile - Create user profile (alias for PUT)
    if (pathname === "/api/profile" && request.method === "POST") {
      const body = await readJsonSafe(request);
      const userId = body?.user_id || url.searchParams.get("user_id");

      if (!userId) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const result = await upsertUserProfile(env, userId, body);
      if (result.ok) {
        await calculateAndStoreTargets(env, userId);
        // Fetch updated profile and targets to return to frontend
        const updatedProfile = await getUserProfile(env, userId);
        const updatedTargets = await getUserTargets(env, userId);
        return new Response(JSON.stringify({
          ok: true,
          profile: updatedProfile,
          targets: updatedTargets
        }), {
          status: 200,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // PUT /api/profile/allergens - Update user allergens
    if (pathname === "/api/profile/allergens" && request.method === "PUT") {
      const body = await readJsonSafe(request);
      const userId = body?.user_id || url.searchParams.get("user_id");

      if (!userId) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const result = await setUserAllergens(env, userId, body?.allergens || []);
      if (result.ok) {
        // Recalculate targets (conditions may have changed)
        await calculateAndStoreTargets(env, userId);
      }

      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // PUT /api/profile/organs - Update user organ priorities
    if (pathname === "/api/profile/organs" && request.method === "PUT") {
      const body = await readJsonSafe(request);
      const userId = body?.user_id || url.searchParams.get("user_id");

      if (!userId) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const result = await setUserOrganPriorities(env, userId, body?.organs || []);

      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // POST /api/profile/weight - Add weight entry
    if (pathname === "/api/profile/weight" && request.method === "POST") {
      const body = await readJsonSafe(request);
      const userId = body?.user_id || url.searchParams.get("user_id");

      if (!userId || !body?.weight_kg) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id_or_weight" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const result = await addWeightEntry(env, userId, body.weight_kg, body.source || "manual");
      if (result.ok) {
        // Recalculate targets with new weight
        await calculateAndStoreTargets(env, userId);
      }

      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // GET /api/profile/weight/history - Get weight history
    if (pathname === "/api/profile/weight/history" && request.method === "GET") {
      const userId = url.searchParams.get("user_id");
      const limit = parseInt(url.searchParams.get("limit") || "30", 10);

      if (!userId) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const history = await getWeightHistory(env, userId, limit);

      return new Response(JSON.stringify({ ok: true, history }, null, 2), {
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // GET /api/allergens - Get allergen definitions
    if (pathname === "/api/allergens" && request.method === "GET") {
      const definitions = await getAllergenDefinitions(env);

      return new Response(JSON.stringify({ ok: true, allergens: definitions }, null, 2), {
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // OPTIONS preflight for /api/meals/* (CORS)
    if (pathname.startsWith("/api/meals") && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // POST /api/meals/log - Log a meal
    if (pathname === "/api/meals/log" && request.method === "POST") {
      const body = await readJsonSafe(request);
      const userId = body?.user_id || url.searchParams.get("user_id");

      if (!userId || !body?.dish_name) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id_or_dish_name" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const result = await logMeal(env, userId, body);

      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : (result.error === "duplicate_log" ? 409 : 400),
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // GET /api/meals - Get meals for a date
    if (pathname === "/api/meals" && request.method === "GET") {
      const userId = url.searchParams.get("user_id");
      const date = url.searchParams.get("date") || getTodayISO();

      if (!userId) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const meals = await getMealsForDate(env, userId, date);

      return new Response(JSON.stringify({ ok: true, date, meals }, null, 2), {
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // DELETE /api/meals/:id - Delete a meal
    if (pathname.startsWith("/api/meals/") && request.method === "DELETE") {
      const mealId = pathname.split("/").pop();
      const userId = url.searchParams.get("user_id");

      if (!userId || !mealId) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id_or_meal_id" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const result = await deleteMeal(env, userId, parseInt(mealId, 10));

      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 404,
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // OPTIONS preflight for /api/tracker/* (CORS)
    if (pathname.startsWith("/api/tracker") && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // GET /api/tracker/daily - Get daily tracker summary
    if (pathname === "/api/tracker/daily" && request.method === "GET") {
      const userId = url.searchParams.get("user_id");
      const date = url.searchParams.get("date") || getTodayISO();

      if (!userId) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const [summary, targets, meals, organPriorities] = await Promise.all([
        getDailySummary(env, userId, date),
        getUserTargets(env, userId),
        getMealsForDate(env, userId, date),
        getUserOrganPriorities(env, userId)
      ]);

      // Sort organ impacts by user priority
      let sortedOrganImpacts = [];
      if (summary?.organ_impacts_net) {
        const priorityMap = {};
        organPriorities.forEach((o, i) => { priorityMap[o.organ_code] = i; });

        sortedOrganImpacts = Object.entries(summary.organ_impacts_net)
          .map(([organ, score]) => ({
            organ,
            score,
            is_starred: organPriorities.find(o => o.organ_code === organ)?.is_starred || false
          }))
          .sort((a, b) => {
            const aIdx = priorityMap[a.organ] ?? 999;
            const bIdx = priorityMap[b.organ] ?? 999;
            return aIdx - bIdx;
          });
      }

      return new Response(JSON.stringify({
        ok: true,
        date,
        summary: summary || { meals_logged: 0 },
        targets,
        meals,
        organ_impacts: sortedOrganImpacts
      }, null, 2), {
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // GET /api/tracker/weekly - Get weekly tracker summary
    if (pathname === "/api/tracker/weekly" && request.method === "GET") {
      const userId = url.searchParams.get("user_id");
      const days = parseInt(url.searchParams.get("days") || "7", 10);

      if (!userId) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const [summaries, targets] = await Promise.all([
        getWeeklySummaries(env, userId, days),
        getUserTargets(env, userId)
      ]);

      // Calculate averages
      const totals = { calories: 0, protein: 0, fiber: 0, sugar: 0, sodium: 0 };
      let daysWithData = 0;

      for (const s of summaries) {
        if (s.meals_logged > 0) {
          daysWithData++;
          totals.calories += s.total_calories || 0;
          totals.protein += s.total_protein_g || 0;
          totals.fiber += s.total_fiber_g || 0;
          totals.sugar += s.total_sugar_g || 0;
          totals.sodium += s.total_sodium_mg || 0;
        }
      }

      const averages = daysWithData > 0 ? {
        avg_calories: Math.round(totals.calories / daysWithData),
        avg_protein_g: Math.round(totals.protein / daysWithData),
        avg_fiber_g: Math.round(totals.fiber / daysWithData),
        avg_sugar_g: Math.round(totals.sugar / daysWithData),
        avg_sodium_mg: Math.round(totals.sodium / daysWithData)
      } : null;

      return new Response(JSON.stringify({
        ok: true,
        days_requested: days,
        days_with_data: daysWithData,
        targets,
        averages,
        daily_summaries: summaries
      }, null, 2), {
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // POST /api/dishes/save - Save a dish to favorites
    if (pathname === "/api/dishes/save" && request.method === "POST") {
      const body = await readJsonSafe(request);
      const userId = body?.user_id || url.searchParams.get("user_id");

      if (!userId || !body?.dish_id || !body?.dish_name) {
        return new Response(JSON.stringify({ ok: false, error: "missing_required_fields" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const result = await saveDish(env, userId, body);

      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // GET /api/dishes/saved - Get saved dishes
    if (pathname === "/api/dishes/saved" && request.method === "GET") {
      const userId = url.searchParams.get("user_id");

      if (!userId) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const dishes = await getSavedDishes(env, userId);

      return new Response(JSON.stringify({ ok: true, dishes }, null, 2), {
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // DELETE /api/dishes/saved/:dish_id - Remove saved dish
    if (pathname.startsWith("/api/dishes/saved/") && request.method === "DELETE") {
      const dishId = pathname.split("/").pop();
      const userId = url.searchParams.get("user_id");

      if (!userId || !dishId) {
        return new Response(JSON.stringify({ ok: false, error: "missing_user_id_or_dish_id" }), {
          status: 400,
          headers: { "content-type": "application/json", ...CORS_ALL }
        });
      }

      const result = await removeSavedDish(env, userId, dishId);

      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 404,
        headers: { "content-type": "application/json", ...CORS_ALL }
      });
    }

    // ========== END USER TRACKING API ENDPOINTS ==========

    // ========== START ASYNC APIFY JOB ==========
    // POST /api/apify-start - Start an async Apify scrape with webhook callback
    if (pathname === "/api/apify-start" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const query = body.query || searchParams.get("query") || "pizza";
        const address = body.address || searchParams.get("address") || "Miami, FL, USA";
        const maxRows = Number(body.maxRows || searchParams.get("maxRows") || 15);

        const result = await startApifyRunAsync(env, query, address, maxRows);

        return new Response(JSON.stringify({
          ok: true,
          message: "Apify job started - poll for results",
          ...result
        }, null, 2), {
          headers: { "content-type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });
      }
    }

    // GET /api/apify-start - Start via GET for easy testing
    if (pathname === "/api/apify-start" && request.method === "GET") {
      try {
        const query = searchParams.get("query") || "pizza";
        const address = searchParams.get("address") || "Miami, FL, USA";
        const maxRows = Number(searchParams.get("maxRows") || 15);

        const result = await startApifyRunAsync(env, query, address, maxRows);

        return new Response(JSON.stringify({
          ok: true,
          message: "Apify job started - poll for results",
          ...result
        }, null, 2), {
          headers: { "content-type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });
      }
    }

    // --- DEBUG: Test individual scrapers with timing ---
    if (pathname === "/debug/scraper-timing") {
      const q = searchParams.get("query") || "pizza";
      const addr = searchParams.get("address") || "Miami, FL, USA";
      const max = Number(searchParams.get("maxRows") || 3);
      const testApify = searchParams.get("apify") !== "0";
      const testRapid = searchParams.get("rapid") !== "0";

      const results = {
        query: q,
        address: addr,
        maxRows: max,
        apify: null,
        rapidapi: null
      };

      // Test Apify
      if (testApify && env.APIFY_TOKEN) {
        const startApify = Date.now();
        try {
          const apifyResult = await fetchMenuFromApify(env, q, addr, max);
          const elapsed = Date.now() - startApify;
          const dataCount = apifyResult?.data?.results?.length || 0;
          results.apify = {
            ok: true,
            elapsed_ms: elapsed,
            data_count: dataCount,
            has_data: dataCount > 0
          };
        } catch (e) {
          const elapsed = Date.now() - startApify;
          results.apify = {
            ok: false,
            elapsed_ms: elapsed,
            error: String(e?.message || e)
          };
        }
      } else if (!env.APIFY_TOKEN) {
        results.apify = { ok: false, error: "APIFY_TOKEN not set" };
      }

      // Test RapidAPI
      if (testRapid && env.RAPIDAPI_KEY) {
        const startRapid = Date.now();
        try {
          const rapidResult = await fetchMenuFromUberEats(env, q, addr, max);
          const elapsed = Date.now() - startRapid;
          const dataCount = rapidResult?.returnvalue?.data?.length || rapidResult?.data?.results?.length || 0;
          results.rapidapi = {
            ok: true,
            elapsed_ms: elapsed,
            data_count: dataCount,
            has_data: dataCount > 0
          };
        } catch (e) {
          const elapsed = Date.now() - startRapid;
          results.rapidapi = {
            ok: false,
            elapsed_ms: elapsed,
            error: String(e?.message || e)
          };
        }
      } else if (!env.RAPIDAPI_KEY) {
        results.rapidapi = { ok: false, error: "RAPIDAPI_KEY not set" };
      }

      return new Response(JSON.stringify(results, null, 2), {
        headers: { "content-type": "application/json" }
      });
    }

    // --- DEBUG: Menu cache management ---
    if (pathname === "/debug/menu-cache/list") {
      const kv = env.MENUS_CACHE;
      if (!kv) {
        return new Response(JSON.stringify({ ok: false, error: "MENUS_CACHE not bound" }), {
          headers: { "content-type": "application/json" }
        });
      }
      const prefix = searchParams.get("prefix") || "menu:";
      const limit = Number(searchParams.get("limit") || "50");
      const list = await kv.list({ prefix, limit });
      return new Response(JSON.stringify({
        ok: true,
        prefix,
        count: list.keys.length,
        keys: list.keys.map(k => ({ name: k.name, expiration: k.expiration })),
        list_complete: list.list_complete,
        cursor: list.cursor || null
      }, null, 2), { headers: { "content-type": "application/json" } });
    }

    if (pathname === "/debug/menu-cache/get") {
      const kv = env.MENUS_CACHE;
      if (!kv) {
        return new Response(JSON.stringify({ ok: false, error: "MENUS_CACHE not bound" }), {
          headers: { "content-type": "application/json" }
        });
      }
      const key = searchParams.get("key");
      if (!key) {
        return new Response(JSON.stringify({ ok: false, error: "Missing ?key=" }), {
          status: 400, headers: { "content-type": "application/json" }
        });
      }
      const value = await kv.get(key, "json");
      return new Response(JSON.stringify({
        ok: !!value,
        key,
        exists: !!value,
        value: value || null
      }, null, 2), { headers: { "content-type": "application/json" } });
    }

    if (pathname === "/debug/menu-cache/delete") {
      const kv = env.MENUS_CACHE;
      if (!kv) {
        return new Response(JSON.stringify({ ok: false, error: "MENUS_CACHE not bound" }), {
          headers: { "content-type": "application/json" }
        });
      }
      const key = searchParams.get("key");
      const prefix = searchParams.get("prefix");

      if (key) {
        // Delete single key
        await kv.delete(key);
        return new Response(JSON.stringify({ ok: true, deleted: key }, null, 2), {
          headers: { "content-type": "application/json" }
        });
      } else if (prefix) {
        // Delete all keys with prefix (batch)
        const list = await kv.list({ prefix, limit: 100 });
        const deleted = [];
        for (const k of list.keys) {
          await kv.delete(k.name);
          deleted.push(k.name);
        }
        return new Response(JSON.stringify({
          ok: true,
          deleted_count: deleted.length,
          deleted,
          more_remaining: !list.list_complete
        }, null, 2), { headers: { "content-type": "application/json" } });
      } else {
        return new Response(JSON.stringify({ ok: false, error: "Missing ?key= or ?prefix=" }), {
          status: 400, headers: { "content-type": "application/json" }
        });
      }
    }

    if (pathname === "/debug/menu-cache/clear-all") {
      // Safety: require confirmation param
      if (searchParams.get("confirm") !== "yes") {
        return new Response(JSON.stringify({
          ok: false,
          error: "Add ?confirm=yes to clear all menu cache",
          warning: "This will delete ALL cached menus"
        }, null, 2), { status: 400, headers: { "content-type": "application/json" } });
      }
      const kv = env.MENUS_CACHE;
      if (!kv) {
        return new Response(JSON.stringify({ ok: false, error: "MENUS_CACHE not bound" }), {
          headers: { "content-type": "application/json" }
        });
      }
      let totalDeleted = 0;
      let cursor = undefined;
      do {
        const list = await kv.list({ prefix: "menu/", limit: 100, cursor });
        for (const k of list.keys) {
          await kv.delete(k.name);
          totalDeleted++;
        }
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);

      return new Response(JSON.stringify({
        ok: true,
        message: "All menu cache cleared",
        deleted_count: totalDeleted
      }, null, 2), { headers: { "content-type": "application/json" } });
    }

    // --- DEBUG: View stale menu entries ---
    if (pathname === "/debug/menu-cache/stale") {
      const limit = Number(searchParams.get("limit") || "50");
      const staleEntries = await getStaleMenuEntries(env, limit);
      return new Response(JSON.stringify({
        ok: true,
        stale_threshold_days: Math.floor(MENU_STALE_SECONDS / 86400),
        stale_count: staleEntries.length,
        entries: staleEntries
      }, null, 2), { headers: { "content-type": "application/json" } });
    }

    // --- DEBUG: View cron run status ---
    if (pathname === "/debug/menu-cache/cron-status") {
      const kv = env.MENUS_CACHE;
      if (!kv) {
        return new Response(JSON.stringify({ ok: false, error: "MENUS_CACHE not bound" }), {
          headers: { "content-type": "application/json" }
        });
      }
      const lastRun = await kv.get("cron/last_run", "json");
      return new Response(JSON.stringify({
        ok: true,
        cron_schedule: "0 3 * * * (daily at 3 AM UTC)",
        stale_threshold_days: Math.floor(MENU_STALE_SECONDS / 86400),
        cache_ttl_days: Math.floor(MENU_TTL_SECONDS / 86400),
        last_run: lastRun || null
      }, null, 2), { headers: { "content-type": "application/json" } });
    }

    // --- DEBUG: Manually trigger menu refresh for a specific entry ---
    if (pathname === "/debug/menu-cache/refresh" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const { query, address, forceUS } = body;
      if (!query || !address) {
        return new Response(JSON.stringify({
          ok: false,
          error: "Missing query or address in POST body",
          example: { query: "Chipotle", address: "123 Main St, Los Angeles, CA", forceUS: true }
        }, null, 2), { status: 400, headers: { "content-type": "application/json" } });
      }

      const cacheKey = cacheKeyForMenu(query, address, !!forceUS);
      const result = await refreshMenuInBackground(env, { query, address, forceUS, cacheKey });
      return new Response(JSON.stringify({
        ok: result.ok,
        query,
        address,
        cacheKey,
        result
      }, null, 2), { headers: { "content-type": "application/json" } });
    }

    // === Franchise Menu System Endpoints ===

    // GET /store/:id/menu - Get effective menu for a store
    if (pathname.startsWith("/store/") && pathname.endsWith("/menu") && request.method === "GET") {
      const storeId = pathname.replace("/store/", "").replace("/menu", "");
      if (!storeId || isNaN(Number(storeId))) {
        return jsonResponse({ ok: false, error: "Invalid store ID" }, 400);
      }
      const result = await getEffectiveMenu(env, Number(storeId));
      return jsonResponse(result, result.ok ? 200 : 404);
    }

    // GET /franchise/brands - List all brands
    if (pathname === "/franchise/brands" && request.method === "GET") {
      try {
        const brands = await env.D1_DB.prepare("SELECT * FROM brands ORDER BY canonical_name").all();
        return jsonResponse({ ok: true, brands: brands.results || [] });
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // GET /franchise/brands/:id/items - Get menu items for a brand
    if (pathname.startsWith("/franchise/brands/") && pathname.endsWith("/items") && request.method === "GET") {
      const brandId = pathname.replace("/franchise/brands/", "").replace("/items", "");
      if (!brandId || isNaN(Number(brandId))) {
        return jsonResponse({ ok: false, error: "Invalid brand ID" }, 400);
      }
      try {
        const items = await env.D1_DB.prepare(`
          SELECT fmi.*,
            (SELECT COUNT(*) FROM menu_item_scopes WHERE menu_item_id = fmi.id AND status = 'ACTIVE') as active_scopes
          FROM franchise_menu_items fmi
          WHERE fmi.brand_id = ?
          ORDER BY fmi.category, fmi.canonical_name
        `).bind(Number(brandId)).all();
        return jsonResponse({ ok: true, items: items.results || [] });
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // GET /franchise/stores - List franchise stores
    if (pathname === "/franchise/stores" && request.method === "GET") {
      const limit = Number(searchParams.get("limit") || "50");
      const brandId = searchParams.get("brand_id");
      try {
        let query = `
          SELECT s.*, b.canonical_name as brand_name
          FROM stores s
          LEFT JOIN brands b ON b.id = s.brand_id
          WHERE s.brand_id IS NOT NULL
        `;
        const params = [];
        if (brandId) {
          query += " AND s.brand_id = ?";
          params.push(Number(brandId));
        }
        query += " ORDER BY s.updated_at DESC LIMIT ?";
        params.push(limit);

        const stores = await env.D1_DB.prepare(query).bind(...params).all();
        return jsonResponse({ ok: true, stores: stores.results || [] });
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // POST /franchise/detect-brand - Detect brand from place data
    if (pathname === "/franchise/detect-brand" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (!body.name) {
        return jsonResponse({ ok: false, error: "Missing 'name' in body" }, 400);
      }
      const brand = await detectBrand(env, body);
      return jsonResponse({
        ok: true,
        input: body.name,
        normalized: normalizeBrandName(body.name),
        brand: brand || null,
        is_franchise: !!brand
      });
    }

    // POST /franchise/onboard-store - Onboard a store (detect brand, create store record)
    if (pathname === "/franchise/onboard-store" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (!body.name) {
        return jsonResponse({ ok: false, error: "Missing 'name' in body" }, 400);
      }

      // Detect brand
      const brand = await detectBrand(env, body);

      // Upsert store
      const store = await upsertStore(env, {
        place_id: body.place_id,
        uber_store_id: body.uber_store_id,
        brand_id: brand?.id || null,
        name: body.name,
        address: body.address,
        city: body.city,
        state_province: body.state_province || body.state,
        postal_code: body.postal_code,
        country_code: body.country_code || "US",
        latitude: body.latitude || body.lat,
        longitude: body.longitude || body.lng,
        source: body.source || "api"
      });

      return jsonResponse({
        ok: true,
        brand: brand || null,
        is_franchise: !!brand,
        store
      });
    }

    // POST /internal/store/:id/delta - Trigger delta discovery (internal)
    if (pathname.startsWith("/internal/store/") && pathname.endsWith("/delta") && request.method === "POST") {
      const storeId = pathname.replace("/internal/store/", "").replace("/delta", "");
      if (!storeId || isNaN(Number(storeId))) {
        return jsonResponse({ ok: false, error: "Invalid store ID" }, 400);
      }

      const body = await request.json().catch(() => ({}));
      if (!body.items || !Array.isArray(body.items)) {
        return jsonResponse({ ok: false, error: "Missing 'items' array in body" }, 400);
      }

      const result = await deltaMenuDiscovery(env, Number(storeId), body.items, body.source_type || "ubereats");
      return jsonResponse(result);
    }

    // POST /internal/jobs/promote - Run promotion jobs (cron/internal)
    if (pathname === "/internal/jobs/promote" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const brandId = body.brand_id;

      if (!brandId) {
        return jsonResponse({ ok: false, error: "Missing 'brand_id' in body" }, 400);
      }

      const storeToRegion = await promoteStoreToRegion(env, brandId);
      const regionToCountry = await promoteRegionToCountry(env, brandId);
      const staleInactive = await markStaleInactive(env, brandId);

      return jsonResponse({
        ok: true,
        brand_id: brandId,
        promotions: {
          store_to_region: storeToRegion,
          region_to_country: regionToCountry
        },
        stale_inactive: staleInactive
      });
    }

    // POST /internal/jobs/reconcile-batch - Run reconcile for scheduled stores (cron/internal)
    if (pathname === "/internal/jobs/reconcile-batch" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const limit = body.limit || 10;

      const stores = await getStoresDueForReconcile(env, limit);

      return jsonResponse({
        ok: true,
        stores_due: stores.length,
        stores: stores.map(s => ({
          id: s.id,
          name: s.name,
          brand_name: s.brand_name,
          last_reconciled_at: s.last_reconciled_at,
          next_reconcile_after: s.next_reconcile_after
        })),
        hint: "Call /internal/store/:id/delta with menu items to reconcile each store"
      });
    }

    // GET /franchise/stats - Get franchise system stats
    if (pathname === "/franchise/stats" && request.method === "GET") {
      try {
        const brandCount = await env.D1_DB.prepare("SELECT COUNT(*) as count FROM brands").first();
        const storeCount = await env.D1_DB.prepare("SELECT COUNT(*) as count FROM stores WHERE brand_id IS NOT NULL").first();
        const itemCount = await env.D1_DB.prepare("SELECT COUNT(*) as count FROM franchise_menu_items").first();
        const scopeCount = await env.D1_DB.prepare("SELECT COUNT(*) as count FROM menu_item_scopes").first();
        const sightingCount = await env.D1_DB.prepare("SELECT COUNT(*) as count FROM menu_item_sightings").first();
        const snapshotCount = await env.D1_DB.prepare("SELECT COUNT(*) as count FROM store_menu_snapshots").first();

        const scopesByType = await env.D1_DB.prepare(`
          SELECT scope_type, status, COUNT(*) as count
          FROM menu_item_scopes
          GROUP BY scope_type, status
        `).all();

        return jsonResponse({
          ok: true,
          stats: {
            brands: brandCount?.count || 0,
            franchise_stores: storeCount?.count || 0,
            menu_items: itemCount?.count || 0,
            scopes: scopeCount?.count || 0,
            sightings: sightingCount?.count || 0,
            snapshots: snapshotCount?.count || 0
          },
          scopes_by_type: scopesByType.results || [],
          config: FRANCHISE_CONFIG
        });
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // === DAYPART SEEDING ENDPOINTS ===

    // POST /internal/seeding/start - Start or resume a seeding run
    if (pathname === "/internal/seeding/start" && request.method === "POST") {
      try {
        const body = await readJson(request) || {};
        const runType = body.run_type || 'INITIAL';
        const result = await startOrResumeSeedRun(env, runType);
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // POST /internal/seeding/tick - Process one franchise (for cron or manual triggering)
    if (pathname === "/internal/seeding/tick" && request.method === "POST") {
      try {
        const result = await seedingTick(env, ctx);
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // GET /internal/seeding/status - Get seeding run status
    if (pathname === "/internal/seeding/status" && request.method === "GET") {
      try {
        const runId = searchParams.get("run_id");
        if (runId) {
          const status = await getSeedRunStatus(env, runId);
          return jsonResponse({ ok: true, ...status });
        }
        // Get latest run
        const latest = await env.D1_DB.prepare(`
          SELECT * FROM franchise_seed_runs ORDER BY started_at DESC LIMIT 1
        `).first();
        if (!latest) return jsonResponse({ ok: true, message: "No seed runs found" });
        const status = await getSeedRunStatus(env, latest.run_id);
        return jsonResponse({ ok: true, ...status });
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // GET /internal/seeding/done-list - Get completed franchises list
    if (pathname === "/internal/seeding/done-list" && request.method === "GET") {
      try {
        const runId = searchParams.get("run_id");
        let targetRunId = runId;
        if (!targetRunId) {
          const latest = await env.D1_DB.prepare(`
            SELECT run_id FROM franchise_seed_runs ORDER BY started_at DESC LIMIT 1
          `).first();
          targetRunId = latest?.run_id;
        }
        if (!targetRunId) return new Response("No seed runs found", { status: 404 });
        const report = await getCompletedFranchisesList(env, targetRunId);
        return new Response(report || "No data", { status: 200, headers: { "Content-Type": "text/plain" } });
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // POST /internal/seeding/pause - Pause the current seeding run
    if (pathname === "/internal/seeding/pause" && request.method === "POST") {
      try {
        const result = await env.D1_DB.prepare(`
          UPDATE franchise_seed_runs
          SET status = 'PAUSED', updated_at = datetime('now')
          WHERE status = 'RUNNING'
        `).run();
        return jsonResponse({ ok: true, paused: result.meta?.changes > 0 });
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // POST /internal/seeding/resume - Resume a paused seeding run
    if (pathname === "/internal/seeding/resume" && request.method === "POST") {
      try {
        const result = await env.D1_DB.prepare(`
          UPDATE franchise_seed_runs
          SET status = 'RUNNING', updated_at = datetime('now')
          WHERE status = 'PAUSED'
        `).run();
        return jsonResponse({ ok: true, resumed: result.meta?.changes > 0 });
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // POST /internal/dayparts/tick - Process due daypart jobs
    if (pathname === "/internal/dayparts/tick" && request.method === "POST") {
      try {
        const result = await daypartJobTick(env, ctx);
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // POST /internal/dayparts/promote - Run daypart promotion
    if (pathname === "/internal/dayparts/promote" && request.method === "POST") {
      try {
        const body = await readJson(request) || {};
        const brandId = body.brand_id || null;
        const result = await promoteDayparts(env, brandId);
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // GET /internal/dayparts/status - Get daypart coverage status
    if (pathname === "/internal/dayparts/status" && request.method === "GET") {
      try {
        const status = await getDaypartStatus(env);
        return jsonResponse({ ok: true, ...status });
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // GET /internal/dayparts/jobs - List daypart jobs
    if (pathname === "/internal/dayparts/jobs" && request.method === "GET") {
      try {
        const brandId = searchParams.get("brand_id");
        const status = searchParams.get("status") || 'ACTIVE';
        let query = `SELECT dj.*, b.canonical_name as brand_name FROM franchise_daypart_jobs dj
          JOIN brands b ON b.id = dj.brand_id WHERE dj.status = ?`;
        let params = [status];
        if (brandId) {
          query += ` AND dj.brand_id = ?`;
          params.push(brandId);
        }
        query += ` ORDER BY dj.next_run_at_utc LIMIT 100`;
        const result = await env.D1_DB.prepare(query).bind(...params).all();
        return jsonResponse({ ok: true, jobs: result.results || [] });
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
    }

    // GET /store/:id/menu/daypart - Get effective menu with daypart filtering
    if (pathname.match(/^\/store\/\d+\/menu\/daypart$/) && request.method === "GET") {
      try {
        const storeId = parseInt(pathname.split("/")[2]);
        const daypart = searchParams.get("daypart");
        const tzid = searchParams.get("tzid") || "America/New_York";
        const includeAll = searchParams.get("all") === "true";
        const result = await getEffectiveMenuWithDaypart(env, storeId, { daypart, tzid, includeAllDayparts: includeAll });
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message }, 500);
      }
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
          // [38.3] age warning for cached data (stale after MENU_STALE_SECONDS)
          if (cached?.isStale) {
            const ageDays = Math.floor(cached.ageSeconds / 86400);
            setWarn(`Cached data is ${ageDays} days old (refreshing in background).`);
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
          // ?fresh=1 bypasses cache and forces live fetch
          const wantFresh = searchParams.get("fresh") === "1";

          if (cached?.data && !wantFresh) {
            cachedItems = Array.isArray(cached.data.items)
              ? cached.data.items
              : null;
            if (cachedItems) cacheStatus = "hit";

            // Stale-while-revalidate: return cache immediately, refresh in background if stale
            // Cache is considered stale after MENU_STALE_SECONDS (15 days)
            const isStale = cached.isStale || (cacheAgeSec && cacheAgeSec > MENU_STALE_SECONDS);

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

              // Return cached data immediately (stale-while-revalidate pattern)
              const address = addressRaw;
              const forceUS = !!forceUSFlag;
              trace.used_path = "cache"; // [38.9]
              await bumpStatusKV(env, { cache: 1 });

              // Background refresh: if stale, trigger async menu refresh (non-blocking)
              if (isStale && ctx?.waitUntil) {
                ctx.waitUntil(
                  refreshMenuInBackground(env, { query, address: addressRaw, forceUS, cacheKey })
                    .catch(err => console.log("[menu-refresh] background error:", err?.message))
                );
              }

              return respondTB(
                withBodyAnalytics(
                  {
                    ok: true,
                    source: "cache",
                    cache: cacheStatus,
                    cache_age_seconds: cacheAgeSec,
                    cache_stale: isStale,
                    data: {
                      query,
                      address,
                      forceUS,
                      items: flattenedItems.slice(0, maxRows)
                    },
                    enqueued,
                    hint: isStale ? "Cache is stale (>15 days). Refreshing in background. Add ?fresh=1 to force immediate refresh." : null,
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
        } catch (e) {
          // ignore cache errors and proceed to live
        }

        // Address-based job path
        if (addressRaw) {
          // US hint: append ", USA" once if forcing US but address lacks it
          let address = addressRaw;
          if (forceUSFlag && !/usa|united states/i.test(address))
            address = `${addressRaw}, USA`;

          const job = await postJobByAddressTiered(
            { query, address, maxRows, locale, page },
            env
          );

          // Update trace with tier info
          const usedTier = job?._tier || "unknown";
          trace.used_tier = usedTier;
          trace.host = usedTier === "apify" ? "api.apify.com" : (env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com");
          trace.used_path = usedTier === "apify" ? "/v2/acts/run-sync" : "/api/job";

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
            const jobRes = await postJobByLocationTiered(
              { query, lat: Number(lat), lng: Number(lng), radius, maxRows },
              env
            );
            if (jobRes?.path) trace.used_path = jobRes.path; // [38.9]
            if (jobRes?._tier) trace.used_tier = jobRes._tier;
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

        const raw = await fetchMenuFromUberEatsTiered(
          env,
          query,
          addressRaw,
          maxRows,
          latNum,
          lngNum,
          radius
        );
        if (searchParams.get("debug") === "1") {
          trace.used_path = trace.used_path || `fetchMenuFromUberEats:${raw?._tier || "unknown"}`; // keep trace detail
          await bumpStatusKV(env, { debug: 1 });
          const preview = buildDebugPreview(raw || {}, env);
          return respondTB(withBodyAnalytics(preview, ctx, rid, trace), 200);
        }

        const usedHost = raw?._tier === "apify"
          ? "api.apify.com"
          : (env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com");
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

        if (!trace.used_path) trace.used_path = `fetchMenuFromUberEats:${raw?._tier || "unknown"}`; // [38.9]
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
        let usedTier = null;

        if (addressRaw) {
          const job = await postJobByAddressTiered(
            {
              query,
              address: addressRaw,
              maxRows,
              locale: searchParams.get("locale") || "en-US",
              page
            },
            env
          );
          usedTier = job?._tier || null;
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
            const job = await postJobByLocationTiered(
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
  },

  // ---- Scheduled handler: background menu cache refresh ----
  scheduled: async (controller, env, ctx) => {
    console.log("[scheduled] Menu cache refresh cron started");
    const startTime = Date.now();
    let refreshed = 0;
    let failed = 0;
    let skipped = 0;

    try {
      // Get stale menu entries (limit to 10 per run to avoid timeout)
      const staleEntries = await getStaleMenuEntries(env, 10);
      console.log(`[scheduled] Found ${staleEntries.length} stale menu(s) to refresh`);

      for (const entry of staleEntries) {
        try {
          console.log(`[scheduled] Refreshing: ${entry.query} @ ${entry.address} (${entry.ageDays} days old)`);
          const result = await refreshMenuInBackground(env, {
            query: entry.query,
            address: entry.address,
            forceUS: entry.forceUS,
            cacheKey: entry.key
          });

          if (result.ok) {
            refreshed++;
          } else {
            skipped++;
          }
        } catch (err) {
          console.log(`[scheduled] Failed to refresh ${entry.query}: ${err?.message}`);
          failed++;
        }

        // Rate limit: wait 2 seconds between refreshes to avoid API throttling
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      const elapsed = Date.now() - startTime;
      console.log(`[scheduled] Menu refresh complete: ${refreshed} refreshed, ${skipped} skipped, ${failed} failed (${elapsed}ms)`);

      // Log stats to KV for monitoring
      if (env.MENUS_CACHE) {
        await env.MENUS_CACHE.put("cron/last_run", JSON.stringify({
          ran_at: new Date().toISOString(),
          elapsed_ms: elapsed,
          stale_found: staleEntries.length,
          refreshed,
          skipped,
          failed
        }), { expirationTtl: 7 * 24 * 3600 });
      }

      // --- Franchise reconciliation (15-day cycle) ---
      console.log("[scheduled] Starting franchise reconciliation...");
      const franchiseStart = Date.now();
      let franchiseReconciled = 0;

      try {
        // Get stores due for reconciliation
        const storesDue = await getStoresDueForReconcile(env, 5);
        console.log(`[scheduled] Found ${storesDue.length} franchise store(s) due for reconciliation`);

        // Log which stores are due (but actual reconciliation needs menu data from external source)
        // The actual reconciliation happens when /internal/store/:id/delta is called with menu items
        // This cron just identifies which stores need attention

        if (env.MENUS_CACHE && storesDue.length > 0) {
          await env.MENUS_CACHE.put("cron/franchise_reconcile", JSON.stringify({
            ran_at: new Date().toISOString(),
            stores_due: storesDue.map(s => ({
              id: s.id,
              name: s.name,
              brand_name: s.brand_name,
              last_reconciled_at: s.last_reconciled_at
            }))
          }), { expirationTtl: 7 * 24 * 3600 });
        }

        // Run promotion jobs for all brands with recent activity
        const brands = await env.D1_DB?.prepare("SELECT id FROM brands LIMIT 10").all();
        for (const brand of brands?.results || []) {
          await promoteStoreToRegion(env, brand.id);
          await markStaleInactive(env, brand.id);
        }

        console.log(`[scheduled] Franchise reconciliation complete (${Date.now() - franchiseStart}ms)`);
      } catch (franchiseErr) {
        console.log(`[scheduled] Franchise reconciliation error: ${franchiseErr?.message}`);
      }

      // --- Daypart Seeding System ---
      console.log("[scheduled] Starting daypart seeding jobs...");
      const daypartStart = Date.now();

      try {
        // 1. Process seeding tick (if active run exists)
        const seedingResult = await seedingTick(env, ctx);
        if (seedingResult.brand) {
          console.log(`[scheduled] Seeded franchise: ${seedingResult.brand}`);
        }

        // 2. Process due daypart jobs (sample menus at scheduled local times)
        const daypartJobResult = await daypartJobTick(env, ctx);
        if (daypartJobResult.processed > 0) {
          console.log(`[scheduled] Processed ${daypartJobResult.processed} daypart job(s)`);
        }

        // 3. Run daypart promotions (analyze sightings and promote items to GLOBAL scope)
        // Run daily - only if it's around 4 AM UTC to avoid running too frequently
        const currentHour = new Date().getUTCHours();
        if (currentHour >= 3 && currentHour <= 5) {
          const promoResult = await promoteDayparts(env);
          console.log(`[scheduled] Daypart promotion: ${promoResult.promoted} items promoted`);
        }

        // Log stats to KV
        if (env.MENUS_CACHE) {
          await env.MENUS_CACHE.put("cron/daypart_jobs", JSON.stringify({
            ran_at: new Date().toISOString(),
            elapsed_ms: Date.now() - daypartStart,
            seeding: seedingResult,
            daypart_jobs: daypartJobResult
          }), { expirationTtl: 7 * 24 * 3600 });
        }

        console.log(`[scheduled] Daypart jobs complete (${Date.now() - daypartStart}ms)`);
      } catch (daypartErr) {
        console.log(`[scheduled] Daypart jobs error: ${daypartErr?.message}`);
      }

    } catch (err) {
      console.log(`[scheduled] Cron error: ${err?.message}`);
    }
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
// Menu cache: never truly expire, but refresh stale menus in background
const MENU_TTL_SECONDS = 365 * 24 * 3600; // 1 year - menus persist indefinitely
const MENU_STALE_SECONDS = 15 * 24 * 3600; // 15 days - trigger background refresh after this
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

// Smart human-like allergen summary paragraph
function buildSmartAllergenSummary(allergenFlags, lactoseFlags, allergenBreakdown) {
  if (!Array.isArray(allergenFlags) || allergenFlags.length === 0) {
    return "No major allergens were detected in this dish based on the available information.";
  }

  const sentences = [];

  // Group allergens by presence level
  const confirmed = allergenFlags.filter(f => f.present === "yes");
  const possible = allergenFlags.filter(f => f.present === "maybe");

  // Allergen display names with articles
  const allergenNames = {
    gluten: "gluten",
    milk: "dairy (milk)",
    egg: "eggs",
    soy: "soy",
    peanut: "peanuts",
    tree_nut: "tree nuts",
    fish: "fish",
    shellfish: "shellfish",
    sesame: "sesame"
  };

  // Build confirmed allergens sentence
  if (confirmed.length > 0) {
    const names = confirmed.map(f => allergenNames[f.kind] || f.kind);
    if (names.length === 1) {
      sentences.push(`This dish contains ${names[0]}.`);
    } else if (names.length === 2) {
      sentences.push(`This dish contains ${names[0]} and ${names[1]}.`);
    } else {
      const last = names.pop();
      sentences.push(`This dish contains ${names.join(", ")}, and ${last}.`);
    }
  }

  // Add lactose level for dairy with specific detail
  const hasDairy = confirmed.some(f => f.kind === "milk") || possible.some(f => f.kind === "milk");
  if (hasDairy && lactoseFlags && lactoseFlags.level) {
    const level = lactoseFlags.level.toLowerCase();
    const reason = lactoseFlags.reason || "";

    if (level === "high") {
      sentences.push(`The dairy content has high lactose levels${reason ? ` (${reason.toLowerCase()})` : ""}, which may cause discomfort for lactose-intolerant individuals.`);
    } else if (level === "medium") {
      sentences.push(`The dairy content has moderate lactose levels${reason ? ` (${reason.toLowerCase()})` : ""}.`);
    } else if (level === "low" || level === "trace") {
      sentences.push(`The dairy content has low lactose levels${reason ? ` (${reason.toLowerCase()})` : ""}, which may be tolerable for some lactose-sensitive individuals.`);
    } else if (level === "none") {
      sentences.push("The dairy ingredients appear to be lactose-free.");
    }
  }

  // Build possible allergens sentence
  if (possible.length > 0) {
    const names = possible.map(f => allergenNames[f.kind] || f.kind);
    const reasons = possible.map(f => f.message).filter(Boolean);

    if (names.length === 1) {
      sentences.push(`This dish may contain ${names[0]}${reasons[0] ? ` (${reasons[0].toLowerCase()})` : ""}.`);
    } else {
      sentences.push(`This dish may also contain ${names.join(" and ")}.`);
    }
  }

  // Add component-specific allergen details if available
  if (Array.isArray(allergenBreakdown) && allergenBreakdown.length > 0) {
    const componentDetails = [];
    for (const comp of allergenBreakdown) {
      if (!comp || !comp.component) continue;
      const compAllergens = (comp.allergen_flags || []).filter(f => f.present === "yes");
      if (compAllergens.length > 0) {
        const compNames = compAllergens.map(f => allergenNames[f.kind] || f.kind);
        componentDetails.push(`${comp.component} (${compNames.join(", ")})`);
      }
    }
    if (componentDetails.length > 1) {
      sentences.push(`Allergen sources by component: ${componentDetails.join("; ")}.`);
    }
  }

  return sentences.join(" ");
}

// Smart human-like FODMAP summary paragraph
function buildSmartFodmapSummary(fodmapFlags, allergenBreakdown, plateComponents) {
  if (!fodmapFlags || !fodmapFlags.level) {
    return "FODMAP level could not be determined from the available information.";
  }

  const sentences = [];
  const level = fodmapFlags.level.toLowerCase();
  const reason = fodmapFlags.reason || "";

  // Main FODMAP level sentence
  if (level === "high") {
    sentences.push(`This dish has a high FODMAP content${reason ? `, primarily due to ${reason.toLowerCase()}` : ""}.`);
    sentences.push("Individuals following a low-FODMAP diet should avoid this dish or consume only a small portion.");
  } else if (level === "medium") {
    sentences.push(`This dish has a moderate FODMAP content${reason ? `, due to ${reason.toLowerCase()}` : ""}.`);
    sentences.push("Portion size matters for those sensitive to FODMAPs.");
  } else if (level === "low") {
    sentences.push(`This dish has a low FODMAP content${reason ? ` (${reason.toLowerCase()})` : ""}.`);
    sentences.push("This is generally suitable for those following a low-FODMAP diet.");
  }

  // Add component-specific FODMAP details if available
  if (Array.isArray(allergenBreakdown) && allergenBreakdown.length > 0) {
    const highFodmapComps = [];
    const lowFodmapComps = [];

    for (const comp of allergenBreakdown) {
      if (!comp || !comp.component || !comp.fodmap_flags) continue;
      const compLevel = (comp.fodmap_flags.level || "").toLowerCase();
      if (compLevel === "high") {
        highFodmapComps.push(comp.component);
      } else if (compLevel === "low") {
        lowFodmapComps.push(comp.component);
      }
    }

    if (highFodmapComps.length > 0 && lowFodmapComps.length > 0) {
      sentences.push(`High-FODMAP components include ${highFodmapComps.join(", ")}, while ${lowFodmapComps.join(", ")} ${lowFodmapComps.length === 1 ? "is" : "are"} low-FODMAP.`);
    } else if (highFodmapComps.length > 0) {
      sentences.push(`The main FODMAP contributors are ${highFodmapComps.join(" and ")}.`);
    }
  }

  return sentences.join(" ");
}

/**
 * Build a "Likely Recipe" by merging base recipe with vision-detected ingredients
 * and adjusting cooking instructions based on detected cooking method.
 */
function buildLikelyRecipe(recipeResult, visionInsights, nutritionBreakdown) {
  const likely = {
    title: null,
    source: null,
    cooking_method: null,
    cooking_method_confidence: null,
    cooking_method_adjusted: false,
    ingredients: [],
    instructions: [],
    notes: []
  };

  // Extract base recipe data
  const baseRecipe = recipeResult?.recipe || recipeResult?.out?.recipe || {};
  const recipeIngredients = recipeResult?.ingredients || recipeResult?.ingredients_parsed || [];
  const recipeSteps = baseRecipe.steps || [];
  const recipeNotes = baseRecipe.notes || [];

  likely.title = baseRecipe.title || baseRecipe.name || recipeResult?.dish || "Unknown Dish";
  likely.source = recipeResult?.source || recipeResult?.responseSource || "unknown";

  // Get vision cooking method
  const visionCookingMethod = visionInsights?.visual_cooking_method;
  if (visionCookingMethod && visionCookingMethod.primary) {
    likely.cooking_method = visionCookingMethod.primary;
    likely.cooking_method_confidence = visionCookingMethod.confidence || null;
    likely.cooking_method_reason = visionCookingMethod.reason || null;
  }

  // Get vision-detected ingredients
  const visionIngredients = visionInsights?.visual_ingredients || [];

  // Build ingredient map from recipe (lowercase for matching)
  const recipeIngredientMap = new Map();
  for (const ing of recipeIngredients) {
    const name = (ing.name || ing.food || "").toLowerCase().trim();
    if (name) {
      recipeIngredientMap.set(name, {
        name: ing.name || ing.food,
        quantity: ing.qty || ing.quantity || null,
        unit: ing.unit || null,
        source: "recipe",
        category: null
      });
    }
  }

  // Add vision ingredients, marking new ones
  for (const vi of visionIngredients) {
    const guess = (vi.guess || "").toLowerCase().trim();
    if (!guess) continue;

    // Check if already in recipe (fuzzy match)
    let found = false;
    for (const [recName] of recipeIngredientMap) {
      if (recName.includes(guess) || guess.includes(recName) ||
          levenshteinSimilar(recName, guess)) {
        found = true;
        // Update with vision confidence
        const existing = recipeIngredientMap.get(recName);
        existing.vision_confirmed = true;
        existing.vision_confidence = vi.confidence || null;
        break;
      }
    }

    if (!found) {
      // New ingredient detected by vision
      recipeIngredientMap.set(guess, {
        name: vi.guess,
        quantity: null,
        unit: null,
        source: "vision",
        category: vi.category || null,
        vision_confidence: vi.confidence || null,
        vision_evidence: vi.evidence || null
      });
    }
  }

  // Also check FatSecret nutrition breakdown for additional ingredients
  if (Array.isArray(nutritionBreakdown)) {
    for (const comp of nutritionBreakdown) {
      const compName = (comp.component || "").toLowerCase().trim();
      if (!compName || comp.category === "whole_dish") continue;

      let found = false;
      for (const [recName] of recipeIngredientMap) {
        if (recName.includes(compName) || compName.includes(recName) ||
            levenshteinSimilar(recName, compName)) {
          found = true;
          break;
        }
      }

      if (!found) {
        recipeIngredientMap.set(compName, {
          name: comp.component,
          quantity: null,
          unit: null,
          source: "vision_nutrition",
          energyKcal: comp.energyKcal || null,
          protein_g: comp.protein_g || null
        });
      }
    }
  }

  // Convert map to array
  likely.ingredients = Array.from(recipeIngredientMap.values());

  // Cooking method verb mappings for instruction adjustment
  const cookingVerbs = {
    grilled: ["grill", "grilling", "grilled"],
    fried: ["fry", "frying", "fried", "pan-fry", "pan-frying"],
    deep_fried: ["deep-fry", "deep-frying", "deep-fried"],
    baked: ["bake", "baking", "baked"],
    roasted: ["roast", "roasting", "roasted"],
    steamed: ["steam", "steaming", "steamed"],
    sautéed: ["sauté", "sautéing", "sautéed", "saute", "sauteing", "sauteed"],
    boiled: ["boil", "boiling", "boiled"],
    broiled: ["broil", "broiling", "broiled"]
  };

  // Get verbs for detected cooking method
  const detectedVerbs = likely.cooking_method ? cookingVerbs[likely.cooking_method] || [] : [];

  // Adjust instructions based on cooking method
  for (const step of recipeSteps) {
    let adjustedStep = step;
    let wasAdjusted = false;

    if (likely.cooking_method && detectedVerbs.length > 0) {
      // Check if step mentions a different cooking method
      for (const [method, verbs] of Object.entries(cookingVerbs)) {
        if (method === likely.cooking_method) continue;

        for (const verb of verbs) {
          const regex = new RegExp(`\\b${verb}\\b`, "gi");
          if (regex.test(adjustedStep)) {
            // Replace with detected method's verb
            const replacement = detectedVerbs[0];
            adjustedStep = adjustedStep.replace(regex, replacement);
            wasAdjusted = true;
            likely.cooking_method_adjusted = true;
          }
        }
      }
    }

    likely.instructions.push({
      text: adjustedStep,
      adjusted: wasAdjusted,
      original: wasAdjusted ? step : null
    });
  }

  // Add notes
  likely.notes = Array.isArray(recipeNotes) ? recipeNotes : [];

  // Add vision adjustment note if cooking method was changed
  if (likely.cooking_method_adjusted) {
    likely.notes.push(`Cooking method adjusted to "${likely.cooking_method}" based on visual analysis (${Math.round((likely.cooking_method_confidence || 0) * 100)}% confidence).`);
  }

  // Count sources
  const recipeSourCount = likely.ingredients.filter(i => i.source === "recipe").length;
  const visionSourceCount = likely.ingredients.filter(i => i.source === "vision" || i.source === "vision_nutrition").length;
  const confirmedCount = likely.ingredients.filter(i => i.vision_confirmed).length;

  likely.ingredient_stats = {
    total: likely.ingredients.length,
    from_recipe: recipeSourCount,
    from_vision: visionSourceCount,
    vision_confirmed: confirmedCount
  };

  return likely;
}

/**
 * Build a full cookbook-style recipe using LLM to generate professional instructions.
 * Combines: recipe data, vision insights, plate components, cooking method analysis.
 *
 * @param {Object} env - Environment bindings
 * @param {Object} context - All available dish analysis data
 * @returns {Promise<Object>} Full recipe with cookbook-style instructions
 */
async function buildFullRecipe(env, context) {
  const {
    dishName,
    likelyRecipe,
    visionInsights,
    plateComponents,
    nutritionSummary,
    allergenFlags,
    fodmapFlags,
    menuDescription
  } = context;

  // If no OpenAI key, return enhanced likely_recipe without LLM
  if (!env?.OPENAI_API_KEY) {
    return {
      ...likelyRecipe,
      full_instructions: null,
      generation_method: "fallback_no_llm"
    };
  }

  // Build context for the LLM
  const ingredients = likelyRecipe?.ingredients || [];
  const cookingMethod = likelyRecipe?.cooking_method || "unknown";
  const cookingConfidence = likelyRecipe?.cooking_method_confidence || 0;
  const visualIngredients = visionInsights?.visual_ingredients || [];
  const components = plateComponents || [];

  // Format ingredients for prompt
  const ingredientList = ingredients.map(ing => {
    let line = "";
    if (ing.quantity) line += `${ing.quantity} `;
    if (ing.unit) line += `${ing.unit} `;
    line += ing.name || "unknown";
    if (ing.source === "vision") line += " (visually detected)";
    if (ing.vision_confirmed) line += " (confirmed by vision)";
    return line.trim();
  }).filter(Boolean);

  // Format plate components
  const componentDescriptions = components.map(c => {
    return `${c.role || "component"}: ${c.label || c.category || "unknown"} (${Math.round((c.area_ratio || 0) * 100)}% of plate)`;
  });

  // Allergen notes for recipe warnings
  const allergenWarnings = (allergenFlags || [])
    .filter(a => a.present === "yes" || a.present === "maybe")
    .map(a => a.kind);

  // Build the prompt
  const systemPrompt = `You are a professional chef and cookbook author. Your task is to write a complete, detailed recipe that reads like it belongs in a high-quality cookbook.

STYLE GUIDELINES:
- Write in a warm, instructive tone as if guiding a home cook through the recipe
- Include timing estimates for each step
- Add chef's tips and technique notes where helpful
- Mention visual and sensory cues (e.g., "until golden brown", "fragrant", "sizzling")
- Group steps logically: prep, cooking, assembly, plating
- Include estimated total time and difficulty level
- Add serving suggestions and variations if appropriate

OUTPUT FORMAT:
Return a JSON object with this exact structure:
{
  "title": "Recipe title",
  "description": "2-3 sentence appetizing description of the dish",
  "difficulty": "Easy" | "Medium" | "Hard",
  "prep_time_minutes": number,
  "cook_time_minutes": number,
  "total_time_minutes": number,
  "servings": number,
  "ingredients": [
    {
      "amount": "1 cup",
      "item": "ingredient name",
      "prep_note": "diced" | null
    }
  ],
  "equipment": ["list of required equipment"],
  "instructions": [
    {
      "step": 1,
      "phase": "prep" | "cook" | "assemble" | "serve",
      "title": "Brief step title",
      "detail": "Full detailed instruction paragraph",
      "time_minutes": number | null,
      "tip": "Optional chef's tip" | null
    }
  ],
  "chef_notes": ["Array of helpful notes, substitutions, or variations"],
  "allergen_warnings": ["List of allergens present"],
  "storage": "How to store leftovers" | null,
  "wine_pairing": "Suggested wine or beverage pairing" | null
}`;

  const userPrompt = `Create a complete cookbook-style recipe for: "${dishName}"

AVAILABLE INFORMATION:

Menu Description: ${menuDescription || "Not provided"}

Detected Cooking Method: ${cookingMethod} (${Math.round(cookingConfidence * 100)}% confidence)

Identified Ingredients (${ingredientList.length} total):
${ingredientList.map((ing, i) => `${i + 1}. ${ing}`).join("\n")}

Plate Components:
${componentDescriptions.length > 0 ? componentDescriptions.join("\n") : "Single dish"}

Nutrition Context:
- Calories: ${nutritionSummary?.energyKcal || "unknown"} kcal
- Protein: ${nutritionSummary?.protein_g || "unknown"}g
- Carbs: ${nutritionSummary?.carbs_g || "unknown"}g
- Fat: ${nutritionSummary?.fat_g || "unknown"}g

Known Allergens: ${allergenWarnings.length > 0 ? allergenWarnings.join(", ") : "None identified"}

FODMAP Level: ${fodmapFlags?.level || "unknown"}

Based on this information, write a complete, professional cookbook-style recipe. Ensure the cooking method matches "${cookingMethod}" and the ingredient quantities make sense for the nutrition profile. If ingredient quantities are missing, estimate reasonable amounts for a typical serving.`;

  try {
    const base = env.OPENAI_API_BASE || "https://api.openai.com";
    const model = env.OPENAI_MODEL_RECIPE || "gpt-4o-mini";

    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      console.error("Full recipe LLM error:", response.status);
      return {
        ...likelyRecipe,
        full_instructions: null,
        generation_method: "fallback_llm_error",
        error: `LLM returned ${response.status}`
      };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return {
        ...likelyRecipe,
        full_instructions: null,
        generation_method: "fallback_empty_response"
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("Full recipe JSON parse error:", e);
      return {
        ...likelyRecipe,
        full_instructions: null,
        generation_method: "fallback_parse_error"
      };
    }

    // Return the full recipe with metadata
    return {
      ...likelyRecipe,
      full_recipe: parsed,
      generation_method: "llm",
      model_used: model
    };

  } catch (e) {
    console.error("Full recipe generation error:", e?.message || e);
    return {
      ...likelyRecipe,
      full_instructions: null,
      generation_method: "fallback_exception",
      error: e?.message || String(e)
    };
  }
}

// Simple Levenshtein-based similarity check
function levenshteinSimilar(a, b, threshold = 0.7) {
  if (!a || !b) return false;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return true;

  const costs = [];
  for (let i = 0; i <= shorter.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= longer.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (shorter.charAt(i - 1) !== longer.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[longer.length] = lastValue;
  }

  const similarity = (longer.length - costs[longer.length]) / longer.length;
  return similarity >= threshold;
}

/**
 * Search for dish suggestions using FTS5 + Levenshtein ranking
 * @param {Object} env - Environment with D1_DB binding
 * @param {string} query - User's search query (possibly misspelled)
 * @param {Object} options - { limit, cuisine }
 * @returns {Promise<Array>} Array of dish suggestions with scores
 */
async function searchDishSuggestions(env, query, options = {}) {
  const { limit = 10, cuisine = null } = options;

  if (!env?.D1_DB) {
    console.warn("searchDishSuggestions: D1_DB not available");
    return [];
  }

  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery || normalizedQuery.length < 2) {
    return [];
  }

  try {
    // Strategy 1: FTS5 prefix search (fast, handles partial matches)
    // Strategy 2: LIKE search as fallback
    // Strategy 3: Fuzzy search with Levenshtein for typo tolerance

    let ftsResults = [];

    // FTS5 search with prefix matching
    const ftsQuery = normalizedQuery.split(/\s+/).map(word => `${word}*`).join(' ');

    try {
      const ftsSql = `
        SELECT d.id, d.name, d.aliases, d.cuisine, d.category, d.popularity_score
        FROM dishes_fts fts
        JOIN dishes d ON d.id = fts.rowid
        WHERE dishes_fts MATCH ?
        ${cuisine ? 'AND d.cuisine = ?' : ''}
        ORDER BY d.popularity_score DESC
        LIMIT ?
      `;
      const ftsParams = cuisine
        ? [ftsQuery, cuisine, limit * 3]
        : [ftsQuery, limit * 3];

      const ftsStmt = await env.D1_DB.prepare(ftsSql).bind(...ftsParams);
      const ftsData = await ftsStmt.all();
      ftsResults = ftsData?.results || [];
    } catch (ftsErr) {
      // FTS table might not exist yet, fall back to LIKE
      console.warn("FTS search failed, using LIKE fallback:", ftsErr.message);
    }

    // LIKE fallback search if FTS returned nothing
    if (ftsResults.length === 0) {
      const likeSql = `
        SELECT id, name, aliases, cuisine, category, popularity_score
        FROM dishes
        WHERE name_normalized LIKE ? OR aliases LIKE ?
        ${cuisine ? 'AND cuisine = ?' : ''}
        ORDER BY popularity_score DESC
        LIMIT ?
      `;
      const likePattern = `%${normalizedQuery}%`;
      const likeParams = cuisine
        ? [likePattern, likePattern, cuisine, limit * 3]
        : [likePattern, likePattern, limit * 3];

      const likeStmt = await env.D1_DB.prepare(likeSql).bind(...likeParams);
      const likeData = await likeStmt.all();
      ftsResults = likeData?.results || [];
    }

    // Strategy 3: If still no results, do fuzzy search across ALL dishes
    // This handles typos like "chiken" -> "chicken"
    if (ftsResults.length === 0) {
      const allSql = `
        SELECT id, name, aliases, cuisine, category, popularity_score
        FROM dishes
        ${cuisine ? 'WHERE cuisine = ?' : ''}
        ORDER BY popularity_score DESC
        LIMIT 200
      `;
      const allParams = cuisine ? [cuisine] : [];
      const allStmt = await env.D1_DB.prepare(allSql).bind(...allParams);
      const allData = await allStmt.all();
      ftsResults = allData?.results || [];
    }

    // Score results using Levenshtein distance for better ranking
    const results = [];
    const queryWords = normalizedQuery.split(/\s+/);

    for (const row of ftsResults) {
      const nameNorm = normalizeText(row.name);
      const nameWords = nameNorm.split(/\s+/);

      // Calculate word-level similarity (handles "chiken parm" matching "chicken parmesan")
      let wordMatchScore = 0;
      for (const qWord of queryWords) {
        let bestWordMatch = 0;
        for (const nWord of nameWords) {
          const dist = levenshtein(qWord, nWord);
          const maxLen = Math.max(qWord.length, nWord.length);
          const sim = maxLen > 0 ? 1 - (dist / maxLen) : 0;
          bestWordMatch = Math.max(bestWordMatch, sim);
        }
        wordMatchScore += bestWordMatch;
      }
      wordMatchScore = queryWords.length > 0 ? wordMatchScore / queryWords.length : 0;

      // Also check full string similarity
      const fullDist = levenshtein(normalizedQuery, nameNorm);
      const fullMaxLen = Math.max(normalizedQuery.length, nameNorm.length);
      const fullSimilarity = fullMaxLen > 0 ? 1 - (fullDist / fullMaxLen) : 0;

      // Check aliases for better matching
      let aliasSimilarity = 0;
      if (row.aliases) {
        const aliasList = row.aliases.split(',').map(a => normalizeText(a.trim()));
        for (const alias of aliasList) {
          // Full alias match
          const aliasDist = levenshtein(normalizedQuery, alias);
          const aliasMaxLen = Math.max(normalizedQuery.length, alias.length);
          const aliasScore = aliasMaxLen > 0 ? 1 - (aliasDist / aliasMaxLen) : 0;
          aliasSimilarity = Math.max(aliasSimilarity, aliasScore);

          // Word-level alias match
          const aliasWords = alias.split(/\s+/);
          let aliasWordScore = 0;
          for (const qWord of queryWords) {
            let bestAliasWordMatch = 0;
            for (const aWord of aliasWords) {
              const dist = levenshtein(qWord, aWord);
              const maxLen = Math.max(qWord.length, aWord.length);
              const sim = maxLen > 0 ? 1 - (dist / maxLen) : 0;
              bestAliasWordMatch = Math.max(bestAliasWordMatch, sim);
            }
            aliasWordScore += bestAliasWordMatch;
          }
          aliasWordScore = queryWords.length > 0 ? aliasWordScore / queryWords.length : 0;
          aliasSimilarity = Math.max(aliasSimilarity, aliasWordScore);
        }
      }

      // Best similarity from all methods
      const bestSimilarity = Math.max(fullSimilarity, wordMatchScore, aliasSimilarity);

      // Only include results with decent similarity (> 0.5)
      if (bestSimilarity < 0.5) continue;

      // Combine similarity with popularity for final score
      const score = (bestSimilarity * 0.7) + ((row.popularity_score || 0) / 100 * 0.3);

      results.push({
        id: row.id,
        name: row.name,
        cuisine: row.cuisine,
        category: row.category,
        similarity: Math.round(bestSimilarity * 100) / 100,
        score: Math.round(score * 100) / 100
      });
    }

    // Sort by score descending and limit
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  } catch (e) {
    console.error("searchDishSuggestions error:", e);
    return [];
  }
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

  // LATENCY OPTIMIZATION: Parallelize compound lookups
  // Step 1: Run all compound lookups in parallel
  const compoundResults = await Promise.all(
    names.map(async (name) => {
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
        return { name, comps: compRes?.results || [] };
      } catch {
        return { name, comps: [] };
      }
    })
  );

  // Step 2: Collect unique compound IDs for organ effect lookup
  const uniqueCompounds = new Map(); // id -> { compound, ingredientName }
  for (const { name, comps } of compoundResults) {
    for (const c of comps) {
      if (!uniqueCompounds.has(c.id)) {
        uniqueCompounds.set(c.id, { compound: c, ingredientName: name });
      }
    }
  }

  // Step 3: Run all organ effect lookups in parallel
  const effectResults = await Promise.all(
    Array.from(uniqueCompounds.entries()).map(async ([compId, { compound, ingredientName }]) => {
      try {
        const effRes = await env.D1_DB.prepare(
          `SELECT organ, effect, strength
           FROM compound_organ_effects
           WHERE compound_id = ?`
        )
          .bind(compId)
          .all();
        return { compound, ingredientName, effects: effRes?.results || [] };
      } catch {
        return { compound, ingredientName, effects: [] };
      }
    })
  );

  // Step 4: Build results from parallel lookups
  for (const { compound: c, ingredientName, effects } of effectResults) {
    for (const e of effects) {
      const organKey = (e.organ || "unknown").toLowerCase().trim();
      if (!organKey) continue;
      if (!organs[organKey]) {
        organs[organKey] = { plus: 0, minus: 0, neutral: 0 };
        compoundsByOrgan[organKey] = new Set();
      }
      if (e.effect === "benefit") organs[organKey].plus++;
      else if (e.effect === "risk") organs[organKey].minus++;
      else organs[organKey].neutral++;

      compoundsByOrgan[organKey].add(c.name || c.common_name || ingredientName);
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

// Read a cached menu snapshot from KV.
// Returns { savedAt, data, ageSeconds, isStale } or null.
// isStale=true means the menu should be refreshed in the background (but still served).
async function readMenuFromCache(env, key) {
  if (!env?.MENUS_CACHE) return null;
  try {
    const raw = await env.MENUS_CACHE.get(key);
    if (!raw) return null;
    const js = JSON.parse(raw);
    // Expect shape: { savedAt: ISO, data: { query, address, forceUS, items: [...] } }
    if (!js || typeof js !== "object" || !js.data) return null;

    // Calculate age and staleness
    const savedAt = js.savedAt ? new Date(js.savedAt).getTime() : 0;
    const ageSeconds = savedAt ? Math.floor((Date.now() - savedAt) / 1000) : 0;
    const isStale = ageSeconds > MENU_STALE_SECONDS;

    return { ...js, ageSeconds, isStale };
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

// Background refresh: fetch fresh menu data and update cache (non-blocking).
// Called when serving stale cache to ensure next request gets fresh data.
async function refreshMenuInBackground(env, { query, address, forceUS, cacheKey }) {
  console.log(`[menu-refresh] Starting background refresh for: ${query} @ ${address}`);
  try {
    // Use the same tiered job fetcher as live requests
    let addr = address;
    if (forceUS && !/usa|united states/i.test(addr)) {
      addr = `${address}, USA`;
    }

    const job = await postJobByAddressTiered({ query, address: addr, maxRows: 50 }, env);

    if (job?.immediate) {
      const rows = job.raw?.returnvalue?.data || [];
      const rowsUS = filterRowsUS(rows, forceUS);

      // Pick best restaurant
      const googleContext = { name: query, address };
      const best = pickBestRestaurant({ rows: rowsUS, query, googleContext });
      const chosen = best || (rowsUS.length ? rowsUS[0] : null);

      if (chosen?.menu?.length) {
        const items = chosen.menu.map(m => normalizeMenuItem(m, chosen));
        const finalKey = cacheKey || cacheKeyForMenu(query, address, forceUS);

        await writeMenuToCache(env, finalKey, {
          query,
          address,
          forceUS,
          items
        });
        console.log(`[menu-refresh] Successfully refreshed: ${query} @ ${address} (${items.length} items)`);
        return { ok: true, items: items.length };
      }
    }
    console.log(`[menu-refresh] No menu data found for: ${query} @ ${address}`);
    return { ok: false, reason: "no_data" };
  } catch (err) {
    console.log(`[menu-refresh] Error refreshing ${query}: ${err?.message}`);
    return { ok: false, error: err?.message };
  }
}

// Get list of stale menu cache entries (for scheduled refresh).
async function getStaleMenuEntries(env, limit = 50) {
  if (!env?.MENUS_CACHE) return [];
  const staleEntries = [];
  let cursor = undefined;

  do {
    const list = await env.MENUS_CACHE.list({ prefix: "menu/", limit: 100, cursor });
    for (const key of list.keys) {
      if (staleEntries.length >= limit) break;
      try {
        const cached = await readMenuFromCache(env, key.name);
        if (cached?.isStale) {
          staleEntries.push({
            key: key.name,
            savedAt: cached.savedAt,
            ageSeconds: cached.ageSeconds,
            ageDays: Math.floor(cached.ageSeconds / 86400),
            query: cached.data?.query,
            address: cached.data?.address,
            forceUS: cached.data?.forceUS
          });
        }
      } catch {}
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor && staleEntries.length < limit);

  return staleEntries;
}
// ==========================================================================

// === Franchise Menu System =================================================
// Implements hierarchical menu inheritance (GLOBAL → COUNTRY → REGION → STORE)
// with append-only provenance tracking and 15-day auto-renewal.
// CRITICAL: NOTHING IS EVER DELETED - only status updates to INACTIVE.

// Configuration constants
const FRANCHISE_CONFIG = {
  ACTIVE_WINDOW_DAYS: 45,        // Items seen within this window are considered active
  INACTIVE_AFTER_DAYS: 90,       // Mark as INACTIVE if not seen for this long
  STORE_REFRESH_INTERVAL_DAYS: 15, // Reconcile stores every N days
  FUZZY_MATCH_THRESHOLD: 0.92,   // Minimum similarity for fuzzy matching
  TOKEN_OVERLAP_THRESHOLD: 0.85, // Minimum token overlap for matching
  PROMOTION_THRESHOLDS: {
    STORE_TO_REGION: { min_stores: 3, min_confidence: 0.70, window_days: 30 },
    REGION_TO_COUNTRY: { min_regions: 3, min_confidence: 0.75, window_days: 45 },
    COUNTRY_TO_GLOBAL: { min_countries: 3, min_confidence: 0.80, window_days: 90 }
  }
};

// --- Brand Detection ---

/**
 * Normalize a restaurant name for brand matching
 * @param {string} name - Restaurant name (e.g., "McDonald's #12345")
 * @returns {string} - Normalized name (e.g., "mcdonalds")
 */
function normalizeBrandName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[''`]/g, "")                    // Remove apostrophes
    .replace(/[®™©]/g, "")                    // Remove trademark symbols
    .replace(/#\s*\d+/g, "")                  // Remove store numbers (#123)
    .replace(/\(\s*[^)]*\s*\)/g, "")          // Remove parentheticals
    .replace(/\s+(at|in|on|near)\s+.*/i, "") // Remove location suffixes
    .replace(/-\s*(terminal|gate|mall|plaza|airport|station).*$/i, "") // Remove venue suffixes
    .replace(/[^a-z0-9]/g, "")                // Keep only alphanumeric
    .trim();
}

/**
 * Detect brand from a place object
 * @param {Object} env - Cloudflare env bindings
 * @param {Object} place - Place object with name, address, etc.
 * @returns {Promise<Object|null>} - Brand record or null
 */
async function detectBrand(env, place) {
  if (!env?.D1_DB || !place?.name) return null;

  const normalized = normalizeBrandName(place.name);
  if (!normalized) return null;

  try {
    // Try exact match first
    const exact = await env.D1_DB.prepare(
      "SELECT * FROM brands WHERE normalized_name = ?"
    ).bind(normalized).first();

    if (exact) return exact;

    // Try contains match (for names like "The McDonald's Restaurant")
    const contains = await env.D1_DB.prepare(
      "SELECT * FROM brands WHERE ? LIKE '%' || normalized_name || '%' ORDER BY LENGTH(normalized_name) DESC LIMIT 1"
    ).bind(normalized).first();

    return contains || null;
  } catch (err) {
    console.log("[franchise] Brand detection error:", err?.message);
    return null;
  }
}

/**
 * Derive region code from address components
 * Format: {COUNTRY}-{STATE/PROVINCE} e.g., "US-FL", "US-CA", "GB-LND", "MX-CDMX"
 */
function deriveRegionCode(countryCode, stateProvince) {
  if (!countryCode) return null;
  const cc = countryCode.toUpperCase();
  if (!stateProvince) return cc;

  // Normalize state/province
  const sp = stateProvince.toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 4); // Max 4 chars

  return `${cc}-${sp}`;
}

// --- Store Management ---

/**
 * Upsert a store record (create or update, never delete)
 */
async function upsertStore(env, storeData) {
  if (!env?.D1_DB) return null;

  const {
    place_id, uber_store_id, brand_id,
    name, address, city, state_province, postal_code,
    country_code, latitude, longitude, source
  } = storeData;

  const normalized_name = normalizeBrandName(name);
  const region_code = deriveRegionCode(country_code, state_province);
  const now = new Date().toISOString();

  try {
    // Try to find existing store
    let existing = null;
    if (place_id) {
      existing = await env.D1_DB.prepare(
        "SELECT * FROM stores WHERE place_id = ?"
      ).bind(place_id).first();
    }
    if (!existing && uber_store_id) {
      existing = await env.D1_DB.prepare(
        "SELECT * FROM stores WHERE uber_store_id = ?"
      ).bind(uber_store_id).first();
    }

    if (existing) {
      // Update existing store
      await env.D1_DB.prepare(`
        UPDATE stores SET
          brand_id = COALESCE(?, brand_id),
          name = COALESCE(?, name),
          normalized_name = COALESCE(?, normalized_name),
          address = COALESCE(?, address),
          city = COALESCE(?, city),
          state_province = COALESCE(?, state_province),
          postal_code = COALESCE(?, postal_code),
          country_code = COALESCE(?, country_code),
          region_code = COALESCE(?, region_code),
          latitude = COALESCE(?, latitude),
          longitude = COALESCE(?, longitude),
          uber_store_id = COALESCE(?, uber_store_id),
          last_seen_at = ?,
          status = 'ACTIVE',
          updated_at = ?
        WHERE id = ?
      `).bind(
        brand_id, name, normalized_name, address, city, state_province,
        postal_code, country_code, region_code, latitude, longitude,
        uber_store_id, now, now, existing.id
      ).run();

      return { ...existing, brand_id, updated: true };
    } else {
      // Insert new store
      const result = await env.D1_DB.prepare(`
        INSERT INTO stores (
          place_id, uber_store_id, brand_id, name, normalized_name,
          address, city, state_province, postal_code, country_code, region_code,
          latitude, longitude, source, status, first_seen_at, last_seen_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
      `).bind(
        place_id, uber_store_id, brand_id, name, normalized_name,
        address, city, state_province, postal_code, country_code, region_code,
        latitude, longitude, source, now, now, now, now
      ).run();

      return { id: result.meta?.last_row_id, place_id, brand_id, created: true };
    }
  } catch (err) {
    console.log("[franchise] Store upsert error:", err?.message);
    return null;
  }
}

/**
 * Get store by place_id or uber_store_id
 */
async function getStore(env, { place_id, uber_store_id, store_id }) {
  if (!env?.D1_DB) return null;

  try {
    if (store_id) {
      return await env.D1_DB.prepare("SELECT * FROM stores WHERE id = ?").bind(store_id).first();
    }
    if (place_id) {
      return await env.D1_DB.prepare("SELECT * FROM stores WHERE place_id = ?").bind(place_id).first();
    }
    if (uber_store_id) {
      return await env.D1_DB.prepare("SELECT * FROM stores WHERE uber_store_id = ?").bind(uber_store_id).first();
    }
    return null;
  } catch (err) {
    console.log("[franchise] Get store error:", err?.message);
    return null;
  }
}

// --- Menu Item Identity Resolution ---

/**
 * Normalize menu item name for matching
 */
function normalizeMenuItemName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[®™©]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

/**
 * Resolve an observed menu item name to a canonical franchise_menu_items record
 * Uses: exact match → alias match → fuzzy match → create new
 */
async function resolveMenuItem(env, brandId, observedName, observedData = {}) {
  if (!env?.D1_DB || !brandId || !observedName) return null;

  const normalized = normalizeMenuItemName(observedName);
  if (!normalized) return null;

  try {
    // 1. Exact match on franchise_menu_items
    const exactItem = await env.D1_DB.prepare(`
      SELECT * FROM franchise_menu_items
      WHERE brand_id = ? AND normalized_name = ?
    `).bind(brandId, normalized).first();

    if (exactItem) {
      return { item: exactItem, matchMethod: "exact" };
    }

    // 2. Alias match
    const aliasMatch = await env.D1_DB.prepare(`
      SELECT fmi.* FROM franchise_menu_items fmi
      JOIN menu_item_aliases mia ON mia.menu_item_id = fmi.id
      WHERE fmi.brand_id = ? AND mia.alias_normalized = ?
    `).bind(brandId, normalized).first();

    if (aliasMatch) {
      return { item: aliasMatch, matchMethod: "alias" };
    }

    // 3. Create new item (conservative - no fuzzy matching for now)
    const now = new Date().toISOString();
    const result = await env.D1_DB.prepare(`
      INSERT INTO franchise_menu_items (
        brand_id, canonical_name, normalized_name, category, description,
        calories, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'CANDIDATE', ?, ?)
    `).bind(
      brandId, observedName, normalized,
      observedData.category || observedData.section || null,
      observedData.description || null,
      observedData.calories || null,
      now, now
    ).run();

    const newItem = await env.D1_DB.prepare(
      "SELECT * FROM franchise_menu_items WHERE id = ?"
    ).bind(result.meta?.last_row_id).first();

    // Add the original observed name as an alias
    if (newItem) {
      await env.D1_DB.prepare(`
        INSERT OR IGNORE INTO menu_item_aliases (menu_item_id, alias_text, alias_normalized, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(newItem.id, observedName, normalized, now).run();
    }

    return { item: newItem, matchMethod: "created", isNew: true };
  } catch (err) {
    console.log("[franchise] Resolve menu item error:", err?.message);
    return null;
  }
}

// --- Sightings (Append-Only Provenance) ---

/**
 * Record a menu item sighting (immutable - never update or delete)
 */
async function recordSighting(env, {
  menu_item_id, store_id, source_type, source_ref,
  observed_name, observed_description, observed_price_cents,
  observed_calories, observed_section, observed_image_url,
  confidence, match_method, raw_payload_ref
}) {
  if (!env?.D1_DB || !menu_item_id || !store_id) return null;

  const now = new Date().toISOString();

  try {
    const result = await env.D1_DB.prepare(`
      INSERT INTO menu_item_sightings (
        menu_item_id, store_id, source_type, source_ref,
        observed_name, observed_description, observed_price_cents,
        observed_calories, observed_section, observed_image_url,
        confidence, match_method, observed_at, raw_payload_ref, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      menu_item_id, store_id, source_type || "ubereats", source_ref,
      observed_name, observed_description, observed_price_cents,
      observed_calories, observed_section, observed_image_url,
      confidence || 0.7, match_method, now, raw_payload_ref, now
    ).run();

    return { id: result.meta?.last_row_id, recorded: true };
  } catch (err) {
    console.log("[franchise] Record sighting error:", err?.message);
    return null;
  }
}

// --- Scope Management (Current State - Mutable) ---

/**
 * Upsert a menu item scope (GLOBAL/COUNTRY/REGION/STORE)
 * NEVER deletes - only updates status
 */
async function upsertScope(env, {
  menu_item_id, scope_type, scope_key, status, confidence, price_cents
}) {
  if (!env?.D1_DB || !menu_item_id || !scope_type) return null;

  const now = new Date().toISOString();

  try {
    // Check if scope exists
    const existing = await env.D1_DB.prepare(`
      SELECT * FROM menu_item_scopes
      WHERE menu_item_id = ? AND scope_type = ? AND (scope_key = ? OR (scope_key IS NULL AND ? IS NULL))
    `).bind(menu_item_id, scope_type, scope_key, scope_key).first();

    if (existing) {
      // Update existing scope
      await env.D1_DB.prepare(`
        UPDATE menu_item_scopes SET
          status = COALESCE(?, status),
          confidence = COALESCE(?, confidence),
          last_seen_at = ?,
          last_reconciled_at = ?,
          price_cents = COALESCE(?, price_cents),
          updated_at = ?
        WHERE id = ?
      `).bind(
        status, confidence, now, now, price_cents, now, existing.id
      ).run();

      return { id: existing.id, updated: true };
    } else {
      // Insert new scope
      const result = await env.D1_DB.prepare(`
        INSERT INTO menu_item_scopes (
          menu_item_id, scope_type, scope_key, status, confidence,
          first_seen_at, last_seen_at, last_reconciled_at,
          price_cents, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        menu_item_id, scope_type, scope_key,
        status || "CANDIDATE", confidence || 0.5,
        now, now, now, price_cents, now, now
      ).run();

      return { id: result.meta?.last_row_id, created: true };
    }
  } catch (err) {
    console.log("[franchise] Upsert scope error:", err?.message);
    return null;
  }
}

// --- Effective Menu Builder (Inheritance) ---

/**
 * Get effective menu for a store using hierarchical inheritance
 * GLOBAL → COUNTRY → REGION → STORE (later overrides earlier)
 */
async function getEffectiveMenu(env, storeId) {
  if (!env?.D1_DB || !storeId) return null;

  try {
    // Get store with brand info
    const store = await env.D1_DB.prepare(`
      SELECT s.*, b.canonical_name as brand_name
      FROM stores s
      LEFT JOIN brands b ON b.id = s.brand_id
      WHERE s.id = ?
    `).bind(storeId).first();

    if (!store) return { ok: false, error: "Store not found" };
    if (!store.brand_id) {
      // Non-franchise store - fall back to regular menu cache
      return { ok: false, error: "Not a franchise store", store };
    }

    // Build scope keys for inheritance
    const scopeKeys = {
      GLOBAL: null,
      COUNTRY: store.country_code,
      REGION: store.region_code,
      STORE: String(store.id)
    };

    // Query all relevant scopes with item details
    const scopes = await env.D1_DB.prepare(`
      SELECT
        fmi.id as item_id,
        fmi.canonical_name,
        fmi.normalized_name,
        fmi.category,
        fmi.description,
        fmi.calories,
        mis.scope_type,
        mis.scope_key,
        mis.status,
        mis.confidence,
        mis.first_seen_at,
        mis.last_seen_at,
        mis.price_cents
      FROM menu_item_scopes mis
      JOIN franchise_menu_items fmi ON fmi.id = mis.menu_item_id
      WHERE fmi.brand_id = ?
        AND (
          (mis.scope_type = 'GLOBAL' AND mis.scope_key IS NULL)
          OR (mis.scope_type = 'COUNTRY' AND mis.scope_key = ?)
          OR (mis.scope_type = 'REGION' AND mis.scope_key = ?)
          OR (mis.scope_type = 'STORE' AND mis.scope_key = ?)
        )
      ORDER BY fmi.id,
        CASE mis.scope_type
          WHEN 'GLOBAL' THEN 1
          WHEN 'COUNTRY' THEN 2
          WHEN 'REGION' THEN 3
          WHEN 'STORE' THEN 4
        END
    `).bind(
      store.brand_id,
      scopeKeys.COUNTRY,
      scopeKeys.REGION,
      scopeKeys.STORE
    ).all();

    // Merge items with inheritance (later scope overrides earlier)
    const itemMap = new Map();
    const scopePriority = { GLOBAL: 1, COUNTRY: 2, REGION: 3, STORE: 4 };

    for (const row of scopes.results || []) {
      const existing = itemMap.get(row.item_id);
      const newPriority = scopePriority[row.scope_type] || 0;
      const existingPriority = existing ? (scopePriority[existing.scope_type] || 0) : 0;

      // INACTIVE at a later scope suppresses earlier scope
      if (row.status === "INACTIVE" && newPriority > existingPriority) {
        itemMap.delete(row.item_id);
        continue;
      }

      // Later scope overrides earlier, or update if same scope with higher confidence
      if (!existing || newPriority > existingPriority ||
          (newPriority === existingPriority && row.confidence > existing.confidence)) {
        itemMap.set(row.item_id, {
          id: row.item_id,
          name: row.canonical_name,
          normalized_name: row.normalized_name,
          category: row.category,
          description: row.description,
          calories: row.calories,
          price_cents: row.price_cents,
          status: row.status,
          confidence: row.confidence,
          scope_type: row.scope_type,
          last_seen_at: row.last_seen_at
        });
      }
    }

    // Filter to only ACTIVE/SEASONAL items
    const activeItems = Array.from(itemMap.values())
      .filter(item => item.status === "ACTIVE" || item.status === "SEASONAL");

    return {
      ok: true,
      store: {
        id: store.id,
        name: store.name,
        brand_id: store.brand_id,
        brand_name: store.brand_name,
        country_code: store.country_code,
        region_code: store.region_code
      },
      items: activeItems,
      item_count: activeItems.length,
      scope_summary: {
        GLOBAL: activeItems.filter(i => i.scope_type === "GLOBAL").length,
        COUNTRY: activeItems.filter(i => i.scope_type === "COUNTRY").length,
        REGION: activeItems.filter(i => i.scope_type === "REGION").length,
        STORE: activeItems.filter(i => i.scope_type === "STORE").length
      }
    };
  } catch (err) {
    console.log("[franchise] Get effective menu error:", err?.message);
    return { ok: false, error: err?.message };
  }
}

// --- Store Menu Snapshots (Append-Only) ---

/**
 * Create a store menu snapshot (immutable)
 */
async function createSnapshot(env, storeId, menuItems, sourceType, sourceUrl) {
  if (!env?.D1_DB || !storeId || !menuItems) return null;

  const now = new Date().toISOString();

  // Compute menu hash for change detection
  const normalizedMenu = menuItems
    .map(item => normalizeMenuItemName(item.name || item.title))
    .sort()
    .join("|");

  const encoder = new TextEncoder();
  const data = encoder.encode(normalizedMenu);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const menuHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

  try {
    // Check if identical snapshot already exists (same hash)
    const existing = await env.D1_DB.prepare(`
      SELECT id FROM store_menu_snapshots
      WHERE store_id = ? AND menu_hash = ?
      ORDER BY snapshot_at DESC LIMIT 1
    `).bind(storeId, menuHash).first();

    if (existing) {
      return { id: existing.id, unchanged: true, menuHash };
    }

    // Store payload in R2 if available
    let payloadRef = null;
    if (env.R2_BUCKET) {
      const payloadKey = `snapshots/${storeId}/${now.replace(/[:.]/g, "-")}.json`;
      await env.R2_BUCKET.put(payloadKey, JSON.stringify({
        store_id: storeId,
        snapshot_at: now,
        source_type: sourceType,
        source_url: sourceUrl,
        items: menuItems
      }));
      payloadRef = payloadKey;
    }

    // Insert snapshot
    const result = await env.D1_DB.prepare(`
      INSERT INTO store_menu_snapshots (
        store_id, snapshot_at, menu_hash, item_count,
        source_type, source_url, payload_ref, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      storeId, now, menuHash, menuItems.length,
      sourceType || "ubereats", sourceUrl, payloadRef, now
    ).run();

    return {
      id: result.meta?.last_row_id,
      menuHash,
      itemCount: menuItems.length,
      payloadRef,
      created: true
    };
  } catch (err) {
    console.log("[franchise] Create snapshot error:", err?.message);
    return null;
  }
}

// --- Delta Discovery ---

/**
 * Run delta discovery for a store (background job)
 * Extracts menu, creates snapshot, resolves items, records sightings, updates scopes
 */
async function deltaMenuDiscovery(env, storeId, menuItems, sourceType = "ubereats") {
  if (!env?.D1_DB || !storeId || !menuItems?.length) {
    return { ok: false, error: "Missing required data" };
  }

  try {
    // Get store
    const store = await getStore(env, { store_id: storeId });
    if (!store || !store.brand_id) {
      return { ok: false, error: "Store not found or not a franchise" };
    }

    // Create snapshot
    const snapshot = await createSnapshot(env, storeId, menuItems, sourceType);
    if (snapshot?.unchanged) {
      console.log(`[franchise] Delta discovery: no changes for store ${storeId}`);
      return { ok: true, unchanged: true, snapshot };
    }

    // Process each menu item
    const results = {
      resolved: 0,
      created: 0,
      sightings: 0,
      scopes_updated: 0
    };

    const now = new Date().toISOString();
    const seenItemIds = new Set();

    for (const menuItem of menuItems) {
      const observedName = menuItem.name || menuItem.title;
      if (!observedName) continue;

      // Resolve to canonical item
      const resolved = await resolveMenuItem(env, store.brand_id, observedName, {
        category: menuItem.section || menuItem.category,
        description: menuItem.description,
        calories: menuItem.restaurantCalories || menuItem.calories
      });

      if (!resolved?.item) continue;

      const item = resolved.item;
      seenItemIds.add(item.id);

      if (resolved.isNew) {
        results.created++;
      } else {
        results.resolved++;
      }

      // Record sighting
      const sighting = await recordSighting(env, {
        menu_item_id: item.id,
        store_id: storeId,
        source_type: sourceType,
        observed_name: observedName,
        observed_description: menuItem.description,
        observed_price_cents: menuItem.price,
        observed_calories: menuItem.restaurantCalories || menuItem.calories,
        observed_section: menuItem.section,
        observed_image_url: menuItem.imageUrl,
        confidence: resolved.isNew ? 0.55 : 0.75,
        match_method: resolved.matchMethod,
        raw_payload_ref: snapshot?.payloadRef
      });

      if (sighting) results.sightings++;

      // Update STORE scope
      const scope = await upsertScope(env, {
        menu_item_id: item.id,
        scope_type: "STORE",
        scope_key: String(storeId),
        status: "ACTIVE",
        confidence: resolved.isNew ? 0.55 : 0.75,
        price_cents: menuItem.price
      });

      if (scope) results.scopes_updated++;
    }

    // Mark items NOT seen as potentially inactive (only if last_seen > INACTIVE_AFTER_DAYS)
    const inactiveCutoff = new Date(Date.now() - FRANCHISE_CONFIG.INACTIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

    await env.D1_DB.prepare(`
      UPDATE menu_item_scopes
      SET status = 'INACTIVE', updated_at = ?
      WHERE scope_type = 'STORE' AND scope_key = ?
        AND status != 'INACTIVE'
        AND last_seen_at < ?
        AND menu_item_id NOT IN (${Array.from(seenItemIds).join(",") || "0"})
    `).bind(now, String(storeId), inactiveCutoff).run();

    // Update store reconciliation timestamp
    const nextReconcile = new Date(Date.now() + FRANCHISE_CONFIG.STORE_REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await env.D1_DB.prepare(`
      UPDATE stores SET
        last_reconciled_at = ?,
        next_reconcile_after = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(now, nextReconcile, now, storeId).run();

    return {
      ok: true,
      store_id: storeId,
      snapshot,
      results
    };
  } catch (err) {
    console.log("[franchise] Delta discovery error:", err?.message);
    return { ok: false, error: err?.message };
  }
}

// --- Reconciliation Batch Job ---

/**
 * Get stores due for reconciliation (for cron job)
 */
async function getStoresDueForReconcile(env, limit = 10) {
  if (!env?.D1_DB) return [];

  const now = new Date().toISOString();

  try {
    // Get stores where next_reconcile_after has passed or is NULL
    const result = await env.D1_DB.prepare(`
      SELECT s.*, b.canonical_name as brand_name
      FROM stores s
      LEFT JOIN brands b ON b.id = s.brand_id
      WHERE s.status = 'ACTIVE'
        AND s.brand_id IS NOT NULL
        AND (s.next_reconcile_after IS NULL OR s.next_reconcile_after <= ?)
      ORDER BY s.next_reconcile_after ASC NULLS FIRST
      LIMIT ?
    `).bind(now, limit).all();

    return result.results || [];
  } catch (err) {
    console.log("[franchise] Get stores for reconcile error:", err?.message);
    return [];
  }
}

// --- Promotion Jobs ---

/**
 * Promote items from STORE scope to REGION scope
 * Runs periodically to identify widely available items
 */
async function promoteStoreToRegion(env, brandId) {
  if (!env?.D1_DB || !brandId) return { ok: false };

  const config = FRANCHISE_CONFIG.PROMOTION_THRESHOLDS.STORE_TO_REGION;
  const cutoffDate = new Date(Date.now() - config.window_days * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  try {
    // Find items seen in multiple stores in the same region
    const candidates = await env.D1_DB.prepare(`
      SELECT
        fmi.id as menu_item_id,
        s.region_code,
        COUNT(DISTINCT s.id) as store_count,
        AVG(mis.confidence) as avg_confidence
      FROM menu_item_sightings mis
      JOIN franchise_menu_items fmi ON fmi.id = mis.menu_item_id
      JOIN stores s ON s.id = mis.store_id
      WHERE fmi.brand_id = ?
        AND mis.observed_at >= ?
        AND s.region_code IS NOT NULL
      GROUP BY fmi.id, s.region_code
      HAVING store_count >= ? AND avg_confidence >= ?
    `).bind(brandId, cutoffDate, config.min_stores, config.min_confidence).all();

    let promoted = 0;
    for (const candidate of candidates.results || []) {
      // Check if REGION scope already exists
      const existing = await env.D1_DB.prepare(`
        SELECT id FROM menu_item_scopes
        WHERE menu_item_id = ? AND scope_type = 'REGION' AND scope_key = ?
      `).bind(candidate.menu_item_id, candidate.region_code).first();

      if (!existing) {
        await upsertScope(env, {
          menu_item_id: candidate.menu_item_id,
          scope_type: "REGION",
          scope_key: candidate.region_code,
          status: "ACTIVE",
          confidence: candidate.avg_confidence
        });
        promoted++;
      }
    }

    return { ok: true, promoted, checked: candidates.results?.length || 0 };
  } catch (err) {
    console.log("[franchise] Promote store to region error:", err?.message);
    return { ok: false, error: err?.message };
  }
}

/**
 * Promote items from REGION scope to COUNTRY scope
 */
async function promoteRegionToCountry(env, brandId) {
  if (!env?.D1_DB || !brandId) return { ok: false };

  const config = FRANCHISE_CONFIG.PROMOTION_THRESHOLDS.REGION_TO_COUNTRY;
  const cutoffDate = new Date(Date.now() - config.window_days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const candidates = await env.D1_DB.prepare(`
      SELECT
        mis_scope.menu_item_id,
        s.country_code,
        COUNT(DISTINCT s.region_code) as region_count,
        AVG(mis_scope.confidence) as avg_confidence
      FROM menu_item_scopes mis_scope
      JOIN franchise_menu_items fmi ON fmi.id = mis_scope.menu_item_id
      JOIN stores s ON mis_scope.scope_key = s.region_code
      WHERE fmi.brand_id = ?
        AND mis_scope.scope_type = 'REGION'
        AND mis_scope.status = 'ACTIVE'
        AND mis_scope.last_seen_at >= ?
        AND s.country_code IS NOT NULL
      GROUP BY mis_scope.menu_item_id, s.country_code
      HAVING region_count >= ? AND avg_confidence >= ?
    `).bind(brandId, cutoffDate, config.min_regions, config.min_confidence).all();

    let promoted = 0;
    for (const candidate of candidates.results || []) {
      const existing = await env.D1_DB.prepare(`
        SELECT id FROM menu_item_scopes
        WHERE menu_item_id = ? AND scope_type = 'COUNTRY' AND scope_key = ?
      `).bind(candidate.menu_item_id, candidate.country_code).first();

      if (!existing) {
        await upsertScope(env, {
          menu_item_id: candidate.menu_item_id,
          scope_type: "COUNTRY",
          scope_key: candidate.country_code,
          status: "ACTIVE",
          confidence: candidate.avg_confidence
        });
        promoted++;
      }
    }

    return { ok: true, promoted, checked: candidates.results?.length || 0 };
  } catch (err) {
    console.log("[franchise] Promote region to country error:", err?.message);
    return { ok: false, error: err?.message };
  }
}

/**
 * Mark stale scopes as INACTIVE (NO DELETION - status flip only)
 */
async function markStaleInactive(env, brandId) {
  if (!env?.D1_DB) return { ok: false };

  const inactiveCutoff = new Date(Date.now() - FRANCHISE_CONFIG.INACTIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  try {
    const result = await env.D1_DB.prepare(`
      UPDATE menu_item_scopes
      SET status = 'INACTIVE', updated_at = ?
      WHERE menu_item_id IN (
        SELECT id FROM franchise_menu_items WHERE brand_id = ?
      )
      AND status != 'INACTIVE'
      AND last_seen_at < ?
    `).bind(now, brandId, inactiveCutoff).run();

    return { ok: true, marked_inactive: result.meta?.changes || 0 };
  } catch (err) {
    console.log("[franchise] Mark stale inactive error:", err?.message);
    return { ok: false, error: err?.message };
  }
}

// ==========================================================================

// === Vision Correction System ==============================================
// Corrects recipe/ingredient data based on visual evidence from dish photos.
// When vision detects a mismatch (e.g., sees spaghetti but recipe says penne),
// the correction is applied to align the analysis with visual reality.

/**
 * Food attribute categories that vision can correct
 */
const VISION_CORRECTION_CATEGORIES = {
  // Pasta types - what vision might see vs recipe variations
  pasta: {
    variants: [
      "spaghetti", "penne", "rigatoni", "fettuccine", "linguine", "tagliatelle",
      "fusilli", "farfalle", "rotini", "macaroni", "ziti", "bucatini",
      "angel hair", "capellini", "orzo", "lasagna", "ravioli", "tortellini",
      "gnocchi", "pappardelle", "orecchiette", "cavatappi"
    ],
    visual_cues: {
      spaghetti: ["long thin round strands", "round cross-section noodles"],
      penne: ["tube-shaped", "diagonal cut ends", "hollow tubes"],
      rigatoni: ["large ridged tubes", "wide hollow cylinders"],
      fettuccine: ["flat wide ribbons", "thick flat noodles"],
      linguine: ["flat thin strands", "elliptical cross-section"],
      fusilli: ["spiral shaped", "corkscrew pasta"],
      farfalle: ["bow-tie shaped", "butterfly pasta"],
      lasagna: ["wide flat sheets", "layered flat pasta"],
      ravioli: ["filled square pillows", "stuffed pasta squares"],
      tortellini: ["ring-shaped filled pasta", "belly button pasta"],
      gnocchi: ["small dumplings", "pillowy potato pasta"]
    }
  },

  // Rice types
  rice: {
    variants: [
      "white rice", "brown rice", "fried rice", "jasmine rice", "basmati rice",
      "wild rice", "risotto", "sushi rice", "sticky rice", "pilaf",
      "yellow rice", "spanish rice", "coconut rice", "rice pilaf"
    ],
    visual_cues: {
      "white rice": ["plain white grains", "steamed white"],
      "brown rice": ["tan/brown grains", "darker grain color"],
      "fried rice": ["mixed with vegetables/egg", "stir-fried appearance", "glossy oily grains"],
      "yellow rice": ["yellow-tinted grains", "saffron/turmeric colored"],
      "wild rice": ["dark brown/black grains", "long dark grains"]
    }
  },

  // Bread types
  bread: {
    variants: [
      "white bread", "whole wheat", "sourdough", "ciabatta", "baguette",
      "brioche", "focaccia", "pita", "naan", "tortilla", "croissant",
      "rye bread", "pumpernickel", "multigrain", "flatbread"
    ],
    visual_cues: {
      sourdough: ["rustic crust", "open crumb structure", "artisan appearance"],
      brioche: ["golden shiny top", "rich yellow crumb"],
      ciabatta: ["flat rustic shape", "large holes in crumb"],
      baguette: ["long thin loaf", "crusty exterior"],
      "whole wheat": ["darker brown color", "visible grain specks"]
    }
  },

  // Protein types
  protein: {
    variants: [
      "chicken", "beef", "pork", "lamb", "turkey", "duck",
      "salmon", "tuna", "cod", "tilapia", "shrimp", "lobster", "crab",
      "tofu", "tempeh", "seitan"
    ],
    visual_cues: {
      salmon: ["orange-pink flesh", "distinctive salmon color"],
      tuna: ["deep red/pink flesh", "steak-like appearance"],
      shrimp: ["curved pink bodies", "visible tail segments"],
      chicken: ["white meat", "light colored flesh"],
      beef: ["red/brown meat", "darker meat color"]
    }
  },

  // Cooking methods
  cooking_method: {
    variants: [
      "grilled", "fried", "deep-fried", "baked", "roasted", "steamed",
      "boiled", "sautéed", "broiled", "poached", "braised", "smoked", "raw"
    ],
    visual_cues: {
      grilled: ["char marks", "grill lines", "charred edges"],
      fried: ["golden crispy coating", "oil sheen"],
      "deep-fried": ["thick crispy batter", "golden brown all over"],
      steamed: ["moist appearance", "no browning"],
      roasted: ["caramelized surface", "browned exterior"]
    }
  },

  // Cheese types
  cheese: {
    variants: [
      "mozzarella", "cheddar", "parmesan", "swiss", "provolone",
      "feta", "goat cheese", "blue cheese", "brie", "cream cheese",
      "american cheese", "pepper jack", "ricotta", "gouda"
    ],
    visual_cues: {
      mozzarella: ["white stretchy cheese", "melted stringy appearance"],
      cheddar: ["orange/yellow color", "firm sliced"],
      parmesan: ["shaved/grated", "hard aged appearance"],
      feta: ["white crumbled chunks", "crumbly texture"],
      "blue cheese": ["visible blue veins", "marbled blue-white"]
    }
  }
};

/**
 * Apply vision corrections to recipe/ingredient data
 * @param {Object} visionInsights - Output from vision analysis
 * @param {Object} recipeData - Recipe/ingredient data to correct
 * @returns {Object} - Corrected data with change log
 */
function applyVisionCorrections(visionInsights, recipeData) {
  if (!visionInsights || !recipeData) {
    return { corrected: recipeData, corrections: [], applied: false };
  }

  const corrections = [];
  let correctedIngredients = [...(recipeData.ingredients || recipeData.ingredients_parsed || [])];
  let correctedDescription = recipeData.description || recipeData.menuDescription || "";

  // Extract visual evidence
  const visualIngredients = visionInsights.visual_ingredients || [];
  const visualCookingMethod = visionInsights.visual_cooking_method || {};
  const plateComponents = visionInsights.plate_components || [];

  // Helper: find visual evidence for a category
  const findVisualEvidence = (category) => {
    return visualIngredients.filter(vi =>
      vi.category === category ||
      vi.guess?.toLowerCase().includes(category)
    );
  };

  // Helper: check if ingredient list mentions a food type
  const ingredientMentions = (variants) => {
    const ingredientStr = correctedIngredients.join(" ").toLowerCase();
    const descStr = correctedDescription.toLowerCase();
    const combined = ingredientStr + " " + descStr;

    for (const variant of variants) {
      if (combined.includes(variant.toLowerCase())) {
        return variant;
      }
    }
    return null;
  };

  // 1. PASTA TYPE CORRECTION
  const pastaEvidence = plateComponents.find(pc =>
    pc.category === "pasta" || pc.label?.toLowerCase().includes("pasta")
  );

  if (pastaEvidence && pastaEvidence.confidence >= 0.6) {
    const visualPastaType = detectPastaTypeFromVisual(pastaEvidence, visualIngredients);
    const recipePastaType = ingredientMentions(VISION_CORRECTION_CATEGORIES.pasta.variants);

    if (visualPastaType && recipePastaType &&
        visualPastaType.toLowerCase() !== recipePastaType.toLowerCase()) {
      // Apply correction
      const correction = {
        category: "pasta_type",
        visual_detected: visualPastaType,
        recipe_claimed: recipePastaType,
        confidence: pastaEvidence.confidence,
        action: "replace",
        reason: `Vision detected ${visualPastaType} but recipe mentions ${recipePastaType}`
      };

      correctedIngredients = correctedIngredients.map(ing =>
        ing.toLowerCase().includes(recipePastaType.toLowerCase())
          ? ing.replace(new RegExp(recipePastaType, "gi"), visualPastaType)
          : ing
      );

      correctedDescription = correctedDescription.replace(
        new RegExp(recipePastaType, "gi"),
        visualPastaType
      );

      corrections.push(correction);
    }
  }

  // 2. RICE TYPE CORRECTION
  const riceEvidence = visualIngredients.find(vi =>
    vi.category === "grain" && vi.guess?.toLowerCase().includes("rice")
  );

  if (riceEvidence && riceEvidence.confidence >= 0.6) {
    const visualRiceType = detectRiceTypeFromVisual(riceEvidence);
    const recipeRiceType = ingredientMentions(VISION_CORRECTION_CATEGORIES.rice.variants);

    if (visualRiceType && recipeRiceType &&
        !visualRiceType.toLowerCase().includes(recipeRiceType.toLowerCase()) &&
        !recipeRiceType.toLowerCase().includes(visualRiceType.toLowerCase())) {

      const correction = {
        category: "rice_type",
        visual_detected: visualRiceType,
        recipe_claimed: recipeRiceType,
        confidence: riceEvidence.confidence,
        action: "replace",
        reason: `Vision detected ${visualRiceType} but recipe mentions ${recipeRiceType}`
      };

      correctedIngredients = correctedIngredients.map(ing =>
        ing.toLowerCase().includes(recipeRiceType.toLowerCase())
          ? ing.replace(new RegExp(recipeRiceType, "gi"), visualRiceType)
          : ing
      );

      corrections.push(correction);
    }
  }

  // 3. COOKING METHOD CORRECTION
  if (visualCookingMethod.primary &&
      visualCookingMethod.confidence >= 0.7 &&
      visualCookingMethod.primary !== "unknown") {

    const visualMethod = visualCookingMethod.primary;
    const recipeMethod = ingredientMentions(VISION_CORRECTION_CATEGORIES.cooking_method.variants);

    if (recipeMethod && visualMethod.toLowerCase() !== recipeMethod.toLowerCase()) {
      const correction = {
        category: "cooking_method",
        visual_detected: visualMethod,
        recipe_claimed: recipeMethod,
        confidence: visualCookingMethod.confidence,
        action: "replace",
        reason: `Vision shows ${visualMethod} preparation but recipe says ${recipeMethod}. ${visualCookingMethod.reason || ""}`
      };

      correctedDescription = correctedDescription.replace(
        new RegExp(recipeMethod, "gi"),
        visualMethod
      );

      corrections.push(correction);
    }
  }

  // 4. PROTEIN TYPE CORRECTION (fish species, meat type)
  const proteinEvidence = visualIngredients.filter(vi =>
    ["fish", "shellfish", "red_meat", "poultry"].includes(vi.category)
  );

  for (const protein of proteinEvidence) {
    if (protein.confidence >= 0.7) {
      const visualProtein = protein.guess?.toLowerCase();
      const recipeProtein = ingredientMentions(VISION_CORRECTION_CATEGORIES.protein.variants);

      if (visualProtein && recipeProtein &&
          !visualProtein.includes(recipeProtein.toLowerCase()) &&
          !recipeProtein.toLowerCase().includes(visualProtein)) {

        // Check if they're in the same category (e.g., both fish, both meat)
        const sameCategory = areSameProteinCategory(visualProtein, recipeProtein);

        if (sameCategory) {
          const correction = {
            category: "protein_type",
            visual_detected: visualProtein,
            recipe_claimed: recipeProtein,
            confidence: protein.confidence,
            action: "replace",
            reason: `Vision detected ${visualProtein} but recipe mentions ${recipeProtein}. ${protein.evidence || ""}`
          };

          correctedIngredients = correctedIngredients.map(ing =>
            ing.toLowerCase().includes(recipeProtein.toLowerCase())
              ? ing.replace(new RegExp(recipeProtein, "gi"), visualProtein)
              : ing
          );

          corrections.push(correction);
          break; // Only apply first protein correction
        }
      }
    }
  }

  // 5. ADD VISUAL-ONLY INGREDIENTS (seen but not in recipe)
  const highConfidenceVisual = visualIngredients.filter(vi =>
    vi.confidence >= 0.8 &&
    ["egg", "dairy", "shellfish", "nut", "sesame", "processed_meat"].includes(vi.category)
  );

  for (const visual of highConfidenceVisual) {
    const alreadyInRecipe = correctedIngredients.some(ing =>
      ing.toLowerCase().includes(visual.guess?.toLowerCase().split(" ")[0])
    );

    if (!alreadyInRecipe) {
      const correction = {
        category: "missing_ingredient",
        visual_detected: visual.guess,
        recipe_claimed: null,
        confidence: visual.confidence,
        action: "add",
        reason: `Vision clearly shows ${visual.guess} but not in recipe. ${visual.evidence || ""}`
      };

      // Add to ingredients with visual marker
      correctedIngredients.push(`${visual.guess} (visible in image)`);
      corrections.push(correction);
    }
  }

  return {
    corrected: {
      ...recipeData,
      ingredients: correctedIngredients,
      ingredients_parsed: correctedIngredients,
      description: correctedDescription,
      vision_corrected: corrections.length > 0
    },
    corrections,
    applied: corrections.length > 0,
    correction_count: corrections.length
  };
}

/**
 * Detect pasta type from visual evidence
 */
function detectPastaTypeFromVisual(plateComponent, visualIngredients) {
  const label = (plateComponent.label || "").toLowerCase();
  const guess = visualIngredients.find(vi =>
    vi.category === "grain" && vi.guess?.toLowerCase().includes("pasta")
  )?.guess?.toLowerCase();

  // Check for specific pasta mentions in label or guess
  for (const pastaType of VISION_CORRECTION_CATEGORIES.pasta.variants) {
    if (label.includes(pastaType) || (guess && guess.includes(pastaType))) {
      return pastaType;
    }
  }

  // Infer from visual description
  if (label.includes("long") && label.includes("thin")) return "spaghetti";
  if (label.includes("tube") || label.includes("hollow")) return "penne";
  if (label.includes("spiral") || label.includes("twist")) return "fusilli";
  if (label.includes("flat") && label.includes("wide")) return "fettuccine";
  if (label.includes("bow") || label.includes("butterfly")) return "farfalle";
  if (label.includes("shell")) return "shells";

  return null;
}

/**
 * Detect rice type from visual evidence
 */
function detectRiceTypeFromVisual(riceEvidence) {
  const guess = (riceEvidence.guess || "").toLowerCase();
  const evidence = (riceEvidence.evidence || "").toLowerCase();

  if (guess.includes("fried") || evidence.includes("fried") || evidence.includes("wok")) {
    return "fried rice";
  }
  if (guess.includes("brown") || evidence.includes("brown") || evidence.includes("tan")) {
    return "brown rice";
  }
  if (guess.includes("yellow") || evidence.includes("yellow") || evidence.includes("saffron")) {
    return "yellow rice";
  }
  if (guess.includes("wild") || evidence.includes("dark") || evidence.includes("black grains")) {
    return "wild rice";
  }

  return guess || "white rice";
}

/**
 * Check if two proteins are in the same category (for valid swaps)
 */
function areSameProteinCategory(protein1, protein2) {
  const fishTypes = ["salmon", "tuna", "cod", "tilapia", "halibut", "trout", "bass", "snapper", "mahi"];
  const shellfishTypes = ["shrimp", "lobster", "crab", "scallop", "mussel", "clam", "oyster"];
  const poultryTypes = ["chicken", "turkey", "duck", "cornish"];
  const redMeatTypes = ["beef", "steak", "lamb", "pork", "veal"];

  const categories = [fishTypes, shellfishTypes, poultryTypes, redMeatTypes];

  for (const category of categories) {
    const p1InCategory = category.some(t => protein1.includes(t));
    const p2InCategory = category.some(t => protein2.includes(t));

    if (p1InCategory && p2InCategory) {
      return true;
    }
  }

  return false;
}

/**
 * Generate vision correction prompt enhancement for more detailed food identification
 */
function getVisionCorrectionPromptAddendum() {
  return `
ADDITIONAL FOOD IDENTIFICATION (for recipe correction):

When analyzing the image, also identify these specific food attributes with HIGH PRECISION:

1. PASTA TYPE (if pasta visible):
   - Identify exact pasta shape: spaghetti, penne, rigatoni, fettuccine, linguine, fusilli, farfalle, etc.
   - Look for: strand shape (round vs flat), tube vs solid, spiral vs straight, size
   - Add to visual_ingredients with category "pasta_type" and high confidence if clear

2. RICE TYPE (if rice visible):
   - Identify: white rice, brown rice, fried rice, yellow rice, wild rice, sushi rice
   - Look for: grain color, preparation style (plain vs mixed), glossiness
   - Add to visual_ingredients with category "rice_type"

3. BREAD TYPE (if bread visible):
   - Identify: white, whole wheat, sourdough, brioche, ciabatta, baguette, pita, etc.
   - Look for: crust color, crumb texture, shape

4. SPECIFIC PROTEIN (be precise):
   - Fish: salmon (orange-pink) vs tuna (red) vs white fish (cod, tilapia, halibut)
   - Meat: beef vs pork vs lamb (look at color, fat marbling)
   - Add specific type, not just "fish" or "meat"

5. CHEESE TYPE (if cheese visible):
   - Identify: mozzarella (white, stringy), cheddar (orange), parmesan (shaved), feta (crumbled white)

For each identification, include in visual_ingredients:
{
  "guess": "spaghetti pasta" (be specific),
  "category": "pasta_type" or "rice_type" or "bread_type" or "protein_specific" or "cheese_type",
  "confidence": 0.0-1.0,
  "evidence": "long thin round strands visible, clearly spaghetti not penne"
}
`.trim();
}

// ==========================================================================
// === DAYPART SEEDING SYSTEM ================================================
// Automatic time-zone aware daypart classification for franchise menus
// CRITICAL: NO DELETIONS - only status updates and appends
// ==========================================================================

/**
 * Canonical list of 50 franchises to seed (ordered by location count)
 */
const FRANCHISE_SEED_LIST = [
  { name: "Subway", locations: 20576 },
  { name: "Starbucks", locations: 15873 },
  { name: "McDonald's", locations: 13444 },
  { name: "Dunkin'", locations: 9370 },
  { name: "Taco Bell", locations: 7198 },
  { name: "Burger King", locations: 7043 },
  { name: "Domino's", locations: 6686 },
  { name: "Pizza Hut", locations: 6561 },
  { name: "Wendy's", locations: 5994 },
  { name: "Dairy Queen", locations: 4307 },
  { name: "Little Caesars", locations: 4173 },
  { name: "KFC", locations: 3918 },
  { name: "Sonic Drive-In", locations: 3546 },
  { name: "Arby's", locations: 3415 },
  { name: "Papa Johns", locations: 3376 },
  { name: "Chipotle", locations: 3129 },
  { name: "Popeyes Louisiana Kitchen", locations: 2946 },
  { name: "Chick-fil-A", locations: 2837 },
  { name: "Jimmy John's", locations: 2637 },
  { name: "Jersey Mike's", locations: 2397 },
  { name: "Panda Express", locations: 2393 },
  { name: "Baskin-Robbins", locations: 2253 },
  { name: "Jack in the Box", locations: 2180 },
  { name: "Panera Bread", locations: 2102 },
  { name: "Wingstop", locations: 1721 },
  { name: "Hardee's", locations: 1707 },
  { name: "Five Guys", locations: 1409 },
  { name: "Tropical Smoothie Café", locations: 1198 },
  { name: "Firehouse Subs", locations: 1187 },
  { name: "Papa Murphy's", locations: 1168 },
  { name: "Carl's Jr.", locations: 1068 },
  { name: "Marco's Pizza", locations: 1067 },
  { name: "Whataburger", locations: 925 },
  { name: "Zaxby's", locations: 922 },
  { name: "Culver's", locations: 892 },
  { name: "Church's Chicken", locations: 812 },
  { name: "Checkers/Rally's", locations: 806 },
  { name: "Bojangles", locations: 788 },
  { name: "Qdoba", locations: 728 },
  { name: "Crumbl Cookies", locations: 688 },
  { name: "Dutch Bros", locations: 671 },
  { name: "Raising Cane's", locations: 646 },
  { name: "Moe's", locations: 637 },
  { name: "Del Taco", locations: 591 },
  { name: "McAlister's Deli", locations: 525 },
  { name: "El Pollo Loco", locations: 490 },
  { name: "Freddy's Frozen Custard & Steakburgers", locations: 456 },
  { name: "In-N-Out Burger", locations: 379 },
  { name: "Krispy Kreme", locations: 352 },
  { name: "Shake Shack", locations: 287 }
];

/**
 * Timezone configuration with reference coordinates for representative store search
 */
const DAYPART_TIMEZONES = {
  "America/New_York": { lat: 40.7580, lng: -73.9855, label: "NYC" },
  "America/Chicago": { lat: 41.8781, lng: -87.6298, label: "Chicago" },
  "America/Denver": { lat: 39.7392, lng: -104.9903, label: "Denver" },
  "America/Los_Angeles": { lat: 34.0522, lng: -118.2437, label: "LA" }
};

/**
 * Daypart definitions with local times (minutes from midnight)
 */
const DAYPART_CONFIG = {
  BREAKFAST: { local_time_min: 510, label: "08:30" },
  LUNCH: { local_time_min: 780, label: "13:00" },
  DINNER: { local_time_min: 1140, label: "19:00" },
  LATE_NIGHT: { local_time_min: 1410, label: "23:30" }
};

/**
 * Generate a UUID for run tracking
 */
function generateSeedRunId() {
  return 'seed-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// --- Representative Store Selection ---

/**
 * Find a representative store for a brand in a specific timezone
 */
async function findRepresentativeStore(env, brandName, tzid) {
  const tzConfig = DAYPART_TIMEZONES[tzid];
  if (!tzConfig) return { ok: false, error: `Unknown timezone: ${tzid}` };

  const address = `${tzConfig.lat},${tzConfig.lng}`;

  try {
    // Fetch up to 3 restaurant results to find a matching store, with full menu data
    const menuResult = await fetchMenuFromUberEatsTiered(env, brandName, address, 3);
    if (!menuResult?.ok || !menuResult?.restaurants?.length) {
      return { ok: false, error: "No store found via provider search" };
    }

    const restaurant = menuResult.restaurants[0];
    const brand = await detectBrand(env, { name: brandName });
    if (!brand) return { ok: false, error: "Brand not found in database" };

    const store = await upsertStore(env, {
      place_id: restaurant.place_id || `uber-${restaurant.store_id || Date.now()}`,
      uber_store_id: restaurant.store_id,
      brand_id: brand.id,
      name: restaurant.name || brandName,
      address: restaurant.address || address,
      city: restaurant.city || tzConfig.label,
      state_province: restaurant.state,
      country_code: "US",
      latitude: tzConfig.lat,
      longitude: tzConfig.lng,
      source: "daypart_seed"
    });

    if (!store) return { ok: false, error: "Failed to upsert store" };

    await upsertRepresentativeStore(env, {
      brand_id: brand.id, store_id: store.id, tzid,
      priority: 1, selection_method: "auto_search",
      search_coords: JSON.stringify({ lat: tzConfig.lat, lng: tzConfig.lng })
    });

    return { ok: true, store, brand, menu: menuResult.menu || [], restaurant };
  } catch (err) {
    console.log(`[daypart-seed] Error finding rep store for ${brandName} in ${tzid}:`, err?.message);
    return { ok: false, error: err?.message };
  }
}

/**
 * Upsert a representative store record
 */
async function upsertRepresentativeStore(env, data) {
  if (!env?.D1_DB) return null;
  const { brand_id, store_id, tzid, priority, selection_method, search_coords } = data;
  const now = new Date().toISOString();

  try {
    const existing = await env.D1_DB.prepare(`
      SELECT * FROM franchise_representative_stores WHERE brand_id = ? AND tzid = ? AND store_id = ?
    `).bind(brand_id, tzid, store_id).first();

    if (existing) {
      await env.D1_DB.prepare(`
        UPDATE franchise_representative_stores SET status = 'ACTIVE', last_success_at = ?, updated_at = ? WHERE id = ?
      `).bind(now, now, existing.id).run();
      return { ...existing, status: 'ACTIVE', last_success_at: now };
    }

    const result = await env.D1_DB.prepare(`
      INSERT INTO franchise_representative_stores
        (brand_id, store_id, tzid, priority, selection_method, search_coords, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).bind(brand_id, store_id, tzid, priority || 1, selection_method, search_coords, now, now).run();

    return { id: result.meta?.last_row_id, brand_id, store_id, tzid, status: 'ACTIVE' };
  } catch (err) {
    console.log("[daypart-seed] Upsert rep store error:", err?.message);
    return null;
  }
}

// --- Seed Run Management ---

/**
 * Start or resume a seeding run
 */
async function startOrResumeSeedRun(env, runType = 'INITIAL') {
  if (!env?.D1_DB) return { ok: false, error: "No database" };

  try {
    const existing = await env.D1_DB.prepare(`
      SELECT * FROM franchise_seed_runs WHERE status IN ('RUNNING', 'PAUSED') ORDER BY started_at DESC LIMIT 1
    `).first();

    if (existing) {
      await env.D1_DB.prepare(`
        UPDATE franchise_seed_runs SET status = 'RUNNING', updated_at = ? WHERE run_id = ?
      `).bind(new Date().toISOString(), existing.run_id).run();
      return { ok: true, run_id: existing.run_id, resumed: true, current_index: existing.current_index };
    }

    const runId = generateSeedRunId();
    const now = new Date().toISOString();

    await env.D1_DB.prepare(`
      INSERT INTO franchise_seed_runs (run_id, status, run_type, current_index, total_count, started_at, created_at, updated_at)
      VALUES (?, 'RUNNING', ?, 0, ?, ?, ?, ?)
    `).bind(runId, runType, FRANCHISE_SEED_LIST.length, now, now, now).run();

    for (const brand of FRANCHISE_SEED_LIST) {
      await env.D1_DB.prepare(`
        INSERT OR IGNORE INTO franchise_seed_progress (run_id, brand_name, status, created_at, updated_at) VALUES (?, ?, 'PENDING', ?, ?)
      `).bind(runId, brand.name, now, now).run();
    }

    return { ok: true, run_id: runId, resumed: false, current_index: 0 };
  } catch (err) {
    console.log("[daypart-seed] Start run error:", err?.message);
    return { ok: false, error: err?.message };
  }
}

/**
 * Get current seed run status
 */
async function getSeedRunStatus(env, runId) {
  if (!env?.D1_DB) return null;
  try {
    const run = await env.D1_DB.prepare(`SELECT * FROM franchise_seed_runs WHERE run_id = ?`).bind(runId).first();
    if (!run) return null;

    const progress = await env.D1_DB.prepare(`SELECT * FROM franchise_seed_progress WHERE run_id = ? ORDER BY id`).bind(runId).all();
    const counts = { pending: 0, in_progress: 0, done: 0, failed: 0, skipped: 0 };
    for (const p of (progress.results || [])) {
      counts[p.status.toLowerCase()] = (counts[p.status.toLowerCase()] || 0) + 1;
    }
    return { ...run, progress: progress.results || [], counts };
  } catch (err) {
    console.log("[daypart-seed] Get run status error:", err?.message);
    return null;
  }
}

// --- Initial Seeding ---

/**
 * Seed one franchise
 */
async function seedOneFranchise(env, ctx, runId, brandName) {
  if (!env?.D1_DB) return { ok: false, error: "No database" };
  const now = new Date().toISOString();
  const warnings = [];

  try {
    await env.D1_DB.prepare(`
      UPDATE franchise_seed_progress SET status = 'IN_PROGRESS', started_at = ?, updated_at = ? WHERE run_id = ? AND brand_name = ?
    `).bind(now, now, runId, brandName).run();

    let brand = await detectBrand(env, { name: brandName });
    if (!brand) {
      const normalized = normalizeBrandName(brandName);
      await env.D1_DB.prepare(`INSERT OR IGNORE INTO brands (canonical_name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?)`).bind(brandName, normalized, now, now).run();
      brand = await detectBrand(env, { name: brandName });
    }
    if (!brand) throw new Error("Failed to create/find brand");

    await env.D1_DB.prepare(`UPDATE franchise_seed_progress SET brand_id = ?, updated_at = ? WHERE run_id = ? AND brand_name = ?`).bind(brand.id, now, runId, brandName).run();

    let repStoresFound = 0, primaryStore = null, menuItems = [];

    for (const [tzid] of Object.entries(DAYPART_TIMEZONES)) {
      console.log(`[daypart-seed] Finding rep store for ${brandName} in ${tzid}...`);
      const result = await findRepresentativeStore(env, brandName, tzid);
      if (result.ok) {
        repStoresFound++;
        if (!primaryStore) { primaryStore = result.store; menuItems = result.menu || []; }
      } else {
        warnings.push(`No store in ${tzid}: ${result.error}`);
        await logSeedFailure(env, runId, brandName, null, 'REP_STORE', result.error);
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!primaryStore) throw new Error("No representative stores found");

    let menuItemCount = 0, analyzedCount = 0, qaPassedCount = 0, qaFailedCount = 0;

    if (menuItems.length > 0) {
      const deltaResult = await deltaMenuDiscovery(env, primaryStore.id, menuItems, "daypart_seed");
      if (deltaResult.ok) menuItemCount = (deltaResult.results?.created || 0) + (deltaResult.results?.resolved || 0);
    }

    const brandItems = await env.D1_DB.prepare(`SELECT * FROM franchise_menu_items WHERE brand_id = ? AND status = 'ACTIVE'`).bind(brand.id).all();
    const items = brandItems.results || [];
    menuItemCount = items.length;

    for (const item of items) {
      try {
        const analysisResult = await ensureItemAnalyzed(env, ctx, brand, item);
        if (analysisResult.ok) {
          analyzedCount++;
          if (analysisResult.qa_passed) qaPassedCount++; else { qaFailedCount++; warnings.push(`QA failed for ${item.canonical_name}`); }
        } else {
          qaFailedCount++;
          await logSeedFailure(env, runId, brandName, item.canonical_name, 'ANALYZE', analysisResult.error);
        }
      } catch (err) {
        qaFailedCount++;
        await logSeedFailure(env, runId, brandName, item.canonical_name, 'ANALYZE', err?.message);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    let daypartJobsCreated = 0;
    for (const [tzid] of Object.entries(DAYPART_TIMEZONES)) {
      for (const [daypart, config] of Object.entries(DAYPART_CONFIG)) {
        if (await createDaypartJob(env, brand.id, tzid, daypart, config.local_time_min)) daypartJobsCreated++;
      }
    }

    const finishedAt = new Date().toISOString();
    await env.D1_DB.prepare(`
      UPDATE franchise_seed_progress SET status = 'DONE', finished_at = ?, menu_item_count = ?, analyzed_count = ?,
        qa_passed = ?, qa_failed_count = ?, rep_stores_found = ?, daypart_jobs_created = ?, warnings_json = ?, updated_at = ?
      WHERE run_id = ? AND brand_name = ?
    `).bind(finishedAt, menuItemCount, analyzedCount, qaPassedCount > 0 ? 1 : 0, qaFailedCount, repStoresFound, daypartJobsCreated,
      warnings.length > 0 ? JSON.stringify(warnings) : null, finishedAt, runId, brandName).run();

    return { ok: true, brand_id: brand.id, rep_stores_found: repStoresFound, menu_item_count: menuItemCount,
      analyzed_count: analyzedCount, qa_passed: qaPassedCount, qa_failed: qaFailedCount, daypart_jobs_created: daypartJobsCreated, warnings };
  } catch (err) {
    console.log(`[daypart-seed] Error seeding ${brandName}:`, err?.message);
    await env.D1_DB.prepare(`
      UPDATE franchise_seed_progress SET status = 'FAILED', error = ?, warnings_json = ?, updated_at = ? WHERE run_id = ? AND brand_name = ?
    `).bind(err?.message, warnings.length > 0 ? JSON.stringify(warnings) : null, new Date().toISOString(), runId, brandName).run();
    await logSeedFailure(env, runId, brandName, null, 'ONBOARD', err?.message);
    return { ok: false, error: err?.message, warnings };
  }
}

/**
 * Ensure a menu item has been analyzed
 */
async function ensureItemAnalyzed(env, ctx, brand, item) {
  if (!env?.D1_DB) return { ok: false, error: "No database" };
  try {
    const existing = await env.D1_DB.prepare(`SELECT * FROM franchise_analysis_cache WHERE brand_id = ? AND menu_item_id = ?`).bind(brand.id, item.id).first();
    if (existing && existing.status === 'COMPLETE' && existing.qa_passed) return { ok: true, cached: true, qa_passed: true };

    const { status, result } = await runDishAnalysis(env, {
      dishName: item.canonical_name, restaurantName: brand.canonical_name,
      menuDescription: item.description, brand_id: brand.id, menu_item_id: item.id, skipCache: false
    }, ctx);

    if (status !== 200 || !result?.ok) return { ok: false, error: result?.error || "Analysis failed" };

    const qa = validateAnalysisQA(result);
    const cacheKey = `franchise/${brand.id}/${item.id}`;
    const now = new Date().toISOString();

    await env.D1_DB.prepare(`
      INSERT INTO franchise_analysis_cache (brand_id, menu_item_id, status, cache_key, qa_passed, qa_allergens, qa_organs, qa_nutrition, analyzed_at, last_validated_at, created_at, updated_at)
      VALUES (?, ?, 'COMPLETE', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(brand_id, menu_item_id) DO UPDATE SET status = 'COMPLETE', cache_key = ?, qa_passed = ?, qa_allergens = ?, qa_organs = ?, qa_nutrition = ?, analyzed_at = ?, last_validated_at = ?, updated_at = ?
    `).bind(brand.id, item.id, cacheKey, qa.passed ? 1 : 0, qa.allergens ? 1 : 0, qa.organs ? 1 : 0, qa.nutrition ? 1 : 0, now, now, now, now,
      cacheKey, qa.passed ? 1 : 0, qa.allergens ? 1 : 0, qa.organs ? 1 : 0, qa.nutrition ? 1 : 0, now, now, now).run();

    return { ok: true, qa_passed: qa.passed, qa_reason: qa.reason, cache_key: cacheKey };
  } catch (err) {
    console.log(`[daypart-seed] Analysis error for ${item.canonical_name}:`, err?.message);
    return { ok: false, error: err?.message };
  }
}

/**
 * Validate analysis result meets QA requirements
 */
function validateAnalysisQA(result) {
  const qa = { passed: false, allergens: false, organs: false, nutrition: false, reason: null };
  if (result.allergen_flags && Array.isArray(result.allergen_flags)) qa.allergens = true;
  else if (result.allergen_summary) qa.allergens = true;
  if (result.organs && typeof result.organs === 'object' && Object.keys(result.organs).length > 0) qa.organs = true;
  if (result.nutrition_summary || result.normalized?.calories) qa.nutrition = true;
  qa.passed = qa.allergens && qa.organs;
  if (!qa.passed) {
    const missing = [];
    if (!qa.allergens) missing.push("allergens");
    if (!qa.organs) missing.push("organs");
    qa.reason = `Missing: ${missing.join(", ")}`;
  }
  return qa;
}

/**
 * Log a seed failure (append-only)
 */
async function logSeedFailure(env, runId, brandName, menuItemName, stage, error) {
  if (!env?.D1_DB) return;
  try {
    await env.D1_DB.prepare(`INSERT INTO franchise_seed_failures (run_id, brand_name, menu_item_name, stage, error, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(runId, brandName, menuItemName, stage, error, new Date().toISOString()).run();
  } catch (err) { console.log("[daypart-seed] Failed to log failure:", err?.message); }
}

// --- Daypart Job Management ---

/**
 * Create a daypart job
 */
async function createDaypartJob(env, brandId, tzid, daypart, localTimeMin) {
  if (!env?.D1_DB) return false;
  try {
    const nextRunUtc = calculateNextRunUtc(tzid, localTimeMin);
    const now = new Date().toISOString();
    await env.D1_DB.prepare(`
      INSERT INTO franchise_daypart_jobs (brand_id, tzid, daypart, local_time_min, next_run_at_utc, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
      ON CONFLICT(brand_id, tzid, daypart) DO UPDATE SET local_time_min = ?, next_run_at_utc = ?, status = 'ACTIVE', updated_at = ?
    `).bind(brandId, tzid, daypart, localTimeMin, nextRunUtc, now, now, localTimeMin, nextRunUtc, now).run();
    return true;
  } catch (err) {
    console.log("[daypart-seed] Create daypart job error:", err?.message);
    return false;
  }
}

/**
 * Calculate next run time in UTC for a given local time
 */
function calculateNextRunUtc(tzid, localTimeMin) {
  const tzOffsets = { "America/New_York": -5, "America/Chicago": -6, "America/Denver": -7, "America/Los_Angeles": -8 };
  const offset = tzOffsets[tzid] || -5;
  const now = new Date();
  const utcHours = Math.floor(localTimeMin / 60) - offset;
  const utcMinutes = localTimeMin % 60;
  const nextRun = new Date(now);
  nextRun.setUTCHours(utcHours, utcMinutes, 0, 0);
  if (nextRun <= now) nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  return nextRun.toISOString();
}

/**
 * Get due daypart jobs
 */
async function getDueDaypartJobs(env, limit = 5) {
  if (!env?.D1_DB) return [];
  try {
    const now = new Date().toISOString();
    const result = await env.D1_DB.prepare(`
      SELECT dj.*, b.canonical_name as brand_name FROM franchise_daypart_jobs dj
      JOIN brands b ON b.id = dj.brand_id WHERE dj.status = 'ACTIVE' AND dj.next_run_at_utc <= ?
      ORDER BY dj.next_run_at_utc ASC LIMIT ?
    `).bind(now, limit).all();
    return result.results || [];
  } catch (err) {
    console.log("[daypart-seed] Get due jobs error:", err?.message);
    return [];
  }
}

/**
 * Process one daypart job
 */
async function processDaypartJob(env, ctx, job) {
  if (!env?.D1_DB) return { ok: false, error: "No database" };
  console.log(`[daypart-job] Processing ${job.brand_name} ${job.tzid} ${job.daypart}...`);

  try {
    const repStore = await env.D1_DB.prepare(`
      SELECT rs.*, s.name as store_name FROM franchise_representative_stores rs
      JOIN stores s ON s.id = rs.store_id WHERE rs.brand_id = ? AND rs.tzid = ? AND rs.status = 'ACTIVE'
      ORDER BY rs.priority LIMIT 1
    `).bind(job.brand_id, job.tzid).first();

    if (!repStore) throw new Error(`No representative store for brand ${job.brand_id} in ${job.tzid}`);

    const tzConfig = DAYPART_TIMEZONES[job.tzid];
    const menuResult = await fetchMenuFromUberEatsTiered(env, job.brand_name, `${tzConfig.lat},${tzConfig.lng}`, 1);
    if (!menuResult?.ok) throw new Error(`Menu fetch failed: ${menuResult?.error}`);

    const menuItems = menuResult.menu || [];
    let itemsSeen = 0, sightingsRecorded = 0;

    for (const menuItem of menuItems) {
      const observedName = menuItem.name || menuItem.title;
      if (!observedName) continue;
      itemsSeen++;

      const resolved = await resolveMenuItem(env, job.brand_id, observedName, {
        category: menuItem.section, description: menuItem.description, calories: menuItem.restaurantCalories || menuItem.calories
      });
      if (!resolved?.item) continue;

      await recordSightingWithDaypart(env, {
        menu_item_id: resolved.item.id, store_id: repStore.store_id, source_type: "daypart_sample",
        observed_name: observedName, observed_description: menuItem.description,
        observed_price_cents: menuItem.price, observed_calories: menuItem.restaurantCalories || menuItem.calories,
        observed_section: menuItem.section, observed_image_url: menuItem.imageUrl,
        confidence: resolved.isNew ? 0.55 : 0.75, match_method: resolved.matchMethod, daypart: job.daypart
      });
      sightingsRecorded++;

      await upsertScopeWithDaypart(env, {
        menu_item_id: resolved.item.id, scope_type: "STORE", scope_key: String(repStore.store_id),
        status: "ACTIVE", confidence: resolved.isNew ? 0.55 : 0.75, price_cents: menuItem.price, daypart: job.daypart
      });
    }

    const nextRunUtc = calculateNextRunUtc(job.tzid, job.local_time_min);
    const now = new Date().toISOString();
    await env.D1_DB.prepare(`
      UPDATE franchise_daypart_jobs SET last_run_at_utc = ?, next_run_at_utc = ?, total_runs = total_runs + 1,
        total_items_seen = total_items_seen + ?, consecutive_failures = 0, updated_at = ? WHERE id = ?
    `).bind(now, nextRunUtc, itemsSeen, now, job.id).run();

    console.log(`[daypart-job] Completed ${job.brand_name} ${job.daypart}: ${sightingsRecorded} sightings`);
    return { ok: true, items_seen: itemsSeen, sightings_recorded: sightingsRecorded, next_run_at_utc: nextRunUtc };
  } catch (err) {
    console.log(`[daypart-job] Error processing job ${job.id}:`, err?.message);
    const nextRunUtc = calculateNextRunUtc(job.tzid, job.local_time_min);
    await env.D1_DB.prepare(`
      UPDATE franchise_daypart_jobs SET last_error = ?, consecutive_failures = consecutive_failures + 1, next_run_at_utc = ?, updated_at = ? WHERE id = ?
    `).bind(err?.message, nextRunUtc, new Date().toISOString(), job.id).run();
    return { ok: false, error: err?.message };
  }
}

/**
 * Record a sighting with daypart (append-only)
 */
async function recordSightingWithDaypart(env, data) {
  if (!env?.D1_DB) return null;
  const { menu_item_id, store_id, source_type, observed_name, observed_description, observed_price_cents, observed_calories, observed_section, observed_image_url, confidence, match_method, daypart } = data;
  try {
    const result = await env.D1_DB.prepare(`
      INSERT INTO menu_item_sightings (menu_item_id, store_id, source_type, observed_name, observed_description, observed_price_cents, observed_calories, observed_section, observed_image_url, confidence, match_method, daypart, observed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(menu_item_id, store_id, source_type, observed_name, observed_description, observed_price_cents, observed_calories, observed_section, observed_image_url, confidence, match_method, daypart || 'UNKNOWN').run();
    return result.meta?.last_row_id;
  } catch (err) {
    console.log("[daypart-seed] Record sighting error:", err?.message);
    return null;
  }
}

/**
 * Upsert a scope with daypart
 */
async function upsertScopeWithDaypart(env, data) {
  if (!env?.D1_DB) return null;
  const { menu_item_id, scope_type, scope_key, status, confidence, price_cents, daypart } = data;
  const now = new Date().toISOString();
  try {
    const existing = await env.D1_DB.prepare(`
      SELECT * FROM menu_item_scopes WHERE menu_item_id = ? AND scope_type = ? AND scope_key = ? AND daypart = ?
    `).bind(menu_item_id, scope_type, scope_key || '', daypart || 'UNKNOWN').first();

    if (existing) {
      await env.D1_DB.prepare(`
        UPDATE menu_item_scopes SET status = ?, confidence = MAX(confidence, ?), last_seen_at = ?, price_cents = COALESCE(?, price_cents), updated_at = ? WHERE id = ?
      `).bind(status, confidence, now, price_cents, now, existing.id).run();
      return existing.id;
    }

    const result = await env.D1_DB.prepare(`
      INSERT INTO menu_item_scopes (menu_item_id, scope_type, scope_key, status, confidence, price_cents, daypart, first_seen_at, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(menu_item_id, scope_type, scope_key || '', status, confidence, price_cents, daypart || 'UNKNOWN', now, now, now, now).run();
    return result.meta?.last_row_id;
  } catch (err) {
    console.log("[daypart-seed] Upsert scope error:", err?.message);
    return null;
  }
}

// --- Daypart Promotion ---

/**
 * Promote items to global daypart scopes based on sighting evidence
 */
async function promoteDayparts(env, brandId = null) {
  if (!env?.D1_DB) return { ok: false, error: "No database" };
  console.log("[daypart-promote] Starting daypart promotion...");

  try {
    let brands;
    if (brandId) brands = [{ id: brandId }];
    else {
      const result = await env.D1_DB.prepare(`SELECT DISTINCT brand_id as id FROM franchise_menu_items WHERE status = 'ACTIVE'`).all();
      brands = result.results || [];
    }

    let promoted = 0, processed = 0;

    for (const brand of brands) {
      const items = await env.D1_DB.prepare(`SELECT * FROM franchise_menu_items WHERE brand_id = ? AND status = 'ACTIVE'`).bind(brand.id).all();

      for (const item of (items.results || [])) {
        processed++;
        const sightingCounts = await env.D1_DB.prepare(`
          SELECT daypart, COUNT(*) as count FROM menu_item_sightings WHERE menu_item_id = ? AND observed_at >= datetime('now', '-30 days') GROUP BY daypart
        `).bind(item.id).all();

        const counts = {};
        for (const row of (sightingCounts.results || [])) counts[row.daypart] = row.count;

        const promotions = determineDaypartPromotions(counts);
        for (const promo of promotions) {
          await upsertScopeWithDaypart(env, {
            menu_item_id: item.id, scope_type: "GLOBAL", scope_key: null,
            status: "ACTIVE", confidence: promo.confidence, daypart: promo.daypart
          });
          promoted++;
        }
      }
    }

    console.log(`[daypart-promote] Processed ${processed} items, promoted ${promoted} scopes`);
    return { ok: true, processed, promoted };
  } catch (err) {
    console.log("[daypart-promote] Error:", err?.message);
    return { ok: false, error: err?.message };
  }
}

/**
 * Determine daypart promotions based on sighting counts
 */
function determineDaypartPromotions(counts) {
  const promotions = [];
  const threshold = 3;
  const breakfast = counts.BREAKFAST || 0, lunch = counts.LUNCH || 0, dinner = counts.DINNER || 0, lateNight = counts.LATE_NIGHT || 0;

  if (breakfast >= threshold && lunch >= threshold && dinner >= threshold) {
    promotions.push({ daypart: "ALL_DAY", confidence: 0.85 });
    return promotions;
  }
  if (breakfast >= threshold && dinner < 2) promotions.push({ daypart: "BREAKFAST", confidence: 0.80 });
  if (lunch >= threshold && dinner >= threshold && breakfast < 2) {
    promotions.push({ daypart: "LUNCH", confidence: 0.75 });
    promotions.push({ daypart: "DINNER", confidence: 0.75 });
  } else {
    if (lunch >= threshold) promotions.push({ daypart: "LUNCH", confidence: 0.75 });
    if (dinner >= threshold) promotions.push({ daypart: "DINNER", confidence: 0.75 });
  }
  if (lateNight >= 2 && breakfast < 2 && lunch < 2) promotions.push({ daypart: "LATE_NIGHT", confidence: 0.70 });

  return promotions;
}

// --- Daypart-Aware Menu Rendering ---

/**
 * Get current daypart based on local time (minutes from midnight)
 */
function getCurrentDaypart(localMinutes) {
  if (localMinutes >= 240 && localMinutes < 660) return "BREAKFAST";
  if (localMinutes >= 660 && localMinutes < 960) return "LUNCH";
  if (localMinutes >= 960 && localMinutes < 1320) return "DINNER";
  return "LATE_NIGHT";
}

/**
 * Get effective menu for a store with daypart filtering
 */
async function getEffectiveMenuWithDaypart(env, storeId, options = {}) {
  if (!env?.D1_DB) return { ok: false, error: "No database" };
  const { daypart, includeAllDayparts = false, tzid } = options;

  try {
    const store = await getStore(env, { store_id: storeId });
    if (!store || !store.brand_id) return { ok: false, error: "Store not found or not a franchise" };

    let targetDaypart = daypart;
    if (!targetDaypart && tzid) {
      const tzOffsets = { "America/New_York": -5, "America/Chicago": -6, "America/Denver": -7, "America/Los_Angeles": -8 };
      const offset = tzOffsets[tzid] || -5;
      const now = new Date();
      const localHours = (now.getUTCHours() + offset + 24) % 24;
      const localMinutes = localHours * 60 + now.getUTCMinutes();
      targetDaypart = getCurrentDaypart(localMinutes);
    }

    let query, params;
    if (includeAllDayparts) {
      query = `SELECT DISTINCT fmi.id, fmi.canonical_name, fmi.category, fmi.description, fmi.calories,
        mis.daypart, mis.status as scope_status, mis.confidence, mis.price_cents, mis.scope_type
        FROM franchise_menu_items fmi LEFT JOIN menu_item_scopes mis ON fmi.id = mis.menu_item_id
        WHERE fmi.brand_id = ? AND fmi.status = 'ACTIVE' AND mis.status = 'ACTIVE'
        AND ((mis.scope_type = 'STORE' AND mis.scope_key = ?) OR (mis.scope_type = 'REGION' AND mis.scope_key = ?)
          OR (mis.scope_type = 'COUNTRY' AND mis.scope_key = ?) OR (mis.scope_type = 'GLOBAL' AND (mis.scope_key IS NULL OR mis.scope_key = '')))
        ORDER BY fmi.category, fmi.canonical_name`;
      params = [store.brand_id, String(storeId), store.region_code, store.country_code];
    } else {
      query = `SELECT DISTINCT fmi.id, fmi.canonical_name, fmi.category, fmi.description, fmi.calories,
        mis.daypart, mis.status as scope_status, mis.confidence, mis.price_cents, mis.scope_type,
        CASE WHEN mis.daypart = ? THEN 1 WHEN mis.daypart = 'ALL_DAY' THEN 2 WHEN mis.daypart = 'UNKNOWN' THEN 3 ELSE 4 END as daypart_priority
        FROM franchise_menu_items fmi LEFT JOIN menu_item_scopes mis ON fmi.id = mis.menu_item_id
        WHERE fmi.brand_id = ? AND fmi.status = 'ACTIVE' AND mis.status = 'ACTIVE' AND mis.daypart IN (?, 'ALL_DAY', 'UNKNOWN')
        AND ((mis.scope_type = 'STORE' AND mis.scope_key = ?) OR (mis.scope_type = 'REGION' AND mis.scope_key = ?)
          OR (mis.scope_type = 'COUNTRY' AND mis.scope_key = ?) OR (mis.scope_type = 'GLOBAL' AND (mis.scope_key IS NULL OR mis.scope_key = '')))
        ORDER BY daypart_priority, fmi.category, fmi.canonical_name`;
      params = [targetDaypart, store.brand_id, targetDaypart, String(storeId), store.region_code, store.country_code];
    }

    const result = await env.D1_DB.prepare(query).bind(...params).all();
    const itemMap = new Map();
    for (const row of (result.results || [])) {
      if (!itemMap.has(row.id) || row.daypart_priority < itemMap.get(row.id).daypart_priority) itemMap.set(row.id, row);
    }
    const items = Array.from(itemMap.values());

    return { ok: true, store_id: storeId, brand_id: store.brand_id, daypart: targetDaypart, items, item_count: items.length };
  } catch (err) {
    console.log("[daypart-menu] Error getting effective menu:", err?.message);
    return { ok: false, error: err?.message };
  }
}

// --- Cron Tick Handlers ---

/**
 * Process one tick of seeding
 */
async function seedingTick(env, ctx) {
  if (!env?.D1_DB) return { ok: false, error: "No database" };
  try {
    const run = await env.D1_DB.prepare(`SELECT * FROM franchise_seed_runs WHERE status = 'RUNNING' ORDER BY started_at DESC LIMIT 1`).first();
    if (!run) return { ok: true, message: "No running seed run" };

    const nextBrand = await env.D1_DB.prepare(`SELECT * FROM franchise_seed_progress WHERE run_id = ? AND status = 'PENDING' ORDER BY id LIMIT 1`).bind(run.run_id).first();
    if (!nextBrand) {
      await env.D1_DB.prepare(`UPDATE franchise_seed_runs SET status = 'DONE', finished_at = ?, updated_at = ? WHERE run_id = ?`).bind(new Date().toISOString(), new Date().toISOString(), run.run_id).run();
      return { ok: true, message: "Seed run completed", run_id: run.run_id };
    }

    console.log(`[seeding-tick] Processing ${nextBrand.brand_name}...`);
    const result = await seedOneFranchise(env, ctx, run.run_id, nextBrand.brand_name);
    await env.D1_DB.prepare(`UPDATE franchise_seed_runs SET current_index = current_index + 1, updated_at = ? WHERE run_id = ?`).bind(new Date().toISOString(), run.run_id).run();

    return { ok: true, brand: nextBrand.brand_name, result, run_id: run.run_id };
  } catch (err) {
    console.log("[seeding-tick] Error:", err?.message);
    return { ok: false, error: err?.message };
  }
}

/**
 * Process daypart job tick
 */
async function daypartJobTick(env, ctx) {
  if (!env?.D1_DB) return { ok: false, error: "No database" };
  try {
    const dueJobs = await getDueDaypartJobs(env, 3);
    if (dueJobs.length === 0) return { ok: true, message: "No due daypart jobs" };

    const results = [];
    for (const job of dueJobs) {
      const result = await processDaypartJob(env, ctx, job);
      results.push({ job_id: job.id, brand: job.brand_name, daypart: job.daypart, ...result });
      await new Promise(r => setTimeout(r, 2000));
    }
    return { ok: true, processed: results.length, results };
  } catch (err) {
    console.log("[daypart-tick] Error:", err?.message);
    return { ok: false, error: err?.message };
  }
}

/**
 * Get completed franchises list
 */
async function getCompletedFranchisesList(env, runId) {
  if (!env?.D1_DB) return null;
  try {
    const run = await env.D1_DB.prepare(`SELECT * FROM franchise_seed_runs WHERE run_id = ?`).bind(runId).first();
    if (!run) return null;

    const completed = await env.D1_DB.prepare(`SELECT brand_name, menu_item_count, analyzed_count, rep_stores_found, daypart_jobs_created, finished_at FROM franchise_seed_progress WHERE run_id = ? AND status = 'DONE' ORDER BY id`).bind(runId).all();
    const failed = await env.D1_DB.prepare(`SELECT brand_name, error FROM franchise_seed_progress WHERE run_id = ? AND status = 'FAILED' ORDER BY id`).bind(runId).all();

    let report = `COMPLETED_FRANCHISES (run_id=${runId})\nStarted: ${run.started_at}\nFinished: ${run.finished_at || "IN PROGRESS"}\nStatus: ${run.status}\n\n`;
    let totalItems = 0, totalAnalyzed = 0;

    const completedList = completed.results || [];
    for (let i = 0; i < completedList.length; i++) {
      const c = completedList[i];
      report += `${i + 1}) ${c.brand_name} - ${c.menu_item_count} items, ${c.analyzed_count} analyzed, ${c.rep_stores_found} stores, ${c.daypart_jobs_created} jobs\n`;
      totalItems += c.menu_item_count || 0;
      totalAnalyzed += c.analyzed_count || 0;
    }

    const failedList = failed.results || [];
    if (failedList.length > 0) {
      report += `\nFAILED (${failedList.length}):\n`;
      for (const f of failedList) report += `- ${f.brand_name}: ${f.error}\n`;
    }

    report += `\nTOTALS:\n- Completed: ${completedList.length}\n- Failed: ${failedList.length}\n- Total menu items: ${totalItems}\n- Total analyzed: ${totalAnalyzed}\n`;
    return report;
  } catch (err) {
    console.log("[daypart-seed] Get completed list error:", err?.message);
    return null;
  }
}

/**
 * Get daypart coverage status
 */
async function getDaypartStatus(env) {
  if (!env?.D1_DB) return null;
  try {
    const jobs = await env.D1_DB.prepare(`SELECT daypart, status, COUNT(*) as count FROM franchise_daypart_jobs GROUP BY daypart, status`).all();
    const scopes = await env.D1_DB.prepare(`SELECT daypart, scope_type, COUNT(DISTINCT menu_item_id) as item_count FROM menu_item_scopes WHERE status = 'ACTIVE' GROUP BY daypart, scope_type`).all();
    const analysis = await env.D1_DB.prepare(`SELECT brand_id, COUNT(*) as total, SUM(CASE WHEN status = 'COMPLETE' THEN 1 ELSE 0 END) as complete FROM franchise_analysis_cache GROUP BY brand_id`).all();
    return { jobs: jobs.results || [], scopes: scopes.results || [], analysis: analysis.results || [] };
  } catch (err) {
    console.log("[daypart-status] Error:", err?.message);
    return null;
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
  const tStart = Date.now(); // total timer

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

  // Full recipe generation flag
  const wantFullRecipe = body.fullRecipe === true || body.full_recipe === true;

  // LATENCY OPTIMIZATION: Skip organs LLM for faster initial response
  // Frontend can lazy-load organs when user expands that section
  const skipOrgans = body.skip_organs === true || body.skipOrgans === true;

  // basic validation
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

  // ---- Dish-level cache (KV) ----
  const forceReanalyze =
    body.force_reanalyze === true ||
    body.forceReanalyze === true ||
    body.force_reanalyze === 1;

  const allowCache =
    !devFlag && !forceReanalyze && !selectionComponentIdsInput;

  let cacheKey = null;
  if (allowCache && env && env.DISH_ANALYSIS_CACHE) {
    try {
      cacheKey = buildDishCacheKey(body);
      const cached = await env.DISH_ANALYSIS_CACHE.get(cacheKey, "json");
      if (cached && cached.ok) {
        cached.debug = cached.debug || {};
        cached.debug.cache_hit_dish_analysis = true;
        cached.debug.pipeline_version = PIPELINE_VERSION;
        cached.debug.total_ms = Date.now() - tStart;
        return { status: 200, result: cached };
      }
    } catch (e) {
      // cache read failure should not break analysis
      debug.cache_read_error = String(e);
    }
  }

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

  // ========== LATENCY OPTIMIZATION: Run recipe + combo + image ops in parallel ==========
  // All three operations are independent and can start immediately
  const tParallelStart = Date.now();

  const recipePromise = (async () => {
    const t0 = Date.now();
    const result = await resolveRecipeWithCache(env, {
      dishTitle: dishName,
      placeId: body.placeId || body.place_id || "",
      cuisine: body.cuisine || "",
      lang: body.lang || "en",
      forceReanalyze: forceReanalyze,
      classify: true,
      shape: "recipe_card",
      providersOverride: Array.isArray(body.providers)
        ? body.providers.map((p) => String(p || "").toLowerCase())
        : null,
      parse: true,
      userId: body.user_id || body.userId || "",
      devFlag
    });
    debug.t_recipe_ms = Date.now() - t0;
    return result;
  })();

  const comboPromise = (async () => {
    const t0 = Date.now();
    try {
      const result = await resolveComboComponents(env, dishName, restaurantName);
      debug.t_combo_ms = Date.now() - t0;
      return { ok: true, result };
    } catch (comboErr) {
      debug.t_combo_ms = Date.now() - t0;
      debug.combo_error = String(comboErr);
      return { ok: false, error: comboErr };
    }
  })();

  // LATENCY OPTIMIZATION: Start image operations in parallel with recipe + combo
  // Saves 500-1500ms by not waiting for recipe/combo to complete first
  const imageOpsPromise = dishImageUrl ? (async () => {
    const t0 = Date.now();
    try {
      const [fsImageSettled, portionVisionSettled] = await Promise.allSettled([
        callFatSecretImageRecognition(env, dishImageUrl),
        runPortionVisionLLM(env, {
          dishName,
          restaurantName,
          menuDescription,
          menuSection,
          imageUrl: dishImageUrl
        })
      ]);
      return {
        ok: true,
        fsImageSettled,
        portionVisionSettled,
        ms: Date.now() - t0
      };
    } catch (e) {
      return { ok: false, error: String(e), ms: Date.now() - t0 };
    }
  })() : Promise.resolve(null);

  // Wait for all three in parallel
  const [recipeResult, comboSettled, imageOpsResult] = await Promise.all([
    recipePromise,
    comboPromise,
    imageOpsPromise
  ]);
  debug.t_parallel_recipe_combo_ms = Date.now() - tParallelStart;
  if (imageOpsResult?.ms) {
    debug.t_image_ops_early_ms = imageOpsResult.ms;
  }

  // Process combo result
  let comboResult = null;
  let isComboPlate = false;
  if (comboSettled.ok) {
    comboResult = comboSettled.result;
    isComboPlate = comboResult?.isCombo === true;
    if (comboResult?.debug) {
      debug.combo = comboResult.debug;
    }
    if (isComboPlate && comboResult.plate_components?.length > 0) {
      plateComponents = comboResult.plate_components;
      debug.combo_source = comboResult.source;
      debug.combo_components_count = comboResult.plate_components.length;
    }
  }

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

  // Tier 4 fallback: Sum combo component nutrition if available
  if (
    !finalNutritionSummary &&
    isComboPlate &&
    comboResult?.nutrition_breakdown &&
    Array.isArray(comboResult.nutrition_breakdown) &&
    comboResult.nutrition_breakdown.length > 0
  ) {
    try {
      const comboSummary = comboResult.nutrition_breakdown.reduce(
        (acc, comp) => {
          acc.energyKcal += comp.energyKcal || 0;
          acc.protein_g += comp.protein_g || 0;
          acc.fat_g += comp.fat_g || 0;
          acc.carbs_g += comp.carbs_g || 0;
          acc.sugar_g += comp.sugar_g || 0;
          acc.fiber_g += comp.fiber_g || 0;
          acc.sodium_mg += comp.sodium_mg || 0;
          return acc;
        },
        { energyKcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, sugar_g: 0, fiber_g: 0, sodium_mg: 0 }
      );
      if (comboSummary.energyKcal > 0) {
        finalNutritionSummary = comboSummary;
        nutrition_source = "combo_decomposition";
      }
    } catch (e) {
      // non-fatal
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

  // LATENCY OPTIMIZATION: Start FatSecret as a promise to run parallel with LLMs
  const tFatsecretStart = Date.now();
  const fatsecretPromise = (async () => {
    const result = await classifyIngredientsWithFatSecret(env, ingredientsForLex, "en");
    debug.t_fatsecret_ms = Date.now() - tFatsecretStart;
    return result;
  })();

  // These can be computed now (don't depend on FatSecret)
  const inferredTextHits = inferHitsFromText(dishName, menuDescription);
  const inferredIngredientHits = inferHitsFromIngredients(
    Array.isArray(ingredients) && ingredients.length
      ? ingredients
      : normalized.items || []
  );
  // Note: combinedHits will be computed after awaiting fatsecretPromise
  // This allows FatSecret to run in parallel with LLM calls

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
  let combinedHits = []; // Will be populated after FatSecret completes
  let fatsecretResult = null; // Declared here so it's accessible after the if/else block
  let fatsecretHits = []; // Declared here so it's accessible after the if/else block

  if (useParallel) {
    const nutritionInput = finalNutritionSummary
      ? {
          dishName,
          restaurantName,
          nutrition_summary: finalNutritionSummary,
          tags: nutrition_badges || []
        }
      : null;

    const allergenPromise = (async () => {
      const t0 = Date.now();
      const res = await runAllergenTieredLLM(env, allergenInput);
      debug.t_llm_allergen_ms = Date.now() - t0;
      debug.allergen_llm_provider = res.provider || null;
      debug.allergen_llm_tier = res.tier || null;
      return res;
    })();

    // LATENCY OPTIMIZATION: Skip organs LLM if skip_organs=true
    // Organs will run in background via waitUntil and be cached separately
    let organsPromise;
    let organsCacheKey = null;

    if (skipOrgans) {
      // Build cache key for organs-only storage
      organsCacheKey = `organs:${PIPELINE_VERSION}:${hashShort([dishName, restaurantName].join("|"))}`;

      // Start organs in BACKGROUND via waitUntil - doesn't block response
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil((async () => {
          try {
            const res = await runOrgansLLM(env, llmPayload);
            if (res.ok && env?.MENUS_CACHE) {
              // Cache organs result separately for polling
              await env.MENUS_CACHE.put(organsCacheKey, JSON.stringify({
                ok: true,
                data: res.data,
                timestamp: Date.now()
              }));
            }
          } catch (e) {
            console.error("Background organs LLM failed:", e);
          }
        })());
      }

      organsPromise = Promise.resolve({ ok: true, skipped: true, data: null });
    } else {
      organsPromise = (async () => {
        const t0 = Date.now();
        const res = await runOrgansLLM(env, llmPayload);
        debug.t_llm_organs_ms = Date.now() - t0;
        return res;
      })();
    }

    const nutritionPromise = nutritionInput
      ? (async () => {
          const t0 = Date.now();
          const res = await runNutritionMiniLLM(env, nutritionInput);
          debug.t_llm_nutrition_ms = Date.now() - t0;
          return res;
        })()
      : null;

    // LATENCY OPTIMIZATION: Include FatSecret in parallel with LLMs
    const promises = [allergenPromise, organsPromise, nutritionPromise, fatsecretPromise];

    const [allergenSettled, organsSettled, nutritionSettled, fatsecretSettled] =
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

    // Process FatSecret result
    fatsecretResult = fatsecretSettled.status === "fulfilled" ? fatsecretSettled.value : null;
    fatsecretHits = fatsecretResult?.ok ? fatsecretResult.allIngredientHits || [] : [];
    combinedHits = [
      ...fatsecretHits,
      ...(Array.isArray(inferredTextHits) ? inferredTextHits : []),
      ...(Array.isArray(inferredIngredientHits) ? inferredIngredientHits : [])
    ];
  } else {
    allergenMiniResult = await (async () => {
      const t0 = Date.now();
      const res = await runAllergenTieredLLM(env, allergenInput);
      debug.t_llm_allergen_ms = Date.now() - t0;
      debug.allergen_llm_provider = res.provider || null;
      debug.allergen_llm_tier = res.tier || null;
      return res;
    })();
    // LATENCY OPTIMIZATION: Skip organs LLM if skip_organs=true
    // Run in background via waitUntil if skipping
    if (skipOrgans) {
      const organsCacheKey = `organs:${PIPELINE_VERSION}:${hashShort([dishName, restaurantName].join("|"))}`;
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil((async () => {
          try {
            const res = await runOrgansLLM(env, llmPayload);
            if (res.ok && env?.MENUS_CACHE) {
              await env.MENUS_CACHE.put(organsCacheKey, JSON.stringify({
                ok: true,
                data: res.data,
                timestamp: Date.now()
              }));
            }
          } catch (e) {
            console.error("Background organs LLM failed:", e);
          }
        })());
      }
      organsLLMResult = { ok: true, skipped: true, data: null };
    } else {
      organsLLMResult = await (async () => {
        const t0 = Date.now();
        const res = await runOrgansLLM(env, llmPayload);
        debug.t_llm_organs_ms = Date.now() - t0;
        return res;
      })();
    }

    if (finalNutritionSummary) {
      const nutritionInput = {
        dishName,
        restaurantName,
        nutrition_summary: finalNutritionSummary,
        tags: nutrition_badges || []
      };
      nutrition_insights = await (async () => {
        const t0 = Date.now();
        const res = await runNutritionMiniLLM(env, nutritionInput);
        debug.t_llm_nutrition_ms = Date.now() - t0;
        return res;
      })();
    }

    // Await FatSecret in non-parallel mode
    fatsecretResult = await fatsecretPromise;
    fatsecretHits = fatsecretResult?.ok ? fatsecretResult.allIngredientHits || [] : [];
    combinedHits = [
      ...fatsecretHits,
      ...(Array.isArray(inferredTextHits) ? inferredTextHits : []),
      ...(Array.isArray(inferredIngredientHits) ? inferredIngredientHits : [])
    ];
  }

  const tLLMsEnd = Date.now();
  debug.llms_ms = tLLMsEnd - tLLMsStart;
  debug.llms_parallel = !!useParallel;
  debug.allergen_llm_ok =
    allergenMiniResult && typeof allergenMiniResult.ok === "boolean"
      ? allergenMiniResult.ok
      : null;
  debug.allergen_llm_error =
    allergenMiniResult && allergenMiniResult.ok === false
      ? String(allergenMiniResult.error || "")
      : null;

  debug.organs_llm_ok =
    organsLLMResult && typeof organsLLMResult.ok === "boolean"
      ? organsLLMResult.ok
      : null;
  debug.organs_llm_skipped = skipOrgans;
  debug.organs_llm_error =
    organsLLMResult && organsLLMResult.ok === false
      ? String(organsLLMResult.error || "")
      : null;

  // nutrition_insights can be null or a plain object; we only track explicit LLM error patterns
  debug.nutrition_llm_ok =
    nutrition_insights && typeof nutrition_insights === "object"
      ? (nutrition_insights.ok === false ? false : true)
      : null;
  debug.nutrition_llm_error =
    nutrition_insights && nutrition_insights.ok === false
      ? String(nutrition_insights.error || "")
      : null;

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
          return runAllergenTieredLLM(env, compInput);
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
    // All LLM tiers failed - this should be extremely rare with OpenAI + Grok + Cloudflare
    debug.allergen_llm_raw = allergenMiniResult || null;
    debug.allergen_all_tiers_failed = true;
    debug.allergen_error = allergenMiniResult?.error || "all-tiers-failed";
    console.error("CRITICAL: All allergen LLM tiers failed:", allergenMiniResult?.error);
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

  // Process image operations results (already started in parallel with recipe + combo)
  let portionVisionDebug = null;

  if (dishImageUrl && imageOpsResult && imageOpsResult.ok) {
    // Use results from early parallel execution
    const { fsImageSettled, portionVisionSettled } = imageOpsResult;

    // Process FatSecret result (shared for debug + production)
    if (fsImageSettled && fsImageSettled.status === "fulfilled") {
      const fsImageResult = fsImageSettled.value;
      fatsecretImageResult = fsImageResult;
      debug.fatsecret_image_result = fsImageResult;

      if (fsImageResult && fsImageResult.ok && fsImageResult.raw) {
        if (devFlag) {
          debug.fatsecret_image_raw = fsImageResult.raw;
        }

        try {
          const normalized = normalizeFatSecretImageResult(fsImageResult.raw);
          fatsecretNormalized = normalized;
          debug.fatsecret_image_normalized = normalized;

          if (
            normalized &&
            Array.isArray(normalized.nutrition_breakdown) &&
            normalized.nutrition_breakdown.length > 0
          ) {
            fatsecretNutritionBreakdown = normalized.nutrition_breakdown;

            // Sum FatSecret component nutrition for the final summary
            const fsSum = normalized.nutrition_breakdown.reduce(
              (acc, comp) => {
                acc.energyKcal += comp.energyKcal || 0;
                acc.protein_g += comp.protein_g || 0;
                acc.fat_g += comp.fat_g || 0;
                acc.carbs_g += comp.carbs_g || 0;
                acc.sugar_g += comp.sugar_g || 0;
                acc.fiber_g += comp.fiber_g || 0;
                acc.sodium_mg += comp.sodium_mg || 0;
                return acc;
              },
              { energyKcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, sugar_g: 0, fiber_g: 0, sodium_mg: 0 }
            );

            // Use FatSecret image nutrition as finalNutritionSummary
            if (fsSum.energyKcal > 0) {
              finalNutritionSummary = fsSum;
              nutrition_source = "fatsecret_image";
              debug.fatsecret_nutrition_sum = fsSum;
            }
          }

          if (normalized && normalized.component_allergens) {
            debug.fatsecret_component_allergens = normalized.component_allergens;
            fsComponentAllergens = normalized.component_allergens;
          }
        } catch (e) {
          debug.fatsecret_image_normalized_error = String(e && e.message ? e.message : e);
        }
      } else if (fsImageResult && !fsImageResult.ok) {
        debug.fatsecret_image_error = fsImageResult.error || "unknown_error";
      }
    } else if (fsImageSettled) {
      debug.fatsecret_image_error = "exception:" + String(fsImageSettled.reason);
    }

    // Process portion vision result
    if (portionVisionSettled && portionVisionSettled.status === "fulfilled") {
      portionVisionDebug = portionVisionSettled.value;
    } else if (portionVisionSettled) {
      portionVisionDebug = {
        ok: false,
        source: "portion_vision_stub",
        error: String(portionVisionSettled.reason)
      };
    }
  }

  debug.portion_vision = portionVisionDebug;
  if (
    portionVisionDebug &&
    portionVisionDebug.ok &&
    portionVisionDebug.insights
  ) {
    debug.vision_insights = portionVisionDebug.insights;
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

  // Normalize nutrition to per-serving values using recipe yield
  // SKIP this divisor when restaurantCalories is provided (already per-serving)
  const hasRestaurantCaloriesForDivisor = restaurantCalories != null && !Number.isNaN(Number(restaurantCalories));
  try {
    let servingsDivisor = 1;
    const recipeProvider =
      recipeResult?.out?.provider ??
      recipeResult?.source ??
      recipeResult?.responseSource ??
      null;
    const recipeOut = recipeResult?.out;
    const recipeRaw = recipeOut?.raw;

    // Get yield from Edamam raw response or recipe out
    const edamamYield = recipeRaw && typeof recipeRaw.yield === "number" ? recipeRaw.yield : null;
    const recipeYield = recipeOut && typeof recipeOut.yield === "number" ? recipeOut.yield : null;
    const recipeServings = recipeOut && typeof recipeOut.servings === "number" ? recipeOut.servings : null;

    // Use the best available serving count
    const actualYield = edamamYield || recipeYield || recipeServings;
    const hasYield = actualYield && actualYield > 0;

    if (!hasRestaurantCaloriesForDivisor && hasYield && actualYield > 1) {
      // Edamam/Spoonacular: use actual yield from recipe
      servingsDivisor = actualYield;
    } else if (recipeProvider === "openai" && !hasYield && !hasRestaurantCaloriesForDivisor) {
      // OpenAI fallback: assume 4 servings when no yield info
      servingsDivisor = 4;
    }

    // Skip per-serving divisor when:
    // 1. nutrition_source is "fatsecret_image" (FatSecret returns per-portion values from detected food)
    // 2. Other conditions already handled (restaurantCalories, etc.)
    const skipDivisorForFatSecret = nutrition_source === "fatsecret_image";

    if (
      servingsDivisor > 1 &&
      finalNutritionSummary &&
      typeof finalNutritionSummary === "object" &&
      !skipDivisorForFatSecret
    ) {
      finalNutritionSummary = {
        energyKcal:
          typeof finalNutritionSummary.energyKcal === "number"
            ? finalNutritionSummary.energyKcal / servingsDivisor
            : finalNutritionSummary.energyKcal,
        protein_g:
          typeof finalNutritionSummary.protein_g === "number"
            ? finalNutritionSummary.protein_g / servingsDivisor
            : finalNutritionSummary.protein_g,
        fat_g:
          typeof finalNutritionSummary.fat_g === "number"
            ? finalNutritionSummary.fat_g / servingsDivisor
            : finalNutritionSummary.fat_g,
        carbs_g:
          typeof finalNutritionSummary.carbs_g === "number"
            ? finalNutritionSummary.carbs_g / servingsDivisor
            : finalNutritionSummary.carbs_g,
        sugar_g:
          typeof finalNutritionSummary.sugar_g === "number"
            ? finalNutritionSummary.sugar_g / servingsDivisor
            : finalNutritionSummary.sugar_g,
        fiber_g:
          typeof finalNutritionSummary.fiber_g === "number"
            ? finalNutritionSummary.fiber_g / servingsDivisor
            : finalNutritionSummary.fiber_g,
        sodium_mg:
          typeof finalNutritionSummary.sodium_mg === "number"
            ? finalNutritionSummary.sodium_mg / servingsDivisor
            : finalNutritionSummary.sodium_mg
      };

      debug.servings_divisor = servingsDivisor;
      debug.servings_source = edamamYield ? "edamam_yield" : recipeYield ? "recipe_yield" : recipeServings ? "recipe_servings" : "openai_default";
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

  // Skip portion factor when restaurantCalories is provided - those are already per-serving from the menu
  const hasRestaurantCalories = restaurantCalories != null && !Number.isNaN(Number(restaurantCalories));

  if (
    finalNutritionSummary &&
    typeof effectivePortionFactor === "number" &&
    isFinite(effectivePortionFactor) &&
    effectivePortionFactor !== 1 &&
    !hasRestaurantCalories
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
  } else if (hasRestaurantCalories) {
    debug.nutrition_portion_factor_skipped = "restaurant_calories_already_per_serving";
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
  debug.t_nutrition_ms = debug.t_nutrition_ms || 0; // placeholder for finer nutrition timing

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
    } else if (finalNutritionSummary) {
      // Fallback: Create single whole-dish component when no plate components
      // This ensures nutrition_breakdown is never null when we have nutrition data
      const dishLabel = dishName || "Whole Dish";
      nutritionBreakdown = [
        {
          component_id: "whole_dish",
          component: dishLabel,
          role: "main",
          category: "whole_dish",
          share_ratio: 1,
          energyKcal: finalNutritionSummary.energyKcal || 0,
          protein_g: finalNutritionSummary.protein_g || 0,
          fat_g: finalNutritionSummary.fat_g || 0,
          carbs_g: finalNutritionSummary.carbs_g || 0,
          sugar_g: finalNutritionSummary.sugar_g || 0,
          fiber_g: finalNutritionSummary.fiber_g || 0,
          sodium_mg: finalNutritionSummary.sodium_mg || 0
        }
      ];
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
      let fsCoarseComponentAllergens = null;
      try {
        const pcsForFs = Array.isArray(plateComponents) ? plateComponents : [];
        if (
          pcsForFs.length > 0 &&
          fsComponentAllergens &&
          typeof fsComponentAllergens === "object"
        ) {
          fsCoarseComponentAllergens = {};

          const fsEntries = Object.entries(fsComponentAllergens);

          if (debug) {
            debug.fs_coarse_mapping_inputs = {
              plate_components_for_fs: pcsForFs.map((c, idx) => ({
                idx,
                id: c && c.component_id,
                label: c && (c.label || c.component || c.name || null)
              })),
              fs_keys: fsEntries.map(([k]) => k)
            };
          }

          pcsForFs.forEach((comp, idx) => {
            const coarseId = comp && comp.component_id;
            if (typeof coarseId !== "string" || !coarseId) return;

            // 1) Try index-based fs_c{idx}
            const fsIdIndex = `fs_c${idx}`;
            let fsEntry = fsComponentAllergens[fsIdIndex];

            // 2) Fallback: zip over fsEntries by order if index-based missing
            if (
              (!fsEntry ||
                !Array.isArray(fsEntry.allergen_flags) ||
                fsEntry.allergen_flags.length === 0) &&
              fsEntries.length > idx
            ) {
              const [, entryByOrder] = fsEntries[idx];
              fsEntry = entryByOrder;
            }

            if (
              fsEntry &&
              Array.isArray(fsEntry.allergen_flags) &&
              fsEntry.allergen_flags.length > 0
            ) {
              fsCoarseComponentAllergens[coarseId] = {
                allergen_flags: fsEntry.allergen_flags
              };
            }
          });

          if (
            debug &&
            fsCoarseComponentAllergens &&
            Object.keys(fsCoarseComponentAllergens).length > 0
          ) {
            debug.fs_coarse_component_allergens = fsCoarseComponentAllergens;
          }
        }
      } catch (err) {
        if (debug) {
          debug.fs_coarse_allergens_mapping_error = String(
            (err && (err.stack || err.message)) || err
          );
        }
      }

      const selectionInput = {
        plate_components: plateComponents,
        allergen_breakdown,
        fs_component_allergens: fsCoarseComponentAllergens || fsComponentAllergens,
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

  debug.total_ms = Date.now() - tStart;
  debug.pipeline_version = PIPELINE_VERSION;

  // Build smart human-readable summaries
  const allergen_summary = buildSmartAllergenSummary(allergen_flags, lactose_flags, allergen_breakdown);
  const fodmap_summary = buildSmartFodmapSummary(fodmap_flags, allergen_breakdown, plateComponents);

  // Build Likely Recipe (merges recipe + vision ingredients + adjusted cooking method)
  const visionInsightsForRecipe = debug.vision_insights || null;

  // Apply vision corrections to recipe (e.g., image shows spaghetti but recipe says penne)
  let correctedRecipeResult = recipeResult;
  let visionCorrections = null;
  if (visionInsightsForRecipe && recipeResult) {
    visionCorrections = applyVisionCorrections(visionInsightsForRecipe, recipeResult);
    if (visionCorrections && visionCorrections.applied && visionCorrections.corrections.length > 0) {
      correctedRecipeResult = visionCorrections.corrected;
      debug.vision_corrections = {
        applied: visionCorrections.corrections,
        count: visionCorrections.correction_count,
        original_recipe_source: recipeResult?.source || recipeResult?.responseSource || "unknown"
      };
    }
  }

  const likely_recipe = buildLikelyRecipe(correctedRecipeResult, visionInsightsForRecipe, nutritionBreakdown);

  // Build Full Recipe if requested (cookbook-style with LLM)
  let full_recipe = null;
  if (wantFullRecipe) {
    const tFullRecipeStart = Date.now();
    try {
      full_recipe = await buildFullRecipe(env, {
        dishName,
        likelyRecipe: likely_recipe,
        visionInsights: visionInsightsForRecipe,
        plateComponents,
        nutritionSummary: finalNutritionSummary,
        allergenFlags: allergen_flags,
        fodmapFlags: fodmap_flags,
        menuDescription
      });
      debug.full_recipe_ms = Date.now() - tFullRecipeStart;
      debug.full_recipe_method = full_recipe?.generation_method || "unknown";
    } catch (e) {
      debug.full_recipe_error = String(e?.message || e);
      debug.full_recipe_ms = Date.now() - tFullRecipeStart;
    }
  }

  // Extract recipe image from provider (Spoonacular/Edamam)
  const recipeImage = recipeResult?.recipe?.image || null;

  // ---- User Personalization (if user_id provided) ----
  let personalization = null;
  const userId = body.user_id || body.userId || null;

  if (userId && env?.D1_DB) {
    try {
      const tPersonalizationStart = Date.now();

      // Fetch user data in parallel
      const [userProfile, userTargets, userAllergens, userOrganPriorities] = await Promise.all([
        getUserProfile(env, userId),
        getUserTargets(env, userId),
        getUserAllergens(env, userId),
        getUserOrganPriorities(env, userId)
      ]);

      // Calculate age for organ sensitivity adjustment
      const userAge = userProfile?.date_of_birth ? calculateAge(userProfile.date_of_birth) : null;

      // Personalize organ scores based on age
      let personalizedOrgans = null;
      if (organs && typeof organs === 'object') {
        personalizedOrgans = {};
        for (const [organName, organData] of Object.entries(organs)) {
          // Calculate net score for this organ
          let netScore = 0;
          if (Array.isArray(organData)) {
            for (const item of organData) {
              const strength = item.strength || 0;
              if (item.effect === 'benefit') netScore += strength;
              else if (item.effect === 'risk') netScore -= strength;
            }
          }

          // Adjust for age if applicable
          const adjustedScore = userAge ? adjustOrganScoreForAge(netScore, organName, userAge) : netScore;

          personalizedOrgans[organName] = {
            score: adjustedScore,
            raw_score: netScore,
            details: organData,
            is_priority: userOrganPriorities.some(p => p.organ_code === organName && p.is_starred)
          };
        }
      }

      // Check for personal risk flags based on user allergens
      const personalRiskFlags = [];
      const userAllergenCodes = userAllergens.map(a => a.allergen_code);

      // Check allergen flags against user's allergens
      if (Array.isArray(allergen_flags)) {
        for (const flag of allergen_flags) {
          const flagKind = (flag.kind || flag.allergen || '').toLowerCase();
          if (userAllergenCodes.includes(flagKind) && (flag.present === 'yes' || flag.present === true)) {
            personalRiskFlags.push({
              type: 'allergen',
              allergen: flagKind,
              severity: userAllergens.find(a => a.allergen_code === flagKind)?.severity || 'avoid',
              message: `Contains ${flagKind} - in your avoid list`
            });
          }
        }
      }

      // Check lactose for lactose intolerant users
      if (userAllergenCodes.includes('lactose') && lactose_flags) {
        if (lactose_flags.lactose_present === 'yes' || lactose_flags.has_lactose) {
          personalRiskFlags.push({
            type: 'sensitivity',
            sensitivity: 'lactose',
            message: 'Contains lactose - may cause digestive discomfort'
          });
        }
      }

      // Check FODMAP for IBS/FODMAP sensitive users
      if (userAllergenCodes.includes('fodmap') && fodmap_flags) {
        const fodmapLevel = fodmap_flags.overall_fodmap_level || fodmap_flags.level || '';
        if (fodmapLevel === 'high' || fodmapLevel === 'moderate') {
          personalRiskFlags.push({
            type: 'sensitivity',
            sensitivity: 'fodmap',
            level: fodmapLevel,
            message: `${fodmapLevel.charAt(0).toUpperCase() + fodmapLevel.slice(1)} FODMAP - may trigger IBS symptoms`
          });
        }
      }

      // Check nutrition against personal limits
      if (finalNutritionSummary && userTargets) {
        const sugar = finalNutritionSummary.sugar_g || finalNutritionSummary.sugars_g || 0;
        const sodium = finalNutritionSummary.sodium_mg || 0;

        // Adjust for portion
        const portionMult = body.portionFactor || 1.0;
        const adjustedSugar = sugar * portionMult;
        const adjustedSodium = sodium * portionMult;

        if (userTargets.sugar_limit_g && adjustedSugar > userTargets.sugar_limit_g * 0.5) {
          personalRiskFlags.push({
            type: 'nutrition',
            nutrient: 'sugar',
            amount: Math.round(adjustedSugar),
            limit: userTargets.sugar_limit_g,
            message: adjustedSugar > userTargets.sugar_limit_g
              ? `Sugar (${Math.round(adjustedSugar)}g) exceeds your daily limit`
              : `High sugar content (${Math.round(adjustedSugar)}g) - over 50% of your limit`
          });
        }

        if (userTargets.sodium_limit_mg && adjustedSodium > userTargets.sodium_limit_mg * 0.5) {
          personalRiskFlags.push({
            type: 'nutrition',
            nutrient: 'sodium',
            amount: Math.round(adjustedSodium),
            limit: userTargets.sodium_limit_mg,
            message: adjustedSodium > userTargets.sodium_limit_mg
              ? `Sodium (${Math.round(adjustedSodium)}mg) exceeds your daily limit`
              : `High sodium content (${Math.round(adjustedSodium)}mg) - over 50% of your limit`
          });
        }
      }

      // Sort organs by user priority
      let sortedOrganImpacts = [];
      if (personalizedOrgans) {
        const priorityMap = {};
        userOrganPriorities.forEach((o, i) => { priorityMap[o.organ_code] = i; });

        sortedOrganImpacts = Object.entries(personalizedOrgans)
          .map(([organ, data]) => ({
            organ,
            ...data
          }))
          .sort((a, b) => {
            // Starred organs first, then by priority rank, then by absolute score
            if (a.is_priority && !b.is_priority) return -1;
            if (!a.is_priority && b.is_priority) return 1;
            const aIdx = priorityMap[a.organ] ?? 999;
            const bIdx = priorityMap[b.organ] ?? 999;
            if (aIdx !== bIdx) return aIdx - bIdx;
            return Math.abs(b.score) - Math.abs(a.score);
          });
      }

      personalization = {
        user_id: userId,
        profile_complete: !!userProfile?.profile_completed_at,
        targets: userTargets,
        personal_risk_flags: personalRiskFlags,
        organ_impacts: sortedOrganImpacts.slice(0, 3), // Top 3 for display
        organ_impacts_full: sortedOrganImpacts,
        allergen_codes: userAllergenCodes,
        organ_priorities: userOrganPriorities.map(o => o.organ_code)
      };

      debug.t_personalization_ms = Date.now() - tPersonalizationStart;
    } catch (e) {
      debug.personalization_error = String(e?.message || e);
    }
  }

  const result = {
    ok: true,
    apiVersion: "v1",
    source: "pipeline.analyze-dish",
    dishName,
    restaurantName,
    imageUrl: dishImageUrl,
    recipe_image: recipeImage,
    summary,
    recipe: correctedRecipeResult,
    likely_recipe,
    full_recipe,
    vision_corrections: visionCorrections?.corrections?.length > 0 ? visionCorrections.corrections : null,
    normalized,
    organs,
    organs_pending: skipOrgans, // Flag for frontend to poll for organs
    organs_poll_key: skipOrgans ? `organs:${PIPELINE_VERSION}:${hashShort([dishName, restaurantName].join("|"))}` : null,
    allergen_flags,
    allergen_summary,
    allergen_breakdown,
    fodmap_flags,
    fodmap_summary,
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
    personalization,
    debug
  };

  // ---- store in KV cache (best-effort) ----
  if (allowCache && cacheKey && env && env.DISH_ANALYSIS_CACHE) {
    try {
      const toCache = { ...result, debug: { ...result.debug } };
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(
          env.DISH_ANALYSIS_CACHE.put(cacheKey, JSON.stringify(toCache), {
            expirationTtl: 60 * 60 * 12 // 12 hours
          })
        );
      } else {
        env.DISH_ANALYSIS_CACHE.put(cacheKey, JSON.stringify(toCache), {
          expirationTtl: 60 * 60 * 12
        });
      }
    } catch (e) {
      // do not break response if cache write fails
      debug.cache_write_error = String(e);
    }
  }

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
    res = await fetchWithTimeout(
      `${env.FATSECRET_PROXY_URL}/fatsecret/allergens`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.PROXY_API_KEY
        },
        body: JSON.stringify({ ingredients, lang })
      },
      6000 // 6s timeout for FatSecret proxy
    );
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

// LATENCY OPTIMIZATION: FatSecret ingredient-level KV cache
// Ingredient allergen data is PERMANENT - milk will always contain lactose
// Version prefix allows bulk invalidation if FatSecret schema changes
const FATSECRET_CACHE_VERSION = "v1";

async function getFatSecretCached(env, ingredientName) {
  if (!env?.MENUS_CACHE || !ingredientName) return null;
  const key = `fatsecret:${FATSECRET_CACHE_VERSION}:${ingredientName.toLowerCase().trim()}`;
  try {
    return await env.MENUS_CACHE.get(key, "json");
  } catch {
    return null;
  }
}

async function putFatSecretCached(env, ingredientName, data) {
  if (!env?.MENUS_CACHE || !ingredientName) return;
  const key = `fatsecret:${FATSECRET_CACHE_VERSION}:${ingredientName.toLowerCase().trim()}`;
  try {
    // NO TTL - ingredient allergen data is permanent knowledge
    // "Milk contains lactose" doesn't expire
    await env.MENUS_CACHE.put(key, JSON.stringify(data));
  } catch {
    // Cache write failure is non-fatal
  }
}

// classifyIngredientsWithFatSecret:
// Uses our FatSecret proxy (Render) to turn ingredient names into
// lex-style hits focused on allergens + lactose.
// LATENCY OPTIMIZATION: Now with ingredient-level KV caching
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

  if (!ingredientNames.length) {
    return { ok: true, perIngredient: [], allIngredientHits: [] };
  }

  // LATENCY OPTIMIZATION: Check KV cache for each ingredient in parallel
  const cacheResults = await Promise.all(
    ingredientNames.map(async (name) => {
      const cached = await getFatSecretCached(env, name);
      return { name, cached };
    })
  );

  const cachedIngredients = [];
  const uncachedNames = [];

  for (const { name, cached } of cacheResults) {
    if (cached) {
      cachedIngredients.push({ ingredient: name, ...cached });
    } else {
      uncachedNames.push(name);
    }
  }

  // Only call proxy for uncached ingredients
  let proxyResults = [];
  if (uncachedNames.length > 0) {
    const result = await fetchFatSecretAllergensViaProxy(
      env,
      uncachedNames,
      lang
    );
    if (result.ok && result.results) {
      proxyResults = result.results;
      // Cache the new results (non-blocking)
      for (const row of proxyResults) {
        if (row?.ingredient) {
          putFatSecretCached(env, row.ingredient, {
            food_attributes: row.food_attributes || {},
            _cachedAt: new Date().toISOString()
          });
        }
      }
    }
  }

  // Combine cached + fresh results
  const perIngredient = [];
  const allIngredientHits = [];

  // Process cached ingredients
  for (const cached of cachedIngredients) {
    const name = cached.ingredient;
    const hits = mapFatSecretFoodAttributesToLexHits(
      name,
      cached.food_attributes || {}
    );
    perIngredient.push({ ingredient: name, ok: true, hits, cached: true });
    if (hits && hits.length) {
      for (const h of hits) allIngredientHits.push(h);
    }
  }

  // Process fresh results
  for (const row of proxyResults) {
    const name = row?.ingredient || "";
    const hits = mapFatSecretFoodAttributesToLexHits(
      name,
      row?.food_attributes || {}
    );
    perIngredient.push({ ingredient: name, ok: true, hits, cached: false });
    if (hits && hits.length) {
      for (const h of hits) allIngredientHits.push(h);
    }
  }

  return {
    ok: true,
    perIngredient,
    allIngredientHits,
    _cacheStats: {
      cached: cachedIngredients.length,
      fetched: proxyResults.length,
      total: ingredientNames.length
    }
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

// Named exports for ETL and external use
export { callUSDAFDC, callOFF };

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
