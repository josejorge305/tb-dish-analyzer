#!/usr/bin/env node
/**
 * USDA FoodData Central Staging Script
 *
 * Processes USDA CSV files and outputs D1-compatible SQL for seeding.
 *
 * USAGE:
 *   node seed_data/scripts/stage_usda.js
 *
 * INPUT:  seed_data/raw/usda/*.csv
 * OUTPUT: seed_data/out/usda_ingredients.sql
 *         seed_data/out/usda_nutrients.sql
 *         seed_data/out/usda_sources.sql
 *
 * STRATEGY:
 * 1. Focus on SR Legacy + Foundation foods (highest quality, ~2500 items)
 * 2. Skip branded foods for v1 (too large, lower quality)
 * 3. Output batched INSERT statements (D1-friendly)
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const RAW_DIR = path.join(__dirname, '..', 'raw', 'usda');
const OUT_DIR = path.join(__dirname, '..', 'out');

// Ensure output dir exists
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Key nutrient IDs we care about (USDA nutrient numbers)
const KEY_NUTRIENTS = {
  1008: 'energy_kcal',
  1003: 'protein_g',
  1004: 'fat_g',
  1005: 'carbs_g',
  2000: 'sugar_g',
  1079: 'fiber_g',
  1093: 'sodium_mg',
  1087: 'calcium_mg',
  1089: 'iron_mg',
  1092: 'potassium_mg',
  1162: 'vitamin_c_mg',
  1106: 'vitamin_a_iu',
  1114: 'vitamin_d_iu',
};

// Category mapping (USDA category -> our categories)
const CATEGORY_MAP = {
  'Dairy and Egg Products': 'dairy',
  'Spices and Herbs': 'spice',
  'Fats and Oils': 'fat',
  'Poultry Products': 'protein',
  'Soups, Sauces, and Gravies': 'sauce',
  'Sausages and Luncheon Meats': 'protein',
  'Breakfast Cereals': 'grain',
  'Fruits and Fruit Juices': 'fruit',
  'Pork Products': 'protein',
  'Vegetables and Vegetable Products': 'vegetable',
  'Nut and Seed Products': 'nut',
  'Beef Products': 'protein',
  'Beverages': 'beverage',
  'Finfish and Shellfish Products': 'protein',
  'Legumes and Legume Products': 'legume',
  'Lamb, Veal, and Game Products': 'protein',
  'Baked Products': 'grain',
  'Sweets': 'sweet',
  'Cereal Grains and Pasta': 'grain',
  'Fast Foods': 'prepared',
  'Meals, Entrees, and Side Dishes': 'prepared',
  'Snacks': 'snack',
  'Restaurant Foods': 'prepared',
};

/**
 * Parse CSV line handling quoted fields
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Read CSV file and return rows as objects
 */
async function readCSV(filename, limit = null) {
  const filepath = path.join(RAW_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.log(`  ⚠️  File not found: ${filename}`);
    return [];
  }

  const rows = [];
  const fileStream = fs.createReadStream(filepath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers = null;
  let count = 0;

  for await (const line of rl) {
    if (!headers) {
      headers = parseCSVLine(line);
      continue;
    }

    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = values[i] || '');
    rows.push(row);
    count++;

    if (limit && count >= limit) break;
  }

  return rows;
}

/**
 * Escape string for SQL
 */
