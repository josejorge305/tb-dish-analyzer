-- Migration 0008: Super Brain Expansion
-- Adds tables for NOVA scores, Nutri-Scores, additives, glycemic data, and bioactive compounds
-- Generated: 2024

-- ============================================
-- INGREDIENT QUALITY SCORES (NOVA, Nutri-Score, Ecoscore)
-- ============================================
CREATE TABLE IF NOT EXISTS ingredient_quality_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    nova_group INTEGER CHECK(nova_group BETWEEN 1 AND 4), -- 1=unprocessed, 4=ultra-processed
    nutri_score TEXT CHECK(nutri_score IN ('a', 'b', 'c', 'd', 'e')),
    nutri_score_value INTEGER, -- Raw numeric score
    ecoscore TEXT CHECK(ecoscore IN ('a', 'b', 'c', 'd', 'e')),
    source TEXT NOT NULL DEFAULT 'unknown',
    data_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    UNIQUE(ingredient_id, source)
);

CREATE INDEX IF NOT EXISTS idx_quality_ingredient ON ingredient_quality_scores(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_quality_nova ON ingredient_quality_scores(nova_group);
CREATE INDEX IF NOT EXISTS idx_quality_nutri ON ingredient_quality_scores(nutri_score);

-- ============================================
-- INGREDIENT GLYCEMIC DATA (GI/GL)
-- ============================================
CREATE TABLE IF NOT EXISTS ingredient_glycemic (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    glycemic_index REAL, -- 0-100 scale
    glycemic_load REAL, -- Per serving
    serving_size_g REAL,
    gi_category TEXT CHECK(gi_category IN ('low', 'medium', 'high')), -- <55 low, 55-69 medium, >70 high
    source TEXT NOT NULL DEFAULT 'unknown',
    source_url TEXT,
    data_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    UNIQUE(ingredient_id, source)
);

CREATE INDEX IF NOT EXISTS idx_glycemic_ingredient ON ingredient_glycemic(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_glycemic_gi ON ingredient_glycemic(glycemic_index);
CREATE INDEX IF NOT EXISTS idx_glycemic_category ON ingredient_glycemic(gi_category);

-- ============================================
-- INGREDIENT ADDITIVES (E-numbers, preservatives, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS ingredient_additives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    additive_code TEXT NOT NULL, -- E621, E150a, etc.
    additive_name TEXT,
    additive_class TEXT, -- 'preservative', 'colorant', 'emulsifier', 'sweetener', etc.
    risk_level TEXT CHECK(risk_level IN ('safe', 'caution', 'limit', 'avoid')),
    concerns TEXT, -- JSON array of health concerns
    source TEXT NOT NULL DEFAULT 'unknown',
    data_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    UNIQUE(ingredient_id, additive_code, source)
);

CREATE INDEX IF NOT EXISTS idx_additives_ingredient ON ingredient_additives(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_additives_code ON ingredient_additives(additive_code);
CREATE INDEX IF NOT EXISTS idx_additives_risk ON ingredient_additives(risk_level);

-- ============================================
-- BIOACTIVE COMPOUNDS (from FooDB, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS ingredient_bioactives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    compound_name TEXT NOT NULL,
    compound_class TEXT, -- 'polyphenol', 'flavonoid', 'carotenoid', 'alkaloid', etc.
    compound_subclass TEXT, -- More specific classification
    amount_per_100g REAL,
    unit TEXT DEFAULT 'mg',
    health_effects TEXT, -- JSON array of effects
    target_organs TEXT, -- JSON array of organs this compound affects
    source TEXT NOT NULL DEFAULT 'unknown',
    source_id TEXT, -- FooDB compound ID, etc.
    data_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    UNIQUE(ingredient_id, compound_name, source)
);

CREATE INDEX IF NOT EXISTS idx_bioactives_ingredient ON ingredient_bioactives(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_bioactives_compound ON ingredient_bioactives(compound_name);
CREATE INDEX IF NOT EXISTS idx_bioactives_class ON ingredient_bioactives(compound_class);

-- ============================================
-- EXTENDED MICRONUTRIENTS (detailed vitamins/minerals)
-- These extend the basic nutrients with more specific forms
-- ============================================
CREATE TABLE IF NOT EXISTS ingredient_micronutrients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    nutrient_code TEXT NOT NULL, -- Standardized code (vitamin_b12, folate, etc.)
    nutrient_name TEXT NOT NULL,
    nutrient_form TEXT, -- 'retinol', 'beta_carotene', 'methylcobalamin', etc.
    amount_per_100g REAL NOT NULL,
    unit TEXT NOT NULL,
    daily_value_pct REAL, -- Percentage of daily value
    source TEXT NOT NULL DEFAULT 'unknown',
    data_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    UNIQUE(ingredient_id, nutrient_code, nutrient_form, source)
);

CREATE INDEX IF NOT EXISTS idx_micronutrients_ingredient ON ingredient_micronutrients(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_micronutrients_code ON ingredient_micronutrients(nutrient_code);

-- ============================================
-- ADDITIVE DEFINITIONS (Reference table for E-numbers)
-- ============================================
CREATE TABLE IF NOT EXISTS additive_definitions (
    additive_code TEXT PRIMARY KEY, -- E621, E150a, etc.
    additive_name TEXT NOT NULL,
    additive_class TEXT NOT NULL,
    description TEXT,
    risk_level TEXT CHECK(risk_level IN ('safe', 'caution', 'limit', 'avoid')),
    concerns TEXT, -- JSON array
    max_daily_intake TEXT, -- ADI info
    banned_in TEXT, -- JSON array of countries/regions where banned
    data_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed common additives with risk levels
INSERT OR IGNORE INTO additive_definitions (additive_code, additive_name, additive_class, risk_level, concerns) VALUES
-- Colorants
('E102', 'Tartrazine', 'colorant', 'caution', '["hyperactivity", "allergies"]'),
('E110', 'Sunset Yellow', 'colorant', 'caution', '["hyperactivity"]'),
('E120', 'Carmine/Cochineal', 'colorant', 'caution', '["allergies"]'),
('E129', 'Allura Red', 'colorant', 'caution', '["hyperactivity"]'),
('E150a', 'Caramel Color I', 'colorant', 'safe', NULL),
('E150d', 'Caramel Color IV', 'colorant', 'caution', '["potential_carcinogen"]'),
('E160a', 'Beta-Carotene', 'colorant', 'safe', NULL),
('E160b', 'Annatto', 'colorant', 'safe', NULL),
-- Preservatives
('E200', 'Sorbic Acid', 'preservative', 'safe', NULL),
('E202', 'Potassium Sorbate', 'preservative', 'safe', NULL),
('E210', 'Benzoic Acid', 'preservative', 'caution', '["allergies", "asthma"]'),
('E211', 'Sodium Benzoate', 'preservative', 'caution', '["hyperactivity", "benzene_formation"]'),
('E220', 'Sulfur Dioxide', 'preservative', 'caution', '["allergies", "asthma"]'),
('E250', 'Sodium Nitrite', 'preservative', 'limit', '["nitrosamines", "potential_carcinogen"]'),
('E251', 'Sodium Nitrate', 'preservative', 'limit', '["nitrosamines"]'),
-- Sweeteners
('E950', 'Acesulfame K', 'sweetener', 'caution', '["controversial"]'),
('E951', 'Aspartame', 'sweetener', 'caution', '["phenylketonuria", "controversial"]'),
('E952', 'Cyclamate', 'sweetener', 'avoid', '["banned_in_us"]'),
('E954', 'Saccharin', 'sweetener', 'caution', '["controversial"]'),
('E955', 'Sucralose', 'sweetener', 'safe', NULL),
('E960', 'Steviol Glycosides', 'sweetener', 'safe', NULL),
('E967', 'Xylitol', 'sweetener', 'safe', '["digestive_issues_excess"]'),
-- Flavor enhancers
('E620', 'Glutamic Acid', 'flavor_enhancer', 'safe', NULL),
('E621', 'MSG', 'flavor_enhancer', 'safe', '["sensitivity_some_people"]'),
('E627', 'Disodium Guanylate', 'flavor_enhancer', 'safe', NULL),
('E631', 'Disodium Inosinate', 'flavor_enhancer', 'safe', NULL),
-- Emulsifiers
('E322', 'Lecithin', 'emulsifier', 'safe', NULL),
('E471', 'Mono/Diglycerides', 'emulsifier', 'safe', NULL),
('E433', 'Polysorbate 80', 'emulsifier', 'caution', '["gut_microbiome"]'),
-- Thickeners
('E407', 'Carrageenan', 'thickener', 'caution', '["gut_inflammation"]'),
('E412', 'Guar Gum', 'thickener', 'safe', NULL),
('E415', 'Xanthan Gum', 'thickener', 'safe', NULL);

-- Migration complete: 0008_super_brain_expansion
