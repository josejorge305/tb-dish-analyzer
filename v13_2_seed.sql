-- ===============================
-- Tummy Buddy V13.2: Edge Seeding
-- ===============================
-- NOTE: Updated to use compound_organ_effects (NOT compound_organ_edges)
-- The actual schema uses: compound_id, organ, effect, strength, notes

-- Ensure organ systems exist
INSERT OR IGNORE INTO organ_systems (organ, system, description) VALUES
  ('gut', 'Digestive', 'Gastrointestinal tract and microbiome'),
  ('liver', 'Digestive', 'Hepatic metabolism and detox'),
  ('heart', 'Cardiovascular', 'Cardiac muscle and vessels'),
  ('brain', 'Nervous', 'Central nervous system'),
  ('kidney', 'Urinary', 'Renal filtration and fluid balance'),
  ('immune', 'Immune', 'Innate/adaptive immune responses');

-- Seed compounds (using name, not slug)
INSERT OR IGNORE INTO compounds (name, common_name, description) VALUES
  ('Omega-3 (EPA+DHA)', 'Fish oil omega-3', 'Marine-derived fatty acids'),
  ('Catechins', 'Tea catechins', 'Green tea polyphenols'),
  ('Anthocyanins', 'Berry pigments', 'Blue/purple plant pigments'),
  ('L-Theanine', 'Theanine', 'Amino acid from tea'),
  ('Lutein+Zeaxanthin', 'Eye carotenoids', 'Macular pigments'),
  ('Flavanols', 'Cocoa flavanols', 'Cocoa polyphenols'),
  ('Soluble Fiber', 'Soluble fiber', 'Fermentable fiber'),
  ('Beta-Glucan', 'Oat beta-glucan', 'Oat/barley fiber'),
  ('Allicin', 'Garlic compound', 'Organosulfur from garlic'),
  ('Isothiocyanates', 'Crucifer compounds', 'Brassica phytochemicals'),
  ('Sulforaphane', 'Broccoli compound', 'Cruciferous isothiocyanate'),
  ('Curcumin', 'Turmeric pigment', 'Turmeric curcuminoid'),
  ('Capsaicin', 'Chili heat', 'Hot pepper compound'),
  ('Dietary Nitrate', 'Beet nitrate', 'Nitrate from vegetables'),
  ('Lycopene', 'Tomato red', 'Red carotenoid'),
  ('Beta-Carotene', 'Carrot orange', 'Orange carotenoid'),
  ('Magnesium', 'Magnesium', 'Essential mineral'),
  ('Phosphorus', 'Phosphorus', 'Essential mineral'),
  ('Oxalate', 'Oxalic acid', 'Antinutrient in greens'),
  ('Choline', 'Choline', 'Essential nutrient'),
  ('Alcohol (Ethanol)', 'Alcohol', 'Ethyl alcohol'),
  ('Fructose', 'Fruit sugar', 'Simple sugar'),
  ('Added Sugars', 'Added sugars', 'Non-intrinsic sugars'),
  ('Vitamin C', 'Ascorbic acid', 'Water-soluble vitamin'),
  ('Zinc', 'Zinc', 'Essential trace mineral'),
  ('Inulin', 'Inulin (FODMAP)', 'Fermentable oligosaccharide'),
  ('Caffeine', 'Caffeine', 'Stimulant alkaloid'),
  ('Potassium', 'Potassium', 'Essential electrolyte');

-- Brain effects (using compound_organ_effects with correct schema)
INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'brain', 'benefit', 4, 'Strong evidence for cognitive support (tier A)'
FROM compounds c WHERE c.name = 'Omega-3 (EPA+DHA)';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'brain', 'benefit', 3, 'Neuroprotective polyphenols (tier B)'
FROM compounds c WHERE c.name = 'Catechins';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'brain', 'benefit', 3, 'Cognitive support from berries (tier B)'
FROM compounds c WHERE c.name = 'Anthocyanins';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'brain', 'benefit', 3, 'Calming amino acid (tier B)'
FROM compounds c WHERE c.name = 'L-Theanine';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'brain', 'benefit', 3, 'Macular and cognitive support (tier B)'
FROM compounds c WHERE c.name = 'Lutein+Zeaxanthin';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'brain', 'risk', 3, 'Excess may cause anxiety/sleep issues (tier A)'
FROM compounds c WHERE c.name = 'Caffeine';

-- Kidney effects
INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'kidney', 'benefit', 3, 'Supports fluid balance (tier A)'
FROM compounds c WHERE c.name = 'Potassium';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'kidney', 'benefit', 2, 'Supports kidney function (tier B)'
FROM compounds c WHERE c.name = 'Magnesium';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'kidney', 'risk', 3, 'High intake strains kidneys (tier A)'
FROM compounds c WHERE c.name = 'Phosphorus';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'kidney', 'risk', 3, 'May contribute to kidney stones (tier B)'
FROM compounds c WHERE c.name = 'Oxalate';

-- Heart effects
INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'heart', 'benefit', 4, 'Lowers LDL cholesterol (tier A)'
FROM compounds c WHERE c.name = 'Soluble Fiber';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'heart', 'benefit', 4, 'Proven cholesterol reduction (tier A)'
FROM compounds c WHERE c.name = 'Beta-Glucan';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'heart', 'benefit', 3, 'Improves endothelial function (tier B)'
FROM compounds c WHERE c.name = 'Flavanols';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'heart', 'benefit', 3, 'Antioxidant cardioprotection (tier B)'
FROM compounds c WHERE c.name = 'Lycopene';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'heart', 'risk', 3, 'Increases cardiovascular risk (tier A)'
FROM compounds c WHERE c.name = 'Added Sugars';

-- Liver effects
INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'liver', 'risk', 4, 'Hepatotoxic at high intake (tier A)'
FROM compounds c WHERE c.name = 'Alcohol (Ethanol)';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'liver', 'risk', 3, 'Excess promotes fatty liver (tier B)'
FROM compounds c WHERE c.name = 'Fructose';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'liver', 'benefit', 3, 'Supports liver fat metabolism (tier B)'
FROM compounds c WHERE c.name = 'Choline';

-- Gut effects
INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'gut', 'risk', 3, 'FODMAP - may cause bloating in IBS (tier B)'
FROM compounds c WHERE c.name = 'Inulin';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'gut', 'risk', 2, 'May irritate sensitive GI tracts (tier B)'
FROM compounds c WHERE c.name = 'Capsaicin';

-- Immune effects
INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'immune', 'benefit', 3, 'Supports immune cell function (tier B)'
FROM compounds c WHERE c.name = 'Vitamin C';

INSERT OR REPLACE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'immune', 'benefit', 3, 'Essential for immune response (tier A)'
FROM compounds c WHERE c.name = 'Zinc';
