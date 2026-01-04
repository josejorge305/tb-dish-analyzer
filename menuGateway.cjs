const fs = require("fs");

/**
 * Menu Gateway v1
 *
 * SINGLE SOURCE OF TRUTH for all menu requests.
 * Routes through in-house Uber Menu Pipeline (V1 + V2 + Tier Resolver).
 *
 * THIS REPLACES:
 * - Apify Uber Eats actors (deprecated)
 * - RapidAPI Uber Eats endpoints (deprecated)
 *
 * All menu requests MUST route through:
 * - menuTierResolver.cjs (tier selection)
 * - serveMenu.cjs (menu loading)
 *
 * NO direct scraper calls.
 * NO third-party APIs.
 *
 * Cache Enforcement:
 * - Tier 1 TTL = 15 days
 * - Tier 2 TTL = 7 days
 * - Scrapers NEVER run on user request
 * - Scrapers ONLY run via scheduler / maintenance jobs
 */

// Import tier resolver and menu server
let resolveTier, getMenuByRestaurant, getMenuByFranchise;

try {
  const tierResolver = require("./menuTierResolver.cjs");
  resolveTier = tierResolver.resolveTier;
} catch (e) {
  resolveTier = null;
}

try {
  const serveMenu = require("./serveMenu.cjs");
  getMenuByRestaurant = serveMenu.getMenuByRestaurant;
  getMenuByFranchise = serveMenu.getMenuByFranchise;
} catch (e) {
  getMenuByRestaurant = null;
  getMenuByFranchise = null;
}

/**
 * Load JSON file safely
 */
function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    return null;
  }
}

/**
 * Normalize menu to published_menu.json format
 * This is the ONLY format frontend expects
 */
function normalizeToPublishedFormat(menu, tierDecision) {
  if (!menu) {
    return null;
  }

  // Already in correct format from serveMenu.cjs
  const normalized = {
    restaurant: {
      name: menu.restaurant_name || menu.restaurant || tierDecision?.restaurant || "Unknown",
      slug: menu.restaurant_slug || tierDecision?.restaurant_slug || null,
      source: menu.source || tierDecision?.source_type || "in_house_pipeline"
    },
    sections: [],
    menu_version_id: menu.menu_version_id || null,
    has_warning: tierDecision?.warning_flag || false,
    metadata: {
      served_tier: tierDecision?.served_tier || "unknown",
      cache_status: tierDecision?.cache_status || "unknown",
      confidence_score: tierDecision?.confidence_score || null,
      source_file: tierDecision?.source_file || null,
      resolved_at: tierDecision?.resolved_at || new Date().toISOString()
    }
  };

  // Group items into sections by canonical_category
  const categoryGroups = {};
  const items = menu.items || [];

  for (const item of items) {
    const category = item.canonical_category || "Other";
    if (!categoryGroups[category]) {
      categoryGroups[category] = [];
    }

    categoryGroups[category].push({
      id: item.id || null,
      name: item.name || "",
      description: item.description || null,
      price_cents: item.price_cents || null,
      image_url: item.image_url || null
    });
  }

  // Convert to sections array
  const categoryOrder = ["mains", "appetizers", "sides", "desserts", "drinks", "combos", "Other"];

  for (const category of categoryOrder) {
    if (categoryGroups[category] && categoryGroups[category].length > 0) {
      normalized.sections.push({
        name: category.charAt(0).toUpperCase() + category.slice(1),
        items: categoryGroups[category]
      });
    }
  }

  // Add any remaining categories not in order
  for (const [category, sectionItems] of Object.entries(categoryGroups)) {
    if (!categoryOrder.includes(category) && sectionItems.length > 0) {
      normalized.sections.push({
        name: category.charAt(0).toUpperCase() + category.slice(1),
        items: sectionItems
      });
    }
  }

  return normalized;
}

/**
 * Get menu for app - MAIN ENTRY POINT
 *
 * This is the SINGLE function all menu requests must use.
 * Returns published_menu.json-compatible payload.
 *
 * @param {string} restaurantSlug - Restaurant identifier
 * @param {string} locationSlug - Optional location identifier for franchises
 * @param {object} options - Optional configuration
 * @returns {object} Menu in published_menu.json format
 */
