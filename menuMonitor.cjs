const fs = require("fs");

/**
 * Menu Monitor v1
 *
 * Lightweight monitoring and alert generation for menu health and drift.
 * Pure evaluation logic - no side effects, no external services.
 *
 * Alert Levels:
 * - info: Informational, no action required
 * - warning: Attention needed, review recommended
 * - critical: Immediate action required
 *
 * Alert Triggers:
 * - confidence_score < 0.40 → critical
 * - drift.severity = "high" → critical
 * - item_count drops > 20% → warning
 * - drift.severity = "medium" → warning
 * - confidence_score 0.40-0.70 → info
 * - drift.severity = "low" → info
 */

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
 * Extract item count from V1 menu
 */
function getV1ItemCount(menu) {
  if (!menu || !menu.sections) {
    return 0;
  }

  let count = 0;
  for (const section of menu.sections) {
    count += section.items?.length || 0;
  }
  return count;
}

/**
 * Alert codes
 */
const ALERT_CODES = {
  // Critical
  CONFIDENCE_CRITICAL: "CONF_CRIT",
  DRIFT_HIGH: "DRIFT_HIGH",
  ITEM_COUNT_CRITICAL: "COUNT_CRIT",

  // Warning
  CONFIDENCE_LOW: "CONF_LOW",
  DRIFT_MEDIUM: "DRIFT_MED",
  ITEM_COUNT_DROP: "COUNT_DROP",
  PRICE_COVERAGE_LOW: "PRICE_LOW",
  IMAGE_COVERAGE_LOW: "IMG_LOW",
  FRANCHISE_MISMATCH: "FRAN_MISMATCH",

  // Info
  CONFIDENCE_MODERATE: "CONF_MOD",
  DRIFT_LOW: "DRIFT_LOW",
  NEW_MENU_VERSION: "NEW_VERSION",
  FRANCHISE_RESOLVED: "FRAN_OK"
};

/**
 * Create alert object
 */
function createAlert(level, code, message) {
  return {
    level,
    code,
    message,
    timestamp: new Date().toISOString()
  };
}

/**
 * Evaluate confidence score alerts
 */
function evaluateConfidence(confidenceReport, alerts) {
  if (!confidenceReport) {
    return;
  }

  const score = confidenceReport.confidence_score;

  if (score === null || score === undefined) {
    return;
  }

  if (score < 0.4) {
    alerts.push(createAlert(
      "critical",
      ALERT_CODES.CONFIDENCE_CRITICAL,
      `Confidence score critically low: ${Math.round(score * 100)}% (threshold: 40%)`
    ));
  } else if (score < 0.7) {
    alerts.push(createAlert(
      "info",
      ALERT_CODES.CONFIDENCE_MODERATE,
      `Confidence score moderate: ${Math.round(score * 100)}% (optimal: >=70%)`
    ));
  }
}

/**
 * Evaluate drift alerts
 */
function evaluateDrift(confidenceReport, alerts) {
  if (!confidenceReport || !confidenceReport.drift) {
    return;
  }

  const drift = confidenceReport.drift;
  const severity = drift.severity;

  if (severity === "high") {
    alerts.push(createAlert(
      "critical",
      ALERT_CODES.DRIFT_HIGH,
      `High menu drift detected: ${drift.added_items} added, ${drift.removed_items} removed, ${drift.price_changes} price changes`
    ));
  } else if (severity === "medium") {
    alerts.push(createAlert(
      "warning",
      ALERT_CODES.DRIFT_MEDIUM,
      `Medium menu drift detected: ${drift.added_items} added, ${drift.removed_items} removed, ${drift.price_changes} price changes`
    ));
  } else if (severity === "low") {
    alerts.push(createAlert(
      "info",
      ALERT_CODES.DRIFT_LOW,
      `Low menu drift detected: ${drift.added_items} added, ${drift.removed_items} removed, ${drift.price_changes} price changes`
    ));
  }
}

/**
 * Evaluate item count changes
 */
