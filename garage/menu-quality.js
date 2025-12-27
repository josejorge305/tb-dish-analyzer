/**
 * MENU QUALITY MODULE
 *
 * Production-safe quality checks for menu extraction:
 * - Junk item detection (add-ons, grocery, inventory)
 * - Cross-contamination detection (wrong restaurant, cuisine mismatch)
 * - Category normalization and structuring
 *
 * IMPORTANT: All checks are deterministic and O(n) - NO added latency
 */

// ============================================================================
// SECTION A: JUNK ITEM DETECTION
// ============================================================================

/**
 * Patterns for items that should NOT appear as standalone menu items
 */
const JUNK_PATTERNS = {
  // Add-ons that should be modifiers, not items
  addons: [
    /^add\s+/i,
    /^\+\s*/,
    /^extra\s+/i,
    /^side\s+of\s+/i,
    /^(small|medium|large)\s+side$/i,
    /^upgrade\s+to/i,
    /^substitute\s+/i,
    /^swap\s+/i,
    /^make\s+it\s+/i,
    /^(single|double|triple)\s+(shot|pump)/i
  ],

  // Grocery/supermarket style items
  grocery: [
    /^\d+\s*(oz|ml|l|lb|kg|g|ct|pk|pack)\b/i,
    /\b(case|carton|bottle|can|box)\s+of\s+\d+/i,
    /\bwholesale\b/i,
    /\bbulk\s+/i,
    /\bfamily\s+size\s+\d+/i,
    /\b(6|12|24|36|48|60)\s*(pack|pk|ct)\b/i,
    /\bgallon\b/i,
    /\brefill\b/i
  ],

  // Inventory/system items that leaked
  inventory: [
    /^placeholder/i,
    /^test\s*item/i,
    /^do\s*not\s*order/i,
    /^catering\s*only/i,
    /^not\s*available/i,
    /^coming\s*soon/i,
    /^sold\s*out/i,
    /^seasonal/i,
    /^limited\s*time/i,
    /^\[.*\]$/,
    /^---+$/,
    /^###/,
    /^_+$/
  ],

  // Pure modifiers that shouldn't be standalone
  modifiers: [
    /^no\s+(ice|whip|cream|sauce|onion|pickle|tomato|lettuce)/i,
    /^light\s+(ice|sauce|dressing)/i,
    /^with\s+(ice|lid|straw|napkins|utensils)/i,
    /^(napkins|utensils|straws|lids|cups)$/i,
    /^(paper|plastic)\s+(bag|cup|container)/i
  ],

  // Espresso/coffee shop add-ons (for non-coffee items)
  espressoAddons: [
    /^(single|double|triple|quad)\s+shot$/i,
    /^espresso\s+shot$/i,
    /^extra\s+pump/i,
    /^\d+\s*pump/i,
    /^(oat|almond|soy|coconut)\s+milk$/i,
    /^(splash|add)\s+of\s+(milk|cream)/i,
    /^(whipped\s+cream|whip)$/i,
    /^syrup\s+-\s+/i,
    /^drizzle$/i
  ]
};

/**
 * Common menu item patterns - these are VALID items, not junk
 */
const VALID_PATTERNS = [
  /burger/i, /sandwich/i, /pizza/i, /pasta/i, /salad/i,
  /taco/i, /burrito/i, /bowl/i, /wrap/i, /sub\b/i,
  /chicken/i, /beef/i, /pork/i, /fish/i, /shrimp/i,
  /fries/i, /wings/i, /nuggets/i, /strips/i, /tenders/i,
  /soup/i, /appetizer/i, /starter/i, /entree/i, /dessert/i,
  /breakfast/i, /lunch/i, /dinner/i, /combo/i, /meal/i,
  /coffee/i, /latte/i, /cappuccino/i, /frappuccino/i,
  /smoothie/i, /shake/i, /tea\b/i, /soda/i, /drink/i
];

/**
 * Detect if an item is junk (should not appear as standalone menu item)
 * @param {object} item - Menu item with name, description, section, price
 * @param {object} context - Restaurant context (cuisine, is_coffee_shop)
 * @returns {{ isJunk: boolean, reason: string | null, confidence: number }}
 */
