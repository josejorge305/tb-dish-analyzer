const { execSync } = require("child_process");
const fs = require("fs");

/**
 * Menu Pipeline Orchestrator
 *
 * Runs the full menu ingestion pipeline in order.
 * Stops immediately if validation fails.
 */

function runStep(stepName, command) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`STEP: ${stepName}`);
  console.log(`${"═".repeat(60)}\n`);

  try {
    execSync(command, { stdio: "inherit" });
    return true;
  } catch (e) {
    console.error(`\n❌ PIPELINE FAILED at step: ${stepName}`);
    console.error(`   Command: ${command}`);
    return false;
  }
}

function runPipeline(restaurantUrl) {
  console.log("\n" + "█".repeat(60));
  console.log("█  MENU INGESTION PIPELINE v1");
  console.log("█  Uber Eats DOM-Based Scraper");
  console.log("█".repeat(60));

  if (!restaurantUrl) {
    console.error("\n❌ Error: Restaurant URL required");
    console.error("   Usage: node runMenuPipeline.cjs \"https://www.ubereats.com/store/...\"");
    process.exit(1);
  }

  console.log(`\n📍 Target: ${restaurantUrl}\n`);

  const startTime = Date.now();

  // Step 1: Scrape
  if (!runStep("1. SCRAPE (uberScraper.cjs)", `node uberScraper.cjs "${restaurantUrl}"`)) {
    process.exit(1);
  }

  // Step 2: Normalize
  if (!runStep("2. NORMALIZE (normalizeMenu.cjs)", "node normalizeMenu.cjs uber_menu_extracted.json normalized_menu.json")) {
    process.exit(1);
  }

  // Step 3: Validate
  if (!runStep("3. VALIDATE (validateMenu.cjs)", "node validateMenu.cjs normalized_menu.json menu_validation_report.json")) {
    process.exit(1);
  }

  // Check validation result
  try {
    const validationReport = JSON.parse(fs.readFileSync("menu_validation_report.json", "utf-8"));
    if (!validationReport.pass) {
      console.log("\n" + "═".repeat(60));
      console.log("❌ PIPELINE STOPPED: VALIDATION FAILED");
      console.log("═".repeat(60));
      console.log(`\n   Critical errors: ${validationReport.summary?.critical_errors || 0}`);
      console.log("   See menu_validation_report.json for details\n");
      process.exit(1);
    }
    console.log("\n✅ Validation PASSED - continuing pipeline\n");
  } catch (e) {
    console.error("\n❌ Could not read validation report");
    process.exit(1);
  }

  // Step 4: Snapshot
  if (!runStep("4. SNAPSHOT (snapshotMenu.cjs)", "node snapshotMenu.cjs normalized_menu.json menu_validation_report.json")) {
    process.exit(1);
  }

  // Get restaurant slug from normalized menu for diff/publish
  let restaurantSlug = "unknown";
  try {
    const normalized = JSON.parse(fs.readFileSync("normalized_menu.json", "utf-8"));
    const name = normalized.restaurant?.name || "Unknown";
    restaurantSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
  } catch (e) {
    console.error("⚠️  Could not determine restaurant slug, using 'unknown'");
  }

  // Step 5: Diff
  if (!runStep("5. DIFF (diffMenu.cjs)", `node diffMenu.cjs "${restaurantSlug}"`)) {
    process.exit(1);
  }

  // Step 6: Publish
  if (!runStep("6. PUBLISH (publishMenu.cjs)", `node publishMenu.cjs "${restaurantSlug}" menu_diff_report.json published_menu.json`)) {
    process.exit(1);
  }

  // Final summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "█".repeat(60));
  console.log("█  PIPELINE COMPLETE ✅");
  console.log("█".repeat(60));

  console.log(`\n⏱️  Total time: ${elapsed}s`);
  console.log("\n📁 Output files:");
  console.log("   - uber_menu_extracted.json (raw scrape)");
  console.log("   - uber_menu_raw.html (HTML backup)");
  console.log("   - normalized_menu.json (normalized)");
  console.log("   - menu_validation_report.json (validation)");
  console.log("   - snapshots/{slug}/{version}.json (versioned snapshot)");
  console.log("   - menu_diff_report.json (diff from previous)");
  console.log("   - published_menu.json (consumer-ready payload)");

  console.log("\n🎉 Menu ready for consumption!\n");
}

// Run if called directly
if (require.main === module) {
  const restaurantUrl = process.argv[2];
  runPipeline(restaurantUrl);
}

module.exports = { runPipeline };
