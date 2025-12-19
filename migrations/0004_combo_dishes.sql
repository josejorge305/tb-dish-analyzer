-- ============================
-- Combo Dish Decomposition Schema
-- ============================
-- Stores known combo/platter dishes with their components
-- for fast lookup without LLM decomposition

-- Table: combo_dishes (parent combo definitions)
CREATE TABLE IF NOT EXISTS combo_dishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dish_name TEXT NOT NULL,                -- normalized name (lowercase, trimmed)
  display_name TEXT NOT NULL,             -- display name (e.g., "Grand Slam Breakfast")
  restaurant_chain TEXT,                  -- e.g., "dennys", "ihop", null for generic
  aliases_json TEXT,                      -- JSON array of alternate names
  total_calories INTEGER,                 -- optional pre-computed total
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now')),
  UNIQUE(dish_name, restaurant_chain)
);

-- Table: combo_components (individual items in a combo)
CREATE TABLE IF NOT EXISTS combo_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_id INTEGER NOT NULL REFERENCES combo_dishes(id) ON DELETE CASCADE,
  component_name TEXT NOT NULL,           -- e.g., "Pancakes", "Bacon"
  role TEXT DEFAULT 'side',               -- 'main' or 'side'
  default_quantity REAL DEFAULT 1,        -- e.g., 2 for "2 eggs"
  default_unit TEXT,                      -- e.g., "strips", "pieces"
  fatsecret_food_id TEXT,                 -- cached FatSecret food ID
  calories_per_unit INTEGER,              -- cached calories
  protein_g REAL,
  fat_g REAL,
  carbs_g REAL,
  allergens_json TEXT,                    -- cached allergen flags JSON
  fodmap_level TEXT,                      -- cached FODMAP level
  lactose_level TEXT,                     -- cached lactose level
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Index for fast combo lookup
CREATE INDEX IF NOT EXISTS idx_combo_dishes_name ON combo_dishes(dish_name);
CREATE INDEX IF NOT EXISTS idx_combo_dishes_restaurant ON combo_dishes(restaurant_chain);
CREATE INDEX IF NOT EXISTS idx_combo_components_combo ON combo_components(combo_id);

-- ============================
-- Seed Data: Common Combo Dishes
-- ============================

-- Denny's Grand Slam
INSERT OR IGNORE INTO combo_dishes (dish_name, display_name, restaurant_chain, aliases_json)
VALUES ('grand slam', 'Grand Slam Breakfast', 'dennys', '["grand slam breakfast", "dennys grand slam", "original grand slam"]');

INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Buttermilk Pancakes', 'main', 2, 'pieces', 1 FROM combo_dishes WHERE dish_name = 'grand slam' AND restaurant_chain = 'dennys';
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Scrambled Eggs', 'side', 2, 'eggs', 2 FROM combo_dishes WHERE dish_name = 'grand slam' AND restaurant_chain = 'dennys';
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Bacon Strips', 'side', 2, 'strips', 3 FROM combo_dishes WHERE dish_name = 'grand slam' AND restaurant_chain = 'dennys';
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Sausage Links', 'side', 2, 'links', 4 FROM combo_dishes WHERE dish_name = 'grand slam' AND restaurant_chain = 'dennys';

-- Denny's Lumberjack Slam
INSERT OR IGNORE INTO combo_dishes (dish_name, display_name, restaurant_chain, aliases_json)
VALUES ('lumberjack slam', 'Lumberjack Slam', 'dennys', '["lumberjack breakfast"]');

INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Buttermilk Pancakes', 'main', 2, 'pieces', 1 FROM combo_dishes WHERE dish_name = 'lumberjack slam' AND restaurant_chain = 'dennys';
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Scrambled Eggs', 'side', 2, 'eggs', 2 FROM combo_dishes WHERE dish_name = 'lumberjack slam' AND restaurant_chain = 'dennys';
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Bacon Strips', 'side', 2, 'strips', 3 FROM combo_dishes WHERE dish_name = 'lumberjack slam' AND restaurant_chain = 'dennys';
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Sausage Links', 'side', 2, 'links', 4 FROM combo_dishes WHERE dish_name = 'lumberjack slam' AND restaurant_chain = 'dennys';
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Hash Browns', 'side', 1, 'serving', 5 FROM combo_dishes WHERE dish_name = 'lumberjack slam' AND restaurant_chain = 'dennys';
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Grilled Ham Slice', 'side', 1, 'slice', 6 FROM combo_dishes WHERE dish_name = 'lumberjack slam' AND restaurant_chain = 'dennys';

