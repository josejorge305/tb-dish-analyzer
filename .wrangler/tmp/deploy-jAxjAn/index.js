var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

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
function cid(h) {
  return h.get("x-correlation-id") || crypto.randomUUID();
}
__name(cid, "cid");
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
function extractMenuItemsFromUber(raw, queryText = "") {
  const q = (queryText || "").toLowerCase().trim();
  const results = raw?.data?.results && Array.isArray(raw.data.results) && raw.data.results || Array.isArray(raw?.results) && raw.results || Array.isArray(raw?.data?.data?.results) && raw.data.data.results || [];
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
    chosen = bestScore > 0 ? scored.filter((s) => s.score === bestScore).map((s) => s.r) : [scored[0].r];
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
    const out = { ...it };
    out.name = clean(it.name);
    out.section = clean(it.section);
    out.description = clean(it.description);
    out.price_display = clean(it.price_display);
    if (out.calories_display != null)
      out.calories_display = clean(out.calories_display);
    out.restaurant_name = clean(it.restaurant_name);
    if (!(Number.isFinite(out.price) && out.price >= 0)) delete out.price;
    out.source = "uber_eats";
    return out;
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
    return false;
  }
  __name(better, "better");
  const items = [];
  const seen = /* @__PURE__ */ new Map();
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
  __name(addItem, "addItem");
  for (const r of chosen) {
    const restaurantName = r.title || r.sanitizedTitle || r.name || "";
    let sections = [];
    if (Array.isArray(r.menu)) sections = r.menu;
    else if (Array.isArray(r.catalogs)) sections = r.catalogs;
    for (const section of sections) {
      const sectionName = section.catalogName || section.name || "";
      const catalogItems = Array.isArray(section.catalogItems) && section.catalogItems || Array.isArray(section.items) && section.items || [];
      for (const mi of catalogItems)
        addItem(makeItem(mi, sectionName, restaurantName));
    }
    if (Array.isArray(r.featuredItems)) {
      for (const mi of r.featuredItems)
        addItem(makeItem(mi, "Featured", restaurantName));
    }
  }
  return items;
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
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
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
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
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
__name(barometerFromOrgans, "barometerFromOrgans");
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
function normalizeTitle(s = "") {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}
__name(normalizeTitle, "normalizeTitle");
function resultIdForDish(place_id, title) {
  const base = `${(place_id || "").trim()}::${normalizeTitle(title || "")}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash << 5) - hash + base.charCodeAt(i);
    hash |= 0;
  }
  return `dish_${Math.abs(hash)}`;
}
__name(resultIdForDish, "resultIdForDish");
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
__name(maybeReturnCachedResult, "maybeReturnCachedResult");
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
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
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
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
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
  const nameTokens = lowerName.split(/\s+/).filter(Boolean);
  const matchThreshold = lowerName ? nameTokens.length >= 2 ? 4 : 2 : 1;
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
    for (const token of nameTokens) {
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
      else if (userId && env.LEXICON_CACHE) {
        const kvKey = `tier/user:${userId}`;
        const tier = await env.LEXICON_CACHE.get(kvKey);
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
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
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
      const tier = await (env.LEXICON_CACHE ? env.LEXICON_CACHE.get(kvKey) : null);
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
function pickBestRestaurant({ rows, query }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const q = (query || "").trim().toLowerCase();
  function norm(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N}\s&'-]/gu, "").trim();
  }
  __name(norm, "norm");
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
  __name(scoreRow, "scoreRow");
  let best = null;
  for (const r of rows) {
    const s = scoreRow(r);
    if (!best || s > best.score) best = { row: r, score: s };
  }
  return best?.row || null;
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
var INDEX_KV_KEY = "shards/INDEX.json";
var STATIC_INGREDIENT_SHARDS = [
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
__name(refreshShardIndex, "refreshShardIndex");
async function readShardIndexFromKV(env) {
  if (!env.LEXICON_CACHE) return null;
  const raw = await env.LEXICON_CACHE.get(INDEX_KV_KEY);
  if (!raw) return null;
  return parseJsonSafe(raw, null);
}
__name(readShardIndexFromKV, "readShardIndexFromKV");
function pickIngredientShardNamesFromIndex(indexJson) {
  const names = /* @__PURE__ */ new Set();
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
__name(pickIngredientShardNamesFromIndex, "pickIngredientShardNamesFromIndex");
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
      } catch {
      }
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
              } catch {
              }
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
__name(loadIngredientShards, "loadIngredientShards");
function tidyIngredientHits(hits, limit = 25) {
  const byCanon = /* @__PURE__ */ new Map();
  for (const h of hits) {
    const key = lc(h.canonical || h.term || "");
    if (!key) continue;
    const prev = byCanon.get(key);
    if (!prev || scoreHit(h) > scoreHit(prev)) byCanon.set(key, h);
  }
  const out = Array.from(byCanon.values()).sort((a, b) => {
    const sa = scoreHit(a), sb = scoreHit(b);
    if (sb !== sa) return sb - sa;
    const la = (a.term || "").length, lb = (b.term || "").length;
    if (lb !== la) return lb - la;
    return (a.canonical || a.term || "").localeCompare(
      b.canonical || b.term || ""
    );
  });
  return out.slice(0, limit);
}
__name(tidyIngredientHits, "tidyIngredientHits");
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
__name(scoreHit, "scoreHit");
var _worker_impl = {
  // ---- Queue consumer: pulls messages from tb-dish-analysis-queue ----
  async queue(batch, env, ctx) {
    console.log("[QUEUE] handler enter", {
      batchSize: batch && batch.messages && batch.messages.length || 0
    });
    for (const msg of batch.messages) {
      let id = null;
      try {
        const job = typeof msg.body === "string" ? JSON.parse(msg.body) : msg.body;
        const body = job && job.body || job || {};
        const {
          kind,
          user_id,
          dish,
          dish_name,
          ingredients,
          organ_levels: organ_levels2,
          organ_top_drivers,
          tummy_barometer,
          calories_kcal = null,
          created_at
        } = body;
        if (kind === "meal_log") {
          try {
            const dishName2 = dish || dish_name || job?.dish_name || "unknown";
            const userId = user_id || job?.user_id || "UNKNOWN_USER";
            const createdAt = created_at || job?.created_at || (/* @__PURE__ */ new Date()).toISOString();
            const calories = job?.calories_kcal ?? calories_kcal ?? null;
            const organLevelsObj = organ_levels2 || body?.organ_levels || body?.organs_summary && body.organs_summary.levels || job?.organs_summary && job.organs_summary.levels || {};
            const topDriversObj = organ_top_drivers || body?.organ_top_drivers || body?.organs_summary && body.organs_summary.top_drivers || job?.organs_summary && job.organs_summary.top_drivers || {};
            const tummyBarometer = tummy_barometer || body?.tummy_barometer || job?.tummy_barometer || barometerFromOrgans(organLevelsObj);
            const ingredientList = ingredients || body?.ingredients || job?.ingredients || [];
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
            ).bind(
              userId,
              dishName2,
              ingredientsJson,
              organLevelsJson,
              topDriversJson,
              calories,
              createdAt
            ).run();
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
        const venueShard = await getShardFromKV(env, "venue_mitigations");
        const { used_shards, used_shards_meta, entriesAll } = await loadIngredientShards(env);
        if (venueShard.ok) {
          used_shards.push("venue_mitigations");
          used_shards_meta["venue_mitigations"] = {
            version: venueShard.version ?? null,
            entries_len: venueShard.entries.length
          };
        }
        const dishName = lc(job?.dish_name);
        const dishDesc = lc(job?.dish_desc || job?.dish_description || "");
        const cuisine = lc(job?.cuisine || "");
        const ingNames = Array.isArray(job?.ingredients) ? job.ingredients.map((i) => i?.name || "").filter(Boolean).join(" ") : "";
        const corpus = [dishName, dishDesc, cuisine, lc(ingNames)].filter(Boolean).join(" ");
        const ingredient_hits_raw = [];
        const seenCanon = /* @__PURE__ */ new Set();
        if (entriesAll.length > 0) {
          const stoplist = /* @__PURE__ */ new Set([
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
            const classes = Array.isArray(entry?.classes) ? entry.classes.map(lc) : [];
            const tags = Array.isArray(entry?.tags) ? entry.tags.map(lc) : [];
            const weight = typeof entry?.weight === "number" ? entry.weight : void 0;
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
              allergens: Array.isArray(entry?.allergens) ? entry.allergens : void 0,
              fodmap: entry?.fodmap ?? entry?.fodmap_level,
              source: "kv_multi_shards"
            });
          }
        }
        const FALLBACK_TRIGGER = getEnvInt(env, "FALLBACK_TRIGGER_UNDER", 50);
        const fallback_debug = [];
        let ingredient_hits = ingredient_hits_raw.slice();
        const HITS_LIMIT = getEnvInt(env, "HITS_LIMIT", 25);
        ingredient_hits = tidyIngredientHits(ingredient_hits, HITS_LIMIT);
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
        let resolvedHits = [];
        if (lexiconResult?.ok && Array.isArray(lexiconResult?.data?.hits)) {
          resolvedHits = lexiconResult.data.hits.map((h) => ({
            term: h.term,
            canonical: h.canonical,
            classes: Array.isArray(h.classes) ? h.classes : [],
            tags: Array.isArray(h.tags) ? h.tags : [],
            allergens: Array.isArray(h.allergens) ? h.allergens : void 0,
            fodmap: h.fodmap ?? h.fodmap_level
          }));
        } else {
          resolvedHits = (ingredient_hits || []).map((h) => ({
            term: h.term,
            canonical: h.canonical,
            classes: Array.isArray(h.classes) ? h.classes : [],
            tags: Array.isArray(h.tags) ? h.tags : [],
            allergens: Array.isArray(h.allergens) ? h.allergens : void 0,
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
        if (env.LEXICON_CACHE) {
          await env.LEXICON_CACHE.put("last_job_id", id, {
            expirationTtl: 3600
          });
          await env.LEXICON_CACHE.put("last_job_ts", String(Date.now()), {
            expirationTtl: 3600
          });
        }
        if (env.D1_DB) {
          try {
            await env.D1_DB.prepare(
              "INSERT INTO logs (kind, ref, created_at) VALUES (?, ?, ?)"
            ).bind("dish_job", key, Date.now()).run();
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
    if (pathname === "/pipeline/analyze-dish" && request.method === "POST") {
      const body = await readJsonSafe(request) || {};
      let {
        dishName,
        restaurantName,
        userFlags = {},
        menuDescription = null,
        menuSection = null
      } = body || {};
      let forceLLM = false;
      dishName = dishName || body?.dish || body?.title || body?.name || "";
      if (!dishName || typeof dishName !== "string" || !dishName.trim()) {
        return okJson({ ok: false, error: "dishName is required" }, 400);
      }
      const correlationId = request.headers.get("x-correlation-id") || (crypto && crypto.randomUUID ? crypto.randomUUID() : `tb-${Date.now()}`);
      console.log(
        "bindings",
        JSON.stringify({
          recipe_core: !!env.recipe_core,
          recipe_core_fetch: env.recipe_core && typeof env.recipe_core.fetch === "function",
          allergen_organs: !!env.allergen_organs,
          allergen_organs_fetch: env.allergen_organs && typeof env.allergen_organs.fetch === "function",
          ai: !!env.AI
        })
      );
      let originalName = dishName;
      let canonicalDishName = dishName;
      if (!dishName || dishName.trim().length < 3 || /big mac|baconator|cheesy|loaded|signature|special/i.test(dishName)) {
        try {
          const llmRes = await env.AI.run("@cf/meta/llama-3.2-11b-instruct", {
            prompt: `You are helping normalize restaurant menu items into generic dish names 
for recipe databases like Edamam or Spoonacular.

Dish name: "${dishName}"
Menu section: "${menuSection || ""}"
Menu description: "${menuDescription || ""}"

Rewrite this into a generic, descriptive food name that captures the likely key ingredients 
(e.g. "double bacon cheeseburger", "mozzarella pizza with buffalo sauce").

Return ONLY the improved dish name, no explanations.`
          });
          if (llmRes && typeof llmRes === "string" && llmRes.trim().length > 0) {
            canonicalDishName = llmRes.trim();
            console.log("canonicalDishName:", canonicalDishName);
          }
        } catch (err) {
          console.log("Canonicalization failed, using original name.");
          canonicalDishName = dishName;
        }
        forceLLM = true;
      }
      dishName = canonicalDishName;
      const recipeResolveUrl = env.recipe_core ? "https://recipe-core/recipe/resolve" : "https://tb-recipe-core.tummybuddy.workers.dev/recipe/resolve";
      const recipeFetcher = env.recipe_core && typeof env.recipe_core.fetch === "function" ? env.recipe_core.fetch.bind(env.recipe_core) : fetch;
      const recipeResp = await recipeFetcher(recipeResolveUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": correlationId
        },
        body: JSON.stringify({
          title: dishName,
          restaurantName,
          menuDescription,
          menuSection,
          forceLLM
        })
      });
      const recipeText = await recipeResp.text();
      let recipe;
      try {
        recipe = JSON.parse(recipeText);
      } catch (e) {
        recipe = {
          ok: false,
          error: "recipe_core returned non-JSON",
          raw: recipeText
        };
      }
      const ingredientLines = Array.isArray(recipe?.recipe?.ingredients) ? recipe.recipe.ingredients.map(
        (row) => row.text || `${row.qty ?? row.quantity ?? ""} ${row.unit || ""} ${row.name || ""}`.trim()
      ).filter(Boolean) : [];
      const normResp = await recipeFetcher(
        env.recipe_core ? "https://recipe-core/ingredients/normalize" : "https://tb-recipe-core.tummybuddy.workers.dev/ingredients/normalize",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-correlation-id": correlationId
          },
          body: JSON.stringify({ lines: ingredientLines })
        }
      );
      const normText = await normResp.text();
      let normalized;
      try {
        normalized = JSON.parse(normText);
      } catch (e) {
        normalized = {
          ok: false,
          error: "recipe_core.normalize returned non-JSON",
          raw: normText
        };
      }
      let ingredients = [];
      if (normalized && Array.isArray(normalized.items) && normalized.items.length > 0) {
        ingredients = normalized.items.map((row) => ({
          name: row.name || row.original || "",
          qty: row.qty ?? null,
          unit: row.unit || null,
          comment: row.comment || null
        }));
      } else if (Array.isArray(recipe?.recipe?.ingredients)) {
        ingredients = recipe.recipe.ingredients.map((row) => ({
          // Prefer the full text as 'name' so normalizeIngredientsArray picks up
          // things like "wheat burger bun (contains gluten)", "American cheese slices (dairy)".
          name: row.text || row.name || "",
          qty: row.qty ?? row.quantity ?? null,
          unit: row.unit || null,
          comment: row.comment || null
        }));
      } else {
        ingredients = [];
      }
      const ingredientsForLex = (() => {
        if (normalized && Array.isArray(normalized.items) && normalized.items.length) {
          return normalized.items.map((it) => it.name || it.text || it.original || "").filter((s) => !!s && s.trim().length > 1);
        }
        if (recipe && recipe.recipe && Array.isArray(recipe.recipe.ingredients)) {
          return recipe.recipe.ingredients.map((i) => i.name || i.text || "").filter((s) => !!s && s.trim().length > 1);
        }
        const parts = [body.dishName, body.menuDescription].filter(Boolean).map((s) => s.trim());
        return parts.length ? parts : [];
      })();
      const lexPerIngredient = await classifyIngredientsWithLex(
        env,
        ingredientsForLex,
        "en"
      );
      const allIngredientLexHits = lexPerIngredient.allHits || [];
      let lex = null;
      let finalLexHits = [];
      try {
        const lexParts = [];
        if (dishName) lexParts.push(dishName);
        if (menuDescription) lexParts.push(menuDescription);
        if (Array.isArray(recipe?.recipe?.ingredients)) {
          lexParts.push(
            recipe.recipe.ingredients.map((row) => row.text || row.name || "").filter(Boolean).join(", ")
          );
        }
        const lexText = lexParts.filter(Boolean).join(". ");
        if (lexText) {
          lex = await callLexicon(env, lexText, "en");
          const rawHits = Array.isArray(lex?.data?.hits) ? lex.data.hits : [];
          const hits = rawHits.map((h) => ({
            term: h.term,
            canonical: h.canonical,
            classes: Array.isArray(h.classes) ? h.classes : [],
            tags: Array.isArray(h.tags) ? h.tags : [],
            allergens: Array.isArray(h.allergens) ? h.allergens : void 0,
            fodmap: h.fodmap ?? h.fodmap_level,
            lactose_band: h.lactose_band || null,
            milk_source: h.milk_source || null
          }));
          const finalLexHitsLocal = hits;
          finalLexHits = finalLexHitsLocal;
        }
      } catch (e) {
      }
      const blobHits = finalLexHits || [];
      const primaryLexHits = allIngredientLexHits && allIngredientLexHits.length ? allIngredientLexHits : blobHits;
      const allergenUrl = env.allergen_organs ? "https://allergen-organs/organs/assess" : "https://tb-allergen-organs-production.tummybuddy.workers.dev/organs/assess";
      const allergenFetcher = env.allergen_organs && typeof env.allergen_organs.fetch === "function" ? env.allergen_organs.fetch.bind(env.allergen_organs) : fetch;
      const organsResp = await allergenFetcher(allergenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": correlationId
        },
        body: JSON.stringify({
          ingredients,
          user_flags: userFlags,
          lex_hits: primaryLexHits
        })
      });
      const organsText = await organsResp.text();
      let organs;
      try {
        organs = JSON.parse(organsText);
      } catch (e) {
        organs = {
          ok: false,
          error: "allergen_organs returned non-JSON",
          raw: organsText
        };
      }
      try {
        if (!organs || typeof organs !== "object") organs = {};
        if (!organs.flags) organs.flags = {};
        if (!Array.isArray(organs.flags.allergens)) organs.flags.allergens = [];
        if (!organs.debug) organs.debug = {};
        organs.debug.lexicon_raw = lex || null;
        if (lex && lex.ok) {
          const hits = primaryLexHits;
          const scoring = scoreDishFromHits(hits);
          if (scoring.flags && scoring.flags.fodmap) {
            organs.flags.fodmap = {
              level: scoring.flags.fodmap,
              reason: `FODMAP level ${scoring.flags.fodmap} inferred from lexicon.`,
              source: "lexicon"
            };
          }
          const existing = Array.isArray(organs.flags.allergens) ? organs.flags.allergens.slice() : [];
          const existingKinds = new Set(
            existing.map((a) => a && typeof a.kind === "string" ? a.kind : null).filter(Boolean)
          );
          const lexAllergenKinds = Array.isArray(scoring.flags?.allergens) ? scoring.flags.allergens : [];
          for (const k of lexAllergenKinds) {
            const kind = String(k || "").toLowerCase();
            if (!kind || existingKinds.has(kind)) continue;
            existingKinds.add(kind);
            existing.push({
              kind,
              message: `Contains or may contain ${kind} (from lexicon).`,
              source: "lexicon"
            });
          }
          organs.flags.allergens = existing;
          const lactoseInfo = extractLactoseFromHits(hits);
          if (lactoseInfo) {
            organs.flags.lactose = lactoseInfo;
            if (lactoseInfo.level !== "none") {
              const hasMilk = organs.flags.allergens.some(
                (a) => a && a.kind === "milk"
              );
              if (!hasMilk) {
                organs.flags.allergens.push({
                  kind: "milk",
                  message: "Contains or may contain milk/lactose (from lexicon).",
                  source: "lexicon"
                });
              }
            }
          }
        }
      } catch (e) {
        if (!organs.debug) organs.debug = {};
        organs.debug.lexicon_error = String(e?.message || e);
      }
      return okJson(
        {
          ok: true,
          source: "pipeline.analyze-dish",
          dishName,
          restaurantName,
          recipe,
          normalized,
          organs,
          debug: {
            ...organs && organs.debug ? organs.debug : {},
            lex_blob_raw: lex,
            lex_blob_hits: blobHits,
            lex_per_ingredient: lexPerIngredient,
            lex_primary_hits: primaryLexHits
          }
        },
        200
      );
    }
    if (pathname === "/organs/from-dish" && request.method === "GET") {
      const id = _cid(request.headers);
      const init = { method: "GET", headers: new Headers(request.headers) };
      init.headers.set("x-correlation-id", id);
      const res = await env.allergen_organs.fetch(
        new Request(request.url, init)
      );
      const out = new Headers(res.headers);
      out.set("x-correlation-id", id);
      out.set("x-tb-worker", env.WORKER_NAME || "tb-dish-processor-production");
      out.set("x-tb-env", env.ENV || "production");
      out.set("x-tb-git", env.GIT_SHA || "n/a");
      out.set("x-tb-built", env.BUILT_AT || "n/a");
      return new Response(res.body, { status: res.status, headers: out });
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
      const restaurantFetch = env.restaurant_core?.fetch?.bind(env.restaurant_core) || null;
      const recipeFetch = env.recipe_core?.fetch?.bind(env.recipe_core) || null;
      const allergenFetch = env.allergen_organs?.fetch?.bind(env.allergen_organs) || null;
      const metricsFetch = env.metrics_core?.fetch?.bind(env.metrics_core) || null;
      const restaurantUrl = env.RESTAURANT_CORE_URL || "https://tb-restaurant-core.internal/debug/whoami";
      const recipeUrl = env.RECIPE_CORE_URL || "https://tb-recipe-core.internal/debug/whoami";
      const allergenUrl = env.ALLERGEN_ORGANS_URL || "https://tb-allergen-organs.internal/debug/whoami";
      const metricsUrl = env.METRICS_CORE_URL || "https://tb-metrics-core.internal/debug/whoami";
      results.restaurant_core = await callJson(restaurantUrl, {
        fetcher: restaurantFetch
      }).catch((e) => ({
        ok: false,
        error: String(e)
      }));
      results.recipe_core = await callJson(recipeUrl, {
        fetcher: recipeFetch
      }).catch((e) => ({
        ok: false,
        error: String(e)
      }));
      results.allergen_organs = await callJson(allergenUrl, {
        fetcher: allergenFetch
      }).catch((e) => ({
        ok: false,
        error: String(e)
      }));
      results.metrics_core = await callJson(metricsUrl, {
        fetcher: metricsFetch
      }).catch((e) => ({
        ok: false,
        error: String(e)
      }));
      const overallOk = results.gateway.ok && results.restaurant_core.ok && results.recipe_core.ok && results.allergen_organs.ok && results.metrics_core.ok;
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
      const id = env.LEXICON_CACHE ? await env.LEXICON_CACHE.get("last_job_id") : null;
      const ts = env.LEXICON_CACHE ? await env.LEXICON_CACHE.get("last_job_ts") : null;
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
      } catch {
      }
      let bodyB = "";
      try {
        bodyB = typeof tryBearer.text === "function" ? await tryBearer.text() : "";
      } catch {
      }
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
      const list = lc(searchParams.get("names") || "").split(",").map((s) => s.trim()).filter(Boolean);
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
        const url2 = `${base}/v1/shards/${name}`;
        try {
          const r = await fetch(url2, { headers: { "x-api-key": key } });
          if (!r.ok) {
            out.push({ shard: name, url: url2, status: r.status, ok: false });
            continue;
          }
          const text = await r.text();
          const js = parseJsonSafe(text, null);
          const entries_len = Array.isArray(js?.entries) ? js.entries.length : 0;
          if (env.LEXICON_CACHE) {
            await env.LEXICON_CACHE.put(`shards/${name}.json`, text, {
              expirationTtl: 86400
            });
          }
          out.push({
            shard: name,
            url: url2,
            status: 200,
            ok: true,
            entries_len,
            version: js?.version ?? null
          });
        } catch (e) {
          out.push({
            shard: name,
            url: url2,
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
        const names = indexFromKV ? pickIngredientShardNamesFromIndex(indexFromKV) : STATIC_INGREDIENT_SHARDS;
        const base = normalizeBase(env.LEXICON_API_URL);
        const key = env.LEXICON_API_KEY;
        if (!base || !key)
          return jsonResponse(
            { ok: false, error: "Missing LEXICON_API_URL or LEXICON_API_KEY" },
            400
          );
        const warmed = [];
        for (const name of names) {
          const url2 = `${base}/v1/shards/${name}`;
          try {
            const r = await fetch(url2, { headers: { "x-api-key": key } });
            if (!r.ok) {
              warmed.push({ shard: name, url: url2, status: r.status, ok: false });
              continue;
            }
            const text = await r.text();
            const js = parseJsonSafe(text, null);
            const entries_len = Array.isArray(js?.entries) ? js.entries.length : 0;
            if (env.LEXICON_CACHE) {
              await env.LEXICON_CACHE.put(`shards/${name}.json`, text, {
                expirationTtl: 86400
              });
            }
            warmed.push({
              shard: name,
              url: url2,
              status: 200,
              ok: true,
              entries_len,
              version: js?.version ?? null
            });
          } catch (e) {
            warmed.push({
              shard: name,
              url: url2,
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
      const search = url2.search || "";
      const upstreamUrl = "https://tb-restaurant-core.internal/menu/extract" + search;
      const upstreamResp = await env.restaurant_core.fetch(upstreamUrl, {
        method: "GET",
        headers: request.headers
      });
      return upstreamResp;
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
            const best2 = pickBestRestaurant({ rows: rowsUS2, query });
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
          const best = pickBestRestaurant({ rows: rowsUS, query });
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
        const cid2 = (url.searchParams.get("cid") || "").trim();
        const name = (url.searchParams.get("name") || "").trim().toLowerCase();
        if (!cid2 && !name) {
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
        if (cid2) {
          const rs = await env.D1_DB.prepare(
            `SELECT id, name, common_name, formula, cid, description
             FROM compounds WHERE cid = ? LIMIT 1`
          ).bind(cid2).all();
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
        const val = await (env.LEXICON_CACHE ? env.LEXICON_CACHE.get(key) : null);
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
      await env.LEXICON_CACHE.put(key, tier);
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
      const okKV = !!env.LEXICON_CACHE;
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
      const id = cid(request.headers);
      const init = {
        method: request.method,
        headers: new Headers(request.headers)
      };
      init.headers.set("x-correlation-id", id);
      const res = await env.restaurant_core.fetch(
        new Request(request.url, init)
      );
      const out = new Headers(res.headers);
      out.set("x-correlation-id", id);
      out.set("x-tb-worker", env.WORKER_NAME || "tb-dish-processor-production");
      out.set("x-tb-env", env.ENV || "production");
      out.set("x-tb-git", env.GIT_SHA || "n/a");
      out.set("x-tb-built", env.BUILT_AT || "n/a");
      return new Response(res.body, { status: res.status, headers: out });
    }
    if (pathname === "/ingredients/normalize" && request.method === "POST") {
      const id = ((h) => h.get("x-correlation-id") || crypto.randomUUID())(
        request.headers
      );
      const init = {
        method: "POST",
        headers: new Headers(request.headers),
        body: await request.text()
      };
      init.headers.set("x-correlation-id", id);
      const res = await env.recipe_core.fetch(new Request(request.url, init));
      const out = new Headers(res.headers);
      out.set("x-correlation-id", id);
      out.set("x-tb-worker", env.WORKER_NAME || "tb-dish-processor-production");
      out.set("x-tb-env", env.ENV || "production");
      out.set("x-tb-git", env.GIT_SHA || "n/a");
      out.set("x-tb-built", env.BUILT_AT || "n/a");
      return new Response(res.body, { status: res.status, headers: out });
    }
    if (pathname === "/recipe/resolve" && request.method === "POST") {
      const id = ((h) => h.get("x-correlation-id") || crypto.randomUUID())(
        request.headers
      );
      const init = {
        method: "POST",
        headers: new Headers(request.headers),
        body: await request.text()
      };
      init.headers.set("x-correlation-id", id);
      const res = await env.recipe_core.fetch(new Request(request.url, init));
      const out = new Headers(res.headers);
      out.set("x-correlation-id", id);
      out.set("x-tb-worker", env.WORKER_NAME || "tb-dish-processor-production");
      out.set("x-tb-env", env.ENV || "production");
      out.set("x-tb-git", env.GIT_SHA || "n/a");
      out.set("x-tb-built", env.BUILT_AT || "n/a");
      return new Response(res.body, { status: res.status, headers: out });
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
      const init = {
        method: "POST",
        headers: new Headers(request.headers),
        body: await request.text()
      };
      init.headers.set("x-correlation-id", id);
      const res = await env.allergen_organs.fetch(
        new Request(request.url, init)
      );
      const out = new Headers(res.headers);
      out.set("x-correlation-id", id);
      out.set("x-tb-worker", env.WORKER_NAME || "tb-dish-processor-production");
      out.set("x-tb-env", env.ENV || "production");
      out.set("x-tb-git", env.GIT_SHA || "n/a");
      out.set("x-tb-built", env.BUILT_AT || "n/a");
      return new Response(res.body, { status: res.status, headers: out });
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
      "HELLO \u2014 tb-dish-processor is running.\nTry: GET /health, /debug/config, /debug/ping-lexicon, /debug/read-kv-shard?name=..., /debug/warm-lexicon?names=...,\n/debug/refresh-ingredient-shards, /debug/read-index, /debug/job?id=..., /results/<id>.json, /menu/uber-test;\nPOST /enqueue",
      { status: 200, headers: { "content-type": "text/plain" } }
    );
  }
};
var lc = /* @__PURE__ */ __name((s) => (s ?? "").toLowerCase().normalize("NFKC").trim(), "lc");
async function ensureBootTime(env) {
  if (!env?.LEXICON_CACHE) return null;
  try {
    const key = "meta/boot_at";
    let boot = await env.LEXICON_CACHE.get(key);
    if (!boot) {
      boot = (/* @__PURE__ */ new Date()).toISOString();
      await env.LEXICON_CACHE.put(key, boot, { expirationTtl: 30 * 24 * 3600 });
    }
    return boot;
  } catch {
    return null;
  }
}
__name(ensureBootTime, "ensureBootTime");
function parseJsonSafe(raw, fallback) {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
__name(parseJsonSafe, "parseJsonSafe");
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
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
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
  const kv = env.MENUS_CACHE || env.LEXICON_CACHE;
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
__name(getShardFromKV, "getShardFromKV");
function entryTerms(entry) {
  const out = /* @__PURE__ */ new Set();
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
__name(entryTerms, "entryTerms");
function termMatches(corpus, term) {
  const t = lc(term);
  if (t.length < 2) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}\\b`, "i");
  return re.test(corpus);
}
__name(termMatches, "termMatches");
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
    { max: 39, name: "Avoid" },
    { max: 69, name: "Caution" },
    { max: 100, name: "Likely OK" }
  ],
  maxRaw: 100
};
var clamp01 = /* @__PURE__ */ __name((x) => Math.max(0, Math.min(1, x)), "clamp01");
var toScore = /* @__PURE__ */ __name((raw, maxRaw = RISK.maxRaw) => Math.round(clamp01(raw / maxRaw) * 100), "toScore");
var labelFor = /* @__PURE__ */ __name((score) => score <= 39 ? "Avoid" : score <= 69 ? "Caution" : "Likely OK", "labelFor");
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
    reason = "Lactose level inferred from lexicon classification.";
  }
  return {
    level,
    source: "lexicon",
    reason,
    examples: Array.from(examples)
  };
}
__name(extractLactoseFromHits, "extractLactoseFromHits");
function scoreDishFromHits(hits) {
  const allergenSet = /* @__PURE__ */ new Set();
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
__name(scoreDishFromHits, "scoreDishFromHits");
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
function getEnvInt(env, name, defVal) {
  const raw = env && env[name] != null ? String(env[name]).trim() : "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : defVal;
}
__name(getEnvInt, "getEnvInt");
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
function dayStrUTC(d = /* @__PURE__ */ new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
}
__name(dayStrUTC, "dayStrUTC");
async function bumpDaily(env, {
  jobs = 0,
  lex_ok = 0,
  lex_live = 0,
  lex_err = 0,
  rap_ok = 0,
  rap_err = 0
} = {}) {
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
    ).bind(day, jobs, lex_ok, lex_live, lex_err, rap_ok, rap_err).run();
    await recordMetric(env, "d1:daily_stats:upsert_ok");
  } catch (err) {
    await recordMetric(env, "d1:daily_stats:upsert_fail");
    throw err;
  }
}
__name(bumpDaily, "bumpDaily");
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
    ).bind(day, service, calls, ok, err).run();
    await recordMetric(env, "d1:api_usage:upsert_ok");
  } catch (error) {
    await recordMetric(env, "d1:api_usage:upsert_fail");
    throw error;
  }
}
__name(bumpApi, "bumpApi");
var STATUS_KV_KEY = "meta/uber_test_status_v1";
async function readStatusKV(env) {
  if (!env?.LEXICON_CACHE) return null;
  try {
    const raw = await env.LEXICON_CACHE.get(STATUS_KV_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
__name(readStatusKV, "readStatusKV");
async function bumpStatusKV(env, delta = {}) {
  if (!env?.LEXICON_CACHE) return;
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
    await env.LEXICON_CACHE.put(STATUS_KV_KEY, JSON.stringify(cur), {
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
  if (!env?.LEXICON_CACHE) return null;
  try {
    const raw = await env.LEXICON_CACHE.get(key);
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
  if (!env?.LEXICON_CACHE) return false;
  try {
    const body = JSON.stringify({ savedAt: (/* @__PURE__ */ new Date()).toISOString(), data });
    await env.LEXICON_CACHE.put(key, body, { expirationTtl: MENU_TTL_SECONDS });
    return true;
  } catch {
    return false;
  }
}
__name(writeMenuToCache, "writeMenuToCache");
function cleanHost(h) {
  const s = (h || "").trim();
  return s.replace(/\s+/g, "");
}
__name(cleanHost, "cleanHost");
function normalizeBase(u) {
  return (u || "").trim().replace(/\/+$/, "");
}
__name(normalizeBase, "normalizeBase");
function buildLexiconAnalyzeURL(base) {
  const b = normalizeBase(base);
  return `${b}/v1/search`;
}
__name(buildLexiconAnalyzeURL, "buildLexiconAnalyzeURL");
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
__name(callRapid, "callRapid");
async function classifyIngredientsWithLex(env, ingredientsForLex, lang = "en") {
  const perIngredient = [];
  const allHits = [];
  for (const raw of ingredientsForLex) {
    const name = (raw || "").trim();
    if (!name || name.length < 2) continue;
    const res = await callLexicon(env, name, lang);
    const entry = {
      ingredient: name,
      ok: !!(res && res.ok),
      hits: []
    };
    let localHits = [];
    if (res && res.ok && res.data && Array.isArray(res.data.hits)) {
      localHits = res.data.hits;
      entry.hits = localHits;
      allHits.push(...localHits);
    }
    perIngredient.push(entry);
  }
  return { perIngredient, allHits };
}
__name(classifyIngredientsWithLex, "classifyIngredientsWithLex");
async function callLexicon(env, text, lang = "en") {
  const base = normalizeBase(env.LEXICON_API_URL);
  const key = env.LEXICON_API_KEY || env.API_KEY;
  if (!base || !key) {
    throw new Error("LEXICON_API_URL or LEXICON_API_KEY missing");
  }
  if (!text) {
    return { ok: false, reason: "missing-text", data: { hits: [] } };
  }
  const url = `${base}/v1/search`;
  const payload = {
    q: text,
    shard_ids: null,
    // let server choose shards
    include_lists: ["cheeses", "seafood", "animals"]
    // leverage your lactose + allergen lists
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "Accept-Language": lang
    },
    body: JSON.stringify(payload)
  });
  let js = null;
  try {
    js = await res.json();
  } catch {
    js = null;
  }
  if (!res.ok || !js) {
    return {
      ok: false,
      status: res.status,
      reason: "lexicon-search-failed",
      data: { hits: [] }
    };
  }
  const matches = Array.isArray(js.matches) ? js.matches : [];
  const hits = matches.map((m) => {
    const e = m.entry || {};
    const mapsTo = Array.isArray(e.maps_to) ? e.maps_to : [];
    const tags = [];
    for (const t of mapsTo) tags.push(String(t).toLowerCase());
    if (e.category) tags.push(String(e.category).toLowerCase());
    if (m.source) tags.push(String(m.source).toLowerCase());
    const classes = [];
    if (mapsTo.includes("milk")) classes.push("dairy");
    if (mapsTo.includes("shellfish")) classes.push("shellfish");
    if (mapsTo.includes("fish")) classes.push("fish");
    if (mapsTo.includes("wheat") || mapsTo.includes("gluten")) {
      classes.push("gluten");
    }
    return {
      term: e.term || text,
      canonical: e.canonical || null,
      classes,
      tags,
      // Lexicon can optionally add "allergens" later if you extend schema
      allergens: Array.isArray(e.allergens) ? e.allergens : void 0,
      fodmap: e.fodmap ?? e.fodmap_level,
      lactose_band: e.lactose_band || null,
      milk_source: e.milk_source || null
    };
  });
  return {
    ok: true,
    mode: "v1_search",
    data: { hits }
  };
}
__name(callLexicon, "callLexicon");
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
  async fetch(request, env, ctx) {
    const response = await handleFetch(request, env, ctx);
    return withTbWhoamiHeaders(response, env);
  },
  async queue(batch, env, ctx) {
    return handleQueue(batch, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return handleScheduled(controller, env, ctx);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
