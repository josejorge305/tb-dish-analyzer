# Database Seeds

This folder contains seed data for the Tummy Buddy D1 database.

## Seed Files

Seed SQL files are currently located at the repository root:

| File | Description |
|------|-------------|
| `seed_molecular_phase1.sql` | Organ systems + basic compounds |
| `seed_high_benefit_compounds.sql` | High-impact compounds (Omega-3, Polyphenols, Vitamin C) + ingredient yields |
| `v13_2_seed.sql` | Comprehensive compound → organ effect edges |

## Applying Seeds

Seeds must be applied **after** all migrations. Use wrangler to execute:

```bash
# Apply migrations first
wrangler d1 migrations apply tb-database --local

# Then apply seeds (in order)
wrangler d1 execute tb-database --file seed_molecular_phase1.sql --local
wrangler d1 execute tb-database --file seed_high_benefit_compounds.sql --local
wrangler d1 execute tb-database --file v13_2_seed.sql --local
```

For remote/production:

```bash
wrangler d1 migrations apply tb-database --remote
wrangler d1 execute tb-database --file seed_molecular_phase1.sql --remote
wrangler d1 execute tb-database --file seed_high_benefit_compounds.sql --remote
wrangler d1 execute tb-database --file v13_2_seed.sql --remote
```

## Prerequisites

- `seed_high_benefit_compounds.sql` requires migration `0006_evergreen_knowledge_bank.sql` to be applied first (creates `ingredients`, `ingredient_compound_yields`, `cooking_factors` tables).

## ETL: USDA/OFF Ingredient Seeding

ETL scripts for seeding ingredient data from free sources are located in `database/etl/`.

### Running ETL v1 in Production

The ETL runs as a standalone Cloudflare Worker. It does **not** affect the runtime dish analysis pipeline.

**Safety checklist before running:**
1. Ensure `USDA_FDC_API_KEY` is set in wrangler.toml or secrets
2. Verify migration `0006_evergreen_knowledge_bank.sql` is applied
3. Test locally first (`--local`) before running against production

```bash
# Start the ETL worker against REMOTE D1 (production)
wrangler dev database/etl/etl_usda_off_v1.js --remote

# Trigger the ETL (in another terminal)
curl http://localhost:8787/run | jq .

# Or visit http://localhost:8787/run in browser
```

### What ETL v1 Does

For each ingredient (currently: apple, milk, butter, garlic, shrimp):

1. **Fetches data** from USDA FDC (primary) or Open Food Facts (fallback)
2. **UPSERTs** into `ingredients` table (canonical_name, category)
3. **Adds synonyms** to `ingredient_synonyms` (ingredient name + USDA description)
4. **Sets allergen flags** in `ingredient_allergen_flags`:
   - milk, butter → dairy, lactose
   - shrimp → shellfish
5. **Updates FTS index** in `ingredients_fts` for search
6. **Skips** `ingredient_vectors` (requires ML, not implemented in v1)

### Idempotency

Re-running ETL is safe:
- Existing ingredients are updated (not duplicated)
- Existing synonyms are ignored (INSERT OR IGNORE)
- Existing allergen flags are preserved

### Requirements

- `USDA_FDC_API_KEY` must be configured
- Migration `0006_evergreen_knowledge_bank.sql` must be applied
- Migration `0003_user_tracking.sql` (for `allergen_definitions`) must be applied
