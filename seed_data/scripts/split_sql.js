#!/usr/bin/env node
/**
 * SQL File Splitter for D1
 *
 * Splits large SQL files into smaller batches that D1 can handle.
 * D1 has limits on batch operations (~500 statements recommended).
 *
 * USAGE:
 *   node seed_data/scripts/split_sql.js
 *
 * INPUT:  seed_data/out/usda_*.sql
 * OUTPUT: seed_data/out/batches/usda_*_batch_NNN.sql
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.join(__dirname, '..', 'out');
const BATCH_DIR = path.join(OUT_DIR, 'batches');

// D1 recommended batch size (statements per file)
const BATCH_SIZE = 500;

// Ensure batch dir exists
if (!fs.existsSync(BATCH_DIR)) {
  fs.mkdirSync(BATCH_DIR, { recursive: true });
}

/**
 * Split a SQL file into batches
 */
async function splitFile(filename) {
  const filepath = path.join(OUT_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.log(`  ⚠️  File not found: ${filename}`);
    return { batches: 0, statements: 0 };
  }

  const baseName = filename.replace('.sql', '');
  const fileStream = fs.createReadStream(filepath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let batchNum = 1;
  let statementsInBatch = 0;
  let totalStatements = 0;
  let currentBatch = null;

  const startNewBatch = () => {
    if (currentBatch) {
      currentBatch.end();
    }
    const batchPath = path.join(BATCH_DIR, `${baseName}_batch_${String(batchNum).padStart(3, '0')}.sql`);
    currentBatch = fs.createWriteStream(batchPath);
    currentBatch.write(`-- ${baseName} batch ${batchNum}\n`);
    currentBatch.write(`-- Generated: ${new Date().toISOString()}\n\n`);
    statementsInBatch = 0;
    batchNum++;
  };

  startNewBatch();

  for await (const line of rl) {
    // Skip comment lines and empty lines for counting
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) {
      continue;
    }

    // Write the statement
    currentBatch.write(line + '\n');
    statementsInBatch++;
    totalStatements++;

    // Start new batch if we hit the limit
    if (statementsInBatch >= BATCH_SIZE) {
      startNewBatch();
    }
  }

  if (currentBatch) {
    currentBatch.end();
  }

  return { batches: batchNum - 1, statements: totalStatements };
}

async function main() {
  console.log('=== SQL File Splitter for D1 ===\n');
  console.log(`Batch size: ${BATCH_SIZE} statements per file\n`);

  const files = [
    'usda_ingredients.sql',
    'usda_synonyms.sql',
    'usda_sources.sql',
    'usda_nutrients.sql'
  ];

  const results = [];

  for (const file of files) {
    console.log(`Splitting ${file}...`);
    const result = await splitFile(file);
    console.log(`  → ${result.batches} batches, ${result.statements} statements`);
    results.push({ file, ...result });
  }

  console.log('\n=== Split Complete ===');
  console.log(`Output directory: ${BATCH_DIR}/`);
  console.log('\nTo import all batches, run:');
  console.log('  node seed_data/scripts/import_batches.js\n');

  // Generate import script
  const importScript = `#!/usr/bin/env node
/**
 * Batch Import Script for D1
 *
 * Imports all SQL batches to D1 in order.
 *
 * USAGE:
 *   node seed_data/scripts/import_batches.js [--local|--remote]
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BATCH_DIR = path.join(__dirname, '..', 'out', 'batches');
const remote = process.argv.includes('--remote') ? '--remote' : '--local';

console.log(\`=== D1 Batch Import (\${remote}) ===\\n\`);

// Get all batch files sorted
const files = fs.readdirSync(BATCH_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

// Group by type and import in correct order
const order = ['ingredients', 'synonyms', 'sources', 'nutrients'];
const grouped = {};

for (const file of files) {
  for (const type of order) {
    if (file.includes(type)) {
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(file);
      break;
    }
  }
}

let imported = 0;
let failed = 0;

for (const type of order) {
  const batches = grouped[type] || [];
  console.log(\`\\nImporting \${type} (\${batches.length} batches)...\`);

  for (const batch of batches) {
    const batchPath = path.join(BATCH_DIR, batch);
    console.log(\`  → \${batch}\`);

    try {
      execSync(\`npx wrangler d1 execute tb-database \${remote} --file "\${batchPath}"\`, {
        stdio: 'pipe',
        timeout: 60000
      });
      imported++;
    } catch (err) {
      console.log(\`    ❌ FAILED: \${err.message}\`);
      failed++;
    }
  }
}

console.log(\`\\n=== Import Complete ===\`);
console.log(\`Imported: \${imported}\`);
console.log(\`Failed: \${failed}\`);
`;

  fs.writeFileSync(path.join(__dirname, 'import_batches.js'), importScript);
  console.log('Created: seed_data/scripts/import_batches.js');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
