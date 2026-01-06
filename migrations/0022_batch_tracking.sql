-- ============================================
-- MIGRATION 0022: Batch Tracking Table
-- ============================================
-- Enables atomic counter updates for batch processing
-- Fixes race condition where concurrent queue workers
-- could lose count updates when using R2 storage

-- ============================================
-- BATCH JOBS TABLE
-- Tracks batch processing status with atomic counters
-- ============================================
CREATE TABLE IF NOT EXISTS batch_jobs (
    id TEXT PRIMARY KEY,                    -- UUID batch identifier
    status TEXT DEFAULT 'processing',       -- 'processing', 'completed', 'failed'

    -- Counters (updated atomically via SQL)
    total INTEGER NOT NULL DEFAULT 0,       -- Total jobs in batch
    cached INTEGER NOT NULL DEFAULT 0,      -- Jobs served from cache
    pending INTEGER NOT NULL DEFAULT 0,     -- Jobs pending processing
    completed INTEGER NOT NULL DEFAULT 0,   -- Successfully completed jobs
    failed INTEGER NOT NULL DEFAULT 0,      -- Failed jobs

    -- Metadata
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,

    -- Context
    place_id TEXT,
    query TEXT,

    -- Job details stored as JSON for reference
    jobs_json TEXT                          -- JSON array of job details
);

CREATE INDEX IF NOT EXISTS idx_batch_jobs_status
    ON batch_jobs(status);

CREATE INDEX IF NOT EXISTS idx_batch_jobs_created
    ON batch_jobs(created_at);

-- ============================================
-- Log this migration
-- ============================================
INSERT INTO audit_log (action, target_table, actor, details) VALUES
('MIGRATION_0022', 'batch_jobs', 'migration', '{"description": "Batch tracking table for atomic counter updates"}');
