// src/features/restaurant_core/index.js
// Public facade ONLY — we will wire real logic later.

// NOTE: provider skeleton — will be filled with real Uber logic in a later step.
async function searchUberRestaurants(
  env,
  { query, lat, lng, radius, maxRows }
) {
  // -----------------------------------------------
  // Uber provider: GPS-based search using helpers
  // -----------------------------------------------

  if (!lat || !lng) {
    return { ok: false, provider: "uber", error: "missing_coordinates" };
  }

  try {
    return await searchNearbyCandidates(
      { query: query || "", lat, lng, radius, maxRows },
      env
    );
  } catch (err) {
    return { ok: false, provider: "uber", error: err?.message || String(err) };
  }
}

function buildStubRestaurants({ query }) {
  const displayName = (query || "").trim() || "Tummy Buddy Test Bistro";
  return {
    ok: true,
    source: "restaurant_core.stub",
    items: [
      {
        id: "stub-restaurant-1",
        name: `${displayName} · Brickell`,
        provider: "stub",
        address: "123 Debug Ave",
        city: "Miami",
        country: "US",
        placeId: "stub-place-1",
        url: "https://example.com/menu/stub-place-1"
      }
    ]
  };
}

export async function findRestaurants(
  env,
  { query, lat, lng, radius, maxRows }
) {
  const q = (query || "").trim();
  const hasCoords = lat != null && lng != null;
  const effectiveRadius = radius || 6000;
  const effectiveMaxRows = maxRows || 25;

  if (!q && !hasCoords) {
    return buildStubRestaurants({ query: q });
  }

  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return buildStubRestaurants({ query: q });
  }

  try {
    const params = new URLSearchParams();
    params.set("query", q || "restaurant");
    if (hasCoords) {
      params.set("location", `${lat},${lng}`);
      params.set("radius", String(effectiveRadius));
    }
    params.set("type", "restaurant");
    params.set("key", apiKey);

    const url =
      "https://maps.googleapis.com/maps/api/place/textsearch/json?" +
      params.toString();

    const res = await fetch(url);

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        source: "google_places_http_error",
        status: res.status,
        body: text.slice(0, 500)
      };
    }

    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];

    if (!results.length) {
      return buildStubRestaurants({ query: q });
    }

    const items = results.slice(0, effectiveMaxRows).map((r, idx) => {
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

    return {
      ok: true,
      source: "google_places",
      items
    };
  } catch (err) {
    return buildStubRestaurants({ query: q });
  }
}

function filterMenuItems(dishes = []) {
  if (!Array.isArray(dishes)) return [];

  const bannedSections = [
    "drinks",
    "beverages",
    "soft drinks",
    "bottled drinks"
  ].map((s) => s.toLowerCase());

  const bannedNames = [
    "water",
    "bottled water",
    "sparkling water",
    "mineral water"
  ].map((s) => s.toLowerCase());

  return dishes.filter((it) => {
    const section = (it.section || "").toLowerCase();
    const name = (it.name || "").toLowerCase();

    if (bannedSections.some((s) => section.includes(s))) {
      return false;
    }

    if (bannedNames.includes(name)) {
      return false;
    }

    return true;
  });
}

export async function extractMenu(env, { placeId, url, lat, lng }) {
  if (!placeId) {
    return buildStubMenu({
      id: "stub-place-1",
      name: "Unknown Restaurant",
      address: "",
      url: url || ""
    });
  }

  const place = await fetchGooglePlaceDetails(env, placeId);
  if (!place.ok) {
    return buildStubMenu({
      id: placeId,
      name: "Unknown Restaurant",
      address: "",
      url: url || ""
    });
  }

  const { name, address, lat: placeLat, lng: placeLng } = place;
  const resolvedLat =
    typeof lat === "number" && Number.isFinite(lat) ? lat : placeLat;
  const resolvedLng =
    typeof lng === "number" && Number.isFinite(lng) ? lng : placeLng;

  const uber = await callUberForMenu(
    env,
    name || "",
    address || "",
    {
      lat: resolvedLat,
      lng: resolvedLng,
      radius: 6000,
      maxRows: 150
    },
    null
  );

  if (!uber.ok || !Array.isArray(uber.items) || uber.items.length === 0) {
    return {
      ok: false,
      source: "uber_rapidapi_menu_failed",
      restaurant: {
        id: placeId,
        name: name || "Unknown Restaurant",
        address: address || "",
        url: url || ""
      },
      uberDebug: uber
    };
  }

  const dishes = (uber.items || []).map((it, idx) => {
    const raw = it.raw || {};
    const imageUrl =
      it.imageUrl ||
      it.image_url ||
      it.image ||
      raw.imageUrl ||
      raw.image_url ||
      raw.image ||
      null;

    return {
      id: `canon-${idx + 1}`,
      name: it.title || it.name || `Item ${idx + 1}`,
      description: it.description || "",
      section: it.section || null,
      source: it.source || "uber",
      rawPrice: typeof it.price_cents === "number" ? it.price_cents : null,
      priceText: it.price_text || null,
      imageUrl
    };
  });

  const filteredDishes = filterMenuItems(dishes);

  if (filteredDishes && filteredDishes.length > 0) {
    try {
      console.log(
        "DEBUG EXTRACT_MENU FIRST DISH:",
        JSON.stringify(filteredDishes[0]).slice(0, 800)
      );
    } catch (e) {
      console.log(
        "DEBUG EXTRACT_MENU FIRST DISH: [could not stringify]",
        String(e)
      );
    }
  }

  return {
    ok: true,
    source: "uber_rapidapi_menu",
    restaurant: {
      id: placeId,
      name,
      address,
      url
    },
    sections: [
      {
        id: "uber-menu",
        name: "Menu",
        items: filteredDishes
      }
    ]
  };
}