function sqlEscape(str) {
  if (str == null) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

/**
 * Clean ingredient name for canonical form
 */
function canonicalizeName(name) {
  return name
    .toLowerCase()
    .replace(/,.*$/, '') // Remove everything after comma
    .replace(/\s*\([^)]*\)/g, '') // Remove parentheticals
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Main staging function
 */
async function main() {
  console.log('=== USDA FoodData Central Staging ===\n');

  // Step 1: Load food categories
  console.log('1. Loading food categories...');
  const categories = await readCSV('food_category.csv');
  const categoryMap = {};
  categories.forEach(c => {
    categoryMap[c.id] = c.description;
  });
  console.log(`   Loaded ${Object.keys(categoryMap).length} categories`);

  // Step 2: Load nutrient definitions
  console.log('2. Loading nutrient definitions...');
  const nutrients = await readCSV('nutrient.csv');
  const nutrientMap = {};
  nutrients.forEach(n => {
    nutrientMap[n.id] = { name: n.name, unit: n.unit_name };
  });
  console.log(`   Loaded ${Object.keys(nutrientMap).length} nutrients`);

  // Step 3: Load SR Legacy foods (highest quality)
  console.log('3. Loading SR Legacy foods...');
  const srLegacy = await readCSV('sr_legacy_food.csv');
  const srFdcIds = new Set(srLegacy.map(f => f.fdc_id));
  console.log(`   Found ${srFdcIds.size} SR Legacy food IDs`);

  // Step 4: Load Foundation foods
  console.log('4. Loading Foundation foods...');
  const foundation = await readCSV('foundation_food.csv');
  const foundationFdcIds = new Set(foundation.map(f => f.fdc_id));
  console.log(`   Found ${foundationFdcIds.size} Foundation food IDs`);

  // Combine high-quality food IDs
  const qualityFdcIds = new Set([...srFdcIds, ...foundationFdcIds]);
  console.log(`   Total high-quality foods: ${qualityFdcIds.size}`);

  // Step 5: Load main food table and filter
  console.log('5. Loading and filtering main food table...');
  const allFoods = await readCSV('food.csv');
  const foods = allFoods.filter(f => qualityFdcIds.has(f.fdc_id));
  console.log(`   Filtered to ${foods.length} high-quality foods`);

  // Step 6: Load food nutrients (this is the big one - stream it)
  console.log('6. Loading food nutrients (streaming)...');
  const foodNutrients = {};

  const nutrientFilepath = path.join(RAW_DIR, 'food_nutrient.csv');
  const nutrientStream = fs.createReadStream(nutrientFilepath);
  const nutrientRL = readline.createInterface({ input: nutrientStream, crlfDelay: Infinity });

  let nutrientHeaders = null;
  let nutrientCount = 0;
  let relevantCount = 0;

  for await (const line of nutrientRL) {
    if (!nutrientHeaders) {
      nutrientHeaders = parseCSVLine(line);
      continue;
    }

    nutrientCount++;
    if (nutrientCount % 1000000 === 0) {
      process.stdout.write(`   Processed ${(nutrientCount / 1000000).toFixed(1)}M rows...\r`);
    }

    const values = parseCSVLine(line);
    const row = {};
    nutrientHeaders.forEach((h, i) => row[h] = values[i] || '');

    // Only keep nutrients for our high-quality foods
    if (!qualityFdcIds.has(row.fdc_id)) continue;

    // Only keep key nutrients
    const nutrientId = parseInt(row.nutrient_id);
    if (!KEY_NUTRIENTS[nutrientId]) continue;

    if (!foodNutrients[row.fdc_id]) {
      foodNutrients[row.fdc_id] = {};
    }
    foodNutrients[row.fdc_id][nutrientId] = parseFloat(row.amount) || 0;
    relevantCount++;
  }

  console.log(`\n   Processed ${nutrientCount} total nutrient rows`);
  console.log(`   Kept ${relevantCount} relevant nutrient values`);

  // Step 7: Generate SQL files
  console.log('7. Generating SQL files...');

  // Ingredients SQL
  const ingredientsSql = fs.createWriteStream(path.join(OUT_DIR, 'usda_ingredients.sql'));
  ingredientsSql.write('-- USDA FoodData Central: Ingredients (SR Legacy + Foundation)\n');
  ingredientsSql.write('-- Generated: ' + new Date().toISOString() + '\n\n');

  // Sources SQL
  const sourcesSql = fs.createWriteStream(path.join(OUT_DIR, 'usda_sources.sql'));
  sourcesSql.write('-- USDA FoodData Central: Ingredient Sources\n');
  sourcesSql.write('-- Generated: ' + new Date().toISOString() + '\n\n');

  // Nutrients SQL
  const nutrientsSql = fs.createWriteStream(path.join(OUT_DIR, 'usda_nutrients.sql'));
  nutrientsSql.write('-- USDA FoodData Central: Ingredient Nutrients\n');
  nutrientsSql.write('-- Generated: ' + new Date().toISOString() + '\n\n');

  // Synonyms SQL
  const synonymsSql = fs.createWriteStream(path.join(OUT_DIR, 'usda_synonyms.sql'));
  synonymsSql.write('-- USDA FoodData Central: Ingredient Synonyms\n');
  synonymsSql.write('-- Generated: ' + new Date().toISOString() + '\n\n');

  let ingredientCount = 0;
  let nutrientInsertCount = 0;

  for (const food of foods) {
    const fdcId = food.fdc_id;
    const description = food.description || '';
    const canonicalName = canonicalizeName(description);
    const usdaCategory = categoryMap[food.food_category_id] || '';
    const category = CATEGORY_MAP[usdaCategory] || null;

    if (!canonicalName) continue;

    // INSERT ingredient
    ingredientsSql.write(`INSERT OR IGNORE INTO ingredients (canonical_name, category, data_version, model_version) VALUES (${sqlEscape(canonicalName)}, ${category ? sqlEscape(category) : 'NULL'}, 1, 'usda_fdc');\n`);

    // INSERT synonym (full USDA description)
    if (description.toLowerCase() !== canonicalName) {
      synonymsSql.write(`INSERT OR IGNORE INTO ingredient_synonyms (ingredient_id, synonym, locale) SELECT id, ${sqlEscape(description.toLowerCase())}, 'en' FROM ingredients WHERE canonical_name = ${sqlEscape(canonicalName)};\n`);
    }

    // INSERT source
    sourcesSql.write(`INSERT OR IGNORE INTO ingredient_sources (ingredient_id, source, source_id, source_name, is_primary, contributed_fields) SELECT id, 'usda_fdc', ${sqlEscape(fdcId)}, ${sqlEscape(description)}, 1, '["nutrients","category"]' FROM ingredients WHERE canonical_name = ${sqlEscape(canonicalName)};\n`);

    // INSERT nutrients
    const foodNuts = foodNutrients[fdcId] || {};
    for (const [nutId, amount] of Object.entries(foodNuts)) {
      const nutrientInfo = nutrientMap[nutId] || { name: 'Unknown', unit: '' };
      nutrientsSql.write(`INSERT OR IGNORE INTO ingredient_nutrients (ingredient_id, nutrient_id, nutrient_name, amount, unit, source, source_id) SELECT id, ${nutId}, ${sqlEscape(nutrientInfo.name)}, ${amount}, ${sqlEscape(nutrientInfo.unit)}, 'usda_fdc', ${sqlEscape(fdcId)} FROM ingredients WHERE canonical_name = ${sqlEscape(canonicalName)};\n`);
      nutrientInsertCount++;
    }

    ingredientCount++;
  }

  ingredientsSql.end();
  sourcesSql.end();
  nutrientsSql.end();
  synonymsSql.end();

  console.log(`\n=== Staging Complete ===`);
  console.log(`Ingredients: ${ingredientCount}`);
  console.log(`Nutrient rows: ${nutrientInsertCount}`);
  console.log(`\nOutput files in: ${OUT_DIR}/`);
  console.log('  - usda_ingredients.sql');
  console.log('  - usda_synonyms.sql');
  console.log('  - usda_sources.sql');
  console.log('  - usda_nutrients.sql');
  console.log('\nNext: Apply migration 0007, then run these SQL files against D1');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
