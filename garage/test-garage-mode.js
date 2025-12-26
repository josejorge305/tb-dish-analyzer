#!/usr/bin/env node
/**
 * Unit tests for Garage Mode components
 * Run without Apify to verify validation and diff logic
 *
 * Usage: node garage/test-garage-mode.js
 */

import {
  createIdentityBundle,
  computeSignatureHash,
  buildScopedCacheKey,
  normalizeApifyToCanonical,
  validateMenuStrict,
  diffAgainstTruth
} from "./garage-mode.js";

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

function assertEqual(actual, expected, msg = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = "") {
  if (!condition) {
    throw new Error(msg || "Assertion failed");
  }
}

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_APIFY_PAYLOAD = {
  data: {
    results: [{
      title: "Test Restaurant",
      uuid: "test-uuid-123",
      url: "https://www.ubereats.com/store/test-restaurant/test-uuid-123",
      address: "123 Test St",
      menu: [
        {
          catalogName: "Appetizers",
          uuid: "section-1",
          catalogItems: [
            {
              uuid: "item-1",
              title: "Spring Rolls",
              itemDescription: "Crispy vegetable rolls",
              price: 899,
              imageUrl: "https://example.com/spring-rolls.jpg",
              customizations: [
                {
                  uuid: "mod-1",
                  title: "Sauce",
                  required: true,
                  minPermitted: 1,
                  maxPermitted: 1,
                  options: [
                    { uuid: "opt-1", title: "Sweet Chili", price: 0 },
                    { uuid: "opt-2", title: "Peanut", price: 50 }
                  ]
                }
              ]
            },
            {
              uuid: "item-2",
              title: "Edamame",
              itemDescription: "Steamed soybeans",
              price: 599
            }
          ]
        },
        {
          catalogName: "Entrees",
          uuid: "section-2",
          catalogItems: [
            {
              uuid: "item-3",
              title: "Pad Thai",
              itemDescription: "Classic Thai noodles",
              price: 1499,
              nutrition: { calories: 650 }
            }
          ]
        }
      ]
    }]
  }
};

// ============================================================================
// TESTS
// ============================================================================

console.log("\n=== GARAGE MODE UNIT TESTS ===\n");

console.log("Identity Bundle:");
test("creates valid identity bundle", () => {
  const bundle = createIdentityBundle("my-restaurant", "abc-123");
  assertTrue(bundle.restaurant_id === "my-restaurant");
  assertTrue(bundle.provider === "ubereats_apify");
  assertTrue(bundle.uber_store_id === "abc-123");
  assertTrue(bundle.menu_fetch_session_id.startsWith("garage_"));
  assertTrue(bundle.signature_hash != null);
});

test("extracts store ID from URL", () => {
  const bundle = createIdentityBundle("chipotle", "https://www.ubereats.com/store/chipotle-mexican-grill/sHvkP4eQSoatfK0HNqNPew");
  assertTrue(bundle.uber_store_id === "sHvkP4eQSoatfK0HNqNPew");
  assertTrue(bundle.uber_store_url === "https://www.ubereats.com/store/chipotle-mexican-grill/sHvkP4eQSoatfK0HNqNPew");
});

test("builds scoped cache key", () => {
  const bundle = createIdentityBundle("test", "store-123");
  const key = buildScopedCacheKey("menu", bundle);
  assertTrue(key.includes("ubereats_apify"));
  assertTrue(key.includes("store-123"));
  assertTrue(key.includes(bundle.menu_fetch_session_id));
});

console.log("\nNormalization:");
test("normalizes Apify payload to canonical schema", () => {
  const bundle = createIdentityBundle("test-restaurant", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);

  assertTrue(result.ok === true);
  assertTrue(result.menu.restaurant.name === "Test Restaurant");
  assertTrue(result.menu.sections.length === 2);
  assertTrue(result.menu.sections[0].name === "Appetizers");
  assertTrue(result.menu.sections[0].items.length === 2);
  assertTrue(result.menu.sections[0].items[0].name === "Spring Rolls");
  assertTrue(result.menu.sections[0].items[0].price_cents === 899);
});

test("preserves section ordering", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);

  assertEqual(result.menu.sections[0].position, 0);
  assertEqual(result.menu.sections[1].position, 1);
  assertEqual(result.menu.sections[0].name, "Appetizers");
  assertEqual(result.menu.sections[1].name, "Entrees");
});

test("preserves item ordering within sections", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);

  const items = result.menu.sections[0].items;
  assertEqual(items[0].position, 0);
  assertEqual(items[1].position, 1);
  assertEqual(items[0].name, "Spring Rolls");
  assertEqual(items[1].name, "Edamame");
});

test("normalizes modifier groups", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);

  const springRolls = result.menu.sections[0].items[0];
  assertTrue(springRolls.modifier_groups.length === 1);
  assertTrue(springRolls.modifier_groups[0].name === "Sauce");
  assertTrue(springRolls.modifier_groups[0].required === true);
  assertTrue(springRolls.modifier_groups[0].options.length === 2);
});

test("normalizes modifier options with prices", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);

  const sauceMod = result.menu.sections[0].items[0].modifier_groups[0];
  assertEqual(sauceMod.options[0].name, "Sweet Chili");
  assertEqual(sauceMod.options[0].price_cents, 0);
  assertEqual(sauceMod.options[1].name, "Peanut");
  assertEqual(sauceMod.options[1].price_cents, 50);
});

