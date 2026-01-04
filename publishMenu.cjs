const fs = require("fs");
const path = require("path");

/**
 * Menu Publish / Cache-Ready Export
 *
 * Prepares the final consumer-ready menu payload.
 * Pure export/packaging logic - no AI, no scraping.
 */

const SNAPSHOTS_DIR = "./snapshots";

/**
 * Load latest snapshot for a restaurant
 */
function loadLatestSnapshot(restaurantSlug) {
  const snapshotDir = path.join(SNAPSHOTS_DIR, restaurantSlug);
  const latestPath = path.join(snapshotDir, "latest.json");

  if (!fs.existsSync(latestPath)) {
    return null;
  }

  const latestData = JSON.parse(fs.readFileSync(latestPath, "utf-8"));
  const snapshotPath = path.join(snapshotDir, latestData.snapshot_file);

  if (!fs.existsSync(snapshotPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
}

/**
 * Load diff report if exists
 */
function loadDiffReport(diffPath) {
  if (!fs.existsSync(diffPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(diffPath, "utf-8"));
  } catch (e) {
    return null;
  }
}

/**
 * Strip internal-only fields from item
 */
function stripInternalFields(item) {
  return {
    id: item.source_id,
    name: item.name,
    price_cents: item.price_cents,
    calories: item.calories ? {
      min: item.calories.min,
      max: item.calories.max
    } : null,
    image_url: item.image_url
  };
}

/**
 * Group items by category
 */
function groupByCategory(items) {
  const categoryMap = {};

  for (const item of items) {
    const cat = item.canonical_category || "mains";
    if (!categoryMap[cat]) {
      categoryMap[cat] = [];
    }
    categoryMap[cat].push(stripInternalFields(item));
  }

  // Convert to array, sorted by category name
  const categoryOrder = [
    "mains",
    "appetizers",
    "sides",
    "combos",
    "kids",
    "desserts",
    "drinks",
    "catering"
  ];

  const categories = [];
  for (const catName of categoryOrder) {
    if (categoryMap[catName] && categoryMap[catName].length > 0) {
      categories.push({
        name: catName,
        items: categoryMap[catName]
      });
    }
  }

  // Add any remaining categories not in order
  for (const [catName, items] of Object.entries(categoryMap)) {
    if (!categoryOrder.includes(catName) && items.length > 0) {
      categories.push({
        name: catName,
        items: items
      });
    }
  }

  return categories;
}

/**
 * Main publish function
 */
function publishMenu(restaurantSlug, diffPath = "menu_diff_report.json", outputPath = "published_menu.json") {
  console.log("📦 Starting menu publish...\\n");

  // Load latest snapshot
  const snapshot = loadLatestSnapshot(restaurantSlug);
  if (!snapshot) {
    console.error(`❌ Could not load latest snapshot for "${restaurantSlug}"`);
    const errorResult = {
      published: false,
      error: `No snapshot found for "${restaurantSlug}"`
    };
    fs.writeFileSync(outputPath, JSON.stringify(errorResult, null, 2));
    return errorResult;
  }

  console.log(`📊 Restaurant: ${snapshot.restaurant?.name || restaurantSlug}`);
  console.log(`📊 Version: ${snapshot.menu_version_id}`);
  console.log(`📊 Items: ${snapshot.items?.length || 0}\\n`);

  // Load diff report
  const diffReport = loadDiffReport(diffPath);
  const hasChanges = diffReport?.has_changes || false;

  if (diffReport) {
    console.log(`📊 Diff report: ${hasChanges ? "CHANGES DETECTED" : "No changes"}`);
  } else {
    console.log("📊 Diff report: Not found (using default has_changes=false)");
  }

  // Group items by category
  const categories = groupByCategory(snapshot.items || []);

  // Build published payload
  const published = {
    restaurant: {
      name: snapshot.restaurant?.name || null,
      slug: snapshot.restaurant?.slug || restaurantSlug,
      source: snapshot.restaurant?.source || "ubereats",
      source_url: snapshot.restaurant?.source_url || null
    },
    menu_version_id: snapshot.menu_version_id,
    published_at: new Date().toISOString(),
    has_changes: hasChanges,
    categories: categories
  };

  // Write output
  fs.writeFileSync(outputPath, JSON.stringify(published, null, 2));

  // Print summary
  console.log("\\n═══════════════════════════════════════");
  console.log("MENU PUBLISHED ✅");
  console.log("═══════════════════════════════════════\\n");

  console.log(`📊 Version: ${published.menu_version_id}`);
  console.log(`📊 Published at: ${published.published_at}`);
  console.log(`📊 Has changes: ${published.has_changes}`);
  console.log(`📊 Categories: ${categories.length}`);

  console.log("\\n📋 Category Breakdown:");
  for (const cat of categories) {
    console.log(`   ${cat.name}: ${cat.items.length} items`);
  }

  const totalItems = categories.reduce((sum, cat) => sum + cat.items.length, 0);
  console.log(`\\n📊 Total items: ${totalItems}`);

  console.log(`\\n💾 Published to ${outputPath}`);

  return {
    published: true,
    menu_version_id: published.menu_version_id,
    categories_count: categories.length,
    items_count: totalItems,
    path: outputPath
  };
}

// Run if called directly
if (require.main === module) {
  const restaurantSlug = process.argv[2] || "shake-shack-coral-gables";
  const diffPath = process.argv[3] || "menu_diff_report.json";
  const outputPath = process.argv[4] || "published_menu.json";

  const result = publishMenu(restaurantSlug, diffPath, outputPath);

  console.log(`\\n✅ Publish complete: ${result.published ? "SUCCESS" : "FAILED"}\\n`);
}

module.exports = { publishMenu, loadLatestSnapshot, groupByCategory, stripInternalFields };
