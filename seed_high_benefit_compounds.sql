-- High-impact benefit seed (Omega-3, Polyphenols, Vitamin C)

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

-- === Compound → organ edges ===
INSERT OR REPLACE INTO compound_organ_edges (compound_id, organ_id, sign, strength, evidence) VALUES
  (101, (SELECT id FROM organ_systems WHERE organ = 'heart'), +1, 0.8, 'A'),
  (101, (SELECT id FROM organ_systems WHERE organ = 'brain'), +1, 0.6, 'B'),
  (102, (SELECT id FROM organ_systems WHERE organ = 'heart'), +1, 0.5, 'B'),
  (102, (SELECT id FROM organ_systems WHERE organ = 'liver'), +1, 0.4, 'B'),
  (103, (SELECT id FROM organ_systems WHERE organ = 'gut'),   +1, 0.5, 'B'),
  (103, (SELECT id FROM organ_systems WHERE organ = 'heart'), +1, 0.3, 'B');

-- === Ingredient compound yields (mg per 100 g) ===
INSERT OR REPLACE INTO ingredient_compound_yields (ingredient, compound_id, mg_per_100g) VALUES
  ('salmon', 101, 1500),
  ('sardine', 101, 1200),
  ('mackerel', 101, 1400),
  ('olive oil', 102, 200),
  ('green tea', 102, 120),
  ('blueberry', 102, 300),
  ('lemon', 103, 53000),
  ('orange', 103, 53000),
  ('broccoli', 103, 89000);

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
