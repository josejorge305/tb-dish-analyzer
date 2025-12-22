#!/usr/bin/env node
/**
 * Open Food Facts Allergen Staging Script
 *
 * Downloads and processes Open Food Facts data to extract:
 * 1. Allergen → Ingredient mappings
 * 2. Ingredient synonyms from ingredient lists
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
// These must match the values in the allergen_definitions table
const ALLERGEN_MAP = {
  // Open Food Facts tag → allergen_definitions.allergen_code
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
// Keys match allergen_definitions.allergen_code
const INGREDIENT_ALLERGEN_PATTERNS = {
  dairy: [
    /\b(milk|cream|butter|cheese|yogurt|yoghurt|whey|casein|lactose|ghee|paneer|kefir|curd)\b/i,
  ],
  eggs: [
    /\b(egg|eggs|albumin|globulin|lysozyme|mayonnaise|meringue|ovalbumin|ovomucin|ovomucoid|ovovitellin)\b/i,
  ],
  fish: [
    /\b(fish|salmon|tuna|cod|anchov|sardine|tilapia|bass|trout|mackerel|herring|haddock|pollock|catfish)\b/i,
  ],
  shellfish: [
    /\b(shrimp|prawn|crab|lobster|crayfish|crawfish|langoustine|scampi|krill)\b/i,
  ],
  tree_nuts: [
    /\b(almond|cashew|walnut|pecan|pistachio|hazelnut|filbert|macadamia|brazil.?nut|chestnut|praline|marzipan|nougat)\b/i,
  ],
  peanut: [
    /\b(peanut|groundnut|arachis|goober)\b/i,
  ],
  wheat: [
    /\b(wheat|barley|rye|spelt|kamut|triticale|semolina|durum|farina|bulgur|couscous|seitan)\b/i,
  ],
  gluten: [
    /\b(gluten|oat)\b/i,
  ],
  soy: [
    /\b(soy|soya|soybean|edamame|tofu|tempeh|miso|tamari|shoyu)\b/i,
  ],
  sesame: [
    /\b(sesame|tahini|halvah|hummus)\b/i,
  ],
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
      // Handle redirects
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
    if (mapped) {
      allergens.add(mapped);
    }
  }

  return Array.from(allergens);
}

/**
 * Extract ingredient names from ingredients text
 */
function extractIngredientNames(ingredientsText) {
  if (!ingredientsText) return [];

  // Clean up the text
  let text = ingredientsText
    .replace(/\([^)]*\)/g, '') // Remove parentheticals
    .replace(/\[[^\]]*\]/g, '') // Remove brackets
    .replace(/\{[^}]*\}/g, '') // Remove braces
    .replace(/\d+(\.\d+)?%/g, '') // Remove percentages
    .replace(/\*/g, '') // Remove asterisks
    .replace(/:/g, ','); // Replace colons with commas

  // Split by common delimiters
  const ingredients = text.split(/[,;.]/)
    .map(i => i.trim().toLowerCase())
    .filter(i => i.length > 2 && i.length < 50)
    .filter(i => !/^\d+$/.test(i)); // Skip pure numbers

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
 * Process the CSV file
 */
async function processCSV(csvPath) {
  console.log(`\nProcessing: ${csvPath}`);

  // Track unique ingredient-allergen associations
  const ingredientAllergens = new Map(); // ingredient -> Set of allergens
  const ingredientSynonyms = new Map(); // canonical -> Set of variants

  const fileStream = fs.createReadStream(csvPath);
  const gunzip = csvPath.endsWith('.gz') ? zlib.createGunzip() : null;
  const input = gunzip ? fileStream.pipe(gunzip) : fileStream;

  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let headers = null;
  let count = 0;
  let processedWithAllergens = 0;

  for await (const line of rl) {
    if (!headers) {
      headers = parseCSVLine(line);
      console.log(`  Found ${headers.length} columns`);
      continue;
    }

    count++;
    if (count % 50000 === 0) {
      process.stdout.write(`  Processed ${count} products...\r`);
    }

    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = values[i] || '');

    // Get allergen tags
    const allergenTags = row['allergens_tags'] || row['allergens'] || '';
    const tracesTags = row['traces_tags'] || row['traces'] || '';
    const ingredientsText = row['ingredients_text'] || row['ingredients_text_en'] || '';

    // Combine allergens from tags and traces
    const tagAllergens = [
      ...extractAllergens(allergenTags),
      ...extractAllergens(tracesTags)
    ];

    // Also detect from ingredients text
    const textAllergens = detectAllergensFromIngredients(ingredientsText);

    const allAllergens = [...new Set([...tagAllergens, ...textAllergens])];

    if (allAllergens.length === 0) continue;
    processedWithAllergens++;

    // Extract ingredients and associate with allergens
    const ingredients = extractIngredientNames(ingredientsText);

    for (const ingredient of ingredients) {
      const canonical = canonicalizeName(ingredient);
      if (canonical.length < 2) continue;

      // Check if this ingredient matches any allergen pattern
      const ingredientAllergenMatches = detectAllergensFromIngredients(ingredient);

      if (ingredientAllergenMatches.length > 0) {
        if (!ingredientAllergens.has(canonical)) {
          ingredientAllergens.set(canonical, new Set());
        }
        ingredientAllergenMatches.forEach(a => ingredientAllergens.get(canonical).add(a));
      }

      // Track synonyms
      if (ingredient !== canonical) {
        if (!ingredientSynonyms.has(canonical)) {
          ingredientSynonyms.set(canonical, new Set());
        }
        ingredientSynonyms.get(canonical).add(ingredient);
      }
    }
  }

  console.log(`\n  Total products: ${count}`);
  console.log(`  Products with allergens: ${processedWithAllergens}`);
  console.log(`  Unique ingredient-allergen mappings: ${ingredientAllergens.size}`);
  console.log(`  Unique ingredient synonyms: ${ingredientSynonyms.size}`);

  return { ingredientAllergens, ingredientSynonyms };
}

