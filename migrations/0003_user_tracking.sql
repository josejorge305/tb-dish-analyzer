-- ============================
-- User Tracking & Personalization Schema
-- Enables meal logging, organ priorities, personalized targets
-- ============================

-- ============================================
-- USER PROFILES (Core identity & body metrics)
-- ============================================
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,

    -- Body Metrics
    biological_sex TEXT CHECK (biological_sex IN ('male', 'female')),
    date_of_birth TEXT,                    -- ISO date string YYYY-MM-DD
    height_cm REAL,                        -- Always store metric
    current_weight_kg REAL,                -- Latest weight (denormalized)
    activity_level TEXT CHECK (activity_level IN (
        'sedentary',      -- BMR × 1.2
        'light',          -- BMR × 1.375
        'moderate',       -- BMR × 1.55
        'active',         -- BMR × 1.725
        'very_active'     -- BMR × 1.9
    )) DEFAULT 'moderate',

    -- Calculated fields (updated when inputs change)
    bmr_kcal REAL,                         -- Basal Metabolic Rate
    tdee_kcal REAL,                        -- Total Daily Energy Expenditure

    -- Display preferences
    unit_system TEXT DEFAULT 'imperial' CHECK (unit_system IN ('imperial', 'metric')),

    -- Goal
    primary_goal TEXT CHECK (primary_goal IN (
        'lose_weight',
        'maintain',
        'build_muscle',
        'gut_health',
        'reduce_inflammation'
    )) DEFAULT 'maintain',

    -- Timestamps
    created_at INTEGER DEFAULT (strftime('%s','now')),
    updated_at INTEGER DEFAULT (strftime('%s','now')),
    profile_completed_at INTEGER           -- NULL until first save
);

-- ============================================
-- WEIGHT HISTORY (Track changes over time)
-- ============================================
CREATE TABLE IF NOT EXISTS weight_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    recorded_at INTEGER DEFAULT (strftime('%s','now')),
    source TEXT DEFAULT 'manual' CHECK (source IN (
        'manual',
        'apple_health',
        'whoop',
        'withings',
        'google_fit'
    )),

    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_weight_history_user_date
    ON weight_history(user_id, recorded_at DESC);

-- ============================================
-- ALLERGEN DEFINITIONS (Static lookup table)
-- ============================================
CREATE TABLE IF NOT EXISTS allergen_definitions (
    allergen_code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'fda_top_9',      -- FDA major allergens
        'digestive',      -- Lactose, FODMAP, etc.
        'condition'       -- Hypertension, prediabetes
    )),
    description TEXT,
    threshold_modifier TEXT                -- JSON: how this affects nutrient thresholds
);

-- Seed allergen definitions
INSERT OR IGNORE INTO allergen_definitions VALUES
    ('peanut', 'Peanut', 'fda_top_9', 'Peanut allergy', NULL),
    ('tree_nuts', 'Tree Nuts', 'fda_top_9', 'Tree nut allergy (almonds, walnuts, etc.)', NULL),
    ('dairy', 'Dairy', 'fda_top_9', 'Milk and dairy products', NULL),
    ('eggs', 'Eggs', 'fda_top_9', 'Egg allergy', NULL),
    ('wheat', 'Wheat', 'fda_top_9', 'Wheat allergy', NULL),
    ('soy', 'Soy', 'fda_top_9', 'Soybean allergy', NULL),
    ('shellfish', 'Shellfish', 'fda_top_9', 'Shellfish allergy (shrimp, crab, lobster)', NULL),
    ('fish', 'Fish', 'fda_top_9', 'Fish allergy', NULL),
    ('sesame', 'Sesame', 'fda_top_9', 'Sesame allergy', NULL),
    ('lactose', 'Lactose Intolerance', 'digestive', 'Difficulty digesting lactose', NULL),
    ('gluten', 'Gluten Sensitivity', 'digestive', 'Non-celiac gluten sensitivity', NULL),
    ('fodmap', 'IBS / FODMAP Sensitive', 'digestive', 'Fermentable carbohydrate sensitivity', '{"fodmap_limit_g": 12}'),
    ('celiac', 'Celiac Disease', 'digestive', 'Autoimmune gluten disorder', NULL),
    ('hypertension', 'Hypertension', 'condition', 'High blood pressure - lower sodium threshold', '{"sodium_limit_mg": 1500}'),
    ('prediabetes', 'Prediabetes', 'condition', 'Insulin resistance - stricter sugar limits', '{"sugar_limit_g": 25}'),
    ('gout', 'Gout', 'condition', 'Uric acid sensitivity - flag purines', '{"purine_flag": true}');

