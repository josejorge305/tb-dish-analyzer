-- ============================
-- Ingredient to Compound Mappings
-- Maps common food ingredients to their bioactive compounds
-- ============================

-- Format: ingredient_pattern is LIKE pattern for matching ingredient names
-- amount_per_100g is approximate mg per 100g of ingredient

-- ============================================================================
-- FISH & SEAFOOD (Omega-3 sources)
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Salmon
('%salmon%', 40, 1000, 'medium', 'EPA content, wild > farmed'),
('%salmon%', 41, 1500, 'medium', 'DHA content, wild > farmed'),
('%salmon%', 23, 0.035, 'medium', 'Selenium'),
('%salmon%', 2, 0.015, 'low', 'Vitamin D3'),

-- Mackerel
('%mackerel%', 40, 900, 'medium', 'EPA'),
('%mackerel%', 41, 1400, 'medium', 'DHA'),
('%mackerel%', 10, 0.019, 'low', 'B12'),

-- Sardines
('%sardine%', 40, 500, 'low', 'EPA'),
('%sardine%', 41, 750, 'low', 'DHA'),
('%sardine%', 25, 382, 'low', 'Calcium from bones'),

-- Tuna
('%tuna%', 40, 300, 'high', 'EPA - varies by species'),
('%tuna%', 41, 900, 'high', 'DHA'),
('%tuna%', 23, 0.090, 'medium', 'Selenium - high'),

-- Shrimp
('%shrimp%', 83, 4, 'low', 'Astaxanthin - gives pink color'),
('%shrimp%', 23, 0.040, 'low', 'Selenium');

-- ============================================================================
-- VEGETABLES
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Broccoli
('%broccoli%', 111, 50, 'high', 'Sulforaphane precursor - cooking reduces'),
('%broccoli%', 1, 89, 'medium', 'Vitamin C'),
('%broccoli%', 4, 0.100, 'low', 'Vitamin K1'),
('%broccoli%', 11, 0.063, 'low', 'Folate'),

-- Spinach
('%spinach%', 81, 12, 'medium', 'Lutein'),
('%spinach%', 82, 0.3, 'medium', 'Zeaxanthin'),
('%spinach%', 4, 0.483, 'low', 'Vitamin K1 - very high'),
('%spinach%', 140, 970, 'medium', 'Oxalate - high'),
('%spinach%', 20, 79, 'low', 'Magnesium'),

-- Kale
('%kale%', 81, 18, 'medium', 'Lutein'),
('%kale%', 4, 0.390, 'low', 'Vitamin K1'),
('%kale%', 1, 93, 'medium', 'Vitamin C'),
('%kale%', 60, 23, 'medium', 'Quercetin'),

-- Tomatoes
('%tomato%', 80, 25, 'medium', 'Lycopene - cooked has 4x more bioavailable'),
('%tomato%', 1, 14, 'medium', 'Vitamin C'),
('%tomato%', 24, 237, 'low', 'Potassium'),

-- Carrots
('%carrot%', 13, 8300, 'medium', 'Beta-carotene'),
('%carrot%', 12, 835, 'medium', 'Vitamin A equivalent'),

-- Sweet potato
('%sweet potato%', 13, 8500, 'medium', 'Beta-carotene'),
('%sweet potato%', 104, 3000, 'medium', 'Resistant starch when cooled'),

-- Bell peppers
('%bell pepper%', 1, 128, 'medium', 'Vitamin C - red highest'),
('%red pepper%', 1, 190, 'low', 'Red bell pepper - highest C'),

-- Garlic (high FODMAP)
('%garlic%', 110, 4400, 'high', 'Allicin precursor - crush and wait 10min'),
('%garlic%', 113, 200, 'medium', 'DADS'),

-- Onion (high FODMAP)
('%onion%', 60, 20, 'medium', 'Quercetin'),
('%onion%', 101, 4000, 'medium', 'Inulin - FODMAP'),

-- Cruciferous
('%brussels sprout%', 111, 35, 'high', 'Sulforaphane precursor'),
('%cabbage%', 114, 100, 'medium', 'Glucosinolates'),
('%cauliflower%', 111, 25, 'high', 'Sulforaphane precursor');

