-- High-impact benefit seed (Omega-3, Polyphenols, Vitamin C)
-- REQUIRES: migration 0006_ingredient_brain_cache.sql to be applied first

-- === Compounds ===
INSERT OR IGNORE INTO compounds (id, name, description) VALUES
  (101, 'Omega-3 (EPA/DHA)', 'Marine omega-3 fatty acids'),
  (102, 'Polyphenols', 'Broad class of antioxidant phytochemicals'),
  (103, 'Vitamin C', 'Ascorbic acid, water-soluble vitamin');

-- === Organ systems (ensure present) ===
INSERT OR IGNORE INTO organ_systems (organ, system, description) VALUES
  ('heart', 'Cardiovascular', 'Cardiac muscle and vessels'),
  ('brain', 'Nervous', 'Central nervous system support'),
  ('gut', 'Digestive', 'Gastrointestinal tract'),
  ('liver', 'Digestive', 'Hepatic metabolism and detox'),
  ('kidney', 'Renal', 'Renal filtration and regulation');

-- === Compound → organ effects (uses compound_organ_effects table, NOT compound_organ_edges) ===
INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes) VALUES
  (101, 'heart', 'benefit', 4, 'Strong evidence for cardiovascular health'),
  (101, 'brain', 'benefit', 3, 'Supports cognitive function'),
  (102, 'heart', 'benefit', 3, 'Antioxidant cardioprotection'),
  (102, 'liver', 'benefit', 2, 'Hepatoprotective properties'),
  (103, 'gut', 'benefit', 3, 'Supports gut lining integrity'),
  (103, 'heart', 'benefit', 2, 'Mild cardiovascular benefit');

-- === Ingredients (must exist before yields) ===
INSERT OR IGNORE INTO ingredients (name, name_normalized, food_group) VALUES
  ('Salmon', 'salmon', 'seafood'),
  ('Sardine', 'sardine', 'seafood'),
  ('Mackerel', 'mackerel', 'seafood'),
  ('Olive Oil', 'olive oil', 'oils'),
  ('Green Tea', 'green tea', 'beverages'),
  ('Blueberry', 'blueberry', 'fruits'),
  ('Lemon', 'lemon', 'fruits'),
  ('Orange', 'orange', 'fruits'),
  ('Broccoli', 'broccoli', 'vegetables');

-- === Ingredient compound yields (mg per 100g) ===
INSERT OR REPLACE INTO ingredient_compound_yields (ingredient_id, compound_id, mg_per_100g, source) VALUES
  ((SELECT id FROM ingredients WHERE name_normalized = 'salmon'), 101, 1500, 'usda_fdc'),
  ((SELECT id FROM ingredients WHERE name_normalized = 'sardine'), 101, 1200, 'usda_fdc'),
  ((SELECT id FROM ingredients WHERE name_normalized = 'mackerel'), 101, 1400, 'usda_fdc'),
  ((SELECT id FROM ingredients WHERE name_normalized = 'olive oil'), 102, 200, 'literature'),
  ((SELECT id FROM ingredients WHERE name_normalized = 'green tea'), 102, 120, 'literature'),
  ((SELECT id FROM ingredients WHERE name_normalized = 'blueberry'), 102, 300, 'literature'),
  ((SELECT id FROM ingredients WHERE name_normalized = 'lemon'), 103, 53, 'usda_fdc'),
  ((SELECT id FROM ingredients WHERE name_normalized = 'orange'), 103, 53, 'usda_fdc'),
  ((SELECT id FROM ingredients WHERE name_normalized = 'broccoli'), 103, 89, 'usda_fdc');

-- === Cooking factors ===
INSERT OR REPLACE INTO cooking_factors (method, compound_id, factor) VALUES
  ('raw',   103, 1.0),
  ('boil',  103, 0.7),
  ('steam', 103, 0.85),
  ('saute', 103, 0.9),
  ('saute', 102, 1.1),
  ('roast', 102, 1.15),
  ('saute', 101, 0.95),
  ('bake',  101, 0.9);
