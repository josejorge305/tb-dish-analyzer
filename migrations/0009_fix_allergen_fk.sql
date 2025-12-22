-- Migration 0009: Fix allergen foreign key schema bug
-- The ingredient_allergen_flags table incorrectly references allergen_definitions(id)
-- but allergen_definitions uses allergen_code TEXT as primary key

-- Drop the old table and recreate with correct schema
DROP TABLE IF EXISTS ingredient_allergen_flags;

-- Recreate with allergen_code reference instead of integer id
CREATE TABLE IF NOT EXISTS ingredient_allergen_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    allergen_code TEXT NOT NULL REFERENCES allergen_definitions(allergen_code),
    confidence TEXT NOT NULL DEFAULT 'likely' CHECK(confidence IN ('definite', 'likely', 'possible', 'cross_contact')),
    source TEXT, -- e.g., 'openfoodfacts', 'usda', 'manual'
    data_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    UNIQUE(ingredient_id, allergen_code)
);

CREATE INDEX IF NOT EXISTS idx_allergen_flags_ingredient ON ingredient_allergen_flags(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_allergen_flags_allergen ON ingredient_allergen_flags(allergen_code);

-- Record migration
INSERT OR IGNORE INTO schema_metadata (key, value, type, metadata)
VALUES ('MIGRATION_0009', NULL, 'migration', '{"description": "Fix allergen foreign key - use allergen_code TEXT instead of integer id"}');
