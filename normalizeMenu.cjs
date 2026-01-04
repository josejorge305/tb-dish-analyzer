const fs = require("fs");

/**
 * Post-Scrape Menu Normalization & Validation
 *
 * Transforms uber_menu_extracted.json into normalized_menu.json
 * with canonical categories, standardized fields, and validation.
 */

// Canonical category mappings
const CATEGORY_MAPPINGS = {
  // Appetizers
  appetizers: ["appetizer", "starter", "small plate", "snack", "shareables", "apps"],
  // Mains / Entrees
  mains: ["main", "entree", "entrée", "burger", "sandwich", "wrap", "taco", "bowl", "plate", "chicken", "beef", "seafood", "pasta", "pizza", "grill", "signature"],
  // Sides
  sides: ["side", "fries", "onion ring", "salad", "soup", "bread"],
  // Desserts
  desserts: ["dessert", "sweet", "cake", "cookie", "ice cream", "shake", "milkshake", "sundae", "pie", "brownie", "churro"],
  // Drinks
  drinks: ["drink", "beverage", "coffee", "tea", "soda", "juice", "water", "lemonade", "smoothie", "frozen"],
  // Combos / Meals
  combos: ["combo", "meal", "bundle", "value", "box", "family", "group", "pack"],
  // Kids
  kids: ["kid", "child", "junior", "little"],
  // Catering / Large Orders
  catering: ["catering", "large order", "party", "tray", "serving"]
};

// Non-food items to filter out
const NON_FOOD_PATTERNS = [
  /^utensil/i,
  /^napkin/i,
  /^straw/i,
  /^cutlery/i,
  /^bag$/i,
  /^packaging/i,
  /^fee$/i,
  /^delivery/i,
  /^tip$/i,
  /^promo/i,
  /^coupon/i,
  /^discount/i,
  /^gift\s*card/i,
  /^merch/i,
  /^t-shirt/i,
  /^hat$/i,
  /^cup$/i,
  /^bottle$/i,
  /^grater$/i,
  /^cutter$/i
];

// Item name patterns that suggest specific categories
const NAME_CATEGORY_HINTS = {
  desserts: [/shake$/i, /milkshake/i, /cookie/i, /brownie/i, /sundae/i, /ice\s*cream/i, /cake/i, /pie$/i],
  sides: [/^fries$/i, /^cheese\s*fries/i, /^onion\s*ring/i, /^side\s/i, /^salad$/i],
  drinks: [/^(small|medium|large|xl)\s+(coke|pepsi|sprite|fanta|dr\.?\s*pepper)/i, /^lemonade$/i, /^coffee$/i, /^tea$/i, /^water$/i, /^juice$/i],
  combos: [/\bmeal$/i, /\bcombo$/i, /\bbox\b/i, /\bbundle\b/i, /\d+\s*pc\.?\s*meal/i],
  kids: [/^kid/i, /^child/i, /^jr\.?\s/i, /happy\s*meal/i]
};

/**
 * Normalize item name
 * - Trim whitespace
 * - Normalize casing (Title Case)
 * - Remove emojis and special characters (except ® ™)
 * - Collapse multiple spaces
 */
