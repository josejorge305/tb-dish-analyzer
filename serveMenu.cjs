const fs = require("fs");
const path = require("path");

/**
 * Menu Serving Layer v1
 *
 * Lightweight serving layer that exposes resolved menus
 * (V1, V2, Franchise) via simple function interface.
 *
 * Pure read-only logic - no AI, no scraping, no HTTP.
 *
 * Selection priority:
 * 1. Franchise resolved menu (if exists for location)
 * 2. V2 adjudicated menu (if confidence >= threshold)
 * 3. V1 published menu (fallback)
 *
 * Usage:
 *   const { getMenuByRestaurant, getMenuByFranchise, getMenuVersionInfo } = require("./serveMenu.cjs");
 *
 *   // Get menu for a restaurant
 *   const menu = getMenuByRestaurant("shake-shack-coral-gables");
 *
 *   // Get franchise location menu
 *   const menu = getMenuByFranchise("shake-shack", "shake-shack-downtown-miami");
 *
 *   // Get version info
 *   const info = getMenuVersionInfo("shake-shack-coral-gables");
 */

// Default confidence threshold for V2
const DEFAULT_CONFIDENCE_THRESHOLD = 0.4;

// Cache for loaded files
const fileCache = new Map();

/**
 * Load JSON file with caching
 */
function loadJSON(filePath) {
  if (fileCache.has(filePath)) {
    return fileCache.get(filePath);
  }

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    fileCache.set(filePath, data);
    return data;
  } catch (e) {
    console.error(`⚠️ Could not parse: ${filePath} - ${e.message}`);
    return null;
  }
}

/**
 * Load routes configuration
 */
function loadRoutesConfig(configPath = "routes.config.json") {
  const config = loadJSON(configPath);

  if (!config) {
    return {
      default_paths: {
        v1_menu: "published_menu.json",
        v2_menu: "adjudicated_menu.json",
        v2_confidence: "menu_confidence_report.json",
        franchise_menu: "franchise_resolved_menu.json"
      },
      restaurants: {},
      franchises: {},
      confidence_threshold: DEFAULT_CONFIDENCE_THRESHOLD
    };
  }

  return config;
}

/**
 * Get paths for a restaurant from config
 */
function getRestaurantPaths(slug, config) {
  const restaurantConfig = config.restaurants?.[slug];

  if (restaurantConfig) {
    return {
      v1_menu: restaurantConfig.v1_menu || config.default_paths?.v1_menu || "published_menu.json",
      v2_menu: restaurantConfig.v2_menu || config.default_paths?.v2_menu || "adjudicated_menu.json",
      v2_confidence: restaurantConfig.v2_confidence || config.default_paths?.v2_confidence || "menu_confidence_report.json",
      franchise_menu: restaurantConfig.franchise_menu || config.default_paths?.franchise_menu || "franchise_resolved_menu.json"
    };
  }

  return {
    v1_menu: config.default_paths?.v1_menu || "published_menu.json",
    v2_menu: config.default_paths?.v2_menu || "adjudicated_menu.json",
    v2_confidence: config.default_paths?.v2_confidence || "menu_confidence_report.json",
    franchise_menu: config.default_paths?.franchise_menu || "franchise_resolved_menu.json"
  };
}

/**
 * Get confidence score from V2 report
 */
function getV2Confidence(confidencePath) {
  const report = loadJSON(confidencePath);

  if (!report) {
    return 0;
  }

  return report.confidence_score || 0;
}

/**
 * Extract items from V1 published_menu.json format
 */
function normalizeV1Menu(menu, slug) {
  if (!menu || !menu.sections) {
    return null;
  }

  const items = [];
  let idCounter = 1;

  for (const section of menu.sections) {
    if (!section.items) continue;

    for (const item of section.items) {
      items.push({
        id: item.id || `v1-${idCounter++}`,
        name: item.name || "",
        description: item.description || null,
        price_cents: item.price_cents || null,
        image_url: item.image_url || null,
        canonical_category: section.name || "unknown"
      });
    }
  }

  return {
    restaurant_slug: slug,
    source: "v1_published",
    source_file: "published_menu.json",
    restaurant_name: menu.restaurant?.name || slug,
    menu_version_id: menu.menu_version_id || null,
    item_count: items.length,
    items: items
  };
}

/**
 * Normalize V2 adjudicated_menu.json format
 */
function normalizeV2Menu(menu, slug, confidence) {
  if (!menu || !menu.items) {
    return null;
  }

  return {
    restaurant_slug: slug,
    source: "v2_adjudicated",
    source_file: "adjudicated_menu.json",
    restaurant_name: menu.restaurant?.name || slug,
    menu_version_id: menu.menu_version_id || null,
    confidence_score: confidence,
    item_count: menu.items.length,
    items: menu.items.map((item, idx) => ({
      id: item.id || `v2-${idx + 1}`,
      name: item.name || "",
      description: item.description || null,
      price_cents: item.price_cents || null,
      image_url: item.image_url || null,
      canonical_category: item.canonical_category || "unknown",
      source_decision: item.source_decision || null
    }))
  };
}

