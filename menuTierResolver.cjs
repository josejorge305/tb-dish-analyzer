const fs = require("fs");

/**
 * Menu Tier Resolver v1
 *
 * Centralized tier selection + cache reuse logic for Uber Eats menus.
 * Pure deterministic logic - no AI, no job execution.
 *
 * Tiers:
 * - Tier 1: published_menu.json (V1 Uber DOM scrape) - authoritative, high cost
 * - Tier 2: franchise_resolved_menu.json OR adjudicated_menu.json (V2) - derived, low cost
 *
 * Cache TTLs:
 * - Tier 1: 15 days
 * - Tier 2: 7 days
 *
 * Selection Rules:
 * - Critical alert → Tier 1
 * - Confidence >= 0.70 → Tier 2
 * - Confidence 0.40–0.69 → Tier 2 + warning
 * - Confidence < 0.40 → Tier 1
 */

// Configuration
const CONFIG = {
  // Cache TTLs in milliseconds
  TIER1_TTL_MS: 15 * 24 * 60 * 60 * 1000, // 15 days
  TIER2_TTL_MS: 7 * 24 * 60 * 60 * 1000,  // 7 days

  // Confidence thresholds
  CONFIDENCE_HIGH: 0.70,
  CONFIDENCE_LOW: 0.40,

  // Default paths
  PATHS: {
    v1_menu: "published_menu.json",
    v2_adjudicated: "adjudicated_menu.json",
    v2_franchise: "franchise_resolved_menu.json",
    confidence_report: "menu_confidence_report.json",
    alerts_report: "menu_alerts_report.json"
  }
};

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
 * Get file modification time
 */
function getFileModTime(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const stats = fs.statSync(filePath);
    return stats.mtime;
  } catch (e) {
    return null;
  }
}

/**
 * Parse ISO timestamp or return null
 */
function parseTimestamp(timestamp) {
  if (!timestamp) {
    return null;
  }

  try {
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? null : date;
  } catch (e) {
    return null;
  }
}

/**
 * Check if cache is expired
 */
function isCacheExpired(lastRunTime, ttlMs) {
  if (!lastRunTime) {
    return true; // Never run = expired
  }

  const now = Date.now();
  const lastRun = lastRunTime instanceof Date ? lastRunTime.getTime() : new Date(lastRunTime).getTime();

  return (now - lastRun) >= ttlMs;
}

/**
 * Calculate next refresh time
 */
function getNextRefresh(lastRunTime, ttlMs) {
  if (!lastRunTime) {
    return new Date().toISOString(); // Refresh now
  }

  const lastRun = lastRunTime instanceof Date ? lastRunTime : new Date(lastRunTime);
  const nextRefresh = new Date(lastRun.getTime() + ttlMs);

  return nextRefresh.toISOString();
}

/**
 * Get cache status
 */
function getCacheStatus(lastRunTime, ttlMs) {
  if (!lastRunTime) {
    return "miss";
  }

  if (isCacheExpired(lastRunTime, ttlMs)) {
    return "expired";
  }

  return "hit";
}

/**
 * Check for critical alerts
 */
function getCriticalAlerts(alertsReport) {
  if (!alertsReport || !alertsReport.alerts) {
    return [];
  }

  return alertsReport.alerts.filter(a => a.level === "critical");
}

/**
 * Check for warning alerts
 */
function getWarningAlerts(alertsReport) {
  if (!alertsReport || !alertsReport.alerts) {
    return [];
  }

  return alertsReport.alerts.filter(a => a.level === "warning");
}

/**
 * Get confidence score
 */
function getConfidenceScore(confidenceReport) {
  if (!confidenceReport) {
    return 0;
  }

  return confidenceReport.confidence_score || 0;
}

/**
 * Get last run time for V1 menu
 */
function getV1LastRun(v1Menu, v1Path) {
  // Check embedded timestamp first
  const embedded = parseTimestamp(v1Menu?.scraped_at) ||
                   parseTimestamp(v1Menu?.extracted_at) ||
                   parseTimestamp(v1Menu?.generated_at);

  if (embedded) {
    return embedded;
  }

  // Fall back to file modification time
  return getFileModTime(v1Path);
}

/**
 * Get last run time for V2 menu
 */
function getV2LastRun(v2Menu, confidenceReport, v2Path) {
  // Check confidence report timestamp
  const confidence = parseTimestamp(confidenceReport?.generated_at);
  if (confidence) {
    return confidence;
  }

  // Check embedded timestamp
  const embedded = parseTimestamp(v2Menu?.adjudicated_at) ||
                   parseTimestamp(v2Menu?.resolved_at) ||
                   parseTimestamp(v2Menu?.generated_at);

  if (embedded) {
    return embedded;
  }

  // Fall back to file modification time
  return getFileModTime(v2Path);
}

