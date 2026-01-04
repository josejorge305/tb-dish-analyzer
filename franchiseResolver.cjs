const fs = require("fs");

/**
 * Franchise Menu Resolver v1
 *
 * Implements franchise-level menu inheritance so that one canonical
 * franchise menu can serve multiple locations with minimal re-ingestion.
 *
 * Pure deterministic logic - no AI, no scraping, no external dependencies.
 */

/**
 * Load JSON file safely
 */
function loadJSON(path) {
  if (!fs.existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(path, "utf-8"));
  } catch (e) {
    console.error(`❌ Could not parse: ${path} - ${e.message}`);
    return null;
  }
}

/**
 * Extract items from V1 published_menu.json format
 * V1 format: { sections: [{ items: [...] }] }
 */
function extractItemsFromV1(menu) {
  if (!menu || !menu.sections) {
    return [];
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
        canonical_category: section.name || "unknown",
        menu_version_id: menu.menu_version_id || null
      });
    }
  }

  return items;
}

/**
 * Extract items from V2 adjudicated_menu.json format
 * V2 format: { items: [...] }
 */
function extractItemsFromV2(menu) {
  if (!menu || !menu.items) {
    return [];
  }

  return menu.items.map((item, idx) => ({
    id: item.id || `v2-${idx + 1}`,
    name: item.name || "",
    description: item.description || null,
    price_cents: item.price_cents || null,
    image_url: item.image_url || null,
    canonical_category: item.canonical_category || "unknown",
    menu_version_id: menu.menu_version_id || null
  }));
}

/**
 * Apply price delta adjustment
 * @param {number} priceCents - Original price in cents
 * @param {number} deltaPercent - Percentage adjustment (e.g., 5 = +5%)
 * @returns {number} Adjusted price in cents
 */
function applyPriceDelta(priceCents, deltaPercent) {
  if (priceCents === null || priceCents === undefined) {
    return null;
  }

  if (deltaPercent === 0 || deltaPercent === null || deltaPercent === undefined) {
    return priceCents;
  }

  const multiplier = 1 + (deltaPercent / 100);
  return Math.round(priceCents * multiplier);
}

/**
 * Normalize item name for comparison
 */
function normalizeName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve franchise menu for a specific location
 */
function resolveForLocation(canonicalItems, locationSlug, locationConfig, franchiseName, menuVersionId) {
  const priceDeltaPercent = locationConfig?.price_delta_percent || 0;
  const excludedItems = locationConfig?.excluded_items || [];

  // Build normalized exclusion set
  const excludedSet = new Set(excludedItems.map(normalizeName));

  const resolvedItems = [];

  for (const item of canonicalItems) {
    const normalizedName = normalizeName(item.name);

    // Skip excluded items
    if (excludedSet.has(normalizedName)) {
      continue;
    }

    // Apply price adjustment
    const adjustedPrice = applyPriceDelta(item.price_cents, priceDeltaPercent);

    resolvedItems.push({
      id: item.id,
      name: item.name,
      description: item.description,
      price_cents: adjustedPrice,
      image_url: item.image_url,
      canonical_category: item.canonical_category,
      source: priceDeltaPercent !== 0 ? "location_override" : "franchise_inherited",
      menu_version_id: menuVersionId
    });
  }

  return {
    franchise: franchiseName,
    location_slug: locationSlug,
    resolved_at: new Date().toISOString(),
    source_menu_version_id: menuVersionId,
    price_adjustment: priceDeltaPercent !== 0 ? `${priceDeltaPercent > 0 ? "+" : ""}${priceDeltaPercent}%` : null,
    excluded_count: excludedItems.length,
    items: resolvedItems
  };
}

/**
 * Main resolver function
 */
