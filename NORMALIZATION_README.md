# Menu Normalization - Documentation

## Overview

`normalizeMenu.cjs` transforms raw Uber Eats scraped data (`uber_menu_extracted.json`) into a standardized format (`normalized_menu.json`) suitable for downstream processing.

## Usage

```bash
node normalizeMenu.cjs [input_file] [output_file]

# Default:
node normalizeMenu.cjs
# Reads: uber_menu_extracted.json
# Writes: normalized_menu.json
```

## Output Format

```json
{
  "restaurant": {
    "name": "Restaurant Name",
    "source_url": "https://...",
    "source": "ubereats"
  },
  "items": [
    {
      "canonical_category": "mains",
      "source": "ubereats",
      "source_id": "uuid-from-uber",
      "name": "Normalized Item Name",
      "price_cents": 1299,
      "calories": {
        "raw": "530-790",
        "min": 530,
        "max": 790
      },
      "image_url": "https://...",
      "confidence_score": 1.0
    }
  ],
  "normalization_warnings": [],
  "meta": {
    "input_items": 18,
    "output_items": 18,
    "filtered_items": 0,
    "normalized_at": "ISO timestamp",
    "source_file": "uber_menu_extracted.json"
  }
}
```

## Canonical Categories

Items are mapped to one of 8 canonical categories:

| Category | Keywords/Patterns |
|----------|-------------------|
| `appetizers` | appetizer, starter, small plate, snack, shareables |
| `mains` | burger, sandwich, wrap, taco, bowl, plate, chicken, beef, pasta, pizza |
| `sides` | side, fries, onion ring, salad, soup, bread |
| `desserts` | shake, milkshake, cookie, brownie, sundae, ice cream, cake, pie |
| `drinks` | drink, beverage, coffee, tea, soda, juice, water, lemonade |
| `combos` | combo, meal, bundle, value, box, family, pack |
| `kids` | kid, child, junior, little |
| `catering` | catering, large order, party, tray |

**Default:** Items that don't match any pattern are assigned to `mains`.

## Normalization Rules

### Name Normalization
- Trimmed whitespace
- Title Case applied
- Emojis removed
- Multiple spaces collapsed
- Trademark symbols (® ™) preserved

### Price Normalization
- Converted to integer cents (`$12.99` → `1299`)
- Handles both numeric and string inputs
- `null` if price unavailable

### Calorie Parsing
- Single values: `"940"` → `{ raw: "940", min: 940, max: 940 }`
- Ranges: `"530-790"` → `{ raw: "530-790", min: 530, max: 790 }`
- Preserves original string in `raw` field

### Non-Food Filtering
Items matching these patterns are removed:
- Utensils, napkins, straws, cutlery
- Bags, packaging
- Fees, tips, delivery charges
- Promo codes, coupons, discounts
- Gift cards
- Merchandise (t-shirts, hats)
- Kitchen tools (graters, cutters)

## Confidence Score

Score from 0.0 to 1.0 based on field completeness:

| Field | Weight |
|-------|--------|
| Name (valid) | 3 |
| Price (> $0) | 2 |
| Image URL (valid) | 2 |
| Calories (present) | 1 |
| Source ID (valid UUID) | 2 |

**Formula:** `score / 10`

## Assumptions

1. **Single Category Assignment:** Each item belongs to exactly ONE canonical category. First matching rule wins.

2. **Category Priority:** Item name patterns take precedence over section name patterns.

3. **Default Category:** Unclassifiable items default to `mains` (most common category).

4. **Price in USD:** All prices assumed to be in USD cents.

5. **Image URLs Preserved:** Image URLs are passed through unchanged (no validation of accessibility).

6. **Calorie Format:** Expects Uber Eats format (single number or "min-max" range).

## Known Limitations

1. **Category Accuracy:** Category detection is keyword-based and may misclassify ambiguous items (e.g., "Chicken Sandwich Combo" could be `mains` or `combos`).

2. **No Description Handling:** Item descriptions from the source are not included in normalized output.

3. **No Rating Data:** Rating/popularity data from source is not preserved.

4. **Regional Variations:** Menu items with regional naming may not categorize correctly.

5. **Combo Detection:** Items with "meal" in the name are classified as combos even if purchased individually.

6. **Drink Shakes:** Milkshakes are classified as `desserts` not `drinks` (this is intentional but debatable).

## Warnings

The `normalization_warnings` array captures:
- `filtered_non_food`: Items removed as non-food
- `filtered_invalid_name`: Items with empty names after normalization
- `missing_price`: Items without price data
- `missing_image`: Items without image URLs

## Example

**Input (uber_menu_extracted.json):**
```json
{
  "sections": [{
    "name": "Featured items",
    "items": [{
      "item_id": "abc-123",
      "name": "ShackBurger",
      "price": 10.09,
      "calories": "530-790",
      "image_url": "https://..."
    }]
  }]
}
```

**Output (normalized_menu.json):**
```json
{
  "items": [{
    "canonical_category": "mains",
    "source": "ubereats",
    "source_id": "abc-123",
    "name": "Shackburger",
    "price_cents": 1009,
    "calories": { "raw": "530-790", "min": 530, "max": 790 },
    "image_url": "https://...",
    "confidence_score": 1.0
  }]
}
```