-- ============================================================================
-- FRUITS
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Blueberries
('%blueberr%', 66, 163, 'medium', 'Anthocyanins'),
('%blueberr%', 60, 14, 'medium', 'Quercetin'),

-- Strawberries
('%strawberr%', 1, 59, 'medium', 'Vitamin C'),
('%strawberr%', 67, 2, 'medium', 'Ellagic acid'),

-- Oranges/Citrus
('%orange%', 1, 53, 'low', 'Vitamin C'),
('%orange%', 70, 28, 'medium', 'Hesperidin'),
('%lemon%', 1, 53, 'low', 'Vitamin C'),
('%grapefruit%', 71, 33, 'medium', 'Naringenin'),

-- Berries
('%blackberr%', 66, 100, 'medium', 'Anthocyanins'),
('%raspberr%', 67, 2, 'medium', 'Ellagic acid'),
('%cranberr%', 60, 15, 'medium', 'Quercetin'),

-- Apples
('%apple%', 60, 4, 'medium', 'Quercetin - mostly in skin'),
('%apple%', 102, 1500, 'low', 'Pectin'),

-- Bananas
('%banana%', 24, 358, 'low', 'Potassium'),
('%banana%', 6, 0.031, 'low', 'Vitamin B6'),
('%green banana%', 104, 8500, 'medium', 'Resistant starch'),

-- Avocado
('%avocado%', 24, 485, 'low', 'Potassium'),
('%avocado%', 3, 2.1, 'low', 'Vitamin E'),
('%avocado%', 20, 29, 'low', 'Magnesium');

-- ============================================================================
-- NUTS & SEEDS
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Almonds
('%almond%', 3, 26, 'low', 'Vitamin E'),
('%almond%', 20, 270, 'low', 'Magnesium'),

-- Walnuts
('%walnut%', 42, 9000, 'low', 'ALA omega-3'),
('%walnut%', 67, 59, 'medium', 'Ellagic acid'),

-- Flaxseed
('%flax%', 42, 23000, 'low', 'ALA omega-3 - very high'),
('%flax%', 100, 27000, 'low', 'Fiber/lignans'),

-- Chia seeds
('%chia%', 42, 18000, 'low', 'ALA omega-3'),
('%chia%', 20, 335, 'low', 'Magnesium'),

-- Brazil nuts
('%brazil nut%', 23, 1.9, 'high', 'Selenium - extremely high, 1-2 nuts/day max'),

-- Pumpkin seeds
('%pumpkin seed%', 21, 7.8, 'low', 'Zinc'),
('%pumpkin seed%', 20, 550, 'low', 'Magnesium');

-- ============================================================================
-- GRAINS & LEGUMES
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Oats
('%oat%', 100, 4000, 'low', 'Beta-glucan'),
('%oat%', 20, 177, 'low', 'Magnesium'),

-- Quinoa
('%quinoa%', 60, 36, 'medium', 'Quercetin'),
('%quinoa%', 20, 197, 'low', 'Magnesium'),
('%quinoa%', 129, 630, 'low', 'Betaine'),

-- Lentils
('%lentil%', 11, 0.181, 'low', 'Folate'),
('%lentil%', 22, 6.5, 'low', 'Iron'),
('%lentil%', 141, 500, 'medium', 'Phytate'),

-- Black beans
('%black bean%', 66, 50, 'medium', 'Anthocyanins'),
('%bean%', 141, 600, 'medium', 'Phytate - reduced by soaking'),
('%bean%', 104, 2500, 'medium', 'Resistant starch');

-- ============================================================================
-- PROTEINS
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Eggs
('%egg%', 128, 250, 'low', 'Choline - mostly in yolk'),
('%egg%', 81, 0.5, 'low', 'Lutein'),
('%egg%', 2, 0.002, 'medium', 'Vitamin D'),

-- Liver (chicken/beef)
('%liver%', 12, 9400, 'low', 'Vitamin A - extremely high'),
('%liver%', 10, 0.080, 'low', 'Vitamin B12 - very high'),
('%liver%', 128, 420, 'low', 'Choline'),
('%liver%', 22, 9, 'low', 'Iron'),

-- Beef
('%beef%', 21, 5, 'medium', 'Zinc'),
('%beef%', 10, 0.002, 'low', 'B12'),
('%beef%', 22, 2.6, 'medium', 'Iron - heme form');