async function fetchGooglePlaceDetails(env, placeId) {
  console.log("DEBUG: fetchGooglePlaceDetails called with placeId:", placeId);

  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "Missing GOOGLE_MAPS_API_KEY"
    };
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
    return {
      ok: false,
      error: String(err?.message || err)
    };
  }
}

function buildStubMenu({ id, name, address, url }) {
  return {
    ok: true,
    source: "restaurant_core.stub",
    restaurant: {
      id,
      name,
      address,
      url
    },
    sections: [
      {
        id: "stub-brunch",
        name: "Brunch Favorites",
        items: [
          {
            id: "stub-avocado-toast",
            name: "Avocado Toast (Stub)",
            description:
              "Sourdough toast topped with smashed avocado, cherry tomatoes, arugula, and a drizzle of olive oil.",
            source: "stub",
            rawPrice: null
          }
        ]
      }
    ]
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------
// UBER EATS HELPERS (migrated from root index.js)
// NOTE: For now these are just copies. We will wire them into
// searchUberRestaurants(...) in the next steps.
// ------------------------------------------------------------
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

async function waitForJob(env, job, { attempts = 6 } = {}) {
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

// ------------------------------------------------------------
// LEGACY MENU PIPELINE HELPERS (migrated from index V5)
// NOTE: For now these are just copies; we will wire them into
// extractMenu(...) in later steps.
// ------------------------------------------------------------
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

function toCanonFromUber(it) {
  return {
    title: it.name || "",
    description: it.description || "",
    section: it.section || "",
    price_cents: typeof it.price === "number" ? it.price : null,
    price_text: it.price_display || null,
    calories_text: it.calories_display || null,
    source: "uber",
    confidence: 1.0,
    imageUrl:
      it.imageUrl ||
      it.image_url ||
      it.image ||
      (it.raw && (it.raw.imageUrl || it.raw.image_url || it.raw.image)) ||
      null,
    raw: it.raw || null
  };
}

function toCanonFromLLM(it) {
  return {
    title: (it.title || it.name || "").trim(),
    description: (it.description || it.desc || "").trim() || null,
    section: (it.section || "").trim() || "",
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

// Legacy menu pipeline helpers from index V6 copy

function flattenUberPayloadToItems(payload, opts = {}) {
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
      if (title.includes("pura") && title.includes("vida")) score += 20;
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

        // Try multiple possible image shapes from Uber payload
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

        if (flat.length < 5) {
          try {
            console.log(
              "DEBUG UBER RAW ITEM:",
              JSON.stringify(item).slice(0, 800)
            );
          } catch (e) {
            console.log(
              "DEBUG UBER RAW ITEM: [could not stringify]",
              String(e)
            );
          }
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

export async function callUberForMenu(env, query, address, opts = {}, ctx) {
  const host = env.UBER_RAPID_HOST || "uber-eats-scraper-api.p.rapidapi.com";
  const key = env.RAPIDAPI_KEY || env.RAPID_API_KEY;

  if (!key) {
    return {
      ok: false,
      source: "uber_rapidapi",
      error: "Missing RAPIDAPI_KEY"
    };
  }

  if (!host) {
    return {
      ok: false,
      source: "uber_rapidapi",
      error: "Missing UBER_RAPID_HOST"
    };
  }

  if (!address) {
    return {
      ok: false,
      source: "uber_rapidapi",
      error: "Missing address for Uber Eats /api/job"
    };
  }

  const maxRows = opts.maxRows ?? 150;
  const locale = opts.locale || "en-US";
  const page = opts.page || 1;
  const webhook = opts.webhook || null;
  const attempts = opts.attempts || 8;

  let job;
  try {
    job = await postJobByAddress(
      { query, address, maxRows, locale, page, webhook },
      env
    );
  } catch (err) {
    return {
      ok: false,
      source: "uber_rapidapi_postJob",
      error: String(err?.message || err)
    };
  }

  let payload;
  try {
    const resolved = await waitForJob(env, job, { attempts });
    payload = resolved?.raw || resolved || job?.raw || job;
  } catch (err) {
    return {
      ok: false,
      source: "uber_rapidapi_menu",
      error: String(err?.message || err)
    };
  }

  const uberRawItems = flattenUberPayloadToItems(payload, {
    targetName: query || ""
  });
  if (!uberRawItems.length) {
    return {
      ok: false,
      source: "uber_rapidapi_menu",
      error:
        "Uber RapidAPI job completed but no menu items were found in the payload."
    };
  }

  const merged = mergeCanonItems(uberRawItems, [], []);
  const ranked = rankCanon(merged, maxRows);

  if (!ranked.length) {
    return {
      ok: false,
      source: "uber_rapidapi_menu",
      error: "Canonical menu pipeline produced no items."
    };
  }

  return {
    ok: true,
    source: "uber_rapidapi_menu",
    items: ranked
  };
}

function preferBetter(a, b) {
  if (!a) return b;
  if (!b) return a;

  const ca = typeof a.confidence === "number" ? a.confidence : 0;
  const cb = typeof b.confidence === "number" ? b.confidence : 0;
  if (cb > ca + 0.1) return b;
  if (ca > cb + 0.1) return a;

  const aHasPrice = !!(a.price_cents || a.price_text);
  const bHasPrice = !!(b.price_cents || b.price_text);
  if (bHasPrice && !aHasPrice) return b;
  if (aHasPrice && !bHasPrice) return a;

  const aUber = a.source === "uber";
  const bUber = b.source === "uber";
  if (bUber && !aUber) return b;
  if (aUber && !bUber) return a;

  return a;
}

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
