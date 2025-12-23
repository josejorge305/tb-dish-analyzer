-- ============================================
-- Food Ontology Tables (Based on FoodOn/LanguaL)
-- Migration 0011
-- ============================================

-- Food Categories (top-level classification)
CREATE TABLE IF NOT EXISTS food_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_code TEXT UNIQUE NOT NULL,
    category_name TEXT NOT NULL,
    parent_code TEXT REFERENCES food_categories(category_code),
    description TEXT,
    foodon_id TEXT, -- FoodOn ontology ID if available
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_food_cat_parent ON food_categories(parent_code);
CREATE INDEX IF NOT EXISTS idx_food_cat_code ON food_categories(category_code);

-- Ingredient to Category mapping
CREATE TABLE IF NOT EXISTS ingredient_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    category_code TEXT NOT NULL REFERENCES food_categories(category_code),
    confidence REAL DEFAULT 1.0,
    source TEXT NOT NULL DEFAULT 'curated',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(ingredient_id, category_code)
);

CREATE INDEX IF NOT EXISTS idx_ing_cat_ingredient ON ingredient_categories(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_ing_cat_category ON ingredient_categories(category_code);

-- Cooking Methods and their effects
CREATE TABLE IF NOT EXISTS cooking_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method_code TEXT UNIQUE NOT NULL,
    method_name TEXT NOT NULL,
    description TEXT,
    -- Nutrient retention factors (1.0 = no change, <1 = loss, >1 = concentration)
    vitamin_c_retention REAL DEFAULT 1.0,
    vitamin_b_retention REAL DEFAULT 1.0,
    mineral_retention REAL DEFAULT 1.0,
    protein_digestibility REAL DEFAULT 1.0,
    -- Effects on bioactives
    antioxidant_effect TEXT CHECK(antioxidant_effect IN ('preserved', 'reduced', 'enhanced', 'variable')),
    -- Glycemic impact
    gi_effect TEXT CHECK(gi_effect IN ('unchanged', 'increased', 'decreased')),
    -- General notes
    health_notes TEXT,
    langual_code TEXT, -- LanguaL thesaurus code if available
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ingredient to Cooking Method effects
CREATE TABLE IF NOT EXISTS ingredient_cooking_effects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    method_code TEXT NOT NULL REFERENCES cooking_methods(method_code),
    -- Specific effects for this ingredient + method
    nutrient_change_pct REAL, -- Overall nutrient change %
    bioavailability_change TEXT CHECK(bioavailability_change IN ('decreased', 'unchanged', 'increased', 'greatly_increased')),
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'curated',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(ingredient_id, method_code)
);

CREATE INDEX IF NOT EXISTS idx_cook_effect_ingredient ON ingredient_cooking_effects(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_cook_effect_method ON ingredient_cooking_effects(method_code);

-- Food Processing Levels (NOVA-inspired but more detailed)
CREATE TABLE IF NOT EXISTS processing_levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level_code TEXT UNIQUE NOT NULL,
    level_name TEXT NOT NULL,
    nova_equivalent INTEGER CHECK(nova_equivalent BETWEEN 1 AND 4),
    description TEXT,
    health_impact TEXT CHECK(health_impact IN ('positive', 'neutral', 'caution', 'negative')),
    examples TEXT, -- JSON array of example foods
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Food Tags (flexible tagging system)
CREATE TABLE IF NOT EXISTS food_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_code TEXT UNIQUE NOT NULL,
    tag_name TEXT NOT NULL,
    tag_category TEXT NOT NULL, -- 'dietary', 'origin', 'preparation', 'season', 'texture'
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredient_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    tag_code TEXT NOT NULL REFERENCES food_tags(tag_code),
    source TEXT NOT NULL DEFAULT 'curated',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(ingredient_id, tag_code)
);

CREATE INDEX IF NOT EXISTS idx_ing_tags_ingredient ON ingredient_tags(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_ing_tags_tag ON ingredient_tags(tag_code);
