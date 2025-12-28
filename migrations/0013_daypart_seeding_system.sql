-- Migration 0013: Daypart Seeding System
-- Implements time-zone aware daypart classification for franchise menus
--
-- CRITICAL: NOTHING IS EVER DELETED FROM THIS SCHEMA
-- Items marked UNKNOWN remain as fallback; daypart promotions are additive

--------------------------------------------------------------------------------
-- EXTEND: menu_item_scopes with daypart fields
-- NOTE: SQLite requires individual ALTER TABLE statements
--------------------------------------------------------------------------------
ALTER TABLE menu_item_scopes ADD COLUMN daypart TEXT DEFAULT 'UNKNOWN'
    CHECK(daypart IN ('UNKNOWN', 'BREAKFAST', 'LUNCH', 'DINNER', 'LATE_NIGHT', 'ALL_DAY'));

ALTER TABLE menu_item_scopes ADD COLUMN available_from_min INTEGER;
ALTER TABLE menu_item_scopes ADD COLUMN available_to_min INTEGER;

-- Drop and recreate unique index to include daypart
DROP INDEX IF EXISTS menu_item_scopes_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scopes_item_scope_daypart
    ON menu_item_scopes(menu_item_id, scope_type, scope_key, daypart);

--------------------------------------------------------------------------------
-- TABLE: franchise_representative_stores
-- Stores selected as representatives per brand per timezone for daypart sampling
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS franchise_representative_stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL REFERENCES brands(id),
    store_id INTEGER NOT NULL REFERENCES stores(id),

    -- Timezone (IANA format)
    tzid TEXT NOT NULL,                        -- e.g., 'America/New_York'

    -- Selection metadata
    priority INTEGER NOT NULL DEFAULT 1,       -- 1 = primary, 2+ = backup
    selection_method TEXT,                     -- 'auto_search', 'manual', 'fallback'
    search_coords TEXT,                        -- JSON: {"lat": 40.7580, "lng": -73.9855}

    -- Status
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE', 'FAILED')),
    last_success_at TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(brand_id, tzid, store_id)
);

CREATE INDEX IF NOT EXISTS idx_rep_stores_brand ON franchise_representative_stores(brand_id);
CREATE INDEX IF NOT EXISTS idx_rep_stores_brand_tz ON franchise_representative_stores(brand_id, tzid);
CREATE INDEX IF NOT EXISTS idx_rep_stores_status ON franchise_representative_stores(status);

--------------------------------------------------------------------------------
-- TABLE: franchise_daypart_jobs
-- Scheduler for automatic daypart menu pulls
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS franchise_daypart_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL REFERENCES brands(id),

    -- Job identity
    tzid TEXT NOT NULL,                        -- 'America/New_York'
    daypart TEXT NOT NULL CHECK(daypart IN ('BREAKFAST', 'LUNCH', 'DINNER', 'LATE_NIGHT')),

    -- Scheduling
    local_time_min INTEGER NOT NULL,           -- Minutes from midnight (e.g., 510 = 08:30)
    next_run_at_utc TEXT NOT NULL,             -- Next scheduled run in UTC
    last_run_at_utc TEXT,                      -- Last completed run

    -- Status
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'PAUSED', 'FAILED')),
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,

    -- Stats
    total_runs INTEGER NOT NULL DEFAULT 0,
    total_items_seen INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(brand_id, tzid, daypart)
);

CREATE INDEX IF NOT EXISTS idx_daypart_jobs_next ON franchise_daypart_jobs(next_run_at_utc) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_daypart_jobs_brand ON franchise_daypart_jobs(brand_id);

--------------------------------------------------------------------------------
-- TABLE: franchise_seed_runs (Track overall seeding runs)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS franchise_seed_runs (
    run_id TEXT PRIMARY KEY,                   -- UUID

    -- Status
    status TEXT NOT NULL DEFAULT 'RUNNING' CHECK(status IN ('RUNNING', 'PAUSED', 'FAILED', 'DONE')),
    run_type TEXT NOT NULL DEFAULT 'INITIAL',  -- 'INITIAL', 'DAYPART_SETUP', 'RERUN'

    -- Progress
    current_index INTEGER NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 50,

    -- Timing
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,

    -- Error tracking
    last_error TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seed_runs_status ON franchise_seed_runs(status);

--------------------------------------------------------------------------------
-- TABLE: franchise_seed_progress (Per-brand progress within a run)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS franchise_seed_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES franchise_seed_runs(run_id),

    -- Brand identity
    brand_name TEXT NOT NULL,
    brand_id INTEGER REFERENCES brands(id),

    -- Status
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'IN_PROGRESS', 'DONE', 'FAILED', 'SKIPPED')),

    -- Timing
    started_at TEXT,
    finished_at TEXT,

    -- Counts
    menu_item_count INTEGER NOT NULL DEFAULT 0,
    analyzed_count INTEGER NOT NULL DEFAULT 0,
    qa_passed INTEGER NOT NULL DEFAULT 0,
    qa_failed_count INTEGER NOT NULL DEFAULT 0,

    -- Representative stores found
    rep_stores_found INTEGER NOT NULL DEFAULT 0,

    -- Daypart jobs created
    daypart_jobs_created INTEGER NOT NULL DEFAULT 0,

    -- Warnings/errors
    warnings_json TEXT,
    error TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(run_id, brand_name)
);