/**
 * Get menu for a franchise location from resolved menu
 */
function getFranchiseLocationMenu(franchiseMenu, locationSlug) {
  if (!franchiseMenu || !franchiseMenu.locations) {
    return null;
  }

  const location = franchiseMenu.locations.find(loc => loc.location_slug === locationSlug);

  if (!location) {
    return null;
  }

  return {
    restaurant_slug: locationSlug,
    source: "v3_franchise",
    source_file: "franchise_resolved_menu.json",
    franchise_name: franchiseMenu.franchise,
    canonical_location: franchiseMenu.canonical_location,
    menu_version_id: location.source_menu_version_id || null,
    price_adjustment: location.price_adjustment,
    item_count: location.items.length,
    items: location.items
  };
}

/**
 * Get menu by restaurant slug
 *
 * Selection priority:
 * 1. Franchise resolved menu (if exists for this slug as location)
 * 2. V2 adjudicated menu (if confidence >= threshold)
 * 3. V1 published menu (fallback)
 *
 * @param {string} slug - Restaurant slug identifier
 * @param {object} options - Optional settings
 * @param {string} options.configPath - Path to routes.config.json
 * @param {number} options.confidenceThreshold - Override confidence threshold
 * @returns {object|null} Normalized menu object or null if not found
 */
function getMenuByRestaurant(slug, options = {}) {
  const configPath = options.configPath || "routes.config.json";
  const config = loadRoutesConfig(configPath);
  const threshold = options.confidenceThreshold ?? config.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  const paths = getRestaurantPaths(slug, config);

  // 1. Try franchise resolved menu
  const franchiseMenu = loadJSON(paths.franchise_menu);
  if (franchiseMenu) {
    const locationMenu = getFranchiseLocationMenu(franchiseMenu, slug);
    if (locationMenu) {
      return locationMenu;
    }
  }

  // 2. Try V2 with confidence check
  const v2Confidence = getV2Confidence(paths.v2_confidence);
  if (v2Confidence >= threshold) {
    const v2Menu = loadJSON(paths.v2_menu);
    if (v2Menu) {
      const normalized = normalizeV2Menu(v2Menu, slug, v2Confidence);
      if (normalized) {
        return normalized;
      }
    }
  }

  // 3. Fallback to V1
  const v1Menu = loadJSON(paths.v1_menu);
  if (v1Menu) {
    return normalizeV1Menu(v1Menu, slug);
  }

  return null;
}

/**
 * Get menu by franchise and location
 *
 * Directly fetches from franchise_resolved_menu.json
 *
 * @param {string} franchiseName - Franchise name (e.g., "shake-shack")
 * @param {string} locationSlug - Location slug identifier
 * @param {object} options - Optional settings
 * @returns {object|null} Normalized menu object or null if not found
 */