function evaluateItemCount(confidenceReport, v1Menu, alerts) {
  if (!confidenceReport || !confidenceReport.metrics) {
    return;
  }

  const currentCount = confidenceReport.metrics.total_items;
  const v1Count = getV1ItemCount(v1Menu);

  if (v1Count === 0 || currentCount === 0) {
    return;
  }

  const dropPercent = ((v1Count - currentCount) / v1Count) * 100;

  if (dropPercent > 50) {
    alerts.push(createAlert(
      "critical",
      ALERT_CODES.ITEM_COUNT_CRITICAL,
      `Critical item count drop: ${v1Count} → ${currentCount} (-${Math.round(dropPercent)}%)`
    ));
  } else if (dropPercent > 20) {
    alerts.push(createAlert(
      "warning",
      ALERT_CODES.ITEM_COUNT_DROP,
      `Significant item count drop: ${v1Count} → ${currentCount} (-${Math.round(dropPercent)}%)`
    ));
  }
}

/**
 * Evaluate coverage metrics
 */
function evaluateCoverage(confidenceReport, alerts) {
  if (!confidenceReport || !confidenceReport.metrics) {
    return;
  }

  const metrics = confidenceReport.metrics;

  // Price coverage
  const priceCoverage = metrics.price_coverage_percent;
  if (priceCoverage !== null && priceCoverage < 50) {
    alerts.push(createAlert(
      "warning",
      ALERT_CODES.PRICE_COVERAGE_LOW,
      `Low price coverage: only ${priceCoverage}% of items have prices`
    ));
  }

  // Image coverage
  const imageCoverage = metrics.image_coverage_percent;
  if (imageCoverage !== null && imageCoverage < 30) {
    alerts.push(createAlert(
      "warning",
      ALERT_CODES.IMAGE_COVERAGE_LOW,
      `Low image coverage: only ${imageCoverage}% of items have images`
    ));
  }
}

/**
 * Evaluate franchise consistency
 */
function evaluateFranchise(franchiseMenu, confidenceReport, alerts) {
  if (!franchiseMenu) {
    return;
  }

  const locations = franchiseMenu.locations || [];
  const canonicalLocation = franchiseMenu.canonical_location;

  // Find canonical location item count
  const canonical = locations.find(loc => loc.location_slug === canonicalLocation);
  const canonicalCount = canonical?.items?.length || 0;

  if (canonicalCount === 0) {
    return;
  }

  // Check for significant mismatches across locations
  for (const location of locations) {
    if (location.location_slug === canonicalLocation) {
      continue;
    }

    const locationCount = location.items?.length || 0;
    const diff = canonicalCount - locationCount;
    const diffPercent = (diff / canonicalCount) * 100;

    if (diffPercent > 10) {
      alerts.push(createAlert(
        "warning",
        ALERT_CODES.FRANCHISE_MISMATCH,
        `Franchise location ${location.location_slug} has ${diff} fewer items than canonical (${diffPercent.toFixed(1)}% difference)`
      ));
    }
  }

  // Info alert for successful franchise resolution
  if (locations.length > 1) {
    alerts.push(createAlert(
      "info",
      ALERT_CODES.FRANCHISE_RESOLVED,
      `Franchise menu resolved for ${locations.length} locations`
    ));
  }
}

/**
 * Evaluate diff report
 */
function evaluateDiffReport(diffReport, alerts) {
  if (!diffReport) {
    return;
  }

  // Check for new menu version
  if (diffReport.has_changes) {
    const totalChanges = (diffReport.summary?.added || 0) +
                         (diffReport.summary?.removed || 0) +
                         (diffReport.summary?.price_changed || 0);

    if (totalChanges > 0) {
      alerts.push(createAlert(
        "info",
        ALERT_CODES.NEW_MENU_VERSION,
        `Menu changes detected: ${diffReport.summary?.added || 0} added, ${diffReport.summary?.removed || 0} removed, ${diffReport.summary?.price_changed || 0} price changes`
      ));
    }
  }
}

/**
 * Get highest alert level
 */
function getHighestLevel(alerts) {
  const levels = { info: 0, warning: 1, critical: 2 };
  let highest = -1;
  let highestName = "info";

  for (const alert of alerts) {
    const level = levels[alert.level] || 0;
    if (level > highest) {
      highest = level;
      highestName = alert.level;
    }
  }

  return highestName;
}

