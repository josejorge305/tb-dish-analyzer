# Restaurant AI (formerly Tummy Buddy) — CLAUDE.md

## Mission
You are the coding agent for Restaurant AI: a mobile app that analyzes restaurant menu items (and ideally full plates) for allergens, IBS/FODMAP risk, diet/lifestyle tags, portion context, nutrition summaries, and a premium "organ impact" dashboard.

Medical stance: informational coaching, not medical advice. Always include gentle disclaimers for health claims.

## Non-negotiables (must follow)
- **NO hallucinations**: don't invent files, endpoints, tables, env vars, or API responses.
- **Patch-only edits**: prefer small diffs; do NOT rewrite whole files unless explicitly required.
- **Always include**: (1) what changed, (2) why, (3) how tested, (4) risks/rollbacks.
- **Do not collapse/move/remove the Nutrition Summary visibility** unless the issue explicitly asks.
- **If uncertain about behavior/data**: label uncertainty and add verification steps.
- **No overconfident health claims**: use "likely", "possible", "can't confirm" when appropriate.

## Architecture (high level)
### Frontend
- React Native / Expo app
- Restaurant screen sections: Allergens, IBS/FODMAP, Diet & Lifestyle, Organ Impact, Plate Components, Portion (AI), Nutrition
- UX goal: "Instagram-like" feed with clean pills/chips, minimal clutter, fast perceived load

### Backend
- **Cloudflare Workers** (gateway/orchestrator + service-bound workers)
- **D1 database** for structured data (compounds, organ systems, mappings, user logs)
- **KV caches** for speed (menu cache, lexicon cache, user prefs)
- **R2** for snapshots / analysis artifacts
- **External APIs**: menu extraction (Uber Eats/Places), nutrition (USDA FDC/FatSecret), LLM classification, optional vision

### Dish Analysis Pipeline (conceptual)
1. Normalize recipe/menu inputs (canonical ingredients, quantities, cooking methods)
2. Map ingredients → compounds with yields + cooking adjustments
3. Convert to dose/exposure (mg/kg-ish, bioavailability heuristics)
4. Compound → organ graph edges (sign, strength 0–1, evidence tier)
5. Apply personalization modifiers (IBS/FODMAP, lactose intolerance, celiac, meds)
6. Compute Organ Impact Index per organ: weighted sum, normalize -100…+100
7. Output: levels + "why" sentences + confidence
8. Persist to D1 tables

## Workflow rule (required)
For multi-step tasks:
1. **Explore** relevant files first (read/search)
2. **Propose a plan** + file list + tests (wait if asked)
3. **Implement** minimal changes
4. **Run/describe** deterministic checks (unit tests / curl / lint)
5. **Open a PR** with clear description

## Testing expectations
- Prefer targeted tests over full suites when possible
- **Backend contract changes**: add/adjust at least one `curl | jq` "golden test"
- **UI changes**: list a short manual QA checklist (screen/action/expected result)
- **Analysis pipeline**: verify output JSON schema + edge cases (missing ingredients, allergen detection)

## Output format standards
### JSON Responses
- Allergens: `{ "allergen": "gluten", "status": "present" | "not_detected" | "possible_cross_contact", "confidence": 0.95 }`
- IBS/FODMAP: `{ "risk_level": "low" | "medium" | "high", "why": "...", "mitigations": [...] }`
- Organ Impact: `{ "organ": "liver", "score": -45, "confidence": 0.8, "reason": "..." }`
- Nutrition: always visible, not collapsed

### UI Copy
- Short sentences. Avoid AI-sounding text.
- Actionable guidance: "Request sauce on side" not "This dish may contain high sodium"

## Security
- Never add secrets to code or workflow files. Use GitHub Secrets or Cloudflare env vars.
- No API keys in commits ever.

## Key files (update as repo evolves)
- Backend workers: `workers/gateway/`, `workers/analysis/`
- Database schemas: `schema/d1/` or `migrations/`
- Frontend screens: `app/screens/RestaurantScreen.tsx` (or similar)
- Shared types: `types/` or `@types/`

## Common commands
```bash
# Run backend locally (Cloudflare)
npm run dev:workers
# or: wrangler dev

# Run frontend (Expo)
npm run start
# or: npx expo start

# Deploy backend
npm run deploy:workers
# or: wrangler deploy

# Run tests
npm test
```

## Decision log
- **Rebranding**: Tummy Buddy → Restaurant AI (same product, new name)
- **Nutrition visibility**: Always shown; users expect this high-signal data
- **Organ scoring**: -100 to +100 scale with confidence + explanations
- **Allergen stance**: Explicit status (present/not detected/cross-contact), not vague
