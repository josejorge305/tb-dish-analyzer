const fs = require("fs");

/**
 * Menu Confidence Scoring + Drift Detection v2
 *
 * Computes menu-level confidence scores and detects
 * drift between adjudicated menus over time.
 *
 * Pure deterministic math - no AI, no heuristics.
 */

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
 * Load adjudicated menu file
 */
function loadMenu(path) {
  if (!fs.existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(path, "utf-8"));
  } catch (e) {
    console.log(`⚠️  Could not parse: ${path} - ${e.message}`);
    return null;
  }
}

/**
 * Compute confidence score from metrics
 *
 * Formula:
 * - Base: 50%
 * - +30% for merged ratio (merged / total)
 * - +20% for low flag ratio (1 - flagged / total)
 * - Penalty: -10% if uber_only > 50%
 * - Penalty: -10% if website_only > 50%
 */
function computeConfidenceScore(metrics) {
  const { total_items, merged_items, flagged_items, uber_only_items, website_only_items } = metrics;

  if (total_items === 0) {
    return 0;
  }

  const mergedRatio = merged_items / total_items;
  const flaggedRatio = flagged_items / total_items;
  const uberOnlyRatio = uber_only_items / total_items;
  const websiteOnlyRatio = website_only_items / total_items;

  let score = 0.5; // Base score

  // Merged ratio bonus (max +30%)
  score += mergedRatio * 0.3;

  // Low flag ratio bonus (max +20%)
  score += (1 - flaggedRatio) * 0.2;

  // Penalties for source imbalance
  if (uberOnlyRatio > 0.5) {
    score -= 0.1;
  }
  if (websiteOnlyRatio > 0.5) {
    score -= 0.1;
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, score));
}

/**
 * Compute metrics from adjudicated menu
 */
function computeMetrics(menu) {
  if (!menu || !menu.items) {
    return {
      total_items: 0,
      merged_items: 0,
      uber_only_items: 0,
      website_only_items: 0,
      flagged_items: 0,
      items_with_prices: 0,
      items_with_images: 0,
      categories: {}
    };
  }

  const items = menu.items;

  let merged = 0;
  let uberOnly = 0;
  let websiteOnly = 0;
  let flagged = 0;
  let withPrices = 0;
  let withImages = 0;
  const categories = {};

  for (const item of items) {
    // Source decision counts
    if (item.source_decision === "merged") merged++;
    else if (item.source_decision === "uber") uberOnly++;
    else if (item.source_decision === "website") websiteOnly++;

    // Flagged count
    if (item.flags && item.flags.length > 0) flagged++;

    // Price and image coverage
    if (item.price_cents !== null && item.price_cents !== undefined) withPrices++;
    if (item.image_url) withImages++;

    // Category breakdown
    const cat = item.canonical_category || "unknown";
    categories[cat] = (categories[cat] || 0) + 1;
  }

  return {
    total_items: items.length,
    merged_items: merged,
    uber_only_items: uberOnly,
    website_only_items: websiteOnly,
    flagged_items: flagged,
    items_with_prices: withPrices,
    items_with_images: withImages,
    categories: categories
  };
}

/**
 * Detect drift between current and previous menu
 */
function detectDrift(currentMenu, previousMenu) {
  if (!previousMenu || !previousMenu.items) {
    return {
      severity: "none",
      added_items: 0,
      removed_items: 0,
      price_changes: 0,
      details: {
        added: [],
        removed: [],
        changed: []
      }
    };
  }

  const currentItems = currentMenu.items || [];
  const previousItems = previousMenu.items || [];

  // Build maps by normalized name
  const currentMap = new Map();
  const previousMap = new Map();

  for (const item of currentItems) {
    const key = normalizeName(item.name);
    if (key) currentMap.set(key, item);
  }

  for (const item of previousItems) {
    const key = normalizeName(item.name);
    if (key) previousMap.set(key, item);
  }

  // Detect changes
  const added = [];
  const removed = [];
  const changed = [];

  // Find added items (in current but not previous)
  for (const [key, item] of currentMap) {
    if (!previousMap.has(key)) {
      added.push(item.name);
    }
  }

  // Find removed items (in previous but not current)
  for (const [key, item] of previousMap) {
    if (!currentMap.has(key)) {
      removed.push(item.name);
    }
  }

  // Find price changes (in both, different price)
  for (const [key, currentItem] of currentMap) {
    const previousItem = previousMap.get(key);
    if (previousItem) {
      const currentPrice = currentItem.price_cents;
      const previousPrice = previousItem.price_cents;

      if (currentPrice !== null && previousPrice !== null && currentPrice !== previousPrice) {
        changed.push({
          name: currentItem.name,
          previous_price: previousPrice,
          current_price: currentPrice,
          change_cents: currentPrice - previousPrice
        });
      }
    }
  }

  // Calculate severity
  const totalPrevious = previousItems.length || 1;
  const addedRatio = added.length / totalPrevious;
  const removedRatio = removed.length / totalPrevious;
  const changedRatio = changed.length / totalPrevious;

  let severity = "none";

  // Severity thresholds
  const totalChangeRatio = addedRatio + removedRatio + changedRatio;

  if (totalChangeRatio > 0.3) {
    severity = "high";
  } else if (totalChangeRatio > 0.15) {
    severity = "medium";
  } else if (totalChangeRatio > 0) {
    severity = "low";
  }

  return {
    severity: severity,
    added_items: added.length,
    removed_items: removed.length,
    price_changes: changed.length,
    details: {
      added: added.slice(0, 10), // Limit to first 10
      removed: removed.slice(0, 10),
      changed: changed.slice(0, 10)
    }
  };
}