test("extracts calories from nutrition object", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);

  const padThai = result.menu.sections[1].items[0];
  assertEqual(padThai.calories, 650);
});

test("computes metadata correctly", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);

  assertEqual(result.menu.metadata.total_sections, 2);
  assertEqual(result.menu.metadata.total_items, 3);
  assertEqual(result.menu.metadata.total_modifier_groups, 1);
  assertEqual(result.menu.metadata.total_options, 2);
});

console.log("\nValidation:");
test("validates valid menu", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);
  const validation = validateMenuStrict(result.menu);

  assertTrue(validation.valid === true);
  assertEqual(validation.errorCount, 0);
});

test("catches missing identity", () => {
  const menu = { restaurant: { name: "Test" }, sections: [], metadata: { fetched_at: Date.now() } };
  const validation = validateMenuStrict(menu);

  assertTrue(validation.valid === false);
  assertTrue(validation.errors.some(e => e.code === "MISSING_IDENTITY"));
});

test("catches duplicate section names", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const menu = {
    identity: bundle,
    restaurant: { name: "Test" },
    sections: [
      { id: "s1", name: "Appetizers", position: 0, items: [] },
      { id: "s2", name: "Appetizers", position: 1, items: [] }
    ],
    metadata: { fetched_at: Date.now() }
  };
  const validation = validateMenuStrict(menu);

  assertTrue(validation.valid === false);
  assertTrue(validation.errors.some(e => e.code === "DUPLICATE_SECTION_NAME"));
});

test("catches position mismatches", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const menu = {
    identity: bundle,
    restaurant: { name: "Test" },
    sections: [
      { id: "s1", name: "Section", position: 5, items: [] } // wrong position
    ],
    metadata: { fetched_at: Date.now() }
  };
  const validation = validateMenuStrict(menu);

  assertTrue(validation.valid === false);
  assertTrue(validation.errors.some(e => e.code === "SECTION_POSITION_MISMATCH"));
});

test("catches duplicate item fingerprints", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const menu = {
    identity: bundle,
    restaurant: { name: "Test" },
    sections: [
      {
        id: "s1",
        name: "Section",
        position: 0,
        items: [
          { id: "i1", name: "Burger", position: 0, price_cents: 999, modifier_groups: [] },
          { id: "i2", name: "Burger", position: 1, price_cents: 999, modifier_groups: [] }
        ]
      }
    ],
    metadata: { fetched_at: Date.now() }
  };
  const validation = validateMenuStrict(menu);

  assertTrue(validation.valid === false);
  assertTrue(validation.errors.some(e => e.code === "DUPLICATE_ITEM_FINGERPRINT"));
});

console.log("\nDiff Engine:");
test("reports match for identical menus", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);
  const diffResult = diffAgainstTruth(result.menu, MOCK_APIFY_PAYLOAD);

  assertTrue(diffResult.match === true);
  assertEqual(diffResult.errorCount, 0);
});

test("detects missing section", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);

  // Remove a section
  result.menu.sections = result.menu.sections.slice(0, 1);

  const diffResult = diffAgainstTruth(result.menu, MOCK_APIFY_PAYLOAD);

  assertTrue(diffResult.match === false);
  assertTrue(diffResult.diffs.some(d => d.type === "MISSING_SECTION" && d.section === "Entrees"));
});

test("detects missing item", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);

  // Remove an item
  result.menu.sections[0].items = result.menu.sections[0].items.slice(0, 1);

  const diffResult = diffAgainstTruth(result.menu, MOCK_APIFY_PAYLOAD);

  assertTrue(diffResult.match === false);
  assertTrue(diffResult.diffs.some(d => d.type === "MISSING_ITEM" && d.item === "Edamame"));
});

test("detects extra section", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);

  // Add extra section
  result.menu.sections.push({
    id: "extra",
    name: "Extra Section",
    position: 2,
    items: []
  });

  const diffResult = diffAgainstTruth(result.menu, MOCK_APIFY_PAYLOAD);

  assertTrue(diffResult.match === false);
  assertTrue(diffResult.diffs.some(d => d.type === "EXTRA_SECTION" && d.section === "Extra Section"));
});

test("detects price mismatch", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);

  // Change price
  result.menu.sections[0].items[0].price_cents = 1099;

  const diffResult = diffAgainstTruth(result.menu, MOCK_APIFY_PAYLOAD);

  assertTrue(diffResult.match === false);
  assertTrue(diffResult.diffs.some(d =>
    d.type === "PRICE_MISMATCH" &&
    d.item === "Spring Rolls" &&
    d.expected === 899 &&
    d.actual === 1099
  ));
});

test("detects missing modifier group", () => {
  const bundle = createIdentityBundle("test", "test-uuid-123");
  const result = normalizeApifyToCanonical(MOCK_APIFY_PAYLOAD, bundle);

  // Remove modifier group
  result.menu.sections[0].items[0].modifier_groups = [];

  const diffResult = diffAgainstTruth(result.menu, MOCK_APIFY_PAYLOAD);

  assertTrue(diffResult.match === false);
  assertTrue(diffResult.diffs.some(d =>
    d.type === "MODIFIER_GROUP_COUNT_MISMATCH" ||
    d.type === "MISSING_MODIFIER_GROUP"
  ));
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log(`\n${"=".repeat(40)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
