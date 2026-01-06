-- ============================
-- Photo Analysis System
-- Enables before/after photo tracking for meal logging
-- ============================

-- Add photo tracking columns to logged_meals
ALTER TABLE logged_meals ADD COLUMN photo_status TEXT CHECK (photo_status IN (
    'pending_after_photo',  -- Before photo taken, waiting for after photo
    'analyzing',            -- Photos being analyzed
    'completed',            -- Analysis complete
    'manual'                -- No photos, manually entered
)) DEFAULT NULL;

-- Photo URLs stored in R2
ALTER TABLE logged_meals ADD COLUMN before_photo_url TEXT;
ALTER TABLE logged_meals ADD COLUMN after_photo_url TEXT;

-- Analysis results from photo comparison
ALTER TABLE logged_meals ADD COLUMN photo_analysis_result TEXT;  -- JSON with analysis details
