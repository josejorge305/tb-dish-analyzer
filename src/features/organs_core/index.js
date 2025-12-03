export async function assessOrgans(
  env,
  {
    ingredients = [],
    userId = "",
    include_lactose = false,
    lex_hits = null
  }
) {
  // Flatten ingredients into a simple array
  const flat = normalizeIngredientsArray(ingredients || []);

  // Build analysis text from ingredients (names + comments + text)
  const text = flat
    .map((i) => [i.name, i.comment, i.text].filter(Boolean).join(" "))
    .join(" ")
    .toLowerCase();

  const hasGatewayLexHits = Array.isArray(lex_hits) && lex_hits.length > 0;

  // ============================
  // LEXICON SUPER-BRAIN CALL
  // ============================
  let lexiconIngredientHits = [];
  if (!hasGatewayLexHits) {
    try {
      const lex = await organsCallLexicon(env, text, "en");
      lexiconIngredientHits = lex && lex.ok ? organsLexHits(lex) : [];
    } catch (e) {
      lexiconIngredientHits = [];
    }
  }
  // --- LEXICON → PRIMARY FLAGS (phase 1) ---
  const lexFlags = deriveLexiconFlags(
    hasGatewayLexHits ? lex_hits : lexiconIngredientHits
  );

  // ============================
  // EXISTING HEURISTIC ENGINE
  // (still used for organ scores, red meat, etc.)
  // ============================
  const hits = detectTriggers(text, flat);
  const organs = computeOrganScores(hits, text);

  const hasAnyLexHits = hasGatewayLexHits || (lexiconIngredientHits.length > 0);

  const tummy_barometer = computeTummyBarometer(hits, organs, { level: "unknown" });
  const insight_lines = buildInsights(hits, { level: "unknown" }, tummy_barometer, organs);

  const result = {
    ok: true,
    source: "organs_core.v1",
    userId: userId || null,
    flags: {
      allergens: hasAnyLexHits
        ? (Array.isArray(lexFlags.allergens) ? lexFlags.allergens : [])
        : [],
      fodmap: hasAnyLexHits
        ? (lexFlags.fodmap
            ? {
                level: lexFlags.fodmap.level || "unknown",
                reason: lexFlags.fodmap.level
                  ? "FODMAP level inferred from Lexicon."
                  : "FODMAP level unknown; no Lexicon data.",
                source: "lexicon"
              }
            : {
                level: "unknown",
                reason: "FODMAP level unknown; no Lexicon data.",
                source: "lexicon"
              })
        : {
            level: "unknown",
            reason: "FODMAP level unknown; no Lexicon data.",
            source: "lexicon"
          },
      lactose: null,
      onion_garlic: hits.onion_garlic.length > 0,
      spicy: hits.spicy.length > 0,
      alcohol: hits.alcohol.length > 0
    },
    tummy_barometer,
    organs,
    insight_lines,
    debug: {
      gateway_lex_hits: hasGatewayLexHits ? lex_hits : null,
      internal_lex_hits: lexiconIngredientHits
    }
  };

  // Override lactose flag if requested
  if (include_lactose) {
    result.flags.lactose = hasAnyLexHits ? lexFlags.lactose || null : null;
  }

  return result;
}

export async function fromDish(env, { dish, userId }) {
  const ingredients = [
    {
      name: dish,
      qty: null,
      unit: null,
      comment: null
    }
  ];
  return assessOrgans(env, { ingredients, userId, include_lactose: false });
}

function normalizeIngredientsArray(ingredients) {
  if (!Array.isArray(ingredients)) return [];
  return ingredients.map((row) => {
    if (!row || typeof row !== "object") {
      return { name: String(row || ""), qty: null, unit: null, comment: null };
    }
    return {
      name: row.name || row.ingredient || row.item || row.text || "",
      qty: row.qty ?? row.quantity ?? null,
      unit: row.unit || null,
      comment: row.comment || null,
      text: row.text || null
    };
  });
}

