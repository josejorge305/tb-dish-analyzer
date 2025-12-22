#!/usr/bin/env node
/**
 * Open Food Facts Complete Staging Script
 *
 * Downloads and processes Open Food Facts data to extract:
 * 1. Allergen → Ingredient mappings
 * 2. Ingredient synonyms from ingredient lists
 * 3. NOVA processing scores (1-4)
 * 4. Nutri-Score grades (a-e)
 * 5. Additives/E-numbers
 * 6. Extended micronutrients (vitamins, minerals)
 *
 * USAGE:
 *   node seed_data/scripts/stage_openfoodfacts.js [--full]
 *
 * OPTIONS:
 *   --full    Download full CSV (0.9GB) instead of delta files
 *
 * INPUT:  Downloads from Open Food Facts or uses cached files
 * OUTPUT: seed_data/out/off_allergen_flags.sql
 *         seed_data/out/off_synonyms.sql
 *         seed_data/out/off_quality_scores.sql
 *         seed_data/out/off_additives.sql
 *         seed_data/out/off_micronutrients.sql
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import https from 'https';
import http from 'http';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.join(__dirname, '..', 'raw', 'openfoodfacts');
const OUT_DIR = path.join(__dirname, '..', 'out');

// Ensure directories exist
[RAW_DIR, OUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// FDA Big 9 Allergens mapped to allergen_definitions.allergen_code
const ALLERGEN_MAP = {
  'en:milk': 'dairy',
  'en:eggs': 'eggs',
  'en:fish': 'fish',
  'en:crustaceans': 'shellfish',
  'en:shellfish': 'shellfish',
  'en:tree-nuts': 'tree_nuts',
  'en:peanuts': 'peanut',
  'en:wheat': 'wheat',
  'en:gluten': 'gluten',
  'en:soybeans': 'soy',
  'en:sesame': 'sesame',
  'en:sesame-seeds': 'sesame',
  'en:nuts': 'tree_nuts',
  'en:almonds': 'tree_nuts',
  'en:hazelnuts': 'tree_nuts',
  'en:walnuts': 'tree_nuts',
  'en:cashews': 'tree_nuts',
  'en:pecans': 'tree_nuts',
  'en:brazil-nuts': 'tree_nuts',
  'en:pistachios': 'tree_nuts',
  'en:macadamia': 'tree_nuts',
};

// Ingredient patterns that indicate allergens
const INGREDIENT_ALLERGEN_PATTERNS = {
  dairy: [/\b(milk|cream|butter|cheese|yogurt|yoghurt|whey|casein|lactose|ghee|paneer|kefir|curd)\b/i],
  eggs: [/\b(egg|eggs|albumin|globulin|lysozyme|mayonnaise|meringue|ovalbumin|ovomucin|ovomucoid|ovovitellin)\b/i],
  fish: [/\b(fish|salmon|tuna|cod|anchov|sardine|tilapia|bass|trout|mackerel|herring|haddock|pollock|catfish)\b/i],
  shellfish: [/\b(shrimp|prawn|crab|lobster|crayfish|crawfish|langoustine|scampi|krill)\b/i],
  tree_nuts: [/\b(almond|cashew|walnut|pecan|pistachio|hazelnut|filbert|macadamia|brazil.?nut|chestnut|praline|marzipan|nougat)\b/i],
  peanut: [/\b(peanut|groundnut|arachis|goober)\b/i],
  wheat: [/\b(wheat|barley|rye|spelt|kamut|triticale|semolina|durum|farina|bulgur|couscous|seitan)\b/i],
  gluten: [/\b(gluten|oat)\b/i],
  soy: [/\b(soy|soya|soybean|edamame|tofu|tempeh|miso|tamari|shoyu)\b/i],
  sesame: [/\b(sesame|tahini|halvah|hummus)\b/i],
};

// Extended micronutrients to extract (OFF column name → our nutrient code)
const MICRONUTRIENT_MAP = {
  // Vitamins
  'vitamin-a_100g': { code: 'vitamin_a', name: 'Vitamin A', unit: 'µg' },
  'vitamin-d_100g': { code: 'vitamin_d', name: 'Vitamin D', unit: 'µg' },
  'vitamin-e_100g': { code: 'vitamin_e', name: 'Vitamin E', unit: 'mg' },
  'vitamin-k_100g': { code: 'vitamin_k', name: 'Vitamin K', unit: 'µg' },
  'vitamin-c_100g': { code: 'vitamin_c', name: 'Vitamin C', unit: 'mg' },
  'vitamin-b1_100g': { code: 'vitamin_b1', name: 'Thiamin (B1)', unit: 'mg' },
  'vitamin-b2_100g': { code: 'vitamin_b2', name: 'Riboflavin (B2)', unit: 'mg' },
  'vitamin-pp_100g': { code: 'vitamin_b3', name: 'Niacin (B3)', unit: 'mg' },
  'vitamin-b6_100g': { code: 'vitamin_b6', name: 'Vitamin B6', unit: 'mg' },
  'vitamin-b9_100g': { code: 'vitamin_b9', name: 'Folate (B9)', unit: 'µg' },
  'vitamin-b12_100g': { code: 'vitamin_b12', name: 'Vitamin B12', unit: 'µg' },
  'biotin_100g': { code: 'biotin', name: 'Biotin', unit: 'µg' },
  'pantothenic-acid_100g': { code: 'pantothenic_acid', name: 'Pantothenic Acid', unit: 'mg' },
  // Minerals
  'calcium_100g': { code: 'calcium', name: 'Calcium', unit: 'mg' },
  'phosphorus_100g': { code: 'phosphorus', name: 'Phosphorus', unit: 'mg' },
  'iron_100g': { code: 'iron', name: 'Iron', unit: 'mg' },
  'magnesium_100g': { code: 'magnesium', name: 'Magnesium', unit: 'mg' },
  'zinc_100g': { code: 'zinc', name: 'Zinc', unit: 'mg' },
  'copper_100g': { code: 'copper', name: 'Copper', unit: 'mg' },
  'manganese_100g': { code: 'manganese', name: 'Manganese', unit: 'mg' },
  'selenium_100g': { code: 'selenium', name: 'Selenium', unit: 'µg' },
  'potassium_100g': { code: 'potassium', name: 'Potassium', unit: 'mg' },
  'sodium_100g': { code: 'sodium', name: 'Sodium', unit: 'mg' },
  'chloride_100g': { code: 'chloride', name: 'Chloride', unit: 'mg' },
  'iodine_100g': { code: 'iodine', name: 'Iodine', unit: 'µg' },
  // Other
  'caffeine_100g': { code: 'caffeine', name: 'Caffeine', unit: 'mg' },
  'taurine_100g': { code: 'taurine', name: 'Taurine', unit: 'mg' },
  'omega-3-fat_100g': { code: 'omega_3', name: 'Omega-3 Fatty Acids', unit: 'g' },
  'omega-6-fat_100g': { code: 'omega_6', name: 'Omega-6 Fatty Acids', unit: 'g' },
  'cholesterol_100g': { code: 'cholesterol', name: 'Cholesterol', unit: 'mg' },
};

/**
 * Download a file with redirect support
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`  Downloading: ${url}`);

    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'], 10);
      let downloadedBytes = 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes) {
          const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          process.stdout.write(`  Progress: ${pct}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB)\r`);
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(`\n  Downloaded: ${destPath}`);
        resolve(destPath);
      });
    });

    request.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Parse CSV line handling quoted fields with tabs
 */
