const { execSync } = require("child_process");
const fs = require("fs");

/**
 * Menu Pipeline V2 Orchestrator
 *
 * Runs the V2 multi-source adjudication pipeline:
 * 1. Website menu scraping
 * 2. Menu adjudication (Uber + Website)
 * 3. Confidence scoring
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

function runPipelineV2(websiteUrl, uberMenuPath = "published_menu.json") {
  console.log("\n" + "█".repeat(60));
  console.log("█  MENU PIPELINE V2");
  console.log("█  Multi-Source Adjudication");
  console.log("█".repeat(60));

  if (!websiteUrl) {
    console.error("\n❌ Error: Restaurant website URL required");
    console.error("   Usage: node runMenuPipelineV2.cjs <website-url> [uber-menu-path]");
    console.error("\nExample:");
    console.error('   node runMenuPipelineV2.cjs "https://www.restaurant.com/menu" published_menu.json');
    process.exit(1);
  }

  console.log(`\n📍 Website URL: ${websiteUrl}`);
  console.log(`📍 Uber menu: ${uberMenuPath}`);

  // Check if Uber menu exists
  if (!fs.existsSync(uberMenuPath)) {
    console.error(`\n❌ Error: Uber menu not found: ${uberMenuPath}`);
    console.error("   Run V1 pipeline first to generate published_menu.json");
    process.exit(1);
  }

  const startTime = Date.now();

  // Step 1: Scrape website menu
  if (!runStep("1. WEBSITE SCRAPE (websiteMenuScraper.cjs)", `node websiteMenuScraper.cjs "${websiteUrl}" website_menu_extracted.json`)) {
    process.exit(1);
  }

  // Check if website scrape produced results
  try {
    const websiteMenu = JSON.parse(fs.readFileSync("website_menu_extracted.json", "utf-8"));
    const itemCount = websiteMenu.sections?.reduce((sum, s) => sum + (s.items?.length || 0), 0) || 0;

    if (itemCount === 0) {
      console.log("\n⚠️  Website scrape produced no items");
      console.log("   Continuing with Uber-only adjudication...\n");
    } else {
      console.log(`\n✅ Website scrape successful: ${itemCount} items found\n`);
    }
  } catch (e) {
    console.log("\n⚠️  Could not verify website scrape results");
  }

  // Step 2: Adjudicate menus
  if (!runStep("2. ADJUDICATE (menuJudge.cjs)", `node menuJudge.cjs "${uberMenuPath}" website_menu_extracted.json adjudicated_menu.json`)) {
    process.exit(1);
  }

  // Step 3: Compute confidence
  if (!runStep("3. CONFIDENCE (menuConfidence.cjs)", `node menuConfidence.cjs adjudicated_menu.json`)) {
    process.exit(1);
  }

  // Load final confidence report
  let confidenceScore = 0;
  let recommendation = "unknown";

  try {
    const report = JSON.parse(fs.readFileSync("menu_confidence_report.json", "utf-8"));
    confidenceScore = report.confidence_score || 0;

    if (confidenceScore >= 0.7) {
      recommendation = "PUBLISH - High confidence";
    } else if (confidenceScore >= 0.4) {
      recommendation = "PUBLISH WITH WARNING - Medium confidence";
    } else {
      recommendation = "FALLBACK TO V1 - Low confidence";
    }
  } catch (e) {
    console.log("\n⚠️  Could not read confidence report");
  }

  // Final summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "█".repeat(60));
  console.log("█  PIPELINE V2 COMPLETE");
  console.log("█".repeat(60));

  console.log(`\n⏱️  Total time: ${elapsed}s`);
  console.log(`\n📊 Confidence Score: ${(confidenceScore * 100).toFixed(0)}%`);
  console.log(`📊 Recommendation: ${recommendation}`);

  console.log("\n📁 Output files:");
  console.log("   - website_menu_extracted.json (website scrape)");
  console.log("   - adjudicated_menu.json (merged menu)");
  console.log("   - menu_confidence_report.json (scoring report)");

  // Publish decision
  if (confidenceScore >= 0.7) {
    console.log("\n✅ V2 adjudicated menu is ready for use");
  } else if (confidenceScore >= 0.4) {
    console.log("\n⚠️  V2 menu has moderate confidence - review recommended");
  } else {
    console.log("\n❌ V2 confidence too low - use V1 published_menu.json instead");
  }

  console.log("\n");

  return {
    success: true,
    confidence_score: confidenceScore,
    recommendation: recommendation,
    elapsed_seconds: parseFloat(elapsed)
  };
}

// Run if called directly
if (require.main === module) {
  const websiteUrl = process.argv[2];
  const uberMenuPath = process.argv[3] || "published_menu.json";

  runPipelineV2(websiteUrl, uberMenuPath);
}

module.exports = { runPipelineV2 };