CREATE INDEX IF NOT EXISTS idx_seed_progress_run ON franchise_seed_progress(run_id);
CREATE INDEX IF NOT EXISTS idx_seed_progress_status ON franchise_seed_progress(status);

--------------------------------------------------------------------------------
-- TABLE: franchise_seed_failures (Append-only failure log)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS franchise_seed_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    brand_name TEXT NOT NULL,

    -- Failure context
    menu_item_name TEXT,
    stage TEXT NOT NULL,                       -- 'REP_STORE', 'MENU_FETCH', 'ANALYZE', 'QA', 'DAYPART_JOB'

    -- Error details
    error TEXT NOT NULL,
    error_code TEXT,

    -- Retry tracking
    retry_count INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL DEFAULT (datetime('now'))
    -- NO updated_at - failures are append-only
);

CREATE INDEX IF NOT EXISTS idx_seed_failures_run ON franchise_seed_failures(run_id);
CREATE INDEX IF NOT EXISTS idx_seed_failures_brand ON franchise_seed_failures(brand_name);

--------------------------------------------------------------------------------
-- TABLE: menu_item_sightings extension - add daypart column
--------------------------------------------------------------------------------
ALTER TABLE menu_item_sightings ADD COLUMN daypart TEXT DEFAULT 'UNKNOWN'
    CHECK(daypart IN ('UNKNOWN', 'BREAKFAST', 'LUNCH', 'DINNER', 'LATE_NIGHT'));

--------------------------------------------------------------------------------
-- TABLE: franchise_analysis_cache (Track which items have been analyzed)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS franchise_analysis_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL REFERENCES brands(id),
    menu_item_id INTEGER NOT NULL REFERENCES franchise_menu_items(id),

    -- Analysis status
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'COMPLETE', 'FAILED', 'STALE')),

    -- Analysis results reference
    cache_key TEXT,                            -- KV/R2 key for full analysis

    -- QA status
    qa_passed INTEGER NOT NULL DEFAULT 0,
    qa_allergens INTEGER NOT NULL DEFAULT 0,
    qa_organs INTEGER NOT NULL DEFAULT 0,
    qa_nutrition INTEGER NOT NULL DEFAULT 0,

    -- Timing
    analyzed_at TEXT,
    last_validated_at TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(brand_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_cache_brand ON franchise_analysis_cache(brand_id);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_status ON franchise_analysis_cache(status);

--------------------------------------------------------------------------------
-- Seed additional brands from the 50-brand list (if not already present)
--------------------------------------------------------------------------------
INSERT OR IGNORE INTO brands (canonical_name, normalized_name) VALUES
    ('Dairy Queen', 'dairyqueen'),
    ('Sonic Drive-In', 'sonicdrivein'),
    ('Papa Johns', 'papajohns'),
    ('Popeyes Louisiana Kitchen', 'popeyeslouisianakitchen'),
    ('Jimmy John''s', 'jimmyjohns'),
    ('Jersey Mike''s', 'jerseymikes'),
    ('Baskin-Robbins', 'baskinrobbins'),
    ('Jack in the Box', 'jackinthebox'),
    ('Wingstop', 'wingstop'),
    ('Hardee''s', 'hardees'),
    ('Five Guys', 'fiveguys'),
    ('Tropical Smoothie Café', 'tropicalsmoothiecafe'),
    ('Firehouse Subs', 'firehousesubs'),
    ('Papa Murphy''s', 'papamurphys'),
    ('Carl''s Jr.', 'carlsjr'),
    ('Marco''s Pizza', 'marcospizza'),
    ('Whataburger', 'whataburger'),
    ('Zaxby''s', 'zaxbys'),
    ('Culver''s', 'culvers'),
    ('Church''s Chicken', 'churchschicken'),
    ('Checkers', 'checkers'),
    ('Rally''s', 'rallys'),
    ('Bojangles', 'bojangles'),
    ('Qdoba', 'qdoba'),
    ('Crumbl Cookies', 'crumblcookies'),
    ('Dutch Bros', 'dutchbros'),
    ('Raising Cane''s', 'raisingcanes'),
    ('Moe''s', 'moes'),
    ('Del Taco', 'deltaco'),
    ('McAlister''s Deli', 'mcalistersdeli'),
    ('El Pollo Loco', 'elpolloloco'),
    ('Freddy''s Frozen Custard & Steakburgers', 'freddys'),
    ('In-N-Out Burger', 'innoutburger'),
    ('Krispy Kreme', 'krispykreme'),
    ('Shake Shack', 'shakeshack');

--------------------------------------------------------------------------------
-- Log this migration
--------------------------------------------------------------------------------
INSERT INTO audit_log (action, target_table, actor, details) VALUES
('MIGRATION_0013', NULL, 'migration', '{
    "description": "Daypart Seeding System",
    "tables_created": ["franchise_representative_stores", "franchise_daypart_jobs", "franchise_seed_runs", "franchise_seed_progress", "franchise_seed_failures", "franchise_analysis_cache"],
    "tables_altered": ["menu_item_scopes", "menu_item_sightings"],
    "constraints": "NO DELETIONS - only status updates and appends"
}');
