-- (same content I gave you earlier)
-- ===============================
-- Tummy Buddy V13.2: Edge Seeding
-- ===============================

INSERT OR IGNORE INTO organ_systems (slug, name) VALUES
 ('gut','Gut'),('liver','Liver'),('heart','Heart'),('brain','Brain'),('kidney','Kidney'),('immune','Immune');

CREATE UNIQUE INDEX IF NOT EXISTS idx_compounds_slug ON compounds (slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organ_systems_slug ON organ_systems (slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique ON compound_organ_edges (compound_slug, organ_slug, sign);

INSERT OR IGNORE INTO compounds (slug, name) VALUES
 ('omega_3_epa_dha','Omega-3 (EPA+DHA)'),('catechins','Catechins'),('anthocyanins','Anthocyanins'),
 ('theanine','L-Theanine'),('lutein_zeaxanthin','Lutein+Zeaxanthin'),('flavanols','Flavanols'),
 ('soluble_fiber','Soluble Fiber'),('beta_glucan','Beta-Glucan'),('allicin','Allicin (Organosulfur)'),
 ('isothiocyanates','Isothiocyanates'),('sulforaphane','Sulforaphane'),('curcumin','Curcumin'),
 ('capsaicin','Capsaicin'),('nitrate','Dietary Nitrate'),('lycopene','Lycopene'),('beta_carotene','Beta-Carotene'),
 ('magnesium','Magnesium'),('phosphorus','Phosphorus'),('oxalate','Oxalate'),('choline','Choline'),
 ('alcohol_ethanol','Alcohol (Ethanol)'),('fructose','Fructose'),('added_sugars','Added Sugars'),
 ('vitamin_c','Vitamin C'),('zinc','Zinc'),('inulin','Inulin (FODMAP)'),('caffeine','Caffeine');

-- Brain (6)
INSERT OR REPLACE INTO compound_organ_edges (compound_slug, organ_slug, sign, strength, threshold, evidence_tier) VALUES
 ('omega_3_epa_dha','brain','benefit',0.85,250,'A'),
 ('catechins','brain','benefit',0.60,40,'B'),
 ('anthocyanins','brain','benefit',0.55,50,'B'),
 ('theanine','brain','benefit',0.50,50,'B'),
 ('lutein_zeaxanthin','brain','benefit',0.50,8,'B'),
 ('caffeine','brain','caution',0.50,180,'A');

-- Kidney (4)
INSERT OR REPLACE INTO compound_organ_edges VALUES
 ('potassium','kidney','benefit',0.60,1200,'A'),
 ('magnesium','kidney','benefit',0.45,200,'B'),
 ('phosphorus','kidney','caution',0.65,700,'A'),
 ('oxalate','kidney','caution',0.55,100,'B');

-- Heart (5)
INSERT OR REPLACE INTO compound_organ_edges VALUES
 ('soluble_fiber','heart','benefit',0.70,3,'A'),
 ('beta_glucan','heart','benefit',0.70,3,'A'),
 ('flavanols','heart','benefit',0.55,50,'B'),
 ('lycopene','heart','benefit',0.50,10,'B'),
 ('added_sugars','heart','caution',0.60,25,'A');

-- Liver (3)
INSERT OR REPLACE INTO compound_organ_edges VALUES
 ('alcohol_ethanol','liver','caution',0.80,10,'A'),
 ('fructose','liver','caution',0.55,25,'B'),
 ('choline','liver','benefit',0.50,200,'B');

-- Gut (2)
INSERT OR REPLACE INTO compound_organ_edges VALUES
 ('inulin','gut','caution',0.55,5,'B'),
 ('capsaicin','gut','caution',0.45,50,'B');

-- Immune (2)
INSERT OR REPLACE INTO compound_organ_edges VALUES
 ('vitamin_c','immune','benefit',0.50,60,'B'),
 ('zinc','immune','benefit',0.55,8,'A');