-- ============================================
-- USER ALLERGENS (Selected allergens/sensitivities)
-- ============================================
CREATE TABLE IF NOT EXISTS user_allergens (
    user_id TEXT NOT NULL,
    allergen_code TEXT NOT NULL,
    severity TEXT DEFAULT 'avoid' CHECK (severity IN (
        'avoid',          -- Complete avoidance (allergy)
        'limit',          -- Reduce exposure (sensitivity)
        'monitor'         -- Track but don't flag
    )),
    created_at INTEGER DEFAULT (strftime('%s','now')),

    PRIMARY KEY (user_id, allergen_code),
    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE,
    FOREIGN KEY (allergen_code) REFERENCES allergen_definitions(allergen_code)
);

-- ============================================
-- USER ORGAN PRIORITIES
-- ============================================
CREATE TABLE IF NOT EXISTS user_organ_priorities (
    user_id TEXT NOT NULL,
    organ_code TEXT NOT NULL,              -- e.g., 'gut', 'heart', 'liver'
    priority_rank INTEGER,                 -- 1 = highest priority, NULL = not prioritized
    is_starred INTEGER DEFAULT 0,          -- 1 = starred/emphasized
    created_at INTEGER DEFAULT (strftime('%s','now')),

    PRIMARY KEY (user_id, organ_code),
    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);

-- ============================================
-- USER DAILY TARGETS (Calculated, cached)
-- ============================================
CREATE TABLE IF NOT EXISTS user_daily_targets (
    user_id TEXT PRIMARY KEY,

    -- Energy
    calories_target INTEGER,               -- kcal
    calories_min INTEGER,                  -- Floor (safety)
    calories_max INTEGER,                  -- Ceiling

    -- Macros
    protein_target_g INTEGER,
    protein_min_g INTEGER,
    carbs_target_g INTEGER,
    fat_target_g INTEGER,
    fiber_target_g INTEGER,

    -- Limits (not targets, but thresholds)
    sugar_limit_g INTEGER,
    sodium_limit_mg INTEGER,
    saturated_fat_limit_g INTEGER,

    -- Condition-specific
    fodmap_limit_g INTEGER,                -- Only if FODMAP sensitive
    purine_flag INTEGER DEFAULT 0,         -- Only if gout
    glycemic_emphasis INTEGER DEFAULT 0,   -- Only if prediabetes

    -- Metadata
    calculation_basis TEXT,                -- JSON: inputs used for calculation
    calculated_at INTEGER DEFAULT (strftime('%s','now')),

    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);

-- ============================================
-- LOGGED MEALS
-- ============================================
CREATE TABLE IF NOT EXISTS logged_meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,

    -- Dish reference
    dish_id TEXT,                          -- If from our DB
    dish_name TEXT NOT NULL,               -- Denormalized for display
    restaurant_name TEXT,

    -- Timing
    logged_at INTEGER DEFAULT (strftime('%s','now')),
    meal_date TEXT NOT NULL,               -- ISO date YYYY-MM-DD for daily grouping
    meal_type TEXT CHECK (meal_type IN (
        'breakfast', 'lunch', 'dinner', 'snack'
    )),

    -- Portion
    portion_factor REAL DEFAULT 1.0,       -- 0.5, 1.0, 1.5, 2.0

    -- Nutrition snapshot (scaled by portion)
    calories INTEGER,
    protein_g REAL,
    carbs_g REAL,
    fat_g REAL,
    fiber_g REAL,
    sugar_g REAL,
    sodium_mg REAL,

    -- Organ impacts snapshot (scaled by portion, personalized)
    organ_impacts TEXT,                    -- JSON: {"gut": 12, "heart": -8, ...}

    -- Flags triggered
    risk_flags TEXT,                       -- JSON: ["high_sodium", "allergen_dairy"]

    -- Analysis metadata
    analysis_confidence REAL,              -- 0-1 confidence score
    analysis_version TEXT,                 -- Pipeline version used

    -- Full analysis cache (for viewing details)
    full_analysis TEXT,                    -- JSON: complete dish analysis

    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_logged_meals_user_date
    ON logged_meals(user_id, meal_date DESC);
