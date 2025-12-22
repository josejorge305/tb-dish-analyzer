/**
 * ETL v1: Seed the Evergreen Ingredient Brain Cache from free sources (USDA FDC + Open Food Facts).
 *
 * USAGE:
 *   # Run via wrangler (requires wrangler.toml with D1 binding)
 *   wrangler dev database/etl/etl_usda_off_v1.js --local
 *   # Then visit: http://localhost:8787/run
 *
 *   # Or run against remote D1:
 *   wrangler dev database/etl/etl_usda_off_v1.js --remote
 *
 * IMPORTANT:
 * - Manual / one-time job.
 * - Reuses callUSDAFDC() and callOFF() from index.js.
 * - Writes to existing D1 tables: ingredients, ingredient_synonyms
 * - Tables ingredient_nutrients/ingredient_sources do NOT exist in schema (skipped with log)
 */

import { callUSDAFDC, callOFF } from '../../index.js';

// Hardcoded test batch
const TEST_INGREDIENTS = ['apple', 'milk', 'butter', 'garlic', 'shrimp'];

/**
 * UPSERT an ingredient into D1
 * @param {D1Database} db
 * @param {string} canonicalName
 * @param {string|null} category
 * @param {string} source - 'usda_fdc' or 'open_food_facts'
 * @returns {Promise<{id: number, inserted: boolean}>}
 */
async function upsertIngredient(db, canonicalName, category, source) {
  // Try to find existing
  const existing = await db
    .prepare('SELECT id FROM ingredients WHERE canonical_name = ? AND is_deleted = 0')
    .bind(canonicalName)
    .first();

  if (existing) {
    // Update updated_at timestamp
    await db
      .prepare('UPDATE ingredients SET updated_at = datetime("now") WHERE id = ?')
      .bind(existing.id)
      .run();
    return { id: existing.id, inserted: false };
  }

  // Insert new
  const result = await db
    .prepare(`
      INSERT INTO ingredients (canonical_name, category, data_version, model_version)
      VALUES (?, ?, 1, 'etl_v1')
    `)
    .bind(canonicalName, category)
    .run();

  return { id: result.meta.last_row_id, inserted: true };
}

/**
 * UPSERT a synonym for an ingredient
 * @param {D1Database} db
 * @param {number} ingredientId
 * @param {string} synonym
 * @returns {Promise<{inserted: boolean}>}
 */
async function upsertSynonym(db, ingredientId, synonym) {
  try {
    await db
      .prepare(`
        INSERT OR IGNORE INTO ingredient_synonyms (ingredient_id, synonym, locale)
        VALUES (?, ?, 'en')
      `)
      .bind(ingredientId, synonym.toLowerCase())
      .run();
    return { inserted: true };
  } catch (err) {
    // Duplicate, that's fine
    return { inserted: false };
  }
}

/**
 * Process a single ingredient through USDA + OFF
 * @param {object} env - Worker env with D1_DB and API keys
 * @param {string} name - Ingredient name to process
 * @returns {Promise<object>} - Result summary
 */
