-- Migration 0007: Add ingredient_nutrients and ingredient_sources tables
-- Supports bulk USDA/OFF data seeding with full nutrient vectors and provenance tracking

--------------------------------------------------------------------------------
-- INGREDIENT NUTRIENTS (sparse nutrient vectors per 100g)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ingredient_nutrients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),

    -- Nutrient identification (USDA nutrient numbers)
    nutrient_id INTEGER NOT NULL,           -- e.g., 1008 = Energy, 1003 = Protein
    nutrient_name TEXT NOT NULL,            -- e.g., 'Energy', 'Protein'

    -- Value per 100g of ingredient
    amount REAL NOT NULL,
    unit TEXT NOT NULL,                     -- 'kcal', 'g', 'mg', 'mcg', 'IU'

    -- Provenance
    source TEXT NOT NULL DEFAULT 'usda_fdc', -- 'usda_fdc', 'open_food_facts', 'manual'
    source_id TEXT,                          -- e.g., fdc_id or OFF barcode

    -- Versioning
    data_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0,

    UNIQUE(ingredient_id, nutrient_id, source)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_nutrients_ingredient ON ingredient_nutrients(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_nutrients_nutrient ON ingredient_nutrients(nutrient_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_nutrients_source ON ingredient_nutrients(source);

--------------------------------------------------------------------------------
-- INGREDIENT SOURCES (provenance tracking for each ingredient)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ingredient_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),

    -- Source identification
    source TEXT NOT NULL,                   -- 'usda_fdc', 'open_food_facts', 'foodon', 'langual', 'manual'
    source_id TEXT NOT NULL,                -- e.g., fdc_id, barcode, ontology URI
    source_name TEXT,                       -- Original name from source
    source_url TEXT,                        -- Direct link to source record

    -- Data quality
    confidence REAL DEFAULT 1.0,            -- 0-1 confidence in this source
    is_primary INTEGER NOT NULL DEFAULT 0,  -- 1 = primary source for this ingredient

    -- What data came from this source
    contributed_fields TEXT,                -- JSON: ["nutrients", "allergens", "synonyms"]

    -- Timestamps
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    data_version INTEGER NOT NULL DEFAULT 1,
    is_deleted INTEGER NOT NULL DEFAULT 0,

    UNIQUE(ingredient_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_ingredient_sources_ingredient ON ingredient_sources(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_sources_source ON ingredient_sources(source);
CREATE INDEX IF NOT EXISTS idx_ingredient_sources_primary ON ingredient_sources(is_primary) WHERE is_primary = 1;

--------------------------------------------------------------------------------
-- COMMON NUTRIENT IDS (USDA FDC nutrient numbers for reference)
-- Not a table, just documentation for the nutrient_id values:
--
-- 1008 = Energy (kcal)
-- 1003 = Protein (g)
-- 1004 = Total lipid/fat (g)
-- 1005 = Carbohydrate, by difference (g)
-- 2000 = Sugars, total (g)
-- 1079 = Fiber, total dietary (g)
-- 1093 = Sodium (mg)
-- 1087 = Calcium (mg)
-- 1089 = Iron (mg)
-- 1090 = Magnesium (mg)
-- 1091 = Phosphorus (mg)
-- 1092 = Potassium (mg)
-- 1095 = Zinc (mg)
-- 1098 = Copper (mg)
-- 1103 = Selenium (mcg)
-- 1106 = Vitamin A (IU)
-- 1162 = Vitamin C (mg)
-- 1109 = Vitamin E (mg)
-- 1114 = Vitamin D (IU)
-- 1165 = Thiamin/B1 (mg)
-- 1166 = Riboflavin/B2 (mg)
-- 1167 = Niacin/B3 (mg)
-- 1175 = Vitamin B6 (mg)
-- 1177 = Folate (mcg)
-- 1178 = Vitamin B12 (mcg)
--------------------------------------------------------------------------------

-- Log this migration
INSERT INTO audit_log (action, target_table, actor, details) VALUES
('MIGRATION_0007', NULL, 'migration', '{"description": "Add ingredient_nutrients and ingredient_sources tables for bulk USDA/OFF seeding", "tables_created": ["ingredient_nutrients", "ingredient_sources"]}');
