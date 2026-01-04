-- ============================================
-- MIGRATION 0019: Add display_name to user_profiles
-- ============================================
-- Adds a display_name column for user personalization

ALTER TABLE user_profiles ADD COLUMN display_name TEXT;

-- Log this migration
INSERT INTO audit_log (action, target_table, actor, details) VALUES
('MIGRATION_0019', 'user_profiles', 'migration', '{"description": "Added display_name column to user_profiles"}');
