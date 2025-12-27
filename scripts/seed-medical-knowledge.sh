#!/bin/bash
# ============================
# Seed Medical Knowledge Database
# ============================
# This script applies the enriched medical knowledge to your D1 database.
#
# Usage:
#   ./scripts/seed-medical-knowledge.sh          # Local database
#   ./scripts/seed-medical-knowledge.sh --remote # Production database

set -e

REMOTE_FLAG=""
if [ "$1" == "--remote" ]; then
  REMOTE_FLAG="--remote"
  echo "🌐 Targeting REMOTE (production) database"
else
  echo "💻 Targeting LOCAL database"
fi

echo ""
echo "📦 Step 1/7: Applying schema migration..."
wrangler d1 execute tb-database --file=migrations/0002_enriched_medical_knowledge.sql $REMOTE_FLAG

echo ""
echo "🧬 Step 2/7: Seeding enriched compounds (150+ compounds)..."
wrangler d1 execute tb-database --file=seeds/001_enriched_compounds.sql $REMOTE_FLAG

echo ""
echo "🏥 Step 3/7: Seeding organ effects with medical explanations (6 organs)..."
wrangler d1 execute tb-database --file=seeds/002_organ_effects_enriched.sql $REMOTE_FLAG

echo ""
echo "🔗 Step 4/7: Seeding compound interactions (synergies & antagonisms)..."
wrangler d1 execute tb-database --file=seeds/003_compound_interactions.sql $REMOTE_FLAG

echo ""
echo "🥗 Step 5/7: Seeding ingredient-compound mappings..."
wrangler d1 execute tb-database --file=seeds/004_ingredient_compound_mappings.sql $REMOTE_FLAG

echo ""
echo "👁️ Step 6/7: Seeding NEW organs (Eyes, Skin, Bones, Thyroid)..."
wrangler d1 execute tb-database --file=seeds/005_new_organs_effects.sql $REMOTE_FLAG

echo ""
echo "🍳 Step 7/7: Seeding ingredient mappings for new organs..."
wrangler d1 execute tb-database --file=seeds/006_new_organ_ingredient_mappings.sql $REMOTE_FLAG

echo ""
echo "✅ Medical knowledge database seeded successfully!"
echo ""
echo "📊 Now supporting 10 organs:"
echo "   Brain, Heart, Liver, Gut, Kidney, Immune (original)"
echo "   Eyes, Skin, Bones, Thyroid (NEW)"
echo ""
echo "Verify with:"
echo "  wrangler d1 execute tb-database --command \"SELECT COUNT(*) as compound_count FROM compounds;\" $REMOTE_FLAG"
echo "  wrangler d1 execute tb-database --command \"SELECT COUNT(*) as effects_count FROM compound_organ_effects;\" $REMOTE_FLAG"
echo "  wrangler d1 execute tb-database --command \"SELECT DISTINCT organ FROM compound_organ_effects;\" $REMOTE_FLAG"
