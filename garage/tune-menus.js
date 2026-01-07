#!/usr/bin/env node
/**
 * MENU TUNING HARNESS
 *
 * The "Ferrari in the garage" - iteratively tests menu extraction until
 * we achieve 10 perfect menus in a row.
 *
 * Usage:
 *   npm run tune:menus                    # Run with default fixtures
 *   npm run tune:menus -- --fresh         # Ignore cache, fetch fresh
 *   npm run tune:menus -- --verbose       # Verbose output
 *   npm run tune:menus -- --target 5      # Target 5 consecutive (for testing)
 *
 * Environment:
 *   APIFY_TOKEN - Required for Apify API access
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createIdentityBundle,
  normalizeApifyToCanonical,
  validateMenuStrict,
  diffAgainstTruth,
  garageIngestMenuCached,
  scoreMenu,
  loadFixture,
  saveFixture,
  hasValidFixture,
  FIXTURES_DIR
} from "./garage-mode.js";

import {
  detectJunkItem,
  filterJunkItems,
  detectCuisineContamination,
  detectRestaurantMismatch,
  detectMenuAnomalies,
  mapToCanonicalCategory,
  sortSectionsByCanonicalOrder
} from "./menu-quality.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CLI ARGUMENTS
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    targetConsecutive: 10,
    stopOnFail: true,
    verbose: false,
    fresh: false,
    fixturesFile: path.join(__dirname, "tuning-fixtures.json"),
    artifactsDir: path.join(__dirname, "artifacts"),
    maxIterations: 100
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--target" || arg === "-t") {
      options.targetConsecutive = parseInt(args[++i], 10) || 10;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--fresh") {
      options.fresh = true;
    } else if (arg === "--continue" || arg === "-c") {
      options.stopOnFail = false;
    } else if (arg === "--file" || arg === "-f") {
      options.fixturesFile = args[++i];
    } else if (arg === "--max-iterations") {
      options.maxIterations = parseInt(args[++i], 10) || 100;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
MENU TUNING HARNESS - "Ferrari in the Garage"

Usage:
  node garage/tune-menus.js [options]
  npm run tune:menus -- [options]

Options:
  --target, -t <n>      Target consecutive passes (default: 10)
  --verbose, -v         Verbose output with detailed scoring
  --fresh               Ignore cache, always fetch fresh from Apify
  --continue, -c        Don't stop on first failure
  --file, -f <path>     Custom fixtures file
  --max-iterations <n>  Maximum tuning iterations (default: 100)
  --help, -h            Show this help

Environment:
  APIFY_TOKEN           Required - Apify API token

What is "Perfect":
  - Correct restaurant identity
  - All menu items present (no missing items)
  - No extra/junk items (no contamination)
  - Proper category structure
  - Items grouped correctly
  - Score >= 95/100

Success Criteria:
  10 consecutive perfect menus in a row
`);
}

// ============================================================================
// ENHANCED MENU TESTING
// ============================================================================

/**
 * Test a single restaurant with all quality checks
 */
