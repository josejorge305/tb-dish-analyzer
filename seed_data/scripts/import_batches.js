#!/usr/bin/env node
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

console.log(`=== D1 Batch Import (${remote}) ===\n`);

// Get all batch files sorted
const files = fs.readdirSync(BATCH_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

// Group by type and import in correct order
const order = ['ingredients', 'synonyms', 'sources', 'allergen_flags', 'quality_scores', 'additives', 'bioactives', 'micronutrients', 'nutrients'];
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
  console.log(`\nImporting ${type} (${batches.length} batches)...`);

  for (const batch of batches) {
    const batchPath = path.join(BATCH_DIR, batch);
    console.log(`  → ${batch}`);

    try {
      execSync(`npx wrangler d1 execute tb-database ${remote} --file "${batchPath}"`, {
        stdio: 'pipe',
        timeout: 60000
      });
      imported++;
    } catch (err) {
      console.log(`    ❌ FAILED: ${err.message}`);
      failed++;
    }
  }
}

console.log(`\n=== Import Complete ===`);
console.log(`Imported: ${imported}`);
console.log(`Failed: ${failed}`);