function detectTriggers(text, ingredients = []) {
  const lowerText = (text || "").toLowerCase();
  const ingredientText = Array.isArray(ingredients)
    ? ingredients
        .map((ing) =>
          [
            ing?.name,
            ing?.text,
            ing?.comment,
            ing?.original
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join(" ")
        .toLowerCase()
    : "";
  const fullText = `${lowerText} ${ingredientText}`.trim();

  const hits = {
    dairy: [],
    gluten: [],
    shellfish: [],
    fish: [],
    soy: [],
    egg: [],
    nuts: [],
    peanut: [],
    sesame: [],
    onion_garlic: [],
    fructose: [],
    spicy: [],
    alcohol: [],
    processed_meat: [],
    red_meat: [],
    high_fat: [],
    fiber_friendly: [],
    omega3: []
  };

  function mark(key, reason) {
    hits[key].push(reason);
  }

  if (/\b(milk|cream|cheese|mozzarella|parmesan|butter|yogurt|sour cream|half[-\s]?and[-\s]?half)\b/.test(fullText)) {
    mark("dairy", "Contains probable dairy ingredient(s).");
  }

  if (/\b(wheat|barley|rye|flour|breadcrumbs|panko|pasta|noodles|bread|tortilla|cracker|bun|crust|wrap)\b/.test(fullText)) {
    mark("gluten", "Contains probable gluten-containing grain or flour.");
  }

  if (/\b(shrimp|prawn|prawns|crab|lobster|shellfish|mussel|mussels|clam|clams|oyster|scallop|scallops)\b/.test(fullText)) {
    mark("shellfish", "Contains shellfish.");
  }

  if (/\b(salmon|tuna|cod|haddock|mahi|sardine|sardines|anchovy|anchovies|halibut|snapper|trout)\b/.test(fullText)) {
    mark("fish", "Contains fish, often rich in omega-3 fats.");
    mark("omega3", "Fish-based omega-3 fats.");
  }

  if (/\b(soy|soybean|tofu|edamame|tempeh|soy sauce)\b/.test(fullText)) {
    mark("soy", "Contains soy-derived ingredients.");
  }

  if (/\b(egg|eggs|yolk|yolks|mayonnaise|mayo)\b/.test(fullText)) {
    mark("egg", "Contains egg.");
  }

  if (/\b(almond|walnut|walnuts|pecan|hazelnut|cashew|pistachio|macadamia|pine nut|pine nuts)\b/.test(fullText)) {
    mark("nuts", "Contains tree nuts.");
  }

  if (/\b(peanut|peanuts|peanut butter)\b/.test(fullText)) {
    mark("peanut", "Contains peanut.");
  }

  if (/\b(sesame|tahini)\b/.test(fullText)) {
    mark("sesame", "Contains sesame.");
  }

  if (/\b(onion|onions|garlic|shallot|shallots|leek|leeks|scallion|scallions|chive|chives)\b/.test(fullText)) {
    mark("onion_garlic", "Contains allium ingredients (onion/garlic family).");
  }

  if (/\b(cherry|cherries|apple|apples|pear|pears|honey|mango|mangos|mangoes|watermelon)\b/.test(fullText)) {
    mark("fructose", "Contains higher-fructose fruit/sweetener.");
  }

  if (/\b(chili|chile|chiles|jalapeno|jalapeño|habanero|cayenne|sriracha|hot sauce|spicy)\b/.test(fullText)) {
    mark("spicy", "Contains spicy ingredients.");
  }

  if (/\b(wine|beer|vodka|rum|tequila|whiskey|whisky|cognac|brandy|liqueur)\b/.test(fullText)) {
    mark("alcohol", "Contains alcoholic components.");
  }

  if (/\b(bacon|sausage|salami|pepperoni|ham|prosciutto|hot dog|hotdogs)\b/.test(fullText)) {
    mark("processed_meat", "Contains processed meats.");
  }

  if (/\b(steak|beef|lamb|veal|ribs|burger|burgers)\b/.test(fullText)) {
    mark("red_meat", "Contains red meat.");
  }

  if (/\b(fried|deep[-\s]?fried|battered|aioli|mayo|mayonnaise|cream sauce|alfredo)\b/.test(fullText)) {
    mark("high_fat", "Prep appears high in fat (fried/creamy).");
  }

  if (/\b(arugula|lettuce|spinach|kale|broccoli|broccolini|cabbage|fennel|radish|radishes|chickpea|chickpeas|lentil|lentils|bean|beans|oat|oats)\b/.test(fullText)) {
    mark("fiber_friendly", "Contains veggies/legumes/whole grains with fiber.");
  }

  return hits;
}

function classifyFodmap(hits) {
  let score = 0;

  if (hits.onion_garlic.length > 0) score += 2;
  if (hits.fructose.length > 0) score += 1;
  if (hits.dairy.length > 0) score += 1;
  if (hits.gluten.length > 0) score += 1;
  if (hits.spicy.length > 0) score += 1;

  if (score === 0) return { level: "low", reason: "No obvious high-FODMAP ingredients detected." };
  if (score === 1) return { level: "moderate", reason: "Some possible FODMAP triggers detected." };
  if (score === 2) return { level: "moderate", reason: "Multiple mild FODMAP triggers detected." };
  if (score >= 3) return { level: "high", reason: "Several FODMAP triggers (onion/garlic, dairy, gluten or fructose) detected." };

  return { level: "unknown", reason: "Could not estimate FODMAP risk." };
}

function computeOrganScores(hits, text) {
  const organs = [
    { organ: "gut", score: 0, reasons: [] },
    { organ: "heart", score: 0, reasons: [] },
    { organ: "liver", score: 0, reasons: [] },
    { organ: "immune", score: 0, reasons: [] },
    { organ: "metabolic", score: 0, reasons: [] }
  ];

  function org(name) {
    return organs.find((o) => o.organ === name);
  }

  const gut = org("gut");
  const heart = org("heart");
  const liver = org("liver");
  const metabolic = org("metabolic");

  if (hits.onion_garlic.length > 0) {
    gut.score -= 15;
    gut.reasons.push("Onion/garlic family may irritate sensitive IBS/FODMAP guts.");
  }

  if (hits.fructose.length > 0) {
    gut.score -= 8;
    gut.reasons.push("Higher-fructose ingredients may worsen bloating for some.");
  }

  if (hits.spicy.length > 0) {
    gut.score -= 6;
    gut.reasons.push("Spicy elements can aggravate reflux or sensitive stomachs.");
  }

  if (hits.dairy.length > 0) {
    gut.score -= 10;
    gut.reasons.push("Dairy may cause issues in lactose-sensitive users.");
  }

  if (hits.gluten.length > 0) {
    gut.score -= 10;
    gut.reasons.push("Gluten may be problematic for celiac or gluten-sensitive individuals.");
  }

  if (hits.fiber_friendly.length > 0) {
    gut.score += 8;
    gut.reasons.push("Fiber-rich vegetables/legumes may support gut health for many.");
  }

  if (hits.omega3.length > 0) {
    heart.score += 12;
    heart.reasons.push("Fish-based omega-3 fats can be heart-supportive.");
  }

  if (hits.processed_meat.length > 0) {
    heart.score -= 10;
    heart.reasons.push("Processed meats are associated with higher cardiovascular risk.");
  }

  if (hits.red_meat.length > 0) {
    heart.score -= 6;
    heart.reasons.push("Frequent red meat intake may stress cardiovascular and metabolic systems.");
  }

  if (hits.high_fat.length > 0) {
    heart.score -= 4;
    metabolic.score -= 5;
    heart.reasons.push("Rich/fried preparation increases saturated fat load.");
    metabolic.reasons.push("High-fat cooking can impact weight and metabolic health.");
  }

  if (hits.alcohol.length > 0) {
    liver.score -= 10;
    gut.score -= 4;
    liver.reasons.push("Alcohol requires liver detox and may be problematic in excess.");
    gut.reasons.push("Alcohol can irritate the gut lining for some people.");
  }

  if (hits.fiber_friendly.length > 0) {
    metabolic.score += 4;
    metabolic.reasons.push("Fiber and plant foods may help with metabolic balance.");
  }

  return organs.map((o) => ({
    organ: o.organ,
    score: o.score,
    level: scoreToLevel(o.score),
    reasons: o.reasons
  }));
}

function scoreToLevel(score) {
  if (score <= -15) return "high_negative";
  if (score < 0) return "mild_negative";
  if (score === 0) return "neutral";
  if (score <= 10) return "mild_positive";
  return "high_positive";
}

function computeTummyBarometer(hits, organs, fodmap) {
  let score = 70;

  const gut = organs.find((o) => o.organ === "gut");
  if (gut) score += gut.score;

  if (fodmap.level === "high") score -= 20;
  else if (fodmap.level === "moderate") score -= 10;

  if (hits.dairy.length > 0) score -= 5;
  if (hits.gluten.length > 0) score -= 5;
  if (hits.spicy.length > 0) score -= 3;

  if (hits.omega3.length > 0) score += 5;
  if (hits.fiber_friendly.length > 0) score += 4;

  if (score > 100) score = 100;
  if (score < 0) score = 0;

  let label = "Caution";
  if (score >= 75) label = "Generally Safe";
  else if (score <= 45) label = "Avoid or Modify";

  const reasons = [];

  if (fodmap.level === "high") {
    reasons.push({
      kind: "fodmap",
      level: "high",
      weight: 2,
      message: fodmap.reason
    });
  } else if (fodmap.level === "moderate") {
    reasons.push({
      kind: "fodmap",
      level: "moderate",
      weight: 1,
      message: fodmap.reason
    });
  }

  if (hits.dairy.length > 0) {
    reasons.push({
      kind: "allergen",
      level: "dairy",
      weight: 1,
      message: "Potential dairy for lactose-sensitive users."
    });
  }

  if (hits.gluten.length > 0) {
    reasons.push({
      kind: "allergen",
      level: "gluten",
      weight: 1,
      message: "Contains probable gluten sources."
    });
  }

  if (hits.omega3.length > 0 || hits.fiber_friendly.length > 0) {
    reasons.push({
      kind: "benefit",
      level: "positive",
      weight: 1,
      message: "Includes fish/fiber that may support heart and gut health."
    });
  }

  return { score, label, reasons };
}

function buildAllergenFlags(hits) {
  const list = [];

  if (hits.dairy.length > 0) list.push({ kind: "dairy", message: hits.dairy[0] });
  if (hits.gluten.length > 0) list.push({ kind: "gluten", message: hits.gluten[0] });
  if (hits.shellfish.length > 0) list.push({ kind: "shellfish", message: hits.shellfish[0] });
  if (hits.fish.length > 0) list.push({ kind: "fish", message: hits.fish[0] });
  if (hits.soy.length > 0) list.push({ kind: "soy", message: hits.soy[0] });
  if (hits.egg.length > 0) list.push({ kind: "egg", message: hits.egg[0] });
  if (hits.nuts.length > 0) list.push({ kind: "tree_nuts", message: hits.nuts[0] });
  if (hits.peanut.length > 0) list.push({ kind: "peanut", message: hits.peanut[0] });
  if (hits.sesame.length > 0) list.push({ kind: "sesame", message: hits.sesame[0] });

  return list;
}

function buildInsights(hits, fodmap, tummy_barometer, organs) {
  const lines = [];

  lines.push(
    `Overall: ${tummy_barometer.label} (score ${Math.round(tummy_barometer.score)}).`
  );

  if (fodmap.level === "high") {
    lines.push("FODMAP risk is HIGH due to onion/garlic, certain fruits, or other triggers.");
  } else if (fodmap.level === "moderate") {
    lines.push("FODMAP risk is MODERATE with a few possible triggers present.");
  } else if (fodmap.level === "low") {
    lines.push("FODMAP load appears relatively LOW based on listed ingredients.");
  }

  if (hits.onion_garlic.length > 0) {
    lines.push("Contains onion/garlic-family ingredients, which many IBS users find triggering.");
  }

  if (hits.dairy.length > 0) {
    lines.push("Includes dairy; consider lactose sensitivity or using a lactase supplement.");
  }

  if (hits.gluten.length > 0) {
    lines.push("Likely contains gluten; important for celiac or gluten-sensitive individuals.");
  }

  if (hits.omega3.length > 0) {
    lines.push("Fish-based omega-3 fats may be a positive for heart health.");
  }

  const gut = organs.find((o) => o.organ === "gut");
  if (gut && gut.reasons.length > 0) {
    lines.push("Gut notes: " + gut.reasons.join(" "));
  }

  const heart = organs.find((o) => o.organ === "heart");
  if (heart && heart.reasons.length > 0) {
    lines.push("Heart notes: " + heart.reasons.join(" "));
  }

  return lines;
}

// =========================
// LEXICON CLIENT + EXTRACTORS (ORGANS CORE)
// =========================

// DEPRECATED: internal Lex client – only used as fallback when gateway does not pass lex_hits.
async function organsCallLexicon(env, text, lang = "en") {
  const base = normalizeBase(env?.LEXICON_API_URL || "");
  const key = (env?.LEXICON_API_KEY || "").trim();

  if (!base || !key || !text) {
    return { ok: false, reason: "missing-config-or-text" };
  }

  const url = `${base}/v1/search`;
  const payload = {
    text,
    lang,
    normalize: { diacritics: "fold" }
  };

  const headers = {
    "Content-Type": "application/json",
    "Accept-Language": lang,
    Authorization: `Bearer ${key}`
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
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
      reason: "lexicon-non-200-or-bad-json",
      data: js
    };
  }

  return {
    ok: true,
    mode: "endpoint_analyze",
    data: js
  };
}

function organsLexHits(lex) {
  return Array.isArray(lex?.data?.hits) ? lex.data.hits : [];
}

function organsCollectLabels(hit) {
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

function organsExtractFodmap(lex) {
  for (const hit of organsLexHits(lex)) {
    const f = hit?.fodmap;
    if (f && f.relevant === true) {
      const level = organsNormalizeFodmapValue(f);
      return {
        level,
        reason:
          f.reason ||
          f.drivers ||
          `FODMAP level ${level} inferred from lexicon.`,
        source: "lexicon"
      };
    }
  }
  return null;
}

function organsNormalizeFodmapValue(v) {
  let lvl = v;
  if (v && typeof v === "object") lvl = v.level ?? v.fodmap_level ?? v.value;
  lvl = String(lvl || "").toLowerCase();
  if (["very_high", "ultra_high", "high"].includes(lvl)) return "high";
  if (["medium", "moderate"].includes(lvl)) return "moderate";
  if (["low", "very_low", "trace"].includes(lvl)) return "low";
  return "unknown";
}

function organsExtractAllergens(lex) {
  const out = new Set();

  for (const hit of organsLexHits(lex)) {
    // 1) Prefer any explicit allergens array the lexicon returns
    if (Array.isArray(hit?.allergens)) {
      for (const a of hit.allergens) {
        const k = String(a || "")
          .toLowerCase()
          .trim()
          .replace(/\s+/g, "_");
        if (k) out.add(k);
      }
    }

    // 2) Also allow structured labels like "allergen:milk", "allergen_gluten", "contains:wheat"
    const labels = organsCollectLabels(hit);
    for (const lbl of labels) {
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
        if (kind) out.add(kind);
      }
    }
  }

  return Array.from(out);
}

function organsExtractLactose(lex) {
  for (const hit of organsLexHits(lex)) {
    const lac = hit?.lactose;
    if (lac && typeof lac.level === "string") {
      return {
        level: String(lac.level).toLowerCase(),
        reason: lac.reason || "Lactose level from lexicon.",
        source: "lexicon"
      };
    }

    const labels = organsCollectLabels(hit);
    if (labels.has("lactose_free")) {
      return {
        level: "none",
        reason: "labeled lactose_free",
        source: "lexicon"
      };
    }
    if (labels.has("low_lactose")) {
      return {
        level: "low",
        reason: "labeled low_lactose",
        source: "lexicon"
      };
    }
    if (labels.has("high_lactose")) {
      return {
        level: "high",
        reason: "labeled high_lactose",
        source: "lexicon"
      };
    }
  }

  return null;
}

// Local normalizeBase helper
function normalizeBase(u) {
  return (u || "").trim().replace(/\/+$/, "");
}

function deriveLexiconFlags(hits) {
  const allergens = new Set();
  const fodmapDrivers = [];
  let fodmapLevel = null;
  const lactoseBands = [];
  const lactoseExamples = [];

  const orderF = { low: 1, moderate: 2, high: 3 };
  const orderL = { none: 1, low: 2, medium: 3, high: 4 };

  for (const h of hits) {
    const maps = Array.isArray(h.maps_to) ? h.maps_to : [];

    // Allergens
    for (const m of maps) {
      if (m === "milk" || m === "dairy") allergens.add("dairy");
      if (m === "gluten" || m === "wheat") allergens.add("gluten");
      if (m === "egg") allergens.add("egg");
      if (m === "fish") allergens.add("fish");
      if (m === "shellfish") allergens.add("shellfish");
      if (m === "soy") allergens.add("soy");
      if (m === "peanut") allergens.add("peanut");
      if (m === "tree_nut" || m === "tree-nut") allergens.add("tree_nut");
      if (m === "sesame") allergens.add("sesame");
    }

    // FODMAP
    if (h.fodmap && h.fodmap.relevant) {
      if (Array.isArray(h.fodmap.drivers)) {
        fodmapDrivers.push(...h.fodmap.drivers);
      }
      const lvl = h.fodmap.level;
      if (lvl && (!fodmapLevel || orderF[lvl] > orderF[fodmapLevel])) {
        fodmapLevel = lvl;
      }
    }

    // Lactose
    if (h.lactose_band) {
      lactoseBands.push(h.lactose_band);
      if (h.canonical) lactoseExamples.push(h.canonical);
    }
  }

  let lactoseLevel = null;
  if (lactoseBands.length) {
    lactoseLevel = lactoseBands.sort((a, b) => orderL[b] - orderL[a])[0];
  }

  return {
    allergens: Array.from(allergens),
    fodmap: { level: fodmapLevel, drivers: fodmapDrivers },
    lactose: { level: lactoseLevel, examples: lactoseExamples }
  };
}
