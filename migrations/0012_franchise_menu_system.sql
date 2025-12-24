-- Migration 0012: Franchise Menu Template System
-- Implements hierarchical menu inheritance (GLOBAL → COUNTRY → REGION → STORE)
-- with append-only provenance tracking and 15-day auto-renewal
--
-- CRITICAL: NOTHING IS EVER DELETED FROM THIS SCHEMA
-- Items can become INACTIVE but remain stored and can reactivate if seen again

--------------------------------------------------------------------------------
-- TABLE: brands (Franchise brand definitions)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name TEXT NOT NULL,           -- Display name: "McDonald's"
    normalized_name TEXT NOT NULL UNIQUE,   -- Lowercase, no punctuation: "mcdonalds"
    logo_url TEXT,                          -- Optional brand logo
    website_url TEXT,                       -- Official website
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_brands_normalized ON brands(normalized_name);

--------------------------------------------------------------------------------
-- TABLE: stores (Persisted restaurant/store records)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- External identifiers
    place_id TEXT UNIQUE,                   -- Google Places ID (primary key from external)
    uber_store_id TEXT,                     -- UberEats store UUID

    -- Brand linkage (NULL for non-franchise)
    brand_id INTEGER REFERENCES brands(id),

    -- Store details
    name TEXT NOT NULL,                     -- Full name: "McDonald's #12345"
    normalized_name TEXT NOT NULL,          -- Lowercase, no numbers: "mcdonalds"
    address TEXT,
    city TEXT,
    state_province TEXT,
    postal_code TEXT,
    country_code TEXT,                      -- ISO 3166-1 alpha-2: "US", "GB", "MX"
    region_code TEXT,                       -- Derived: "US-FL", "US-CA", "PR", "GB-LND"

    -- Coordinates
    latitude REAL,
    longitude REAL,

    -- Status
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE', 'PENDING')),

    -- Reconciliation tracking
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_reconciled_at TEXT,
    next_reconcile_after TEXT,              -- Scheduled next reconcile

    -- Metadata
    source TEXT,                            -- 'ubereats', 'google', 'manual'
    source_data TEXT,                       -- JSON: raw source payload reference

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stores_place_id ON stores(place_id);
CREATE INDEX IF NOT EXISTS idx_stores_uber_id ON stores(uber_store_id);
CREATE INDEX IF NOT EXISTS idx_stores_brand ON stores(brand_id);
CREATE INDEX IF NOT EXISTS idx_stores_country ON stores(country_code);
CREATE INDEX IF NOT EXISTS idx_stores_region ON stores(region_code);
CREATE INDEX IF NOT EXISTS idx_stores_reconcile ON stores(next_reconcile_after) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_stores_normalized ON stores(normalized_name);

--------------------------------------------------------------------------------
-- TABLE: franchise_menu_items (Canonical menu items per brand)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS franchise_menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL REFERENCES brands(id),

    -- Item identity
    canonical_name TEXT NOT NULL,           -- Display: "Big Mac"
    normalized_name TEXT NOT NULL,          -- Lowercase: "big mac"

    -- Categorization
    category TEXT,                          -- "Burgers", "Breakfast", "Drinks"
    subcategory TEXT,                       -- "Signature Burgers", "Value Menu"

    -- Base item (for variants)
    base_item_id INTEGER REFERENCES franchise_menu_items(id),  -- NULL if not a variant

    -- Description (from first sighting or manual)
    description TEXT,

    -- Cached nutrition (optional, from provider)
    calories INTEGER,

    -- Status (items are NEVER deleted, only marked inactive)
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SEASONAL', 'DISCONTINUED', 'CANDIDATE')),

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(brand_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_franchise_items_brand ON franchise_menu_items(brand_id);
CREATE INDEX IF NOT EXISTS idx_franchise_items_normalized ON franchise_menu_items(normalized_name);
CREATE INDEX IF NOT EXISTS idx_franchise_items_category ON franchise_menu_items(category);
CREATE INDEX IF NOT EXISTS idx_franchise_items_base ON franchise_menu_items(base_item_id);
CREATE INDEX IF NOT EXISTS idx_franchise_items_status ON franchise_menu_items(status);

--------------------------------------------------------------------------------
-- TABLE: menu_item_aliases (Alternative names for matching)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_item_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_item_id INTEGER NOT NULL REFERENCES franchise_menu_items(id),

    alias_text TEXT NOT NULL,               -- Original text: "Big Mac®"
    alias_normalized TEXT NOT NULL,         -- Normalized: "big mac"
    locale TEXT,                            -- Optional: "en-US", "es-MX"

    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(menu_item_id, alias_normalized)
);

