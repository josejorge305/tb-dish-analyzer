#!/usr/bin/env node
/**
 * Unit tests for Menu Quality module
 * Run: node garage/test-menu-quality.js
 */

import {
  detectJunkItem,
  filterJunkItems,
  detectCuisineContamination,
  detectRestaurantMismatch,
  detectMenuAnomalies,
  mapToCanonicalCategory,
  sortSectionsByCanonicalOrder
} from "./menu-quality.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${e.message}`);
    failed++;
  }
}

function assertTrue(condition, msg = "") {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEqual(actual, expected, msg = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ============================================================================
// TESTS
// ============================================================================

console.log("\n=== MENU QUALITY UNIT TESTS ===\n");

console.log("Junk Item Detection:");
test("detects add-on items", () => {
  const result = detectJunkItem({ name: "Add Extra Cheese" });
  assertTrue(result.isJunk, "Should detect 'Add Extra Cheese' as junk");
  assertEqual(result.reason, "junk_addons");
});

test("detects grocery-style items", () => {
  const result = detectJunkItem({ name: "24pk Water Bottles" });
  assertTrue(result.isJunk, "Should detect '24pk Water Bottles' as junk");
  assertEqual(result.reason, "junk_grocery");
});

test("detects system placeholder items", () => {
  const result = detectJunkItem({ name: "[Placeholder Item]" });
  assertTrue(result.isJunk);
});

test("allows valid menu items", () => {
  const burger = detectJunkItem({ name: "Classic Cheeseburger" });
  assertTrue(!burger.isJunk, "Burger should not be junk");

  const salad = detectJunkItem({ name: "Caesar Salad" });
  assertTrue(!salad.isJunk, "Salad should not be junk");

  const taco = detectJunkItem({ name: "Chicken Taco" });
  assertTrue(!taco.isJunk, "Taco should not be junk");
});

test("filters junk from item list", () => {
  const items = [
    { name: "Cheeseburger" },
    { name: "Add Extra Bacon" },
    { name: "French Fries" },
    { name: "[Test Placeholder]" },  // System item
    { name: "Caesar Salad" }
  ];
  const result = filterJunkItems(items);
  assertEqual(result.stats.kept, 3, "Should keep 3 valid items");
  assertEqual(result.stats.removed, 2, "Should remove 2 junk items");
});

console.log("\nCuisine Contamination:");
test("detects Mexican cuisine correctly", () => {
  const items = [
    { name: "Chicken Burrito" },
    { name: "Carnitas Tacos" },
    { name: "Guacamole" }
  ];
  const result = detectCuisineContamination(items, "mexican");
  assertTrue(!result.hasContamination, "Mexican items in Mexican restaurant = OK");
});

test("detects incompatible cuisine items", () => {
  const items = [
    { name: "Chicken Burrito" },
    { name: "Sushi Roll" },  // Incompatible!
    { name: "Ramen" }        // Incompatible!
  ];
  const result = detectCuisineContamination(items, "mexican");
  assertTrue(result.hasContamination, "Japanese items in Mexican restaurant = contamination");
  assertTrue(result.evidence.length >= 1, "Should have evidence");
});

console.log("\nRestaurant Mismatch:");
test("detects restaurant name mismatch", () => {
  const items = [
    { name: "Big Mac", restaurantTitle: "McDonald's" },
    { name: "Whopper", restaurantTitle: "Burger King" },  // Wrong restaurant!
    { name: "McChicken", restaurantTitle: "McDonald's" }
  ];
  const result = detectRestaurantMismatch(items, "McDonald's");
  assertTrue(result.suspiciousNames.length > 0, "Should detect Burger King mismatch");
});

test("accepts matching restaurant names", () => {
  const items = [
    { name: "Big Mac", restaurantTitle: "McDonald's" },
    { name: "McChicken", restaurantTitle: "McDonald's" }
  ];
  const result = detectRestaurantMismatch(items, "McDonald's");
  assertTrue(!result.hasMismatch, "All items from same restaurant = OK");
});

console.log("\nMenu Anomalies:");
test("detects empty menu", () => {
  // Empty menu has sections but no items
  const result = detectMenuAnomalies({ sections: [{ name: "Menu", items: [] }] });
  assertTrue(result.alerts.some(a => a.type === "EMPTY_SECTIONS" || a.type === "LOW_ITEM_COUNT"),
    "Empty menu should have alerts");
});

test("detects high item count anomaly", () => {
  const bigMenu = {
    sections: [{
      name: "Items",
      items: Array(400).fill({ name: "Item" })
    }]
  };
  const result = detectMenuAnomalies(bigMenu);
  assertTrue(result.alerts.some(a => a.type === "HIGH_ITEM_COUNT"),
    "Should detect high item count");
});

test("accepts normal menu with sufficient items", () => {
  // Normal menu with enough items (5+ items)
  const normalMenu = {
    sections: [
      {
        name: "Appetizers",
        items: [
          { name: "Spring Roll" },
          { name: "Egg Drop Soup" },
          { name: "Dumplings" }
        ]
      },
      {
        name: "Entrees",
        items: [
          { name: "Pad Thai" },
          { name: "Fried Rice" },
          { name: "Lo Mein" }
        ]
      }
    ]
  };
  const result = detectMenuAnomalies(normalMenu);
  // Should not have critical alerts that make hasSuspicious true
  const criticalAlerts = result.alerts.filter(a => a.severity === "error");
  assertTrue(criticalAlerts.length === 0, "Normal menu should not have critical alerts");
});

console.log("\nCategory Normalization:");
test("maps section names to canonical categories", () => {
  assertEqual(mapToCanonicalCategory("appetizers"), "Appetizers");
  assertEqual(mapToCanonicalCategory("ENTREES"), "Entrees");
  assertEqual(mapToCanonicalCategory("soft drinks"), "Beverages");
});

test("sorts sections by canonical order", () => {
  const sections = [
    { name: "Desserts" },
    { name: "Appetizers" },
    { name: "Entrees" }
  ];
  const sorted = sortSectionsByCanonicalOrder(sections);
  assertEqual(sorted[0].name, "Appetizers");
  assertEqual(sorted[1].name, "Entrees");
  assertEqual(sorted[2].name, "Desserts");
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log(`\n${"=".repeat(40)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
