#!/usr/bin/env bash
set -euo pipefail

BASE="https://tb-dish-processor-production.tummybuddy.workers.dev"

echo "✓ Checking /restaurants/find shape..."
curl -s "$BASE/restaurants/find?query=test" \
| jq -e 'has("ok") and has("source") and has("items")' >/dev/null
echo "  -> ok, source, items present"

echo "✓ Checking /menu/extract shape..."
curl -s "$BASE/menu/extract?url=https://example.com/menu" \
| jq -e 'has("ok") and has("source") and has("sections")' >/dev/null
echo "  -> ok, source, sections present"

echo "✓ Checking /organs/from-dish shape..."
curl -s "$BASE/organs/from-dish?dish=Grilled%20Salmon&user_id=USER123" \
| jq -e 'has("ok") and has("source") and has("organs") and has("insight_lines")' >/dev/null
echo "  -> ok, source, organs, insight_lines present"

echo "✅ All contract checks passed."