/**
 * Main monitoring function
 */
function monitorMenu(
  confidencePath = "menu_confidence_report.json",
  diffPath = "menu_diff_report.json",
  franchisePath = "franchise_resolved_menu.json",
  v1Path = "published_menu.json",
  outputPath = "menu_alerts_report.json"
) {
  console.log("🔍 Menu Monitor v1\n");

  // Load inputs
  const confidenceReport = loadJSON(confidencePath);
  const diffReport = loadJSON(diffPath);
  const franchiseMenu = loadJSON(franchisePath);
  const v1Menu = loadJSON(v1Path);

  console.log(`📥 Confidence report: ${confidenceReport ? "loaded" : "not found"}`);
  console.log(`📥 Diff report: ${diffReport ? "loaded" : "not found"}`);
  console.log(`📥 Franchise menu: ${franchiseMenu ? "loaded" : "not found"}`);
  console.log(`📥 V1 menu: ${v1Menu ? "loaded" : "not found"}`);

  const restaurant = confidenceReport?.restaurant ||
                     franchiseMenu?.franchise ||
                     "Unknown";

  console.log(`\n📍 Restaurant: ${restaurant}\n`);

  // Collect alerts
  const alerts = [];

  // Evaluate all conditions
  evaluateConfidence(confidenceReport, alerts);
  evaluateDrift(confidenceReport, alerts);
  evaluateItemCount(confidenceReport, v1Menu, alerts);
  evaluateCoverage(confidenceReport, alerts);
  evaluateFranchise(franchiseMenu, confidenceReport, alerts);
  evaluateDiffReport(diffReport, alerts);

  // Sort alerts by level (critical first)
  const levelOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);

  // Build report
  const report = {
    restaurant: restaurant,
    generated_at: new Date().toISOString(),
    alerts: alerts,
    summary: {
      alert_count: alerts.length,
      critical_count: alerts.filter(a => a.level === "critical").length,
      warning_count: alerts.filter(a => a.level === "warning").length,
      info_count: alerts.filter(a => a.level === "info").length,
      highest_level: alerts.length > 0 ? getHighestLevel(alerts) : "info"
    },
    sources: {
      confidence_report: confidencePath,
      diff_report: diffPath,
      franchise_menu: franchisePath,
      v1_menu: v1Path
    }
  };

  // Save report
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  // Print summary
  console.log("═".repeat(60));
  console.log("ALERT REPORT");
  console.log("═".repeat(60));

  if (alerts.length === 0) {
    console.log("\n✅ No alerts generated - menu health is good\n");
  } else {
    console.log(`\n📊 Total alerts: ${alerts.length}`);
    console.log(`   Critical: ${report.summary.critical_count}`);
    console.log(`   Warning: ${report.summary.warning_count}`);
    console.log(`   Info: ${report.summary.info_count}`);
    console.log(`   Highest level: ${report.summary.highest_level.toUpperCase()}`);

    console.log("\n📋 Alerts:\n");

    for (const alert of alerts) {
      const icon = alert.level === "critical" ? "🔴" :
                   alert.level === "warning" ? "🟡" : "🔵";
      console.log(`   ${icon} [${alert.level.toUpperCase()}] ${alert.code}`);
      console.log(`      ${alert.message}\n`);
    }
  }

  console.log(`💾 Saved: ${outputPath}`);
  console.log("\n✅ Monitoring complete\n");

  return report;
}

// Run if called directly
if (require.main === module) {
  const confidencePath = process.argv[2] || "menu_confidence_report.json";
  const diffPath = process.argv[3] || "menu_diff_report.json";
  const franchisePath = process.argv[4] || "franchise_resolved_menu.json";
  const v1Path = process.argv[5] || "published_menu.json";
  const outputPath = process.argv[6] || "menu_alerts_report.json";

  monitorMenu(confidencePath, diffPath, franchisePath, v1Path, outputPath);
}

module.exports = { monitorMenu, ALERT_CODES };
