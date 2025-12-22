/**
 * ETL v1: Seed the Evergreen Ingredient Brain Cache from free sources (USDA FDC + Open Food Facts).
 *
 * USAGE (PRODUCTION):
 *   # Run against REMOTE D1 (production)
 *   wrangler dev database/etl/etl_usda_off_v1.js --remote
 *   # Then visit: http://localhost:8787/run
 *
 * USAGE (LOCAL TESTING):
 *   wrangler dev database/etl/etl_usda_off_v1.js --local
 *   curl http://localhost:8787/run | jq .
 *
 * IMPORTANT:
 * - Manual / one-time job. Does NOT affect runtime pipeline.
 * - Reuses callUSDAFDC() and callOFF() from index.js.
 * - Writes to existing D1 tables:
 *   - ingredients (canonical_name, category)
 *   - ingredient_synonyms (ingredient_id, synonym, locale)
 *   - ingredient_allergen_flags (ingredient_id, allergen_id, confidence, source)
 *   - ingredients_fts (canonical_name, synonyms)
 * - ingredient_vectors left empty (requires ML, skipped in v1)
 */

import { callUSDAFDC, callOFF } from '../../index.js';

// Hardcoded test batch
const TEST_INGREDIENTS = ['apple', 'milk', 'butter', 'garlic', 'shrimp'];

// Known allergen mappings for test batch (conservative inference)
// Maps ingredient name patterns to allergen_code from allergen_definitions
const ALLERGEN_MAP = {
  milk: ['dairy', 'lactose'],
  butter: ['dairy', 'lactose'],
  shrimp: ['shellfish'],
  // apple, garlic: no common allergens
};

/**
 * Get allergen definition ID by code
 * @param {D1Database} db
 * @param {string} allergenCode
 * @returns {Promise<number|null>}
 */
async function getAllergenId(db, allergenCode) {
  const row = await db
    .prepare('SELECT rowid as id FROM allergen_definitions WHERE allergen_code = ?')
    .bind(allergenCode)
    .first();
  return row?.id || null;
}

/**
 * UPSERT an ingredient into D1
 * @param {D1Database} db
 * @param {string} canonicalName
 * @param {string|null} category
 * @returns {Promise<{id: number, inserted: boolean}>}
 */
