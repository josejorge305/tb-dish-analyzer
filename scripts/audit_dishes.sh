#!/bin/bash

# Dish Analysis Audit Script
# Tests 25 diverse dishes and validates allergen/FODMAP/nutrition accuracy

BASE="https://tb-dish-processor-production.tummybuddy.workers.dev"
RESULTS_DIR="audit_results"
mkdir -p "$RESULTS_DIR"

# 25 test dishes with expected allergens/FODMAP for validation
declare -A DISHES
declare -A EXPECTED_ALLERGENS
declare -A EXPECTED_FODMAP

# 1-5: Gluten-containing dishes
DISHES[1]="Margherita Pizza"
EXPECTED_ALLERGENS[1]="wheat,milk"
EXPECTED_FODMAP[1]="high_fructan,high_lactose"

DISHES[2]="Spaghetti Carbonara"
EXPECTED_ALLERGENS[2]="wheat,egg,milk"
EXPECTED_FODMAP[2]="high_fructan,high_lactose"

DISHES[3]="Chicken Tikka Masala"
EXPECTED_ALLERGENS[3]="milk"
EXPECTED_FODMAP[3]="high_lactose,high_fructan"

DISHES[4]="Beef Teriyaki"
EXPECTED_ALLERGENS[4]="wheat,soy"
EXPECTED_FODMAP[4]="high_fructan"

DISHES[5]="Fish and Chips"
EXPECTED_ALLERGENS[5]="wheat,fish"
EXPECTED_FODMAP[5]="high_fructan"

# 6-10: Nut-containing dishes
DISHES[6]="Pad Thai"
EXPECTED_ALLERGENS[6]="peanut,shellfish,egg"
EXPECTED_FODMAP[6]="high_fructan"

DISHES[7]="Baklava"
EXPECTED_ALLERGENS[7]="tree_nut,wheat"
EXPECTED_FODMAP[7]="high_fructan"

DISHES[8]="Kung Pao Chicken"
EXPECTED_ALLERGENS[8]="peanut,soy"
EXPECTED_FODMAP[8]="high_fructan"

DISHES[9]="Pesto Pasta"
EXPECTED_ALLERGENS[9]="tree_nut,wheat,milk"
EXPECTED_FODMAP[9]="high_fructan,high_lactose"

DISHES[10]="Almond Croissant"
EXPECTED_ALLERGENS[10]="tree_nut,wheat,milk,egg"
EXPECTED_FODMAP[10]="high_fructan,high_lactose"

# 11-15: Shellfish/Fish dishes
DISHES[11]="Shrimp Scampi"
EXPECTED_ALLERGENS[11]="shellfish,wheat,milk"
EXPECTED_FODMAP[11]="high_fructan,high_lactose"

DISHES[12]="Lobster Bisque"
EXPECTED_ALLERGENS[12]="shellfish,milk"
EXPECTED_FODMAP[12]="high_lactose"

DISHES[13]="Sushi Roll (California)"
EXPECTED_ALLERGENS[13]="shellfish,fish"
EXPECTED_FODMAP[13]="none"

DISHES[14]="Ceviche"
EXPECTED_ALLERGENS[14]="fish,shellfish"
EXPECTED_FODMAP[14]="high_fructan"

DISHES[15]="Paella"
EXPECTED_ALLERGENS[15]="shellfish,fish"
EXPECTED_FODMAP[15]="high_fructan"

# 16-20: Dairy-heavy dishes
DISHES[16]="Mac and Cheese"
EXPECTED_ALLERGENS[16]="wheat,milk"
EXPECTED_FODMAP[16]="high_fructan,high_lactose"

DISHES[17]="Cheese Quesadilla"
EXPECTED_ALLERGENS[17]="wheat,milk"
EXPECTED_FODMAP[17]="high_fructan,high_lactose"

DISHES[18]="Greek Yogurt Parfait"
EXPECTED_ALLERGENS[18]="milk"
EXPECTED_FODMAP[18]="high_lactose"

DISHES[19]="Tiramisu"
EXPECTED_ALLERGENS[19]="milk,egg,wheat"
EXPECTED_FODMAP[19]="high_lactose,high_fructan"

DISHES[20]="Butter Chicken"
EXPECTED_ALLERGENS[20]="milk"
EXPECTED_FODMAP[20]="high_lactose,high_fructan"

# 21-25: Varied/Diet-specific dishes
DISHES[21]="Falafel Wrap"
EXPECTED_ALLERGENS[21]="wheat,sesame"
EXPECTED_FODMAP[21]="high_fructan,high_gos"

DISHES[22]="Veggie Stir Fry"
EXPECTED_ALLERGENS[22]="soy"
EXPECTED_FODMAP[22]="high_fructan,high_polyol"

DISHES[23]="Grilled Salmon"
EXPECTED_ALLERGENS[23]="fish"
EXPECTED_FODMAP[23]="none"

