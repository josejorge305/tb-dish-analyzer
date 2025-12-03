async function handleFetch(request, env, ctx) {
  console.log("BINDINGS CHECK", {
    has_recipe_core: !!env.recipe_core,
    has_allergen_organs: !!env.allergen_organs,
    env_keys: Object.keys(env),
  });

  console.log("GATEWAY FETCH", {
    url: request.url,
    method: request.method,
  });

  const url = new URL(request.url);
  const pathname = url.pathname;
  const correlationId =
    request.headers.get("x-correlation-id") || crypto.randomUUID();

  // Health check
  if (pathname === "/healthz") {
    return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
      headers: { "content-type": "application/json" },
    });
  }

  // --- PIPELINE: /pipeline/analyze-dish ---
  if (pathname === "/pipeline/analyze-dish" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const {
      dishName,
      restaurantName,
      userFlags = {},
      menuDescription = null,
      menuSection = null,
      forceLLM = false,
    } = body || {};

    // STEP 1 — RECIPE
    const recipeResp = await env.recipe_core.fetch("https://recipe-core/recipe/resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({
        title: dishName,
        restaurantName,
        menuDescription,
        menuSection,
        forceLLM,
      }),
    });
    const recipe = await safeJson(recipeResp);

    // STEP 2 — NORMALIZE
    const ingredientLines = Array.isArray(recipe?.recipe?.ingredients)
      ? recipe.recipe.ingredients
          .map((i) => i.text || `${i.qty ?? ""} ${i.unit ?? ""} ${i.name ?? ""}`.trim())
          .filter(Boolean)
      : [];

    const normResp = await env.recipe_core.fetch("https://recipe-core/ingredients/normalize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({ lines: ingredientLines }),
    });
    const normalized = await safeJson(normResp);

    // STEP 3 — ORGANS
    const ingredients = Array.isArray(normalized?.items)
      ? normalized.items.map((row) => ({
          name: row.name || row.original || "",
          qty: row.qty ?? null,
          unit: row.unit || null,
          comment: row.comment || null,
        }))
      : [];

    const organsResp = await env.allergen_organs.fetch("https://allergen-organs/organs/assess", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({
        ingredients,
        user_flags: userFlags,
      }),
    });
    let organs = await safeJson(organsResp);

    // --- LEXICON ENRICHMENT (allergens + FODMAP) ---
    try {
      const lexiconTextParts = [];
      if (dishName) lexiconTextParts.push(dishName);
      if (menuDescription) lexiconTextParts.push(menuDescription);
      if (Array.isArray(recipe?.recipe?.ingredients)) {
        lexiconTextParts.push(
          recipe.recipe.ingredients
            .map((i) => i.text || i.name || "")
            .filter(Boolean)
            .join(", ")
        );
      }
      const lexiconText = lexiconTextParts.filter(Boolean).join(". ");

      if (lexiconText) {
        let lex = null;
        try {
          console.log("LEXICON_DEBUG_START", {
            correlationId,
            snippet: lexiconText?.slice ? lexiconText.slice(0, 200) : null,
          });
          lex = await callLexicon(env, lexiconText, "en");
          console.log("LEXICON_DEBUG_RESULT", {
            correlationId,
            ok: lex?.ok,
            mode: lex?.mode,
            sampleHit: Array.isArray(lex?.data?.hits) ? lex.data.hits[0] : null,
          });
        } catch (e) {
          console.log("LEXICON_DEBUG_ERROR", {
            correlationId,
            error: e?.message || String(e),
          });
          lex = null;
        }

        try {
          if (!organs.debug) organs.debug = {};
          organs.debug.lexicon_raw = lex;
        } catch (_) {
          // ignore
        }

        if (lex?.ok) {
          organs = organs || {};
          if (!organs.flags) organs.flags = {};
          if (!Array.isArray(organs.flags.allergens)) organs.flags.allergens = [];

          // ----------------------------
          // FODMAP from lexicon
          // ----------------------------
          const lexFodmap = extractFodmap(lex);
          if (lexFodmap) {
            organs.flags.fodmap = lexFodmap;
          }

          // ----------------------------
          // ALLERGENS from lexicon
          // ----------------------------
          const lexAllergens = extractAllergens(lex);
          if (lexAllergens.length > 0) {
            const existing = new Set(organs.flags.allergens.map(a => a.kind));
            for (const a of lexAllergens) {
              if (!existing.has(a.kind)) {
                existing.add(a.kind);
                organs.flags.allergens.push(a);
              }
            }
          }

          // ----------------------------
          // LACTOSE from lexicon
          // ----------------------------
          const lexLactose = extractLactose(lex);
          if (lexLactose) {
            organs.flags.lactose = lexLactose;

            if (lexLactose.level !== "none") {
              const existsMilk =
                organs.flags.allergens.some(a => a.kind === "milk");
              if (!existsMilk) {
                organs.flags.allergens.push({
                  kind: "milk",
                  message: "Contains or may contain milk/lactose (lexicon)",
                  source: "lexicon",
                });
              }
            }
          }

          organs.lexicon = {
            mode: lex.mode,
            data: lex.data,
          };
        }
      }
    } catch (e) {
      console.log("lexicon enrichment error", String(e));
    }

    return json({
      ok: true,
      source: "pipeline.analyze-dish",
      dishName,
      restaurantName,
      recipe,
      normalized,
      organs,
      lexicon_debug: organs?.debug?.lexicon_raw ?? null,
    });
  }

  return json({ ok: false, error: "Not found" }, 404);
}