function detectJunkItem(item, context = {}) {
  const name = (item.name || item.title || "").trim();
  const description = (item.description || item.itemDescription || "").trim();
  const section = (item.section || "").toLowerCase();
  const price = item.price || item.price_cents;

  // Empty or too short names
  if (!name || name.length < 2) {
    return { isJunk: true, reason: "empty_name", confidence: 1.0 };
  }

  // Check against valid patterns first (fast exit)
  for (const pattern of VALID_PATTERNS) {
    if (pattern.test(name)) {
      return { isJunk: false, reason: null, confidence: 0.0 };
    }
  }

  // Check junk patterns
  for (const [category, patterns] of Object.entries(JUNK_PATTERNS)) {
    // Skip espresso addons check for coffee shops
    if (category === "espressoAddons" && context.is_coffee_shop) {
      continue;
    }

    for (const pattern of patterns) {
      if (pattern.test(name)) {
        return { isJunk: true, reason: `junk_${category}`, confidence: 0.9 };
      }
    }
  }

  // Suspiciously cheap (likely a modifier)
  if (price !== null && price !== undefined) {
    const priceInDollars = price > 100 ? price / 100 : price;
    if (priceInDollars < 0.50 && !context.is_coffee_shop) {
      // Very cheap items are usually add-ons
      return { isJunk: true, reason: "suspiciously_cheap", confidence: 0.7 };
    }
  }

  // Too long description with suspicious keywords
  if (description.length > 300 && /\b(internal|system|sku|code|placeholder)\b/i.test(description)) {
    return { isJunk: true, reason: "system_description", confidence: 0.8 };
  }

  // Numeric-only names (SKUs that leaked)
  if (/^\d+$/.test(name)) {
    return { isJunk: true, reason: "numeric_sku", confidence: 0.9 };
  }

  return { isJunk: false, reason: null, confidence: 0.0 };
}

/**
 * Filter junk items from a menu
 * @param {Array} items - Menu items
 * @param {object} context - Restaurant context
 * @returns {{ filtered: Array, junkItems: Array, stats: object }}
 */
function filterJunkItems(items, context = {}) {
  const filtered = [];
  const junkItems = [];
  const stats = {
    total: items.length,
    kept: 0,
    removed: 0,
    byReason: {}
  };

  for (const item of items) {
    const detection = detectJunkItem(item, context);

    if (detection.isJunk && detection.confidence >= 0.7) {
      junkItems.push({ item, ...detection });
      stats.removed++;
      stats.byReason[detection.reason] = (stats.byReason[detection.reason] || 0) + 1;
    } else {
      filtered.push(item);
      stats.kept++;
    }
  }

  return { filtered, junkItems, stats };
}

// ============================================================================
// SECTION B: CROSS-CONTAMINATION DETECTION
// ============================================================================

/**
 * Cuisine signature patterns - keywords strongly associated with a cuisine
 */
const CUISINE_SIGNATURES = {
  mexican: {
    keywords: ["taco", "burrito", "quesadilla", "enchilada", "tamale", "guacamole", "salsa", "tortilla", "fajita", "carnitas", "barbacoa", "al pastor", "carne asada", "churro", "horchata", "elote"],
    incompatible: ["sushi", "ramen", "pho", "dim sum", "curry", "pasta", "risotto", "paella"]
  },
  cuban: {
    keywords: ["cubano", "ropa vieja", "lechon", "mojo", "platano", "yuca", "congri", "picadillo", "medianoche", "croqueta", "empanada cubana", "cafe cubano"],
    incompatible: ["taco", "sushi", "pho", "curry", "wonton"]
  },
  italian: {
    keywords: ["pasta", "pizza", "risotto", "lasagna", "ravioli", "gnocchi", "tiramisu", "bruschetta", "caprese", "carbonara", "bolognese", "marinara", "alfredo", "parmigiana"],
    incompatible: ["sushi", "taco", "pho", "curry", "wonton", "burrito"]
  },
  japanese: {
    keywords: ["sushi", "sashimi", "ramen", "udon", "tempura", "teriyaki", "miso", "edamame", "gyoza", "tonkatsu", "yakitori", "mochi", "sake"],
    incompatible: ["taco", "burrito", "pasta", "curry", "pho", "banh mi"]
  },
  chinese: {
    keywords: ["dim sum", "wonton", "lo mein", "chow mein", "kung pao", "sweet and sour", "general tso", "orange chicken", "egg roll", "fried rice", "mapo tofu", "peking duck"],
    incompatible: ["sushi", "taco", "pasta", "pho", "banh mi"]
  },
  vietnamese: {
    keywords: ["pho", "banh mi", "spring roll", "bun", "vermicelli", "lemongrass", "nuoc mam", "bo luc lac", "com tam", "che"],
    incompatible: ["sushi", "taco", "pasta", "dim sum", "curry"]
  },
  indian: {
    keywords: ["curry", "tandoori", "naan", "tikka masala", "biryani", "samosa", "pakora", "dal", "paneer", "korma", "vindaloo", "chapati", "roti"],
    incompatible: ["sushi", "taco", "pasta", "pho", "dim sum"]
  },
  thai: {
    keywords: ["pad thai", "tom yum", "green curry", "red curry", "massaman", "satay", "basil chicken", "papaya salad", "tom kha", "sticky rice"],
    incompatible: ["sushi", "taco", "pasta", "pho", "dim sum"]
  },
  american: {
    keywords: ["burger", "fries", "hot dog", "bbq", "steak", "mac and cheese", "wings", "ribs", "coleslaw", "mashed potato"],
    incompatible: [] // American is generic, don't flag
  },
  coffee: {
    keywords: ["latte", "cappuccino", "espresso", "americano", "macchiato", "mocha", "frappuccino", "cold brew", "pour over", "cortado"],
    incompatible: ["taco", "sushi", "pho", "curry"] // Coffee shops can have pastries/sandwiches
  }
};

