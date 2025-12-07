var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-DWgQG7/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// index.js
function getVersion(env) {
  const now = (/* @__PURE__ */ new Date()).toLocaleString("en-US", {
    timeZone: "America/New_York"
  });
  const localDate = new Date(now).toISOString().slice(0, 10);
  return env.RELEASE || env.VERSION || `prod-${localDate}`;
}
__name(getVersion, "getVersion");
function tbWhoamiHeaders(env) {
  return {
    "x-tb-worker": env.WORKER_NAME || "tb-dish-processor-production",
    "x-tb-env": env.ENV || "production",
    "x-tb-git": env.GIT_SHA || "n/a",
    "x-tb-built": env.BUILT_AT || "n/a"
  };
}
__name(tbWhoamiHeaders, "tbWhoamiHeaders");
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
__name(tbWhoami, "tbWhoami");
var _cid = /* @__PURE__ */ __name((h) => h.get("x-correlation-id") || crypto.randomUUID(), "_cid");
function isBinaryContentType(contentType = "") {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.includes("application/octet-stream") || ct.includes("application/pdf") || ct.includes("application/zip") || ct.startsWith("image/") || ct.startsWith("audio/") || ct.startsWith("video/") || ct.startsWith("font/");
}
__name(isBinaryContentType, "isBinaryContentType");
function withTbWhoamiHeaders(response, env) {
  if (!(response instanceof Response)) return response;
  const ct = (response.headers && response.headers.get ? response.headers.get("content-type") : "") || "";
  if (isBinaryContentType(ct)) return response;
  const headers = new Headers(response.headers || void 0);
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
__name(withTbWhoamiHeaders, "withTbWhoamiHeaders");
function providerOrder(env) {
  const raw = env && env.PROVIDERS ? String(env.PROVIDERS) : "edamam,spoonacular,openai";
  return raw.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
}
__name(providerOrder, "providerOrder");
async function requirePremium(env, url) {
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
__name(requirePremium, "requirePremium");
function makeCtx(env) {
  return {
    served_at: (/* @__PURE__ */ new Date()).toISOString(),
    version: getVersion(env)
  };
}
__name(makeCtx, "makeCtx");
function pick(query, name, def) {
  const v = query.get(name);
  return v == null || v === "" ? def : v;
}
__name(pick, "pick");
function pickInt(query, name, def) {
  const v = query.get(name);
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}
__name(pickInt, "pickInt");
function pickFloat(query, name, def) {
  const v = query.get(name);
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
__name(pickFloat, "pickFloat");
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
__name(readJson, "readJson");
async function readJsonSafe(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
__name(readJsonSafe, "readJsonSafe");
async function parseResSafe(res) {
  const ct = res.headers && res.headers.get && res.headers.get("content-type") || "";
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
__name(parseResSafe, "parseResSafe");
async function callJson(url, opts = {}) {
  const fetcher = opts.fetcher || fetch;
  const resp = await fetcher(url, {
    method: opts.method || "GET",
    headers: {
      "content-type": "application/json",
      ...opts.headers || {}
    },
    body: opts.body ? JSON.stringify(opts.body) : void 0
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
  let json2;
  try {
    json2 = JSON.parse(text);
  } catch {
    json2 = { raw: text };
  }
  return {
    ok: resp.ok,
    status: resp.status,
    data: json2
  };
}
__name(callJson, "callJson");
function okJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
__name(okJson, "okJson");
async function handleRestaurantsFindGateway(env, url) {
  const searchParams = url.searchParams;
  const q = (searchParams.get("query") || "").trim();
  const latStr = searchParams.get("lat");
  const lngStr = searchParams.get("lng");
  const radiusStr = searchParams.get("radius") || "6000";
  const apiKey = env.GOOGLE_MAPS_API_KEY;
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
    const gUrl = "https://maps.googleapis.com/maps/api/place/textsearch/json?" + params.toString();
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
__name(handleRestaurantsFindGateway, "handleRestaurantsFindGateway");
function badJson(obj, status = 400) {
  const payload = obj && typeof obj === "object" && obj.ok !== void 0 ? obj : { ok: false, ...obj };
  return okJson(payload, status);
}
__name(badJson, "badJson");
function buildCommonParams(url, body = {}, extras = {}) {
  const q = url.searchParams;
  return {
    user_id: pick(q, "user_id", body?.user_id ?? void 0),
    dish: pick(q, "dish", body?.dish ?? void 0),
    method: pick(q, "method", body?.method ?? void 0),
    weight_kg: pickFloat(q, "weight_kg", body?.weight_kg ?? void 0),
    maxRows: pickInt(
      q,
      "maxRows",
      pickInt(q, "top", body?.maxRows ?? void 0)
    ),
    lat: pickFloat(q, "lat", body?.lat ?? void 0),
    lng: pickFloat(q, "lng", body?.lng ?? void 0),
    radius: pickInt(q, "radius", body?.radius ?? void 0),
    dev: pick(q, "dev", body?.dev ?? void 0) === "1" || body?.dev === 1,
    used_path: void 0,
    ...extras
  };
}
__name(buildCommonParams, "buildCommonParams");
function makeTrace(endpoint, searchParams, env, extras = {}) {
  const host = env && (env.UBER_RAPID_HOST || env.RAPIDAPI_HOST || env.CF_PAGES_URL || env.HOSTNAME) || void 0;
  return {
    endpoint,
    query: pick(searchParams, "query", void 0),
    address: pick(searchParams, "address", void 0),
    locale: pick(searchParams, "locale", void 0),
    page: pickInt(searchParams, "page", void 0),
    maxRows: pickInt(
      searchParams,
      "maxRows",
      pickInt(searchParams, "top", void 0)
    ),
    lat: pickFloat(searchParams, "lat", void 0),
    lng: pickFloat(searchParams, "lng", void 0),
    radius: pickInt(searchParams, "radius", void 0),
    host,
    used_path: void 0,
    ...extras
  };
}
__name(makeTrace, "makeTrace");
async function handleOrgansFromDish(url, env, request) {
  try {
    console.log(
      JSON.stringify({
        at: "organs:enter",
        method: request.method,
        q_dish: url.searchParams.get("dish") || null
      })
    );
  } catch {
  }
  const dishQ = (url.searchParams.get("dish") || "").trim();
  const body = await readJsonSafe(request);
  const dishB = body && typeof body === "object" && typeof body.dish === "string" ? body.dish.trim() : "";
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
    } catch {
    }
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
  const params = typeof buildCommonParams === "function" ? buildCommonParams(url, body || {}, { dish: finalDish }) : { dish: finalDish };
  params.used_path = "/organs/from-dish";
  const userId = url.searchParams.get("user_id") || body && body.user_id || null;
  const prefsKey = `prefs:user:${userId || "anon"}`;
  const user_prefs = env.USER_PREFS_KV && (await env.USER_PREFS_KV.get(prefsKey, "json")).catch?.(() => null) || (env.USER_PREFS_KV ? await env.USER_PREFS_KV.get(prefsKey, "json") : null) || {};
  const ORGANS = await getOrgans(env);
  const method = (url.searchParams.get("method") || body && body.method || "saute").toLowerCase().trim() || "saute";
  const wq = url.searchParams.get("weight_kg") || body && body.weight_kg;
  const weightNum = Number(wq);
  const weight_kg = Number.isFinite(weightNum) && weightNum > 0 ? weightNum : 70;
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
  const rawIngredients = Array.isArray(recipeResult?.ingredients) ? recipeResult.ingredients : [];
  const recipe_debug = {
    provider: recipeResult?.out?.provider ?? recipeResult?.source ?? recipeResult?.responseSource ?? null,
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
        note: "no ingredients found \u2014 recipe card empty and inference didn\u2019t yield ingredients",
        guidance: "Try a more specific dish name (e.g., 'Chicken Alfredo (Olive Garden)') or adjust PROVIDERS.",
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
  const ingredientsRaw = Array.isArray(card?.ingredients) ? card.ingredients : [];
  const originalLines = ingredientsRaw.map(
    (item) => typeof item === "string" ? item : item?.original || item?.name || item?.text || ""
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
  __name(snapToKnownIngredient, "snapToKnownIngredient");
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
  if ((env.EDAMAM_NUTRITION_APP_ID || env.EDAMAM_APP_ID) && (env.EDAMAM_NUTRITION_APP_KEY || env.EDAMAM_APP_KEY) && originalLines.length) {
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
      calories_kcal = typeof nut?.calories === "number" ? Math.round(nut.calories) : typeof nut?.nutrition?.calories === "number" ? Math.round(nut.nutrition.calories) : calories_kcal;
      if (Array.isArray(nut?.ingredients) && nut.ingredients.length) {
        const byName = new Map(
          nut.ingredients.filter((i) => i?.name).map((i) => [canonicalizeIngredientName(i.name), i.grams])
        );
        ingredients = ingredients.map((item) => {
          const grams = byName.has(item.name) ? byName.get(item.name) : item.grams;
          return { name: item.name, grams };
        });
      }
    } catch {
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
    const fatsecretHits = fatsecretResult && fatsecretResult.ok ? fatsecretResult.allIngredientHits || [] : [];
    const inferredTextHits = inferHitsFromText(finalDish, "");
    const inferredIngredientHits = inferHitsFromIngredients(ingredients);
    const combinedHits = [
      ...fatsecretHits,
      ...Array.isArray(inferredTextHits) ? inferredTextHits : [],
      ...Array.isArray(inferredIngredientHits) ? inferredIngredientHits : []
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
  const organ_top_drivers = { ...organDrivers || {} };
  const scoring = organ?.scoring || {};
  const filled = { organ_levels: organLevels || {} };
  const levels = typeof organ_levels !== "undefined" && organ_levels || filled?.organ_levels || scoring?.organ_levels || scoring?.levels || {};
  for (const organName of ORGANS) {
    if (!(organName in levels)) levels[organName] = "Neutral";
    if (!Array.isArray(organ_top_drivers[organName]))
      organ_top_drivers[organName] = [];
  }
  const levelToBar = /* @__PURE__ */ __name((s) => ({
    "High Benefit": 80,
    Benefit: 40,
    Neutral: 0,
    Caution: -40,
    "High Caution": -80
  })[s] ?? 0, "levelToBar");
  const levelToColor = /* @__PURE__ */ __name((s) => ({
    "High Benefit": "#16a34a",
    Benefit: "#22c55e",
    Neutral: "#a1a1aa",
    Caution: "#f59e0b",
    "High Caution": "#dc2626"
  })[s] ?? "#a1a1aa", "levelToColor");
  const barometerToColor = /* @__PURE__ */ __name((n) => n >= 40 ? "#16a34a" : n > 0 ? "#22c55e" : n === 0 ? "#a1a1aa" : n <= -40 ? "#dc2626" : "#f59e0b", "barometerToColor");
  const buildInsights = /* @__PURE__ */ __name(({ top, prefs, organs = [] }) => {
    const lines = [];
    for (const organKey of organs) {
      const arr = Array.isArray(top?.[organKey]) ? top[organKey] : [];
      if (arr.length) {
        const title = organKey.charAt(0).toUpperCase() + organKey.slice(1).replace(/_/g, " ");
        lines.push(`${title}: ${arr.join(", ")}`);
        if (lines.length >= 3) break;
      }
    }
    if (prefs?.allergens?.dairy === false) {
      lines.push("Preference: dairy-sensitive applied");
    }
    if (prefs?.allergens?.garlic_onion === true || prefs?.fodmap?.strict === true) {
      lines.push("Preference: FODMAP applied");
    }
    return lines.slice(0, 3);
  }, "buildInsights");
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
        created_at: (/* @__PURE__ */ new Date()).toISOString()
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
  } catch {
  }
  return okJson(result);
}
__name(handleOrgansFromDish, "handleOrgansFromDish");
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
__name(handleDebugEcho, "handleDebugEcho");
var CORS_ALL = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function buildDebugPreview(raw, env, rowsUS = null, titles = null) {
  const usedHost = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const sample = Array.isArray(raw?.results) && raw.results[0] || Array.isArray(raw?.data?.results) && raw.data.results[0] || Array.isArray(raw?.data?.data?.results) && raw.data.data.results[0] || Array.isArray(raw?.payload?.results) && raw.payload.results[0] || Array.isArray(raw?.job?.results) && raw.job.results[0] || rowsUS && Array.isArray(rowsUS) && rowsUS[0] || raw;
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
    ...Array.isArray(titles) ? { count: titles.length, titles: titles.slice(0, 25) } : {},
    sample
  };
}
__name(buildDebugPreview, "buildDebugPreview");
function safeTrace(t) {
  return t && typeof t === "object" ? t : {};
}
__name(safeTrace, "safeTrace");
var sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");
(/* @__PURE__ */ __name((function ensureLLMHelpers() {
  function _isValidUrl(u) {
    try {
      new URL(String(u || "").trim());
      return true;
    } catch {
      return false;
    }
  }
  __name(_isValidUrl, "_isValidUrl");
  if (typeof globalThis.normalizeLLMItems !== "function") {
    globalThis.normalizeLLMItems = /* @__PURE__ */ __name(function normalizeLLMItems2(rawItems = [], tag = "llm") {
      return (Array.isArray(rawItems) ? rawItems : []).map((it) => ({
        title: String(it.title || it.name || "").trim() || null,
        description: String(it.description || it.desc || "").trim() || null,
        section: String(it.section || it.category || "").trim() || null,
        price_cents: Number.isFinite(Number(it.price_cents)) ? Number(it.price_cents) : null,
        price_text: it.price_text ? String(it.price_text) : Number.isFinite(it.price_cents) ? `$${(Number(it.price_cents) / 100).toFixed(2)}` : null,
        calories_text: it.calories_text ? String(it.calories_text) : null,
        source: tag,
        confidence: typeof it.confidence === "number" ? it.confidence : 0.7
      })).filter((r) => r.title);
    }, "normalizeLLMItems");
  }
  if (typeof globalThis.dedupeItemsByTitleSection !== "function") {
    globalThis.dedupeItemsByTitleSection = /* @__PURE__ */ __name(function dedupeItemsByTitleSection2(items = []) {
      const seen = /* @__PURE__ */ new Map(), keep = [];
      for (const it of items) {
        const k = `${(it.section || "").toLowerCase()}|${(it.title || "").toLowerCase()}`;
        if (!seen.has(k)) {
          seen.set(k, keep.length);
          keep.push(it);
        } else {
          const i = seen.get(k), cur = keep[i];
          const curScore = (cur.price_cents ? 1 : 0) + (cur.price_text ? 1 : 0) + (cur.description ? cur.description.length / 100 : 0);
          const nxtScore = (it.price_cents ? 1 : 0) + (it.price_text ? 1 : 0) + (it.description ? it.description.length / 100 : 0);
          if (nxtScore > curScore) keep[i] = it;
        }
      }
      return keep;
    }, "dedupeItemsByTitleSection");
  }
  if (typeof globalThis.callGrokExtract !== "function") {
    globalThis.callGrokExtract = /* @__PURE__ */ __name(async function callGrokExtract2(env, query, address) {
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
    }, "callGrokExtract");
  }
  if (typeof globalThis.callOpenAIExtract !== "function") {
    globalThis.callOpenAIExtract = /* @__PURE__ */ __name(async function callOpenAIExtract2(env, query, address) {
      const key = (env.OPENAI_API_KEY || "").trim();
      const base = ((env.OPENAI_API_BASE || "https://api.openai.com") + "").replace(/\/+$/, "");
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
        } catch {
        }
        const items = Array.isArray(payload.items) ? payload.items : [];
        return { ok: true, items };
      } catch (e) {
        return {
          ok: false,
          items: [],
          error: `openai fetch error: ${String(e?.message || e)}`
        };
      }
    }, "callOpenAIExtract");
  }
}), "ensureLLMHelpers"))();
var normalizeLLMItems = globalThis.normalizeLLMItems;
var dedupeItemsByTitleSection = globalThis.dedupeItemsByTitleSection;
var callGrokExtract = globalThis.callGrokExtract;
var callOpenAIExtract = globalThis.callOpenAIExtract;
var isNonEmptyString = /* @__PURE__ */ __name((v) => typeof v === "string" && v.trim().length > 0, "isNonEmptyString");
var looksLikeCityState = /* @__PURE__ */ __name((s) => {
  if (typeof s !== "string") return false;
  return /^[A-Za-z .'-]+,\s*[A-Z]{2}(\s*\d{5})?$/.test(s.trim());
}, "looksLikeCityState");
function hasLowercaseState(address) {
  const m = String(address || "").match(/,\s*([A-Za-z]{2})(\b|[^A-Za-z]|$)/);
  if (!m) return false;
  const st = m[1];
  return st !== st.toUpperCase();
}
__name(hasLowercaseState, "hasLowercaseState");
function normalizeCityStateAddress(address) {
  return String(address || "").replace(
    /,\s*([A-Za-z]{2})(\b|[^A-Za-z]|$)/,
    (_, st, tail) => `, ${st.toUpperCase()}${tail || ""}`
  );
}
__name(normalizeCityStateAddress, "normalizeCityStateAddress");
function badRequest(message, hint, envOrCtx, request_id = null, examples = null) {
  const body = { ok: false, error: message, hint };
  if (Array.isArray(examples) && examples.length) body.examples = examples;
  return errorResponseWith(body, 400, envOrCtx, {}, request_id);
}
__name(badRequest, "badRequest");
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init
  });
}
__name(json, "json");
function slimTopDrivers(drivers) {
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
__name(slimTopDrivers, "slimTopDrivers");
function topDriversText(slim) {
  if (!Array.isArray(slim) || slim.length === 0) return "";
  const names = slim.map((x) => {
    const t = String(x?.label || "");
    return t.replace(/^([+\-]\s*)/, "");
  });
  const firstTwo = names.slice(0, 2).filter(Boolean);
  return firstTwo.join("; ");
}
__name(topDriversText, "topDriversText");
var is01 = /* @__PURE__ */ __name((v) => v === "0" || v === "1", "is01");
var isPositiveInt = /* @__PURE__ */ __name((s) => /^\d+$/.test(String(s)), "isPositiveInt");
function newRequestId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
__name(newRequestId, "newRequestId");
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
__name(friendlyUpstreamMessage, "friendlyUpstreamMessage");
function normalizeText(str) {
  if (!str) return "";
  return String(str).toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9\\s]/g, " ").replace(/\\s+/g, " ").trim();
}
__name(normalizeText, "normalizeText");
var GENERIC_NAME_TOKENS = /* @__PURE__ */ new Set([
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
__name(nameTokens, "nameTokens");
function tokenSetSimilarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let intersect = 0;
  for (const t of aSet) {
    if (bSet.has(t)) intersect++;
  }
  const union = (/* @__PURE__ */ new Set([...aSet, ...bSet])).size;
  return union === 0 ? 0 : intersect / union;
}
__name(tokenSetSimilarity, "tokenSetSimilarity");
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
        dp[j] + 1,
        // deletion
        dp[j - 1] + 1,
        // insertion
        prev + cost
        // substitution
      );
      prev = tmp;
    }
  }
  return dp[n];
}
__name(levenshtein, "levenshtein");
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
  return sim >= 0.8;
}
__name(strictNameMatch, "strictNameMatch");
function normalizeAddress(str) {
  if (!str) return "";
  return String(str).toLowerCase().replace(/[^a-z0-9\\s]/g, " ").replace(/\\s+/g, " ").trim();
}
__name(normalizeAddress, "normalizeAddress");
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
__name(addressSignature, "addressSignature");
function strictAddressMatch(googleAddress, uberLocation) {
  const gSig = addressSignature(googleAddress);
  const uSig = addressSignature(uberLocation);
  if (!gSig || !uSig) return false;
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
__name(strictAddressMatch, "strictAddressMatch");
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
__name(isBannedSectionName, "isBannedSectionName");
var NOISE_KEYWORDS = [
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
function isNoiseItem(name, description2 = "") {
  const text = `${name} ${description2}`.toLowerCase();
  return NOISE_KEYWORDS.some((k) => text.includes(k));
}
__name(isNoiseItem, "isNoiseItem");
var HARD_BLOCKLIST = [
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
function hardBlockItem(name, description2 = "") {
  const text = `${name} ${description2}`.toLowerCase();
  return HARD_BLOCKLIST.some((k) => text.includes(k));
}
__name(hardBlockItem, "hardBlockItem");
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
  if (/\b(2 ?l|20 ?oz|16 ?oz|12 ?oz|bottle|can|canned)\b/.test(n)) return true;
  return false;
}
__name(isLikelyDrink, "isLikelyDrink");
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
__name(isLikelyUtensilOrPackaging, "isLikelyUtensilOrPackaging");
function isLikelySideOrAddon(name, section, description2) {
  const n = (name || "").toLowerCase().trim();
  const s = (section || "").toLowerCase().trim();
  const d = (description2 || "").toLowerCase().trim();
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
__name(isLikelySideOrAddon, "isLikelySideOrAddon");
function filterMenuForDisplay(dishes = []) {
  if (!Array.isArray(dishes)) return [];
  const filtered = dishes.filter((d) => {
    const name = d.name || d.title || "";
    const section = d.section || "";
    const desc = d.description || "";
    if (!name) return false;
    if (isBannedSectionName(section)) return false;
    if (isNoiseItem(name, desc)) return false;
    if (isLikelyDrink(name, section)) return false;
    if (isLikelyUtensilOrPackaging(name, section)) return false;
    if (isLikelySideOrAddon(name, section, desc)) return false;
    return true;
  });
  return dedupeItems(filtered);
}
__name(filterMenuForDisplay, "filterMenuForDisplay");
function dedupeItems(items) {
  const seen = /* @__PURE__ */ new Set();
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
__name(dedupeItems, "dedupeItems");
function classifierCacheKey(name, description2) {
  const key = `${name}||${description2 || ""}`.toLowerCase();
  return "menu-classifier:" + key;
}
__name(classifierCacheKey, "classifierCacheKey");
async function batchReadClassifierCache(env, items) {
  const results = {};
  for (const it of items) {
    const key = classifierCacheKey(it.name, it.description);
    const cached = await env.MENU_CLASSIFIER_CACHE.get(key, "json");
    if (cached) results[key] = cached;
  }
  return results;
}
__name(batchReadClassifierCache, "batchReadClassifierCache");
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
__name(batchWriteClassifierCache, "batchWriteClassifierCache");
async function classifyMenuItemsLLM(env, items) {
  if (!items.length) return [];
  const payload = items.map((it) => ({
    name: it.name,
    description: it.description || ""
  }));
  const messages = [
    {
      role: "system",
      content: 'You are a strict JSON menu item classifier. You MUST return ONLY a valid JSON array of objects. No text outside JSON. Each object MUST have: {"category": string, "noise": boolean}. No explanations, no markdown, no commentary.'
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
  let clean = text.trim().replace(/```json/gi, "").replace(/```/g, "");
  let result;
  try {
    result = JSON.parse(clean);
  } catch (err) {
    result = items.map(() => ({ category: "Other", noise: false }));
  }
  return result;
}
__name(classifyMenuItemsLLM, "classifyMenuItemsLLM");
async function applyLLMClassification(env, items) {
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
__name(applyLLMClassification, "applyLLMClassification");
function applyLLMOverrides(items) {
  return items.filter((it) => !it.llmNoise).map((it) => {
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
    const finalCategory = strongHeuristic ? it.canonicalCategory : llmCat || it.canonicalCategory;
    return {
      ...it,
      canonicalCategory: finalCategory
    };
  });
}
__name(applyLLMOverrides, "applyLLMOverrides");
function normalizeWrapsAndSaladBowls(items) {
  return items.map((it) => {
    const name = (it.name || "").toLowerCase();
    const section = (it.section || "").toLowerCase();
    let cat = it.canonicalCategory;
    if (name.includes("wrap") || section.includes("wrap")) {
      cat = "Sandwiches & Burgers";
    }
    if (name.includes("salad bowl") || name.includes("salad") && section.includes("bowl")) {
      cat = "Salads";
    }
    return {
      ...it,
      canonicalCategory: cat
    };
  });
}
__name(normalizeWrapsAndSaladBowls, "normalizeWrapsAndSaladBowls");
function finalNormalizeCategories(items) {
  return items.map((it) => {
    const name = (it.name || "").toLowerCase();
    const section = (it.section || "").toLowerCase();
    let cat = it.canonicalCategory;
    if (name.includes("wrap") || section.includes("wrap")) {
      cat = "Sandwiches & Burgers";
    }
    if (name.includes("salad bowl") || name.includes("salad") && section.includes("bowl")) {
      cat = "Salads";
    }
    return { ...it, canonicalCategory: cat };
  });
}
__name(finalNormalizeCategories, "finalNormalizeCategories");
function canonicalCategoryFromSectionAndName(sectionName, dishName) {
  const s = (sectionName || "").toLowerCase();
  const n = (dishName || "").toLowerCase();
  if (/\b(appetizer|appetizers|starter|starters|small plates?|snacks?|tapas)\b/.test(
    s
  )) {
    return "Appetizers";
  }
  if (/\b(salad|salads)\b/.test(s) || /\bsalad\b/.test(n)) {
    return "Salads";
  }
  if (/\b(soup|soups)\b/.test(s) || /\bsoup\b/.test(n)) {
    return "Soups";
  }
  if (/\b(breakfast|brunch)\b/.test(s) || /\b(omelette|pancake|waffle|french toast|scramble)\b/.test(n)) {
    return "Breakfast & Brunch";
  }
  if (/\b(kids|children|kid's|kid menu)\b/.test(s) || /\bkid\b/.test(n)) {
    return "Kids";
  }
  if (/\b(dessert|desserts|sweets|treats)\b/.test(s) || /\b(cheesecake|brownie|cake|pie|ice cream|sundae|pudding|tiramisu)\b/.test(
    n
  )) {
    return "Desserts";
  }
  if (/\b(side|sides|side orders?)\b/.test(s) || /\b(fries|chips|onion rings|mashed potatoes|mac and cheese)\b/.test(n)) {
    return "Sides";
  }
  if (/\b(sandwiches|sandwich|burgers?|subs?|hoagies|tacos?|wraps?)\b/.test(s) || /\b(burger|sandwich|sub|taco|wrap|panini|po ?boy)\b/.test(n)) {
    return "Sandwiches & Burgers";
  }
  if (/\b(pizzas?|pasta)\b/.test(s) || /\b(pizza|penne|spaghetti|lasagna)\b/.test(n)) {
    return "Pasta & Pizza";
  }
  if (/\b(entrees?|mains?|main courses?|specialties|specials|plates?|bowls?)\b/.test(
    s
  ) || /\b(steak|chicken|salmon|ribs|grill|grilled|filet|fillet)\b/.test(n)) {
    return "Mains";
  }
  return "Other";
}
__name(canonicalCategoryFromSectionAndName, "canonicalCategoryFromSectionAndName");
function classifyCanonicalCategory(item) {
  const name = (item.name || "").toLowerCase();
  const section = (item.section || "").toLowerCase();
  if (section.includes("wings") || name.includes("wing")) {
    return "Mains";
  }
  if (section.includes("bowl") || section.includes("wrap")) {
    return "Mains";
  }
  if (name.includes("burger") || name.includes("sandwich") || name.includes("patty melt") || name.includes("tuna melt") || name.includes("quesadilla") || name.includes("philly") || name.includes("dog")) {
    return "Sandwiches & Burgers";
  }
  if (section.includes("salad") || name.includes("salad")) {
    return "Salads";
  }
  if (section.includes("kids") || name.includes("kid ")) {
    return "Kids";
  }
  if (section.includes("dessert") || name.includes("pie") || name.includes("cheesecake") || name.includes("cookie") || name.includes("brownie") || name.includes("ice cream") || name.includes("fried oreo")) {
    return "Desserts";
  }
  if (section.includes("starter") || section.includes("appetizer") || name.includes("shrimp") || name.includes("tots") || name.includes("nachos") || name.includes("rings") || name.includes("poppers") || name.includes("fritters") || name.includes("chips") || name.includes("fries")) {
    return "Appetizers";
  }
  if (section.includes("side") || name.includes("side") || name.includes("tenders") || name.includes("grilled tenders") || name.includes("fish & chips")) {
    return "Sides";
  }
  return item.canonicalCategory || "Other";
}
__name(classifyCanonicalCategory, "classifyCanonicalCategory");
function classifyWingPlatter(item) {
  const name = (item.name || "").toLowerCase();
  const section = (item.section || "").toLowerCase();
  const isWing = section.includes("wing") || name.includes("wing") || name.includes("boneless") || name.includes("buffalo wings");
  if (isWing) {
    return "Mains";
  }
  return null;
}
__name(classifyWingPlatter, "classifyWingPlatter");
function classifyBowl(item) {
  const name = (item.name || "").toLowerCase();
  const section = (item.section || "").toLowerCase();
  const isBowl = name.includes("bowl") || section.includes("bowl") || name.includes("all star") || name.includes("all-star") || name.includes("rice bowl");
  if (isBowl) {
    return "Mains";
  }
  return null;
}
__name(classifyBowl, "classifyBowl");
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
__name(classifyWrapQuesadilla, "classifyWrapQuesadilla");
function classifyBySectionFallback(item) {
  const section = (item.section || "").toLowerCase();
  for (const key in SECTION_CANONICAL_MAP) {
    if (section.includes(key)) {
      return SECTION_CANONICAL_MAP[key];
    }
  }
  return null;
}
__name(classifyBySectionFallback, "classifyBySectionFallback");
var CANONICAL_ORDER = [
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
var SECTION_CANONICAL_MAP = {
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
function groupItemsIntoSections(items) {
  const map = {};
  for (const cat of CANONICAL_ORDER) map[cat] = [];
  for (const it of items) {
    const cat = CANONICAL_ORDER.includes(it.canonicalCategory) ? it.canonicalCategory : "Other";
    map[cat].push(it);
  }
  return CANONICAL_ORDER.filter((cat) => map[cat] && map[cat].length > 0).map(
    (cat) => ({
      id: `cat-${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: cat,
      items: map[cat]
    })
  );
}
__name(groupItemsIntoSections, "groupItemsIntoSections");
function computeDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null)
    return null;
  const R = 6371e3;
  const toRad = /* @__PURE__ */ __name((d) => d * Math.PI / 180, "toRad");
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
__name(computeDistanceMeters, "computeDistanceMeters");
function passesStrictRestaurantMatch(googleCtx, row) {
  if (!row || !googleCtx) return false;
  const uberName = row.title || row.sanitizedTitle || row.name || "";
  const googleName = googleCtx.name || googleCtx.query || "";
  if (!strictNameMatch(googleName, uberName)) return false;
  const uberLoc = row.location && (row.location.address || row.location.streetAddress) ? row.location : row.location || {};
  if (!strictAddressMatch(googleCtx.address, uberLoc)) {
    return false;
  }
  const gLat = googleCtx.lat;
  const gLng = googleCtx.lng;
  const uLat = row.location && (row.location.latitude || row.location.lat);
  const uLng = row.location && (row.location.longitude || row.location.lng);
  const dist = computeDistanceMeters(gLat, gLng, uLat, uLng);
  if (dist != null && dist > 60) {
    return false;
  }
  return true;
}
__name(passesStrictRestaurantMatch, "passesStrictRestaurantMatch");
function extractMenuItemsFromUber(raw, queryText = "") {
  const out = [];
  const seen = /* @__PURE__ */ new Map();
  const results = raw && raw.data && Array.isArray(raw.data.results) ? raw.data.results : [];
  if (!results.length) return out;
  let chosenRestaurants = [];
  if (results.length === 1) {
    chosenRestaurants = [results[0]];
  } else {
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
      chosenRestaurants = [scored[0].r];
    }
  }
  function normalizePriceFields(mi) {
    const asNum = typeof mi.price === "number" ? mi.price : void 0;
    const price = Number.isFinite(asNum) ? asNum : void 0;
    const price_display = mi.priceTagline || (Number.isFinite(price) ? `$${(price / 100).toFixed(2)}` : mi.price_display || "") || "";
    return { price, price_display };
  }
  __name(normalizePriceFields, "normalizePriceFields");
  function deriveCaloriesDisplay(mi, price_display) {
    const calNum = mi?.nutrition && Number.isFinite(mi.nutrition.calories) && mi.nutrition.calories || Number.isFinite(mi?.calories) && mi.calories || null;
    if (Number.isFinite(calNum)) return `${Math.round(calNum)} Cal`;
    const t = String(
      price_display || mi?.itemDescription || mi?.description || ""
    );
    const m = t.match(/\b(\d{2,4})\s*Cal\.?\b/i);
    return m ? `${m[1]} Cal` : null;
  }
  __name(deriveCaloriesDisplay, "deriveCaloriesDisplay");
  function normalizeItemFields(it) {
    const clean = /* @__PURE__ */ __name((s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim(), "clean");
    const outItem = { ...it };
    outItem.name = clean(it.name);
    outItem.section = clean(it.section);
    outItem.description = clean(it.description);
    outItem.price_display = clean(it.price_display);
    if (outItem.calories_display != null)
      outItem.calories_display = clean(outItem.calories_display);
    outItem.restaurant_name = clean(it.restaurant_name);
    if (!(Number.isFinite(outItem.price) && outItem.price >= 0))
      delete outItem.price;
    outItem.source = "uber_eats";
    return outItem;
  }
  __name(normalizeItemFields, "normalizeItemFields");
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
  __name(makeItem, "makeItem");
  const addItem = /* @__PURE__ */ __name((item) => {
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
    const newHasPrice = normalizedItem.price != null || !!normalizedItem.price_display;
    let replace = false;
    if (!existingHasPrice && newHasPrice) replace = true;
    else if (existingHasPrice === newHasPrice && !existingHasCalories && newHasCalories)
      replace = true;
    else if (existingHasPrice === newHasPrice && existingHasCalories === newHasCalories && newDesc.length > existingDesc.length + 10) {
      replace = true;
    }
    if (replace) {
      const idx = out.indexOf(existing);
      if (idx >= 0) out[idx] = normalizedItem;
      seen.set(key, normalizedItem);
    }
  }, "addItem");
  for (const r of chosenRestaurants) {
    const restaurantName = r.title || r.sanitizedTitle || r.name || "";
    const restaurantId = r.uuid || r.id || r.url || restaurantName;
    let sections = [];
    if (Array.isArray(r.menu)) sections = r.menu;
    else if (Array.isArray(r.catalogs)) sections = r.catalogs;
    for (const section of sections) {
      const sectionName = section.catalogName || section.name || "";
      const catalogItems = Array.isArray(section.catalogItems) && section.catalogItems || Array.isArray(section.items) && section.items || [];
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
__name(extractMenuItemsFromUber, "extractMenuItemsFromUber");
var SECTION_PRIORITY = [
  "most popular",
  "popular items",
  "featured",
  "bestsellers",
  "recommended"
];
function sectionScore(section = "") {
  const s = section.toLowerCase();
  for (let i = 0; i < SECTION_PRIORITY.length; i++) {
    if (s.includes(SECTION_PRIORITY[i])) return 100 - i * 2;
  }
  return 0;
}
__name(sectionScore, "sectionScore");
function hasCalories(item) {
  const t = `${item.price_display || item.description || ""}`.toLowerCase();
  return /\bcal\b|\bcal\.\b/.test(t);
}
__name(hasCalories, "hasCalories");
function hasPrice(item) {
  return typeof item.price === "number" || /\$\d/.test(item.price_display || "");
}
__name(hasPrice, "hasPrice");
function baseNameScore(name = "") {
  const n = name.toLowerCase();
  let sc = 0;
  if (/\bcombo\b|\bmeal\b/.test(n)) sc += 2;
  if (/\bfamily\b|\bparty\b/.test(n)) sc -= 2;
  if (/\bside\b/.test(n)) sc -= 1;
  return sc;
}
__name(baseNameScore, "baseNameScore");
function scoreItem(item) {
  let score = 0;
  score += sectionScore(item.section);
  if (hasCalories(item)) score += 4;
  if (hasPrice(item)) score += 3;
  score += baseNameScore(item.name || item.title || "");
  return score;
}
__name(scoreItem, "scoreItem");
function rankTop(items, n) {
  return [...items].map((it, idx) => ({ it, idx, score: scoreItem(it) })).sort((a, b) => b.score - a.score || a.idx - b.idx).slice(0, Math.max(0, n)).map((x) => x.it);
}
__name(rankTop, "rankTop");
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
__name(filterAndRankItems, "filterAndRankItems");
function isDrink(name = "", section = "") {
  const n = name.toLowerCase();
  const s = (section || "").toLowerCase();
  return /\b(drink|beverage|soda|coke|sprite|fanta|tea|coffee|juice|shake|mcflurry|water)\b/.test(
    n
  ) || /\b(drinks|beverages)\b/.test(s);
}
__name(isDrink, "isDrink");
function isPartyPack(name = "") {
  const n = name.toLowerCase();
  return /\b(20|30|40|50)\s*(pc|piece|pieces)\b/.test(n) || /\b(family|party|bundle|pack)\b/.test(n);
}
__name(isPartyPack, "isPartyPack");
function recipeCacheKey(dish, lang = "en") {
  const base = String(dish || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `recipe/${lang}/${base || "unknown"}.json`;
}
__name(recipeCacheKey, "recipeCacheKey");
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
__name(recipeCacheRead, "recipeCacheRead");
async function recipeCacheWrite(env, key, payload) {
  const kv = env.MENUS_CACHE;
  if (!kv) return false;
  try {
    await kv.put(
      key,
      JSON.stringify({ savedAt: (/* @__PURE__ */ new Date()).toISOString(), ...payload }),
      {
        expirationTtl: 365 * 24 * 3600
      }
    );
    return true;
  } catch {
    return false;
  }
}
__name(recipeCacheWrite, "recipeCacheWrite");
function defaultPrefs() {
  return { allergens: [], fodmap: {}, units: "us" };
}
__name(defaultPrefs, "defaultPrefs");
function normalizePrefs(input) {
  const out = defaultPrefs();
  const src = input?.prefs ? input.prefs : input || {};
  if (Array.isArray(src.allergens)) out.allergens = src.allergens.map(String);
  if (src.fodmap && typeof src.fodmap === "object")
    out.fodmap = { ...src.fodmap };
  if (Array.isArray(src.pills)) {
    const al = new Set(out.allergens);
    const fm = { ...out.fodmap || {} };
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
__name(normalizePrefs, "normalizePrefs");
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
__name(loadUserPrefs, "loadUserPrefs");
function derivePillsForUser(hits = [], prefs = { allergens: [], fodmap: {} }) {
  const safeHits = Array.isArray(hits) ? hits : [];
  const safePrefs = prefs && typeof prefs === "object" ? prefs : { allergens: [], fodmap: {} };
  const baseAllergens = /* @__PURE__ */ new Set();
  const baseClasses = /* @__PURE__ */ new Set();
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
    Array.isArray(safePrefs.allergens) ? safePrefs.allergens.map((a) => String(a)) : []
  );
  for (const allergen of baseAllergens) {
    pills.push({
      key: `allergen:${allergen}`,
      label: allergen,
      active: allergenPrefs.has(allergen)
    });
  }
  const fodmapPrefs = safePrefs.fodmap && typeof safePrefs.fodmap === "object" ? safePrefs.fodmap : {};
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
__name(derivePillsForUser, "derivePillsForUser");
function inferHitsFromText(title = "", desc = "") {
  const text = `${title} ${desc}`.toLowerCase();
  const hits = [];
  const push = /* @__PURE__ */ __name((o) => hits.push({
    term: o.term || o.canonical || o.label || null,
    canonical: o.canonical || o.term || o.label || null,
    allergens: o.allergens || [],
    classes: o.classes || [],
    fodmap: o.fodmap,
    tags: o.tags || [],
    source: "infer:title"
  }), "push");
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
  if (/(milk|cream|butter|cheese|parmesan|mozzarella|yogurt|whey|casein)\b/.test(
    text
  )) {
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
__name(inferHitsFromText, "inferHitsFromText");
function inferHitsFromIngredients(ingredients = []) {
  const hits = [];
  for (const ing of ingredients) {
    const nameRaw = typeof ing === "string" ? ing : ing?.name || ing?.original || ing?.text || "";
    const name = String(nameRaw || "").toLowerCase();
    if (!name) continue;
    const push = /* @__PURE__ */ __name((o) => hits.push({
      term: o.term || o.canonical || name,
      canonical: o.canonical || o.term || name,
      allergens: o.allergens || [],
      classes: o.classes || [],
      fodmap: o.fodmap,
      tags: o.tags || [],
      source: "infer:ingredients"
    }), "push");
    if (/(milk|cream|butter|cheese|parmesan|mozzarella|yogurt|whey|casein)\b/.test(
      name
    )) {
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
__name(inferHitsFromIngredients, "inferHitsFromIngredients");
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
  const accountUser = typeof opts?.user_id === "string" && opts.user_id.trim() ? opts.user_id.trim() : "anon";
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
__name(callEdamamRecipe, "callEdamamRecipe");
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
      grams: grams > 0 ? grams : void 0
    });
  }
  let calories = typeof data?.calories === "number" ? Math.round(data.calories) : null;
  const needFallback = calories === null || !Array.isArray(body.ingr) || body.ingr.length === 0 || !Array.isArray(data?.ingredients) || data.ingredients.length === 0 || status && status !== 200;
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
      } catch {
      }
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
    reason: calories !== null ? "ok" : `no calories (status ${status || "n/a"})`,
    debug: calories === null ? data : void 0
  };
}
__name(callEdamamNutritionAnalyze, "callEdamamNutritionAnalyze");
function normalizeIngredientLine(s) {
  let x = String(s || "").toLowerCase().trim();
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
  x = x.replace(/\s*,\s*/g, " ").replace(/\s+/g, " ").trim();
  x = x.replace(/\bparm(e|a)san\b/g, "parmesan").replace(/\bboneless\b/g, "").replace(/\bskinless\b/g, "");
  x = x.replace(/\b(cloves?|bunch|bunches|handful|pinch|pinches)\b/g, "").trim();
  return x;
}
__name(normalizeIngredientLine, "normalizeIngredientLine");
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
  if (/(salt|black pepper|pepper|paprika|cumin|oregano|parsley|basil|chili)\b/.test(
    n
  ))
    return 2;
  if (/(tomato|mushroom|spinach|broccoli|bell pepper)\b/.test(n)) return 60;
  return 12;
}
__name(guessGrams, "guessGrams");
function normalizeIngredientsArray(raw) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const it of raw || []) {
    const text = typeof it === "string" ? it : it?.original || it?.name || it?.text || "";
    const name = normalizeIngredientLine(text);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, grams: guessGrams(name) });
  }
  return out;
}
__name(normalizeIngredientsArray, "normalizeIngredientsArray");
function titleizeIngredient(text) {
  return text.split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
__name(titleizeIngredient, "titleizeIngredient");
function sanitizeIngredientForCookbook(raw) {
  const base = typeof raw === "string" ? raw : raw?.name || raw?.original || raw?.text || "";
  const lower = String(base || "").toLowerCase();
  const optional = /\boptional\b/.test(lower) || /\bfor (serving|garnish)\b/.test(lower) || /\bto taste\b/.test(lower);
  const cleaned = normalizeIngredientLine(base).replace(/\b(optional|undefined|to taste)\b/gi, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const withoutPrefix = cleaned.replace(
    /^\s*[\d\/\.\-¼½¾⅓⅔⅛⅜⅝⅞]+\s*(cups?|cup|tbsp|tablespoons?|tsp|teaspoons?|ounces?|oz|grams?|g|kg|pounds?|lb|ml|l|liters?)?\s+/i,
    ""
  );
  const name = titleizeIngredient(
    withoutPrefix.replace(/^[\d\s\.\/\-]+/, "").replace(/\s+/g, " ").trim()
  );
  if (!name) return null;
  const entry = { name, optional };
  const n = name.toLowerCase();
  const catMatch = /* @__PURE__ */ __name((patterns) => patterns.some((re) => re.test(n)), "catMatch");
  if (catMatch([
    /\b(chicken|beef|pork|salmon|tuna|shrimp|lobster|crab|prawn|turkey|lamb|tofu|tempeh|egg|steak|ham|bacon|sausage)\b/
  ])) {
    entry.category = "protein";
  } else if (catMatch([
    /\b(rice|noodles?|pasta|spaghetti|fettuccine|linguine|macaroni|quinoa|couscous|tortilla|bread|bun|potato|potatoes|yuca|cassava|gnocchi|grain|lentils?)\b/,
    /\b(greens?|spinach|kale|lettuce|arugula|cabbage)\b/
  ])) {
    entry.category = "base";
  } else if (catMatch([
    /\b(onion|garlic|shallot|scallion|leek|ginger|chili|jalapeno|pepper|bell pepper)\b/,
    /\b(parsley|cilantro|basil|oregano|thyme|rosemary|sage|dill)\b/
  ])) {
    entry.category = "aromatic";
  } else if (catMatch([
    /\b(oil|olive oil|vinegar|broth|stock|soy sauce|coconut milk|milk|cream|wine)\b/,
    /\b(sauce|dressing)\b/
  ])) {
    entry.category = "liquid";
  } else if (catMatch([
    /\b(salt|black pepper|pepper|paprika|cumin|turmeric|curry|chili powder|flakes|oregano|parsley|basil|spice|seasoning|sugar|honey)\b/
  ])) {
    entry.category = "seasoning";
  } else {
    entry.category = "other";
  }
  return entry;
}
__name(sanitizeIngredientForCookbook, "sanitizeIngredientForCookbook");
function arrangeCookbookIngredients(rawList = []) {
  const cleaned = [];
  const seen = /* @__PURE__ */ new Set();
  for (const it of rawList) {
    const entry = sanitizeIngredientForCookbook(it);
    if (!entry) continue;
    const key = entry.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(entry);
  }
  const order = /* @__PURE__ */ __name((cat) => cleaned.filter((c) => c.category === cat && !c.optional), "order");
  const optional = cleaned.filter((c) => c.optional);
  const others = cleaned.filter(
    (c) => !c.optional && !["protein", "base", "aromatic", "liquid", "seasoning"].includes(
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
    bullets.push(
      `- Optional: ${optional.map((c) => c.name).join(", ")}`
    );
  }
  return bullets.length ? bullets : ["- Ingredients not available"];
}
__name(arrangeCookbookIngredients, "arrangeCookbookIngredients");
function naturalList(arr = [], fallback = "the ingredients") {
  const clean = arr.map((s) => s.trim()).filter(Boolean);
  if (!clean.length) return fallback;
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}
__name(naturalList, "naturalList");
function inferCookbookDescription(dishName, bullets = []) {
  const name = (dishName || "").trim();
  const proteins = bullets.filter((b) => b.startsWith("- ") && /chicken|beef|pork|salmon|shrimp|tofu|egg/i.test(b)).map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));
  const bases = bullets.filter((b) => b.startsWith("- ") && /rice|pasta|noodle|potato|quinoa|couscous|tortilla|greens|spinach|kale/i.test(b)).map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));
  const accents = bullets.filter((b) => b.startsWith("- ") && /garlic|onion|herb|oregano|basil|parsley|sauce|broth|oil|vinegar/i.test(b)).map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));
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
__name(inferCookbookDescription, "inferCookbookDescription");
function cleanCookbookStep(text) {
  let s = String(text || "");
  s = s.replace(/^\s*(step\s*\d+[:\.\)]?\s*)/i, "");
  s = s.replace(/^\s*\d+[\.\)]\s*/, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\byou\b/gi, "").replace(/\byour\b/gi, "").trim();
  if (!s) return null;
  const capped = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}
__name(cleanCookbookStep, "cleanCookbookStep");
function inferCookbookSteps(rawSteps = [], ingredientBullets = []) {
  const cleanedRaw = Array.isArray(rawSteps) ? rawSteps.map((s) => cleanCookbookStep(s)).filter(Boolean) : [];
  const proteins = ingredientBullets.filter((b) => /^- /.test(b) && /chicken|beef|pork|salmon|shrimp|tofu|egg/i.test(b)).map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));
  const bases = ingredientBullets.filter((b) => /^- /.test(b) && /rice|pasta|noodle|potato|quinoa|couscous|tortilla|greens|spinach|kale/i.test(b)).map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));
  const aromatics = ingredientBullets.filter((b) => /^- /.test(b) && /garlic|onion|shallot|ginger|herb|pepper/i.test(b)).map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));
  const liquids = ingredientBullets.filter((b) => /^- /.test(b) && /oil|vinegar|broth|stock|sauce|milk|cream/i.test(b)).map((b) => b.replace(/^- /, "").replace(/^Optional: /i, ""));
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
__name(inferCookbookSteps, "inferCookbookSteps");
function formatLikelyRecipeMarkdown({
  dishName,
  rawIngredients = [],
  rawSteps = [],
  servingInfo = null
}) {
  const title = dishName ? `### Likely recipe: ${dishName}` : "### Likely recipe";
  const ingredients = arrangeCookbookIngredients(rawIngredients);
  const description2 = inferCookbookDescription(dishName, ingredients);
  const steps = inferCookbookSteps(rawSteps, ingredients);
  const lines = [
    title,
    description2,
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
      bits.push(`${servingInfo.servings} serving${servingInfo.servings > 1 ? "s" : ""}`);
    if (servingInfo.grams) bits.push(`${servingInfo.grams} g`);
    const joined = bits.length === 2 ? `${bits[0]} (${bits[1]})` : bits.join("");
    if (joined) lines.push("", `**Estimated serving size:** about ${joined}`);
  }
  lines.push(
    "",
    "**Based on typical recipes from Edamam and Spoonacular. Restaurant versions may vary.**"
  );
  return lines.join("\n");
}
__name(formatLikelyRecipeMarkdown, "formatLikelyRecipeMarkdown");
function safeJson(s, fallback) {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}
__name(safeJson, "safeJson");
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
__name(getOrgans, "getOrgans");
function computeBarometerFromLevelsAll(ORGANS, lv) {
  const levelToBar = /* @__PURE__ */ __name((s) => ({
    "High Benefit": 80,
    Benefit: 40,
    Neutral: 0,
    Caution: -40,
    "High Caution": -80
  })[s] ?? 0, "levelToBar");
  if (!Array.isArray(ORGANS) || !ORGANS.length) return 0;
  const nums = ORGANS.map((o) => levelToBar(lv?.[o]));
  const sum = nums.reduce((acc, val) => acc + val, 0);
  return Math.round(sum / Math.max(nums.length, 1));
}
__name(computeBarometerFromLevelsAll, "computeBarometerFromLevelsAll");
async function r2Head(env, key) {
  if (!env?.R2_BUCKET) return false;
  try {
    const obj = await env.R2_BUCKET.head(key);
    return !!obj;
  } catch {
    return false;
  }
}
__name(r2Head, "r2Head");
function normKey(s = "") {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
__name(normKey, "normKey");
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
__name(getCachedNutrition, "getCachedNutrition");
async function putCachedNutrition(env, name, data) {
  if (!env?.R2_BUCKET) return null;
  const key = `nutrition/${normKey(name)}.json`;
  const payload = { ...data, _cachedAt: (/* @__PURE__ */ new Date()).toISOString() };
  await r2WriteJSON(env, key, payload);
  return payload;
}
__name(putCachedNutrition, "putCachedNutrition");
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
        } catch {
        }
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
__name(enrichWithNutrition, "enrichWithNutrition");
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
__name(handleDebugVision, "handleDebugVision");
function classifyStampKey(dish, place_id = "", lang = "en") {
  const base = String(dish || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const pid = String(place_id || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `classify/${lang}/${pid || "unknown"}/${base || "unknown"}.json`;
}
__name(classifyStampKey, "classifyStampKey");
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
__name(getClassifyStamp, "getClassifyStamp");
async function setClassifyStamp(env, key, payload, ttlSeconds = 6 * 3600) {
  const kv = env.MENUS_CACHE;
  if (!kv) return false;
  try {
    await kv.put(
      key,
      JSON.stringify({ savedAt: (/* @__PURE__ */ new Date()).toISOString(), ...payload }),
      {
        expirationTtl: ttlSeconds
      }
    );
    return true;
  } catch {
    return false;
  }
}
__name(setClassifyStamp, "setClassifyStamp");
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
__name(callEdamam, "callEdamam");
function normalizeEdamamRecipe(rec) {
  const name = String(rec?.label || "").trim();
  const lines = Array.isArray(rec?.ingredientLines) ? rec.ingredientLines : [];
  const ingredients = (Array.isArray(rec?.ingredients) ? rec.ingredients : []).map((it) => ({
    name: String(it?.food || it?.text || "").trim(),
    qty: typeof it?.quantity === "number" ? it.quantity : null,
    unit: String(it?.measure || "").trim() || null
  })).filter((x) => x.name);
  const steps = lines.length ? [`Combine: ${lines.join("; ")}`] : [];
  return {
    recipe: { name: name || null, steps, notes: lines.length ? lines : null },
    ingredients
  };
}
__name(normalizeEdamamRecipe, "normalizeEdamamRecipe");
function ingredientEntryToLine(entry) {
  if (typeof entry === "string") return entry.trim();
  if (!entry || typeof entry !== "object") return "";
  const qty = entry.qty ?? entry.quantity ?? entry.amount ?? entry.count ?? void 0;
  const unit = entry.unit || entry.measure || entry.metricUnit || "";
  const name = entry.name || entry.product || entry.ingredient || entry.original || entry.food || entry.text || "";
  const comment = entry.comment || entry.preparation || entry.preparationNotes || entry.note || entry.extra || "";
  const parts = [];
  if (qty !== void 0 && qty !== null && qty !== "") {
    parts.push(String(qty).trim());
  }
  if (unit) parts.push(String(unit).trim());
  if (name) parts.push(String(name).trim());
  let line = parts.join(" ").trim();
  const commentTxt = String(comment || "").trim();
  if (commentTxt) line = line ? `${line}, ${commentTxt}` : commentTxt;
  return line.trim();
}
__name(ingredientEntryToLine, "ingredientEntryToLine");
function normalizeProviderRecipe(payload = {}, fallbackDish = "", provider = "unknown") {
  const base = payload && typeof payload === "object" ? { ...payload } : {};
  const structuredCandidates = Array.isArray(base.ingredients_structured) ? base.ingredients_structured : Array.isArray(base.ingredients) && base.ingredients.every((row) => row && typeof row === "object") ? base.ingredients : null;
  const rawIngredients = Array.isArray(base.ingredients) ? base.ingredients : Array.isArray(base.ingredients_lines) ? base.ingredients_lines : Array.isArray(structuredCandidates) ? structuredCandidates : [];
  const ingredients = rawIngredients.map((entry) => ingredientEntryToLine(entry)).filter(Boolean);
  const recipeSrc = base.recipe || {};
  const recipe = {
    name: recipeSrc.name || recipeSrc.title || fallbackDish || null,
    steps: Array.isArray(recipeSrc.steps) ? recipeSrc.steps : recipeSrc.instructions ? [recipeSrc.instructions] : [],
    notes: Array.isArray(recipeSrc.notes) && recipeSrc.notes.length ? recipeSrc.notes : recipeSrc.image ? [recipeSrc.image] : null
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
__name(normalizeProviderRecipe, "normalizeProviderRecipe");
async function callOpenAIRecipe(dish, env, opts = {}) {
  const key = env.OPENAI_API_KEY;
  if (!key) return { ingredients: [], reason: "OPENAI_API_KEY missing" };
  const system = 'You extract probable ingredient lines for a named dish. Respond ONLY as strict JSON: {"ingredients": ["..."]}. No prose.';
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
    const ingredients = Array.isArray(parsed.ingredients) ? parsed.ingredients.map((s) => String(s).trim()).filter(Boolean) : [];
    return {
      ingredients,
      reason: ingredients.length ? "ok" : "no ingredients",
      debug: data && data.__nonjson__ ? { nonjson: true } : void 0
    };
  } catch (e) {
    return { ingredients: [], reason: String(e?.message || e) };
  }
}
__name(callOpenAIRecipe, "callOpenAIRecipe");
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
    const json2 = await res.json();
    const content = json2?.choices?.[0]?.message?.content || "";
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
__name(runOrgansLLM, "runOrgansLLM");
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

ALLERGEN STRICTNESS RULES:
- You MUST NOT invent ingredients that are not clearly implied by the input.
- You may only set "present": "yes" for an allergen if there is explicit textual evidence in the dish name, menu description, ingredients, or tags.
- Examples of explicit evidence:
  - "egg", "eggs", "egg yolk", "yolk", "huevo" \u2192 egg allergen yes.
  - "cream", "milk", "cheese", "queso", "butter" \u2192 milk allergen yes.
  - "shrimp", "prawns", "camar\xF3n", "gambas" \u2192 shellfish allergen yes.
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
- Vegetarian: no meat/fish/shellfish. Vegan: also no dairy/eggs. If red meat present \u2192 not red-meat-free/vegetarian.

IMPORTANT RULES \u2013 GLUTEN:
- If any ingredient includes wheat, flour, bread, bun, brioche, baguette, pasta, noodles (in any language) and is NOT explicitly gluten-free:
  -> gluten.present = "yes".
- "pan" (Spanish/Italian for bread), "pain" (French), "panino", etc., usually indicate gluten unless explicitly "sin gluten"/"senza glutine"/"gluten-free".
- If ingredients include rice bun, rice bread, corn tortilla, arepa, polenta, yuca bread, cassava bread and do NOT mention wheat/flour:
  -> gluten.present = "no".
- If dish or tags are labeled gluten-free / "GF" / "sin gluten" / "senza glutine":
  -> By default, gluten.present = "no" unless an explicit wheat/flour ingredient is listed (in which case explain the conflict).
- If a component is ambiguous like just "bun" or "bread" with no further info and no gluten-free tags:
  -> gluten.present = "maybe" with a reason like "Bun usually contains wheat; menu does not clarify."

IMPORTANT RULES \u2013 MILK & LACTOSE:
- Treat dairy ingredients (milk, cream, butter, cheese, queso, nata, crema, yogurt, leche, etc.) as milk = "yes".
- Lactose level:
  - High: fresh milk, cream, fresh cheeses, ice cream, condensed milk, sweetened dairy sauces.
  - Medium: butter, soft cheeses, yogurt (unless explicitly lactose-free).
  - Low/Trace: aged hard cheeses (parmesan, gruy\xE8re, aged cheddar, manchego curado).
  - None: plant milks (soy, almond, oat, coconut) or items labeled lactose-free.
- If tags or description explicitly say "lactose-free" / "sin lactosa":
  -> lactose.level = "none" even if dairy words appear, unless clearly contradictory.

IMPORTANT RULES \u2013 FODMAP:
- Consider these common high-FODMAP ingredients:
  - Wheat-based bread/pasta, garlic, onions, honey, agave, apples, pears, mango, stone fruits, many beans, certain sweeteners.
- FODMAP level guidelines:
  - "high": multiple strong high-FODMAP ingredients (e.g., garlic + onion + wheat bun).
  - "medium": some high-FODMAP components but in a mixed dish that also has low-FODMAP ingredients.
  - "low": primarily low-FODMAP items (meat, fish, eggs, rice, potatoes, carrots, zucchini, tomatoes, oil) with minimal or no obvious high-FODMAP triggers.

IMPORTANT RULES \u2013 EXTRA FLAGS:
- pork: set present = "yes" if there is pork, bacon, jam\xF3n, pancetta, chorizo, or similar.
- beef: set present = "yes" if beef, carne de res, steak, hamburger patty, etc.
- alcohol: set present = "yes" if wine, beer, sake, liquor, rum, vodka, tequila, etc. are ingredients.
- spicy: set present = "yes" if ingredients indicate chilies, jalape\xF1o, habanero, "picante", spicy sauce, etc.

MULTI-LANGUAGE AWARENESS:
- Recognize common food words in Spanish, Italian, French, Portuguese, etc.
- Examples:
  - "queso", "nata", "crema", "leche" -> dairy.
  - "pan", "brioche", "baguette", "pasta" -> likely gluten.
  - "mariscos", "gambas", "camar\xF3n", "langostino" -> shellfish.
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
    const json2 = await res.json();
    const content = json2?.choices?.[0]?.message?.content || "";
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
__name(runAllergenMiniLLM, "runAllergenMiniLLM");
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
    tummy_barometer: tummy || existingOrgansBlock && existingOrgansBlock.tummy_barometer || {
      score: 0,
      label: "Unknown comfort"
    },
    flags: {
      ...existingOrgansBlock && existingOrgansBlock.flags ? existingOrgansBlock.flags : {},
      ...flags
    },
    organs: normalizedOrgans.length ? normalizedOrgans : existingOrgansBlock && existingOrgansBlock.organs || []
  };
  return block;
}
__name(mapOrgansLLMToOrgansBlock, "mapOrgansLLMToOrgansBlock");
async function runNutritionMiniLLM(env, input) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("missing-openai-api-key");
  }
  const model = env.OPENAI_MODEL_NUTRITION || "gpt-4.1-mini";
  const systemPrompt = `
You will receive dishName, restaurantName, a nutrition_summary (kcal, grams, mg), and optional tags (badges).

Your tasks:
- Classify each nutrient as "low" | "medium" | "high" relative to a typical single meal:
  calories (low <400, medium 400-800, high >800),
  protein (low <15g, medium 15-30g, high >30g),
  fat (low <12g, medium 12-25g, high >25g),
  carbs (low <30g, medium 30-60g, high >60g),
  sugar (low <10g, medium 10-20g, high >20g),
  fiber (low <4g, medium 4-8g, high >8g),
  sodium (low <600mg, medium 600-1200mg, high >1200mg).
- Produce:
  summary: 1-2 sentence overall description.
  highlights: 2-5 concise bullet-style sentences (positive/neutral points).
  cautions: 1-3 concise sentences on concerns.

Output exactly one JSON object:
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
No extra text.`;
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
  const json2 = await res.json();
  const content = json2?.choices?.[0]?.message?.content || "";
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`openai-nutrition-json-parse-error: ${String(e)}`);
  }
}
__name(runNutritionMiniLLM, "runNutritionMiniLLM");
async function handleAllergenMini(request, env) {
  const body = await readJsonSafe(request) || {};
  const ingredients = Array.isArray(body.ingredients) && body.ingredients.length ? body.ingredients.map((it) => {
    if (typeof it === "string") return { name: it };
    if (it && typeof it === "object") {
      const name = it.name || it.ingredient || it.text || it.original || it.line || "";
      return {
        name,
        normalized: it.normalized || it.canonical || void 0,
        quantity: it.quantity || it.qty || it.amount || void 0,
        language: it.language || it.lang || void 0
      };
    }
    return null;
  }).filter((r) => r && r.name) : [];
  const input = {
    dishName: body.dishName || body.dish || "",
    restaurantName: body.restaurantName || body.restaurant || "",
    menuSection: body.menuSection || body.section || "",
    menuDescription: body.menuDescription || body.description || body.desc || "",
    ingredients,
    tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t || "").trim()).filter(Boolean) : []
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
          error: llmResult?.error || (llmResult && llmResult.ok === false ? "allergen analysis failed" : "unknown-error"),
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
    const fodmap_flags = data?.fodmap ? {
      level: data.fodmap.level || "unknown",
      reason: data.fodmap.reason || "",
      source: "llm-mini"
    } : null;
    const lactose_flags = data?.lactose ? {
      level: data.lactose.level || "unknown",
      reason: data.lactose.reason || "",
      source: "llm-mini"
    } : null;
    const responsePayload = {
      ok: true,
      source: "llm-mini",
      allergens_raw: data,
      allergen_flags,
      fodmap_flags,
      lactose_flags,
      lifestyle_tags: Array.isArray(data.lifestyle_tags) ? data.lifestyle_tags : [],
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
__name(handleAllergenMini, "handleAllergenMini");
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
    let extended = Array.isArray(res.extendedIngredients) ? res.extendedIngredients : null;
    if (!extended || !extended.length) {
      try {
        const infoUrl = `https://api.spoonacular.com/recipes/${res.id}/information?includeNutrition=false&apiKey=${encodeURIComponent(apiKey)}`;
        const infoRes = await fetch(infoUrl, {
          headers: { "x-api-key": apiKey, accept: "application/json" }
        });
        if (infoRes.ok) {
          const info = await infoRes.json();
          extended = Array.isArray(info.extendedIngredients) ? info.extendedIngredients : null;
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
    const ingredientsLines = extended ? extended.map((i) => i.original || i.name || "").filter(Boolean) : [];
    return {
      recipe: {
        title: res.title || dish,
        instructions: res.instructions || "",
        image: res.image || null,
        cuisine: res.cuisines && res.cuisines[0] || cuisine || null
      },
      ingredients: ingredientsLines,
      provider: "spoonacular"
    };
  } catch (err) {
    console.log("Spoonacular fail:", err?.message || String(err));
    return null;
  }
}
__name(spoonacularFetch, "spoonacularFetch");
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
__name(fetchFromEdamam, "fetchFromEdamam");
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
__name(fetchFromSpoonacular, "fetchFromSpoonacular");
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
__name(fetchFromOpenAI, "fetchFromOpenAI");
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
      original: lines[i] || r.ingredientRaw || r.ingredientParsed?.ingredient || "",
      name: r.ingredientParsed?.product || r.ingredientParsed?.ingredient || r.ingredient || r.name || "",
      qty: r.ingredientParsed?.quantity ?? r.quantity ?? null,
      unit: r.ingredientParsed?.unit ?? r.unit ?? null,
      comment: r.ingredientParsed?.preparationNotes ?? r.ingredientParsed?.comment ?? r.comment ?? null,
      _conf: r.confidence ?? null
    }));
    return parsed.length ? parsed : null;
  } catch (err) {
    console.log("Zestful fail:", err?.message || String(err));
    return null;
  }
}
__name(callZestful, "callZestful");
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
        sodium_mg: p.nutriments.sodium_100g != null ? p.nutriments.sodium_100g * 1e3 : null
      }
    };
  } catch (err) {
    return null;
  }
}
__name(callOFF, "callOFF");
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
__name(sumNutrition, "sumNutrition");
function extractMacrosFromFDC(full) {
  const empty = /* @__PURE__ */ __name(() => ({
    energyKcal: null,
    protein_g: null,
    fat_g: null,
    carbs_g: null,
    sugar_g: null,
    fiber_g: null,
    sodium_mg: null
  }), "empty");
  const scaleMacros = /* @__PURE__ */ __name((macros, factor) => {
    if (!macros || !Number.isFinite(factor) || factor <= 0) return null;
    const out = empty();
    for (const key of Object.keys(out)) {
      const val = macros[key];
      out[key] = val == null ? null : Math.round(val * factor * 1e3) / 1e3;
    }
    return out;
  }, "scaleMacros");
  const deriveServing = /* @__PURE__ */ __name(() => {
    let grams = null;
    let unit = null;
    let size = null;
    const rawSize = Number(full?.servingSize);
    if (Number.isFinite(rawSize) && rawSize > 0) size = rawSize;
    const rawUnit = typeof full?.servingSizeUnit === "string" ? full.servingSizeUnit.trim() : "";
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
      const isServing = desc.includes("serving") || desc.includes("portion") || desc.includes("piece");
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
    if (grams != null) grams = Math.round(grams * 1e3) / 1e3;
    if (grams == null && unit == null && size == null) return null;
    return {
      grams,
      unit: unit ? unit.toLowerCase() : null,
      size
    };
  }, "deriveServing");
  const serving = deriveServing();
  const servingGrams = serving?.grams && Number.isFinite(serving.grams) && serving.grams > 0 ? serving.grams : null;
  const ln = full?.labelNutrients;
  if (ln) {
    const v = /* @__PURE__ */ __name((k) => ln[k]?.value ?? null, "v");
    const perServing2 = empty();
    perServing2.energyKcal = v("calories") != null ? Math.round(v("calories")) : null;
    perServing2.protein_g = v("protein") != null ? Number(v("protein")) : null;
    perServing2.fat_g = v("fat") != null ? Number(v("fat")) : null;
    perServing2.carbs_g = v("carbohydrates") != null ? Number(v("carbohydrates")) : null;
    perServing2.sugar_g = v("sugars") != null ? Number(v("sugars")) : null;
    perServing2.fiber_g = v("fiber") != null ? Number(v("fiber")) : null;
    perServing2.sodium_mg = v("sodium") != null ? Math.round(v("sodium")) : null;
    const per100g2 = servingGrams ? scaleMacros(perServing2, 100 / servingGrams) : null;
    return {
      perServing: perServing2,
      per100g: per100g2,
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
  const find = /* @__PURE__ */ __name((preds) => {
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
  }, "find");
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
  const norm = /* @__PURE__ */ __name((r, to = "g") => {
    if (!r || r.value == null) return null;
    if (to === "g") {
      if (r.unit === "mg") return r.value / 1e3;
      return r.value;
    }
    if (to === "mg") {
      if (r.unit === "g") return r.value * 1e3;
      return r.value;
    }
    return r.value;
  }, "norm");
  const per100g = empty();
  per100g.energyKcal = energyKcal != null ? Math.round(energyKcal) : null;
  per100g.protein_g = norm(prot, "g");
  per100g.fat_g = norm(fat, "g");
  per100g.carbs_g = norm(carb, "g");
  per100g.sugar_g = norm(sug, "g");
  per100g.fiber_g = norm(fib, "g");
  per100g.sodium_mg = norm(sod, "mg");
  const perServing = servingGrams ? scaleMacros(per100g, servingGrams / 100) : null;
  return {
    perServing: perServing || (per100g ? { ...per100g } : empty()),
    per100g,
    serving
  };
}
__name(extractMacrosFromFDC, "extractMacrosFromFDC");
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
__name(nutritionSummaryFromEdamamTotalNutrients, "nutritionSummaryFromEdamamTotalNutrients");
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
  const makeEmpty = /* @__PURE__ */ __name(() => ({
    energyKcal: null,
    protein_g: null,
    fat_g: null,
    carbs_g: null,
    sugar_g: null,
    fiber_g: null,
    sodium_mg: null
  }), "makeEmpty");
  const lowerName = name.toLowerCase();
  const nameTokens2 = lowerName.split(/\s+/).filter(Boolean);
  const matchThreshold = lowerName ? nameTokens2.length >= 2 ? 4 : 2 : 1;
  const dataTypePriority = /* @__PURE__ */ new Map([
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
  const looksProcessed = /* @__PURE__ */ __name((text = "") => {
    const lower = String(text || "").toLowerCase();
    return processedTerms.some((term) => lower.includes(term));
  }, "looksProcessed");
  const scoreName = /* @__PURE__ */ __name((text = "") => {
    const lower = String(text || "").toLowerCase();
    if (!lower) return 0;
    let score = 0;
    if (lower === lowerName) score += 6;
    if (lower.includes(lowerName)) score += 4;
    for (const token of nameTokens2) {
      if (token.length < 3) continue;
      if (lower.includes(token)) score += 1;
    }
    return score;
  }, "scoreName");
  const qualityScore = /* @__PURE__ */ __name((f) => {
    const dt = (f.dataType || "").toLowerCase();
    const combined = [
      f.description,
      f.additionalDescriptions,
      f.ingredientStatement
    ].filter(Boolean).join(" ");
    let score = (dataTypePriority.get(dt) || 0) * 10;
    score += scoreName(combined);
    if (!f.brandOwner) score += 1;
    else if (dt.includes("branded")) score -= 1;
    if (Array.isArray(f.foodNutrients) && f.foodNutrients.length > 0)
      score += 2;
    if (looksProcessed(combined)) score -= 6;
    return score;
  }, "qualityScore");
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
    const nutrients = macros?.perServing ? { ...macros.perServing } : macros?.per100g ? { ...macros.per100g } : makeEmpty();
    const payload = {
      fdcId: full.fdcId,
      description: full.description,
      brand: full.brandOwner || null,
      dataType: full.dataType || null,
      nutrients,
      nutrients_per_serving: macros?.perServing ? { ...macros.perServing } : null,
      nutrients_per_100g: macros?.per100g ? { ...macros.per100g } : null,
      serving: macros?.serving || null,
      source: "USDA_FDC"
    };
    const combinedDesc = [
      full.description,
      full.additionalDescriptions,
      full.ingredientStatement
    ].filter(Boolean).join(" ");
    const processed = looksProcessed(combinedDesc);
    const nameScore = scoreName(combinedDesc);
    const matches = nameScore >= matchThreshold;
    const hasMacros = nutrients.energyKcal != null || nutrients.protein_g != null;
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
__name(callUSDAFDC, "callUSDAFDC");
async function resolveNutritionFromUSDA(env, dishName, description2) {
  if (!dishName && !description2) return null;
  let hit = null;
  try {
    hit = await callUSDAFDC(env, dishName || "");
  } catch {
  }
  if (!hit && description2) {
    const shortDesc = description2.split(/[.,;]/)[0].slice(0, 80);
    try {
      hit = await callUSDAFDC(env, shortDesc);
    } catch {
    }
  }
  if (hit && hit.nutrients && typeof hit.nutrients === "object") {
    return hit.nutrients;
  }
  return null;
}
__name(resolveNutritionFromUSDA, "resolveNutritionFromUSDA");
async function r2WriteJSON(env, key, obj) {
  if (!env?.R2_BUCKET) throw new Error("R2_BUCKET not bound");
  await env.R2_BUCKET.put(key, JSON.stringify(obj), {
    httpMetadata: { contentType: "application/json" }
  });
}
__name(r2WriteJSON, "r2WriteJSON");
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
__name(handleDebugFetchBytes, "handleDebugFetchBytes");
async function enqueueDishDirect(env, payload) {
  const id = globalThis.crypto?.randomUUID && crypto.randomUUID() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const message = { id, ...payload };
  await env.ANALYSIS_QUEUE.send(JSON.stringify(message));
  return { ok: true, id };
}
__name(enqueueDishDirect, "enqueueDishDirect");
async function enqueueTopItems(env, topItems, { place_id, cuisine, query, address, forceUS }) {
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
      const now = (/* @__PURE__ */ new Date()).toISOString();
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
  const enqueued = jobs.map(
    (j) => j.status === "fulfilled" ? j.value : { error: String(j.reason) }
  );
  return { enqueued };
}
__name(enqueueTopItems, "enqueueTopItems");
async function resolveRecipeWithCache(env, {
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
}) {
  const dish = String(dishTitle || "").trim();
  if (!dish) {
    return {
      ok: false,
      status: 400,
      error: 'Missing "dish" (dish name).',
      hint: "Use: /recipe/resolve?dish=Chicken%20Alfredo"
    };
  }
  const providersParse = (env.PROVIDERS_PARSE || env.provider_parse || "zestful,openai").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const recipeProviderFns = {
    edamam: fetchFromEdamam,
    spoonacular: fetchFromSpoonacular,
    openai: fetchFromOpenAI
  };
  const parseProviderFns = {
    zestful: /* @__PURE__ */ __name(async (env2, ingLines2) => callZestful(env2, ingLines2), "zestful"),
    openai: /* @__PURE__ */ __name(async () => null, "openai")
    // placeholder (skip for now)
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
  const cached = !force ? await recipeCacheRead(env, cacheKey) : null;
  if (cached && cached.recipe && Array.isArray(cached.ingredients)) {
    cacheHit = true;
    pickedSource = cached.from || cached.provider || "cache";
    recipe = cached.recipe;
    ingredients = [...cached.ingredients];
    notes = typeof cached.notes === "object" && cached.notes ? { ...cached.notes } : {};
    out = {
      ...cached,
      cache: true,
      recipe,
      ingredients
    };
    selectedProvider = pickedSource;
  } else {
    let lastAttempt = null;
    const providerList = Array.isArray(providersOverride) ? providersOverride : providerOrder(env);
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
      if (candidate && Array.isArray(candidate.ingredients) && candidate.ingredients.length) {
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
    if (selectedProvider && out && Array.isArray(out.ingredients) && out.ingredients.length) {
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
  const sourceLines = Array.isArray(out?.ingredients) ? out.ingredients : Array.isArray(out?.ingredients_lines) ? out.ingredients_lines : [];
  const ingLines = Array.isArray(sourceLines) ? sourceLines.map(ingredientEntryToLine).filter(Boolean) : [];
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
        } catch {
        }
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
      qty: typeof row.qty === "number" ? row.qty : row.qty != null ? Number(row.qty) || null : null,
      unit: row.unit || null,
      comment: row.comment || row.preparationNotes || null
    }));
    out.ingredients_parsed = parsed;
    out.nutrition_summary = sumNutrition(parsed);
  } else if (Array.isArray(out?.ingredients_structured) && out.ingredients_structured.length) {
    ingredients = out.ingredients_structured.map((row) => ({
      name: row.name || row.original || "",
      qty: row.qty ?? row.quantity ?? null,
      unit: row.unit ?? null,
      comment: row.comment || row.preparation || row.preparationNotes || null
    }));
  } else if (Array.isArray(out?.ingredients) && out.ingredients.every(
    (x) => x && typeof x === "object" && ("name" in x || "original" in x)
  )) {
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
    if (Array.isArray(out.ingredients_structured) && out.ingredients_structured.length) {
      out.ingredients_parsed = out.ingredients_structured;
      if (!Array.isArray(out.ingredients_lines) || !out.ingredients_lines.length) {
        out.ingredients_lines = out.ingredients_structured.map((x) => ingredientEntryToLine(x)).filter(Boolean);
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
            const qty = x.qty !== void 0 && x.qty !== null ? `${x.qty}` : "";
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
    if (out && out.raw && out.raw.totalNutrients && !out.nutrition_summary && typeof nutritionSummaryFromEdamamTotalNutrients === "function") {
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
    ...out?.ingredients_lines ? { ingredients_lines: out.ingredients_lines } : {},
    ...out?.ingredients_parsed ? { ingredients_parsed: out.ingredients_parsed } : {},
    ...Object.keys(notes).length ? { notes } : {}
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
__name(resolveRecipeWithCache, "resolveRecipeWithCache");
async function handleRecipeResolve(env, request, url, ctx) {
  const method = request.method || "GET";
  let dish = url.searchParams.get("dish") || url.searchParams.get("title") || "";
  let place_id = url.searchParams.get("place_id") || "";
  let cuisine = url.searchParams.get("cuisine") || "";
  let lang = url.searchParams.get("lang") || "en";
  let body = {};
  const providersParse = (env.PROVIDERS_PARSE || env.provider_parse || "zestful,openai").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const recipeProviderFns = {
    edamam: fetchFromEdamam,
    spoonacular: fetchFromSpoonacular,
    openai: fetchFromOpenAI
  };
  const parseProviderFns = {
    zestful: /* @__PURE__ */ __name(async (env2, ingLines2) => callZestful(env2, ingLines2), "zestful"),
    openai: /* @__PURE__ */ __name(async () => null, "openai")
    // placeholder (skip for now)
  };
  if (method === "POST") {
    try {
      body = await request.json();
    } catch {
    }
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
    ingredients = Array.isArray(cached.ingredients) ? [...cached.ingredients] : [];
    notes = typeof cached.notes === "object" && cached.notes ? { ...cached.notes } : {};
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
          steps: recipe?.steps && Array.isArray(recipe.steps) ? recipe.steps : [],
          notes: recipe?.notes && Array.isArray(recipe.notes) ? recipe.notes : null
        },
        molecular: { compounds: [], organs: {}, organ_summary: {} }
        // will fill if Premium
      };
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
        let headlineFor = function({ plus = 0, minus = 0 }) {
          if (minus > 0 && plus === 0) return "\u26A0\uFE0F Risk";
          if (plus > 0 && minus === 0) return "\u{1F44D} Benefit";
          if (plus > 0 && minus > 0) return "\u2194\uFE0F Mixed";
          return "\u2139\uFE0F Neutral";
        }, humanizeOrgans = function(summary) {
          const tips = [];
          for (const [org, { plus = 0, minus = 0 }] of Object.entries(
            summary
          )) {
            const Org = org.charAt(0).toUpperCase() + org.slice(1);
            let line = `${Org}: `;
            if (minus > 0 && plus === 0)
              line += "may bother sensitive tummies\u2014consider smaller portions or swaps.";
            else if (plus > 0 && minus === 0)
              line += "generally friendly in normal portions.";
            else if (plus > 0 && minus > 0)
              line += "mixed signal\u2014portion size and add-ons matter.";
            else line += "no clear signal\u2014use your judgment.";
            tips.push(line);
          }
          return tips;
        }, titleize = function(s) {
          return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
        };
        __name(headlineFor, "headlineFor");
        __name(humanizeOrgans, "humanizeOrgans");
        __name(titleize, "titleize");
        const foundCompounds = [];
        const organMap = {};
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
        const seenCompounds = /* @__PURE__ */ new Set();
        for (const ing of ingredients) {
          const term = (ing?.name || "").toLowerCase().trim();
          if (!term) continue;
          const searchTerms = [term, ...BRIDGE[term] || []];
          for (const sTerm of searchTerms) {
            const cRes = await env.D1_DB.prepare(
              `SELECT id, name, common_name, cid
                        FROM compounds
                        WHERE LOWER(name) = ? OR LOWER(common_name) = ?
                           OR LOWER(name) LIKE ? OR LOWER(common_name) LIKE ?
                        ORDER BY name LIMIT 5`
            ).bind(sTerm, sTerm, `%${sTerm}%`, `%${sTerm}%`).all();
            const comps = cRes?.results || [];
            for (const c of comps) {
              const key = (c.name || "").toLowerCase();
              if (seenCompounds.has(key)) continue;
              seenCompounds.add(key);
              const eRes = await env.D1_DB.prepare(
                `SELECT organ, effect, strength, notes
                          FROM compound_organ_effects
                          WHERE compound_id = ?`
              ).bind(c.id).all();
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
        for (const [org, list] of Object.entries(organMap)) {
          const seen = /* @__PURE__ */ new Set();
          organMap[org] = list.filter((row) => {
            const key = `${org}|${row.compound}|${row.effect}`.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
        const organSummary = {};
        for (const [org, list] of Object.entries(organMap)) {
          let plus = 0, minus = 0, neutral = 0;
          for (const row of list) {
            if (row.effect === "benefit") plus++;
            else if (row.effect === "risk") minus++;
            else neutral++;
          }
          organSummary[org] = { plus, minus, neutral };
        }
        const organ_headlines = Object.entries(organSummary).map(
          ([org, counts]) => `${org[0].toUpperCase()}${org.slice(1)}: ${headlineFor(counts)}`
        );
        const ORG_ICON = {
          heart: "\u2764\uFE0F",
          gut: "\u{1F9A0}",
          liver: "\u{1F9EA}",
          brain: "\u{1F9E0}",
          immune: "\u{1F6E1}\uFE0F"
        };
        rc.molecular_icons = Object.keys(organSummary).reduce((m, org) => {
          m[org] = ORG_ICON[org] || "\u{1F9EC}";
          return m;
        }, {});
        rc.molecular_human = { organ_tips: humanizeOrgans(organSummary) };
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
        const riskStr = totals.riskOrgs.map(titleize).join(", ");
        const benefitStr = totals.benefitOrgs.map(titleize).join(", ");
        let overall_label = "Neutral";
        if (totals.minus > 0 && totals.plus === 0) overall_label = "Caution";
        else if (totals.plus > 0 && totals.minus === 0)
          overall_label = "Supportive";
        else if (totals.plus > 0 && totals.minus > 0) overall_label = "Mixed";
        const summary_sentence = overall_label === "Caution" ? `\u26A0\uFE0F May bother ${riskStr || "sensitive tummies"}.` : overall_label === "Supportive" ? `\u{1F44D} Generally friendly for ${benefitStr || "wellbeing"} in normal portions.` : overall_label === "Mixed" ? `\u2194\uFE0F Mixed signal \u2014 supportive for ${benefitStr || "some organs"}, but caution for ${riskStr || "others"}.` : `\u2139\uFE0F No clear signal \u2014 use your judgment.`;
        rc.molecular_human = {
          ...rc.molecular_human || {},
          summary: summary_sentence,
          sentiment: overall_label
        };
        rc.payload_version = "recipe_card.v1.1";
        rc.generated_at = (/* @__PURE__ */ new Date()).toISOString();
        if (rc?.molecular?.compounds?.length >= 0 && !rc.molecular.gated) {
          rc.molecular_badge = `Molecular Insights: ${rc.molecular.compounds.length} compounds \u2022 ${Object.keys(rc.molecular.organ_summary || {}).length} organs`;
        } else if (rc?.molecular?.gated) {
          rc.molecular_badge = "Molecular Insights: upgrade for details";
        }
        rc.molecular = {
          compounds: foundCompounds,
          organs: organMap,
          organ_summary: organSummary,
          organ_headlines
        };
        rc.molecular_badge = `Molecular Insights: ${foundCompounds.length} compounds \u2022 ${Object.keys(organSummary).length} organs`;
        rc.has_molecular = !rc?.molecular?.gated && Array.isArray(rc?.molecular?.compounds) && rc.molecular.compounds.length > 0;
        rc.molecular_counts = {
          compounds: Array.isArray(rc?.molecular?.compounds) ? rc.molecular.compounds.length : 0,
          organs: rc?.molecular?.organ_summary ? Object.keys(rc.molecular.organ_summary).length : 0
        };
        const wantClassify = url.searchParams.get("classify") === "1";
        if (wantClassify) {
          const dishTitleCard = rc?.dish?.name || dish || "Unknown Dish";
          const payload = {
            place_id: place_id || "place.unknown",
            dish_name: dishTitleCard,
            dish_desc: (Array.isArray(rc?.recipe?.notes) ? rc.recipe.notes.join("; ") : rc?.recipe?.steps?.[0] || "") || "",
            cuisine: cuisine || "",
            ingredients: (rc?.ingredients || []).map((i) => ({
              name: i.name,
              qty: i.qty ?? null,
              unit: i.unit ?? null
            }))
          };
          const { ok: enqOk, id } = await enqueueDishDirect(env, payload);
          rc.enqueued = enqOk && id ? [{ id, dish_name: payload.dish_name }] : [];
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
      if (candidate && Array.isArray(candidate.ingredients) && candidate.ingredients.length) {
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
    if (selectedProvider && out && Array.isArray(out.ingredients) && out.ingredients.length) {
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
  const sourceLines = Array.isArray(out?.ingredients) ? out.ingredients : Array.isArray(out?.ingredients_lines) ? out.ingredients_lines : [];
  const ingLines = Array.isArray(sourceLines) ? sourceLines.map(ingredientEntryToLine).filter(Boolean) : [];
  if (!out) out = {};
  out.ingredients_lines = ingLines;
  let parsed = null;
  const kv = env.MENUS_CACHE;
  const dailyCap = parseInt(env.ZESTFUL_DAILY_CAP || "0", 10);
  if (wantParse && ingLines.length && env.ZESTFUL_RAPID_KEY) {
    const cached2 = [];
    const missingIdx = [];
    if (kv) {
      for (let i = 0; i < ingLines.length; i++) {
        const k = `zestful:${ingLines[i].toLowerCase()}`;
        let row = null;
        try {
          row = await kv.get(k, "json");
        } catch {
        }
        if (row) cached2[i] = row;
        else missingIdx.push(i);
      }
    }
    let filled = cached2.slice();
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
      qty: typeof row.qty === "number" ? row.qty : row.qty != null ? Number(row.qty) || null : null,
      unit: row.unit || null,
      comment: row.comment || row.preparationNotes || null
    }));
    out.ingredients_parsed = parsed;
    out.nutrition_summary = sumNutrition(parsed);
  } else if (Array.isArray(out?.ingredients_structured) && out.ingredients_structured.length) {
    ingredients = out.ingredients_structured.map((row) => ({
      name: row.name || row.original || "",
      qty: row.qty ?? row.quantity ?? null,
      unit: row.unit ?? null,
      comment: row.comment || row.preparation || row.preparationNotes || null
    }));
  } else if (Array.isArray(out?.ingredients) && out.ingredients.every(
    (x) => x && typeof x === "object" && ("name" in x || "original" in x)
  )) {
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
    if (Array.isArray(out.ingredients_structured) && out.ingredients_structured.length) {
      out.ingredients_parsed = out.ingredients_structured;
      if (!Array.isArray(out.ingredients_lines) || !out.ingredients_lines.length) {
        out.ingredients_lines = out.ingredients_structured.map((x) => ingredientEntryToLine(x)).filter(Boolean);
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
            const qty = x.qty !== void 0 && x.qty !== null ? `${x.qty}` : "";
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
    const classifySource = out?.ingredients_parsed || out?.ingredients_lines || ingredients;
    const payload = {
      place_id: place_id || "place.unknown",
      dish_name: dish,
      dish_desc: (Array.isArray(recipe?.notes) ? recipe.notes.join("; ") : recipe?.steps?.[0] || "") || "",
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
    out.provider = out.cache ? "cache" : out.provider ?? null;
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
    ...out?.ingredients_lines ? { ingredients_lines: out.ingredients_lines } : {},
    ...out?.ingredients_parsed ? { ingredients_parsed: out.ingredients_parsed } : {},
    ...Object.keys(notes).length ? { notes } : {}
  };
  out = out ? { ...out, ...reply } : { ...reply };
  if (wantShape === "likely_recipe" || wantShape === "likely_recipe_md") {
    const ingForCookbook = (out?.ingredients_lines && out.ingredients_lines.length ? out.ingredients_lines : ingredients) || [];
    const stepSource = (Array.isArray(recipe?.steps) && recipe.steps.length ? recipe.steps : Array.isArray(out?.recipe?.steps) ? out.recipe.steps : []) || [];
    const servingInfo = recipe && typeof recipe === "object" ? {
      servings: recipe.servings ?? recipe.yield ?? null,
      grams: recipe.grams ?? null
    } : null;
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
  if (wantShape === "recipe_card") {
    const dishTitle = dish || body?.dish || url.searchParams.get("dish") || "Unknown Dish";
    const rc = {
      ok: true,
      component: "RecipeCard",
      version: "v1",
      dish: { name: dishTitle, cuisine: cuisine || null },
      ingredients: Array.isArray(ingredients) ? ingredients.map((i) => ({
        name: i.name,
        qty: i.qty ?? null,
        unit: i.unit ?? null
      })) : [],
      recipe: {
        steps: recipe?.steps && Array.isArray(recipe.steps) ? recipe.steps : [],
        notes: recipe?.notes && Array.isArray(recipe.notes) ? recipe.notes : null
      },
      molecular: { compounds: [], organs: {}, organ_summary: {} }
      // filled only for Premium
    };
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
      const seenCompounds = /* @__PURE__ */ new Set();
      for (const ing of ingredients) {
        const term = (ing?.name || "").toLowerCase().trim();
        if (!term) continue;
        const cRes = await env.D1_DB.prepare(
          `SELECT id, name, common_name, cid
           FROM compounds
           WHERE LOWER(name) LIKE ? OR LOWER(common_name) LIKE ?
           ORDER BY name LIMIT 5`
        ).bind(`%${term}%`, `%${term}%`).all();
        const comps = cRes?.results || [];
        for (const c of comps) {
          const eRes = await env.D1_DB.prepare(
            `SELECT organ, effect, strength, notes
             FROM compound_organ_effects
             WHERE compound_id = ?`
          ).bind(c.id).all();
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
        let plus = 0, minus = 0, neutral = 0;
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
__name(handleRecipeResolve, "handleRecipeResolve");
async function fetchMenuFromUberEats(env, query, address = "Miami, FL, USA", maxRows = 15, lat = null, lng = null, radius = 5e3) {
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
  __name(postJob, "postJob");
  async function postJobByLocation2() {
    const url = `${base}/api/job/location`;
    const body = {
      scraper: {
        maxRows,
        query,
        locale: "en-US",
        page: 1,
        location: lat != null && lng != null ? { latitude: lat, longitude: lng } : null,
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
  __name(postJobByLocation2, "postJobByLocation");
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
  __name(getById, "getById");
  const create = await postJob();
  const created = await create.json();
  const jobId = created?.data?.jobId || created?.jobId || created?.id || created?.data?.id;
  if (!jobId) throw new Error("UberEats: no jobId returned");
  let tries = 0, resultsPayload = null;
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
      await res.text().catch(() => {
      });
    } finally {
      if (res.body && typeof res.body.cancel === "function") {
        res.body.cancel();
      }
    }
    const results = j?.data?.results || j?.results || j?.data?.data?.results || [];
    if (Array.isArray(results) && results.length) {
      resultsPayload = j;
      break;
    }
    await sleep(800 * tries);
  }
  if (!resultsPayload)
    throw new Error("UberEats: job finished with no results");
  let parsed = resultsPayload;
  const hasCandidates = Array.isArray(parsed?.data?.results) && parsed.data.results.length || Array.isArray(parsed?.results) && parsed.results.length || Array.isArray(parsed?.data?.data?.results) && parsed.data.data.results.length;
  if (!hasCandidates && lat != null && lng != null) {
    const resLoc = await postJobByLocation2();
    const ctypeLoc = (resLoc.headers.get("content-type") || "").toLowerCase();
    if (ctypeLoc.includes("application/json")) {
      const locJson = await resLoc.json();
      if (resLoc.ok) parsed = locJson;
    }
  }
  return parsed;
}
__name(fetchMenuFromUberEats, "fetchMenuFromUberEats");
async function postJobByLocation({ query, lat, lng, radius = 6e3, maxRows = 25 }, env) {
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
    const safeErr = /* @__PURE__ */ __name(() => {
      if (text && text.startsWith("<"))
        return `UberEats non-JSON response (${res.status}): ${text.slice(0, 120)}...`;
      return `UberEats ${res.status}: ${text}`;
    }, "safeErr");
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || Number(res.headers.get("x-ratelimit-reset")) || 0;
      const waitMs = retryAfter > 0 ? retryAfter * 1e3 : 1500;
      await sleep(waitMs);
      throw new Error(
        `RETRYABLE_429:${Math.max(0, Math.floor(waitMs / 1e3))}`
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
  __name(attemptOnce, "attemptOnce");
  let lastErr;
  for (const p of candidatePaths) {
    const url = `https://${host}${p}`;
    for (let i = 0; i < 4; i++) {
      try {
        const js = await attemptOnce(url);
        const jobId = js?.job_id || js?.id || js?.jobId || js?.data?.job_id || js?.data?.id;
        if (!jobId) return js;
        return { ok: true, job_id: jobId, raw: js, path: p };
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || err);
        if (msg === "HARD_404") break;
        const retryable = msg.includes("RETRYABLE_429") || /UberEats (502|503|504)/.test(msg);
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
__name(postJobByLocation, "postJobByLocation");
async function searchNearbyCandidates({ query, lat, lng, radius = 6e3, maxRows = 25 }, env) {
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
  const params = /* @__PURE__ */ __name((p) => {
    const u = new URL(`https://${host}${p}`);
    u.searchParams.set("latitude", String(Number(lat)));
    u.searchParams.set("longitude", String(Number(lng)));
    if (query) u.searchParams.set("query", query);
    u.searchParams.set("radius", String(Number(radius)));
    u.searchParams.set("max", String(Number(maxRows) || 25));
    return u.toString();
  }, "params");
  async function attemptOnce(url) {
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-rapidapi-key": key, "x-rapidapi-host": host }
    });
    const text = await res.text();
    const safeErr = /* @__PURE__ */ __name(() => {
      if (text && text.startsWith("<"))
        return `UberEats non-JSON response (${res.status}): ${text.slice(0, 120)}...`;
      return `UberEats ${res.status}: ${text}`;
    }, "safeErr");
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || Number(res.headers.get("x-ratelimit-reset")) || 0;
      const waitMs = retryAfter > 0 ? retryAfter * 1e3 : 1200;
      await sleep(waitMs);
      throw new Error(
        `RETRYABLE_429:${Math.max(0, Math.floor(waitMs / 1e3))}`
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
  __name(attemptOnce, "attemptOnce");
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
              id: it?.id || it?.uuid || it?.storeUuid || it?.storeId || it?.restaurantId || it?.slug || it?.url,
              title: it?.title || it?.name || it?.displayName || it?.storeName || it?.restaurantName,
              raw: it
            });
          }
        }
        const seen = /* @__PURE__ */ new Set();
        const clean = flat.filter((x) => x && x.title).filter((x) => {
          const k = (x.title + "|" + (x.id || "")).toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).slice(0, Number(maxRows) || 25);
        return {
          ok: true,
          pathTried: p,
          count: clean.length,
          candidates: clean,
          raw: data
        };
      } catch (err) {
        const msg = String(err?.message || err);
        const retryable = msg.includes("RETRYABLE_429") || /UberEats (502|503|504)/.test(msg);
        if (!retryable) break;
        await sleep(400 * (i + 1) + Math.floor(Math.random() * 200));
      }
    }
  }
  return { ok: false, error: "No working GPS search endpoint found." };
}
__name(searchNearbyCandidates, "searchNearbyCandidates");
async function postJobByAddress({ query, address, maxRows = 15, locale = "en-US", page = 1, webhook = null }, env) {
  const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const key = env.RAPIDAPI_KEY || env.RAPID_API_KEY;
  if (!key) throw new Error("Missing RAPIDAPI_KEY");
  if (!host) throw new Error("Missing UBER_RAPID_HOST");
  if (!address) throw new Error("Missing address");
  const url = `https://${host}/api/job`;
  const body = {
    scraper: {
      maxRows: Number(maxRows) || 15,
      query: String(query || ""),
      address: String(address),
      locale: String(locale || "en-US"),
      page: Number(page) || 1
    },
    ...webhook ? { webhook } : {}
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
    const safeErr = /* @__PURE__ */ __name(() => {
      if (text && text.startsWith("<"))
        return `UberEats non-JSON response (${res.status}): ${text.slice(0, 120)}...`;
      return `UberEats ${res.status}: ${text}`;
    }, "safeErr");
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || Number(res.headers.get("x-ratelimit-reset")) || 0;
      const waitMs = retryAfter > 0 ? retryAfter * 1e3 : 1500;
      await new Promise((r) => setTimeout(r, waitMs));
      throw new Error(
        `RETRYABLE_429:${Math.max(0, Math.floor(waitMs / 1e3))}`
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
    return js;
  }
  __name(attemptOnce, "attemptOnce");
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
      const retryable = msg.includes("RETRYABLE") || /UberEats (500|502|503|504)/.test(msg);
      if (!retryable) throw e;
      const backoff = 500 * Math.pow(1.8, i) + Math.floor(Math.random() * 300);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw new Error("UberEats: address job failed after retries.");
}
__name(postJobByAddress, "postJobByAddress");
var US_STATES = /* @__PURE__ */ new Set([
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
  return /usa|united states|, us\b/.test(s) || /\b[A-Z]{2}\b/.test(raw);
}
__name(looksLikeUSAddress, "looksLikeUSAddress");
function isUSRow(row) {
  const country = (row?.location?.country || row?.location?.geo?.country || row?.country || "").toString().toLowerCase();
  const region = (row?.location?.region || row?.location?.geo?.region || row?.region || "").toString().toUpperCase();
  const currency = (row?.currencyCode || row?.currency || "").toString().toUpperCase();
  const url = String(row?.url || row?.link || "").toLowerCase();
  if (country === "united states" || country === "us" || country === "usa")
    return true;
  if (US_STATES.has(region)) return true;
  if (currency === "USD") return true;
  if (/\/us\//.test(url)) return true;
  return false;
}
__name(isUSRow, "isUSRow");
function filterRowsUS(rows, force) {
  if (!Array.isArray(rows)) return [];
  const filtered = rows.filter(isUSRow);
  return force && filtered.length > 0 ? filtered : filtered.length ? filtered : rows;
}
__name(filterRowsUS, "filterRowsUS");
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
__name(pollUberJobUntilDone, "pollUberJobUntilDone");
function extractPlacePhotoReference(place) {
  const photos = place?.photos;
  if (!photos || !photos.length) return null;
  return photos[0].photo_reference || null;
}
__name(extractPlacePhotoReference, "extractPlacePhotoReference");
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
__name(extractGooglePhotoUrl, "extractGooglePhotoUrl");
async function fetchGooglePlaceDetailsGateway(env, placeId) {
  console.log("DEBUG: fetchGooglePlaceDetailsGateway called with placeId:", placeId);
  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Missing GOOGLE_MAPS_API_KEY" };
  }
  const params = new URLSearchParams();
  params.set("place_id", placeId);
  params.set("key", apiKey);
  const url = "https://maps.googleapis.com/maps/api/place/details/json?" + params.toString();
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
    const loc = result.geometry && result.geometry.location ? result.geometry.location : {};
    return {
      ok: true,
      name: result.name || "",
      address: result.formatted_address || [result.vicinity, result.formatted_address].filter(Boolean).join(", "),
      lat: loc.lat ?? null,
      lng: loc.lng ?? null,
      raw: data
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}
__name(fetchGooglePlaceDetailsGateway, "fetchGooglePlaceDetailsGateway");
async function waitForUberJobGateway(env, job, { attempts = 6 } = {}) {
  if (!job || job.immediate) return job;
  const jobId = job?.job_id || job?.id || job?.data?.job_id || job?.data?.id || job?.returnvalue?.job_id || job?.returnvalue?.id;
  if (!jobId) return job;
  return pollUberJobUntilDone({
    jobId,
    env,
    maxTries: Math.max(1, attempts)
  });
}
__name(waitForUberJobGateway, "waitForUberJobGateway");
function flattenUberPayloadToItemsGateway(payload, opts = {}) {
  if (!payload) return [];
  const targetName = (opts.targetName || "").toLowerCase().trim();
  const candidateStores = [];
  function maybePushStore(obj) {
    if (!obj || typeof obj !== "object") return;
    const menu = Array.isArray(obj.menu) ? obj.menu : null;
    if (!menu) return;
    const title = obj.title || obj.name || obj.sanitizedTitle || obj.storeName || "";
    if (!title) return;
    candidateStores.push(obj);
  }
  __name(maybePushStore, "maybePushStore");
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
      const title = (s.title || s.name || s.sanitizedTitle || s.storeName || "").toLowerCase().trim();
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
    const restaurantTitle = store.title || store.name || store.sanitizedTitle || store.storeName || "";
    const restaurantAddress = store.location?.address || store.location?.streetAddress || store.location?.formattedAddress || "";
    const menus = Array.isArray(store.menu) ? store.menu : [];
    for (const section of menus) {
      const sectionName = section.catalogName || section.sectionName || "";
      const items = Array.isArray(section.catalogItems) ? section.catalogItems : [];
      for (const item of items) {
        if (!item) continue;
        const name = item.title || item.name || "";
        if (!name) continue;
        let imageUrl = null;
        if (item.imageUrl || item.image_url || item.image) {
          imageUrl = item.imageUrl || item.image_url || item.image;
        } else if (Array.isArray(item.images) && item.images.length > 0) {
          imageUrl = item.images[0].url || item.images[0].imageUrl || item.images[0].image_url || null;
        } else if (item.photo && typeof item.photo === "object") {
          imageUrl = item.photo.url || item.photo.imageUrl || item.photo.image_url || null;
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
__name(flattenUberPayloadToItemsGateway, "flattenUberPayloadToItemsGateway");
function filterUberItemsByGoogleContextGateway(items, googleContext) {
  if (!Array.isArray(items) || !items.length || !googleContext) return [];
  const gName = googleContext.name || "";
  const gAddr = googleContext.address || "";
  if (!gName && !gAddr) return [];
  const strict = items.filter((it) => {
    const rName = it.restaurantTitle || it.restaurant_name || it.restaurant && it.restaurant.name || "";
    const rAddr = it.restaurantAddress || it.restaurant_address || it.restaurant && it.restaurant.address || "";
    if (gName && !strictNameMatch(gName, rName)) return false;
    if (gAddr && !strictAddressMatch(gAddr, rAddr)) return false;
    return true;
  });
  if (strict.length) {
    return strict;
  }
  const groups = /* @__PURE__ */ new Map();
  for (const it of items) {
    const rName = it.restaurantTitle || it.restaurant_name || it.restaurant && it.restaurant.name || "";
    const rAddr = it.restaurantAddress || it.restaurant_address || it.restaurant && it.restaurant.address || "";
    const key = `${rName}||${rAddr}`;
    if (!groups.has(key)) {
      groups.set(key, { name: rName, address: rAddr, items: [] });
    }
    groups.get(key).items.push(it);
  }
  if (!groups.size) {
    return [];
  }
  function nameSimilarity(a, b) {
    const aTokens = nameTokens(a);
    const bTokens = nameTokens(b);
    if (!aTokens.length || !bTokens.length) return 0;
    return tokenSetSimilarity(aTokens, bTokens);
  }
  __name(nameSimilarity, "nameSimilarity");
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
    return intersect / minLen;
  }
  __name(addressSimilarity, "addressSimilarity");
  let bestGroup = null;
  let bestScore = 0;
  for (const [, group] of groups.entries()) {
    const rName = group.name || "";
    const rAddr = group.address || "";
    const nSim = gName ? nameSimilarity(gName, rName) : 0;
    const aSim = gAddr ? addressSimilarity(gAddr, rAddr) : 0;
    const score = nSim * 0.7 + aSim * 0.3;
    if (score > bestScore) {
      bestScore = score;
      bestGroup = group;
    }
  }
  const MIN_SCORE = 0.4;
  if (!bestGroup || bestScore < MIN_SCORE) {
    return [];
  }
  return bestGroup.items || [];
}
__name(filterUberItemsByGoogleContextGateway, "filterUberItemsByGoogleContextGateway");
async function callUberMenuGateway(env, googleContext, opts = {}) {
  const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const key = env.RAPIDAPI_KEY || env.RAPID_API_KEY;
  if (!key) {
    return { ok: false, source: "uber_gateway_menu", error: "Missing RAPIDAPI_KEY" };
  }
  if (!host) {
    return { ok: false, source: "uber_gateway_menu", error: "Missing UBER_RAPID_HOST" };
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
__name(callUberMenuGateway, "callUberMenuGateway");
async function extractMenuGateway(env, { placeId, url, restaurantName, address, lat, lng }) {
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
  const resolvedLat = typeof placeLat === "number" && Number.isFinite(placeLat) ? placeLat : typeof lat === "number" && Number.isFinite(lat) ? lat : null;
  const resolvedLng = typeof placeLng === "number" && Number.isFinite(placeLng) ? placeLng : typeof lng === "number" && Number.isFinite(lng) ? lng : null;
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
  const dishes = (uber.items || []).map((it, idx) => {
    const raw = it.raw || {};
    const imageUrl = it.imageUrl || raw.imageUrl || raw.image_url || raw.image || null;
    return {
      id: `canon-${idx + 1}`,
      name: it.name || `Item ${idx + 1}`,
      description: it.description || "",
      section: it.section || null,
      source: "uber",
      rawPrice: typeof it.price === "number" ? it.price : null,
      priceText: it.price_display || null,
      imageUrl
    };
  });
  const filteredDishes = filterMenuForDisplay(dishes);
  const classified = filteredDishes.map((d) => {
    const category = canonicalCategoryFromSectionAndName(d.section, d.name);
    return { ...d, canonicalCategory: classifyCanonicalCategory({ ...d, canonicalCategory: category }) };
  });
  const withWingOverride = classified.map((it) => {
    const override = classifyWingPlatter(it);
    return {
      ...it,
      canonicalCategory: override || it.canonicalCategory
    };
  });
  const withBowlOverride = withWingOverride.map((it) => {
    const override = classifyBowl(it);
    return {
      ...it,
      canonicalCategory: override || it.canonicalCategory
    };
  });
  const withWrapOverride = withBowlOverride.map((it) => {
    const override = classifyWrapQuesadilla(it);
    return {
      ...it,
      canonicalCategory: override || it.canonicalCategory
    };
  });
  const withSectionRemap = withWrapOverride.map((it) => {
    const override = classifyBySectionFallback(it);
    return {
      ...it,
      canonicalCategory: override || it.canonicalCategory
    };
  });
  const withLLM = env.MENU_CLASSIFIER_CACHE && env.AI ? await applyLLMClassification(env, withSectionRemap) : withSectionRemap;
  const hardFilteredLLM = normalizeWrapsAndSaladBowls(
    applyLLMOverrides(withLLM)
  ).filter(
    (it) => !hardBlockItem(it.name, it.description)
  );
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
__name(extractMenuGateway, "extractMenuGateway");
function pickBestRestaurant({ rows, query, googleContext }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (googleContext) {
    const strictMatches = rows.filter(
      (r) => passesStrictRestaurantMatch(
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
  }
  function scoreRow(row) {
    const name = (row.title || row.sanitizedTitle || row.name || "").toLowerCase();
    const q = (query || "").toLowerCase();
    if (!name || !q) return 0;
    if (name === q) return 100;
    if (name.startsWith(q)) return 90;
    if (name.includes(q)) return 80;
    const nameTokens2 = name.split(/\s+/);
    const qTokens = q.split(/\s+/);
    const nSet = new Set(nameTokens2);
    let overlap = 0;
    for (const t of qTokens) {
      if (nSet.has(t)) overlap++;
    }
    const ratio = overlap / Math.max(1, qTokens.length);
    return Math.round(60 * ratio);
  }
  __name(scoreRow, "scoreRow");
  const scored = rows.map((r) => ({
    row: r,
    score: scoreRow(r)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0] ? scored[0].row : null;
}
__name(pickBestRestaurant, "pickBestRestaurant");
function explainRestaurantChoices({ rows, query, limit = 10 }) {
  const q = (query || "").trim().toLowerCase();
  function norm(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N}\s&'-]/gu, "").trim();
  }
  __name(norm, "norm");
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
  __name(scoreRow, "scoreRow");
  const explained = (Array.isArray(rows) ? rows : []).map((r) => {
    const s = scoreRow(r);
    return {
      title: r?.title || r?.name || r?.displayName || r?.storeName || "",
      region: r?.region || r?.location?.region || null,
      city: r?.city || r?.location?.city || null,
      url: r?.url || null,
      score: s.score,
      match_kind: s.kind,
      ...s.overlap != null ? { overlap: s.overlap, tokens: s.denom } : {}
    };
  });
  explained.sort((a, b) => b.score - a.score);
  const top = explained.slice(0, Math.max(1, limit));
  const winner = top[0] || null;
  return { winner, top };
}
__name(explainRestaurantChoices, "explainRestaurantChoices");
var _worker_impl = {
  // ---- HTTP routes (health + debug + enqueue + results + uber-test) ----
  fetch: /* @__PURE__ */ __name(async (request, env, ctx) => {
    const url = new URL(request.url);
    try {
      const bodyPreview = request.method === "POST" ? (await request.clone().text()).slice(0, 300) : "";
      const logPayload = JSON.stringify({
        ts: Date.now(),
        method: request.method,
        path: url.pathname,
        user_id: url.searchParams.get("user_id") || null,
        correlation_id: request.headers.get("x-correlation-id") || crypto.randomUUID(),
        preview: bodyPreview
      });
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
      const { status, result } = await runDishAnalysis(env, ctx, request);
      return okJson(result, status);
    }
    if (pathname === "/pipeline/analyze-dish/card" && request.method === "POST") {
      const { status, result } = await runDishAnalysis(env, ctx, request);
      if (status !== 200) return okJson(result, status);
      const body = await readJsonSafe(request) || {};
      const card2 = {
        apiVersion: result.apiVersion || "v1",
        dishName: result.dishName || body?.dishName || body?.dish || null,
        restaurantName: result.restaurantName || body?.restaurantName || body?.restaurant || null,
        summary: result.summary || null
      };
      return okJson(card2, status);
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
    if (pathname === "/debug/brain-health" && request.method === "GET") {
      const urlBase = new URL(request.url).origin;
      const results = {};
      results.gateway = {
        ok: true,
        env: env?.ENV || "production",
        built_at: env?.BUILT_AT || "n/a",
        base: urlBase
      };
      const metricsFetch = env.metrics_core?.fetch?.bind(env.metrics_core) || null;
      const metricsUrl = env.METRICS_CORE_URL || "https://tb-metrics-core.internal/debug/whoami";
      results.recipeCoreLegacy = {
        ok: true,
        note: "legacy recipe core demoted; using main gateway only"
      };
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
      const debugUser = (url.searchParams.get("user_id") || "").trim() || "anon";
      const edamam = typeof callEdamamRecipe === "function" ? await callEdamamRecipe(dish, env, { user_id: debugUser }) : { error: "callEdamamRecipe not available" };
      return okJson({ dish, edamam });
    }
    if (pathname === "/debug/edamam-nutrition" && request.method === "POST") {
      const body = await readJsonSafe(request);
      const edamam = typeof callEdamamNutritionAnalyze === "function" ? await callEdamamNutritionAnalyze(
        {
          title: body?.title || "Recipe",
          ingr: Array.isArray(body?.lines) ? body.lines : []
        },
        env
      ) : { error: "callEdamamNutritionAnalyze not available" };
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
      ).bind(userId, limit).all();
      const levelToBar = /* @__PURE__ */ __name((s) => ({
        "High Benefit": 80,
        Benefit: 40,
        Neutral: 0,
        Caution: -40,
        "High Caution": -80
      })[s] ?? 0, "levelToBar");
      const levelToColor = /* @__PURE__ */ __name((s) => ({
        "High Benefit": "#16a34a",
        Benefit: "#22c55e",
        Neutral: "#a1a1aa",
        Caution: "#f59e0b",
        "High Caution": "#dc2626"
      })[s] ?? "#a1a1aa", "levelToColor");
      const barometerToColor = /* @__PURE__ */ __name((n) => n >= 40 ? "#16a34a" : n > 0 ? "#22c55e" : n === 0 ? "#a1a1aa" : n <= -40 ? "#dc2626" : "#f59e0b", "barometerToColor");
      const titleFor = /* @__PURE__ */ __name((key) => {
        if (!key) return "";
        const nice = key.replace(/_/g, " ");
        return nice.charAt(0).toUpperCase() + nice.slice(1);
      }, "titleFor");
      const items = [];
      for (const row of results || []) {
        const organ_levels2 = safeJson(row.organ_levels_json, {});
        const top_drivers = safeJson(row.top_drivers_json, {});
        const organ_bars = Object.fromEntries(
          Object.entries(organ_levels2).map(([k, v]) => [k, levelToBar(v)])
        );
        const organ_colors = Object.fromEntries(
          Object.entries(organ_levels2).map(([k, v]) => [k, levelToColor(v)])
        );
        const tummy = computeBarometerFromLevelsAll(ORGANS, organ_levels2);
        const barometer_color = barometerToColor(tummy);
        const insight_lines = ORGANS.map((key) => {
          if (!organ_levels2[key]) return null;
          const drivers = Array.isArray(top_drivers[key]) ? top_drivers[key] : [];
          if (!drivers.length) return null;
          return `${titleFor(key)}: ${drivers.join(", ")}`;
        }).filter(Boolean).slice(0, 3);
        const dish_summary = `${tummy >= 60 ? "\u{1F7E2}" : tummy >= 40 ? "\u{1F7E1}" : "\u{1F7E0}"} ${insight_lines[0] || "See details"}`;
        const item = {
          id: row.id,
          user_id: row.user_id,
          dish: row.dish,
          ingredients: safeJson(row.ingredients_json, []),
          organ_levels: organ_levels2,
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
        has_ingredients: Array.isArray(test?.ingredients) ? test.ingredients.length : 0
      });
    }
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
      const ctx2 = {
        served_at: (/* @__PURE__ */ new Date()).toISOString(),
        version: getVersion(env)
      };
      const bootAt = await ensureBootTime(env);
      const uptime_seconds = bootAt ? Math.max(0, Math.floor((Date.now() - Date.parse(bootAt)) / 1e3)) : null;
      const body = {
        ok: true,
        version: ctx2.version,
        served_at: ctx2.served_at,
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
        withBodyAnalytics(body, ctx2, rid, { endpoint: "meta" }),
        200,
        { ctx: ctx2, rid, source: "meta", cache: "" }
      );
    }
    if (pathname === "/debug/status") {
      const ctx2 = {
        served_at: (/* @__PURE__ */ new Date()).toISOString(),
        version: getVersion(env)
      };
      const status = await readStatusKV(env) || {
        updated_at: null,
        counts: {}
      };
      const rid = newRequestId();
      const body = withBodyAnalytics({ ok: true, status }, ctx2, rid, {
        endpoint: "debug-status"
      });
      return jsonResponseWithTB(body, 200, {
        ctx: ctx2,
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
        } catch {
        }
        if (payload) {
          const userId = (url.searchParams.get("user_id") || "").trim();
          const rawPrefs = await loadUserPrefs(env, userId);
          const safePrefs = rawPrefs && typeof rawPrefs === "object" ? rawPrefs : { allergens: [], fodmap: {} };
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
    if (pathname === "/debug/rapid") {
      const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
      const key = env.RAPIDAPI_KEY || "";
      let status = 0, text = "", probe;
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
      __name(tryPath, "tryPath");
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
    if (pathname === "/debug/rapid-job") {
      const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
      const key = env.RAPIDAPI_KEY || "";
      const q = searchParams.get("query") || "seafood";
      const addr = searchParams.get("address") || "South Miami, FL, USA";
      const max = Number(searchParams.get("maxRows") || 3);
      const locale = searchParams.get("locale") || "en-US";
      const page = Number(searchParams.get("page") || 1);
      const body = {
        scraper: { maxRows: max, query: q, address: addr, locale, page }
      };
      let status = 0, text = "", js = null;
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
        } catch {
        }
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
      const cursor = searchParams.get("cursor") || void 0;
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
      const url2 = new URL(request.url);
      const placeId = url2.searchParams.get("placeId") || "";
      const urlParam = url2.searchParams.get("url") || "";
      const restaurantName = url2.searchParams.get("restaurantName") || "";
      const address = url2.searchParams.get("address") || "";
      const latParam = url2.searchParams.get("lat");
      const lngParam = url2.searchParams.get("lng");
      const lat = latParam != null ? Number(latParam) : void 0;
      const lng = lngParam != null ? Number(lngParam) : void 0;
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
    if (pathname === "/menu/uber-test" && request.method === "GET") {
      let ctx2 = makeCtx(env);
      let rid = newRequestId();
      let trace = {};
      try {
        let setWarn = function(msg) {
          if (!msg) return;
          _warnMsg = _warnMsg ? `${_warnMsg} ${msg}` : String(msg);
        }, respondTB = function(body, status = 200, opts = {}, extraHeaders = {}) {
          const source = body?.source || opts.source || "";
          const cache = body?.cache || opts.cache || "";
          const warning = Boolean(body?.warning || opts.warning);
          return jsonResponseWithTB(
            body,
            status,
            { ctx: ctx2, rid, source, cache, warning },
            extraHeaders
          );
        };
        __name(setWarn, "setWarn");
        __name(respondTB, "respondTB");
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
        const forceUSFlag = searchParams.get("us") === "1" || looksLikeUSAddress(addressRaw);
        trace = makeTrace("uber-test", searchParams, env);
        let _warnMsg = null;
        const warnPart = /* @__PURE__ */ __name(() => _warnMsg ? { warning: _warnMsg } : {}, "warnPart");
        trace.host = trace.host || env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
        if (searchParams.get("debug") === "ratelimit") {
          const secs = Number(searchParams.get("after") || 42);
          trace.used_path = "debug-ratelimit";
          return rateLimitResponse(ctx2, rid, trace, secs, "debug-ratelimit");
        }
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
            ctx2,
            {
              "X-TB-Source": "input-missing",
              trace: safeTrace(trace)
            },
            rid
          );
        }
        if (lat && !lng || !lat && lng) {
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
            ctx2,
            {
              "X-TB-Source": "input-missing",
              trace: safeTrace(trace)
            },
            rid
          );
        }
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
              ctx2,
              rid,
              trace
            ),
            200
          );
        }
        const cacheKey = cacheKeyForMenu(query, addressRaw, !!forceUSFlag);
        const wantDebugCache = debug === "cache";
        let cacheStatus = "miss";
        let cached = null;
        let cachedItems = null;
        let cacheAgeSec = null;
        try {
          cached = await readMenuFromCache(env, cacheKey);
          cacheAgeSec = null;
          if (cached?.savedAt) {
            cacheAgeSec = Math.max(
              0,
              Math.floor((Date.now() - Date.parse(cached.savedAt)) / 1e3)
            );
          }
          if (cached?.savedAt) {
            const ageSec = Math.max(
              0,
              (Date.now() - Date.parse(cached.savedAt)) / 1e3
            );
            if (ageSec > 20 * 3600)
              setWarn("Cached data is older than ~20 hours (may be stale).");
          }
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
                ctx2,
                rid,
                trace
              ),
              200
            );
          }
          if (cached?.data) {
            cachedItems = Array.isArray(cached.data.items) ? cached.data.items : null;
            if (cachedItems) cacheStatus = "hit";
            if (cachedItems) {
              const flattenedItems2 = cachedItems;
              const wantAnalyze = searchParams.get("analyze") === "1";
              let enqueued2 = [];
              if (flattenedItems2 && wantAnalyze) {
                const top = filterAndRankItems(
                  flattenedItems2,
                  searchParams,
                  env
                );
                const place_id = searchParams.get("place_id") || "place.unknown";
                const cuisine = searchParams.get("cuisine") || "";
                ({ enqueued: enqueued2 } = await enqueueTopItems(env, top, {
                  place_id,
                  cuisine,
                  query,
                  address: addressRaw,
                  forceUS: !!forceUSFlag
                }));
              }
              if (flattenedItems2 && wantAnalyze) {
                const address = addressRaw;
                const forceUS = !!forceUSFlag;
                trace.used_path = "/api/job";
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
                        items: flattenedItems2.slice(0, maxRows)
                      },
                      enqueued: enqueued2,
                      ...warnPart()
                    },
                    ctx2,
                    rid,
                    trace
                  ),
                  200
                );
              }
            }
          }
        } catch (e) {
        }
        if (addressRaw) {
          let address = addressRaw;
          if (forceUSFlag && !/usa|united states/i.test(address))
            address = `${addressRaw}, USA`;
          const job = await postJobByAddress(
            { query, address, maxRows, locale, page },
            env
          );
          if (job?.immediate) {
            let rows2 = job.raw?.returnvalue?.data || [];
            const rowsUS2 = filterRowsUS(rows2, forceUSFlag);
            const titles = rowsUS2.map((r) => r?.title).filter(Boolean);
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
                  ctx2,
                  rid,
                  trace
                ),
                200
              );
            }
            if (debug === "1") {
              trace.used_path = "/api/job";
              await bumpStatusKV(env, { debug: 1 });
              const preview = buildDebugPreview(
                job?.raw || {},
                env,
                rowsUS2,
                titles
              );
              return respondTB(
                withBodyAnalytics(preview, ctx2, rid, trace),
                200
              );
            }
            const googleContext2 = {
              name: query,
              address: addressRaw,
              lat: lat ? Number(lat) : null,
              lng: lng ? Number(lng) : null
            };
            const best2 = pickBestRestaurant({
              rows: rowsUS2,
              query,
              googleContext: googleContext2
            });
            const chosen2 = best2 || (Array.isArray(rowsUS2) && rowsUS2.length ? rowsUS2[0] : null);
            if (debug === "why") {
              const exp = explainRestaurantChoices({
                rows: rowsUS2,
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
                  ctx2,
                  rid,
                  trace
                ),
                200
              );
            }
            if (!chosen2) {
              await bumpStatusKV(env, { errors_4xx: 1 });
              return notFoundCandidates(ctx2, rid, trace, {
                query,
                address: addressRaw
              });
            }
            const fake2 = { data: { results: [chosen2] } };
            const flattenedItems3 = extractMenuItemsFromUber(fake2, query);
            const analyze3 = searchParams.get("analyze") === "1";
            let enqueued3 = [];
            if (analyze3 && Array.isArray(flattenedItems3) && flattenedItems3.length) {
              const top = filterAndRankItems(flattenedItems3, searchParams, env);
              const place_id = searchParams.get("place_id") || "place.unknown";
              const cuisine = searchParams.get("cuisine") || "";
              ({ enqueued: enqueued3 } = await enqueueTopItems(env, top, {
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
                items: flattenedItems3
              });
              cacheStatus = "stored";
            } catch (e) {
              cacheStatus = "store-failed";
              setWarn("Could not store fresh cache (non-fatal).");
            }
            trace.used_path = "/api/job";
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
                    items: flattenedItems3.slice(0, maxRows)
                  },
                  enqueued: enqueued3,
                  ...warnPart()
                },
                ctx2,
                rid,
                trace
              ),
              200
            );
          }
          const jobId = job?.job_id;
          if (!jobId) {
            await bumpStatusKV(env, { errors_5xx: 1 });
            return errorResponseWith(
              {
                ok: false,
                error: "Upstream didn\u2019t return a job_id for the address search.",
                hint: "Please try again in a moment. If this keeps happening, try a nearby ZIP code.",
                raw: job
              },
              502,
              ctx2,
              {
                "X-TB-Source": "job-missing-id",
                "X-TB-Upstream-Status": "502",
                trace: safeTrace(trace)
              },
              rid
            );
          }
          const finished = await pollUberJobUntilDone({ jobId, env });
          let rows = finished?.returnvalue?.data || finished?.data?.data || finished?.data || [];
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
          const chosen = best || (Array.isArray(rowsUS) && rowsUS.length ? rowsUS[0] : null);
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
                ctx2,
                rid,
                trace
              ),
              200
            );
          }
          if (!chosen) {
            await bumpStatusKV(env, { errors_4xx: 1 });
            return notFoundCandidates(ctx2, rid, trace, {
              query,
              address: addressRaw
            });
          }
          if (debug === "titles") {
            const titles = (Array.isArray(rowsUS) ? rowsUS : []).map((r) => r?.title).filter(Boolean);
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
                ctx2,
                rid,
                trace
              ),
              200
            );
          }
          if (debug === "1") {
            trace.used_path = "/api/job";
            const titles = (Array.isArray(rowsUS) ? rowsUS : []).map((r) => r?.title).filter(Boolean);
            await bumpStatusKV(env, { debug: 1 });
            const preview = buildDebugPreview(
              finished || {},
              env,
              rowsUS,
              titles
            );
            return respondTB(withBodyAnalytics(preview, ctx2, rid, trace), 200);
          }
          const fake = { data: { results: [chosen] } };
          const flattenedItems2 = extractMenuItemsFromUber(fake, query);
          const analyze2 = searchParams.get("analyze") === "1";
          let enqueued2 = [];
          if (analyze2 && Array.isArray(flattenedItems2) && flattenedItems2.length) {
            const top = filterAndRankItems(flattenedItems2, searchParams, env);
            const place_id = searchParams.get("place_id") || "place.unknown";
            const cuisine = searchParams.get("cuisine") || "";
            ({ enqueued: enqueued2 } = await enqueueTopItems(env, top, {
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
              items: flattenedItems2
            });
            cacheStatus = "stored";
          } catch (e) {
            cacheStatus = "store-failed";
            setWarn("Could not store fresh cache (non-fatal).");
          }
          trace.used_path = "/api/job";
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
                  items: flattenedItems2.slice(0, maxRows)
                },
                enqueued: enqueued2,
                ...warnPart()
              },
              ctx2,
              rid,
              trace
            ),
            200
          );
        }
        if (lat && lng) {
          try {
            const jobRes = await postJobByLocation(
              { query, lat: Number(lat), lng: Number(lng), radius, maxRows },
              env
            );
            if (jobRes?.path) trace.used_path = jobRes.path;
            const jobId = jobRes?.job_id || jobRes?.id || jobRes?.jobId;
            if (!jobId) {
              await bumpStatusKV(env, { errors_5xx: 1 });
              return errorResponseWith(
                {
                  ok: false,
                  error: "Upstream didn\u2019t return a job_id for the location search.",
                  hint: "Please try again shortly. If it keeps failing, widen the radius or include a ZIP.",
                  raw: jobRes
                },
                502,
                ctx2,
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
            const titles = candidates.map((c) => c?.title || c?.name || c?.storeName || c?.displayName).filter(Boolean);
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
                  ctx2,
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
                ctx2,
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
              trace.used_path = nearby?.pathTried || "gps-search";
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
                    ctx2,
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
                    ctx2,
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
                  ctx2,
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
                ctx2,
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
              ctx2,
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
            ctx2,
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
          trace.used_path = trace.used_path || "fetchMenuFromUberEats";
          await bumpStatusKV(env, { debug: 1 });
          const preview = buildDebugPreview(raw || {}, env);
          return respondTB(withBodyAnalytics(preview, ctx2, rid, trace), 200);
        }
        const usedHost = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
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
              ctx2,
              rid,
              trace
            ),
            200,
            {},
            CORS_ALL
          );
        }
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
        if (!trace.used_path) trace.used_path = "fetchMenuFromUberEats";
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
            ctx2,
            rid,
            trace
          ),
          200,
          {},
          CORS_ALL
        );
      } catch (err) {
        const msg = String(err?.message || err || "");
        const m = msg.match(/\b(429|500|502|503|504)\b/);
        const upstreamStatus = m ? Number(m[1]) : 500;
        let retrySecs = 0;
        const mSecs = msg.match(/RETRYABLE_429:(\d+)/);
        if (mSecs) retrySecs = Number(mSecs[1] || 0);
        if (upstreamStatus === 429) {
          await bumpStatusKV(env, { ratelimits_429: 1 });
          return rateLimitResponse(
            ctx2,
            rid,
            trace,
            retrySecs > 0 ? retrySecs : 30,
            "upstream-failure"
          );
        }
        await bumpStatusKV(env, { errors_5xx: 1 });
        const hint = upstreamStatus === 429 ? "Please retry in ~30\u201360 seconds." : "Please try again shortly.";
        return errorResponseWith(
          {
            ok: false,
            error: friendlyUpstreamMessage(upstreamStatus),
            upstream_error: msg.slice(0, 300),
            hint
          },
          upstreamStatus,
          ctx2,
          {
            "X-TB-Source": "upstream-failure",
            "X-TB-Upstream-Status": String(upstreamStatus),
            trace: safeTrace(trace)
          },
          rid
        );
      }
    }
    if (pathname === "/menu/search/examples" && request.method === "GET") {
      const examples = [
        "/menu/search?query=McDonald%27s&address=Miami,%20FL&top=10",
        "/menu/search?query=Starbucks&address=Seattle,%20WA&top=8",
        "/menu/search?query=Chipotle&address=Austin,%20TX&skip_drinks=1&top=12",
        "/menu/search?query=Panera&address=Orlando,%20FL&analyze=1&top=15",
        "/menu/search?query=Chick-fil-A&address=Atlanta,%20GA&top=10",
        "/menu/search?query=Shake%20Shack&address=New%20York,%20NY&skip_party=1&top=10"
      ];
      const ctx2 = {
        served_at: (/* @__PURE__ */ new Date()).toISOString(),
        version: getVersion(env)
      };
      return jsonResponseWith(
        { ok: true, examples, served_at: ctx2.served_at, version: ctx2.version },
        200,
        {
          "X-TB-Version": String(ctx2.version),
          "X-TB-Served-At": String(ctx2.served_at)
        }
      );
    }
    if (pathname === "/menu/search") {
      let respondTB = function(body, status = 200, opts = {}, extraHeaders = {}) {
        const source = body?.source || opts.source || "";
        const cache = body?.cache || opts.cache || "";
        const warning = Boolean(body?.warning || opts.warning);
        return jsonResponseWithTB(
          body,
          status,
          { ctx: ctx2, rid: request_id, source, cache, warning },
          extraHeaders
        );
      };
      __name(respondTB, "respondTB");
      const query = (searchParams.get("query") || "").trim();
      const address = (searchParams.get("address") || "").trim();
      const top = searchParams.get("top") || "";
      const analyze = searchParams.get("analyze") || "";
      const place_id = searchParams.get("place_id") || "";
      const skip_drinks = searchParams.get("skip_drinks") || "";
      const skip_party = searchParams.get("skip_party") || "";
      const ctx2 = makeCtx(env);
      const request_id = newRequestId();
      if (!isNonEmptyString(query) && !isNonEmptyString(address)) {
        return badRequest(
          'Missing "query" and "address".',
          [
            "Example 1: /menu/search?query=McDonald%27s&address=Miami,%20FL",
            "Example 2: /menu/search?query=Starbucks&address=New%20York,%20NY"
          ].join("\n"),
          ctx2,
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
          ctx2,
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
          ctx2,
          null,
          [
            "/menu/search?query=McDonald%27s&address=Miami,%20FL",
            "/menu/search?query=Chick-fil-A&address=Atlanta,%20GA"
          ]
        );
      }
      let inputWarning = null;
      if (!looksLikeCityState(address)) {
        inputWarning = 'Address looks unusual. Try "City, ST" or "City, ST 12345".';
      }
      const hasZip = /\b\d{5}\b/.test(address);
      const hasState = /,\s*[A-Za-z]{2}\b/.test(address);
      if (hasZip && !hasState) {
        return badRequest(
          "Address has a ZIP but no state code (use two-letter state).",
          "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL%2033131",
          ctx2,
          null,
          ["/menu/search?query=McDonald%27s&address=Miami,%20FL%2033131"]
        );
      }
      let address_preview = null;
      if (hasLowercaseState(address)) {
        const fixed = normalizeCityStateAddress(address);
        if (fixed && fixed !== address) {
          address_preview = fixed;
          inputWarning = inputWarning ? `${inputWarning} Also, we adjusted the state code to uppercase in address_preview.` : 'State code looks lowercase; see "address_preview" for the uppercased version.';
        }
      }
      if (analyze && !is01(analyze)) {
        return badRequest(
          'Bad "analyze" value. Use 0 or 1.',
          "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL&analyze=1",
          ctx2,
          null,
          ["/menu/search?query=McDonald%27s&address=Miami,%20FL&analyze=1"]
        );
      }
      if (skip_drinks && !is01(skip_drinks)) {
        return badRequest(
          'Bad "skip_drinks" value. Use 0 or 1.',
          "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL&skip_drinks=1",
          ctx2,
          null,
          ["/menu/search?query=McDonald%27s&address=Miami,%20FL&skip_drinks=1"]
        );
      }
      if (skip_party && !is01(skip_party)) {
        return badRequest(
          'Bad "skip_party" value. Use 0 or 1.',
          "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL&skip_party=1",
          ctx2,
          null,
          ["/menu/search?query=McDonald%27s&address=Miami,%20FL&skip_party=1"]
        );
      }
      if (top) {
        if (!isPositiveInt(top)) {
          return badRequest(
            'Bad "top" value. Must be a whole number.',
            "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL&top=25",
            ctx2,
            null,
            ["/menu/search?query=McDonald%27s&address=Miami,%20FL&top=5"]
          );
        }
        const n = parseInt(top, 10);
        if (n < 1) {
          return badRequest(
            'Out-of-range "top". Minimum is 1.',
            "Example: /menu/search?query=McDonald%27s&address=Miami,%20FL&top=5",
            ctx2,
            null,
            ["/menu/search?query=McDonald%27s&address=Miami,%20FL&top=5"]
          );
        }
        if (n > LIMITS.TOP_MAX) {
          inputWarning = inputWarning ? `${inputWarning} "top" was capped at ${LIMITS.TOP_MAX}.` : `"top" was capped at ${LIMITS.TOP_MAX}.`;
        }
      }
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
      const innerReq = new Request(
        new URL(`/menu/uber-test?${params.toString()}`, url),
        {
          method: "GET",
          headers: { accept: "application/json" }
        }
      );
      const innerRes = await _worker_impl.fetch(innerReq, env, ctx2);
      if (!innerRes || !innerRes.ok) {
        const status = innerRes?.status ?? 502;
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
        const hint = status === 429 ? "Please retry in ~30\u201360 seconds." : "Please try again shortly.";
        return errorResponseWith(
          {
            ok: false,
            error: msg,
            status,
            upstream_error: upstreamError ? String(upstreamError).slice(0, 300) : null,
            hint
          },
          status,
          ctx2,
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
        calories_display: (it.price_display || "").match(/\b\d+\s*Cal/i)?.[0] || null,
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
            ...inputWarning ? { warning: inputWarning } : {},
            ...address_preview ? { address_preview } : {},
            limits: LIMITS
          },
          ctx2,
          request_id,
          trace
        ),
        200
      );
    }
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
        const term = (byCompound || byIngredient).toLowerCase();
        const compRes = await env.D1_DB.prepare(
          `SELECT id, name, common_name, formula, cid, description
           FROM compounds
           WHERE LOWER(name) LIKE ? OR LOWER(common_name) LIKE ?
           ORDER BY name LIMIT 10`
        ).bind(`%${term}%`, `%${term}%`).all();
        const compounds = compRes?.results || [];
        let effects = [];
        if (compounds.length) {
          const ids = compounds.map((c) => c.id);
          const qs = ids.map(() => "?").join(", ");
          const effRes = await env.D1_DB.prepare(
            `SELECT e.compound_id, e.organ, e.effect, e.strength, e.notes,
                    c.name AS compound_name, c.common_name, c.cid
             FROM compound_organ_effects e
             JOIN compounds c ON c.id = e.compound_id
             WHERE e.compound_id IN (${qs})
             ORDER BY c.name, e.organ`
          ).bind(...ids).all();
          effects = effRes?.results || [];
        }
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
        const ingredient = (url.searchParams.get("ingredient") || "").trim().toLowerCase();
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
        const compRes = await env.D1_DB.prepare(
          `SELECT id, name, common_name, formula, cid, description
           FROM compounds
           WHERE LOWER(name) LIKE ? OR LOWER(common_name) LIKE ?
           ORDER BY name LIMIT 15`
        ).bind(`%${ingredient}%`, `%${ingredient}%`).all();
        const compounds = compRes?.results || [];
        const ids = compounds.map((c) => c.id);
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
          ).bind(...ids).all();
          effects = effRes?.results || [];
        }
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
        const organSummary = {};
        for (const [org, list] of Object.entries(organs)) {
          let plus = 0, minus = 0, neutral = 0;
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
        let compRow = null;
        if (cid) {
          const rs = await env.D1_DB.prepare(
            `SELECT id, name, common_name, formula, cid, description
             FROM compounds WHERE cid = ? LIMIT 1`
          ).bind(cid).all();
          compRow = rs?.results?.[0] || null;
        }
        if (!compRow && name) {
          const rsExact = await env.D1_DB.prepare(
            `SELECT id, name, common_name, formula, cid, description
             FROM compounds WHERE LOWER(name) = ? LIMIT 1`
          ).bind(name).all();
          compRow = rsExact?.results?.[0] || null;
          if (!compRow) {
            const rsLike = await env.D1_DB.prepare(
              `SELECT id, name, common_name, formula, cid, description
               FROM compounds WHERE LOWER(name) LIKE ? OR LOWER(common_name) LIKE ? 
               ORDER BY name LIMIT 1`
            ).bind(`%${name}%`, `%${name}%`).all();
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
        const effRes = await env.D1_DB.prepare(
          `SELECT organ, effect, strength, notes
           FROM compound_organ_effects
           WHERE compound_id = ?
           ORDER BY organ`
        ).bind(compRow.id).all();
        const effects = effRes?.results || [];
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
          organ_headlines: ["Gut: \u26A0\uFE0F Risk"]
        },
        molecular_human: {
          organ_tips: [
            "Gut: may bother sensitive tummies\u2014consider smaller portions or swaps."
          ]
        },
        molecular_badge: "Molecular Insights: 2 compounds \u2022 1 organ"
      };
      const InsightsFeed = {
        ok: true,
        component: "InsightsFeed",
        version: "v1",
        period: { range: "last_7_days" },
        generated_at: (/* @__PURE__ */ new Date()).toISOString(),
        items: [
          {
            organ: "heart",
            icon: "\u2764\uFE0F",
            headline: "Heart: \u{1F44D} Benefit",
            tip: "Generally friendly in normal portions.",
            sentiment: "Supportive"
          },
          {
            organ: "gut",
            icon: "\u{1F9A0}",
            headline: "Gut: \u26A0\uFE0F Risk",
            tip: "May bother sensitive tummies\u2014consider smaller portions or swaps.",
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
        heart: "\u2764\uFE0F",
        gut: "\u{1F9A0}",
        liver: "\u{1F9EA}",
        brain: "\u{1F9E0}",
        immune: "\u{1F6E1}\uFE0F"
      };
      const userId = (url.searchParams.get("user_id") || "").trim();
      const userPrefsRaw = await loadUserPrefs(env, userId);
      const userPrefs = userPrefsRaw && typeof userPrefsRaw === "object" ? userPrefsRaw : { allergens: [], fodmap: {} };
      const liveItems = [];
      let next_cursor = null;
      const limitR2 = Math.max(
        1,
        Math.min(50, parseInt(url.searchParams.get("r2_limit") || "10", 10))
      );
      if (env.R2_BUCKET) {
        const r2Cursor = url.searchParams.get("r2_cursor") || void 0;
        const listing = await env.R2_BUCKET.list({
          prefix: "results/",
          limit: Math.max(limitR2, 25),
          cursor: r2Cursor
        });
        const objs = (listing.objects || []).map((o) => ({
          key: o.key,
          uploaded: o.uploaded ? new Date(o.uploaded).getTime() : 0
        })).sort((a, b) => b.uploaded - a.uploaded).slice(0, limitR2);
        for (const obj of objs) {
          const r = await env.R2_BUCKET.get(obj.key);
          if (!r) continue;
          try {
            const js = JSON.parse(await r.text());
            const out = js;
            const tb = js?.tummy_barometer || {};
            const rawLabel = (tb.label || "Unknown").toLowerCase();
            const sentiment = rawLabel === "avoid" ? "Avoid" : rawLabel === "caution" ? "Caution" : rawLabel === "mixed" ? "Mixed" : rawLabel === "likely ok" ? "Supportive" : "Unknown";
            const icon = sentiment === "Avoid" ? "\u26A0\uFE0F" : sentiment === "Caution" ? "\u26A0\uFE0F" : sentiment === "Mixed" ? "\u2194\uFE0F" : sentiment === "Supportive" ? "\u2764\uFE0F" : "\u{1F9EC}";
            const flags = js?.flags || {};
            let organ = "gut";
            if (flags.cardiac_hint) organ = "heart";
            else if (flags.neuro_hint) organ = "brain";
            else if (flags.hepatic_hint) organ = "liver";
            else if (flags.immune_hint) organ = "immune";
            const tip = sentiment === "Avoid" ? "May bother sensitive tummies\u2014consider smaller portions or swaps." : sentiment === "Caution" ? "Moderate risk\u2014portion size matters." : "Generally friendly in normal portions.";
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
      const seen = /* @__PURE__ */ new Set();
      const liveItemsDedup = [];
      for (const it of liveItems) {
        const key = `${it.place_id || "unknown"}|${(it.dish_name || "").toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        liveItemsDedup.push(it);
      }
      const liveSourceItems = liveItemsDedup.length ? liveItemsDedup : liveItems;
      const staticItems = [
        {
          organ: "gut",
          icon: ORG_ICON.gut,
          headline: "Gut: \u26A0\uFE0F Risk",
          tip: "May bother sensitive tummies\u2014consider smaller portions or swaps.",
          sentiment: "Caution"
        }
      ];
      const source = (url.searchParams.get("source") || "auto").toLowerCase();
      const items = source === "live" ? liveSourceItems : source === "static" ? staticItems : liveSourceItems.length ? liveSourceItems : staticItems;
      const limit = Math.max(
        1,
        Math.min(10, parseInt(url.searchParams.get("limit") || "5", 10))
      );
      const p = (url.searchParams.get("period") || "").toLowerCase().trim();
      const ALLOWED = /* @__PURE__ */ new Set(["last_7_days", "last_30_days", "all_time"]);
      const period = ALLOWED.has(p) ? p : "last_7_days";
      const organParam = (url.searchParams.get("organ") || "").toLowerCase().trim();
      const filtered = organParam ? items.filter((it) => (it.organ || "").toLowerCase() === organParam) : items;
      const ORDER = {
        Supportive: 1,
        Mixed: 2,
        Caution: 3,
        Avoid: 4,
        Unknown: 0
      };
      const minParam = (url.searchParams.get("min_sentiment") || "").toLowerCase();
      const MIN = { supportive: 1, mixed: 2, caution: 3, avoid: 4 }[minParam] ?? 0;
      const filteredItems = filtered.filter(
        (it) => (ORDER[it.sentiment] || 0) >= MIN
      );
      const sliced = filteredItems.slice(0, limit);
      const body = {
        ok: true,
        component: "InsightsFeed",
        version: "v1",
        period: { range: period },
        generated_at: (/* @__PURE__ */ new Date()).toISOString(),
        items: sliced,
        badge: `This week: ${sliced.length} insights`,
        ...organParam ? { filter: { organ: organParam } } : {},
        user_prefs: userPrefs
      };
      body.r2_next_cursor = next_cursor;
      const summary_counts = { Supportive: 0, Mixed: 0, Caution: 0, Avoid: 0 };
      for (const it of sliced) {
        if (summary_counts[it.sentiment] != null)
          summary_counts[it.sentiment]++;
      }
      body.summary_counts = summary_counts;
      const humanHeadline = period === "last_7_days" ? "Your recent wellness snapshot" : period === "last_30_days" ? "Monthly wellness summary" : "All-time molecular insights";
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
        note: okR2 ? "Live Insights pulling from R2 results." : "Static Insights mode (no R2 bucket bound)."
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
      const key = url.searchParams.get("key") || "results/0032d323-560f-469f-a496-195812a9efd4.json";
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
        } catch {
        }
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
    if (pathname === "/debug/zestful") {
      const dish = url.searchParams.get("dish") || "Chicken Alfredo";
      try {
        const spoon = await spoonacularFetch(env, dish, null, "en");
        const lines = Array.isArray(spoon?.ingredients) ? spoon.ingredients : [];
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
    if (pathname === "/debug/zestful-raw") {
      const dish = url.searchParams.get("dish") || "Chicken Alfredo";
      const host = (env.ZESTFUL_RAPID_HOST || "zestful.p.rapidapi.com").trim();
      try {
        const sp = await spoonacularFetch(env, dish, null, "en");
        const lines = Array.isArray(sp?.ingredients) ? sp.ingredients.slice(0, 10) : [];
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
        } catch {
        }
        return json({
          ok: res.ok,
          status: res.status,
          host,
          lines_in: lines.length,
          body_preview: text.slice(0, 240),
          results_len: Array.isArray(parsed?.results) ? parsed.results.length : null,
          first_result: Array.isArray(parsed?.results) ? parsed.results[0] : null
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
        let finished = null;
        let usedHost = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
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
          finished = job?.immediate ? job : await waitForJob(env, job, { attempts: 6 });
        } else if (latNum != null && lngNum != null) {
          try {
            const job = await postJobByLocation(
              { query, lat: latNum, lng: lngNum, radius, maxRows },
              env
            );
            finished = job?.immediate ? job : await waitForJob(env, job, { attempts: 6 });
          } catch (e) {
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
                      title: r.title || r.name || r.displayName || r.storeName || r.restaurantName || null,
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
        const buckets = [
          finished?.data?.stores,
          finished?.data?.restaurants,
          finished?.stores,
          finished?.restaurants,
          finished?.data
        ].filter(Boolean);
        const candidates = [];
        for (const b of buckets) if (Array.isArray(b)) candidates.push(...b);
        const restaurants = candidates.map((it) => ({
          id: it?.id || it?.storeUuid || it?.storeId || it?.restaurantId || it?.slug || it?.url || null,
          title: it?.title || it?.name || it?.displayName || it?.storeName || it?.restaurantName || null,
          raw: it
        })).filter((x) => x.title);
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
    if (pathname === "/restaurants/find") {
      return handleRestaurantsFindGateway(env, url);
    }
    if (pathname === "/debug/zestful-usage") {
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const key = `zestful:count:${today}`;
      let raw = null;
      if (env.MENUS_CACHE) {
        try {
          raw = await env.MENUS_CACHE.get(key);
        } catch {
        }
      }
      const count = raw ? parseInt(raw, 10) : 0;
      const cap = parseInt(env.ZESTFUL_DAILY_CAP || "0", 10);
      return json({ date: today, count, cap });
    }
    if (pathname === "/organs/assess" && request.method === "POST") {
      const id = _cid(request.headers);
      const body = await readJsonSafe(request) || {};
      const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
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
          prefs: { ...defaults, ...raw || {} }
        });
      }
      if (request.method === "POST") {
        const user_id = url.searchParams.get("user_id") || "anon";
        const body = await request.json().catch(() => ({})) || {};
        const key = `prefs:user:${user_id}`;
        const existing = await env.USER_PREFS_KV.get(key, "json") || {};
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
    return new Response(
      "HELLO \u2014 tb-dish-processor is running.\nTry: GET /health, /debug/ping, /debug/job?id=..., /results/<id>.json, /menu/uber-test;\nPOST /enqueue",
      { status: 200, headers: { "content-type": "text/plain" } }
    );
  }, "fetch")
};
var lc = /* @__PURE__ */ __name((s) => (s ?? "").toLowerCase().normalize("NFKC").trim(), "lc");
async function ensureBootTime(env) {
  if (!env?.MENUS_CACHE) return null;
  try {
    const key = "meta/boot_at";
    let boot = await env.MENUS_CACHE.get(key);
    if (!boot) {
      boot = (/* @__PURE__ */ new Date()).toISOString();
      await env.MENUS_CACHE.put(key, boot, { expirationTtl: 30 * 24 * 3600 });
    }
    return boot;
  } catch {
    return null;
  }
}
__name(ensureBootTime, "ensureBootTime");
function canonicalizeIngredientName(name = "") {
  const s = String(name ?? "").toLowerCase().trim();
  if (s.includes("skim milk") || s.endsWith(" milk") || s === "milk")
    return "milk";
  if (s.includes("parmesan")) return "parmesan cheese";
  if (s.includes("garlic")) return "garlic";
  if (s.includes("onion")) return "onion";
  if (s.includes("butter")) return "butter";
  if (s.includes("heavy cream") || s.includes("whipping cream") || s.includes("cream"))
    return "cream";
  if (s.includes("salt")) return "salt";
  if (s.includes("tomato")) return "tomato";
  if (s.includes("flour") || s.includes("wheat") || s.includes("pasta"))
    return "flour";
  return s;
}
__name(canonicalizeIngredientName, "canonicalizeIngredientName");
var MENU_TTL_SECONDS = 18 * 3600;
var LIMITS = {
  DEFAULT_TOP: 10,
  TOP_MIN: 1,
  TOP_MAX: 25
};
function limitsSnapshot({ maxRows, radius }) {
  const reqMax = Number.isFinite(Number(maxRows)) ? Number(maxRows) : null;
  const reqRad = Number.isFinite(Number(radius)) ? Number(radius) : null;
  const effectiveMax = Number.isFinite(Number(maxRows)) ? Number(maxRows) : 15;
  const effectiveRad = Number.isFinite(Number(radius)) ? Number(radius) : 5e3;
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
      max: 25e3,
      default: 5e3
    },
    cache_ttl_seconds: MENU_TTL_SECONDS
  };
}
__name(limitsSnapshot, "limitsSnapshot");
async function getZestfulCount(env) {
  const kv = env.MENUS_CACHE;
  if (!kv) return 0;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
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
__name(getZestfulCount, "getZestfulCount");
async function incZestfulCount(env, linesCount = 0) {
  if (!linesCount || linesCount <= 0) return 0;
  const kv = env.MENUS_CACHE;
  if (!kv) return 0;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const key = `zestful:count:${today}`;
  let current = 0;
  try {
    current = parseInt(await kv.get(key) || "0", 10) || 0;
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
__name(incZestfulCount, "incZestfulCount");
var RISK = {
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
var clamp01 = /* @__PURE__ */ __name((x) => Math.max(0, Math.min(1, x)), "clamp01");
var toScore = /* @__PURE__ */ __name((raw, maxRaw = RISK.maxRaw) => Math.round(clamp01(raw / maxRaw) * 100), "toScore");
var labelFor = /* @__PURE__ */ __name((score) => score >= 70 ? "Avoid" : score >= 40 ? "Caution" : "Likely OK", "labelFor");
function extractAllergenKeys(hit) {
  return inferAllergensFromClassesTags(hit).map(
    (x) => x.trim().toLowerCase().replace(/\s+/g, "_")
  );
}
__name(extractAllergenKeys, "extractAllergenKeys");
function extractFodmapLevel(hit) {
  return normalizeFodmapValue(hit.fodmap ?? hit.fodmap_level);
}
__name(extractFodmapLevel, "extractFodmapLevel");
function normalizeFodmapValue(v) {
  let lvl = v;
  if (v && typeof v === "object") lvl = v.level ?? v.fodmap_level ?? v.value;
  lvl = String(lvl || "").toLowerCase();
  if (["very_high", "ultra_high", "high"].includes(lvl)) return "high";
  if (["medium", "moderate"].includes(lvl)) return "medium";
  if (["low", "very_low", "trace"].includes(lvl)) return "low";
  return "unknown";
}
__name(normalizeFodmapValue, "normalizeFodmapValue");
function getEdamamHealthLabelsFromRecipe(recipeResult) {
  if (!recipeResult || !recipeResult.out) return [];
  const raw = recipeResult.out.raw || {};
  let labels = raw.healthLabels;
  if (!Array.isArray(labels) && raw.recipe && Array.isArray(raw.recipe.healthLabels)) {
    labels = raw.recipe.healthLabels;
  }
  if (!Array.isArray(labels)) return [];
  return labels.map((l) => (l || "").toString().trim()).filter(Boolean);
}
__name(getEdamamHealthLabelsFromRecipe, "getEdamamHealthLabelsFromRecipe");
function getEdamamFodmapOverrideFromRecipe(recipeResult) {
  if (!recipeResult || !recipeResult.out) return null;
  const raw = recipeResult.out.raw || {};
  let labels = raw.healthLabels;
  if (!Array.isArray(labels) && raw.recipe && Array.isArray(raw.recipe.healthLabels)) {
    labels = raw.recipe.healthLabels;
  }
  if (!Array.isArray(labels) || !labels.length) {
    return null;
  }
  const normalized = labels.map(
    (l) => (l || "").toString().toLowerCase().replace(/[_-]/g, " ").trim()
  ).filter(Boolean);
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
__name(getEdamamFodmapOverrideFromRecipe, "getEdamamFodmapOverrideFromRecipe");
function inferAllergensFromClassesTags(hit) {
  const out = new Set(
    Array.isArray(hit.allergens) ? hit.allergens.map((a) => String(a).toLowerCase()) : []
  );
  const classes = Array.isArray(hit.classes) ? hit.classes.map((x) => String(x).toLowerCase()) : [];
  const tags = Array.isArray(hit.tags) ? hit.tags.map((x) => String(x).toLowerCase()) : [];
  const canon = String(hit.canonical || "").toLowerCase();
  if (classes.includes("dairy") || tags.includes("dairy") || tags.includes("milk") || /milk|cheese|butter|cream|parmesan|mozzarella|yogurt|yoghurt/.test(canon))
    out.add("milk");
  if (classes.includes("gluten") || tags.includes("gluten")) out.add("gluten");
  if (tags.includes("wheat") || /wheat|semolina|breadcrumbs|pasta|flour/.test(canon))
    out.add("wheat");
  if (classes.includes("shellfish") || tags.includes("shellfish"))
    out.add("shellfish");
  if (classes.includes("fish") || tags.includes("fish")) out.add("fish");
  if (classes.includes("soy") || tags.includes("soy")) out.add("soy");
  if (classes.includes("egg") || tags.includes("egg")) out.add("egg");
  if (classes.includes("sesame") || tags.includes("sesame")) out.add("sesame");
  return Array.from(out);
}
__name(inferAllergensFromClassesTags, "inferAllergensFromClassesTags");
function extractLactoseFromHits(hits) {
  if (!Array.isArray(hits) || !hits.length) return null;
  const rank = { high: 3, moderate: 2, medium: 2, low: 1, none: 0, unknown: 0 };
  let bestLevel = null;
  const examples = /* @__PURE__ */ new Set();
  for (const h of hits) {
    const fod = h.fodmap || {};
    const bandRaw = h.lactose_band || fod && fod.lactose_band || "";
    const band = String(bandRaw || "").toLowerCase();
    const drivers = Array.isArray(fod.drivers) ? fod.drivers.map(String) : [];
    const mentionsLactose = drivers.some((d) => d.toLowerCase() === "lactose") || !!band;
    if (!mentionsLactose) continue;
    let lvl = (band || String(fod.level || "")).toLowerCase();
    if (lvl === "very_high" || lvl === "ultra_high") lvl = "high";
    if (lvl === "medium") lvl = "moderate";
    if (!lvl) lvl = "unknown";
    if (!bestLevel || rank[lvl] > rank[bestLevel]) bestLevel = lvl;
    const name = h.canonical || h.term || fod && fod.note || "";
    if (name) examples.add(name);
  }
  if (!bestLevel) return null;
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
__name(extractLactoseFromHits, "extractLactoseFromHits");
function scoreDishFromHits(hits) {
  const safeHits = Array.isArray(hits) ? hits : [];
  const primaryHits = safeHits.filter((h) => {
    const src = String(h?.source || "").toLowerCase();
    if (!src) return true;
    if (src.startsWith("infer:")) return false;
    return true;
  });
  const effectiveHits = primaryHits.length ? primaryHits : safeHits;
  const allergenSet = /* @__PURE__ */ new Set();
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
__name(scoreDishFromHits, "scoreDishFromHits");
function buildHumanSentences(flags, tummy_barometer) {
  const out = [];
  if (Array.isArray(flags?.allergens) && flags.allergens.length) {
    const list = flags.allergens.slice(0, 4).join(", ");
    out.push(`Allergen risk: ${list}.`);
  }
  const f = String(
    flags && flags.fodmap && flags.fodmap.level || flags?.fodmap || "unknown"
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
  const reasons = Array.isArray(tummy_barometer?.reasons) ? tummy_barometer.reasons : [];
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
    return core.endsWith(".") ? core : core + "\u2026";
  });
  return trimmed.slice(0, 4);
}
__name(buildHumanSentences, "buildHumanSentences");
function buildOrganSentences(organsArr = []) {
  const out = [];
  if (!Array.isArray(organsArr) || !organsArr.length) return out;
  for (const o of organsArr) {
    const key = o.organ || "";
    if (!key) continue;
    const organName = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
    const plus = typeof o.plus === "number" ? o.plus : 0;
    const minus = typeof o.minus === "number" ? o.minus : 0;
    const neutral = typeof o.neutral === "number" ? o.neutral : 0;
    const compounds = Array.isArray(o.compounds) ? o.compounds : [];
    const countsText = `benefit: ${plus}, risk: ${minus}, neutral: ${neutral}`;
    const compoundsText = compounds.length ? ` [compounds: ${compounds.join(", ")}]` : "";
    out.push(`${organName}: ${countsText}${compoundsText}.`);
  }
  return out;
}
__name(buildOrganSentences, "buildOrganSentences");
async function getOrganEffectsForIngredients(env, ingredients = []) {
  if (!env?.D1_DB) return { organs: {}, compoundsByOrgan: {} };
  const names = Array.from(
    new Set(
      (ingredients || []).map(
        (ing) => (ing && ing.name ? ing.name : ing && ing.original ? ing.original : ing && ing.text ? ing.text : "").toString().trim().toLowerCase()
      ).filter(Boolean)
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
      ).bind(like, like).all();
      const comps = compRes?.results || [];
      for (const c of comps) {
        const effRes = await env.D1_DB.prepare(
          `SELECT organ, effect, strength
           FROM compound_organ_effects
           WHERE compound_id = ?`
        ).bind(c.id).all();
        const effs = effRes?.results || [];
        for (const e of effs) {
          const organKey = (e.organ || "unknown").toLowerCase().trim();
          if (!organKey) continue;
          if (!organs[organKey]) {
            organs[organKey] = { plus: 0, minus: 0, neutral: 0 };
            compoundsByOrgan[organKey] = /* @__PURE__ */ new Set();
          }
          if (e.effect === "benefit") organs[organKey].plus++;
          else if (e.effect === "risk") organs[organKey].minus++;
          else organs[organKey].neutral++;
          compoundsByOrgan[organKey].add(c.name || c.common_name || name);
        }
      }
    } catch {
    }
  }
  const compoundsByOrganOut = {};
  for (const [org, set] of Object.entries(compoundsByOrgan)) {
    compoundsByOrganOut[org] = Array.from(set);
  }
  return { organs, compoundsByOrgan: compoundsByOrganOut };
}
__name(getOrganEffectsForIngredients, "getOrganEffectsForIngredients");
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
  if (minus > plus) return "Caution";
  if (plus > minus) return "Benefit";
  return "Neutral";
}
__name(organLevelFromCounts, "organLevelFromCounts");
async function assessOrgansLocally(env, { ingredients = [], user_flags = {}, lex_hits = [] }) {
  const hits = Array.isArray(lex_hits) ? lex_hits : [];
  const scoring = scoreDishFromHits(hits);
  const baseFlags = deriveFlags(hits);
  const lactoseInfo = extractLactoseFromHits(hits);
  const fodmapLevel = scoring.flags?.fodmap || "unknown";
  const organsFlags = {
    ...baseFlags,
    allergens: Array.isArray(scoring.flags?.allergens) ? scoring.flags.allergens : [],
    fodmap: {
      level: fodmapLevel,
      reason: `FODMAP level ${fodmapLevel} inferred from classifier hits.`,
      source: "classifier"
    },
    ...lactoseInfo ? { lactose: lactoseInfo } : {}
  };
  let organGraph = { organs: {}, compoundsByOrgan: {} };
  try {
    organGraph = await getOrganEffectsForIngredients(env, ingredients);
  } catch {
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
__name(assessOrgansLocally, "assessOrgansLocally");
function deriveFlags(hits) {
  let onion = false, garlic = false, dairy_hint = false, gluten_hint = false;
  for (const h of hits) {
    const canon = lc(h.canonical || "");
    const term = lc(h.term || "");
    const classes = Array.isArray(h.classes) ? h.classes.map(lc) : [];
    const tags = Array.isArray(h.tags) ? h.tags.map(lc) : [];
    if (canon.includes("onion") || term.includes("onion") || classes.includes("allium") || tags.includes("onion"))
      onion = true;
    if (canon.includes("garlic") || term.includes("garlic") || classes.includes("allium") || tags.includes("garlic"))
      garlic = true;
    if (classes.includes("dairy") || tags.includes("dairy") || tags.includes("milk") || canon.includes("milk") || canon.includes("cheese") || canon.includes("butter") || canon.includes("cream") || term.includes("milk") || term.includes("cheese") || term.includes("butter") || term.includes("cream"))
      dairy_hint = true;
    if (classes.includes("gluten") || tags.includes("gluten") || tags.includes("wheat") || canon.includes("gluten") || canon.includes("wheat") || canon.includes("flour") || canon.includes("pasta") || canon.includes("breadcrumbs") || canon.includes("semolina") || term.includes("wheat") || term.includes("flour") || term.includes("pasta") || term.includes("breadcrumbs") || term.includes("semolina"))
      gluten_hint = true;
  }
  return { onion, garlic, dairy_hint, gluten_hint };
}
__name(deriveFlags, "deriveFlags");
async function rateLimit(env, request, { limit = 60 } = {}) {
  const kv = env?.USER_PREFS_KV;
  if (!kv || !request) return null;
  try {
    const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
    const now = /* @__PURE__ */ new Date();
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
__name(rateLimit, "rateLimit");
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
    ts: Math.floor(Date.now() / 1e3)
  });
}
__name(handleHealthz, "handleHealthz");
var METRICS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS metrics (
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
__name(ensureMetricsTable, "ensureMetricsTable");
ensureMetricsTable._ready = false;
async function recordMetric(env, name, delta = 1) {
  if (!env?.D1_DB || !name) return;
  const ready = await ensureMetricsTable(env);
  if (!ready) return;
  try {
    await env.D1_DB.prepare("INSERT INTO metrics (name, value) VALUES (?, ?)").bind(name, delta).run();
  } catch (err) {
    console.warn("[metrics] write failed", err?.message || err);
  }
}
__name(recordMetric, "recordMetric");
var STATUS_KV_KEY = "meta/uber_test_status_v1";
async function readStatusKV(env) {
  if (!env?.MENUS_CACHE) return null;
  try {
    const raw = await env.MENUS_CACHE.get(STATUS_KV_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
__name(readStatusKV, "readStatusKV");
async function bumpStatusKV(env, delta = {}) {
  if (!env?.MENUS_CACHE) return;
  try {
    const cur = await readStatusKV(env) || {
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
    cur.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await env.MENUS_CACHE.put(STATUS_KV_KEY, JSON.stringify(cur), {
      expirationTtl: 7 * 24 * 3600
    });
  } catch {
  }
}
__name(bumpStatusKV, "bumpStatusKV");
function cacheKeyForMenu(query, address, forceUS = false) {
  const q = String(query || "").trim().toLowerCase();
  const a = String(address || "").trim().toLowerCase();
  const u = forceUS ? "us1" : "us0";
  return `menu/${encodeURIComponent(q)}|${encodeURIComponent(a)}|${u}.json`;
}
__name(cacheKeyForMenu, "cacheKeyForMenu");
async function readMenuFromCache(env, key) {
  if (!env?.MENUS_CACHE) return null;
  try {
    const raw = await env.MENUS_CACHE.get(key);
    if (!raw) return null;
    const js = JSON.parse(raw);
    if (!js || typeof js !== "object" || !js.data) return null;
    return js;
  } catch {
    return null;
  }
}
__name(readMenuFromCache, "readMenuFromCache");
async function writeMenuToCache(env, key, data) {
  if (!env?.MENUS_CACHE) return false;
  try {
    const body = JSON.stringify({ savedAt: (/* @__PURE__ */ new Date()).toISOString(), data });
    await env.MENUS_CACHE.put(key, body, { expirationTtl: MENU_TTL_SECONDS });
    return true;
  } catch {
    return false;
  }
}
__name(writeMenuToCache, "writeMenuToCache");
async function runDishAnalysis(env, ctx, request) {
  const correlationId = _cid(request.headers);
  const body = await readJsonSafe(request) || {};
  const lang = body.lang || body.language || "en";
  const dishName = (body.dishName || body.dish || "").trim();
  const restaurantName = (body.restaurantName || body.restaurant || "").trim();
  const menuDescription = (body.menuDescription || body.description || body.dishDescription || "").trim();
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
    forceReanalyze: body.force_reanalyze === true || body.forceReanalyze === true || body.force_reanalyze === 1,
    classify: true,
    shape: "recipe_card",
    providersOverride: Array.isArray(body.providers) ? body.providers.map((p) => String(p || "").toLowerCase()) : null,
    parse: true,
    userId: body.user_id || body.userId || "",
    devFlag: body.dev === true || body.dev === 1 || body.dev === "1"
  });
  const nutritionSummaryFromRecipe = recipeResult && recipeResult.out && recipeResult.out.nutrition_summary || recipeResult.nutrition_summary || null;
  let finalNutritionSummary = nutritionSummaryFromRecipe || null;
  if (!finalNutritionSummary && recipeResult && recipeResult.out && recipeResult.out.raw && recipeResult.out.raw.totalNutrients) {
    try {
      const ns = nutritionSummaryFromEdamamTotalNutrients(
        recipeResult.out.raw.totalNutrients
      );
      if (ns) {
        finalNutritionSummary = ns;
        if (recipeResult.out) {
          recipeResult.out.nutrition_summary = ns;
        }
      }
    } catch {
    }
  }
  if (!finalNutritionSummary && recipeResult && recipeResult.out && recipeResult.out.raw && recipeResult.out.raw.totalNutrients) {
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
      if (recipeResult.out) {
        recipeResult.out.nutrition_summary = finalNutritionSummary;
      }
    } catch {
    }
  }
  const ingredientsParsed = recipeResult?.out && Array.isArray(recipeResult.out.ingredients_parsed) ? recipeResult.out.ingredients_parsed : Array.isArray(recipeResult?.parsed) ? recipeResult.parsed : null;
  let ingredients = Array.isArray(recipeResult?.ingredients) ? recipeResult.ingredients : [];
  if ((!ingredients || !ingredients.length) && Array.isArray(ingredientsParsed)) {
    ingredients = ingredientsParsed.map((row) => ({
      name: row.name || row.original || "",
      qty: typeof row.qty === "number" ? row.qty : row.qty != null ? Number(row.qty) || null : null,
      unit: row.unit || null,
      comment: row.comment || row.preparation || row.preparationNotes || null
    }));
  }
  if (!finalNutritionSummary) {
    try {
      if (Array.isArray(ingredientsParsed) && ingredientsParsed.length) {
        await enrichWithNutrition(env, ingredientsParsed);
        finalNutritionSummary = sumNutrition(ingredientsParsed);
      }
      if (!finalNutritionSummary && normalized && Array.isArray(normalized.items) && normalized.items.length) {
        await enrichWithNutrition(env, normalized.items);
        finalNutritionSummary = sumNutrition(normalized.items);
      }
      if (finalNutritionSummary && recipeResult?.out) {
        recipeResult.out.nutrition_summary = finalNutritionSummary;
      }
    } catch (e) {
    }
  }
  if (!finalNutritionSummary && recipeResult && recipeResult.out && recipeResult.out.reason === "no_edamam_hits") {
    try {
      const usdaSummary = await resolveNutritionFromUSDA(
        env,
        dishName,
        menuDescription || description || ""
      );
      if (usdaSummary) {
        finalNutritionSummary = usdaSummary;
        if (recipeResult.out) {
          recipeResult.out.nutrition_summary = finalNutritionSummary;
        }
      }
    } catch (e) {
    }
  }
  const normalized = {
    ok: true,
    source: recipeResult?.responseSource || recipeResult?.source || null,
    cache: recipeResult?.cacheHit || recipeResult?.cache || false,
    items: ingredients,
    ingredients_lines: recipeResult?.out && recipeResult.out.ingredients_lines || recipeResult?.ingLines || [],
    ingredients_parsed: recipeResult?.out?.ingredients_parsed || recipeResult?.parsed || null
  };
  const ingredientsForLex = (() => {
    const parsed = Array.isArray(ingredientsParsed) ? ingredientsParsed : [];
    if (parsed.length) {
      return parsed.map((it) => it.name || it.text || it.original || "").filter((s) => s && s.trim().length > 1);
    }
    if (Array.isArray(normalized.items) && normalized.items.length) {
      return normalized.items.map((it) => it.name || it.text || it.original || "").filter((s) => s && s.trim().length > 1);
    }
    if (Array.isArray(normalized.ingredients_lines) && normalized.ingredients_lines.length) {
      return normalized.ingredients_lines.filter(
        (s) => s && s.trim().length > 1
      );
    }
    const parts = [dishName, menuDescription].filter(Boolean).map((s) => s.trim());
    return parts.length ? parts : [];
  })();
  const fatsecretResult = await classifyIngredientsWithFatSecret(
    env,
    ingredientsForLex,
    "en"
  );
  const fatsecretHits = fatsecretResult && fatsecretResult.ok ? fatsecretResult.allIngredientHits || [] : [];
  const inferredTextHits = inferHitsFromText(dishName, menuDescription);
  const inferredIngredientHits = inferHitsFromIngredients(
    Array.isArray(ingredients) && ingredients.length ? ingredients : normalized.items || []
  );
  const combinedHits = [
    ...fatsecretHits,
    ...Array.isArray(inferredTextHits) ? inferredTextHits : [],
    ...Array.isArray(inferredIngredientHits) ? inferredIngredientHits : []
  ];
  const user_flags = body.user_flags || body.userFlags || {};
  const menuSection = body.menuSection || body.section || "";
  let allergen_flags = [];
  let fodmap_flags = null;
  let lactose_flags = null;
  let allergenMiniDebug = null;
  let allergen_lifestyle_tags = [];
  let allergen_lifestyle_checks = null;
  const allergenEvidenceText = [
    dishName,
    restaurantName,
    menuDescription,
    Array.isArray(body.tags) ? body.tags.join(" ") : "",
    Array.isArray(body.ingredients) ? JSON.stringify(body.ingredients) : ""
  ].join(" ").toLowerCase();
  const hasEvidenceForAllergen = /* @__PURE__ */ __name((kind, text) => {
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
        "camar\xF3n",
        "gambas",
        "mariscos"
      ],
      sesame: ["sesame", "tahini", "ajonjoli"]
    };
    const terms = table[kind] || [];
    return terms.some((w) => t.includes(w));
  }, "hasEvidenceForAllergen");
  const allergenInput = {
    dishName,
    restaurantName,
    menuSection,
    menuDescription,
    ingredients: Array.isArray(ingredients) ? ingredients.map((ing) => {
      if (typeof ing === "string") return { name: ing };
      if (!ing || typeof ing !== "object") return null;
      const name = ing.name || ing.ingredient || ing.text || ing.original || ing.line || "";
      return {
        name,
        normalized: ing.normalized || ing.canonical || void 0,
        quantity: ing.quantity || ing.qty || ing.amount || ing.quantity_str || void 0,
        language: ing.language || ing.lang || void 0
      };
    }).filter((r) => r && r.name) : [],
    tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t || "").trim()).filter(Boolean) : []
  };
  let allergenMiniResult;
  try {
    allergenMiniResult = await runAllergenMiniLLM(env, allergenInput);
  } catch (e) {
    allergenMiniResult = { ok: false, error: String(e?.message || e) };
  }
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
          message = slot.reason && slot.reason.length ? `${slot.reason} (not explicitly listed; marking as maybe)` : "Often contains this allergen, but it is not explicitly listed.";
        }
        allergen_flags.push({
          kind: key,
          present,
          message,
          source: "llm-mini"
        });
      }
    }
    fodmap_flags = data?.fodmap ? {
      level: data.fodmap.level || "unknown",
      reason: data.fodmap.reason || "",
      source: "llm-mini"
    } : null;
    lactose_flags = data?.lactose ? {
      level: data.lactose.level || "unknown",
      reason: data.lactose.reason || "",
      source: "llm-mini"
    } : null;
    allergenMiniDebug = data;
    allergen_lifestyle_tags = Array.isArray(data.lifestyle_tags) ? data.lifestyle_tags : [];
    allergen_lifestyle_checks = data.lifestyle_checks || null;
  } else {
    allergenMiniDebug = allergenMiniResult || null;
  }
  let organs = null;
  let organsLLMDebug = null;
  const llmPayload = {
    dishName,
    restaurantName,
    ingredientLines: normalized?.ingredients_lines || normalized?.lines || [],
    ingredientsNormalized: normalized?.items || ingredients || [],
    existingFlags: {},
    userFlags: user_flags,
    locale: lang
  };
  const organsLLMResult = await runOrgansLLM(env, llmPayload);
  if (organsLLMResult && organsLLMResult.ok && organsLLMResult.data) {
    organs = mapOrgansLLMToOrgansBlock(organsLLMResult.data, null);
    organsLLMDebug = organsLLMResult.data;
  } else {
    organs = {
      ok: false,
      error: organsLLMResult?.error || "organs_llm_failed",
      flags: {},
      organs: [],
      tummy_barometer: {
        score: 0,
        label: "Analysis unavailable"
      }
    };
    organsLLMDebug = organsLLMResult || null;
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
  const summary = (() => {
    if (!organs || !organs.ok) {
      return null;
    }
    const tb = organs.tummy_barometer || {};
    const flags = organs.flags || {};
    const organsList = Array.isArray(organs.organs) ? organs.organs : [];
    const allergenKinds = Array.isArray(flags.allergens) ? flags.allergens.map((a) => {
      if (typeof a === "string") return a;
      if (a && typeof a === "object" && typeof a.kind === "string") {
        return a.kind;
      }
      return null;
    }).filter(Boolean) : [];
    const fodmapReason = Array.isArray(tb.reasons) && tb.reasons.length ? tb.reasons.find((r) => r && r.kind === "fodmap") : null;
    const fodmapLevel = flags.fodmap && flags.fodmap.level || fodmapReason && fodmapReason.level || null;
    const onionGarlic = !!flags.onion || !!flags.garlic || !!flags.onion_garlic;
    return {
      tummyBarometer: {
        score: tb.score ?? null,
        label: tb.label ?? null
      },
      organs: organsList.map((o) => ({
        organ: o.organ ?? null,
        level: o.level ?? null,
        plus: typeof o.plus === "number" ? o.plus : typeof o.counts?.plus === "number" ? o.counts.plus : null,
        minus: typeof o.minus === "number" ? o.minus : typeof o.counts?.minus === "number" ? o.counts.minus : null,
        neutral: typeof o.neutral === "number" ? o.neutral : typeof o.counts?.neutral === "number" ? o.counts.neutral : null,
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
      let organSentences = [];
      if (Array.isArray(organs.organs) && organs.organs.length) {
        organSentences = buildOrganSentences(organs.organs);
      }
      summary.sentences = [...summarySentences, ...organSentences];
    }
  } catch {
  }
  const edamamHealthLabels = getEdamamHealthLabelsFromRecipe(recipeResult);
  if (summary) {
    summary.edamamLabels = edamamHealthLabels;
  }
  const recipe_debug = {
    provider: recipeResult?.out?.provider ?? recipeResult?.source ?? recipeResult?.responseSource ?? null,
    reason: recipeResult?.notes || null,
    card_ingredients: ingredients.length,
    providers_order: providerOrder(env),
    attempts: recipeResult?.attempts ?? []
  };
  let debug = {
    ...organs && organs.debug ? organs.debug : {},
    fatsecret_per_ingredient: fatsecretResult?.perIngredient || [],
    fatsecret_hits: fatsecretHits,
    inferred_text_hits: inferredTextHits,
    inferred_ingredient_hits: inferredIngredientHits,
    recipe_debug,
    fodmap_edamam: edamamFodmap || null,
    edamam_healthLabels: edamamHealthLabels,
    organs_llm_raw: organsLLMDebug || null,
    allergen_llm_raw: allergenMiniDebug || null
  };
  let nutrition_badges = null;
  if (finalNutritionSummary) {
    const n = finalNutritionSummary;
    nutrition_badges = [
      typeof n.energyKcal === "number" ? `${Math.round(n.energyKcal)} kcal` : null,
      typeof n.protein_g === "number" ? `${Math.round(n.protein_g)} g protein` : null,
      typeof n.fat_g === "number" ? `${Math.round(n.fat_g)} g fat` : null,
      typeof n.carbs_g === "number" ? `${Math.round(n.carbs_g)} g carbs` : null,
      typeof n.sodium_mg === "number" ? `${Math.round(n.sodium_mg)} mg sodium` : null
    ].filter(Boolean);
  }
  let nutrition_insights = null;
  if (finalNutritionSummary) {
    try {
      const nutritionInput = {
        dishName,
        restaurantName,
        nutrition_summary: finalNutritionSummary,
        tags: nutrition_badges || []
      };
      nutrition_insights = await runNutritionMiniLLM(env, nutritionInput);
    } catch (e) {
      debug.nutrition_llm_error = String(e?.message || e);
    }
  }
  const result = {
    ok: true,
    apiVersion: "v1",
    source: "pipeline.analyze-dish",
    dishName,
    restaurantName,
    summary,
    recipe: recipeResult,
    normalized,
    organs,
    allergen_flags,
    fodmap_flags,
    lactose_flags,
    lifestyle_tags: allergen_lifestyle_tags,
    lifestyle_checks: allergen_lifestyle_checks,
    nutrition_summary: finalNutritionSummary || null,
    nutrition_badges,
    nutrition_insights,
    debug
  };
  return { status: 200, result };
}
__name(runDishAnalysis, "runDishAnalysis");
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
  if (!res.ok || data && data.ok === false) {
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
__name(fetchFatSecretAllergensViaProxy, "fetchFatSecretAllergensViaProxy");
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
  const allergens = foodAttributes?.allergens && Array.isArray(foodAttributes.allergens.allergen) ? foodAttributes.allergens.allergen : [];
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
  const preferences = foodAttributes?.preferences && Array.isArray(foodAttributes.preferences.preference) ? foodAttributes.preferences.preference : [];
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
__name(mapFatSecretFoodAttributesToLexHits, "mapFatSecretFoodAttributesToLexHits");
async function classifyIngredientsWithFatSecret(env, ingredientsForLex, lang = "en") {
  const ingredientNames = (ingredientsForLex || []).map(
    (ing) => typeof ing === "string" ? ing : ing?.name || ing?.ingredient || ""
  ).filter(Boolean);
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
__name(classifyIngredientsWithFatSecret, "classifyIngredientsWithFatSecret");
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}
__name(jsonResponse, "jsonResponse");
function jsonResponseWith(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders }
  });
}
__name(jsonResponseWith, "jsonResponseWith");
function jsonResponseWithTB(bodyObj, status = 200, { ctx, rid, source = "", cache = "", warning = false } = {}, extraHeaders = {}) {
  const version = ctx?.version || "unknown";
  const served_at = ctx?.served_at || (/* @__PURE__ */ new Date()).toISOString();
  const requestId = rid || crypto?.randomUUID && crypto.randomUUID() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const traceHost = bodyObj?.trace?.host || "";
  const traceUsed = bodyObj?.trace?.used_path || "";
  const base = {
    "content-type": "application/json",
    "X-TB-Version": String(version),
    "X-TB-Served-At": String(served_at),
    "X-TB-Request-Id": String(requestId),
    "X-TB-Source": String(source || ""),
    "X-TB-Cache": String(cache || ""),
    ...traceHost ? { "X-TB-Trace-Host": String(traceHost) } : {},
    ...traceUsed ? { "X-TB-Trace-Used-Path": String(traceUsed) } : {}
  };
  if (warning) base["X-TB-Warning"] = "1";
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: { ...base, ...extraHeaders }
  });
}
__name(jsonResponseWithTB, "jsonResponseWithTB");
function withBodyAnalytics(body, ctx, request_id, trace = {}) {
  return {
    ...body,
    served_at: ctx?.served_at || (/* @__PURE__ */ new Date()).toISOString(),
    version: ctx?.version || "unknown",
    request_id: request_id || crypto?.randomUUID && crypto.randomUUID() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    trace
  };
}
__name(withBodyAnalytics, "withBodyAnalytics");
function errorResponseWith(errBody, status = 400, envOrCtx, meta = {}, request_id = null) {
  const hasCtx = envOrCtx && typeof envOrCtx === "object" && "served_at" in envOrCtx && "version" in envOrCtx;
  const served_at = hasCtx ? envOrCtx.served_at : (/* @__PURE__ */ new Date()).toISOString();
  const version = hasCtx ? envOrCtx.version : getVersion(envOrCtx);
  const rid = request_id || (typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const body = {
    ...errBody,
    served_at,
    version,
    request_id: rid,
    ...meta?.trace ? { trace: meta.trace } : {}
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "X-TB-Version": String(version),
      "X-TB-Served-At": String(served_at),
      "X-TB-Error": "1",
      "X-TB-Request-Id": String(rid),
      ...meta || {}
    }
  });
}
__name(errorResponseWith, "errorResponseWith");
function rateLimitResponse(ctxOrEnv, rid, trace, secs = 30, source = "upstream-failure") {
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
__name(rateLimitResponse, "rateLimitResponse");
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
__name(notFoundCandidates, "notFoundCandidates");
function handleFetch(request, env, ctx) {
  return _worker_impl.fetch(request, env, ctx);
}
__name(handleFetch, "handleFetch");
function handleQueue(batch, env, ctx) {
  return _worker_impl.queue ? _worker_impl.queue(batch, env, ctx) : void 0;
}
__name(handleQueue, "handleQueue");
function handleScheduled(controller, env, ctx) {
  return _worker_impl.scheduled ? _worker_impl.scheduled(controller, env, ctx) : void 0;
}
__name(handleScheduled, "handleScheduled");
function normPathname(u) {
  let p = u.pathname || "/";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}
__name(normPathname, "normPathname");
var index_default = {
  fetch: /* @__PURE__ */ __name(async (request, env, ctx) => {
    const response = await handleFetch(request, env, ctx);
    return withTbWhoamiHeaders(response, env);
  }, "fetch"),
  queue: /* @__PURE__ */ __name(async (batch, env, ctx) => {
    return handleQueue(batch, env, ctx);
  }, "queue"),
  scheduled: /* @__PURE__ */ __name(async (controller, env, ctx) => {
    return handleScheduled(controller, env, ctx);
  }, "scheduled")
};

// ../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-DWgQG7/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = index_default;

// ../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-DWgQG7/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
