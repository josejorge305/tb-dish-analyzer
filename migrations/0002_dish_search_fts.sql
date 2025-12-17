-- ============================
-- Dish Search FTS5 Schema
-- Enables typo-tolerant dish name autocomplete
-- ============================

-- Main dishes table for canonical dish names
CREATE TABLE IF NOT EXISTS dishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                    -- Canonical name: "Chicken Parmesan"
  name_normalized TEXT NOT NULL,         -- Lowercase, no punctuation: "chicken parmesan"
  aliases TEXT,                          -- Comma-separated: "chicken parm,chicken parmigiana"
  cuisine TEXT,                          -- e.g. "italian", "mexican", "american"
  category TEXT,                         -- e.g. "entree", "appetizer", "dessert"
  popularity_score INTEGER DEFAULT 0,    -- Higher = more common (for ranking)
  source TEXT,                           -- Where we got it: "spoonacular", "edamam", "user_search"
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Unique index on normalized name to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_dishes_name_normalized ON dishes(name_normalized);

-- Index for cuisine/category filtering
CREATE INDEX IF NOT EXISTS idx_dishes_cuisine ON dishes(cuisine);
CREATE INDEX IF NOT EXISTS idx_dishes_category ON dishes(category);

-- FTS5 virtual table for full-text search with typo tolerance via trigrams
-- We store: name, aliases, and trigrams for fuzzy matching
CREATE VIRTUAL TABLE IF NOT EXISTS dishes_fts USING fts5(
  name,                                  -- "Chicken Parmesan"
  aliases,                               -- "chicken parm,chicken parmigiana"
  trigrams,                              -- "chi hic ick cke ken par arm rme mes esa san"
  content='dishes',                      -- External content table
  content_rowid='id',
  tokenize='porter unicode61'            -- Porter stemming + unicode support
);

-- Triggers to keep FTS in sync with dishes table
CREATE TRIGGER IF NOT EXISTS dishes_ai AFTER INSERT ON dishes BEGIN
  INSERT INTO dishes_fts(rowid, name, aliases, trigrams)
  VALUES (new.id, new.name, new.aliases, new.name_normalized);
END;

CREATE TRIGGER IF NOT EXISTS dishes_ad AFTER DELETE ON dishes BEGIN
  INSERT INTO dishes_fts(dishes_fts, rowid, name, aliases, trigrams)
  VALUES ('delete', old.id, old.name, old.aliases, old.name_normalized);
END;

CREATE TRIGGER IF NOT EXISTS dishes_au AFTER UPDATE ON dishes BEGIN
  INSERT INTO dishes_fts(dishes_fts, rowid, name, aliases, trigrams)
  VALUES ('delete', old.id, old.name, old.aliases, old.name_normalized);
  INSERT INTO dishes_fts(rowid, name, aliases, trigrams)
  VALUES (new.id, new.name, new.aliases, new.name_normalized);
END;