async function upsertIngredient(db, canonicalName, category) {
  // Try to find existing
  const existing = await db
    .prepare('SELECT id FROM ingredients WHERE canonical_name = ? AND is_deleted = 0')
    .bind(canonicalName)
    .first();

  if (existing) {
    // Update updated_at timestamp and category if provided
    await db
      .prepare('UPDATE ingredients SET updated_at = datetime("now"), category = COALESCE(?, category) WHERE id = ?')
      .bind(category, existing.id)
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
  const normalizedSynonym = synonym.toLowerCase().trim();
  if (!normalizedSynonym) return { inserted: false };

  try {
    await db
      .prepare(`
        INSERT OR IGNORE INTO ingredient_synonyms (ingredient_id, synonym, locale)
        VALUES (?, ?, 'en')
      `)
      .bind(ingredientId, normalizedSynonym)
      .run();
    return { inserted: true };
  } catch (err) {
    // Duplicate or constraint violation, that's fine
    return { inserted: false };
  }
}

/**
 * UPSERT an allergen flag for an ingredient
 * @param {D1Database} db
 * @param {number} ingredientId
 * @param {number} allergenId
 * @param {string} confidence - 'definite', 'likely', 'possible', 'cross_contact'
 * @param {string} source - e.g., 'etl_v1_inference'
 * @returns {Promise<{inserted: boolean}>}
 */
async function upsertAllergenFlag(db, ingredientId, allergenId, confidence, source) {
  try {
    // Check if exists
    const existing = await db
      .prepare('SELECT id FROM ingredient_allergen_flags WHERE ingredient_id = ? AND allergen_id = ? AND is_deleted = 0')
      .bind(ingredientId, allergenId)
      .first();

    if (existing) {
      // Already exists, no update needed
      return { inserted: false };
    }

    await db
      .prepare(`
        INSERT INTO ingredient_allergen_flags (ingredient_id, allergen_id, confidence, source, data_version)
        VALUES (?, ?, ?, ?, 1)
      `)
      .bind(ingredientId, allergenId, confidence, source)
      .run();
    return { inserted: true };
  } catch (err) {
    console.log(`  Warning: allergen flag insert failed: ${err.message}`);
    return { inserted: false };
  }
}

/**
 * Update FTS index for an ingredient
 * @param {D1Database} db
 * @param {string} canonicalName
 * @param {string[]} synonyms
 * @returns {Promise<void>}
 */
async function updateFTS(db, canonicalName, synonyms) {
  const synonymsStr = synonyms.join(' ');

  try {
    // Try to delete existing entry first (FTS5 doesn't have UPSERT)
    await db
      .prepare('DELETE FROM ingredients_fts WHERE canonical_name = ?')
      .bind(canonicalName)
      .run();

    // Insert new entry
    await db
      .prepare('INSERT INTO ingredients_fts (canonical_name, synonyms) VALUES (?, ?)')
      .bind(canonicalName, synonymsStr)
      .run();
  } catch (err) {
    console.log(`  Warning: FTS update failed: ${err.message}`);
  }
}

/**
 * Infer category from ingredient data
 * @param {string} name
 * @param {object} data - USDA/OFF data
 * @returns {string|null}
 */
function inferCategory(name, data) {
  const desc = (data?.description || name).toLowerCase();

  if (desc.includes('milk') || desc.includes('cheese') || desc.includes('butter') || desc.includes('cream') || desc.includes('yogurt')) {
    return 'dairy';
  }
  if (desc.includes('beef') || desc.includes('chicken') || desc.includes('pork') || desc.includes('fish') || desc.includes('shrimp') || desc.includes('salmon') || desc.includes('tuna')) {
    return 'protein';
  }
  if (desc.includes('apple') || desc.includes('banana') || desc.includes('orange') || desc.includes('berry') || desc.includes('grape')) {
    return 'fruit';
  }
  if (desc.includes('garlic') || desc.includes('onion') || desc.includes('carrot') || desc.includes('broccoli') || desc.includes('spinach')) {
    return 'vegetable';
  }
  if (desc.includes('rice') || desc.includes('wheat') || desc.includes('bread') || desc.includes('pasta') || desc.includes('oat')) {
    return 'grain';
  }
  if (desc.includes('salt') || desc.includes('pepper') || desc.includes('cumin') || desc.includes('oregano')) {
    return 'spice';
  }

  return null;
}

/**
 * Get allergen codes for an ingredient based on name and data
 * @param {string} name
 * @param {object} data - USDA/OFF data
 * @returns {string[]}
 */
function inferAllergens(name, data) {
  const nameLower = name.toLowerCase();
  const allergens = new Set();

  // Check known mappings
  for (const [pattern, codes] of Object.entries(ALLERGEN_MAP)) {
    if (nameLower.includes(pattern)) {
      codes.forEach(c => allergens.add(c));
    }
  }

  // Check OFF allergen tags if available
  if (data?.allergens_tags) {
    const tags = data.allergens_tags;
    if (tags.includes('en:milk') || tags.includes('en:dairy')) {
      allergens.add('dairy');
      allergens.add('lactose');
    }
    if (tags.includes('en:shellfish') || tags.includes('en:crustaceans')) {
      allergens.add('shellfish');
    }
    if (tags.includes('en:fish')) {
      allergens.add('fish');
    }
    if (tags.includes('en:eggs')) {
      allergens.add('eggs');
    }
    if (tags.includes('en:peanuts')) {
      allergens.add('peanut');
    }
    if (tags.includes('en:nuts') || tags.includes('en:tree-nuts')) {
      allergens.add('tree_nuts');
    }
    if (tags.includes('en:wheat') || tags.includes('en:gluten')) {
      allergens.add('wheat');
      allergens.add('gluten');
    }
    if (tags.includes('en:soy') || tags.includes('en:soybeans')) {
      allergens.add('soy');
    }
    if (tags.includes('en:sesame') || tags.includes('en:sesame-seeds')) {
      allergens.add('sesame');
    }
  }

  return Array.from(allergens);
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
    allergensAdded: 0,
    ftsUpdated: false,
    skipped: [],
    error: null
  };

  try {
    // 1. Try USDA FDC first
    let data = await callUSDAFDC(env, name);
    if (data) {
      result.source = 'usda_fdc';
    }

    // 2. Fallback/supplement with Open Food Facts
    let offData = null;
    if (!data) {
      offData = await callOFF(env, name);
      if (offData) {
        data = offData;
        result.source = 'open_food_facts';
      }
    }

    if (!data) {
      result.error = 'No data from USDA or OFF';
      return result;
    }

    // 3. Derive category
    const category = inferCategory(name, data);

    // 4. UPSERT into ingredients table
    const { id: ingredientId, inserted } = await upsertIngredient(
      env.D1_DB,
      name.toLowerCase(),
      category
    );
    result.inserted = inserted;

    // 5. Collect and UPSERT synonyms
    const synonyms = new Set([name.toLowerCase()]);

    // Add USDA description as synonym if different and meaningful
    if (data.description) {
      const descLower = data.description.toLowerCase().trim();
      if (descLower && descLower !== name.toLowerCase() && descLower.length < 100) {
        synonyms.add(descLower);
      }
    }

    for (const syn of synonyms) {
      const { inserted: synInserted } = await upsertSynonym(env.D1_DB, ingredientId, syn);
      if (synInserted) result.synonymsAdded++;
    }

    // 6. UPSERT allergen flags
    const allergenCodes = inferAllergens(name, offData || data);
    for (const code of allergenCodes) {
      const allergenId = await getAllergenId(env.D1_DB, code);
      if (allergenId) {
        const { inserted: flagInserted } = await upsertAllergenFlag(
          env.D1_DB,
          ingredientId,
          allergenId,
          'definite', // Conservative for known mappings
          'etl_v1_inference'
        );
        if (flagInserted) result.allergensAdded++;
      } else {
        console.log(`  Warning: allergen_code '${code}' not found in allergen_definitions`);
      }
    }

    // 7. Update FTS index
    await updateFTS(env.D1_DB, name.toLowerCase(), Array.from(synonyms));
    result.ftsUpdated = true;

    // 8. Log skipped features
    result.skipped.push('ingredient_vectors (requires ML, skipped in v1)');

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
    allergensAdded: 0,
    ftsUpdated: 0,
    skipped: ['ingredient_vectors (requires ML)'],
    results: []
  };

  console.log(`\n=== ETL v1: Processing ${TEST_INGREDIENTS.length} ingredients (PRODUCTION) ===\n`);

  for (const name of TEST_INGREDIENTS) {
    console.log(`Processing: ${name}...`);
    const result = await processIngredient(env, name);
    summary.results.push(result);

    if (result.error) {
      console.log(`  ❌ FAILED: ${result.error}`);
      summary.failed++;
    } else {
      const action = result.inserted ? '✅ INSERTED' : '🔄 UPDATED';
      console.log(`  ${action} (source: ${result.source}, synonyms: +${result.synonymsAdded}, allergens: +${result.allergensAdded}, fts: ${result.ftsUpdated ? 'yes' : 'no'})`);

      if (result.inserted) {
        summary.inserted++;
      } else {
        summary.updated++;
      }
      summary.synonymsAdded += result.synonymsAdded;
      summary.allergensAdded += result.allergensAdded;
      if (result.ftsUpdated) summary.ftsUpdated++;
    }
  }

  console.log(`\n=== ETL v1 Summary ===`);
  console.log(`Total:          ${summary.total}`);
  console.log(`Inserted:       ${summary.inserted}`);
  console.log(`Updated:        ${summary.updated}`);
  console.log(`Failed:         ${summary.failed}`);
  console.log(`Synonyms added: ${summary.synonymsAdded}`);
  console.log(`Allergens added:${summary.allergensAdded}`);
  console.log(`FTS updated:    ${summary.ftsUpdated}`);
  console.log(`Skipped:        ${summary.skipped.join(', ')}`);
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