/**
 * Main confidence scoring function
 */
function computeConfidence(
  currentPath = "adjudicated_menu.json",
  previousPath = null,
  outputPath = "menu_confidence_report.json"
) {
  console.log("📊 Menu Confidence Scoring + Drift Detection v2\n");

  // Load current menu
  const currentMenu = loadMenu(currentPath);

  if (!currentMenu) {
    console.error(`❌ Error: Could not load current menu: ${currentPath}`);
    process.exit(1);
  }

  console.log(`📥 Loaded current menu: ${currentPath}`);
  console.log(`📊 Restaurant: ${currentMenu.restaurant?.name || "Unknown"}`);
  console.log(`📊 Items: ${currentMenu.items?.length || 0}\n`);

  // Load previous menu if specified
  let previousMenu = null;
  if (previousPath) {
    previousMenu = loadMenu(previousPath);
    if (previousMenu) {
      console.log(`📥 Loaded previous menu: ${previousPath}`);
      console.log(`📊 Previous items: ${previousMenu.items?.length || 0}\n`);
    } else {
      console.log(`⚠️  No previous menu found at: ${previousPath}\n`);
    }
  }

  // Compute metrics
  console.log("🔄 Computing metrics...\n");
  const metrics = computeMetrics(currentMenu);

  // Compute confidence score
  const confidenceScore = computeConfidenceScore(metrics);

  // Detect drift
  const drift = detectDrift(currentMenu, previousMenu);

  // Build report
  const report = {
    generated_at: new Date().toISOString(),
    restaurant: currentMenu.restaurant?.name || "Unknown",
    confidence_score: Math.round(confidenceScore * 100) / 100,
    confidence_percent: Math.round(confidenceScore * 100),
    drift: drift,
    metrics: {
      total_items: metrics.total_items,
      merged_items: metrics.merged_items,
      uber_only_items: metrics.uber_only_items,
      website_only_items: metrics.website_only_items,
      flagged_items: metrics.flagged_items,
      items_with_prices: metrics.items_with_prices,
      items_with_images: metrics.items_with_images,
      price_coverage_percent: metrics.total_items > 0
        ? Math.round((metrics.items_with_prices / metrics.total_items) * 100)
        : 0,
      image_coverage_percent: metrics.total_items > 0
        ? Math.round((metrics.items_with_images / metrics.total_items) * 100)
        : 0,
      categories: metrics.categories
    },
    source_files: {
      current: currentPath,
      previous: previousPath || null
    }
  };

  // Save report
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  // Print summary
  console.log("═".repeat(60));
  console.log("CONFIDENCE REPORT");
  console.log("═".repeat(60));

  console.log(`\n📊 Confidence Score: ${report.confidence_percent}%`);

  console.log("\n📋 Metrics:");
  console.log(`   Total items: ${metrics.total_items}`);
  console.log(`   Merged (both sources): ${metrics.merged_items}`);
  console.log(`   Uber only: ${metrics.uber_only_items}`);
  console.log(`   Website only: ${metrics.website_only_items}`);
  console.log(`   Flagged: ${metrics.flagged_items}`);
  console.log(`   Price coverage: ${report.metrics.price_coverage_percent}%`);
  console.log(`   Image coverage: ${report.metrics.image_coverage_percent}%`);

  console.log("\n📋 Categories:");
  for (const [cat, count] of Object.entries(metrics.categories)) {
    console.log(`   ${cat}: ${count}`);
  }

  console.log("\n📋 Drift:");
  console.log(`   Severity: ${drift.severity.toUpperCase()}`);
  console.log(`   Added: ${drift.added_items}`);
  console.log(`   Removed: ${drift.removed_items}`);
  console.log(`   Price changes: ${drift.price_changes}`);

  if (drift.details.added.length > 0) {
    console.log("\n   Added items (sample):");
    drift.details.added.slice(0, 3).forEach(name => console.log(`     + ${name}`));
  }

  if (drift.details.removed.length > 0) {
    console.log("\n   Removed items (sample):");
    drift.details.removed.slice(0, 3).forEach(name => console.log(`     - ${name}`));
  }

  if (drift.details.changed.length > 0) {
    console.log("\n   Price changes (sample):");
    drift.details.changed.slice(0, 3).forEach(c => {
      const change = c.change_cents > 0 ? `+$${(c.change_cents / 100).toFixed(2)}` : `-$${(Math.abs(c.change_cents) / 100).toFixed(2)}`;
      console.log(`     ~ ${c.name}: ${change}`);
    });
  }

  console.log(`\n💾 Saved: ${outputPath}`);
  console.log("\n✅ Confidence scoring complete\n");

  return report;
}

// Run if called directly
if (require.main === module) {
  const currentPath = process.argv[2] || "adjudicated_menu.json";
  const previousPath = process.argv[3] || null;
  const outputPath = process.argv[4] || "menu_confidence_report.json";

  computeConfidence(currentPath, previousPath, outputPath);
}

module.exports = { computeConfidence, computeMetrics, computeConfidenceScore, detectDrift };