DISHES[24]="Egg Fried Rice"
EXPECTED_ALLERGENS[24]="egg,soy"
EXPECTED_FODMAP[24]="high_fructan"

DISHES[25]="Hummus with Pita"
EXPECTED_ALLERGENS[25]="wheat,sesame"
EXPECTED_FODMAP[25]="high_fructan,high_gos"

echo "=============================================="
echo "  DISH ANALYSIS AUDIT - 25 Dishes"
echo "  $(date)"
echo "=============================================="
echo ""

PASS=0
FAIL=0
WARN=0

for i in {1..25}; do
    dish="${DISHES[$i]}"
    expected_allergens="${EXPECTED_ALLERGENS[$i]}"
    expected_fodmap="${EXPECTED_FODMAP[$i]}"

    echo "[$i/25] Testing: $dish"
    echo "  Expected allergens: $expected_allergens"
    echo "  Expected FODMAP: $expected_fodmap"

    # Call the API
    response=$(curl -s -X POST "$BASE/api/analyze" \
        -H "Content-Type: application/json" \
        -d "{\"dishName\": \"$dish\"}" \
        --max-time 60)

    # Save raw response
    echo "$response" > "$RESULTS_DIR/dish_${i}_$(echo $dish | tr ' ' '_').json"

    # Check for errors
    if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
        error=$(echo "$response" | jq -r '.error')
        echo "  ❌ ERROR: $error"
        ((FAIL++))
        echo ""
        continue
    fi

    # Extract allergens
    actual_allergens=$(echo "$response" | jq -r '[.allergen_flags[]? | select(.present == "yes" or .present == true) | .kind] | sort | join(",")' 2>/dev/null)

    # Extract FODMAP
    actual_fodmap=$(echo "$response" | jq -r '[.fodmap_flags[]? | select(.present == "yes" or .present == true) | .kind] | sort | join(",")' 2>/dev/null)

    # Extract nutrition
    calories=$(echo "$response" | jq -r '.nutrition.calories // "N/A"' 2>/dev/null)
    protein=$(echo "$response" | jq -r '.nutrition.protein // "N/A"' 2>/dev/null)

    # Extract diet tags
    diet_tags=$(echo "$response" | jq -r '[.diet_tags[]?] | join(",")' 2>/dev/null)

    echo "  Actual allergens: ${actual_allergens:-none}"
    echo "  Actual FODMAP: ${actual_fodmap:-none}"
    echo "  Nutrition: ${calories} cal, ${protein}g protein"
    echo "  Diet tags: ${diet_tags:-none}"

    # Validation
    allergen_match=true
    fodmap_match=true

    # Check each expected allergen is present
    IFS=',' read -ra EXP_ALLERG <<< "$expected_allergens"
    for allergen in "${EXP_ALLERG[@]}"; do
        if [[ ! "$actual_allergens" == *"$allergen"* ]]; then
            allergen_match=false
            echo "  ⚠️  Missing expected allergen: $allergen"
        fi
    done

    # Basic FODMAP check (at least one expected FODMAP should be present)
    if [[ "$expected_fodmap" != "none" ]]; then
        fodmap_found=false
        IFS=',' read -ra EXP_FODMAP <<< "$expected_fodmap"
        for fodmap in "${EXP_FODMAP[@]}"; do
            if [[ "$actual_fodmap" == *"$fodmap"* ]] || [[ "$actual_fodmap" == *"${fodmap/high_/}"* ]]; then
                fodmap_found=true
            fi
        done
        if [[ "$fodmap_found" == "false" ]]; then
            fodmap_match=false
            echo "  ⚠️  Missing expected FODMAP flags"
        fi
    fi

    # Nutrition sanity check
    if [[ "$calories" == "N/A" ]] || [[ "$calories" == "null" ]] || [[ -z "$calories" ]]; then
        echo "  ⚠️  Missing nutrition data"
        ((WARN++))
    elif (( $(echo "$calories < 50" | bc -l) )) || (( $(echo "$calories > 3000" | bc -l) )); then
        echo "  ⚠️  Unusual calorie value: $calories"
        ((WARN++))
    fi

    if [[ "$allergen_match" == "true" ]] && [[ "$fodmap_match" == "true" ]]; then
        echo "  ✅ PASS"
        ((PASS++))
    else
        echo "  ❌ FAIL - Allergen/FODMAP mismatch"
        ((FAIL++))
    fi

    echo ""

    # Rate limiting - wait between requests
    sleep 2
done

echo "=============================================="
echo "  AUDIT SUMMARY"
echo "=============================================="
echo "  Total dishes tested: 25"
echo "  ✅ Passed: $PASS"
echo "  ❌ Failed: $FAIL"
echo "  ⚠️  Warnings: $WARN"
echo ""
echo "  Pass rate: $(echo "scale=1; $PASS * 100 / 25" | bc)%"
echo ""
echo "  Results saved to: $RESULTS_DIR/"
echo "=============================================="

# Exit with error if too many failures
if (( FAIL > 5 )); then
    exit 1
fi