function parseCSVLine(line, delimiter = '\t') {
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
    } else if (char === delimiter && !inQuotes) {
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
 * Extract allergens from tags string
 */
function extractAllergens(allergenTags) {
  if (!allergenTags) return [];
  const tags = allergenTags.split(',').map(t => t.trim().toLowerCase());
  const allergens = new Set();
  for (const tag of tags) {
    const mapped = ALLERGEN_MAP[tag];
    if (mapped) allergens.add(mapped);
  }
  return Array.from(allergens);
}

/**
 * Extract ingredient names from ingredients text
 */
function extractIngredientNames(ingredientsText) {
  if (!ingredientsText) return [];
  let text = ingredientsText
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\d+(\.\d+)?%/g, '')
    .replace(/\*/g, '')
    .replace(/:/g, ',');
  const ingredients = text.split(/[,;.]/)
    .map(i => i.trim().toLowerCase())
    .filter(i => i.length > 2 && i.length < 50)
    .filter(i => !/^\d+$/.test(i));
  return [...new Set(ingredients)];
}

/**
 * Detect allergens from ingredient text using patterns
 */
function detectAllergensFromIngredients(ingredientsText) {
  if (!ingredientsText) return [];
  const allergens = new Set();
  const text = ingredientsText.toLowerCase();
  for (const [allergen, patterns] of Object.entries(INGREDIENT_ALLERGEN_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        allergens.add(allergen);
        break;
      }
    }
  }
  return Array.from(allergens);
}