/**
 * Find location in franchise menu
 */
function findFranchiseLocation(franchiseMenu, locationSlug) {
  if (!franchiseMenu || !franchiseMenu.locations) {
    return null;
  }

  return franchiseMenu.locations.find(loc => loc.location_slug === locationSlug);
}

/**
 * Build cache key
 */
function buildCacheKey(restaurantSlug, locationSlug) {
  if (locationSlug && locationSlug !== restaurantSlug) {
    return `${restaurantSlug}:${locationSlug}`;
  }
  return restaurantSlug;
}

/**
 * Main tier resolver function
 */
function resolveTier(
  restaurantSlug,
  locationSlug = null,
  options = {}
) {
  const now = new Date();

  // Resolve paths
  const paths = {
    v1_menu: options.v1Path || CONFIG.PATHS.v1_menu,
    v2_adjudicated: options.v2AdjudicatedPath || CONFIG.PATHS.v2_adjudicated,
    v2_franchise: options.v2FranchisePath || CONFIG.PATHS.v2_franchise,
    confidence_report: options.confidencePath || CONFIG.PATHS.confidence_report,
    alerts_report: options.alertsPath || CONFIG.PATHS.alerts_report
  };

  // Load all data
  const v1Menu = loadJSON(paths.v1_menu);
  const v2Adjudicated = loadJSON(paths.v2_adjudicated);
  const v2Franchise = loadJSON(paths.v2_franchise);
  const confidenceReport = loadJSON(paths.confidence_report);
  const alertsReport = loadJSON(paths.alerts_report);

  // Get timing info
  const v1LastRun = getV1LastRun(v1Menu, paths.v1_menu);
  const v2LastRun = getV2LastRun(v2Adjudicated || v2Franchise, confidenceReport, paths.v2_adjudicated);

  // Get metrics
  const confidence = getConfidenceScore(confidenceReport);
  const criticalAlerts = getCriticalAlerts(alertsReport);
  const warningAlerts = getWarningAlerts(alertsReport);
  const allAlerts = [...criticalAlerts, ...warningAlerts];

  // Determine best V2 source
  let v2Source = null;
  let v2SourceFile = null;
  let v2ItemCount = 0;

  // Check franchise first (if location specified)
  const effectiveLocation = locationSlug || restaurantSlug;
  const franchiseLocation = findFranchiseLocation(v2Franchise, effectiveLocation);

  if (franchiseLocation) {
    v2Source = "franchise";
    v2SourceFile = paths.v2_franchise;
    v2ItemCount = franchiseLocation.items?.length || 0;
  } else if (v2Adjudicated && v2Adjudicated.items) {
    v2Source = "adjudicated";
    v2SourceFile = paths.v2_adjudicated;
    v2ItemCount = v2Adjudicated.items.length;
  }

  // Calculate cache statuses
  const tier1CacheStatus = getCacheStatus(v1LastRun, CONFIG.TIER1_TTL_MS);
  const tier2CacheStatus = getCacheStatus(v2LastRun, CONFIG.TIER2_TTL_MS);

  // Tier selection logic
  let servedTier = "tier1";
  let sourceFile = paths.v1_menu;
  let warningFlag = false;
  const reasons = [];

  // Rule 1: Critical alerts → Tier 1
  if (criticalAlerts.length > 0) {
    servedTier = "tier1";
    sourceFile = paths.v1_menu;
    reasons.push(`Critical alert detected: ${criticalAlerts[0].code}`);
  }
  // Rule 2: No V2 data available → Tier 1
  else if (!v2Source) {
    servedTier = "tier1";
    sourceFile = paths.v1_menu;
    reasons.push("No V2 data available");
  }
  // Rule 3: High confidence → Tier 2
  else if (confidence >= CONFIG.CONFIDENCE_HIGH) {
    servedTier = "tier2";
    sourceFile = v2SourceFile;
    reasons.push(`High confidence (${Math.round(confidence * 100)}%)`);
  }
  // Rule 4: Moderate confidence → Tier 2 + warning
  else if (confidence >= CONFIG.CONFIDENCE_LOW) {
    servedTier = "tier2";
    sourceFile = v2SourceFile;
    warningFlag = true;
    reasons.push(`Moderate confidence (${Math.round(confidence * 100)}%) - review recommended`);
  }
  // Rule 5: Low confidence → Tier 1
  else {
    servedTier = "tier1";
    sourceFile = paths.v1_menu;
    reasons.push(`Low confidence (${Math.round(confidence * 100)}%) - using authoritative source`);
  }

  // Determine effective cache status and next refresh
  let cacheStatus;
  let nextRefresh;
  let ttlUsed;

  if (servedTier === "tier1") {
    cacheStatus = tier1CacheStatus;
    ttlUsed = CONFIG.TIER1_TTL_MS;
    nextRefresh = getNextRefresh(v1LastRun, CONFIG.TIER1_TTL_MS);
  } else {
    cacheStatus = tier2CacheStatus;
    ttlUsed = CONFIG.TIER2_TTL_MS;
    nextRefresh = getNextRefresh(v2LastRun, CONFIG.TIER2_TTL_MS);
  }

  // Check if source file actually exists
  if (!fs.existsSync(sourceFile)) {
    cacheStatus = "miss";
    reasons.push(`Source file not found: ${sourceFile}`);
  }

  // Get restaurant name
  const restaurantName = confidenceReport?.restaurant ||
                         v2Franchise?.franchise ||
                         alertsReport?.restaurant ||
                         v1Menu?.restaurant?.name ||
                         restaurantSlug;

  // Build decision
  const decision = {
    restaurant: restaurantName,
    restaurant_slug: restaurantSlug,
    location: effectiveLocation,
    cache_key: buildCacheKey(restaurantSlug, locationSlug),
    resolved_at: now.toISOString(),
    served_tier: servedTier,
    source_file: sourceFile,
    source_type: servedTier === "tier1" ? "v1_published" : v2Source,
    cache_status: cacheStatus,
    warning_flag: warningFlag,
    confidence_score: confidence,
    alerts: allAlerts.map(a => ({
      level: a.level,
      code: a.code,
      message: a.message
    })),
    reasons: reasons,
    timing: {
      v1_last_run: v1LastRun ? v1LastRun.toISOString() : null,
      v2_last_run: v2LastRun ? v2LastRun.toISOString() : null,
      tier1_cache_status: tier1CacheStatus,
      tier2_cache_status: tier2CacheStatus
    },
    next_refresh: nextRefresh,
    ttl_days: ttlUsed / (24 * 60 * 60 * 1000)
  };

  return decision;
}