function getMenuForApp(restaurantSlug, locationSlug = null, options = {}) {
  if (!restaurantSlug) {
    return {
      ok: false,
      error: "Missing restaurant_slug",
      restaurant: null,
      sections: [],
      has_warning: false
    };
  }

  // Step 1: Resolve tier
  let tierDecision = null;
  if (resolveTier) {
    tierDecision = resolveTier(restaurantSlug, locationSlug, options);
  }

  // Step 2: Load menu based on tier decision
  let menu = null;

  if (tierDecision) {
    // Use tier decision to load appropriate menu
    if (locationSlug && getMenuByFranchise) {
      // Try franchise first
      const franchiseName = restaurantSlug.split("-")[0]; // Extract franchise prefix
      menu = getMenuByFranchise(franchiseName, locationSlug, options);
    }

    if (!menu && getMenuByRestaurant) {
      menu = getMenuByRestaurant(restaurantSlug, options);
    }
  } else if (getMenuByRestaurant) {
    // Fallback: use serveMenu directly
    menu = getMenuByRestaurant(restaurantSlug, options);
  }

  // Step 3: Try loading directly from files if module loading failed
  if (!menu) {
    // Try tier 2 sources first
    const franchiseMenu = loadJSON("franchise_resolved_menu.json");
    if (franchiseMenu && franchiseMenu.locations) {
      const location = franchiseMenu.locations.find(
        loc => loc.location_slug === (locationSlug || restaurantSlug)
      );
      if (location) {
        menu = {
          restaurant_name: franchiseMenu.franchise,
          restaurant_slug: location.location_slug,
          source: "v3_franchise",
          items: location.items || []
        };
      }
    }

    if (!menu) {
      const adjudicatedMenu = loadJSON("adjudicated_menu.json");
      if (adjudicatedMenu && adjudicatedMenu.items) {
        menu = {
          restaurant_name: adjudicatedMenu.restaurant?.name || restaurantSlug,
          restaurant_slug: restaurantSlug,
          source: "v2_adjudicated",
          items: adjudicatedMenu.items || []
        };
      }
    }

    if (!menu) {
      const publishedMenu = loadJSON("published_menu.json");
      if (publishedMenu) {
        // V1 format has sections, flatten to items
        const items = [];
        for (const section of publishedMenu.sections || []) {
          for (const item of section.items || []) {
            items.push({
              ...item,
              canonical_category: section.name || "Other"
            });
          }
        }
        menu = {
          restaurant_name: publishedMenu.restaurant?.name || restaurantSlug,
          restaurant_slug: restaurantSlug,
          source: "v1_published",
          items: items
        };
      }
    }
  }

  // Step 4: Normalize to published_menu.json format
  if (!menu) {
    return {
      ok: false,
      error: "Menu not found",
      restaurant: { name: restaurantSlug, slug: restaurantSlug },
      sections: [],
      has_warning: true,
      metadata: {
        served_tier: null,
        cache_status: "miss",
        resolved_at: new Date().toISOString()
      }
    };
  }

  const normalized = normalizeToPublishedFormat(menu, tierDecision);

  return {
    ok: true,
    ...normalized
  };
}

/**
 * Handle menu API request
 *
 * GET /menu/{restaurant_slug}?location={location_slug}
 *
 * Response shape:
 * - published_menu.json format ONLY
 * - Optional metadata: menu_version_id, has_warning (boolean)
 *
 * @param {string} restaurantSlug - From URL path
 * @param {string} locationSlug - From query param
 * @param {object} options - Optional configuration
 * @returns {object} API response
 */
function handleMenuRequest(restaurantSlug, locationSlug = null, options = {}) {
  const result = getMenuForApp(restaurantSlug, locationSlug, options);

  // Build API response
  const response = {
    ok: result.ok,
    restaurant: result.restaurant,
    sections: result.sections,
    menu_version_id: result.menu_version_id || null,
    has_warning: result.has_warning || false
  };

  // Include error if present
  if (result.error) {
    response.error = result.error;
  }

  // Optionally include metadata for debugging
  if (options.includeMetadata) {
    response.metadata = result.metadata;
  }

  return response;
}

/**
 * Check if legacy menu sources should be used
 * Reads USE_LEGACY_MENU_SOURCE flag
 *
 * Default: false (use in-house pipeline)
 */
function shouldUseLegacySource(env = {}) {
  const flag = env.USE_LEGACY_MENU_SOURCE ||
               process.env.USE_LEGACY_MENU_SOURCE ||
               "false";

  return flag === "true" || flag === "1";
}

/**
 * Get deprecation warning for legacy calls
 */
function getLegacyDeprecationWarning(source) {
  return {
    deprecated: true,
    warning: `${source} is deprecated - use in-house menu pipeline instead`,
    migration: "All menu requests should route through menuGateway.getMenuForApp()",
    docs: "See FINAL_PIPELINE_README.md and FINAL_PIPELINE_V2_README.md"
  };
}

// Run example if called directly
if (require.main === module) {
  console.log("🚪 Menu Gateway v1\n");
  console.log("═".repeat(60));
  console.log("MENU GATEWAY - SINGLE SOURCE OF TRUTH");
  console.log("═".repeat(60));

  const restaurantSlug = process.argv[2] || "shake-shack-coral-gables";
  const locationSlug = process.argv[3] || null;

  console.log(`\n📍 Restaurant: ${restaurantSlug}`);
  if (locationSlug) {
    console.log(`📍 Location: ${locationSlug}`);
  }

  const result = getMenuForApp(restaurantSlug, locationSlug);

  console.log(`\n✅ OK: ${result.ok}`);
  console.log(`📋 Restaurant: ${result.restaurant?.name || "Unknown"}`);
  console.log(`📋 Sections: ${result.sections?.length || 0}`);
  console.log(`⚠️  Has Warning: ${result.has_warning}`);

  if (result.metadata) {
    console.log(`\n📊 Metadata:`);
    console.log(`   Tier: ${result.metadata.served_tier}`);
    console.log(`   Cache: ${result.metadata.cache_status}`);
    console.log(`   Confidence: ${result.metadata.confidence_score}`);
  }

  // Count total items
  let totalItems = 0;
  for (const section of result.sections || []) {
    totalItems += section.items?.length || 0;
  }
  console.log(`\n📋 Total Items: ${totalItems}`);

  // Save sample output
  const outputPath = "menu_gateway_response.json";
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\n💾 Saved: ${outputPath}`);

  console.log("\n✅ Gateway ready\n");
}

module.exports = {
  getMenuForApp,
  handleMenuRequest,
  shouldUseLegacySource,
  getLegacyDeprecationWarning
};