function normalizeName(name) {
  if (!name) return null;

  let normalized = name
    .trim()
    // Remove emojis
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();

  // Title case (but preserve ® ™)
  normalized = normalized
    .split(' ')
    .map(word => {
      if (word.match(/^[®™©]+$/)) return word;
      if (word.length <= 2 && word.toUpperCase() === word) return word; // Keep acronyms
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');

  return normalized || null;
}

/**
 * Convert price to cents
 */
function priceToCents(price) {
  if (price === null || price === undefined) return null;
  if (typeof price === 'number') {
    return Math.round(price * 100);
  }
  if (typeof price === 'string') {
    const match = price.match(/\$?(\d+\.?\d*)/);
    if (match) {
      return Math.round(parseFloat(match[1]) * 100);
    }
  }
  return null;
}

/**
 * Parse calories string into structured format
 */
function parseCalories(caloriesStr) {
  if (!caloriesStr) return { raw: null, min: null, max: null };

  const str = String(caloriesStr).trim();

  // Range format: "530-790" or "530 - 790"
  const rangeMatch = str.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    return {
      raw: str,
      min: parseInt(rangeMatch[1]),
      max: parseInt(rangeMatch[2])
    };
  }

  // Single value
  const singleMatch = str.match(/^(\d+)$/);
  if (singleMatch) {
    const val = parseInt(singleMatch[1]);
    return {
      raw: str,
      min: val,
      max: val
    };
  }

  return { raw: str, min: null, max: null };
}

/**
 * Check if item is a non-food item
 */
function isNonFoodItem(name) {
  if (!name) return false;
  const n = name.toLowerCase().trim();
  return NON_FOOD_PATTERNS.some(p => p.test(n));
}

/**
 * Determine canonical category for an item
 */
function determineCategory(item) {
  const sectionName = (item.section_name || '').toLowerCase();
  const itemName = (item.name || '').toLowerCase();

  // First, check item name for strong hints
  for (const [category, patterns] of Object.entries(NAME_CATEGORY_HINTS)) {
    for (const pattern of patterns) {
      if (pattern.test(itemName)) {
        return category;
      }
    }
  }

  // Then, check section name mapping
  for (const [category, keywords] of Object.entries(CATEGORY_MAPPINGS)) {
    for (const keyword of keywords) {
      if (sectionName.includes(keyword)) {
        return category;
      }
    }
  }

  // Check item name against category keywords
  for (const [category, keywords] of Object.entries(CATEGORY_MAPPINGS)) {
    for (const keyword of keywords) {
      if (itemName.includes(keyword)) {
        return category;
      }
    }
  }

  // Default to mains if we can't determine
  return 'mains';
}

/**
 * Calculate confidence score based on field completeness
 */
function calculateConfidence(item) {
  let score = 0;
  let maxScore = 0;

  // Name (required, weight: 3)
  maxScore += 3;
  if (item.name && item.name.length > 1) score += 3;

  // Price (important, weight: 2)
  maxScore += 2;
  if (item.price_cents && item.price_cents > 0) score += 2;

  // Image (important, weight: 2)
  maxScore += 2;
  if (item.image_url && item.image_url.startsWith('http')) score += 2;

  // Calories (nice to have, weight: 1)
  maxScore += 1;
  if (item.calories && item.calories.raw) score += 1;

  // Source ID (important for tracking, weight: 2)
  maxScore += 2;
  if (item.source_id && item.source_id.length > 10) score += 2;

  return Math.round((score / maxScore) * 100) / 100;
}

/**
 * Main normalization function
 */
function normalizeMenu(inputPath, outputPath) {
  console.log("🔄 Starting menu normalization...\n");

  // Read input
  let rawData;
  try {
    const content = fs.readFileSync(inputPath, 'utf-8');
    rawData = JSON.parse(content);
  } catch (e) {
    console.error(`❌ Failed to read ${inputPath}: ${e.message}`);
    process.exit(1);
  }

  const warnings = [];
  const normalizedItems = [];
  let filteredCount = 0;

  // Process each section and item
  const allItems = rawData.sections?.flatMap(s => s.items) || [];

  console.log(`📊 Input: ${allItems.length} items from ${rawData.sections?.length || 0} sections\n`);

  for (const item of allItems) {
    // Skip non-food items
    if (isNonFoodItem(item.name)) {
      filteredCount++;
      warnings.push({
        type: 'filtered_non_food',
        item_id: item.item_id,
        name: item.name,
        reason: 'Matched non-food pattern'
      });
      continue;
    }

    // Normalize fields
    const normalizedName = normalizeName(item.name);
    if (!normalizedName) {
      filteredCount++;
      warnings.push({
        type: 'filtered_invalid_name',
        item_id: item.item_id,
        name: item.name,
        reason: 'Name became empty after normalization'
      });
      continue;
    }

    const priceCents = priceToCents(item.price);
    const calories = parseCalories(item.calories);
    const category = determineCategory(item);

    // Build normalized item
    const normalizedItem = {
      canonical_category: category,
      source: 'ubereats',
      source_id: item.item_id || null,
      name: normalizedName,
      price_cents: priceCents,
      calories: calories,
      image_url: item.image_url || null,
      confidence_score: 0 // Will be calculated after
    };

    // Calculate confidence
    normalizedItem.confidence_score = calculateConfidence(normalizedItem);

    // Add warnings for incomplete items
    if (!priceCents) {
      warnings.push({
        type: 'missing_price',
        item_id: item.item_id,
        name: normalizedName
      });
    }
    if (!item.image_url) {
      warnings.push({
        type: 'missing_image',
        item_id: item.item_id,
        name: normalizedName
      });
    }

    normalizedItems.push(normalizedItem);
  }

  // Build output
  const output = {
    restaurant: {
      name: rawData.restaurant?.name || null,
      source_url: rawData.restaurant?.url || null,
      source: 'ubereats'
    },
    items: normalizedItems,
    normalization_warnings: warnings,
    meta: {
      input_items: allItems.length,
      output_items: normalizedItems.length,
      filtered_items: filteredCount,
      normalized_at: new Date().toISOString(),
      source_file: inputPath
    }
  };

  // Write output
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  // Print summary
  console.log("═══════════════════════════════════════");
  console.log("NORMALIZATION COMPLETE");
  console.log("═══════════════════════════════════════\n");

  console.log(`📊 Restaurant: ${output.restaurant.name || 'Unknown'}`);
  console.log(`📊 Input items: ${allItems.length}`);
  console.log(`📊 Output items: ${normalizedItems.length}`);
  console.log(`📊 Filtered: ${filteredCount}`);
  console.log(`📊 Warnings: ${warnings.length}\n`);

  // Category breakdown
  const categoryBreakdown = {};
  for (const item of normalizedItems) {
    categoryBreakdown[item.canonical_category] = (categoryBreakdown[item.canonical_category] || 0) + 1;
  }

  console.log("📋 Category Breakdown:");
  for (const [cat, count] of Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${cat}: ${count}`);
  }

  // Confidence stats
  const avgConfidence = normalizedItems.length > 0
    ? (normalizedItems.reduce((sum, i) => sum + i.confidence_score, 0) / normalizedItems.length).toFixed(2)
    : 0;
  console.log(`\n📊 Average confidence: ${avgConfidence}`);

  // Sample items
  console.log("\n📋 Sample Normalized Items:");
  normalizedItems.slice(0, 5).forEach((item, i) => {
    console.log(`   ${i + 1}. [${item.canonical_category}] ${item.name} - ${item.price_cents ? `$${(item.price_cents/100).toFixed(2)}` : 'N/A'} (conf: ${item.confidence_score})`);
  });

  console.log(`\n💾 Output saved to ${outputPath}`);

  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} warnings generated (see normalization_warnings in output)`);
  }

  return output;
}

// Run if called directly
if (require.main === module) {
  const inputPath = process.argv[2] || 'uber_menu_extracted.json';
  const outputPath = process.argv[3] || 'normalized_menu.json';

  normalizeMenu(inputPath, outputPath);
  console.log("\n✅ Normalization complete\n");
}

module.exports = { normalizeMenu, normalizeName, priceToCents, parseCalories, determineCategory };
