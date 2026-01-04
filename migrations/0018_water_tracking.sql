-- ============================================
-- MIGRATION 0018: Water Tracking Tables
-- ============================================
-- Creates tables for tracking water intake and hydration

-- ============================================
-- DAILY WATER SUMMARIES
-- Aggregated daily water tracking for fast lookups
-- ============================================
CREATE TABLE IF NOT EXISTS daily_water_summaries (
    user_id TEXT NOT NULL,
    summary_date TEXT NOT NULL,            -- ISO date YYYY-MM-DD

    -- Water intake
    total_glasses INTEGER DEFAULT 0,
    total_ml INTEGER DEFAULT 0,            -- Total milliliters (glasses * 240)
    target_glasses INTEGER DEFAULT 8,      -- User's daily target

    -- Hydration metrics
    hydration_score INTEGER DEFAULT 0,     -- 0-100 based on target achievement

    -- Organ impacts from hydration
    organ_impacts TEXT,                    -- JSON: {"kidneys": 5, "brain": 3, ...}

    -- Metadata
    last_updated_at INTEGER DEFAULT (strftime('%s','now')),

    PRIMARY KEY (user_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_water_summaries_user
    ON daily_water_summaries(user_id);

CREATE INDEX IF NOT EXISTS idx_water_summaries_date
    ON daily_water_summaries(summary_date);

-- ============================================
-- WATER LOGS (Optional detailed history)
-- Individual water log entries for analytics
-- ============================================
CREATE TABLE IF NOT EXISTS water_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,

    -- Log details
    glasses INTEGER NOT NULL DEFAULT 1,
    ml_amount INTEGER NOT NULL DEFAULT 240,
    log_date TEXT NOT NULL,                -- ISO date YYYY-MM-DD
    source TEXT DEFAULT 'manual',          -- 'manual', 'quick_add', 'apple_health', etc.

    -- Metadata
    logged_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_water_logs_user_date
    ON water_logs(user_id, log_date);

-- ============================================
-- Log this migration
-- ============================================
INSERT INTO audit_log (action, target_table, actor, details) VALUES
('MIGRATION_0018', NULL, 'migration', '{"description": "Water tracking tables", "tables_created": ["daily_water_summaries", "water_logs"]}');
