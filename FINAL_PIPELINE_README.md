# Uber Eats Menu Ingestion Pipeline v1

This pipeline scrapes restaurant menus from Uber Eats using DOM-based extraction, normalizes the data into a canonical format, validates quality, creates versioned snapshots for change tracking, and produces a consumer-ready JSON payload. It is designed as a deterministic, AI-free data pipeline that transforms raw web content into structured menu data suitable for downstream analysis.

## Pipeline Steps

```
node runMenuPipeline.cjs "https://www.ubereats.com/store/..."
```

| Step | File | Description |
|------|------|-------------|
| 1 | `uberScraper.cjs` | Playwright-based DOM scraper. Navigates to store URL, auto-scrolls to load all items, extracts menu data via CSS selectors. Outputs `uber_menu_extracted.json`. |
| 2 | `normalizeMenu.cjs` | Transforms raw scrape into canonical format. Maps sections to categories (mains, sides, desserts, etc.), converts prices to cents, parses calories, filters non-food items. |
| 3 | `validateMenu.cjs` | Quality gate. Checks for duplicate IDs, required fields, valid categories. Pipeline STOPS if validation fails. |
| 4 | `snapshotMenu.cjs` | Creates immutable versioned snapshot. Version ID = SHA256 hash of item data. Prevents duplicate snapshots. |
| 5 | `diffMenu.cjs` | Compares current snapshot to previous. Detects added/removed items, price changes, category changes. |
| 6 | `publishMenu.cjs` | Produces final consumer-ready payload. Groups items by category, strips internal fields, attaches metadata. |

## Output Files

- `uber_menu_extracted.json` - Raw scrape data
- `uber_menu_raw.html` - HTML backup
- `normalized_menu.json` - Normalized menu
- `menu_validation_report.json` - Validation results
- `snapshots/{slug}/{version}.json` - Versioned snapshot
- `menu_diff_report.json` - Change detection
- `published_menu.json` - Consumer-ready payload

## Canonical Categories

| Category | Examples |
|----------|----------|
| `mains` | Burgers, sandwiches, bowls, entrees |
| `appetizers` | Starters, small plates, shareables |
| `sides` | Fries, onion rings, salads |
| `desserts` | Shakes, cookies, ice cream |
| `drinks` | Sodas, coffee, tea, juice |
| `combos` | Meals, bundles, boxes |
| `kids` | Kid's meals, junior items |
| `catering` | Large orders, trays, party packs |

## Out of Scope (Intentionally Excluded)

- **Other platforms**: Only Uber Eats is supported. DoorDash, Grubhub, etc. are not implemented.
- **AI-based extraction**: This pipeline uses pure DOM scraping, not LLM extraction.
- **Modifier/customization parsing**: Item modifiers (add cheese, extra sauce) are not extracted.
- **Allergen detection**: Allergen analysis happens downstream, not in this pipeline.
- **Nutrition enrichment**: Calorie data comes from Uber Eats only; no external nutrition APIs.
- **Image validation**: Image URLs are passed through without accessibility checks.
- **Multi-location handling**: Each store URL is processed independently.
- **Rate limiting/scheduling**: No built-in scheduling or rate limiting.
- **Database ingestion**: Pipeline outputs JSON files only; D1 ingestion is separate.

## Technical Notes

- **Uber Eats v1 (DOM-based)**: Uses Playwright to render the page and extract from DOM elements. Not API-based.
- **Geolocation required**: Uber Eats requires a delivery address context. Scraper uses Miami, FL coordinates.
- **Auto-scroll**: Lazy-loaded content is captured via automatic scrolling.
- **Deterministic**: Same input URL produces identical output (excluding timestamps).
- **No dependencies beyond Node.js + Playwright**: All processing is native JavaScript.

## Version

**Pipeline Version:** Uber Eats Ingestion v1 (DOM-based)
**Status:** Production-ready for supported restaurant types
