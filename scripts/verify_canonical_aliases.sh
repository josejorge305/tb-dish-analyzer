#!/bin/bash

# Canonical Dish Alias System Verification Script
# Tests that the alias tables exist and normalization works correctly

echo "=============================================="
echo "  CANONICAL DISH ALIAS VERIFICATION"
echo "  $(date)"
echo "=============================================="
echo ""

DB_NAME="tb-database"

# Check if wrangler is available
if ! command -v wrangler &> /dev/null; then
    echo "Error: wrangler CLI not found"
    exit 1
fi

# Helper function to extract count from wrangler d1 output
# Handles both local and remote output formats
get_count() {
    local output="$1"
    # Try different jq paths for different wrangler output formats
    echo "$output" | jq -r '.results[0].cnt // .[0].results[0].cnt // .cnt // 0' 2>/dev/null || echo "0"
}

echo "1. Checking dish_canonicals table exists..."
CANONICAL_OUTPUT=$(wrangler d1 execute "$DB_NAME" --command "SELECT COUNT(*) as cnt FROM dish_canonicals;" --json 2>&1)
if echo "$CANONICAL_OUTPUT" | grep -q "no such table"; then
    CANONICAL_COUNT="0"
    echo "   Table does not exist yet"
else
    CANONICAL_COUNT=$(get_count "$CANONICAL_OUTPUT")
fi

if [[ "$CANONICAL_COUNT" == "0" ]] || [[ -z "$CANONICAL_COUNT" ]] || [[ "$CANONICAL_COUNT" == "null" ]]; then
    echo "   dish_canonicals table is empty or doesn't exist"
    echo "   Run: wrangler d1 migrations apply $DB_NAME --remote"
    echo "   Then: node seed_data/scripts/seed_canonical_dishes.js"
else
    echo "   dish_canonicals has $CANONICAL_COUNT entries"
fi

echo ""
echo "2. Checking dish_aliases table exists..."
ALIAS_OUTPUT=$(wrangler d1 execute "$DB_NAME" --command "SELECT COUNT(*) as cnt FROM dish_aliases;" --json 2>&1)
if echo "$ALIAS_OUTPUT" | grep -q "no such table"; then
    ALIAS_COUNT="0"
    echo "   Table does not exist yet"
else
    ALIAS_COUNT=$(get_count "$ALIAS_OUTPUT")
fi

if [[ "$ALIAS_COUNT" == "0" ]] || [[ -z "$ALIAS_COUNT" ]] || [[ "$ALIAS_COUNT" == "null" ]]; then
    echo "   dish_aliases table is empty or doesn't exist"
else
    echo "   dish_aliases has $ALIAS_COUNT entries"
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
echo "   Input: 'Creme Brulee'"
echo "   Expected normalized: 'creme brulee'"

echo ""
echo "6. Checking suggestions table (unmatched dishes):"
SUGGEST_OUTPUT=$(wrangler d1 execute "$DB_NAME" --command "SELECT COUNT(*) as cnt FROM dish_alias_suggestions;" --json 2>&1)
if echo "$SUGGEST_OUTPUT" | grep -q "no such table"; then
    SUGGEST_COUNT="0"
else
    SUGGEST_COUNT=$(get_count "$SUGGEST_OUTPUT")
fi

if [[ "$SUGGEST_COUNT" == "0" ]] || [[ -z "$SUGGEST_COUNT" ]] || [[ "$SUGGEST_COUNT" == "null" ]]; then
    echo "   No unmatched dishes logged yet (suggestions table empty or doesn't exist)"
else
    echo "   $SUGGEST_COUNT unmatched dishes pending review"
    echo ""
    echo "   Top 5 most frequent unmatched:"
    wrangler d1 execute "$DB_NAME" --command "SELECT alias_norm, occurrence_count FROM dish_alias_suggestions ORDER BY occurrence_count DESC LIMIT 5;" 2>/dev/null
fi

echo ""
echo "=============================================="
echo "  VERIFICATION COMPLETE"
echo "=============================================="

# Summary
if [[ "$CANONICAL_COUNT" != "0" ]] && [[ "$CANONICAL_COUNT" != "null" ]] && [[ "$ALIAS_COUNT" != "0" ]] && [[ "$ALIAS_COUNT" != "null" ]]; then
    echo "  System ready: $CANONICAL_COUNT canonicals, $ALIAS_COUNT aliases"
else
    echo "  System needs setup:"
    echo "     1. Apply migration: wrangler d1 migrations apply $DB_NAME --remote"
    echo "     2. Seed data: node seed_data/scripts/seed_canonical_dishes.js"
fi
echo ""