CREATE INDEX IF NOT EXISTS idx_aliases_item ON menu_item_aliases(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_aliases_normalized ON menu_item_aliases(alias_normalized);

--------------------------------------------------------------------------------
-- TABLE: menu_item_scopes (Current state - hierarchical availability)
-- This is the MUTABLE "current state" table for fast effective menu queries
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_item_scopes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_item_id INTEGER NOT NULL REFERENCES franchise_menu_items(id),

    -- Scope definition
    scope_type TEXT NOT NULL CHECK(scope_type IN ('GLOBAL', 'COUNTRY', 'REGION', 'STORE')),
    scope_key TEXT,                         -- NULL for GLOBAL; 'US' for COUNTRY; 'US-FL' for REGION; store_id for STORE

    -- Status (NEVER DELETE - only flip status)
    status TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK(status IN ('ACTIVE', 'SEASONAL', 'INACTIVE', 'CANDIDATE')),

    -- Confidence and timing
    confidence REAL NOT NULL DEFAULT 0.5,   -- 0.0 to 1.0
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_reconciled_at TEXT,

    -- Pricing at this scope (optional)
    price_cents INTEGER,
    price_currency TEXT DEFAULT 'USD',

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(menu_item_id, scope_type, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_scopes_item ON menu_item_scopes(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_scopes_type_key ON menu_item_scopes(scope_type, scope_key);
CREATE INDEX IF NOT EXISTS idx_scopes_status ON menu_item_scopes(status);
CREATE INDEX IF NOT EXISTS idx_scopes_last_seen ON menu_item_scopes(last_seen_at);

--------------------------------------------------------------------------------
-- TABLE: menu_item_sightings (Append-only provenance records)
-- IMMUTABLE: Only INSERT, never UPDATE or DELETE
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_item_sightings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_item_id INTEGER NOT NULL REFERENCES franchise_menu_items(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),

    -- Source provenance
    source_type TEXT NOT NULL,              -- 'ubereats', 'doordash', 'website', 'user_confirmed', 'vision'
    source_ref TEXT,                        -- URL, provider ID, etc.

    -- Observed data
    observed_name TEXT NOT NULL,            -- Exact name as seen
    observed_description TEXT,
    observed_price_cents INTEGER,
    observed_price_currency TEXT,
    observed_calories INTEGER,
    observed_section TEXT,                  -- Menu section
    observed_image_url TEXT,

    -- Confidence
    confidence REAL NOT NULL DEFAULT 0.7,
    match_method TEXT,                      -- 'exact', 'alias', 'fuzzy', 'manual'

    -- Timing (immutable - when this sighting occurred)
    observed_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Raw payload reference (R2 key for full payload if needed)
    raw_payload_ref TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now'))
    -- NO updated_at - sightings are immutable
);

CREATE INDEX IF NOT EXISTS idx_sightings_item ON menu_item_sightings(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_sightings_store ON menu_item_sightings(store_id);
CREATE INDEX IF NOT EXISTS idx_sightings_observed_at ON menu_item_sightings(observed_at);
CREATE INDEX IF NOT EXISTS idx_sightings_store_observed ON menu_item_sightings(store_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_sightings_item_observed ON menu_item_sightings(menu_item_id, observed_at);

--------------------------------------------------------------------------------
-- TABLE: store_menu_snapshots (Append-only store evidence)
-- IMMUTABLE: Only INSERT, never UPDATE or DELETE
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_menu_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),

    -- Snapshot identity
    snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
    menu_hash TEXT NOT NULL,                -- SHA256 of normalized menu for change detection

    -- Item count summary
    item_count INTEGER NOT NULL DEFAULT 0,

    -- Source
    source_type TEXT NOT NULL,              -- 'ubereats', 'doordash', 'website'
    source_url TEXT,

    -- Full payload in R2
    payload_ref TEXT,                       -- R2 key: 'snapshots/{store_id}/{timestamp}.json'

    created_at TEXT NOT NULL DEFAULT (datetime('now'))
    -- NO updated_at - snapshots are immutable
);

CREATE INDEX IF NOT EXISTS idx_snapshots_store ON store_menu_snapshots(store_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_store_at ON store_menu_snapshots(store_id, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_hash ON store_menu_snapshots(menu_hash);

--------------------------------------------------------------------------------
-- SEED: Initial brand data
--------------------------------------------------------------------------------
INSERT OR IGNORE INTO brands (canonical_name, normalized_name) VALUES
    ('McDonald''s', 'mcdonalds'),
    ('Burger King', 'burgerking'),
    ('Wendy''s', 'wendys'),
    ('Taco Bell', 'tacobell'),
    ('Chick-fil-A', 'chickfila'),
    ('Subway', 'subway'),
    ('Starbucks', 'starbucks'),
    ('Dunkin''', 'dunkin'),
    ('Chipotle', 'chipotle'),
    ('Panda Express', 'pandaexpress'),
    ('KFC', 'kfc'),
    ('Popeyes', 'popeyes'),
    ('Five Guys', 'fiveguys'),
    ('Shake Shack', 'shakeshack'),
    ('In-N-Out Burger', 'innout'),
    ('Panera Bread', 'panerabread'),
    ('Domino''s', 'dominos'),
    ('Pizza Hut', 'pizzahut'),
    ('Papa John''s', 'papajohns'),
    ('Little Caesars', 'littlecaesars'),
    ('Sonic Drive-In', 'sonic'),
    ('Jack in the Box', 'jackinthebox'),
    ('Arby''s', 'arbys'),
    ('Carl''s Jr.', 'carlsjr'),
    ('Hardee''s', 'hardees'),
    ('Whataburger', 'whataburger'),
    ('Culver''s', 'culvers'),
    ('Wingstop', 'wingstop'),
    ('Buffalo Wild Wings', 'buffalowildwings'),
    ('Raising Cane''s', 'raisingcanes');

--------------------------------------------------------------------------------
-- Log this migration
--------------------------------------------------------------------------------
INSERT INTO audit_log (action, target_table, actor, details) VALUES
('MIGRATION_0012', NULL, 'migration', '{
    "description": "Franchise Menu Template System",
    "tables_created": ["brands", "stores", "franchise_menu_items", "menu_item_aliases", "menu_item_scopes", "menu_item_sightings", "store_menu_snapshots"],
    "constraints": "APPEND_ONLY for sightings and snapshots; STATUS_FLIP_ONLY for scopes and items"
}');