CREATE INDEX IF NOT EXISTS idx_logged_meals_date
    ON logged_meals(meal_date);

-- ============================================
-- MEAL SYMPTOM FEEDBACK (Decoupled from logging)
-- ============================================
CREATE TABLE IF NOT EXISTS meal_symptom_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,

    -- Symptoms (1 = present, 0 = not present)
    bloating INTEGER DEFAULT 0,
    reflux INTEGER DEFAULT 0,
    diarrhea INTEGER DEFAULT 0,
    constipation INTEGER DEFAULT 0,
    cramping INTEGER DEFAULT 0,
    nausea INTEGER DEFAULT 0,

    -- Timing
    symptom_onset_hours REAL,              -- Hours after meal
    notes TEXT,

    recorded_at INTEGER DEFAULT (strftime('%s','now')),

    FOREIGN KEY (meal_id) REFERENCES logged_meals(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_symptom_feedback_meal
    ON meal_symptom_feedback(meal_id);

-- ============================================
-- DAILY SUMMARIES (Aggregated for fast Tracker rendering)
-- ============================================
CREATE TABLE IF NOT EXISTS daily_summaries (
    user_id TEXT NOT NULL,
    summary_date TEXT NOT NULL,            -- ISO date YYYY-MM-DD

    -- Totals
    total_calories INTEGER DEFAULT 0,
    total_protein_g REAL DEFAULT 0,
    total_carbs_g REAL DEFAULT 0,
    total_fat_g REAL DEFAULT 0,
    total_fiber_g REAL DEFAULT 0,
    total_sugar_g REAL DEFAULT 0,
    total_sodium_mg REAL DEFAULT 0,

    -- Meal count
    meals_logged INTEGER DEFAULT 0,

    -- Net organ impacts for the day
    organ_impacts_net TEXT,                -- JSON: {"gut": 18, "heart": -12, ...}

    -- Flags summary
    flags_triggered TEXT,                  -- JSON: ["high_sodium", "exceeded_sugar"]

    -- Insight (generated)
    daily_insight TEXT,

    -- Metadata
    last_updated_at INTEGER DEFAULT (strftime('%s','now')),

    PRIMARY KEY (user_id, summary_date)
);

-- ============================================
-- SAVED DISHES (User favorites)
-- ============================================
CREATE TABLE IF NOT EXISTS saved_dishes (
    user_id TEXT NOT NULL,
    dish_id TEXT NOT NULL,

    -- Denormalized for display
    dish_name TEXT NOT NULL,
    restaurant_name TEXT,

    -- Stats from when saved (or most recent analysis)
    avg_calories INTEGER,
    nutrition_snapshot TEXT,               -- JSON
    organ_impacts_snapshot TEXT,           -- JSON
    risk_flags TEXT,                       -- JSON

    -- User notes
    personal_notes TEXT,
    tolerance_notes TEXT,                  -- From symptom feedback

    -- Timestamps
    saved_at INTEGER DEFAULT (strftime('%s','now')),
    last_logged_at INTEGER,
    times_logged INTEGER DEFAULT 0,

    PRIMARY KEY (user_id, dish_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_dishes_user
    ON saved_dishes(user_id);

-- ============================================
-- CONNECTED APPS (Future integrations)
-- ============================================
CREATE TABLE IF NOT EXISTS user_connected_apps (
    user_id TEXT NOT NULL,
    app_code TEXT NOT NULL CHECK (app_code IN (
        'apple_health',
        'google_fit',
        'whoop',
        'oura',
        'garmin',
        'fitbit',
        'withings'
    )),

    -- OAuth tokens (encrypted in production)
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at INTEGER,

    -- Sync state
    last_sync_at INTEGER,
    sync_enabled INTEGER DEFAULT 1,
    permissions TEXT,                      -- JSON: what data we can access

    connected_at INTEGER DEFAULT (strftime('%s','now')),

    PRIMARY KEY (user_id, app_code),
    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);