-- Popular dishes seed data (common dishes for immediate autocomplete)
-- This provides a baseline; more dishes added via API scraping
INSERT OR IGNORE INTO dishes (name, name_normalized, aliases, cuisine, category, popularity_score, source) VALUES
  -- Italian
  ('Margherita Pizza', 'margherita pizza', 'pizza margherita,margarita pizza', 'italian', 'entree', 100, 'seed'),
  ('Spaghetti Carbonara', 'spaghetti carbonara', 'carbonara,pasta carbonara', 'italian', 'entree', 95, 'seed'),
  ('Chicken Parmesan', 'chicken parmesan', 'chicken parm,chicken parmigiana,chicken parma', 'italian', 'entree', 98, 'seed'),
  ('Lasagna', 'lasagna', 'lasagne,meat lasagna', 'italian', 'entree', 90, 'seed'),
  ('Fettuccine Alfredo', 'fettuccine alfredo', 'alfredo pasta,fettucine alfredo', 'italian', 'entree', 88, 'seed'),
  ('Linguini Vongole', 'linguini vongole', 'linguine vongole,clam pasta,linguini with clams', 'italian', 'entree', 75, 'seed'),
  ('Caprese Salad', 'caprese salad', 'tomato mozzarella salad,insalata caprese', 'italian', 'appetizer', 80, 'seed'),
  ('Tiramisu', 'tiramisu', 'tiramisù', 'italian', 'dessert', 85, 'seed'),
  ('Risotto', 'risotto', 'mushroom risotto,risotto milanese', 'italian', 'entree', 82, 'seed'),
  ('Bruschetta', 'bruschetta', 'tomato bruschetta', 'italian', 'appetizer', 78, 'seed'),

  -- American
  ('Cheeseburger', 'cheeseburger', 'cheese burger,burger with cheese', 'american', 'entree', 99, 'seed'),
  ('Caesar Salad', 'caesar salad', 'cesear salad,ceasar salad', 'american', 'salad', 92, 'seed'),
  ('Buffalo Wings', 'buffalo wings', 'buffalo chicken wings,hot wings', 'american', 'appetizer', 90, 'seed'),
  ('Mac and Cheese', 'mac and cheese', 'macaroni and cheese,mac n cheese,mac & cheese', 'american', 'side', 88, 'seed'),
  ('BBQ Ribs', 'bbq ribs', 'barbecue ribs,baby back ribs', 'american', 'entree', 85, 'seed'),
  ('Meatloaf', 'meatloaf', 'meat loaf', 'american', 'entree', 75, 'seed'),
  ('Grilled Cheese', 'grilled cheese', 'grilled cheese sandwich', 'american', 'entree', 80, 'seed'),
  ('BLT Sandwich', 'blt sandwich', 'blt,bacon lettuce tomato', 'american', 'entree', 78, 'seed'),
  ('Clam Chowder', 'clam chowder', 'new england clam chowder,clam chowda', 'american', 'soup', 72, 'seed'),
  ('Apple Pie', 'apple pie', 'american apple pie', 'american', 'dessert', 85, 'seed'),

  -- Mexican
  ('Tacos', 'tacos', 'taco,street tacos', 'mexican', 'entree', 97, 'seed'),
  ('Burrito', 'burrito', 'burritos,bean burrito,chicken burrito', 'mexican', 'entree', 95, 'seed'),
  ('Quesadilla', 'quesadilla', 'quesadillas,cheese quesadilla', 'mexican', 'entree', 90, 'seed'),
  ('Guacamole', 'guacamole', 'guac,avocado dip', 'mexican', 'appetizer', 88, 'seed'),
  ('Nachos', 'nachos', 'loaded nachos,nachos supreme', 'mexican', 'appetizer', 86, 'seed'),
  ('Enchiladas', 'enchiladas', 'enchilada,chicken enchiladas', 'mexican', 'entree', 84, 'seed'),
  ('Churros', 'churros', 'churro', 'mexican', 'dessert', 80, 'seed'),
  ('Elote', 'elote', 'mexican street corn,corn on the cob', 'mexican', 'side', 75, 'seed'),

  -- Asian
  ('Pad Thai', 'pad thai', 'padthai,pad thai noodles', 'thai', 'entree', 92, 'seed'),
  ('Fried Rice', 'fried rice', 'chinese fried rice,egg fried rice', 'chinese', 'entree', 90, 'seed'),
  ('General Tso Chicken', 'general tso chicken', 'general tsos chicken,general tso,general tsao', 'chinese', 'entree', 88, 'seed'),
  ('Kung Pao Chicken', 'kung pao chicken', 'kung po chicken,gong bao chicken', 'chinese', 'entree', 85, 'seed'),
  ('Spring Rolls', 'spring rolls', 'egg rolls,spring roll', 'chinese', 'appetizer', 82, 'seed'),
  ('Sushi Roll', 'sushi roll', 'sushi,maki roll', 'japanese', 'entree', 93, 'seed'),
  ('Ramen', 'ramen', 'ramen noodles,japanese ramen', 'japanese', 'entree', 91, 'seed'),
  ('Pho', 'pho', 'pho soup,vietnamese pho,pho bo', 'vietnamese', 'entree', 89, 'seed'),
  ('Bibimbap', 'bibimbap', 'korean rice bowl,bi bim bap', 'korean', 'entree', 82, 'seed'),
  ('Dumplings', 'dumplings', 'potstickers,gyoza,chinese dumplings', 'chinese', 'appetizer', 86, 'seed'),

  -- Indian
  ('Chicken Tikka Masala', 'chicken tikka masala', 'tikka masala,chicken tikka', 'indian', 'entree', 90, 'seed'),
  ('Butter Chicken', 'butter chicken', 'murgh makhani', 'indian', 'entree', 88, 'seed'),
  ('Naan Bread', 'naan bread', 'naan,garlic naan', 'indian', 'side', 85, 'seed'),
  ('Samosa', 'samosa', 'samosas,vegetable samosa', 'indian', 'appetizer', 80, 'seed'),
  ('Biryani', 'biryani', 'chicken biryani,lamb biryani', 'indian', 'entree', 86, 'seed'),
  ('Palak Paneer', 'palak paneer', 'saag paneer,spinach paneer', 'indian', 'entree', 78, 'seed'),

  -- Mediterranean/Middle Eastern
  ('Falafel', 'falafel', 'felafel,falafel wrap', 'mediterranean', 'entree', 82, 'seed'),
  ('Hummus', 'hummus', 'humous,chickpea dip', 'mediterranean', 'appetizer', 88, 'seed'),
  ('Shawarma', 'shawarma', 'chicken shawarma,beef shawarma', 'mediterranean', 'entree', 85, 'seed'),
  ('Greek Salad', 'greek salad', 'horiatiki,mediterranean salad', 'greek', 'salad', 80, 'seed'),
  ('Gyro', 'gyro', 'gyros,greek gyro', 'greek', 'entree', 83, 'seed'),
  ('Kebab', 'kebab', 'kabob,shish kebab,kebabs', 'mediterranean', 'entree', 84, 'seed'),

  -- Breakfast
  ('Pancakes', 'pancakes', 'pancake,flapjacks,hotcakes', 'american', 'breakfast', 90, 'seed'),
  ('French Toast', 'french toast', 'pain perdu', 'american', 'breakfast', 85, 'seed'),
  ('Eggs Benedict', 'eggs benedict', 'egg benedict,benedict', 'american', 'breakfast', 82, 'seed'),
  ('Omelette', 'omelette', 'omelet,omlette', 'american', 'breakfast', 88, 'seed'),
  ('Avocado Toast', 'avocado toast', 'avo toast', 'american', 'breakfast', 80, 'seed'),
  ('Breakfast Burrito', 'breakfast burrito', 'morning burrito', 'mexican', 'breakfast', 78, 'seed'),

  -- Seafood
  ('Fish and Chips', 'fish and chips', 'fish n chips,fish & chips', 'british', 'entree', 85, 'seed'),
  ('Shrimp Scampi', 'shrimp scampi', 'garlic shrimp,scampi', 'italian', 'entree', 82, 'seed'),
  ('Lobster Roll', 'lobster roll', 'maine lobster roll', 'american', 'entree', 80, 'seed'),
  ('Crab Cakes', 'crab cakes', 'crabcakes,maryland crab cakes', 'american', 'appetizer', 78, 'seed'),
  ('Salmon', 'salmon', 'grilled salmon,baked salmon,salmon fillet', 'american', 'entree', 88, 'seed'),

  -- Sandwiches
  ('Club Sandwich', 'club sandwich', 'turkey club,club', 'american', 'entree', 82, 'seed'),
  ('Philly Cheesesteak', 'philly cheesesteak', 'cheesesteak,philadelphia cheesesteak,philly steak', 'american', 'entree', 85, 'seed'),
  ('Reuben Sandwich', 'reuben sandwich', 'reuben,rueben', 'american', 'entree', 78, 'seed'),
  ('Cuban Sandwich', 'cuban sandwich', 'cubano,cuban', 'cuban', 'entree', 80, 'seed'),

  -- Soups
  ('Tomato Soup', 'tomato soup', 'tomato bisque,cream of tomato', 'american', 'soup', 82, 'seed'),
  ('French Onion Soup', 'french onion soup', 'onion soup', 'french', 'soup', 80, 'seed'),
  ('Minestrone', 'minestrone', 'minestrone soup,italian vegetable soup', 'italian', 'soup', 75, 'seed'),
  ('Chicken Noodle Soup', 'chicken noodle soup', 'chicken soup', 'american', 'soup', 85, 'seed'),

  -- Desserts
  ('Cheesecake', 'cheesecake', 'new york cheesecake,cheese cake', 'american', 'dessert', 90, 'seed'),
  ('Chocolate Cake', 'chocolate cake', 'chocolate layer cake', 'american', 'dessert', 88, 'seed'),
  ('Ice Cream', 'ice cream', 'icecream,gelato', 'american', 'dessert', 92, 'seed'),
  ('Creme Brulee', 'creme brulee', 'crème brûlée,creme brulee', 'french', 'dessert', 82, 'seed'),
  ('Brownie', 'brownie', 'chocolate brownie,fudge brownie', 'american', 'dessert', 85, 'seed');
