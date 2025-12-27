-- ============================
-- Additional Ingredient Mappings for New Organs
-- Eyes, Skin, Bones, Thyroid specific foods
-- ============================

-- ============================================================================
-- EYES - Lutein/Zeaxanthin rich foods
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Egg yolk (best bioavailable source)
('%egg yolk%', 81, 1.1, 'medium', 'Lutein - highly bioavailable due to fat matrix'),
('%egg yolk%', 82, 0.4, 'medium', 'Zeaxanthin'),

-- Leafy greens (high content but lower bioavailability)
('%kale%', 81, 39, 'medium', 'Lutein - very high, eat with fat'),
('%kale%', 82, 0.2, 'medium', 'Zeaxanthin'),
('%collard%', 81, 16, 'medium', 'Lutein'),
('%turnip green%', 81, 12, 'medium', 'Lutein'),
('%spinach%', 81, 12, 'medium', 'Lutein'),
('%swiss chard%', 81, 11, 'medium', 'Lutein'),
('%romaine%', 81, 5, 'low', 'Lutein'),
('%lettuce%', 81, 2, 'medium', 'Lutein varies by type'),

-- Orange/yellow vegetables
('%corn%', 81, 1.4, 'low', 'Lutein'),
('%corn%', 82, 0.5, 'low', 'Zeaxanthin - good source'),
('%orange pepper%', 81, 1.6, 'low', 'Lutein'),
('%orange pepper%', 82, 1.7, 'low', 'Zeaxanthin'),
('%squash%', 81, 2.1, 'medium', 'Lutein'),

-- Goji berries (zeaxanthin champion)
('%goji%', 82, 26, 'medium', 'Zeaxanthin - highest known food source'),

-- Pistachios
('%pistachio%', 81, 1.2, 'low', 'Lutein - highest among nuts');

-- ============================================================================
-- SKIN - Collagen and antioxidant rich foods
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Bone broth (glycine/collagen)
('%bone broth%', 94, 3500, 'high', 'Glycine - varies by preparation'),
('%collagen%', 94, 10000, 'medium', 'Glycine in collagen supplements'),
('%gelatin%', 94, 8500, 'low', 'Glycine'),

-- Astaxanthin sources
('%wild salmon%', 83, 4, 'medium', 'Astaxanthin - wild only'),
('%sockeye%', 83, 4.5, 'low', 'Astaxanthin - highest in sockeye'),
('%trout%', 83, 1, 'medium', 'Astaxanthin'),
('%shrimp%', 83, 4, 'low', 'Astaxanthin'),
('%lobster%', 83, 2, 'medium', 'Astaxanthin'),
('%crab%', 83, 1.5, 'medium', 'Astaxanthin'),
('%krill%', 83, 1.5, 'low', 'Astaxanthin'),

-- Red/orange produce for skin
('%red bell pepper%', 1, 190, 'low', 'Vitamin C - highest common vegetable'),
('%guava%', 1, 228, 'low', 'Vitamin C - extremely high'),
('%papaya%', 1, 62, 'low', 'Vitamin C'),
('%kiwi%', 1, 93, 'low', 'Vitamin C'),
('%acerola%', 1, 1677, 'low', 'Vitamin C - highest fruit'),
('%camu camu%', 1, 2800, 'medium', 'Vitamin C - extremely high');

-- ============================================================================
-- BONES - Calcium and Vitamin K2 rich foods
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Dairy calcium sources
('%parmesan%', 25, 1184, 'low', 'Calcium - highest common cheese'),
('%gruyere%', 25, 1011, 'low', 'Calcium'),
('%cheddar%', 25, 721, 'low', 'Calcium'),
('%mozzarella%', 25, 505, 'low', 'Calcium'),
('%cottage cheese%', 25, 83, 'low', 'Calcium'),
('%yogurt%', 25, 121, 'low', 'Calcium'),
('%milk%', 25, 125, 'low', 'Calcium'),
('%kefir%', 25, 130, 'low', 'Calcium'),

-- Non-dairy calcium
('%sardine%', 25, 382, 'low', 'Calcium - bones are edible'),
('%canned salmon%', 25, 232, 'low', 'Calcium - from bones'),
('%tofu%', 25, 350, 'high', 'Calcium - if calcium-set'),
('%bok choy%', 25, 105, 'low', 'Calcium - highly bioavailable'),
('%collard%', 25, 232, 'low', 'Calcium'),
('%fortified%', 25, 300, 'high', 'Calcium - check label'),

-- Vitamin K2 sources (fermented foods)
('%natto%', 5, 1.1, 'medium', 'Vitamin K2 MK-7 - highest food source'),
('%gouda%', 5, 0.075, 'low', 'Vitamin K2 - aged cheese'),
('%brie%', 5, 0.050, 'low', 'Vitamin K2'),
('%aged cheese%', 5, 0.060, 'medium', 'Vitamin K2 - varies'),
('%egg yolk%', 5, 0.032, 'low', 'Vitamin K2 MK-4'),
('%chicken liver%', 5, 0.014, 'low', 'Vitamin K2 MK-4'),
('%butter%', 5, 0.015, 'medium', 'Vitamin K2 - grass-fed higher'),
('%grass-fed%', 5, 0.030, 'medium', 'Vitamin K2 - ~2x conventional'),

