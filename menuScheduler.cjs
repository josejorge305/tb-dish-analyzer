const fs = require("fs");

/**
 * Menu Scheduler v1
 *
 * Cost/latency policy layer that decides WHEN to run V1, V2, or reuse cache.
 * Pure planning logic - no side effects, no job execution.
 *
 * Decisions:
 * - reuse_cache: Menu is fresh and healthy, no action needed
 * - run_v1_only: Low confidence, need fresh V1 scrape
 * - run_v2_only: Moderate confidence, refresh adjudication
 * - run_v1_and_v2: Critical issues or stale data, full refresh
 *
 * Minimum Intervals:
 * - V1 scrape: 15 days
 * - V2 adjudication: 7 days
 */

// Configuration
const CONFIG = {
  // Minimum intervals in milliseconds
  V1_MIN_INTERVAL_MS: 15 * 24 * 60 * 60 * 1000, // 15 days
  V2_MIN_INTERVAL_MS: 7 * 24 * 60 * 60 * 1000,  // 7 days

  // Confidence thresholds
  CONFIDENCE_HIGH: 0.70,
  CONFIDENCE_LOW: 0.40
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
 * Check if interval has elapsed
 */
function hasIntervalElapsed(lastRunTime, intervalMs) {
  if (!lastRunTime) {
    return true; // Never run, eligible
  }

  const now = Date.now();
  const lastRun = lastRunTime instanceof Date ? lastRunTime.getTime() : new Date(lastRunTime).getTime();

  return (now - lastRun) >= intervalMs;
}

/**
 * Calculate next eligible run time
 */
function getNextEligibleRun(lastRunTime, intervalMs) {
  if (!lastRunTime) {
    return new Date().toISOString(); // Eligible now
  }

  const lastRun = lastRunTime instanceof Date ? lastRunTime : new Date(lastRunTime);
  const nextRun = new Date(lastRun.getTime() + intervalMs);

  return nextRun.toISOString();
}

/**
 * Check for critical alerts
 */
function hasCriticalAlerts(alertsReport) {
  if (!alertsReport || !alertsReport.summary) {
    return false;
  }

  return alertsReport.summary.critical_count > 0;
}

/**
 * Check for high drift
 */
function hasHighDrift(confidenceReport) {
  if (!confidenceReport || !confidenceReport.drift) {
    return false;
  }

  return confidenceReport.drift.severity === "high";
}

/**
 * Check for any drift
 */
function hasAnyDrift(confidenceReport) {
  if (!confidenceReport || !confidenceReport.drift) {
    return false;
  }

  return confidenceReport.drift.severity !== "none";
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
 * Main scheduling function
 */
function scheduleMenu(
  alertsPath = "menu_alerts_report.json",
  confidencePath = "menu_confidence_report.json",
  diffPath = "menu_diff_report.json",
  franchisePath = "franchise_resolved_menu.json",
  v1Path = "published_menu.json",
  v2Path = "adjudicated_menu.json",
  outputPath = "menu_scheduler_plan.json"
) {
  console.log("📅 Menu Scheduler v1\n");

  const now = new Date();

  // Load inputs
  const alertsReport = loadJSON(alertsPath);
  const confidenceReport = loadJSON(confidencePath);
  const diffReport = loadJSON(diffPath);
  const franchiseMenu = loadJSON(franchisePath);

  console.log(`📥 Alerts report: ${alertsReport ? "loaded" : "not found"}`);
  console.log(`📥 Confidence report: ${confidenceReport ? "loaded" : "not found"}`);
  console.log(`📥 Diff report: ${diffReport ? "loaded" : "not found"}`);
  console.log(`📥 Franchise menu: ${franchiseMenu ? "loaded" : "not found"}`);

  // Get last run times from file modification times or embedded timestamps
  const v1ModTime = getFileModTime(v1Path);
  const v2ModTime = getFileModTime(v2Path);

  // Also check embedded timestamps
  const v1Menu = loadJSON(v1Path);
  const v2Menu = loadJSON(v2Path);

  const v1LastRun = parseTimestamp(v1Menu?.scraped_at) ||
                    parseTimestamp(v1Menu?.extracted_at) ||
                    v1ModTime;

  const v2LastRun = parseTimestamp(v2Menu?.adjudicated_at) ||
                    parseTimestamp(confidenceReport?.generated_at) ||
                    v2ModTime;

  console.log(`\n📊 V1 last run: ${v1LastRun ? v1LastRun.toISOString() : "never"}`);
  console.log(`📊 V2 last run: ${v2LastRun ? v2LastRun.toISOString() : "never"}`);

  // Check interval eligibility
  const v1Eligible = hasIntervalElapsed(v1LastRun, CONFIG.V1_MIN_INTERVAL_MS);
  const v2Eligible = hasIntervalElapsed(v2LastRun, CONFIG.V2_MIN_INTERVAL_MS);

  console.log(`📊 V1 eligible: ${v1Eligible}`);
  console.log(`📊 V2 eligible: ${v2Eligible}`);

  // Calculate next eligible times
  const v1NextEligible = getNextEligibleRun(v1LastRun, CONFIG.V1_MIN_INTERVAL_MS);
  const v2NextEligible = getNextEligibleRun(v2LastRun, CONFIG.V2_MIN_INTERVAL_MS);

  // Get metrics
  const confidence = getConfidenceScore(confidenceReport);
  const criticalAlerts = hasCriticalAlerts(alertsReport);
  const highDrift = hasHighDrift(confidenceReport);
  const anyDrift = hasAnyDrift(confidenceReport);

  console.log(`\n📊 Confidence: ${Math.round(confidence * 100)}%`);
  console.log(`📊 Critical alerts: ${criticalAlerts}`);
  console.log(`📊 High drift: ${highDrift}`);
  console.log(`📊 Any drift: ${anyDrift}`);

  // Decision logic
  const reasons = [];
  let decision = "reuse_cache";

  // Rule 1: Critical alerts → run_v1_and_v2
  if (criticalAlerts) {
    decision = "run_v1_and_v2";
    reasons.push("Critical alerts detected - full refresh required");
  }

  // Rule 2: High drift → run_v1_and_v2
  if (highDrift && decision !== "run_v1_and_v2") {
    decision = "run_v1_and_v2";
    reasons.push("High menu drift detected - full refresh required");
  }

  // Rule 3: Low confidence → run_v1_only
  if (confidence < CONFIG.CONFIDENCE_LOW && decision === "reuse_cache") {
    decision = "run_v1_only";
    reasons.push(`Low confidence (${Math.round(confidence * 100)}%) - V1 scrape recommended`);
  }

  // Rule 4: Moderate confidence → run_v2_only
  if (confidence >= CONFIG.CONFIDENCE_LOW &&
      confidence < CONFIG.CONFIDENCE_HIGH &&
      decision === "reuse_cache") {
    decision = "run_v2_only";
    reasons.push(`Moderate confidence (${Math.round(confidence * 100)}%) - V2 adjudication recommended`);
  }

  // Rule 5: High confidence + no drift → reuse_cache
  if (confidence >= CONFIG.CONFIDENCE_HIGH && !anyDrift && decision === "reuse_cache") {
    reasons.push(`High confidence (${Math.round(confidence * 100)}%) with no drift - cache is valid`);
  }

  // Rule 6: High confidence but with drift → run_v2_only
  if (confidence >= CONFIG.CONFIDENCE_HIGH && anyDrift && decision === "reuse_cache") {
    decision = "run_v2_only";
    reasons.push("High confidence but drift detected - V2 refresh recommended");
  }

  // Apply interval constraints
  const originalDecision = decision;

  if (decision === "run_v1_and_v2") {
    if (!v1Eligible && !v2Eligible) {
      decision = "reuse_cache";
      reasons.push("Interval constraint: V1 and V2 not yet eligible for re-run");
    } else if (!v1Eligible) {
      decision = "run_v2_only";
      reasons.push("Interval constraint: V1 not yet eligible, running V2 only");
    } else if (!v2Eligible) {
      decision = "run_v1_only";
      reasons.push("Interval constraint: V2 not yet eligible, running V1 only");
    }
  } else if (decision === "run_v1_only" && !v1Eligible) {
    decision = "reuse_cache";
    reasons.push("Interval constraint: V1 not yet eligible for re-run");
  } else if (decision === "run_v2_only" && !v2Eligible) {
    decision = "reuse_cache";
    reasons.push("Interval constraint: V2 not yet eligible for re-run");
  }

  // No data case
  if (!v1Menu && !v2Menu) {
    decision = "run_v1_and_v2";
    reasons.length = 0;
    reasons.push("No menu data found - initial run required");
  }

  // Build plan
  const plan = {
    restaurant: confidenceReport?.restaurant ||
                franchiseMenu?.franchise ||
                alertsReport?.restaurant ||
                "Unknown",
    generated_at: now.toISOString(),
    decision: decision,
    reasons: reasons,
    metrics: {
      confidence_score: confidence,
      critical_alerts: criticalAlerts,
      drift_severity: confidenceReport?.drift?.severity || "unknown",
      v1_eligible: v1Eligible,
      v2_eligible: v2Eligible
    },
    last_runs: {
      v1: v1LastRun ? v1LastRun.toISOString() : null,
      v2: v2LastRun ? v2LastRun.toISOString() : null
    },
    next_eligible_runs: {
      v1: v1NextEligible,
      v2: v2NextEligible
    },
    intervals: {
      v1_min_days: CONFIG.V1_MIN_INTERVAL_MS / (24 * 60 * 60 * 1000),
      v2_min_days: CONFIG.V2_MIN_INTERVAL_MS / (24 * 60 * 60 * 1000)
    }
  };

  // Save plan
  fs.writeFileSync(outputPath, JSON.stringify(plan, null, 2));

  // Print summary
  console.log("\n" + "═".repeat(60));
  console.log("SCHEDULER PLAN");
  console.log("═".repeat(60));

  const decisionIcon = {
    "reuse_cache": "💾",
    "run_v1_only": "🔵",
    "run_v2_only": "🟡",
    "run_v1_and_v2": "🔴"
  };

  console.log(`\n${decisionIcon[decision] || "📋"} Decision: ${decision.toUpperCase()}`);

  console.log("\n📋 Reasons:");
  for (const reason of reasons) {
    console.log(`   - ${reason}`);
  }

  console.log("\n📅 Next eligible runs:");
  console.log(`   V1: ${v1NextEligible}`);
  console.log(`   V2: ${v2NextEligible}`);

  console.log(`\n💾 Saved: ${outputPath}`);
  console.log("\n✅ Scheduling complete\n");

  return plan;
}

// Run if called directly
if (require.main === module) {
  const alertsPath = process.argv[2] || "menu_alerts_report.json";
  const confidencePath = process.argv[3] || "menu_confidence_report.json";
  const diffPath = process.argv[4] || "menu_diff_report.json";
  const franchisePath = process.argv[5] || "franchise_resolved_menu.json";
  const v1Path = process.argv[6] || "published_menu.json";
  const v2Path = process.argv[7] || "adjudicated_menu.json";
  const outputPath = process.argv[8] || "menu_scheduler_plan.json";

  scheduleMenu(alertsPath, confidencePath, diffPath, franchisePath, v1Path, v2Path, outputPath);
}

module.exports = { scheduleMenu, CONFIG };
