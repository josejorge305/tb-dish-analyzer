-- Migration 0013: Canonical Dish Alias Map
-- Purpose: Enable deterministic resolution of messy menu dish names to stable canonical IDs
-- Date: 2024-12-24

-- ============================================
-- TABLE: dish_canonicals
-- Stable registry of canonical dish definitions
-- ============================================
CREATE TABLE IF NOT EXISTS dish_canonicals (
    canonical_id TEXT PRIMARY KEY,              -- Stable ID like DISH_ITALY_PASTA_CARBONARA
    canonical_name TEXT NOT NULL,               -- Display name: "Pasta Carbonara"
    cuisine TEXT NOT NULL,                      -- e.g., Italian, Mexican, Japanese
    course TEXT,                                -- Optional: appetizer, entree, dessert, beverage
    tags_json TEXT,                             -- JSON string for tags (protein, cooking method, etc.)
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- TABLE: dish_aliases
-- Maps normalized aliases to canonical dishes
-- ============================================
CREATE TABLE IF NOT EXISTS dish_aliases (
    alias_norm TEXT NOT NULL,                   -- Normalized alias key (output of normalizeDishName)
    locale TEXT DEFAULT 'en',                   -- Support 'en', 'es', 'zh', etc.
    canonical_id TEXT NOT NULL,                 -- FK to dish_canonicals
    raw_alias TEXT NOT NULL,                    -- Original alias text before normalization
    confidence REAL DEFAULT 1.0,                -- 0..1 confidence score
    match_type TEXT DEFAULT 'exact',            -- exact | fuzzy | regex
    is_active INTEGER DEFAULT 1,                -- Soft delete flag
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (alias_norm, locale),
    FOREIGN KEY (canonical_id) REFERENCES dish_canonicals(canonical_id) ON DELETE CASCADE
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_dish_canonicals_cuisine ON dish_canonicals(cuisine);
CREATE INDEX IF NOT EXISTS idx_dish_canonicals_course ON dish_canonicals(course);
CREATE INDEX IF NOT EXISTS idx_dish_aliases_canonical ON dish_aliases(canonical_id);
CREATE INDEX IF NOT EXISTS idx_dish_aliases_active ON dish_aliases(is_active) WHERE is_active = 1;

-- ============================================
-- TABLE: dish_alias_suggestions (optional queue for unmatched dishes)
-- Captures unmatched dish names for later manual review and alias creation
-- ============================================
CREATE TABLE IF NOT EXISTS dish_alias_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alias_norm TEXT NOT NULL,                   -- Normalized form that didn't match
    raw_input TEXT NOT NULL,                    -- Original input
    source TEXT,                                -- Where it came from: 'menu', 'user_input', 'ocr'
    context_json TEXT,                          -- Additional context (restaurant, menu section, etc.)
    occurrence_count INTEGER DEFAULT 1,         -- How many times this was seen
    reviewed INTEGER DEFAULT 0,                 -- Has it been reviewed?
    created_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT DEFAULT (datetime('now')),
    UNIQUE(alias_norm)
);

CREATE INDEX IF NOT EXISTS idx_suggestions_reviewed ON dish_alias_suggestions(reviewed);
CREATE INDEX IF NOT EXISTS idx_suggestions_count ON dish_alias_suggestions(occurrence_count DESC);
