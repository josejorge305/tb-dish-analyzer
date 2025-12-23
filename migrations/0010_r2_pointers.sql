-- Migration 0010: Add R2 pointer columns for large payloads
-- Implements R2-as-source-of-truth pattern
-- D1 stores only normalized data + R2 object keys

-- Add R2 key columns to recipes table (for large JSON payloads)
ALTER TABLE recipes ADD COLUMN r2_ingredients_key TEXT;
ALTER TABLE recipes ADD COLUMN r2_recipe_key TEXT;
ALTER TABLE recipes ADD COLUMN r2_compounds_key TEXT;

-- Add R2 key column to logged_meals for full_analysis (the largest payload)
ALTER TABLE logged_meals ADD COLUMN r2_analysis_key TEXT;

-- Index for R2 key lookups (optional, for debugging/cleanup)
CREATE INDEX IF NOT EXISTS idx_recipes_r2_ingredients ON recipes(r2_ingredients_key) WHERE r2_ingredients_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logged_meals_r2_analysis ON logged_meals(r2_analysis_key) WHERE r2_analysis_key IS NOT NULL;

-- Migration complete: 0010_r2_pointers