function resolveFranchise(
  v1MenuPath = "published_menu.json",
  v2MenuPath = "adjudicated_menu.json",
  configPath = "franchise_config.json",
  outputPath = "franchise_resolved_menu.json"
) {
  console.log("🏢 Franchise Menu Resolver v1\n");

  // Load franchise config
  const config = loadJSON(configPath);

  if (!config) {
    console.error(`❌ Error: Could not load franchise config: ${configPath}`);
    process.exit(1);
  }

  const franchiseName = config.franchise_name || "Unknown Franchise";
  const canonicalSlug = config.canonical_location_slug;
  const locationOverrides = config.location_overrides || {};

  console.log(`📍 Franchise: ${franchiseName}`);
  console.log(`📍 Canonical location: ${canonicalSlug}`);
  console.log(`📍 Location overrides: ${Object.keys(locationOverrides).length}\n`);

  // Try to load V2 menu first (preferred), fallback to V1
  let canonicalItems = [];
  let menuVersionId = null;
  let sourceUsed = null;

  const v2Menu = loadJSON(v2MenuPath);
  if (v2Menu && v2Menu.items && v2Menu.items.length > 0) {
    canonicalItems = extractItemsFromV2(v2Menu);
    menuVersionId = v2Menu.menu_version_id || null;
    sourceUsed = "v2_adjudicated";
    console.log(`📥 Using V2 adjudicated menu: ${v2MenuPath}`);
    console.log(`   Items: ${canonicalItems.length}`);
  } else {
    const v1Menu = loadJSON(v1MenuPath);
    if (v1Menu) {
      canonicalItems = extractItemsFromV1(v1Menu);
      menuVersionId = v1Menu.menu_version_id || null;
      sourceUsed = "v1_published";
      console.log(`📥 Using V1 published menu: ${v1MenuPath}`);
      console.log(`   Items: ${canonicalItems.length}`);
    }
  }

  if (canonicalItems.length === 0) {
    console.error("\n❌ Error: No canonical menu items found");
    console.error(`   Checked: ${v2MenuPath}, ${v1MenuPath}`);
    process.exit(1);
  }

  console.log(`\n🔄 Resolving menus for ${1 + Object.keys(locationOverrides).length} location(s)...\n`);

  // Resolve for all locations
  const allResolved = [];

  // 1. Canonical location (no overrides)
  const canonicalResolved = resolveForLocation(
    canonicalItems,
    canonicalSlug,
    null,
    franchiseName,
    menuVersionId
  );
  allResolved.push(canonicalResolved);
  console.log(`   ✅ ${canonicalSlug}: ${canonicalResolved.items.length} items (canonical)`);

  // 2. Override locations
  for (const [locationSlug, locationConfig] of Object.entries(locationOverrides)) {
    const resolved = resolveForLocation(
      canonicalItems,
      locationSlug,
      locationConfig,
      franchiseName,
      menuVersionId
    );
    allResolved.push(resolved);

    const delta = locationConfig.price_delta_percent || 0;
    const excluded = locationConfig.excluded_items?.length || 0;
    const deltaStr = delta !== 0 ? ` (${delta > 0 ? "+" : ""}${delta}% price)` : "";
    const excludeStr = excluded > 0 ? ` (-${excluded} items)` : "";

    console.log(`   ✅ ${locationSlug}: ${resolved.items.length} items${deltaStr}${excludeStr}`);
  }

  // Build output
  const output = {
    generated_at: new Date().toISOString(),
    franchise: franchiseName,
    canonical_location: canonicalSlug,
    source_used: sourceUsed,
    source_menu_version_id: menuVersionId,
    total_locations: allResolved.length,
    locations: allResolved
  };

  // Save output
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  // Print summary
  console.log("\n" + "═".repeat(60));
  console.log("FRANCHISE RESOLUTION COMPLETE");
  console.log("═".repeat(60));

  console.log(`\n📊 Summary:`);
  console.log(`   Franchise: ${franchiseName}`);
  console.log(`   Source: ${sourceUsed}`);
  console.log(`   Canonical items: ${canonicalItems.length}`);
  console.log(`   Locations resolved: ${allResolved.length}`);

  console.log(`\n📁 Output: ${outputPath}`);
  console.log("\n✅ Franchise resolution complete\n");

  return output;
}

// Run if called directly
if (require.main === module) {
  const v1MenuPath = process.argv[2] || "published_menu.json";
  const v2MenuPath = process.argv[3] || "adjudicated_menu.json";
  const configPath = process.argv[4] || "franchise_config.json";
  const outputPath = process.argv[5] || "franchise_resolved_menu.json";

  resolveFranchise(v1MenuPath, v2MenuPath, configPath, outputPath);
}

module.exports = { resolveFranchise, resolveForLocation, applyPriceDelta };