/**
 * Detect if menu items belong to a different cuisine than expected
 * @param {Array} items - Menu items
 * @param {string} expectedCuisine - Expected cuisine type
 * @returns {{ hasContamination: boolean, score: number, evidence: Array }}
 */
function detectCuisineContamination(items, expectedCuisine) {
  if (!expectedCuisine || !CUISINE_SIGNATURES[expectedCuisine]) {
    return { hasContamination: false, score: 0, evidence: [] };
  }

  const signature = CUISINE_SIGNATURES[expectedCuisine];
  const evidence = [];
  let expectedMatches = 0;
  let incompatibleMatches = 0;

  for (const item of items) {
    const name = (item.name || item.title || "").toLowerCase();
    const description = (item.description || "").toLowerCase();
    const text = `${name} ${description}`;

    // Count expected keywords
    for (const kw of signature.keywords) {
      if (text.includes(kw)) {
        expectedMatches++;
        break; // Only count once per item
      }
    }

    // Count incompatible keywords (stronger signal)
    for (const kw of signature.incompatible) {
      if (text.includes(kw)) {
        incompatibleMatches++;
        evidence.push({
          item: item.name || item.title,
          keyword: kw,
          type: "incompatible_cuisine"
        });
        break;
      }
    }
  }

  // Calculate contamination score
  const total = items.length;
  if (total === 0) {
    return { hasContamination: false, score: 0, evidence: [] };
  }

  const expectedRatio = expectedMatches / total;
  const incompatibleRatio = incompatibleMatches / total;

  // If more than 10% of items have incompatible keywords, flag contamination
  // OR if expected keywords are less than 5% and incompatible > 5%
  const hasContamination = incompatibleRatio > 0.10 ||
    (expectedRatio < 0.05 && incompatibleRatio > 0.05);

  const score = Math.min(1.0, incompatibleRatio * 5); // Scale to 0-1

  return { hasContamination, score, evidence };
}

/**
 * Detect if items might be from a wrong restaurant
 * @param {Array} items - Menu items
 * @param {string} expectedName - Expected restaurant name
 * @returns {{ hasMismatch: boolean, confidence: number, suspiciousNames: Array }}
 */
function detectRestaurantMismatch(items, expectedName) {
  if (!expectedName || items.length === 0) {
    return { hasMismatch: false, confidence: 0, suspiciousNames: [] };
  }

  const expectedNorm = normalizeText(expectedName);
  const expectedTokens = new Set(expectedNorm.split(/\s+/).filter(t => t.length > 2));

  // Check restaurant_name field on items
  const restaurantNames = new Map();
  for (const item of items) {
    const rName = item.restaurant_name || item.restaurantTitle || item.restaurant?.name || "";
    if (rName) {
      restaurantNames.set(rName, (restaurantNames.get(rName) || 0) + 1);
    }
  }

  // If multiple distinct restaurant names, possible contamination
  const suspiciousNames = [];
  for (const [name, count] of restaurantNames.entries()) {
    const nameNorm = normalizeText(name);
    const nameTokens = new Set(nameNorm.split(/\s+/).filter(t => t.length > 2));

    // Check token overlap
    let overlap = 0;
    for (const t of nameTokens) {
      if (expectedTokens.has(t)) overlap++;
    }

    const similarity = overlap / Math.max(1, Math.min(nameTokens.size, expectedTokens.size));

    if (similarity < 0.3) {
      suspiciousNames.push({ name, count, similarity });
    }
  }

  const totalItems = items.length;
  const suspiciousCount = suspiciousNames.reduce((sum, s) => sum + s.count, 0);
  const suspiciousRatio = suspiciousCount / totalItems;

  return {
    hasMismatch: suspiciousRatio > 0.20, // More than 20% from different restaurant
    confidence: suspiciousRatio,
    suspiciousNames
  };
}