-- Vitamin D food sources
('%cod liver oil%', 2, 0.250, 'low', 'Vitamin D - extremely high'),
('%salmon%', 2, 0.011, 'medium', 'Vitamin D - wild > farmed'),
('%sardine%', 2, 0.005, 'low', 'Vitamin D'),
('%mackerel%', 2, 0.016, 'low', 'Vitamin D'),
('%tuna%', 2, 0.005, 'medium', 'Vitamin D'),
('%mushroom%', 2, 0.001, 'high', 'Vitamin D2 - UV-exposed much higher'),
('%uv mushroom%', 2, 0.010, 'medium', 'Vitamin D2 - UV exposed'),

-- Vitamin K1 sources (for bone matrix)
('%kale%', 4, 0.817, 'low', 'Vitamin K1'),
('%spinach%', 4, 0.483, 'low', 'Vitamin K1'),
('%broccoli%', 4, 0.102, 'low', 'Vitamin K1'),
('%brussels%', 4, 0.177, 'low', 'Vitamin K1'),
('%asparagus%', 4, 0.042, 'low', 'Vitamin K1');

-- ============================================================================
-- THYROID - Iodine and Selenium rich foods
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Iodine sources (values in mg, so 0.150 = 150mcg)
('%seaweed%', 31, 4.5, 'high', 'Iodine - extremely variable, can be too high'),
('%kelp%', 31, 2.0, 'high', 'Iodine - very high, use caution'),
('%nori%', 31, 0.037, 'medium', 'Iodine - more moderate'),
('%wakame%', 31, 0.066, 'medium', 'Iodine'),
('%cod%', 31, 0.110, 'medium', 'Iodine'),
('%shrimp%', 31, 0.035, 'low', 'Iodine'),
('%tuna%', 31, 0.017, 'medium', 'Iodine'),
('%egg%', 31, 0.024, 'low', 'Iodine'),
('%iodized salt%', 31, 4.5, 'low', 'Iodine - 1/4 tsp = 70mcg'),
('%dairy%', 31, 0.042, 'medium', 'Iodine - from iodine supplements to cows'),

-- Selenium sources
('%brazil nut%', 23, 1.9, 'high', 'Selenium - 1-2 nuts/day max, extremely high'),
('%yellowfin tuna%', 23, 0.090, 'low', 'Selenium'),
('%halibut%', 23, 0.047, 'low', 'Selenium'),
('%sardine%', 23, 0.052, 'low', 'Selenium'),
('%shrimp%', 23, 0.040, 'low', 'Selenium'),
('%chicken breast%', 23, 0.027, 'low', 'Selenium'),
('%cottage cheese%', 23, 0.020, 'low', 'Selenium'),
('%brown rice%', 23, 0.010, 'medium', 'Selenium - varies by soil'),
('%oat%', 23, 0.034, 'medium', 'Selenium'),
('%mushroom%', 23, 0.012, 'medium', 'Selenium'),

-- Goitrogen sources (for caution flagging)
('%raw kale%', 144, 100, 'medium', 'Goitrogens - cooking reduces'),
('%raw broccoli%', 144, 80, 'medium', 'Goitrogens'),
('%raw cabbage%', 144, 90, 'medium', 'Goitrogens'),
('%raw brussels%', 144, 85, 'medium', 'Goitrogens'),
('%raw cauliflower%', 144, 75, 'medium', 'Goitrogens'),
('%soy%', 144, 50, 'medium', 'Goitrogens - isoflavones'),
('%millet%', 144, 60, 'low', 'Goitrogens');

-- ============================================================================
-- SYNERGY FOODS - Multiple beneficial compounds
-- ============================================================================

INSERT OR REPLACE INTO ingredient_compounds (ingredient_pattern, compound_id, amount_per_100g, variability, notes) VALUES
-- Eggs - multi-organ benefits
('%egg%', 128, 147, 'low', 'Choline - whole egg'),
('%egg%', 12, 0.160, 'low', 'Vitamin A'),
('%egg%', 41, 80, 'medium', 'DHA - enriched eggs higher'),

-- Liver - nutrient powerhouse
('%beef liver%', 12, 16898, 'low', 'Vitamin A - extremely high'),
('%beef liver%', 10, 0.071, 'low', 'Vitamin B12'),
('%beef liver%', 22, 4.9, 'low', 'Iron'),
('%beef liver%', 128, 333, 'low', 'Choline'),
('%beef liver%', 21, 4.0, 'low', 'Zinc'),

('%chicken liver%', 12, 3296, 'low', 'Vitamin A'),
('%chicken liver%', 10, 0.017, 'low', 'Vitamin B12'),
('%chicken liver%', 22, 9.0, 'low', 'Iron'),
('%chicken liver%', 11, 0.578, 'low', 'Folate'),

-- Oysters - zinc champion
('%oyster%', 21, 78, 'medium', 'Zinc - highest food source'),
('%oyster%', 10, 0.016, 'low', 'Vitamin B12'),
('%oyster%', 23, 0.077, 'low', 'Selenium'),
('%oyster%', 22, 5.1, 'low', 'Iron'),

-- Sweet potato - eyes and skin
('%sweet potato%', 13, 14187, 'low', 'Beta-carotene'),
('%sweet potato%', 1, 2.4, 'low', 'Vitamin C');
