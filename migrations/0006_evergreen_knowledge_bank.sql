-- Migration 0006: Evergreen Knowledge Bank + Resettable Menus
-- Layer A: Universal Knowledge Bank (append-only, versioned, never hard-deleted)
-- Layer B: Derived Building Blocks Cache (kept/grows/regenerable)
-- Layer C: Volatile Restaurant/Menu Data (resettable)
--
-- BACKWARD COMPATIBLE: No DROP TABLE, no breaking changes to existing endpoints

--------------------------------------------------------------------------------
-- LAYER A: Universal Knowledge Bank - Extensions to existing tables
--------------------------------------------------------------------------------

-- Extend compounds table with versioning (soft-delete pattern)
ALTER TABLE compounds ADD COLUMN data_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE compounds ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

-- Extend compound_organ_effects with versioning and evidence metadata
ALTER TABLE compound_organ_effects ADD COLUMN data_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE compound_organ_effects ADD COLUMN strength_0_1 REAL;
ALTER TABLE compound_organ_effects ADD COLUMN evidence_tier TEXT CHECK(evidence_tier IN ('clinical', 'preclinical', 'traditional', 'theoretical'));
ALTER TABLE compound_organ_effects ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

--------------------------------------------------------------------------------
-- LAYER A: New Ingredient Tables
--------------------------------------------------------------------------------

-- Core ingredients table (normalized, canonical names)
CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name TEXT NOT NULL UNIQUE,
    category TEXT, -- e.g., 'protein', 'vegetable', 'grain', 'dairy', 'spice'
    subcategory TEXT,
    data_version INTEGER NOT NULL DEFAULT 1,
    model_version TEXT NOT NULL DEFAULT 'v1',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ingredients_canonical ON ingredients(canonical_name);
CREATE INDEX IF NOT EXISTS idx_ingredients_category ON ingredients(category);
CREATE INDEX IF NOT EXISTS idx_ingredients_deleted ON ingredients(is_deleted) WHERE is_deleted = 0;

-- Ingredient synonyms for typo-tolerant matching
CREATE TABLE IF NOT EXISTS ingredient_synonyms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    synonym TEXT NOT NULL,
    locale TEXT DEFAULT 'en',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(ingredient_id, synonym, locale)
);

CREATE INDEX IF NOT EXISTS idx_synonyms_synonym ON ingredient_synonyms(synonym);
CREATE INDEX IF NOT EXISTS idx_synonyms_ingredient ON ingredient_synonyms(ingredient_id);

-- FTS5 for ingredient search (typo-tolerant)
-- Note: Using standalone FTS5 (not content-linked) for D1 compatibility
CREATE VIRTUAL TABLE IF NOT EXISTS ingredients_fts USING fts5(
    canonical_name,
    synonyms,
    tokenize='porter unicode61'
);

-- Ingredient allergen flags (FDA top 9 + extras)
CREATE TABLE IF NOT EXISTS ingredient_allergen_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    allergen_id INTEGER NOT NULL REFERENCES allergen_definitions(id),
    confidence TEXT NOT NULL DEFAULT 'definite' CHECK(confidence IN ('definite', 'likely', 'possible', 'cross_contact')),
    source TEXT, -- e.g., 'FDA', 'USDA', 'manual'
    data_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    UNIQUE(ingredient_id, allergen_id)
);

CREATE INDEX IF NOT EXISTS idx_allergen_flags_ingredient ON ingredient_allergen_flags(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_allergen_flags_allergen ON ingredient_allergen_flags(allergen_id);

-- Ingredient FODMAP profile (Monash-style)
CREATE TABLE IF NOT EXISTS ingredient_fodmap_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) UNIQUE,
    -- FODMAP categories (0-3 scale: 0=none, 1=low, 2=moderate, 3=high)
    fructose INTEGER NOT NULL DEFAULT 0 CHECK(fructose BETWEEN 0 AND 3),
    lactose INTEGER NOT NULL DEFAULT 0 CHECK(lactose BETWEEN 0 AND 3),
    fructan INTEGER NOT NULL DEFAULT 0 CHECK(fructan BETWEEN 0 AND 3),
    gos INTEGER NOT NULL DEFAULT 0 CHECK(gos BETWEEN 0 AND 3),
    polyol INTEGER NOT NULL DEFAULT 0 CHECK(polyol BETWEEN 0 AND 3),
    -- Safe serving size in grams (Monash green/amber/red thresholds)
    safe_serving_g REAL,
    source TEXT, -- e.g., 'Monash', 'manual', 'inferred'
    data_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_fodmap_ingredient ON ingredient_fodmap_profile(ingredient_id);

