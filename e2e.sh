#!/usr/bin/env bash
set -euo pipefail

BASE="https://tb-dish-processor-production.tummybuddy.workers.dev"
USER_ID="USER123"
QUERY="${1:-pura vida}"            # pass "chipotle" or a city-specific query as arg if you want
LAT="${LAT:-25.774}"               # optional: set LAT/LNG env for better results
LNG="${LNG:--80.193}"              # Miami defaults; adjust for your area
JQ="jq -r"

banner(){ echo -e "\n==== $* ====\n"; }

# 0) Health & meta
banner "HEALTH CHECKS"
curl -fsSL "$BASE/healthz" | sed -n '1,120p'
curl -fsSL "$BASE/meta"    | $JQ '.ok, .envPresent, .version? // "no-version"'

# 1) User prefs (write + read)
banner "USER PREFS → set lactose + garlic sensitivity, gluten off"
curl -fsSL -X POST "$BASE/user/prefs?user_id=$USER_ID" \
  -H 'content-type: application/json' \
  --data '{"allergens":{"dairy":true,"gluten":false,"soy":false,"shellfish":false},"fodmap":{"garlic_onion":true},"notes":"e2e test"}' \
  | $JQ '.ok,.prefs'

banner "USER PREFS → read back"
curl -fsSL "$BASE/user/prefs?user_id=$USER_ID" | $JQ '.ok,.prefs'

# 2) Restaurant search → pick one
banner "RESTAURANT SEARCH"
REST_JSON=$(curl -fsSL "$BASE/restaurants/search?query=$(python3 - <<PY
import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))
PY
"$QUERY")&lat=$LAT&lng=$LNG&limit=5")

echo "$REST_JSON" | $JQ '.items[0].name, .items[0].id? // .items[0].slug? // "no-id"'
REST_NAME=$(echo "$REST_JSON" | $JQ '.items[0].name')
REST_ID=$(echo "$REST_JSON" | $JQ '.items[0].id? // .items[0].slug? // empty')
[ -z "$REST_ID" ] && { echo "No restaurant id/slug found. Try a different query."; exit 1; }

# 3) Menu extraction for that restaurant
banner "MENU EXTRACT"
MENU_JSON=$(curl -fsSL "$BASE/menu/extract?restaurant_id=$(python3 - <<PY
import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))
PY
"$REST_ID")&lat=$LAT&lng=$LNG")

echo "$MENU_JSON" | $JQ '.ok, .restaurant.name?, .dishes | length'

# 4) Pick a dish (prefer mains/salads); fall back to first item
DISH_NAME=$(echo "$MENU_JSON" | $JQ '.dishes[] | select((.course? // "")|test("main|entree|salad|bowl|plate";"i")) | .name' | head -n1)
[ -z "$DISH_NAME" ] && DISH_NAME=$(echo "$MENU_JSON" | $JQ '.dishes[0].name')

echo "Chosen dish: $DISH_NAME"

# 5) Fast analysis from dish name (Barometer surrogate + organ flags)
banner "ORGANS /from-dish (GET)"
curl -fsSL "$BASE/organs/from-dish?dish=$(python3 - <<PY
import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))
PY
"$DISH_NAME")&user_id=$USER_ID" | $JQ '.dish,.tummy_barometer?,.organ_levels?,.insight_lines?'

# 6) Ingredient list (recipe extraction) → organ assess (POST)
banner "RECIPE / INGREDIENT EXTRACTION sanity via likely recipe (if present)"
ING_LIST=$(echo "$MENU_JSON" | $JQ '[.dishes[] | select(.name == '"$DISH_NAME"') | .ingredients? // empty][0] | map({name:.})')
if [ -z "$ING_LIST" ] || [ "$ING_LIST" = "null" ]; then
  echo "No ingredients on the menu payload; using a fallback short list for testing."
  ING_LIST='[{"name":"grilled chicken"},{"name":"white rice"},{"name":"garlic sauce"},{"name":"olive oil"}]'
fi
echo "$ING_LIST" | $JQ '.'

banner "ORGANS /assess (POST) with grams estimate"
curl -fsSL -X POST "$BASE/organs/assess?user_id=$USER_ID&include_lactose=1" \
  -H 'content-type: application/json' \
  --data "$(jq -n --argjson arr "$ING_LIST" '{ingredients: ($arr|map(.name as $n | {name:$n, grams: ( ($n|test("sauce|oil|garlic";"i"))? 10 : 120) })) }')" \
  | $JQ '.ok,.organ_levels,.top_drivers,.tummy_barometer?,.insight_lines?'

# 7) Log meal (if endpoint exists) — graceful skip if 404
banner "LOG MEAL (if supported)"
set +e
LOG_RES=$(curl -s -X POST "$BASE/user/meals/log?user_id=$USER_ID" \
  -H 'content-type: application/json' \
  --data "$(jq -n --arg dish "$DISH_NAME" '{dish:$dish, source:"e2e", calories:650 }')")
CODE=$?
set -e
[ $CODE -eq 0 ] && echo "$LOG_RES" | $JQ '.' || echo "Meal log endpoint not present; skipping."

# 8) Recent meals
banner "RECENT MEALS"
curl -fsSL "$BASE/user/meals/recent?user_id=$USER_ID&limit=3" | $JQ '.ok,.count,.items[].dish'

# 9) Molecular analysis spot-check (if exposed)
banner "MOLECULAR ANALYZE (if supported)"
set +e
MOL=$(curl -s "$BASE/molecular/analyze?ingredient=garlic")
if [ $? -eq 0 ] && [ -n "$MOL" ]; then
  echo "$MOL" | $JQ '.ingredient?, .compounds?[0:3]'
else
  echo "Molecular endpoint not exposed; skipping."
fi
set -e

banner "SUMMARY"
echo "Restaurant: $REST_NAME"
echo "Dish:       $DISH_NAME"
echo "User:       $USER_ID"
echo "Status:     E2E smoke completed."