/**
 * Resolve tier and save to file
 */
function resolveTierToFile(
  restaurantSlug,
  locationSlug = null,
  outputPath = "menu_tier_decision.json",
  options = {}
) {
  console.log("🎯 Menu Tier Resolver v1\n");

  console.log(`📍 Restaurant: ${restaurantSlug}`);
  if (locationSlug) {
    console.log(`📍 Location: ${locationSlug}`);
  }

  const decision = resolveTier(restaurantSlug, locationSlug, options);

  // Print summary
  console.log("\n" + "═".repeat(60));
  console.log("TIER DECISION");
  console.log("═".repeat(60));

  const tierIcon = decision.served_tier === "tier1" ? "🔵" : "🟢";
  const cacheIcon = {
    "hit": "✅",
    "miss": "❌",
    "expired": "⏰"
  };

  console.log(`\n${tierIcon} Served Tier: ${decision.served_tier.toUpperCase()}`);
  console.log(`📄 Source: ${decision.source_file}`);
  console.log(`${cacheIcon[decision.cache_status] || "📋"} Cache: ${decision.cache_status.toUpperCase()}`);
  console.log(`📊 Confidence: ${Math.round(decision.confidence_score * 100)}%`);

  if (decision.warning_flag) {
    console.log("⚠️  Warning flag: review recommended");
  }

  console.log("\n📋 Reasons:");
  for (const reason of decision.reasons) {
    console.log(`   - ${reason}`);
  }

  if (decision.alerts.length > 0) {
    console.log("\n🚨 Active alerts:");
    for (const alert of decision.alerts) {
      const icon = alert.level === "critical" ? "🔴" : "🟡";
      console.log(`   ${icon} [${alert.code}] ${alert.message}`);
    }
  }

  console.log(`\n📅 Next refresh: ${decision.next_refresh}`);
  console.log(`⏱️  TTL: ${decision.ttl_days} days`);

  // Save decision
  fs.writeFileSync(outputPath, JSON.stringify(decision, null, 2));
  console.log(`\n💾 Saved: ${outputPath}`);
  console.log("\n✅ Tier resolution complete\n");

  return decision;
}

// Run if called directly
if (require.main === module) {
  const restaurantSlug = process.argv[2] || "shake-shack-coral-gables";
  const locationSlug = process.argv[3] || null;
  const outputPath = process.argv[4] || "menu_tier_decision.json";

  resolveTierToFile(restaurantSlug, locationSlug, outputPath);
}

module.exports = { resolveTier, resolveTierToFile, CONFIG };