-- Ingredient compound yields v2 (which compounds an ingredient produces)
-- Note: Named kb_ingredient_compound_yields to avoid conflict with legacy table
CREATE TABLE IF NOT EXISTS kb_ingredient_compound_yields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    compound_id INTEGER NOT NULL REFERENCES compounds(id),
    yield_mg_per_100g REAL, -- mg of compound per 100g raw ingredient
    bioavailability_factor REAL DEFAULT 1.0, -- 0-1 multiplier
    notes TEXT,
    source TEXT, -- e.g., 'USDA', 'literature', 'estimated'
    data_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    UNIQUE(ingredient_id, compound_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_compound_yields_ingredient ON kb_ingredient_compound_yields(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_kb_compound_yields_compound ON kb_ingredient_compound_yields(compound_id);

--------------------------------------------------------------------------------
-- LAYER A: Cooking Profiles & Factors
--------------------------------------------------------------------------------

-- Cooking profiles v2 (how cooking methods affect compounds/nutrients)
-- Note: Named kb_cooking_profiles to avoid conflict with legacy table
CREATE TABLE IF NOT EXISTS kb_cooking_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE, -- e.g., 'raw', 'steamed', 'grilled', 'fried', 'boiled'
    description TEXT,
    -- Default retention factors (can be overridden per compound)
    default_vitamin_retention REAL DEFAULT 0.8,
    default_mineral_retention REAL DEFAULT 0.9,
    default_antioxidant_retention REAL DEFAULT 0.7,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0
);

-- Cooking factors v2 (specific compound retention per cooking method)
-- Note: Named kb_cooking_factors to avoid conflict with legacy table
CREATE TABLE IF NOT EXISTS kb_cooking_factors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cooking_profile_id INTEGER NOT NULL REFERENCES kb_cooking_profiles(id),
    compound_id INTEGER REFERENCES compounds(id), -- NULL means applies to all
    ingredient_id INTEGER REFERENCES ingredients(id), -- NULL means applies to all
    retention_factor REAL NOT NULL DEFAULT 1.0, -- 0-1 multiplier
    transformation_notes TEXT, -- e.g., 'forms new compound X'
    data_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_kb_cooking_factors_profile ON kb_cooking_factors(cooking_profile_id);
CREATE INDEX IF NOT EXISTS idx_kb_cooking_factors_compound ON kb_cooking_factors(compound_id);
CREATE INDEX IF NOT EXISTS idx_kb_cooking_factors_ingredient ON kb_cooking_factors(ingredient_id);

--------------------------------------------------------------------------------
-- LAYER B: Derived Building Blocks Cache
--------------------------------------------------------------------------------

-- Pre-computed ingredient vectors (hot path cache)
CREATE TABLE IF NOT EXISTS ingredient_vectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    cooking_profile_id INTEGER REFERENCES kb_cooking_profiles(id), -- NULL = raw

    -- Model/data versioning for cache invalidation
    model_version TEXT NOT NULL DEFAULT 'v1',
    data_version INTEGER NOT NULL DEFAULT 1,

    -- Allergen bits (bitfield for FDA top 9 + extras, max 32 allergens)
    allergen_bits INTEGER NOT NULL DEFAULT 0,

    -- FODMAP scores (aggregated from ingredient_fodmap_profile)
    fodmap_fructose INTEGER NOT NULL DEFAULT 0,
    fodmap_lactose INTEGER NOT NULL DEFAULT 0,
    fodmap_fructan INTEGER NOT NULL DEFAULT 0,
    fodmap_gos INTEGER NOT NULL DEFAULT 0,
    fodmap_polyol INTEGER NOT NULL DEFAULT 0,
    fodmap_total INTEGER NOT NULL DEFAULT 0, -- max of all categories

    -- Organ impact vector (JSON: {"heart": 0.5, "liver": -0.2, ...})
    organ_vector TEXT, -- JSON object

    -- Top beneficial/harmful compounds (for explainability)
    top_beneficial_compounds TEXT, -- JSON array of {compound_id, name, score}
    top_harmful_compounds TEXT, -- JSON array of {compound_id, name, score}

    -- Computation metadata
    computed_at TEXT NOT NULL DEFAULT (datetime('now')),
    computation_ms INTEGER, -- how long it took to compute

    -- Cache control
    is_stale INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,

    UNIQUE(ingredient_id, cooking_profile_id, model_version, data_version)
);