-- IHOP Big Steak Omelette
INSERT OR IGNORE INTO combo_dishes (dish_name, display_name, restaurant_chain, aliases_json)
VALUES ('big steak omelette', 'Big Steak Omelette', 'ihop', '["steak omelette"]');

INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Steak and Cheese Omelette', 'main', 1, 'serving', 1 FROM combo_dishes WHERE dish_name = 'big steak omelette' AND restaurant_chain = 'ihop';
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Hash Browns', 'side', 1, 'serving', 2 FROM combo_dishes WHERE dish_name = 'big steak omelette' AND restaurant_chain = 'ihop';
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Buttermilk Pancakes', 'side', 2, 'pieces', 3 FROM combo_dishes WHERE dish_name = 'big steak omelette' AND restaurant_chain = 'ihop';

-- Generic Full English Breakfast
INSERT OR IGNORE INTO combo_dishes (dish_name, display_name, restaurant_chain, aliases_json)
VALUES ('full english breakfast', 'Full English Breakfast', NULL, '["english breakfast", "fry up", "full english", "full breakfast"]');

INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Fried Eggs', 'main', 2, 'eggs', 1 FROM combo_dishes WHERE dish_name = 'full english breakfast' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Bacon Rashers', 'side', 2, 'rashers', 2 FROM combo_dishes WHERE dish_name = 'full english breakfast' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Pork Sausages', 'side', 2, 'links', 3 FROM combo_dishes WHERE dish_name = 'full english breakfast' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Baked Beans', 'side', 1, 'serving', 4 FROM combo_dishes WHERE dish_name = 'full english breakfast' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Grilled Tomato', 'side', 1, 'half', 5 FROM combo_dishes WHERE dish_name = 'full english breakfast' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Sauteed Mushrooms', 'side', 1, 'serving', 6 FROM combo_dishes WHERE dish_name = 'full english breakfast' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Toast', 'side', 2, 'slices', 7 FROM combo_dishes WHERE dish_name = 'full english breakfast' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Black Pudding', 'side', 1, 'slice', 8 FROM combo_dishes WHERE dish_name = 'full english breakfast' AND restaurant_chain IS NULL;

-- Generic American Breakfast Combo
INSERT OR IGNORE INTO combo_dishes (dish_name, display_name, restaurant_chain, aliases_json)
VALUES ('american breakfast', 'American Breakfast', NULL, '["breakfast combo", "classic breakfast", "eggs and bacon breakfast"]');

INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Scrambled Eggs', 'main', 2, 'eggs', 1 FROM combo_dishes WHERE dish_name = 'american breakfast' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Bacon Strips', 'side', 3, 'strips', 2 FROM combo_dishes WHERE dish_name = 'american breakfast' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Toast', 'side', 2, 'slices', 3 FROM combo_dishes WHERE dish_name = 'american breakfast' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Hash Browns', 'side', 1, 'serving', 4 FROM combo_dishes WHERE dish_name = 'american breakfast' AND restaurant_chain IS NULL;

-- Meze/Mezze Platter
INSERT OR IGNORE INTO combo_dishes (dish_name, display_name, restaurant_chain, aliases_json)
VALUES ('meze platter', 'Meze Platter', NULL, '["mezze platter", "mediterranean platter", "greek platter"]');

INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Hummus', 'main', 1, 'serving', 1 FROM combo_dishes WHERE dish_name = 'meze platter' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Baba Ganoush', 'side', 1, 'serving', 2 FROM combo_dishes WHERE dish_name = 'meze platter' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Falafel', 'side', 4, 'pieces', 3 FROM combo_dishes WHERE dish_name = 'meze platter' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Pita Bread', 'side', 2, 'pieces', 4 FROM combo_dishes WHERE dish_name = 'meze platter' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Tabbouleh', 'side', 1, 'serving', 5 FROM combo_dishes WHERE dish_name = 'meze platter' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Olives', 'side', 1, 'serving', 6 FROM combo_dishes WHERE dish_name = 'meze platter' AND restaurant_chain IS NULL;

