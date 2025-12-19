-- ============================
-- Multi-Goal Support Migration
-- Adds 'goals' column to user_profiles for storing multiple goals as JSON array
-- ============================

-- Add goals column to user_profiles table
ALTER TABLE user_profiles ADD COLUMN goals TEXT;

-- Migrate existing primary_goal to goals array format
UPDATE user_profiles
SET goals = '["' || COALESCE(primary_goal, 'maintain') || '"]'
WHERE goals IS NULL;
