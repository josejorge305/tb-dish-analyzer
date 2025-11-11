-- ============================
-- 🧬 TUMMY BUDDY — Molecular Schema (Phase 1)
-- ============================

-- Table: compounds
CREATE TABLE IF NOT EXISTS compounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  common_name TEXT,
  formula TEXT,
  cid TEXT UNIQUE,              -- PubChem compound ID
  description TEXT,
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Table: bio_edges  (compound → target / pathway)
CREATE TABLE IF NOT EXISTS bio_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compound_id INTEGER NOT NULL REFERENCES compounds(id),
  target TEXT NOT NULL,         -- gene / enzyme / receptor
  pathway TEXT,                 -- KEGG / Reactome / etc.
  evidence_level TEXT,          -- e.g. "strong", "moderate", "weak"
  citation TEXT,
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Table: compound_organ_effects (compound → organ → benefit/risk)
CREATE TABLE IF NOT EXISTS compound_organ_effects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compound_id INTEGER NOT NULL REFERENCES compounds(id),
  organ TEXT NOT NULL,          -- e.g. "liver", "gut", "brain"
  effect TEXT,                  -- "benefit", "risk", "neutral"
  strength INTEGER,             -- 1–5 scale
  notes TEXT,
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Table: recipes (used by /recipe/resolve)
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dish_name TEXT NOT NULL,
  cuisine TEXT,
  ingredients_json TEXT,        -- raw JSON of ingredients
  recipe_json TEXT,             -- steps + notes
  compound_links_json TEXT,     -- links to compounds detected
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Table: organ_systems (lookup for organ categories)
CREATE TABLE IF NOT EXISTS organ_systems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organ TEXT UNIQUE NOT NULL,
  system TEXT,                  -- e.g. "Digestive", "Cardiovascular"
  description TEXT
);

