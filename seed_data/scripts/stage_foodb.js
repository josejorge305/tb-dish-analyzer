#!/usr/bin/env node
/**
 * FooDB Bioactive Compounds Staging Script
 *
 * Downloads and processes FooDB data to extract bioactive compounds:
 * - Polyphenols, flavonoids, carotenoids, alkaloids, terpenes
 * - Maps compounds to foods/ingredients
 * - Extracts health effects and target organs
 *
 * USAGE:
 *   node seed_data/scripts/stage_foodb.js
 *
 * INPUT:  Downloads from https://foodb.ca/downloads (JSON format, ~87MB)
 * OUTPUT: seed_data/out/foodb_bioactives.sql
 *
 * FooDB contains 70,926 compounds across 1,000+ foods
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.join(__dirname, '..', 'raw', 'foodb');
const OUT_DIR = path.join(__dirname, '..', 'out');
const WORK_DIR = path.join(__dirname, '..', 'work');

// Ensure directories exist
[RAW_DIR, OUT_DIR, WORK_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// FooDB download URL (JSON format - smaller than CSV)
const FOODB_JSON_URL = 'https://foodb.ca/public/system/downloads/foodb_2020_04_07_json.tar.gz';
const FOODB_CSV_URL = 'https://foodb.ca/public/system/downloads/foodb_2020_04_07_csv.tar.gz';

// Bioactive compound class mappings
const COMPOUND_CLASS_MAP = {
  // Polyphenols
  'Flavonoids': { class: 'flavonoid', subclass: null },
  'Flavones': { class: 'flavonoid', subclass: 'flavone' },
  'Flavonols': { class: 'flavonoid', subclass: 'flavonol' },
  'Flavanones': { class: 'flavonoid', subclass: 'flavanone' },
  'Flavanols': { class: 'flavonoid', subclass: 'flavanol' },
  'Anthocyanins': { class: 'flavonoid', subclass: 'anthocyanin' },
  'Isoflavonoids': { class: 'flavonoid', subclass: 'isoflavone' },
  'Isoflavones': { class: 'flavonoid', subclass: 'isoflavone' },
  'Catechins': { class: 'flavonoid', subclass: 'catechin' },
  'Procyanidins': { class: 'flavonoid', subclass: 'procyanidin' },

  // Other polyphenols
  'Phenolic acids': { class: 'polyphenol', subclass: 'phenolic_acid' },
  'Hydroxycinnamic acids': { class: 'polyphenol', subclass: 'hydroxycinnamic_acid' },
  'Hydroxybenzoic acids': { class: 'polyphenol', subclass: 'hydroxybenzoic_acid' },
  'Stilbenes': { class: 'polyphenol', subclass: 'stilbene' },
  'Lignans': { class: 'polyphenol', subclass: 'lignan' },
  'Tannins': { class: 'polyphenol', subclass: 'tannin' },
  'Coumarins': { class: 'polyphenol', subclass: 'coumarin' },

  // Carotenoids
  'Carotenoids': { class: 'carotenoid', subclass: null },
  'Carotenes': { class: 'carotenoid', subclass: 'carotene' },
  'Xanthophylls': { class: 'carotenoid', subclass: 'xanthophyll' },
  'Tetraterpenoids': { class: 'carotenoid', subclass: null },

  // Alkaloids
  'Alkaloids': { class: 'alkaloid', subclass: null },
  'Indole alkaloids': { class: 'alkaloid', subclass: 'indole' },
  'Purine alkaloids': { class: 'alkaloid', subclass: 'purine' },
  'Pyridine alkaloids': { class: 'alkaloid', subclass: 'pyridine' },
  'Tropane alkaloids': { class: 'alkaloid', subclass: 'tropane' },

  // Terpenes
  'Terpenes': { class: 'terpene', subclass: null },
  'Monoterpenes': { class: 'terpene', subclass: 'monoterpene' },
  'Sesquiterpenes': { class: 'terpene', subclass: 'sesquiterpene' },
  'Diterpenes': { class: 'terpene', subclass: 'diterpene' },
  'Triterpenes': { class: 'terpene', subclass: 'triterpene' },

  // Organosulfur compounds
  'Organosulfur compounds': { class: 'organosulfur', subclass: null },
  'Glucosinolates': { class: 'organosulfur', subclass: 'glucosinolate' },
  'Isothiocyanates': { class: 'organosulfur', subclass: 'isothiocyanate' },

  // Phytosterols
  'Phytosterols': { class: 'phytosterol', subclass: null },
  'Sterols': { class: 'phytosterol', subclass: null },
};

// Health effects by compound class (organ impacts)
const HEALTH_EFFECTS_MAP = {
  'flavonoid': {
    effects: ['antioxidant', 'anti-inflammatory', 'cardioprotective'],
    organs: ['heart', 'blood', 'brain']
  },
  'polyphenol': {
    effects: ['antioxidant', 'anti-inflammatory', 'neuroprotective'],
    organs: ['heart', 'brain', 'gut']
  },
  'carotenoid': {
    effects: ['antioxidant', 'eye-health', 'immune-support'],
    organs: ['eyes', 'skin', 'immune']
  },
  'alkaloid': {
    effects: ['stimulant', 'analgesic', 'neuroactive'],
    organs: ['brain', 'nervous']
  },
  'terpene': {
    effects: ['antimicrobial', 'anti-inflammatory', 'aromatic'],
    organs: ['gut', 'respiratory', 'skin']
  },
  'organosulfur': {
    effects: ['detoxification', 'anticancer', 'antimicrobial'],
    organs: ['liver', 'immune', 'gut']
  },
  'phytosterol': {
    effects: ['cholesterol-lowering', 'cardioprotective'],
    organs: ['heart', 'blood']
  }
};

function sqlEscape(str) {
  if (str == null) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading: ${url}`);
    console.log(`To: ${destPath}`);

    const file = fs.createWriteStream(destPath);

    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const total = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total) {
          const pct = ((downloaded / total) * 100).toFixed(1);
          process.stdout.write(`\rProgress: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log('\nDownload complete.');
        resolve(destPath);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function extractTarGz(tarPath, destDir) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  console.log(`Extracting ${tarPath} to ${destDir}...`);
  await execAsync(`tar -xzf "${tarPath}" -C "${destDir}"`);
  console.log('Extraction complete.');
}

async function loadFooDBData() {
  const tarPath = path.join(RAW_DIR, 'foodb_json.tar.gz');
  const extractedDir = path.join(RAW_DIR, 'extracted');

  // Download if not exists
  if (!fs.existsSync(tarPath)) {
    console.log('\n=== Downloading FooDB JSON Data ===');
    await downloadFile(FOODB_JSON_URL, tarPath);
  } else {
    console.log(`Using cached: ${tarPath}`);
  }

  // Extract if not done
  if (!fs.existsSync(extractedDir)) {
    fs.mkdirSync(extractedDir, { recursive: true });
    await extractTarGz(tarPath, extractedDir);
  }

  // Find the JSON files
  const files = fs.readdirSync(extractedDir, { recursive: true })
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(extractedDir, f));

  console.log(`Found ${files.length} JSON files`);
  return { extractedDir, files };
}

async function parseCompoundsFile(filePath) {
  console.log(`Parsing: ${filePath}`);
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

function classifyCompound(compound) {
  // Try to classify based on kingdom/super_class/class/sub_class
  const hierarchy = [
    compound.sub_class,
    compound.direct_parent,
    compound.kingdom,
    compound.super_class,
    compound.class_name || compound.klass
  ].filter(Boolean);

  for (const category of hierarchy) {
    if (COMPOUND_CLASS_MAP[category]) {
      return COMPOUND_CLASS_MAP[category];
    }
  }

  // Check name patterns
  const name = (compound.name || '').toLowerCase();
  if (name.includes('flavon')) return { class: 'flavonoid', subclass: null };
  if (name.includes('catechin')) return { class: 'flavonoid', subclass: 'catechin' };
  if (name.includes('anthocyanin')) return { class: 'flavonoid', subclass: 'anthocyanin' };
  if (name.includes('carotene') || name.includes('carotenoid')) return { class: 'carotenoid', subclass: null };
  if (name.includes('lutein') || name.includes('zeaxanthin')) return { class: 'carotenoid', subclass: 'xanthophyll' };
  if (name.includes('lycopene')) return { class: 'carotenoid', subclass: 'carotene' };
  if (name.includes('terpene') || name.includes('terpen')) return { class: 'terpene', subclass: null };
  if (name.includes('alkaloid') || name.includes('caffeine') || name.includes('theobromine')) return { class: 'alkaloid', subclass: null };
  if (name.includes('glucosinolate') || name.includes('sulforaphane')) return { class: 'organosulfur', subclass: 'glucosinolate' };
  if (name.includes('sterol') || name.includes('sitosterol')) return { class: 'phytosterol', subclass: null };
  if (name.includes('phenol') || name.includes('phenolic')) return { class: 'polyphenol', subclass: null };
  if (name.includes('resveratrol')) return { class: 'polyphenol', subclass: 'stilbene' };
  if (name.includes('curcumin')) return { class: 'polyphenol', subclass: 'curcuminoid' };
  if (name.includes('quercetin') || name.includes('kaempferol')) return { class: 'flavonoid', subclass: 'flavonol' };

  return null; // Not a bioactive we care about
}

async function processContents(extractedDir) {
  // FooDB structure: Content links compounds to foods with concentrations
  // Look for Content.json or contents.json
  const possiblePaths = [
    path.join(extractedDir, 'Content.json'),
    path.join(extractedDir, 'contents.json'),
    path.join(extractedDir, 'foodb_2020_04_07_json', 'Content.json'),
    path.join(extractedDir, 'foodb', 'Content.json'),
  ];

  // Also search recursively
  const allFiles = [];
  function walkDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.toLowerCase().includes('content') && entry.name.endsWith('.json')) {
          allFiles.push(fullPath);
        } else if (entry.name.toLowerCase().includes('compound') && entry.name.endsWith('.json')) {
          allFiles.push(fullPath);
        } else if (entry.name.toLowerCase().includes('food') && entry.name.endsWith('.json')) {
          allFiles.push(fullPath);
        }
      }
    } catch (e) {
      // Skip unreadable dirs
    }
  }

  walkDir(extractedDir);
  console.log('Found data files:', allFiles);

  return allFiles;
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║       FooDB Bioactive Compounds Staging Script            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Load FooDB data
    console.log('=== Step 1: Load FooDB Data ===');
    const { extractedDir, files } = await loadFooDBData();

    // Step 2: Find and analyze file structure
    console.log('\n=== Step 2: Analyze Data Structure ===');
    const dataFiles = await processContents(extractedDir);

    // List what we found
    console.log('\nDirectory structure:');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    try {
      const { stdout } = await execAsync(`find "${extractedDir}" -type f -name "*.json" | head -20`);
      console.log(stdout);
    } catch (e) {
      console.log('Could not list files');
    }

    // Check if we have the expected files
    let compoundsData = [];
    let contentsData = [];
    let foodsData = [];

    for (const file of dataFiles) {
      const basename = path.basename(file).toLowerCase();
      console.log(`Checking: ${basename}`);

      if (basename.includes('compound')) {
        console.log(`Loading compounds from ${file}...`);
        const data = await parseCompoundsFile(file);
        if (Array.isArray(data)) {
          compoundsData = data;
          console.log(`  Loaded ${data.length} compounds`);
        }
      } else if (basename.includes('content')) {
        console.log(`Loading contents from ${file}...`);
        const data = await parseCompoundsFile(file);
        if (Array.isArray(data)) {
          contentsData = data;
          console.log(`  Loaded ${data.length} content records`);
        }
      } else if (basename.includes('food') && !basename.includes('compound')) {
        console.log(`Loading foods from ${file}...`);
        const data = await parseCompoundsFile(file);
        if (Array.isArray(data)) {
          foodsData = data;
          console.log(`  Loaded ${data.length} foods`);
        }
      }
    }

    if (compoundsData.length === 0) {
      console.log('\nNo compounds data found. Let me check the file structure...');

      // Try to read any JSON file to understand structure
      const anyJson = files.find(f => f.endsWith('.json'));
      if (anyJson) {
        console.log(`\nSample file: ${anyJson}`);
        const sample = fs.readFileSync(anyJson, 'utf8').slice(0, 2000);
        console.log('First 2000 chars:', sample);
      }

      console.log('\nPlease check the FooDB download and try again.');
      return;
    }

    // Step 3: Build compound lookup
    console.log('\n=== Step 3: Build Compound Classifications ===');
    const compoundLookup = new Map();
    let bioactiveCount = 0;

    for (const compound of compoundsData) {
      const classification = classifyCompound(compound);
      if (classification) {
        bioactiveCount++;
        compoundLookup.set(compound.id, {
          id: compound.id,
          name: compound.name,
          ...classification,
          cas: compound.cas_number,
          pubchemId: compound.pubchem_compound_id
        });
      }
    }

    console.log(`Classified ${bioactiveCount} bioactive compounds out of ${compoundsData.length} total`);

    // Step 4: Build food lookup
    console.log('\n=== Step 4: Build Food Lookup ===');
    const foodLookup = new Map();
    for (const food of foodsData) {
      foodLookup.set(food.id, {
        id: food.id,
        name: food.name,
        name_scientific: food.name_scientific,
        description: food.description
      });
    }
    console.log(`Indexed ${foodLookup.size} foods`);

    // Step 5: Process contents (compound-food relationships)
    console.log('\n=== Step 5: Process Compound-Food Relationships ===');
    const bioactivesOutput = fs.createWriteStream(path.join(OUT_DIR, 'foodb_bioactives.sql'));

    bioactivesOutput.write('-- FooDB Bioactive Compounds\n');
    bioactivesOutput.write('-- Generated: ' + new Date().toISOString() + '\n');
    bioactivesOutput.write('-- Source: https://foodb.ca/downloads\n\n');

    let recordCount = 0;
    const seenPairs = new Set();

    for (const content of contentsData) {
      const compound = compoundLookup.get(content.source_id);
      if (!compound) continue; // Not a bioactive compound

      const food = foodLookup.get(content.food_id);
      if (!food) continue;

      // Skip duplicates
      const pairKey = `${food.name}|${compound.name}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      // Get health effects for this compound class
      const effects = HEALTH_EFFECTS_MAP[compound.class] || { effects: [], organs: [] };

      // Extract concentration if available
      const amount = content.orig_content || content.standard_content || null;
      const unit = content.orig_unit || content.standard_content_unit || 'mg';

      // Generate SQL - will match against our ingredients table
      bioactivesOutput.write(`INSERT OR IGNORE INTO ingredient_bioactives (ingredient_id, compound_name, compound_class, compound_subclass, amount_per_100g, unit, health_effects, target_organs, source, source_id) SELECT i.id, ${sqlEscape(compound.name)}, ${sqlEscape(compound.class)}, ${sqlEscape(compound.subclass)}, ${amount !== null ? amount : 'NULL'}, ${sqlEscape(unit)}, ${sqlEscape(JSON.stringify(effects.effects))}, ${sqlEscape(JSON.stringify(effects.organs))}, 'foodb', ${sqlEscape(compound.id)} FROM ingredients i WHERE i.canonical_name = ${sqlEscape(food.name.toLowerCase())};\n`);

      recordCount++;

      if (recordCount % 10000 === 0) {
        console.log(`  Processed ${recordCount} bioactive records...`);
      }
    }

    bioactivesOutput.end();

    console.log(`\n=== Complete ===`);
    console.log(`Generated ${recordCount} bioactive compound records`);
    console.log(`Output: seed_data/out/foodb_bioactives.sql`);

    // Step 6: Split into batches
    console.log('\n=== Step 6: Split into Batches ===');
    const { exec: exec2 } = await import('child_process');
    const { promisify: promisify2 } = await import('util');
    const execAsync2 = promisify2(exec2);

    try {
      await execAsync2(`node seed_data/scripts/split_sql.js seed_data/out/foodb_bioactives.sql`);
      console.log('Batches created successfully');
    } catch (e) {
      console.log('Run split_sql.js manually if needed');
    }

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