function getMenuByFranchise(franchiseName, locationSlug, options = {}) {
  const configPath = options.configPath || "routes.config.json";
  const config = loadRoutesConfig(configPath);

  // Check franchise config
  const franchiseConfig = config.franchises?.[franchiseName];
  const franchisePath = franchiseConfig?.resolved_menu || config.default_paths?.franchise_menu || "franchise_resolved_menu.json";

  const franchiseMenu = loadJSON(franchisePath);

  if (!franchiseMenu) {
    return null;
  }

  // Verify franchise name matches (case-insensitive)
  const normalizedFranchise = franchiseName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const menuFranchise = (franchiseMenu.franchise || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  if (normalizedFranchise !== menuFranchise && !menuFranchise.includes(normalizedFranchise)) {
    return null;
  }

  return getFranchiseLocationMenu(franchiseMenu, locationSlug);
}

/**
 * Get version info for a restaurant
 *
 * Returns metadata about available menu sources without loading full menus
 *
 * @param {string} slug - Restaurant slug identifier
 * @param {object} options - Optional settings
 * @returns {object} Version info object
 */
function getMenuVersionInfo(slug, options = {}) {
  const configPath = options.configPath || "routes.config.json";
  const config = loadRoutesConfig(configPath);
  const threshold = config.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  const paths = getRestaurantPaths(slug, config);

  const info = {
    restaurant_slug: slug,
    queried_at: new Date().toISOString(),
    confidence_threshold: threshold,
    sources: {
      v1: {
        available: false,
        path: paths.v1_menu,
        item_count: null
      },
      v2: {
        available: false,
        path: paths.v2_menu,
        confidence_score: null,
        meets_threshold: false,
        item_count: null
      },
      franchise: {
        available: false,
        path: paths.franchise_menu,
        franchise_name: null,
        location_found: false,
        item_count: null
      }
    },
    selected_source: null
  };

  // Check V1
  const v1Menu = loadJSON(paths.v1_menu);
  if (v1Menu) {
    info.sources.v1.available = true;
    let count = 0;
    for (const section of v1Menu.sections || []) {
      count += section.items?.length || 0;
    }
    info.sources.v1.item_count = count;
  }

  // Check V2
  const v2Menu = loadJSON(paths.v2_menu);
  const v2Confidence = getV2Confidence(paths.v2_confidence);
  if (v2Menu) {
    info.sources.v2.available = true;
    info.sources.v2.confidence_score = v2Confidence;
    info.sources.v2.meets_threshold = v2Confidence >= threshold;
    info.sources.v2.item_count = v2Menu.items?.length || 0;
  }

  // Check franchise
  const franchiseMenu = loadJSON(paths.franchise_menu);
  if (franchiseMenu) {
    info.sources.franchise.available = true;
    info.sources.franchise.franchise_name = franchiseMenu.franchise;

    const location = franchiseMenu.locations?.find(loc => loc.location_slug === slug);
    if (location) {
      info.sources.franchise.location_found = true;
      info.sources.franchise.item_count = location.items?.length || 0;
    }
  }

  // Determine selected source
  if (info.sources.franchise.location_found) {
    info.selected_source = "v3_franchise";
  } else if (info.sources.v2.meets_threshold) {
    info.selected_source = "v2_adjudicated";
  } else if (info.sources.v1.available) {
    info.selected_source = "v1_published";
  } else {
    info.selected_source = null;
  }

  return info;
}

/**
 * Clear file cache (useful for testing or reloading)
 */
function clearCache() {
  fileCache.clear();
}

/**
 * List all available restaurants from config and loaded menus
 */
function listAvailableRestaurants(options = {}) {
  const configPath = options.configPath || "routes.config.json";
  const config = loadRoutesConfig(configPath);

  const restaurants = new Set();

  // From config
  for (const slug of Object.keys(config.restaurants || {})) {
    restaurants.add(slug);
  }

  // From franchise menu
  const franchisePath = config.default_paths?.franchise_menu || "franchise_resolved_menu.json";
  const franchiseMenu = loadJSON(franchisePath);
  if (franchiseMenu && franchiseMenu.locations) {
    for (const loc of franchiseMenu.locations) {
      restaurants.add(loc.location_slug);
    }
  }

  return Array.from(restaurants).sort();
}

// Run example if called directly
if (require.main === module) {
  console.log("🍽️  Menu Serving Layer v1\n");
  console.log("═".repeat(60));
  console.log("EXAMPLE USAGE");
  console.log("═".repeat(60));

  // Example 1: Get menu by restaurant
  console.log("\n📍 getMenuByRestaurant('shake-shack-coral-gables'):");
  const menu1 = getMenuByRestaurant("shake-shack-coral-gables");
  if (menu1) {
    console.log(`   Source: ${menu1.source}`);
    console.log(`   Items: ${menu1.item_count}`);
  } else {
    console.log("   Not found");
  }

  // Example 2: Get menu by franchise
  console.log("\n📍 getMenuByFranchise('shake-shack', 'shake-shack-downtown-miami'):");
  const menu2 = getMenuByFranchise("shake-shack", "shake-shack-downtown-miami");
  if (menu2) {
    console.log(`   Source: ${menu2.source}`);
    console.log(`   Price adjustment: ${menu2.price_adjustment || "none"}`);
    console.log(`   Items: ${menu2.item_count}`);
  } else {
    console.log("   Not found");
  }

  // Example 3: Get version info
  console.log("\n📍 getMenuVersionInfo('shake-shack-coral-gables'):");
  const info = getMenuVersionInfo("shake-shack-coral-gables");
  console.log(`   V1 available: ${info.sources.v1.available} (${info.sources.v1.item_count} items)`);
  console.log(`   V2 available: ${info.sources.v2.available} (confidence: ${info.sources.v2.confidence_score})`);
  console.log(`   V2 meets threshold: ${info.sources.v2.meets_threshold}`);
  console.log(`   Franchise available: ${info.sources.franchise.location_found}`);
  console.log(`   Selected source: ${info.selected_source}`);

  // Example 4: List available restaurants
  console.log("\n📍 listAvailableRestaurants():");
  const available = listAvailableRestaurants();
  for (const slug of available) {
    console.log(`   - ${slug}`);
  }

  console.log("\n✅ Serving layer ready\n");
}

module.exports = {
  getMenuByRestaurant,
  getMenuByFranchise,
  getMenuVersionInfo,
  listAvailableRestaurants,
  clearCache
};
