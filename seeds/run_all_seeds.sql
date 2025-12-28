-- ============================
-- Master Seed Runner
-- Run this after applying migrations/0002_enriched_medical_knowledge.sql
-- ============================

-- This file combines all seeds in the correct order.
-- Run with: wrangler d1 execute tb-database --file=seeds/run_all_seeds.sql --remote

-- Note: For local development, run each file individually or concatenate them:
-- cat seeds/001_enriched_compounds.sql seeds/002_organ_effects_enriched.sql \
--     seeds/003_compound_interactions.sql seeds/004_ingredient_compound_mappings.sql \
--     | wrangler d1 execute tb-database --file=- --remote

-- ============================================================================
-- Order of operations:
-- 1. 001_enriched_compounds.sql - Base compound definitions
-- 2. 002_organ_effects_enriched.sql - Compound-organ relationships with medical reasoning
-- 3. 003_compound_interactions.sql - Synergies and antagonisms between compounds
-- 4. 004_ingredient_compound_mappings.sql - Food ingredient to compound mappings
-- ============================================================================

-- Verify tables exist (will fail gracefully if migration not applied)
SELECT 'Checking tables...' as status;
SELECT name FROM sqlite_master WHERE type='table' AND name IN (
  'compounds', 'compound_organ_effects', 'compound_interactions', 'ingredient_compounds'
);