async function testRestaurant(restaurant, env, options) {
  const startTime = Date.now();

  const result = {
    restaurant_id: restaurant.restaurant_id,
    name: restaurant.name,
    cuisine: restaurant.cuisine,
    ok: false,
    issues: [],
    score: null,
    timing: {},
    menu: null,
    rawStats: null
  };

  try {
    // Step 1: Ingest menu (with caching)
    const ingestResult = await garageIngestMenuCached(
      restaurant.restaurant_id,
      restaurant.uber_url,
      {
        env,
        useCache: !options.fresh,
        saveToCache: true,
        context: {
          cuisine: restaurant.cuisine,
          expected_categories: restaurant.expected_categories,
          is_coffee_shop: restaurant.is_coffee_shop
        }
      }
    );

    result.timing.fetch_ms = ingestResult.timing.fetch_ms;
    result.timing.normalize_ms = ingestResult.timing.normalize_ms;
    result.fromCache = ingestResult.fromCache;

    if (ingestResult.error) {
      result.issues.push({ type: "FETCH_ERROR", message: ingestResult.error });
      result.timing.total_ms = Date.now() - startTime;
      return result;
    }

    result.menu = ingestResult.menu;
    result.rawApify = ingestResult.rawApify;

    // Step 2: Basic validation
    if (ingestResult.validationResult && !ingestResult.validationResult.valid) {
      result.issues.push({
        type: "VALIDATION_ERRORS",
        count: ingestResult.validationResult.errorCount,
        errors: ingestResult.validationResult.errors.slice(0, 5)
      });
    }

    // Step 3: Menu anomaly detection
    const anomalyResult = detectMenuAnomalies(ingestResult.menu);
    if (anomalyResult.hasSuspicious) {
      result.issues.push({
        type: "MENU_ANOMALIES",
        alerts: anomalyResult.alerts
      });
    }

    // Step 4: Cuisine contamination check
    if (restaurant.cuisine) {
      const contamResult = detectCuisineContamination(
        getAllItems(ingestResult.menu),
        restaurant.cuisine
      );
      if (contamResult.hasContamination) {
        result.issues.push({
          type: "CUISINE_CONTAMINATION",
          score: contamResult.score,
          evidence: contamResult.evidence.slice(0, 5)
        });
      }
    }

    // Step 5: Restaurant mismatch check
    const mismatchResult = detectRestaurantMismatch(
      getAllItems(ingestResult.menu),
      restaurant.name
    );
    if (mismatchResult.hasMismatch) {
      result.issues.push({
        type: "RESTAURANT_MISMATCH",
        confidence: mismatchResult.confidence,
        suspiciousNames: mismatchResult.suspiciousNames
      });
    }

    // Step 6: Junk item detection
    const junkResult = filterJunkItems(
      getAllItems(ingestResult.menu),
      { is_coffee_shop: restaurant.is_coffee_shop }
    );
    if (junkResult.stats.removed > 0) {
      result.issues.push({
        type: "JUNK_ITEMS_DETECTED",
        count: junkResult.stats.removed,
        byReason: junkResult.stats.byReason,
        examples: junkResult.junkItems.slice(0, 3).map(j => j.item.name || j.item.title)
      });
    }

    // Step 7: Score the menu
    result.score = ingestResult.scoreResult;
    result.rawStats = {
      sections: ingestResult.menu.metadata.total_sections,
      items: ingestResult.menu.metadata.total_items,
      modifierGroups: ingestResult.menu.metadata.total_modifier_groups,
      options: ingestResult.menu.metadata.total_options
    };

    // Determine if perfect
    const hasBlockingIssues = result.issues.some(i =>
      i.type === "FETCH_ERROR" ||
      i.type === "VALIDATION_ERRORS" ||
      i.type === "CUISINE_CONTAMINATION" ||
      i.type === "RESTAURANT_MISMATCH"
    );

    result.ok = !hasBlockingIssues && result.score && result.score.isPerfect;

  } catch (err) {
    result.issues.push({ type: "EXCEPTION", message: err.message });
  }

  result.timing.total_ms = Date.now() - startTime;
  return result;
}

/**
 * Get all items from a menu
 */
function getAllItems(menu) {
  if (!menu || !menu.sections) return [];
  return menu.sections.flatMap(s => s.items || []);
}

// ============================================================================
// TUNING LOOP
// ============================================================================