/**
 * Generate SQL files
 */
function generateSQL(ingredientAllergens, ingredientSynonyms) {
  console.log('\nGenerating SQL files...');

  // Allergen flags SQL
  const allergenSql = fs.createWriteStream(path.join(OUT_DIR, 'off_allergen_flags.sql'));
  allergenSql.write('-- Open Food Facts: Ingredient Allergen Flags\n');
  allergenSql.write('-- Generated: ' + new Date().toISOString() + '\n\n');

  let allergenCount = 0;
  for (const [ingredient, allergens] of ingredientAllergens) {
    for (const allergen of allergens) {
      // First ensure the ingredient exists
      allergenSql.write(`INSERT OR IGNORE INTO ingredients (canonical_name, data_version, model_version) VALUES (${sqlEscape(ingredient)}, 1, 'off');\n`);

      // Then add the allergen flag
      // Uses subquery to get ingredient_id and allergen rowid
      // allergen_definitions uses allergen_code as primary key, but rowid works as id
      allergenSql.write(`INSERT OR IGNORE INTO ingredient_allergen_flags (ingredient_id, allergen_id, confidence, source) SELECT i.id, a.rowid, 'likely', 'openfoodfacts' FROM ingredients i, allergen_definitions a WHERE i.canonical_name = ${sqlEscape(ingredient)} AND a.allergen_code = ${sqlEscape(allergen)};\n`);
      allergenCount++;
    }
  }
  allergenSql.end();

  // Synonyms SQL
  const synonymsSql = fs.createWriteStream(path.join(OUT_DIR, 'off_synonyms.sql'));
  synonymsSql.write('-- Open Food Facts: Ingredient Synonyms\n');
  synonymsSql.write('-- Generated: ' + new Date().toISOString() + '\n\n');

  let synonymCount = 0;
  for (const [canonical, synonyms] of ingredientSynonyms) {
    for (const synonym of synonyms) {
      // ingredient_synonyms doesn't have a source column
      synonymsSql.write(`INSERT OR IGNORE INTO ingredient_synonyms (ingredient_id, synonym, locale) SELECT id, ${sqlEscape(synonym)}, 'en' FROM ingredients WHERE canonical_name = ${sqlEscape(canonical)};\n`);
      synonymCount++;
    }
  }
  synonymsSql.end();

  console.log(`  Allergen flag statements: ${allergenCount}`);
  console.log(`  Synonym statements: ${synonymCount}`);

  return { allergenCount, synonymCount };
}

/**
 * Main function
 */
async function main() {
  console.log('=== Open Food Facts Allergen Staging ===\n');

  const useFullExport = process.argv.includes('--full');

  let csvPath;

  if (useFullExport) {
    // Download full CSV export
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
    // Try to find existing CSV or download delta
    const existingCSV = fs.readdirSync(RAW_DIR).find(f => f.endsWith('.csv') || f.endsWith('.csv.gz'));

    if (existingCSV) {
      csvPath = path.join(RAW_DIR, existingCSV);
      console.log(`1. Using existing file: ${existingCSV}`);
    } else {
      console.log('1. No CSV found. Downloading full export (use Ctrl+C to cancel)...');
      console.log('   Alternatively, download manually from: https://world.openfoodfacts.org/data\n');

      csvPath = path.join(RAW_DIR, 'en.openfoodfacts.org.products.csv.gz');
      await downloadFile(
        'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz',
        csvPath
      );
    }
  }

  // Process the CSV
  console.log('\n2. Processing CSV for allergen mappings...');
  const { ingredientAllergens, ingredientSynonyms } = await processCSV(csvPath);

  // Generate SQL
  console.log('\n3. Generating SQL files...');
  const { allergenCount, synonymCount } = generateSQL(ingredientAllergens, ingredientSynonyms);

  console.log('\n=== Staging Complete ===');
  console.log(`Output files in: ${OUT_DIR}/`);
  console.log('  - off_allergen_flags.sql');
  console.log('  - off_synonyms.sql');
  console.log('\nNext steps:');
  console.log('  1. node seed_data/scripts/split_sql.js');
  console.log('  2. node seed_data/scripts/import_batches.js --remote');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
