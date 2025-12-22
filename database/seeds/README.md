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

### Running ETL v1

The ETL runs as a Cloudflare Worker and uses the same D1 bindings as the main worker.

```bash
# 1. Run against LOCAL D1 (for testing)
wrangler dev database/etl/etl_usda_off_v1.js --local

# Then visit: http://localhost:8787/run
# Or use curl:
curl http://localhost:8787/run | jq .

# 2. Run against REMOTE D1 (production seeding)
wrangler dev database/etl/etl_usda_off_v1.js --remote

# Then visit: http://localhost:8787/run
```

### What ETL v1 Does

- Processes 5 test ingredients: apple, milk, butter, garlic, shrimp
- Fetches data from USDA FDC (primary) and Open Food Facts (fallback)
- UPSERTs into `ingredients` and `ingredient_synonyms` tables
- Logs skipped tables (ingredient_nutrients, ingredient_sources don't exist)

### Requirements

- `USDA_FDC_API_KEY` must be set (via `wrangler secret` or wrangler.toml)
- Migration `0006_evergreen_knowledge_bank.sql` must be applied first
