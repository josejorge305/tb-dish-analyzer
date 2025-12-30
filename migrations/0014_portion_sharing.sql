-- ============================
-- Portion & Sharing System
-- Enables detailed portion tracking for meal logging
-- ============================

-- Add portion tracking columns to logged_meals
ALTER TABLE logged_meals ADD COLUMN portion_percent INTEGER DEFAULT 100;
ALTER TABLE logged_meals ADD COLUMN portion_multiplier REAL DEFAULT 1.0;
ALTER TABLE logged_meals ADD COLUMN shared_with_count INTEGER;
ALTER TABLE logged_meals ADD COLUMN leftovers_saved INTEGER DEFAULT 0;
ALTER TABLE logged_meals ADD COLUMN portion_mode TEXT CHECK (portion_mode IN (
    'preset',      -- User selected preset (All, Most, Half, Few bites)
    'custom',      -- User used slider
    'shared',      -- User enabled shared toggle
    'leftovers',   -- User enabled leftovers toggle
    'count'        -- Future: count-based (e.g., 3 of 6 wings)
));

-- Baseline values (full serving, before portion scaling)
-- These allow recalculation when portion is edited
ALTER TABLE logged_meals ADD COLUMN baseline_calories INTEGER;
ALTER TABLE logged_meals ADD COLUMN baseline_protein_g REAL;
ALTER TABLE logged_meals ADD COLUMN baseline_carbs_g REAL;
ALTER TABLE logged_meals ADD COLUMN baseline_fat_g REAL;
ALTER TABLE logged_meals ADD COLUMN baseline_fiber_g REAL;
ALTER TABLE logged_meals ADD COLUMN baseline_sugar_g REAL;
ALTER TABLE logged_meals ADD COLUMN baseline_sodium_mg REAL;
ALTER TABLE logged_meals ADD COLUMN baseline_organ_impacts TEXT;  -- JSON

-- Count-based tracking (for future use)
ALTER TABLE logged_meals ADD COLUMN count_eaten INTEGER;
ALTER TABLE logged_meals ADD COLUMN count_total INTEGER;

-- Update existing rows to have sensible defaults
UPDATE logged_meals SET
    portion_percent = CAST(COALESCE(portion_factor, 1.0) * 100 AS INTEGER),
    portion_multiplier = COALESCE(portion_factor, 1.0),
    portion_mode = 'preset'
WHERE portion_percent IS NULL;

-- Backfill baseline values from current values (assuming they were logged at 100%)
-- This is a best-effort migration - new logs will have accurate baselines
UPDATE logged_meals SET
    baseline_calories = CAST(calories / COALESCE(portion_factor, 1.0) AS INTEGER),
    baseline_protein_g = protein_g / COALESCE(portion_factor, 1.0),
    baseline_carbs_g = carbs_g / COALESCE(portion_factor, 1.0),
    baseline_fat_g = fat_g / COALESCE(portion_factor, 1.0),
    baseline_fiber_g = fiber_g / COALESCE(portion_factor, 1.0),
    baseline_sugar_g = sugar_g / COALESCE(portion_factor, 1.0),
    baseline_sodium_mg = sodium_mg / COALESCE(portion_factor, 1.0),
    baseline_organ_impacts = organ_impacts
WHERE baseline_calories IS NULL AND calories IS NOT NULL;