async function processIngredient(env, name) {
  const result = {
    name,
    source: null,
    inserted: false,
    synonymsAdded: 0,
    nutrients: null,
    skipped: [],
    error: null
  };

  try {
    // 1. Try USDA FDC first
    let data = await callUSDAFDC(env, name);
    if (data) {
      result.source = 'usda_fdc';
      result.nutrients = data.nutrients_per_100g || data.nutrients;
    }

    // 2. Fallback/supplement with Open Food Facts
    if (!data || !result.nutrients?.energyKcal) {
      const offData = await callOFF(env, name);
      if (offData) {
        if (!data) {
          data = offData;
          result.source = 'open_food_facts';
        }
        // Supplement missing fields
        if (!result.nutrients) {
          result.nutrients = offData.nutrients;
        } else {
          // Fill in gaps from OFF
          for (const [key, val] of Object.entries(offData.nutrients || {})) {
            if (result.nutrients[key] == null && val != null) {
              result.nutrients[key] = val;
            }
          }
        }
      }
    }

    if (!data) {
      result.error = 'No data from USDA or OFF';
      return result;
    }

    // 3. Derive category from USDA dataType or description
    let category = null;
    if (data.dataType) {
      // USDA: Try to infer from description
      const desc = (data.description || '').toLowerCase();
      if (desc.includes('milk') || desc.includes('cheese') || desc.includes('butter')) {
        category = 'dairy';
      } else if (desc.includes('beef') || desc.includes('chicken') || desc.includes('pork') || desc.includes('fish') || desc.includes('shrimp')) {
        category = 'protein';
      } else if (desc.includes('apple') || desc.includes('banana') || desc.includes('orange')) {
        category = 'fruit';
      } else if (desc.includes('garlic') || desc.includes('onion') || desc.includes('carrot')) {
        category = 'vegetable';
      }
    }

    // 4. UPSERT into ingredients table
    const { id: ingredientId, inserted } = await upsertIngredient(
      env.D1_DB,
      name.toLowerCase(),
      category,
      result.source
    );
    result.inserted = inserted;

    // 5. UPSERT synonyms (at minimum: the name itself)
    const synonyms = [name.toLowerCase()];

    // Add USDA description as synonym if different
    if (data.description && data.description.toLowerCase() !== name.toLowerCase()) {
      synonyms.push(data.description.toLowerCase());
    }

    // Add brand if available
    if (data.brand) {
      synonyms.push(`${data.brand} ${name}`.toLowerCase());
    }

    for (const syn of synonyms) {
      const { inserted: synInserted } = await upsertSynonym(env.D1_DB, ingredientId, syn);
      if (synInserted) result.synonymsAdded++;
    }

    // 6. Log skipped tables
    result.skipped.push('ingredient_nutrients (table does not exist in schema)');
    result.skipped.push('ingredient_sources (table does not exist in schema)');

  } catch (err) {
    result.error = err.message || String(err);
  }

  return result;
}

/**
 * Run the ETL for all test ingredients
 * @param {object} env - Worker env
 * @returns {Promise<object>} - Summary
 */
async function runETL(env) {
  const summary = {
    total: TEST_INGREDIENTS.length,
    inserted: 0,
    updated: 0,
    failed: 0,
    synonymsAdded: 0,
    skippedTables: ['ingredient_nutrients', 'ingredient_sources'],
    results: []
  };

  console.log(`\n=== ETL v1: Processing ${TEST_INGREDIENTS.length} ingredients ===\n`);

  for (const name of TEST_INGREDIENTS) {
    console.log(`Processing: ${name}...`);
    const result = await processIngredient(env, name);
    summary.results.push(result);

    if (result.error) {
      console.log(`  ❌ FAILED: ${result.error}`);
      summary.failed++;
    } else if (result.inserted) {
      console.log(`  ✅ INSERTED (source: ${result.source}, synonyms: ${result.synonymsAdded})`);
      summary.inserted++;
      summary.synonymsAdded += result.synonymsAdded;
    } else {
      console.log(`  🔄 UPDATED (source: ${result.source}, synonyms: ${result.synonymsAdded})`);
      summary.updated++;
      summary.synonymsAdded += result.synonymsAdded;
    }
  }

  console.log(`\n=== ETL v1 Summary ===`);
  console.log(`Total:     ${summary.total}`);
  console.log(`Inserted:  ${summary.inserted}`);
  console.log(`Updated:   ${summary.updated}`);
  console.log(`Failed:    ${summary.failed}`);
  console.log(`Synonyms:  ${summary.synonymsAdded}`);
  console.log(`Skipped:   ${summary.skippedTables.join(', ')}`);
  console.log(`\n`);

  return summary;
}

// Worker entry point
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/run' || url.pathname === '/') {
      try {
        const summary = await runETL(env);
        return new Response(JSON.stringify(summary, null, 2), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('ETL v1 - Visit /run to execute', { status: 200 });
  }
};
