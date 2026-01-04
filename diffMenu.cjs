const fs = require("fs");
const path = require("path");

/**
 * Menu Diff & Change Detection
 *
 * Compares two menu snapshots and detects meaningful changes.
 * Pure comparison logic - no AI, no scraping.
 */

const SNAPSHOTS_DIR = "./snapshots";

/**
 * Load snapshot by version ID or "latest"
 */
function loadSnapshot(restaurantSlug, versionId) {
  const snapshotDir = path.join(SNAPSHOTS_DIR, restaurantSlug);

  if (versionId === "latest") {
    const latestPath = path.join(snapshotDir, "latest.json");
    if (!fs.existsSync(latestPath)) {
      return null;
    }
    const latestData = JSON.parse(fs.readFileSync(latestPath, "utf-8"));
    versionId = latestData.menu_version_id;
  }

  const snapshotPath = path.join(snapshotDir, `${versionId}.json`);
  if (!fs.existsSync(snapshotPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
}

/**
 * Get all snapshot versions for a restaurant (sorted by date, oldest first)
 */
function getSnapshotVersions(restaurantSlug) {
  const snapshotDir = path.join(SNAPSHOTS_DIR, restaurantSlug);
  if (!fs.existsSync(snapshotDir)) {
    return [];
  }

  const files = fs.readdirSync(snapshotDir);
  const snapshots = [];

  for (const file of files) {
    if (file === "latest.json") continue;
    if (!file.endsWith(".json")) continue;

    const filePath = path.join(snapshotDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      snapshots.push({
        version_id: data.menu_version_id,
        created_at: data.created_at,
        item_count: data.items?.length || 0
      });
    } catch (e) {
      // Skip invalid files
    }
  }

  // Sort by created_at (oldest first)
  snapshots.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  return snapshots;
}

/**
 * Compare two menu snapshots
 */
function diffSnapshots(oldSnapshot, newSnapshot) {
  const oldItems = oldSnapshot.items || [];
  const newItems = newSnapshot.items || [];

  // Build maps by source_id
  const oldMap = new Map();
  for (const item of oldItems) {
    if (item.source_id) {
      oldMap.set(item.source_id, item);
    }
  }

  const newMap = new Map();
  for (const item of newItems) {
    if (item.source_id) {
      newMap.set(item.source_id, item);
    }
  }

  const addedItems = [];
  const removedItems = [];
  const priceChanges = [];
  const categoryChanges = [];

  // Find added items (in new but not in old)
  for (const [sourceId, item] of newMap) {
    if (!oldMap.has(sourceId)) {
      addedItems.push({
        source_id: sourceId,
        name: item.name,
        price_cents: item.price_cents,
        canonical_category: item.canonical_category
      });
    }
  }

  // Find removed items (in old but not in new)
  for (const [sourceId, item] of oldMap) {
    if (!newMap.has(sourceId)) {
      removedItems.push({
        source_id: sourceId,
        name: item.name,
        price_cents: item.price_cents,
        canonical_category: item.canonical_category
      });
    }
  }

  // Find price and category changes (in both)
  for (const [sourceId, newItem] of newMap) {
    const oldItem = oldMap.get(sourceId);
    if (!oldItem) continue;

    // Price change
    if (oldItem.price_cents !== newItem.price_cents) {
      priceChanges.push({
        source_id: sourceId,
        name: newItem.name,
        old_price_cents: oldItem.price_cents,
        new_price_cents: newItem.price_cents,
        change_cents: (newItem.price_cents || 0) - (oldItem.price_cents || 0)
      });
    }

    // Category change
    if (oldItem.canonical_category !== newItem.canonical_category) {
      categoryChanges.push({
        source_id: sourceId,
        name: newItem.name,
        old_category: oldItem.canonical_category,
        new_category: newItem.canonical_category
      });
    }
  }

  const hasChanges =
    addedItems.length > 0 ||
    removedItems.length > 0 ||
    priceChanges.length > 0 ||
    categoryChanges.length > 0;

  return {
    has_changes: hasChanges,
    old_version: oldSnapshot.menu_version_id,
    new_version: newSnapshot.menu_version_id,
    old_created_at: oldSnapshot.created_at,
    new_created_at: newSnapshot.created_at,
    added_items: addedItems,
    removed_items: removedItems,
    price_changes: priceChanges,
    category_changes: categoryChanges,
    summary: {
      added: addedItems.length,
      removed: removedItems.length,
      price_changed: priceChanges.length,
      category_changed: categoryChanges.length,
      old_item_count: oldItems.length,
      new_item_count: newItems.length
    }
  };
}

/**
 * Main diff function
 */
function diffMenu(restaurantSlug, oldVersionId = null, newVersionId = "latest", outputPath = "menu_diff_report.json") {
  console.log("🔍 Starting menu diff...\n");

  // If no old version specified, find the previous one
  if (!oldVersionId) {
    const versions = getSnapshotVersions(restaurantSlug);
    if (versions.length < 2) {
      console.log("⚠️  Not enough snapshots to compare");
      console.log(`   Found ${versions.length} snapshot(s) for "${restaurantSlug}"`);

      const report = {
        has_changes: false,
        error: "Not enough snapshots to compare",
        snapshots_found: versions.length
      };
      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
      return report;
    }

    // Get the two most recent
    const latestVersion = versions[versions.length - 1].version_id;
    const previousVersion = versions[versions.length - 2].version_id;

    oldVersionId = previousVersion;
    newVersionId = latestVersion;

    console.log(`📊 Comparing last two snapshots:`);
    console.log(`   Old: ${oldVersionId}`);
    console.log(`   New: ${newVersionId}\n`);
  }

  // Load snapshots
  const oldSnapshot = loadSnapshot(restaurantSlug, oldVersionId);
  if (!oldSnapshot) {
    console.error(`❌ Could not load old snapshot: ${oldVersionId}`);
    return { has_changes: false, error: `Could not load old snapshot: ${oldVersionId}` };
  }

  const newSnapshot = loadSnapshot(restaurantSlug, newVersionId);
  if (!newSnapshot) {
    console.error(`❌ Could not load new snapshot: ${newVersionId}`);
    return { has_changes: false, error: `Could not load new snapshot: ${newVersionId}` };
  }

  console.log(`📊 Restaurant: ${newSnapshot.restaurant?.name || restaurantSlug}`);
  console.log(`📊 Old version: ${oldSnapshot.menu_version_id} (${oldSnapshot.items?.length || 0} items)`);
  console.log(`📊 New version: ${newSnapshot.menu_version_id} (${newSnapshot.items?.length || 0} items)\n`);

  // Perform diff
  const diff = diffSnapshots(oldSnapshot, newSnapshot);
  diff.restaurant = newSnapshot.restaurant?.name || restaurantSlug;
  diff.diffed_at = new Date().toISOString();

  // Write report
  fs.writeFileSync(outputPath, JSON.stringify(diff, null, 2));

  // Print summary
  console.log("═══════════════════════════════════════");
  console.log(`DIFF ${diff.has_changes ? "CHANGES DETECTED" : "NO CHANGES"}`);
  console.log("═══════════════════════════════════════\n");

  console.log(`📊 Added items: ${diff.summary.added}`);
  console.log(`📊 Removed items: ${diff.summary.removed}`);
  console.log(`📊 Price changes: ${diff.summary.price_changed}`);
  console.log(`📊 Category changes: ${diff.summary.category_changed}`);

  if (diff.added_items.length > 0) {
    console.log("\n➕ Added Items:");
    diff.added_items.slice(0, 5).forEach((item, i) => {
      console.log(`   ${i + 1}. ${item.name} - $${((item.price_cents || 0) / 100).toFixed(2)}`);
    });
    if (diff.added_items.length > 5) {
      console.log(`   ... and ${diff.added_items.length - 5} more`);
    }
  }

  if (diff.removed_items.length > 0) {
    console.log("\n➖ Removed Items:");
    diff.removed_items.slice(0, 5).forEach((item, i) => {
      console.log(`   ${i + 1}. ${item.name}`);
    });
    if (diff.removed_items.length > 5) {
      console.log(`   ... and ${diff.removed_items.length - 5} more`);
    }
  }

  if (diff.price_changes.length > 0) {
    console.log("\n💰 Price Changes:");
    diff.price_changes.slice(0, 5).forEach((change, i) => {
      const oldPrice = ((change.old_price_cents || 0) / 100).toFixed(2);
      const newPrice = ((change.new_price_cents || 0) / 100).toFixed(2);
      const direction = change.change_cents > 0 ? "↑" : "↓";
      console.log(`   ${i + 1}. ${change.name}: $${oldPrice} → $${newPrice} (${direction}$${Math.abs(change.change_cents / 100).toFixed(2)})`);
    });
    if (diff.price_changes.length > 5) {
      console.log(`   ... and ${diff.price_changes.length - 5} more`);
    }
  }

  if (diff.category_changes.length > 0) {
    console.log("\n🏷️ Category Changes:");
    diff.category_changes.slice(0, 5).forEach((change, i) => {
      console.log(`   ${i + 1}. ${change.name}: ${change.old_category} → ${change.new_category}`);
    });
    if (diff.category_changes.length > 5) {
      console.log(`   ... and ${diff.category_changes.length - 5} more`);
    }
  }

  console.log(`\n💾 Report saved to ${outputPath}`);

  return diff;
}

// Run if called directly
if (require.main === module) {
  const restaurantSlug = process.argv[2] || "shake-shack-coral-gables";
  const oldVersion = process.argv[3] || null;
  const newVersion = process.argv[4] || "latest";

  const result = diffMenu(restaurantSlug, oldVersion, newVersion);

  console.log(`\n✅ Diff complete: ${result.has_changes ? "CHANGES FOUND" : "NO CHANGES"}\n`);
}

module.exports = { diffMenu, diffSnapshots, loadSnapshot, getSnapshotVersions };