-- Dim Sum Sampler
INSERT OR IGNORE INTO combo_dishes (dish_name, display_name, restaurant_chain, aliases_json)
VALUES ('dim sum sampler', 'Dim Sum Sampler', NULL, '["dim sum platter", "dumpling sampler", "dim sum combo"]');

INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Har Gow (Shrimp Dumplings)', 'main', 3, 'pieces', 1 FROM combo_dishes WHERE dish_name = 'dim sum sampler' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Siu Mai (Pork Dumplings)', 'side', 3, 'pieces', 2 FROM combo_dishes WHERE dish_name = 'dim sum sampler' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Char Siu Bao (BBQ Pork Buns)', 'side', 2, 'pieces', 3 FROM combo_dishes WHERE dish_name = 'dim sum sampler' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Spring Rolls', 'side', 2, 'pieces', 4 FROM combo_dishes WHERE dish_name = 'dim sum sampler' AND restaurant_chain IS NULL;

-- Appetizer Sampler / Appetizer Platter
INSERT OR IGNORE INTO combo_dishes (dish_name, display_name, restaurant_chain, aliases_json)
VALUES ('appetizer sampler', 'Appetizer Sampler', NULL, '["appetizer platter", "starter sampler", "app sampler"]');

INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Mozzarella Sticks', 'main', 4, 'pieces', 1 FROM combo_dishes WHERE dish_name = 'appetizer sampler' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Chicken Wings', 'side', 4, 'pieces', 2 FROM combo_dishes WHERE dish_name = 'appetizer sampler' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Onion Rings', 'side', 4, 'pieces', 3 FROM combo_dishes WHERE dish_name = 'appetizer sampler' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Jalapeno Poppers', 'side', 4, 'pieces', 4 FROM combo_dishes WHERE dish_name = 'appetizer sampler' AND restaurant_chain IS NULL;

-- Sushi Combo / Sushi Platter
INSERT OR IGNORE INTO combo_dishes (dish_name, display_name, restaurant_chain, aliases_json)
VALUES ('sushi combo', 'Sushi Combo', NULL, '["sushi platter", "sushi sampler", "sashimi combo"]');

INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'California Roll', 'main', 6, 'pieces', 1 FROM combo_dishes WHERE dish_name = 'sushi combo' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Salmon Nigiri', 'side', 2, 'pieces', 2 FROM combo_dishes WHERE dish_name = 'sushi combo' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Tuna Nigiri', 'side', 2, 'pieces', 3 FROM combo_dishes WHERE dish_name = 'sushi combo' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Miso Soup', 'side', 1, 'bowl', 4 FROM combo_dishes WHERE dish_name = 'sushi combo' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Edamame', 'side', 1, 'serving', 5 FROM combo_dishes WHERE dish_name = 'sushi combo' AND restaurant_chain IS NULL;

-- Taco Combo
INSERT OR IGNORE INTO combo_dishes (dish_name, display_name, restaurant_chain, aliases_json)
VALUES ('taco combo', 'Taco Combo', NULL, '["taco platter", "3 taco combo", "taco meal"]');

INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Beef Taco', 'main', 2, 'tacos', 1 FROM combo_dishes WHERE dish_name = 'taco combo' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Chicken Taco', 'side', 1, 'taco', 2 FROM combo_dishes WHERE dish_name = 'taco combo' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Rice', 'side', 1, 'serving', 3 FROM combo_dishes WHERE dish_name = 'taco combo' AND restaurant_chain IS NULL;
INSERT INTO combo_components (combo_id, component_name, role, default_quantity, default_unit, sort_order)
SELECT id, 'Refried Beans', 'side', 1, 'serving', 4 FROM combo_dishes WHERE dish_name = 'taco combo' AND restaurant_chain IS NULL;