async function runTuningLoop(restaurants, env, options) {
  const runId = `tune_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  MENU TUNING HARNESS: "Ferrari in the Garage"`);
  console.log(`${"=".repeat(70)}`);
  console.log(`  Run ID: ${runId}`);
  console.log(`  Restaurants to test: ${restaurants.length}`);
  console.log(`  Target: ${options.targetConsecutive} consecutive perfect menus`);
  console.log(`  Fresh fetch: ${options.fresh}`);
  console.log(`  Verbose: ${options.verbose}`);
  console.log(`${"=".repeat(70)}\n`);

  let consecutivePasses = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  const results = [];
  const failureAnalysis = new Map();

  for (let i = 0; i < restaurants.length; i++) {
    const restaurant = restaurants[i];
    const testNum = i + 1;

    console.log(`\n[${testNum}/${restaurants.length}] ${restaurant.name}`);
    console.log(`  Cuisine: ${restaurant.cuisine || "unknown"}`);
    console.log(`  URL: ${restaurant.uber_url}`);

    const result = await testRestaurant(restaurant, env, options);
    results.push(result);

    if (result.ok) {
      consecutivePasses++;
      totalPassed++;

      console.log(`  ✅ PASS (${consecutivePasses}/${options.targetConsecutive})`);
      console.log(`     Score: ${result.score?.score}/${result.score?.maxScore}`);
      console.log(`     Stats: ${result.rawStats?.sections} sections, ${result.rawStats?.items} items`);

      if (options.verbose && result.score) {
        console.log(`     Breakdown:`);
        for (const [key, data] of Object.entries(result.score.breakdown)) {
          console.log(`       - ${key}: ${data.score}/${data.max}`);
        }
      }

      console.log(`     Time: ${result.timing.total_ms}ms${result.fromCache ? " (cached)" : ""}`);

      if (consecutivePasses >= options.targetConsecutive) {
        console.log(`\n${"=".repeat(70)}`);
        console.log(`  🏎️  FERRARI TUNED! ${options.targetConsecutive}/${options.targetConsecutive} PERFECT!`);
        console.log(`${"=".repeat(70)}\n`);
        break;
      }
    } else {
      consecutivePasses = 0;
      totalFailed++;

      console.log(`  ❌ FAIL`);

      if (result.score) {
        console.log(`     Score: ${result.score.score}/${result.score.maxScore} (needs ${Math.ceil(result.score.maxScore * 0.95)}+)`);
      }

      if (result.issues.length > 0) {
        console.log(`     Issues (${result.issues.length}):`);
        for (const issue of result.issues) {
          console.log(`       - ${issue.type}`);

          // Track failure patterns
          const key = issue.type;
          failureAnalysis.set(key, (failureAnalysis.get(key) || 0) + 1);

          if (options.verbose) {
            if (issue.message) console.log(`         ${issue.message}`);
            if (issue.count) console.log(`         Count: ${issue.count}`);
            if (issue.errors) {
              for (const err of issue.errors) {
                console.log(`         - ${err.code}: ${err.message}`);
              }
            }
            if (issue.examples) {
              console.log(`         Examples: ${issue.examples.join(", ")}`);
            }
          }
        }
      }

      if (options.stopOnFail) {
        console.log(`\n  ⛔ Stopping on first failure`);
        break;
      }
    }
  }

  // Final summary
  const achieved = consecutivePasses >= options.targetConsecutive;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  FINAL SUMMARY`);
  console.log(`${"=".repeat(70)}`);
  console.log(`  Total tested:     ${results.length}`);
  console.log(`  Passed:           ${totalPassed}`);
  console.log(`  Failed:           ${totalFailed}`);
  console.log(`  Consecutive:      ${consecutivePasses}`);
  console.log(`  Target:           ${options.targetConsecutive}`);
  console.log(`  Status:           ${achieved ? "✅ TUNED" : "❌ NOT YET TUNED"}`);

  if (failureAnalysis.size > 0) {
    console.log(`\n  Failure Analysis (root causes):`);
    const sorted = [...failureAnalysis.entries()].sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sorted.slice(0, 10)) {
      console.log(`    - ${type}: ${count}`);
    }
  }

  console.log(`${"=".repeat(70)}\n`);

  // Save report
  const reportPath = path.join(options.artifactsDir, `${runId}-report.json`);
  try {
    if (!fs.existsSync(options.artifactsDir)) {
      fs.mkdirSync(options.artifactsDir, { recursive: true });
    }
    fs.writeFileSync(reportPath, JSON.stringify({
      runId,
      timestamp: new Date().toISOString(),
      achieved,
      consecutivePasses,
      target: options.targetConsecutive,
      totalTested: results.length,
      totalPassed,
      totalFailed,
      failureAnalysis: Object.fromEntries(failureAnalysis),
      restaurants: restaurants.map((r, i) => ({
        ...r,
        result: results[i] ? {
          ok: results[i].ok,
          score: results[i].score?.score,
          maxScore: results[i].score?.maxScore,
          issues: results[i].issues.map(i => i.type),
          timing: results[i].timing
        } : null
      }))
    }, null, 2));
    console.log(`Report saved to: ${reportPath}\n`);
  } catch (e) {
    console.error(`Failed to save report: ${e.message}`);
  }

  return {
    achieved,
    consecutivePasses,
    results,
    failureAnalysis
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const options = parseArgs();

  // Check for required env vars
  const env = {
    APIFY_TOKEN: process.env.APIFY_TOKEN,
    APIFY_UBER_ACTOR_ID: process.env.APIFY_UBER_ACTOR_ID
  };

  if (!env.APIFY_TOKEN) {
    console.error("ERROR: APIFY_TOKEN environment variable is required");
    console.error("Set it with: export APIFY_TOKEN=your_token_here");
    process.exit(1);
  }

  // Load fixtures
  let restaurants;
  try {
    const content = fs.readFileSync(options.fixturesFile, "utf8");
    restaurants = JSON.parse(content);
    console.log(`Loaded ${restaurants.length} restaurants from ${options.fixturesFile}`);
  } catch (e) {
    console.error(`Failed to load fixtures: ${e.message}`);
    process.exit(1);
  }

  // Create fixtures directory
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  // Run the tuning loop
  const result = await runTuningLoop(restaurants, env, options);

  process.exit(result.achieved ? 0 : 1);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