CREATE INDEX IF NOT EXISTS idx_vectors_ingredient ON ingredient_vectors(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_vectors_cooking ON ingredient_vectors(cooking_profile_id);
CREATE INDEX IF NOT EXISTS idx_vectors_version ON ingredient_vectors(model_version, data_version);
CREATE INDEX IF NOT EXISTS idx_vectors_stale ON ingredient_vectors(is_stale) WHERE is_stale = 1;

-- Pre-computed dish vectors (optional, for complex dishes)
CREATE TABLE IF NOT EXISTS dish_vectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Content-addressable: hash of normalized recipe
    normalized_recipe_hash TEXT NOT NULL, -- SHA256 of sorted, normalized ingredients

    -- Model/data versioning
    model_version TEXT NOT NULL DEFAULT 'v1',
    normalization_version TEXT NOT NULL DEFAULT 'v1',

    -- Aggregated allergen bits (OR of all ingredient allergen_bits)
    allergen_bits INTEGER NOT NULL DEFAULT 0,

    -- Aggregated FODMAP (max of each category across ingredients)
    fodmap_fructose INTEGER NOT NULL DEFAULT 0,
    fodmap_lactose INTEGER NOT NULL DEFAULT 0,
    fodmap_fructan INTEGER NOT NULL DEFAULT 0,
    fodmap_gos INTEGER NOT NULL DEFAULT 0,
    fodmap_polyol INTEGER NOT NULL DEFAULT 0,
    fodmap_total INTEGER NOT NULL DEFAULT 0,

    -- Aggregated organ vector (sum/weighted average)
    organ_vector TEXT, -- JSON object

    -- Source ingredient vectors (for provenance)
    source_ingredient_ids TEXT, -- JSON array of ingredient_ids

    -- Computation metadata
    computed_at TEXT NOT NULL DEFAULT (datetime('now')),
    computation_ms INTEGER,

    -- Cache control
    is_stale INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,

    UNIQUE(normalized_recipe_hash, model_version, normalization_version)
);

CREATE INDEX IF NOT EXISTS idx_dish_vectors_hash ON dish_vectors(normalized_recipe_hash);
CREATE INDEX IF NOT EXISTS idx_dish_vectors_version ON dish_vectors(model_version, normalization_version);

--------------------------------------------------------------------------------
-- AUDIT LOG: Track resets and major operations
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL, -- e.g., 'RESET_LAYER_C', 'REBUILD_VECTORS', 'SEED_INGREDIENTS'
    target_table TEXT, -- which table was affected
    affected_rows INTEGER,
    actor TEXT, -- 'admin', 'system', 'migration'
    details TEXT, -- JSON with additional context
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

--------------------------------------------------------------------------------
-- SEED: Cooking Profiles (basic set)
--------------------------------------------------------------------------------

INSERT OR IGNORE INTO kb_cooking_profiles (name, description, default_vitamin_retention, default_mineral_retention, default_antioxidant_retention) VALUES
('raw', 'No cooking, consumed fresh', 1.0, 1.0, 1.0),
('steamed', 'Steam cooking, minimal water contact', 0.85, 0.95, 0.80),
('boiled', 'Boiled in water', 0.60, 0.70, 0.50),
('grilled', 'Direct heat grilling', 0.75, 0.90, 0.65),
('fried', 'Pan or deep fried in oil', 0.70, 0.85, 0.55),
('roasted', 'Oven roasted', 0.75, 0.90, 0.70),
('sauteed', 'Quick cooking in small amount of fat', 0.80, 0.90, 0.70),
('microwaved', 'Microwave cooking', 0.85, 0.95, 0.75),
('pressure_cooked', 'Pressure cooker/Instant Pot', 0.80, 0.90, 0.75),
('slow_cooked', 'Low temperature, long duration', 0.65, 0.80, 0.60);

--------------------------------------------------------------------------------
-- Log this migration
--------------------------------------------------------------------------------

INSERT INTO audit_log (action, target_table, actor, details) VALUES
('MIGRATION_0006', NULL, 'migration', '{"description": "Evergreen Knowledge Bank schema additions", "tables_created": ["ingredients", "ingredient_synonyms", "ingredients_fts", "ingredient_allergen_flags", "ingredient_fodmap_profile", "kb_ingredient_compound_yields", "kb_cooking_profiles", "kb_cooking_factors", "ingredient_vectors", "dish_vectors", "audit_log"], "tables_extended": ["compounds", "compound_organ_effects"]}');
