# Restaurant AI (formerly Tummy Buddy) — CLAUDE.md

## Mission

You are the coding agent for Restaurant AI: a Cloudflare Workers backend that analyzes restaurant menu items for allergens, IBS/FODMAP risk, diet tags, nutrition, and organ impact scoring.

**Medical stance:** Informational coaching, not medical advice. Include disclaimers for health claims.

## Non-negotiables (must follow)

- **NO hallucinations**: Don't invent files, endpoints, tables, env vars, or API responses
- **Patch-only edits**: Small diffs only; no full rewrites unless required
- **Always include**: (1) what changed, (2) why, (3) how tested, (4) risks
- **Preserve PIPELINE_VERSION**: Don't change it (invalidates all caches) without approval
- **Evidence guidelines**: Lines 209–227 in index.js - MUST cite sources

## Architecture

### Main Files

- `index.js` (17k lines) - Main dish analysis worker
- `wrangler.toml` - Cloudflare config, bindings, env vars
- `workers/metrics-core/` - Analytics worker
- `workers/dish-consumer/` - Queue consumer
- `database/migrations/` - D1 schema
- `database/seeds/` - Compound/organ data

### Cloudflare Bindings (from wrangler.toml)

- `env.D1_DB` - Main database (tb-database)
- `env.MENUS_CACHE` - Menu caching KV
- `env.DISH_ANALYSIS_CACHE` - Analysis results KV
- `env.R2_BUCKET` - Artifacts storage
- `env.ANALYSIS_QUEUE` - Async jobs
- `env.AI` - Cloudflare AI binding
- `env.metrics_core` - Service binding

### Key Endpoints

- `POST /api/analyze` - Full dish analysis
- `POST /api/analyze/image` - Image recognition (FatSecret)
- `POST /api/job` - Uber Eats menu extraction
- `GET /api/whoami` - Health check

### Pipeline Flow

1. Cache check (`buildDishCacheKey()` + KV)
2. Recipe resolution (Edamam → Spoonacular → OpenAI)
3. Nutrition fetch (FatSecret / USDA / providers)
4. Allergen/FODMAP classification (LLM)
5. Compound mapping (D1 queries)
6. Organ scoring (graph edges, personalization)
7. Output + cache

## Workflow Rule (required)

1. **Explore**: Read files first
2. **Plan**: Steps + files + tests (wait for approval if multi-step)
3. **Implement**: Minimal changes
4. **Test**: curl/jq or wrangler dev checks
5. **PR**: What/Why/How tested/Risks

## Testing

### Local dev

```bash
wrangler dev

# Test endpoint
curl -X POST http://localhost:8787/api/analyze \
  -d '{"dishName": "Margherita Pizza"}' | jq .
```

### Golden tests (add for contract changes)

```bash
# Allergen detection
curl -X POST http://localhost:8787/api/analyze \
  -d '{"dishName": "Peanut Butter Toast"}' \
  | jq '.allergen_flags[] | select(.kind == "peanut")'
# Expected: { "kind": "peanut", "present": "yes", ... }
```

### D1 checks

```bash
wrangler d1 execute tb-database --command "SELECT * FROM compounds LIMIT 5;"
```

## Security

- Never commit secrets (use `wrangler secret put`)
- No API keys in code
- No PII in logs

## Common Commands

```bash
# Dev
wrangler dev

# Deploy
wrangler deploy --env production

# Logs
wrangler tail tb-dish-processor-production

# Migrations
wrangler d1 migrations apply tb-database --remote

# Set secret
wrangler secret put OPENAI_API_KEY --env production
```

## Decision Log

- **PIPELINE_VERSION = "analysis-v0.1"** - bump when prompts/logic change
- **Provider order**: env.PROVIDERS = "edamam,spoonacular,openai"
- **Evidence guidelines**: Lines 209–227 - cite menu/recipe/nutrition/typical
- **Premium gate**: KV-based, dev bypass `?dev=1`