/**
 * Extract additives from tags
 */
function extractAdditives(additivesTags) {
  if (!additivesTags) return [];
  // Format: en:e100,en:e150a,en:e322
  const additives = additivesTags.split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.startsWith('en:e'))
    .map(t => t.replace('en:', '').toUpperCase());
  return [...new Set(additives)];
}

/**
 * SQL escape
 */
function sqlEscape(str) {
  if (str == null) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

/**
 * Canonicalize ingredient name
 */
function canonicalizeName(name) {
  return name
    .toLowerCase()
    .replace(/,.*$/, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Process the CSV file - expanded version
 */
async function processCSV(csvPath) {
  console.log(`\nProcessing: ${csvPath}`);

  // Data collectors
  const ingredientAllergens = new Map();
  const ingredientSynonyms = new Map();
  const ingredientQuality = new Map(); // canonical -> { nova, nutri_score, nutri_value }
  const ingredientAdditives = new Map(); // canonical -> Set of additive codes
  const ingredientMicronutrients = new Map(); // canonical -> Map of nutrient_code -> value

  const fileStream = fs.createReadStream(csvPath);
  const gunzip = csvPath.endsWith('.gz') ? zlib.createGunzip() : null;
  const input = gunzip ? fileStream.pipe(gunzip) : fileStream;

  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let headers = null;
  let headerIndex = {};
  let count = 0;
  let withNova = 0;
  let withNutriScore = 0;
  let withAdditives = 0;
  let withMicronutrients = 0;

  for await (const line of rl) {
    if (!headers) {
      headers = parseCSVLine(line);
      headers.forEach((h, i) => headerIndex[h] = i);
      console.log(`  Found ${headers.length} columns`);
      console.log(`  NOVA column: ${headerIndex['nova_group'] !== undefined ? 'YES' : 'NO'}`);
      console.log(`  Nutri-Score column: ${headerIndex['nutrition_grade_fr'] !== undefined ? 'YES' : 'NO'}`);
      console.log(`  Additives column: ${headerIndex['additives_tags'] !== undefined ? 'YES' : 'NO'}`);
      continue;
    }

    count++;
    if (count % 100000 === 0) {
      process.stdout.write(`  Processed ${count} products...\r`);
    }

    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = values[i] || '');

    // Get product name for ingredient extraction
    const productName = row['product_name'] || '';
    const ingredientsText = row['ingredients_text'] || row['ingredients_text_en'] || '';

    // Skip if no useful data
    if (!productName && !ingredientsText) continue;

    // Determine canonical name (use first ingredient or simplified product name)
    const ingredients = extractIngredientNames(ingredientsText);
    const mainIngredient = ingredients[0] || canonicalizeName(productName);
    if (!mainIngredient || mainIngredient.length < 2) continue;

    // ---- ALLERGENS ----
    const allergenTags = row['allergens_tags'] || row['allergens'] || '';
    const tracesTags = row['traces_tags'] || row['traces'] || '';
    const tagAllergens = [...extractAllergens(allergenTags), ...extractAllergens(tracesTags)];
    const textAllergens = detectAllergensFromIngredients(ingredientsText);
    const allAllergens = [...new Set([...tagAllergens, ...textAllergens])];

    for (const ingredient of ingredients) {
      const canonical = canonicalizeName(ingredient);
      if (canonical.length < 2) continue;

      const ingredientAllergenMatches = detectAllergensFromIngredients(ingredient);
      if (ingredientAllergenMatches.length > 0) {
        if (!ingredientAllergens.has(canonical)) {
          ingredientAllergens.set(canonical, new Set());
        }
        ingredientAllergenMatches.forEach(a => ingredientAllergens.get(canonical).add(a));
      }

      if (ingredient !== canonical) {
        if (!ingredientSynonyms.has(canonical)) {
          ingredientSynonyms.set(canonical, new Set());
        }
        ingredientSynonyms.get(canonical).add(ingredient);
      }
    }

    // ---- NOVA & NUTRI-SCORE (per-ingredient approximation) ----
    const novaGroup = parseInt(row['nova_group']) || null;
    const nutriScore = (row['nutrition_grade_fr'] || '').toLowerCase();
    const nutriScoreValue = parseInt(row['nutrition-score-fr_100g']) || null;

    if (novaGroup || nutriScore) {
      for (const ingredient of ingredients.slice(0, 3)) { // First 3 ingredients
        const canonical = canonicalizeName(ingredient);
        if (canonical.length < 2) continue;

        if (!ingredientQuality.has(canonical)) {
          ingredientQuality.set(canonical, { nova: null, nutri_score: null, nutri_value: null, count: 0 });
        }
        const q = ingredientQuality.get(canonical);
        q.count++;

        // Take the most common/average values
        if (novaGroup && (!q.nova || novaGroup < q.nova)) {
          q.nova = novaGroup;
        }
        if (nutriScore && ['a', 'b', 'c', 'd', 'e'].includes(nutriScore)) {
          if (!q.nutri_score || nutriScore < q.nutri_score) {
            q.nutri_score = nutriScore;
          }
        }
        if (nutriScoreValue !== null) {
          q.nutri_value = nutriScoreValue;
        }
      }
      if (novaGroup) withNova++;
      if (nutriScore) withNutriScore++;
    }

    // ---- ADDITIVES ----
    const additivesTags = row['additives_tags'] || '';
    const additives = extractAdditives(additivesTags);
    if (additives.length > 0) {
      withAdditives++;
      // Associate additives with main ingredient/product
      const canonical = canonicalizeName(productName) || mainIngredient;
      if (canonical && canonical.length >= 2) {
        if (!ingredientAdditives.has(canonical)) {
          ingredientAdditives.set(canonical, new Set());
        }
        additives.forEach(a => ingredientAdditives.get(canonical).add(a));
      }
    }

    // ---- MICRONUTRIENTS ----
    let hasMicronutrients = false;
    for (const [offCol, nutrientInfo] of Object.entries(MICRONUTRIENT_MAP)) {
      const value = parseFloat(row[offCol]);
      if (!isNaN(value) && value > 0) {
        hasMicronutrients = true;

        // Associate with first ingredient
        const canonical = mainIngredient;
        if (!ingredientMicronutrients.has(canonical)) {
          ingredientMicronutrients.set(canonical, new Map());
        }
        const nutrients = ingredientMicronutrients.get(canonical);

        // Keep highest value seen
        if (!nutrients.has(nutrientInfo.code) || nutrients.get(nutrientInfo.code).value < value) {
          nutrients.set(nutrientInfo.code, {
            ...nutrientInfo,
            value
          });
        }
      }
    }
    if (hasMicronutrients) withMicronutrients++;
  }

  console.log(`\n  Total products: ${count}`);
  console.log(`  Products with NOVA: ${withNova}`);
  console.log(`  Products with Nutri-Score: ${withNutriScore}`);
  console.log(`  Products with additives: ${withAdditives}`);
  console.log(`  Products with micronutrients: ${withMicronutrients}`);
  console.log(`  Unique ingredient-allergen mappings: ${ingredientAllergens.size}`);
  console.log(`  Unique quality scores: ${ingredientQuality.size}`);
  console.log(`  Unique additive associations: ${ingredientAdditives.size}`);
  console.log(`  Unique micronutrient profiles: ${ingredientMicronutrients.size}`);

  return {
    ingredientAllergens,
    ingredientSynonyms,
    ingredientQuality,
    ingredientAdditives,
    ingredientMicronutrients
  };
}

/**
 * Generate all SQL files
 */
function generateSQL(data) {
  console.log('\nGenerating SQL files...');

  const {
    ingredientAllergens,
    ingredientSynonyms,
    ingredientQuality,
    ingredientAdditives,
    ingredientMicronutrients
  } = data;

  // ---- ALLERGEN FLAGS ----
  const allergenSql = fs.createWriteStream(path.join(OUT_DIR, 'off_allergen_flags.sql'));
  allergenSql.write('-- Open Food Facts: Ingredient Allergen Flags\n');
  allergenSql.write('-- Generated: ' + new Date().toISOString() + '\n\n');

  let allergenCount = 0;
  for (const [ingredient, allergens] of ingredientAllergens) {
    for (const allergen of allergens) {
      allergenSql.write(`INSERT OR IGNORE INTO ingredients (canonical_name, data_version, model_version) VALUES (${sqlEscape(ingredient)}, 1, 'off');\n`);
      allergenSql.write(`INSERT OR IGNORE INTO ingredient_allergen_flags (ingredient_id, allergen_code, confidence, source) SELECT i.id, ${sqlEscape(allergen)}, 'likely', 'openfoodfacts' FROM ingredients i WHERE i.canonical_name = ${sqlEscape(ingredient)};\n`);
      allergenCount++;
    }
  }
  allergenSql.end();
  console.log(`  Allergen flags: ${allergenCount} statements`);

  // ---- SYNONYMS ----
  const synonymsSql = fs.createWriteStream(path.join(OUT_DIR, 'off_synonyms.sql'));
  synonymsSql.write('-- Open Food Facts: Ingredient Synonyms\n');
  synonymsSql.write('-- Generated: ' + new Date().toISOString() + '\n\n');

  let synonymCount = 0;
  for (const [canonical, synonyms] of ingredientSynonyms) {
    for (const synonym of synonyms) {
      synonymsSql.write(`INSERT OR IGNORE INTO ingredient_synonyms (ingredient_id, synonym, locale) SELECT id, ${sqlEscape(synonym)}, 'en' FROM ingredients WHERE canonical_name = ${sqlEscape(canonical)};\n`);
      synonymCount++;
    }
  }
  synonymsSql.end();
  console.log(`  Synonyms: ${synonymCount} statements`);

  // ---- QUALITY SCORES (NOVA, Nutri-Score) ----
  const qualitySql = fs.createWriteStream(path.join(OUT_DIR, 'off_quality_scores.sql'));
  qualitySql.write('-- Open Food Facts: Quality Scores (NOVA, Nutri-Score)\n');
  qualitySql.write('-- Generated: ' + new Date().toISOString() + '\n\n');

  let qualityCount = 0;
  for (const [ingredient, quality] of ingredientQuality) {
    if (!quality.nova && !quality.nutri_score) continue;

    // Ensure ingredient exists
    qualitySql.write(`INSERT OR IGNORE INTO ingredients (canonical_name, data_version, model_version) VALUES (${sqlEscape(ingredient)}, 1, 'off');\n`);

    // Insert quality score
    const novaVal = quality.nova ? quality.nova : 'NULL';
    const nutriVal = quality.nutri_score ? sqlEscape(quality.nutri_score) : 'NULL';
    const nutriNumVal = quality.nutri_value !== null ? quality.nutri_value : 'NULL';

    qualitySql.write(`INSERT OR IGNORE INTO ingredient_quality_scores (ingredient_id, nova_group, nutri_score, nutri_score_value, source) SELECT id, ${novaVal}, ${nutriVal}, ${nutriNumVal}, 'openfoodfacts' FROM ingredients WHERE canonical_name = ${sqlEscape(ingredient)};\n`);
    qualityCount++;
  }
  qualitySql.end();
  console.log(`  Quality scores: ${qualityCount} statements`);

  // ---- ADDITIVES ----
  const additivesSql = fs.createWriteStream(path.join(OUT_DIR, 'off_additives.sql'));
  additivesSql.write('-- Open Food Facts: Ingredient Additives\n');
  additivesSql.write('-- Generated: ' + new Date().toISOString() + '\n\n');

  let additiveCount = 0;
  for (const [ingredient, additives] of ingredientAdditives) {
    // Ensure ingredient exists
    additivesSql.write(`INSERT OR IGNORE INTO ingredients (canonical_name, data_version, model_version) VALUES (${sqlEscape(ingredient)}, 1, 'off');\n`);

    for (const additive of additives) {
      // Insert additive association, join with additive_definitions for risk level
      additivesSql.write(`INSERT OR IGNORE INTO ingredient_additives (ingredient_id, additive_code, additive_name, additive_class, risk_level, source) SELECT i.id, ${sqlEscape(additive)}, COALESCE(ad.additive_name, ${sqlEscape(additive)}), ad.additive_class, ad.risk_level, 'openfoodfacts' FROM ingredients i LEFT JOIN additive_definitions ad ON ad.additive_code = ${sqlEscape(additive)} WHERE i.canonical_name = ${sqlEscape(ingredient)};\n`);
      additiveCount++;
    }
  }
  additivesSql.end();
  console.log(`  Additives: ${additiveCount} statements`);

  // ---- MICRONUTRIENTS ----
  const microSql = fs.createWriteStream(path.join(OUT_DIR, 'off_micronutrients.sql'));
  microSql.write('-- Open Food Facts: Micronutrients (Vitamins, Minerals)\n');
  microSql.write('-- Generated: ' + new Date().toISOString() + '\n\n');

  let microCount = 0;
  for (const [ingredient, nutrients] of ingredientMicronutrients) {
    // Ensure ingredient exists
    microSql.write(`INSERT OR IGNORE INTO ingredients (canonical_name, data_version, model_version) VALUES (${sqlEscape(ingredient)}, 1, 'off');\n`);

    for (const [code, info] of nutrients) {
      microSql.write(`INSERT OR IGNORE INTO ingredient_micronutrients (ingredient_id, nutrient_code, nutrient_name, amount_per_100g, unit, source) SELECT id, ${sqlEscape(code)}, ${sqlEscape(info.name)}, ${info.value}, ${sqlEscape(info.unit)}, 'openfoodfacts' FROM ingredients WHERE canonical_name = ${sqlEscape(ingredient)};\n`);
      microCount++;
    }
  }
  microSql.end();
  console.log(`  Micronutrients: ${microCount} statements`);

  return { allergenCount, synonymCount, qualityCount, additiveCount, microCount };
}

/**
 * Main function
 */
async function main() {
  console.log('=== Open Food Facts Complete Staging ===\n');
  console.log('Extracting: Allergens, Synonyms, NOVA, Nutri-Score, Additives, Micronutrients\n');

  const useFullExport = process.argv.includes('--full');

  let csvPath;

  if (useFullExport) {
    csvPath = path.join(RAW_DIR, 'en.openfoodfacts.org.products.csv.gz');
    if (!fs.existsSync(csvPath)) {
      console.log('1. Downloading full Open Food Facts CSV (~0.9GB)...');
      await downloadFile(
        'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz',
        csvPath
      );
    } else {
      console.log('1. Using cached CSV file');
    }
  } else {
    const existingCSV = fs.readdirSync(RAW_DIR).find(f => f.endsWith('.csv') || f.endsWith('.csv.gz'));
    if (existingCSV) {
      csvPath = path.join(RAW_DIR, existingCSV);
      console.log(`1. Using existing file: ${existingCSV}`);
    } else {
      console.log('1. No CSV found. Downloading full export...');
      csvPath = path.join(RAW_DIR, 'en.openfoodfacts.org.products.csv.gz');
      await downloadFile(
        'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz',
        csvPath
      );
    }
  }

  console.log('\n2. Processing CSV for all data types...');
  const data = await processCSV(csvPath);

  console.log('\n3. Generating SQL files...');
  generateSQL(data);

  console.log('\n=== Staging Complete ===');
  console.log(`Output files in: ${OUT_DIR}/`);
  console.log('  - off_allergen_flags.sql');
  console.log('  - off_synonyms.sql');
  console.log('  - off_quality_scores.sql');
  console.log('  - off_additives.sql');
  console.log('  - off_micronutrients.sql');
  console.log('\nNext steps:');
  console.log('  1. node seed_data/scripts/split_sql.js');
  console.log('  2. node seed_data/scripts/import_batches.js --remote');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
