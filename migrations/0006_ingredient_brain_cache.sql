-- 0006_ingredient_brain_cache.sql

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  food_group TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now')),
  UNIQUE(name_normalized)
);
CREATE INDEX IF NOT EXISTS idx_ingredients_name_norm ON ingredients(name_normalized);

CREATE TABLE IF NOT EXISTS ingredient_sources (
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  source TEXT NOT NULL,
  source_id TEXT,
  data_json TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now')),
  PRIMARY KEY (ingredient_id, source),
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_ingredient_sources_lookup ON ingredient_sources(source, source_id);

CREATE TABLE IF NOT EXISTS ingredient_nutrients (
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  nutrient_key TEXT NOT NULL,
  amount REAL,
  per_100g INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  PRIMARY KEY (ingredient_id, nutrient_key, per_100g, source)
);
CREATE INDEX IF NOT EXISTS idx_ing_nutrients_key ON ingredient_nutrients(nutrient_key);

CREATE TABLE IF NOT EXISTS ingredient_aliases (
  alias TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  source TEXT,
  PRIMARY KEY (alias_normalized, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_ing_alias_norm ON ingredient_aliases(alias_normalized);

CREATE TABLE IF NOT EXISTS ingredient_compound_yields (
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  compound_id INTEGER NOT NULL REFERENCES compounds(id),
  mg_per_100g REAL NOT NULL,
  source TEXT,
  PRIMARY KEY (ingredient_id, compound_id)
);

CREATE TABLE IF NOT EXISTS cooking_factors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method TEXT NOT NULL,
  compound_id INTEGER REFERENCES compounds(id),
  factor REAL NOT NULL DEFAULT 1.0,
  UNIQUE(method, compound_id)
);
