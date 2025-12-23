-- ============================================
-- Recipe Cache Schema
-- Migration 0012
--
-- Stores base recipes for common dishes to avoid
-- repeated API calls. Vision/description can add
-- extra ingredients that get merged at runtime.
-- ============================================

-- Cached base recipes for common dishes
CREATE TABLE IF NOT EXISTS cached_recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Dish identification (normalized for matching)
    dish_name_normalized TEXT NOT NULL,
    dish_name_display TEXT NOT NULL,

    -- Recipe data
    ingredients_json TEXT NOT NULL, -- JSON array of ingredient objects
    servings INTEGER DEFAULT 1,

    -- Pre-computed nutrition (per serving)
    calories_kcal REAL,
    protein_g REAL,
    carbs_g REAL,
    fat_g REAL,
    fiber_g REAL,
    sugar_g REAL,
    sodium_mg REAL,

    -- Pre-computed flags
    allergen_flags_json TEXT, -- JSON array: ["dairy", "gluten", ...]
    fodmap_flags_json TEXT,   -- JSON array: ["high_fructan", ...]
    diet_tags_json TEXT,      -- JSON array: ["vegetarian", "keto", ...]

    -- Metadata
    source TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'edamam', 'spoonacular', 'openai', 'user_verified'
    confidence REAL DEFAULT 0.8,
    times_used INTEGER DEFAULT 0,
    last_used_at TEXT,

    -- Quality tracking
    user_rating_sum INTEGER DEFAULT 0,
    user_rating_count INTEGER DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(dish_name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_cached_recipes_name ON cached_recipes(dish_name_normalized);
CREATE INDEX IF NOT EXISTS idx_cached_recipes_times_used ON cached_recipes(times_used DESC);

-- Recipe ingredients detail (for richer lookups)
CREATE TABLE IF NOT EXISTS cached_recipe_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES cached_recipes(id) ON DELETE CASCADE,

    ingredient_name TEXT NOT NULL,
    ingredient_id INTEGER REFERENCES ingredients(id), -- Link to Super Brain if matched

    quantity REAL,
    unit TEXT,
    preparation TEXT, -- "diced", "minced", etc.

    -- Per-ingredient nutrition (optional, for precise calculations)
    calories_kcal REAL,
    protein_g REAL,
    carbs_g REAL,
    fat_g REAL,

    -- Flags this ingredient contributes
    allergen_codes TEXT, -- JSON array: ["dairy", "gluten"]
    fodmap_category TEXT, -- "low", "moderate", "high"

    is_optional INTEGER DEFAULT 0,
    is_garnish INTEGER DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON cached_recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_name ON cached_recipe_ingredients(ingredient_name);

-- Recipe variations/aliases (same dish, different names)
CREATE TABLE IF NOT EXISTS recipe_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES cached_recipes(id) ON DELETE CASCADE,
    alias_normalized TEXT NOT NULL,
    alias_display TEXT NOT NULL,
    region TEXT, -- "italian", "american", etc.

    UNIQUE(alias_normalized)
);

CREATE INDEX IF NOT EXISTS idx_recipe_aliases_alias ON recipe_aliases(alias_normalized);

-- Vision detection log (for learning what extras are common)
CREATE TABLE IF NOT EXISTS recipe_vision_extras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES cached_recipes(id) ON DELETE CASCADE,

    extra_ingredient TEXT NOT NULL,
    detection_source TEXT NOT NULL, -- 'fatsecret_image', 'menu_description', 'user_input'
    times_detected INTEGER DEFAULT 1,

    -- Should this become part of the base recipe?
    promoted_to_base INTEGER DEFAULT 0,

    first_detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_detected_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(recipe_id, extra_ingredient, detection_source)
);

CREATE INDEX IF NOT EXISTS idx_vision_extras_recipe ON recipe_vision_extras(recipe_id);
