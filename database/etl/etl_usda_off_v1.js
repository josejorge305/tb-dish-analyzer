/**
 * ETL v1: Seed the Evergreen Ingredient Brain Cache from free sources (USDA FDC + Open Food Facts).
 *
 * IMPORTANT:
 * - Manual / one-time job.
 * - Reuse existing functions in index.js: callUSDAFDC() and callOFF().
 * - Write ONLY to existing D1 tables:
 *   ingredients, ingredient_synonyms, ingredient_aliases,
 *   ingredient_allergen_flags, ingredient_vectors, ingredient_fodmap_profile,
 *   kb_ingredient_compound_yields, kb_cooking_profiles, kb_cooking_factors
 *
 * Next steps:
 * - import/reuse callUSDAFDC + callOFF without duplicating logic
 * - add D1 write helpers (UPSERT patterns)
 * - run a tiny test batch (5 ingredients)
 */

'use strict';

async function main() {
  console.log('ETL v1 file created. Next step will implement D1 writes + a 5-ingredient test run.');
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('ETL failed:', err);
    process.exit(1);
  });
}
