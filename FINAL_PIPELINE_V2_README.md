# Menu Pipeline V2 — Multi-Source Adjudication

## Overview

Pipeline V2 extends V1 by adding multi-source menu adjudication: it scrapes the restaurant's official website, reconciles those items against the Uber Eats menu from V1, and produces a merged menu with confidence scoring and drift detection. When both sources agree on an item, V2 merges the best attributes (Uber's pricing/images + website's descriptions); when sources conflict or items appear in only one source, V2 flags them for review and computes an overall confidence score to guide publish decisions.

## How V2 Differs from V1

| Aspect | V1 | V2 |
|--------|----|----|
| **Data Sources** | Uber Eats only | Uber Eats + Restaurant Website |
| **Menu Extraction** | Apify DOM scraping | V1 output + static HTML/PDF scraping |
| **Item Matching** | None (single source) | AI-powered (GPT-4o-mini) or Jaccard similarity fallback |
| **Conflict Resolution** | N/A | Source priority rules with merge logic |
| **Quality Signal** | Validation only | Confidence scoring (0–100%) |
| **Drift Detection** | Manual diff | Automated added/removed/price-change tracking |
| **Output** | `published_menu.json` | `adjudicated_menu.json` + `menu_confidence_report.json` |

## When V2 Should Override V1

Use V2's `adjudicated_menu.json` instead of V1's `published_menu.json` when:

1. **Confidence score >= 70%** — High agreement between sources; safe to publish
2. **Website has authoritative data** — Official prices, descriptions, or items not on Uber
3. **Uber menu is stale** — Website shows newer items or price changes

Fallback to V1 when:

1. **Confidence score < 40%** — Too much disagreement; V2 output unreliable
2. **Website scrape fails** — No JavaScript rendering support; static HTML yields nothing
3. **Restaurant has no website menu** — PDF-only or image-based menus not parseable

## Confidence Score Thresholds

| Score | Recommendation | Action |
|-------|----------------|--------|
| **>= 70%** | PUBLISH | Use `adjudicated_menu.json` directly |
| **40–69%** | PUBLISH WITH WARNING | Review flagged items before use |
| **< 40%** | FALLBACK TO V1 | Use `published_menu.json` from V1 |

### Confidence Formula

```
Base:     50%
+ Merged ratio bonus:    (merged_items / total_items) * 30%
+ Low flag ratio bonus:  (1 - flagged_items / total_items) * 20%
- Uber-only penalty:     -10% if uber_only_items > 50%
- Website-only penalty:  -10% if website_only_items > 50%
```

## Pipeline Steps

```
┌─────────────────────────────────────────────────────────────┐
│  V2 PIPELINE                                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  INPUT: published_menu.json (from V1)                       │
│         + Restaurant website URL                            │
│                                                             │
│  Step 1: websiteMenuScraper.cjs                             │
│          → website_menu_extracted.json                      │
│                                                             │
│  Step 2: menuJudge.cjs                                      │
│          → adjudicated_menu.json                            │
│                                                             │
│  Step 3: menuConfidence.cjs                                 │
│          → menu_confidence_report.json                      │
│                                                             │
│  OUTPUT: Confidence score + Publish recommendation          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Usage

```bash
# Requires V1 published_menu.json to exist first
node runMenuPipelineV2.cjs "https://www.restaurant.com/menu"

# With custom Uber menu path
node runMenuPipelineV2.cjs "https://www.restaurant.com/menu" custom_uber_menu.json
```

## Output Files

| File | Description |
|------|-------------|
| `website_menu_extracted.json` | Raw scrape from restaurant website |
| `adjudicated_menu.json` | Merged menu with source attribution |
| `menu_confidence_report.json` | Scoring + drift + metrics |

## Item Structure (adjudicated_menu.json)

```json
{
  "name": "Margherita Pizza",
  "description": "Fresh tomato, mozzarella, basil",
  "price_cents": 1499,
  "image_url": "https://...",
  "canonical_category": "mains",
  "source_decision": "merged",
  "sources": {
    "uber": { "name": "Margherita Pizza", "price_cents": 1499 },
    "website": { "name": "Margherita", "price": "14.99" }
  },
  "flags": []
}
```

### Source Decision Values

- `merged` — Found in both sources; attributes combined
- `uber` — Uber-only item; flagged `website_missing`
- `website` — Website-only item; flagged `uber_missing`

## Drift Detection

When comparing against a previous adjudicated menu:

```bash
node menuConfidence.cjs adjudicated_menu.json previous_adjudicated_menu.json
```

Drift severity levels:
- `none` — No changes detected
- `low` — < 15% items changed
- `medium` — 15–30% items changed
- `high` — > 30% items changed

## Out of Scope

The following are explicitly NOT supported in V2:

1. **JavaScript-rendered websites** — No headless browser; static HTML only
2. **Image-based menus** — No OCR support
3. **Complex PDF layouts** — Basic text extraction only; tables may fail
4. **Multi-location menus** — Single location per run
5. **Real-time price updates** — Snapshot-based, not live
6. **Automatic V1→V2 migration** — Manual decision required based on confidence
7. **Uber Eats network interception** — Proven non-viable (see uberCatalogScraper.cjs)

## File Inventory

| File | Purpose | Status |
|------|---------|--------|
| `websiteMenuScraper.cjs` | Static HTML/PDF menu extraction | FROZEN |
| `menuJudge.cjs` | AI-powered menu adjudication | FROZEN |
| `menuConfidence.cjs` | Confidence scoring + drift detection | FROZEN |
| `runMenuPipelineV2.cjs` | V2 orchestrator | FROZEN |
| `uberCatalogScraper.cjs` | Negative proof artifact | FROZEN |

## Dependencies

- Node.js built-ins only (`fs`, `https`, `http`, `path`, `child_process`)
- Optional: `OPENAI_API_KEY` env var for GPT-4o-mini matching (falls back to Jaccard)
- Requires: V1 `published_menu.json` as input

---

**V2 Pipeline: FROZEN**
**Last updated: 2026-01-04**
