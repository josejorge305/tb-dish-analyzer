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