/**
 * Normalize text for comparison
 */
function normalizeText(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================================
// SECTION C: CATEGORY NORMALIZATION
// ============================================================================

/**
 * Canonical category mapping
 */
const CANONICAL_CATEGORIES = {
  // Appetizers
  appetizers: ["appetizers", "starters", "small plates", "snacks", "shareables", "apps"],

  // Main courses
  entrees: ["entrees", "mains", "main course", "dinner", "lunch entrees", "plates"],
  burgers: ["burgers", "hamburgers", "smashburgers", "signature burgers"],
  sandwiches: ["sandwiches", "subs", "hoagies", "melts", "paninis", "wraps"],
  pizza: ["pizza", "pizzas", "flatbreads", "calzones"],
  pasta: ["pasta", "pastas", "noodles", "spaghetti"],
  tacos: ["tacos", "hard tacos", "soft tacos", "street tacos"],
  burritos: ["burritos", "burrito bowls"],
  bowls: ["bowls", "rice bowls", "poke bowls", "grain bowls"],
  salads: ["salads", "fresh salads", "garden salads"],
  soups: ["soups", "soup & salad", "chili"],

  // Proteins
  chicken: ["chicken", "poultry", "wings", "tenders", "nuggets"],
  seafood: ["seafood", "fish", "shrimp", "sushi", "sashimi"],

  // Sides
  sides: ["sides", "side dishes", "extras", "add-ons", "accompaniments"],
  fries: ["fries", "french fries", "loaded fries", "curly fries"],

  // Drinks
  beverages: ["beverages", "drinks", "sodas", "refreshments"],
  coffee: ["coffee", "hot coffee", "espresso", "lattes", "cappuccinos"],
  cold_drinks: ["cold drinks", "iced drinks", "smoothies", "shakes", "frappes"],

  // Sweet
  desserts: ["desserts", "sweets", "treats", "bakery", "pastries"],

  // Meals/Combos
  combos: ["combos", "meals", "value meals", "specials"],
  kids: ["kids", "kids meals", "children's menu", "junior"],

  // Time-based
  breakfast: ["breakfast", "morning", "brunch", "am favorites"],
  lunch: ["lunch", "lunch specials", "midday"],

  // Featured
  featured: ["featured", "popular", "most popular", "bestsellers", "favorites"]
};

/**
 * Map a section name to a canonical category
 * @param {string} sectionName - Original section name
 * @returns {string} - Canonical category name
 */
function mapToCanonicalCategory(sectionName) {
  const norm = normalizeText(sectionName);

  for (const [canonical, variants] of Object.entries(CANONICAL_CATEGORIES)) {
    for (const variant of variants) {
      if (norm.includes(variant) || variant.includes(norm)) {
        // Capitalize first letter of each word
        return canonical.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      }
    }
  }

  // If no match, return original with title case
  return sectionName.split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Suggested category order for restaurant-like menus
 */
const CATEGORY_ORDER = [
  "Featured",
  "Popular",
  "Breakfast",
  "Appetizers",
  "Soups",
  "Salads",
  "Bowls",
  "Tacos",
  "Burritos",
  "Sandwiches",
  "Burgers",
  "Pizza",
  "Pasta",
  "Entrees",
  "Chicken",
  "Seafood",
  "Sides",
  "Fries",
  "Kids",
  "Combos",
  "Desserts",
  "Coffee",
  "Cold Drinks",
  "Beverages"
];

/**
 * Sort sections by canonical order
 * @param {Array} sections - Array of { name, items }
 * @returns {Array} - Sorted sections
 */
function sortSectionsByCanonicalOrder(sections) {
  return [...sections].sort((a, b) => {
    const aName = mapToCanonicalCategory(a.name);
    const bName = mapToCanonicalCategory(b.name);

    const aIdx = CATEGORY_ORDER.indexOf(aName);
    const bIdx = CATEGORY_ORDER.indexOf(bName);

    // If both found in order, use that
    if (aIdx >= 0 && bIdx >= 0) {
      return aIdx - bIdx;
    }
    // Known categories come before unknown
    if (aIdx >= 0) return -1;
    if (bIdx >= 0) return 1;
    // Unknown categories in alphabetical order
    return aName.localeCompare(bName);
  });
}

// ============================================================================
// SECTION D: MENU ANOMALY DETECTION
// ============================================================================

/**
 * Detect menu-level anomalies that suggest bad data
 * @param {object} menu - Normalized menu with sections and items
 * @returns {{ hasSuspicious: boolean, alerts: Array }}
 */
function detectMenuAnomalies(menu) {
  const alerts = [];

  const sections = menu.sections || [];
  const allItems = sections.flatMap(s => s.items || []);
  const totalItems = allItems.length;
  const totalSections = sections.length;

  // 1. Suspiciously high item count (possible inventory dump)
  if (totalItems > 300) {
    alerts.push({
      type: "HIGH_ITEM_COUNT",
      severity: "warning",
      message: `Menu has ${totalItems} items (typical: 20-150)`,
      threshold: 300
    });
  }

  // 2. Suspiciously low item count
  if (totalItems < 3 && totalSections > 0) {
    alerts.push({
      type: "LOW_ITEM_COUNT",
      severity: "error",
      message: `Menu has only ${totalItems} items`,
      threshold: 3
    });
  }

  // 3. Too many sections (possible category explosion)
  if (totalSections > 30) {
    alerts.push({
      type: "HIGH_SECTION_COUNT",
      severity: "warning",
      message: `Menu has ${totalSections} sections (typical: 5-20)`,
      threshold: 30
    });
  }

  // 4. Empty sections
  const emptySections = sections.filter(s => !s.items || s.items.length === 0);
  if (emptySections.length > 0) {
    alerts.push({
      type: "EMPTY_SECTIONS",
      severity: "warning",
      message: `${emptySections.length} empty sections`,
      sections: emptySections.map(s => s.name)
    });
  }

  // 5. Duplicate items across sections
  const itemNames = new Map();
  for (const item of allItems) {
    const name = normalizeText(item.name || item.title || "");
    if (name) {
      itemNames.set(name, (itemNames.get(name) || 0) + 1);
    }
  }

  const duplicates = [...itemNames.entries()]
    .filter(([, count]) => count > 2)
    .map(([name, count]) => ({ name, count }));

  if (duplicates.length > 5) {
    alerts.push({
      type: "EXCESSIVE_DUPLICATES",
      severity: "warning",
      message: `${duplicates.length} items appear more than twice`,
      examples: duplicates.slice(0, 5)
    });
  }

  // 6. Price anomalies
  const prices = allItems
    .map(i => i.price_cents || i.price)
    .filter(p => p != null && p > 0);

  if (prices.length > 0) {
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);

    // Cents vs dollars confusion
    if (avgPrice > 10000) {
      alerts.push({
        type: "PRICE_UNIT_CONFUSION",
        severity: "warning",
        message: `Average price ${avgPrice} suggests cents stored as dollars`,
        avg: avgPrice
      });
    }

    // Extreme price range
    if (maxPrice > minPrice * 100 && minPrice > 0) {
      alerts.push({
        type: "EXTREME_PRICE_RANGE",
        severity: "warning",
        message: `Price range ${minPrice}-${maxPrice} is unusually wide`,
        min: minPrice,
        max: maxPrice
      });
    }
  }

  const hasSuspicious = alerts.some(a => a.severity === "error") ||
    alerts.filter(a => a.severity === "warning").length >= 3;

  return { hasSuspicious, alerts };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Junk detection
  detectJunkItem,
  filterJunkItems,
  JUNK_PATTERNS,
  VALID_PATTERNS,

  // Cross-contamination
  detectCuisineContamination,
  detectRestaurantMismatch,
  CUISINE_SIGNATURES,

  // Category normalization
  mapToCanonicalCategory,
  sortSectionsByCanonicalOrder,
  CANONICAL_CATEGORIES,
  CATEGORY_ORDER,

  // Menu anomalies
  detectMenuAnomalies,

  // Utils
  normalizeText
};