async function handleQueue(batch, env, ctx) {
  // required queue consumer for ANALYSIS_QUEUE
  for (const msg of batch.messages) {
    // no-op ack
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function safeJson(resp) {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid JSON", raw: text };
  }
}

// ---- Lexicon helpers (copied from legacy index.js) ----
function normalizeBase(u) {
  return (u || "").trim().replace(/\/+$/, "");
}

function buildLexiconAnalyzeCandidates(base) {
  const b = normalizeBase(base);
  if (!b) return [];
  return [
    `${b}/v1/analyze`,
    `${b}/analyze`,
    `${b}/api/analyze`,
    `${b}/v1/lexicon/analyze`
  ];
}

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

function termMatches(corpus, term) {
  const t = lc(term);
  if (t.length < 2) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}\\b`, "i");
  return re.test(corpus);
}

const lc = (s) => (s ?? "").toLowerCase().normalize("NFKC").trim();

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

async function callLexicon(env, text, lang = "en") {
  const base = normalizeBase(env.LEXICON_API_URL);
  const key = env.LEXICON_API_KEY;
  if (!base || !key)
    throw new Error("LEXICON_API_URL or LEXICON_API_KEY missing");

  const candidates = buildLexiconAnalyzeCandidates(base);
  const headersVariants = [
    (k) => ({
      Authorization: `Bearer ${k}`,
      "Content-Type": "application/json",
      "Accept-Language": lang
    }),
    (k) => ({
      "x-api-key": k,
      "Content-Type": "application/json",
      "Accept-Language": lang
    })
  ];

  const payload = { text, lang, normalize: { diacritics: "fold" } };

  for (const url of candidates) {
    for (const mkHeaders of headersVariants) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: mkHeaders(key),
          body: JSON.stringify(payload)
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
            endpoint: url,
            auth: r.headers.get("www-authenticate") || "ok"
          };
      } catch (_) {}
    }

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
      } catch (_) {}
    }
  }

  const js = await lexiconAnalyzeViaShards(env, text, lang);
  return { ok: true, mode: "live_shards", data: js };
}

// =========================
// LEXICON EXTRACTION ENGINE
// =========================

// Extract hits array safely from lexicon payload
function lexHits(lex) {
  return Array.isArray(lex?.data?.hits) ? lex.data.hits : [];
}

// Collect *all* labels from lexicon hit
function collectLabels(hit) {
  const out = new Set();
  if (hit?.canonical) out.add(String(hit.canonical).toLowerCase());
  if (Array.isArray(hit?.tags)) {
    for (const t of hit.tags) out.add(String(t).toLowerCase());
  }
  if (Array.isArray(hit?.classes)) {
    for (const c of hit.classes) out.add(String(c).toLowerCase());
  }
  return out;
}

// Extract FODMAP (ONLY if lexicon provides fodmap metadata)
function extractFodmap(lex) {
  for (const hit of lexHits(lex)) {
    const f = hit?.fodmap;
    if (f && f.relevant === true) {
      return {
        level: f.level || f.severity || "unknown",
        reason: f.reason || f.drivers || "FODMAP reason from lexicon",
        source: "lexicon"
      };
    }
  }
  return null;
}

// Extract ALL allergens by scanning *all* canonical/tags/classes
// No short lists — ANY allergen class lexicon emits is accepted.
function extractAllergens(lex) {
  const out = [];
  const seen = new Set();

  for (const hit of lexHits(lex)) {
    const labels = collectLabels(hit);

    for (const lbl of labels) {
      // Accept only structured allergen labels prefixed by allergen namespaces
      // e.g. allergen:milk, allergen:gluten, allergen_wheat, etc.
      if (
        lbl.startsWith("allergen:") ||
        lbl.startsWith("allergen_") ||
        lbl.startsWith("contains:")
      ) {
        const kind = lbl
          .replace("allergen:", "")
          .replace("allergen_", "")
          .replace("contains:", "")
          .trim();

        if (!seen.has(kind)) {
          seen.add(kind);
          out.push({
            kind,
            message: `Contains or may contain ${kind} (from lexicon)`,
            source: "lexicon"
          });
        }
      }
    }
  }

  return out;
}

// Extract lactose level from lexicon metadata
function extractLactose(lex) {
  for (const hit of lexHits(lex)) {
    const lac = hit?.lactose;
    if (lac && typeof lac.level === "string") {
      return {
        level: lac.level,
        reason: lac.reason || "Lactose level from lexicon",
        source: "lexicon"
      };
    }

    // Tag/class based fallback ONLY if explicitly labeled by lexicon
    const labels = collectLabels(hit);
    if (labels.has("lactose_free")) {
      return { level: "none", reason: "labeled lactose_free", source: "lexicon" };
    }
    if (labels.has("low_lactose")) {
      return { level: "low", reason: "labeled low_lactose", source: "lexicon" };
    }
    if (labels.has("high_lactose")) {
      return { level: "high", reason: "labeled high_lactose", source: "lexicon" };
    }
  }

  return null;
}

export default {
  fetch: handleFetch,
  queue: handleQueue,
};
