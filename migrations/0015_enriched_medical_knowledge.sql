-- ============================
-- Enriched Medical Knowledge Schema
-- ============================
-- Adds mechanism explanations, pathways, citations, and dose-response data
-- to enable "smart doctor" level reasoning without sacrificing speed

-- NOTE: ALTER TABLE statements below are commented out because these columns
-- already exist in production. SQLite doesn't support IF NOT EXISTS for ADD COLUMN.
-- The CREATE TABLE and CREATE INDEX statements use IF NOT EXISTS and are safe to re-run.

-- Enhance compounds table with category and mechanism summary
-- (Already applied - columns exist)
-- ALTER TABLE compounds ADD COLUMN category TEXT;
-- ALTER TABLE compounds ADD COLUMN mechanism_summary TEXT;

-- Enhance compound_organ_effects with medical reasoning
-- (Already applied - columns exist)
-- ALTER TABLE compound_organ_effects ADD COLUMN mechanism TEXT;
-- ALTER TABLE compound_organ_effects ADD COLUMN pathway TEXT;
-- ALTER TABLE compound_organ_effects ADD COLUMN explanation TEXT;
-- ALTER TABLE compound_organ_effects ADD COLUMN citations TEXT;
-- ALTER TABLE compound_organ_effects ADD COLUMN threshold_mg REAL;
-- ALTER TABLE compound_organ_effects ADD COLUMN optimal_mg REAL;
-- ALTER TABLE compound_organ_effects ADD COLUMN upper_limit_mg REAL;
-- ALTER TABLE compound_organ_effects ADD COLUMN dose_response TEXT;
-- ALTER TABLE compound_organ_effects ADD COLUMN population_notes TEXT;

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
CREATE INDEX IF NOT EXISTS idx_compounds_category ON compounds(category);
