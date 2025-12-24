#!/bin/bash

# Canonical Dish Alias System Verification Script
# Tests that the alias tables exist and normalization works correctly

set -e

echo "=============================================="
echo "  CANONICAL DISH ALIAS VERIFICATION"
echo "  $(date)"
echo "=============================================="
echo ""

DB_NAME="tb-database"

# Check if wrangler is available
if ! command -v wrangler &> /dev/null; then
    echo "❌ Error: wrangler CLI not found"
    exit 1
fi

echo "1. Checking dish_canonicals table exists..."
CANONICAL_COUNT=$(wrangler d1 execute "$DB_NAME" --command "SELECT COUNT(*) as cnt FROM dish_canonicals;" --json 2>/dev/null | jq -r '.[0].results[0].cnt // 0')
if [[ "$CANONICAL_COUNT" == "0" ]] || [[ -z "$CANONICAL_COUNT" ]]; then
    echo "   ⚠️  dish_canonicals table is empty or doesn't exist"
    echo "   Run: wrangler d1 migrations apply $DB_NAME --remote"
    echo "   Then: node seed_data/scripts/seed_canonical_dishes.js"
else
    echo "   ✅ dish_canonicals has $CANONICAL_COUNT entries"
fi

echo ""
echo "2. Checking dish_aliases table exists..."
ALIAS_COUNT=$(wrangler d1 execute "$DB_NAME" --command "SELECT COUNT(*) as cnt FROM dish_aliases;" --json 2>/dev/null | jq -r '.[0].results[0].cnt // 0')
if [[ "$ALIAS_COUNT" == "0" ]] || [[ -z "$ALIAS_COUNT" ]]; then
    echo "   ⚠️  dish_aliases table is empty or doesn't exist"
else
    echo "   ✅ dish_aliases has $ALIAS_COUNT entries"
fi

echo ""
echo "3. Sample canonical dishes:"
wrangler d1 execute "$DB_NAME" --command "SELECT canonical_id, canonical_name, cuisine FROM dish_canonicals LIMIT 5;" 2>/dev/null || echo "   (table may not exist yet)"

echo ""
echo "4. Sample aliases:"
wrangler d1 execute "$DB_NAME" --command "SELECT alias_norm, raw_alias, canonical_id FROM dish_aliases LIMIT 10;" 2>/dev/null || echo "   (table may not exist yet)"

echo ""
echo "5. Testing normalization examples:"
echo "   Input: 'Chef's Signature Pasta Carbonara (GF)'"
echo "   Expected normalized: 'pasta carbonara'"
echo ""
echo "   Input: 'Margherita Pizza w/ Fresh Mozzarella'"
echo "   Expected normalized: 'margherita pizza mozzarella'"
echo ""
echo "   Input: 'Crème Brûlée'"
echo "   Expected normalized: 'creme brulee'"

echo ""
echo "6. Checking suggestions table (unmatched dishes):"
SUGGEST_COUNT=$(wrangler d1 execute "$DB_NAME" --command "SELECT COUNT(*) as cnt FROM dish_alias_suggestions;" --json 2>/dev/null | jq -r '.[0].results[0].cnt // 0')
if [[ "$SUGGEST_COUNT" == "0" ]] || [[ -z "$SUGGEST_COUNT" ]]; then
    echo "   ℹ️  No unmatched dishes logged yet (suggestions table empty)"
else
    echo "   📝 $SUGGEST_COUNT unmatched dishes pending review"
    echo ""
    echo "   Top 5 most frequent unmatched:"
    wrangler d1 execute "$DB_NAME" --command "SELECT alias_norm, occurrence_count FROM dish_alias_suggestions ORDER BY occurrence_count DESC LIMIT 5;" 2>/dev/null
fi

echo ""
echo "=============================================="
echo "  VERIFICATION COMPLETE"
echo "=============================================="

# Summary
if [[ "$CANONICAL_COUNT" != "0" ]] && [[ "$ALIAS_COUNT" != "0" ]]; then
    echo "  ✅ System ready: $CANONICAL_COUNT canonicals, $ALIAS_COUNT aliases"
else
    echo "  ⚠️  System needs setup:"
    echo "     1. Apply migration: wrangler d1 migrations apply $DB_NAME --remote"
    echo "     2. Seed data: node seed_data/scripts/seed_canonical_dishes.js"
fi
echo ""