-- ============================================================================
-- HERBS & SPICES
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Turmeric
('%turmeric%', 65, 3000, 'medium', 'Curcumin'),

-- Ginger
('%ginger%', 124, 2000, 'medium', 'Gingerols'),

-- Black pepper
('%black pepper%', 123, 6000, 'low', 'Piperine'),
('%pepper%', 123, 100, 'high', 'If black pepper'),

-- Cinnamon
('%cinnamon%', 68, 8000, 'medium', 'Polyphenols'),

-- Rosemary
('%rosemary%', 69, 2000, 'medium', 'Rosmarinic acid'),

-- Oregano
('%oregano%', 69, 1800, 'medium', 'Rosmarinic acid'),

-- Parsley
('%parsley%', 72, 4500, 'low', 'Apigenin'),
('%parsley%', 4, 1.6, 'low', 'Vitamin K');

-- ============================================================================
-- BEVERAGES
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Green tea
('%green tea%', 62, 70, 'medium', 'EGCG per cup (240ml)'),
('%green tea%', 63, 100, 'medium', 'Total catechins'),
('%green tea%', 90, 25, 'low', 'L-theanine per cup'),
('%green tea%', 120, 30, 'medium', 'Caffeine per cup'),

-- Coffee
('%coffee%', 120, 95, 'high', 'Caffeine per cup'),
('%coffee%', 68, 200, 'medium', 'Chlorogenic acid'),

-- Cocoa/Chocolate
('%cocoa%', 63, 600, 'medium', 'Flavanols'),
('%cocoa%', 121, 2000, 'low', 'Theobromine'),
('%dark chocolate%', 63, 200, 'high', 'Flavanols - varies by processing'),
('%dark chocolate%', 20, 228, 'low', 'Magnesium');

-- ============================================================================
-- OILS
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Olive oil
('%olive oil%', 45, 73000, 'low', 'Oleic acid'),
('%olive oil%', 3, 14, 'low', 'Vitamin E'),
-- Note: polyphenols in extra virgin only
('%extra virgin%', 60, 200, 'high', 'Polyphenols in EVOO'),

-- Fish oil
('%fish oil%', 40, 18000, 'medium', 'EPA'),
('%fish oil%', 41, 12000, 'medium', 'DHA'),

-- Flaxseed oil
('%flaxseed oil%', 42, 53000, 'low', 'ALA'),
('%flax oil%', 42, 53000, 'low', 'ALA');

-- ============================================================================
-- DAIRY
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Yogurt
('%yogurt%', 25, 120, 'low', 'Calcium'),
('%yogurt%', 10, 0.0005, 'low', 'B12'),

-- Cheese
('%cheese%', 25, 700, 'medium', 'Calcium - varies by type'),
('%cheese%', 5, 0.050, 'medium', 'Vitamin K2 in aged cheese'),

-- Milk
('%milk%', 25, 120, 'low', 'Calcium'),
('%milk%', 2, 0.001, 'medium', 'Vitamin D if fortified');

-- ============================================================================
-- PROBLEMATIC FOODS (for flagging)
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Alcohol
('%wine%', 145, 10000, 'low', 'Alcohol ~10g per glass'),
('%beer%', 145, 5000, 'medium', 'Alcohol ~5g per serving'),
('%vodka%', 145, 35000, 'low', 'Alcohol'),
('%whiskey%', 145, 35000, 'low', 'Alcohol'),
('%cocktail%', 145, 15000, 'high', 'Alcohol varies'),

-- Added sugars
('%soda%', 147, 11000, 'low', 'Added sugar per 12oz'),
('%candy%', 147, 50000, 'medium', 'Added sugars'),
('%cake%', 147, 25000, 'high', 'Added sugars'),
('%cookie%', 147, 30000, 'high', 'Added sugars'),
('%ice cream%', 147, 21000, 'medium', 'Added sugars'),

-- High sodium processed foods
('%bacon%', 149, 1500, 'medium', 'Sodium'),
('%ham%', 149, 1200, 'medium', 'Sodium'),
('%sausage%', 149, 800, 'high', 'Sodium'),
('%chips%', 149, 500, 'medium', 'Sodium per serving');
