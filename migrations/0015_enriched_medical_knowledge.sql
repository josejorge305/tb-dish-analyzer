-- ============================
-- Enriched Medical Knowledge Schema
-- ============================
-- Adds mechanism explanations, pathways, citations, and dose-response data
-- to enable "smart doctor" level reasoning without sacrificing speed

-- NOTE: The ALTER TABLE statements have been removed because:
-- 1. SQLite doesn't support IF NOT EXISTS for ADD COLUMN
-- 2. D1 migrations fail if column already exists
-- 3. These columns should be added manually if needed via:
--    wrangler d1 execute tb-database --command "ALTER TABLE compounds ADD COLUMN category TEXT;"
--    (run only if column doesn't exist)

-- Compound interactions table (synergies and antagonisms)
CREATE TABLE IF NOT EXISTS compound_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compound_a_id INTEGER NOT NULL REFERENCES compounds(id),
  compound_b_id INTEGER NOT NULL REFERENCES compounds(id),
  interaction_type TEXT NOT NULL,   -- "synergy", "antagonism", "absorption_enhance", "absorption_block"
  effect_description TEXT,          -- Human-readable explanation
  mechanism TEXT,                   -- Scientific mechanism
  strength REAL DEFAULT 0.5,        -- 0-1 scale of interaction strength
  organs_affected TEXT,             -- JSON array of affected organs
  citations TEXT,
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Ingredient to compound mapping (which foods contain which compounds)
CREATE TABLE IF NOT EXISTS ingredient_compounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_pattern TEXT NOT NULL, -- Regex or LIKE pattern for ingredient matching
  compound_id INTEGER NOT NULL REFERENCES compounds(id),
  amount_per_100g REAL,             -- mg per 100g of ingredient
  variability TEXT,                 -- "low", "medium", "high" - natural variation
  notes TEXT,
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Cooking method effects on compounds
CREATE TABLE IF NOT EXISTS cooking_effects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compound_id INTEGER NOT NULL REFERENCES compounds(id),
  cooking_method TEXT NOT NULL,     -- "raw", "boiled", "steamed", "fried", "grilled", "baked"
  retention_factor REAL DEFAULT 1.0,-- 0-1, how much compound survives cooking
  notes TEXT,
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_compound_organ_effects_organ ON compound_organ_effects(organ);
CREATE INDEX IF NOT EXISTS idx_compound_interactions_a ON compound_interactions(compound_a_id);
CREATE INDEX IF NOT EXISTS idx_compound_interactions_b ON compound_interactions(compound_b_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_compounds_pattern ON ingredient_compounds(ingredient_pattern);
CREATE INDEX IF NOT EXISTS idx_cooking_effects_compound ON cooking_effects(compound_id);
-- Note: idx_compounds_category removed - category column not added in this migration
