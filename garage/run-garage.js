#!/usr/bin/env node
/**
 * GARAGE MODE CLI Runner
 *
 * Usage:
 *   node garage/run-garage.js                    # Run with default test restaurants
 *   node garage/run-garage.js --file fixtures.json   # Run with custom fixtures
 *   node garage/run-garage.js --url "https://..."    # Test single URL
 *   node garage/run-garage.js --continue             # Don't stop on first failure
 *
 * Environment:
 *   APIFY_TOKEN - Required for Apify API access
 *   APIFY_UBER_ACTOR_ID - Optional, defaults to "borderline~ubereats-scraper"
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { garageRunner, garageIngestMenu, createIdentityBundle, validateMenuStrict, diffAgainstTruth } from "./garage-mode.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// DEFAULT TEST RESTAURANTS
// ============================================================================
const DEFAULT_RESTAURANTS = [
  {
    restaurant_id: "chipotle-mexican-grill",
    uber_url: "https://www.ubereats.com/store/chipotle-mexican-grill-2001-k-st-nw/sHvkP4eQSoatfK0HNqNPew",
    name: "Chipotle Mexican Grill"
  },
  {
    restaurant_id: "mcdonalds",
    uber_url: "https://www.ubereats.com/store/mcdonalds-1250-u-st-nw/sBzzAJ7wSvOPzyf2lOv8Ag",
    name: "McDonald's"
  },
  {
    restaurant_id: "sweetgreen",
    uber_url: "https://www.ubereats.com/store/sweetgreen-1512-connecticut-ave-nw/XK6BLwFHQHKFGH9EKA6_Pg",
    name: "Sweetgreen"
  },
  {
    restaurant_id: "subway",
    uber_url: "https://www.ubereats.com/store/subway-1156-18th-st-nw/WBXwvJTpSjS7B0e_6NJg0A",
    name: "Subway"
  },
  {
    restaurant_id: "starbucks",
    uber_url: "https://www.ubereats.com/store/starbucks-1301-k-st-nw/RFP9VNE_QHiEVxXpVfK9eg",
    name: "Starbucks"
  },
  {
    restaurant_id: "chick-fil-a",
    uber_url: "https://www.ubereats.com/store/chick-fil-a-1134-19th-st-nw/q8kL1VLSTBuIUgNxPAiCLg",
    name: "Chick-fil-A"
  },
  {
    restaurant_id: "panera-bread",
    uber_url: "https://www.ubereats.com/store/panera-bread/Bf-3zq4iRCKCPdJz0fJz3Q",
    name: "Panera Bread"
  },
  {
    restaurant_id: "five-guys",
    uber_url: "https://www.ubereats.com/store/five-guys-1400-i-st-nw/RnfXaJ9XQSmZ2z_lhXxA1w",
    name: "Five Guys"
  },
  {
    restaurant_id: "wendys",
    uber_url: "https://www.ubereats.com/store/wendys-1-dupont-circle-nw/IKRgLfaAQaKz3xFRqFxfVw",
    name: "Wendy's"
  },
  {
    restaurant_id: "popeyes",
    uber_url: "https://www.ubereats.com/store/popeyes-louisiana-kitchen-1206-h-st-ne/OGJ7IrfdT--j6aZ9R0x1pA",
    name: "Popeyes"
  },
  {
    restaurant_id: "taco-bell",
    uber_url: "https://www.ubereats.com/store/taco-bell-1726-l-st-nw/i9J0Y1hERrmW3u4VQHxdIQ",
    name: "Taco Bell"
  },
  {
    restaurant_id: "cava",
    uber_url: "https://www.ubereats.com/store/cava-1330-connecticut-ave-nw/aNQ3vCJmQbqGdmGlOXtFpQ",
    name: "CAVA"
  }
];

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    restaurants: DEFAULT_RESTAURANTS,
    stopOnFail: true,
    targetConsecutive: 10,
    singleUrl: null,
    fixturesFile: null,
    verbose: false,
    saveArtifacts: true,
    artifactsDir: path.join(__dirname, "artifacts")
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--continue" || arg === "-c") {
      options.stopOnFail = false;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--url" || arg === "-u") {
      options.singleUrl = args[++i];
    } else if (arg === "--file" || arg === "-f") {
      options.fixturesFile = args[++i];
    } else if (arg === "--target" || arg === "-t") {
      options.targetConsecutive = parseInt(args[++i], 10) || 10;
    } else if (arg === "--no-artifacts") {
      options.saveArtifacts = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  // Load fixtures file if specified
  if (options.fixturesFile) {
    try {
      const content = fs.readFileSync(options.fixturesFile, "utf8");
      options.restaurants = JSON.parse(content);
      console.log(`Loaded ${options.restaurants.length} restaurants from ${options.fixturesFile}`);
    } catch (e) {
      console.error(`Failed to load fixtures: ${e.message}`);
      process.exit(1);
    }
  }

  // Single URL mode
  if (options.singleUrl) {
    const urlMatch = options.singleUrl.match(/\/store\/([^/]+)\/([a-f0-9-]+)/i);
    const restaurantId = urlMatch ? urlMatch[1] : "test-restaurant";
    options.restaurants = [
      { restaurant_id: restaurantId, uber_url: options.singleUrl, name: restaurantId }
    ];
    options.targetConsecutive = 1;
  }

  return options;
}

function printHelp() {
  console.log(`
GARAGE MODE - Uber Eats Menu Ingestion Tuning Harness

Usage:
  node garage/run-garage.js [options]

Options:
  --url, -u <url>       Test a single Uber Eats URL
  --file, -f <path>     Load restaurants from JSON file
  --target, -t <n>      Target consecutive passes (default: 10)
  --continue, -c        Don't stop on first failure
  --verbose, -v         Verbose output
  --no-artifacts        Don't save artifacts to disk
  --help, -h            Show this help

Environment Variables:
  APIFY_TOKEN           Required - Apify API token
  APIFY_UBER_ACTOR_ID   Optional - Custom actor ID

Examples:
  # Run default test suite (10 restaurants)
  node garage/run-garage.js

  # Test single restaurant
  node garage/run-garage.js --url "https://www.ubereats.com/store/chipotle/xyz123"

  # Run all without stopping on failure
  node garage/run-garage.js --continue

  # Custom fixtures file
  node garage/run-garage.js --file my-restaurants.json
`);
}

// ============================================================================
// ARTIFACT SAVING
// ============================================================================
function saveArtifacts(result, options) {
  if (!options.saveArtifacts) return;

  const dir = path.join(options.artifactsDir, result.sessionId);

  try {
    fs.mkdirSync(dir, { recursive: true });

    // Save raw Apify payload
    if (result.rawApify) {
      fs.writeFileSync(
        path.join(dir, "raw-apify.json"),
        JSON.stringify(result.rawApify, null, 2)
      );
    }

    // Save normalized menu
    if (result.menu) {
      fs.writeFileSync(
        path.join(dir, "normalized-menu.json"),
        JSON.stringify(result.menu, null, 2)
      );
    }

    // Save validation result
    if (result.validationResult) {
      fs.writeFileSync(
        path.join(dir, "validation.json"),
        JSON.stringify(result.validationResult, null, 2)
      );
    }

    // Save diff result
    if (result.diffResult) {
      fs.writeFileSync(
        path.join(dir, "diff.json"),
        JSON.stringify(result.diffResult, null, 2)
      );
    }

    // Save summary
    fs.writeFileSync(
      path.join(dir, "summary.json"),
      JSON.stringify({
        ok: result.ok,
        identity: result.identity,
        timing: result.timing,
        error: result.error
      }, null, 2)
    );

    console.log(`     Artifacts saved to: ${dir}`);
  } catch (e) {
    console.error(`     Failed to save artifacts: ${e.message}`);
  }
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

  // Create artifacts directory
  if (options.saveArtifacts) {
    fs.mkdirSync(options.artifactsDir, { recursive: true });
  }

  // Run the garage
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const results = [];
  let consecutivePasses = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  GARAGE MODE: Uber Eats Menu Ingestion Tuning`);
  console.log(`${"=".repeat(70)}`);
  console.log(`  Run ID: ${runId}`);
  console.log(`  Restaurants to test: ${options.restaurants.length}`);
  console.log(`  Target: ${options.targetConsecutive} consecutive perfect menus`);
  console.log(`  Stop on fail: ${options.stopOnFail}`);
  console.log(`  Artifacts: ${options.saveArtifacts ? options.artifactsDir : "disabled"}`);
  console.log(`${"=".repeat(70)}\n`);

  for (let i = 0; i < options.restaurants.length; i++) {
    const restaurant = options.restaurants[i];
    const testNum = i + 1;

    console.log(`\n[${ testNum }/${options.restaurants.length}] ${restaurant.name || restaurant.restaurant_id}`);
    console.log(`  URL: ${restaurant.uber_url}`);

    const sessionId = `${runId}_${i}_${restaurant.restaurant_id}`;

    try {
      const result = await garageIngestMenu(
        restaurant.restaurant_id,
        restaurant.uber_url,
        { env, sessionId, timeout: 180000 }
      );

      result.sessionId = sessionId;
      results.push(result);

      // Save artifacts
      saveArtifacts(result, options);

      if (result.ok) {
        consecutivePasses++;
        totalPassed++;
        console.log(`  ✅ PASS (${consecutivePasses}/${options.targetConsecutive} consecutive)`);

        if (result.menu) {
          const m = result.menu.metadata;
          console.log(`     Menu: ${m.total_sections} sections, ${m.total_items} items, ${m.total_modifier_groups} modifier groups, ${m.total_options} options`);
        }
        console.log(`     Time: ${result.timing.total_ms}ms (fetch: ${result.timing.fetch_ms}ms, normalize: ${result.timing.normalize_ms}ms)`);

        if (consecutivePasses >= options.targetConsecutive) {
          console.log(`\n${"=".repeat(70)}`);
          console.log(`  🏎️  FERRARI TUNED: ${options.targetConsecutive}/${options.targetConsecutive} PERFECT!`);
          console.log(`${"=".repeat(70)}\n`);
          break;
        }
      } else {
        consecutivePasses = 0;
        totalFailed++;
        console.log(`  ❌ FAIL`);

        if (result.error) {
          console.log(`     Error: ${result.error}`);
        }

        if (result.validationResult && !result.validationResult.valid) {
          console.log(`     Validation: ${result.validationResult.errorCount} errors`);
          const grouped = result.validationResult.errorsByCode;
          const top5 = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 5);
          for (const [code, count] of top5) {
            console.log(`       - ${code}: ${count}`);
          }
        }

        if (result.diffResult && !result.diffResult.match) {
          console.log(`     Diff: ${result.diffResult.errorCount} errors, ${result.diffResult.warningCount} warnings`);
          const grouped = result.diffResult.diffsByType;
          const top5 = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 5);
          for (const [type, count] of top5) {
            console.log(`       - ${type}: ${count}`);
          }
        }

        if (options.stopOnFail) {
          console.log(`\n  ⛔ Stopping on first failure`);
          break;
        }
      }
    } catch (e) {
      consecutivePasses = 0;
      totalFailed++;
      console.log(`  ❌ EXCEPTION: ${e.message}`);

      results.push({
        restaurant_id: restaurant.restaurant_id,
        ok: false,
        error: e.message,
        sessionId
      });

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

  if (!achieved && totalFailed > 0) {
    console.log(`\n  Failure Analysis:`);

    const fetchErrors = results.filter(r => r.error && !r.validationResult).length;
    const validationErrors = results.filter(r => r.validationResult && !r.validationResult.valid).length;
    const diffErrors = results.filter(r => r.diffResult && !r.diffResult.match).length;

    if (fetchErrors > 0) console.log(`    - Fetch errors: ${fetchErrors}`);
    if (validationErrors > 0) console.log(`    - Validation errors: ${validationErrors}`);
    if (diffErrors > 0) console.log(`    - Diff mismatches: ${diffErrors}`);
  }

  console.log(`${"=".repeat(70)}\n`);

  // Write final report
  if (options.saveArtifacts) {
    const reportPath = path.join(options.artifactsDir, `${runId}-report.json`);
    fs.writeFileSync(reportPath, JSON.stringify({
      runId,
      timestamp: new Date().toISOString(),
      achieved,
      consecutivePasses,
      target: options.targetConsecutive,
      totalTested: results.length,
      totalPassed,
      totalFailed,
      restaurants: options.restaurants.map((r, i) => ({
        ...r,
        result: results[i] ? {
          ok: results[i].ok,
          error: results[i].error,
          timing: results[i].timing
        } : null
      }))
    }, null, 2));
    console.log(`Report saved to: ${reportPath}\n`);
  }

  process.exit(achieved ? 0 : 1);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
