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

- `seed_high_benefit_compounds.sql` requires migration `0007_ingredient_brain_cache.sql` to be applied first (creates `ingredients`, `ingredient_compound_yields`, `cooking_factors` tables).

## Future: USDA/OFF ETL

ETL scripts for seeding from USDA FoodData Central and Open Food Facts will be added here.
