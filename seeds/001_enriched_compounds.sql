-- ============================
-- Enriched Compounds Seed Data
-- Medical-grade compound definitions with mechanisms
-- ============================

-- VITAMINS
INSERT OR REPLACE INTO compounds (id, name, common_name, category, mechanism_summary, cid) VALUES
(1, 'Ascorbic Acid', 'Vitamin C', 'vitamin', 'Potent antioxidant, collagen synthesis cofactor, enhances iron absorption, immune cell function support', '54670067'),
(2, 'Cholecalciferol', 'Vitamin D3', 'vitamin', 'Hormone precursor regulating calcium homeostasis, immune modulation, gene expression in 200+ genes', '5280795'),
(3, 'Alpha-Tocopherol', 'Vitamin E', 'vitamin', 'Fat-soluble antioxidant protecting cell membranes from lipid peroxidation', '14985'),
(4, 'Phylloquinone', 'Vitamin K1', 'vitamin', 'Essential cofactor for blood clotting factors and bone matrix proteins', '5280483'),
(5, 'Menaquinone-7', 'Vitamin K2 (MK-7)', 'vitamin', 'Activates osteocalcin and matrix Gla protein for bone and cardiovascular health', '5283544'),
(6, 'Thiamine', 'Vitamin B1', 'vitamin', 'Coenzyme in carbohydrate metabolism and neural function', '1130'),
(7, 'Riboflavin', 'Vitamin B2', 'vitamin', 'Precursor to FAD and FMN coenzymes in energy metabolism', '493570'),
(8, 'Niacin', 'Vitamin B3', 'vitamin', 'Precursor to NAD+/NADP+ critical for cellular energy and DNA repair', '938'),
(9, 'Pyridoxine', 'Vitamin B6', 'vitamin', 'Coenzyme in amino acid metabolism, neurotransmitter synthesis, hemoglobin formation', '1054'),
(10, 'Cobalamin', 'Vitamin B12', 'vitamin', 'Essential for DNA synthesis, neurological function, red blood cell formation', '5479203'),
(11, 'Folate', 'Vitamin B9', 'vitamin', 'Critical for DNA synthesis, cell division, neural tube development', '6037'),
(12, 'Retinol', 'Vitamin A', 'vitamin', 'Essential for vision, immune function, cell differentiation, gene transcription', '445354'),
(13, 'Beta-Carotene', 'Provitamin A', 'carotenoid', 'Antioxidant carotenoid, converts to retinol, protects against oxidative stress', '5280489');

-- MINERALS
INSERT OR REPLACE INTO compounds (id, name, common_name, category, mechanism_summary, cid) VALUES
(20, 'Magnesium', 'Magnesium', 'mineral', 'Cofactor for 300+ enzymes, ATP stability, muscle/nerve function, blood pressure regulation', '888'),
(21, 'Zinc', 'Zinc', 'mineral', 'Essential for 100+ enzymes, immune function, wound healing, DNA synthesis, taste perception', '32051'),
(22, 'Iron', 'Iron', 'mineral', 'Oxygen transport (hemoglobin), electron transport chain, DNA synthesis cofactor', '27284'),
(23, 'Selenium', 'Selenium', 'mineral', 'Component of selenoproteins, thyroid hormone metabolism, antioxidant defense (glutathione peroxidase)', '6326970'),
(24, 'Potassium', 'Potassium', 'mineral', 'Primary intracellular cation, nerve transmission, muscle contraction, blood pressure regulation', '813'),
(25, 'Calcium', 'Calcium', 'mineral', 'Bone structure, muscle contraction, nerve signaling, blood clotting, enzyme activation', '271'),
(26, 'Phosphorus', 'Phosphorus', 'mineral', 'Bone structure, ATP/DNA/RNA component, acid-base balance', '5462309'),
(27, 'Sodium', 'Sodium', 'mineral', 'Extracellular fluid balance, nerve impulse transmission, nutrient absorption', '923'),
(28, 'Copper', 'Copper', 'mineral', 'Iron metabolism, connective tissue formation, neurotransmitter synthesis, antioxidant defense', '27099'),
(29, 'Manganese', 'Manganese', 'mineral', 'Bone formation, blood clotting, metabolism cofactor, antioxidant (SOD)', '27854'),
(30, 'Chromium', 'Chromium', 'mineral', 'Enhances insulin action, glucose metabolism', '27668'),
(31, 'Iodine', 'Iodine', 'mineral', 'Essential component of thyroid hormones T3 and T4', '807');

-- OMEGA FATTY ACIDS
INSERT OR REPLACE INTO compounds (id, name, common_name, category, mechanism_summary, cid) VALUES
(40, 'Eicosapentaenoic Acid', 'EPA (Omega-3)', 'fatty_acid', 'Anti-inflammatory eicosanoid precursor, reduces triglycerides, membrane fluidity', '446284'),
(41, 'Docosahexaenoic Acid', 'DHA (Omega-3)', 'fatty_acid', 'Major structural brain/retina lipid, anti-inflammatory, neuroprotective', '445580'),
(42, 'Alpha-Linolenic Acid', 'ALA (Omega-3)', 'fatty_acid', 'Plant-based omega-3, converts to EPA/DHA (limited), anti-inflammatory', '5280934'),
(43, 'Linoleic Acid', 'LA (Omega-6)', 'fatty_acid', 'Essential fatty acid, precursor to arachidonic acid, skin barrier function', '5280450'),
(44, 'Arachidonic Acid', 'AA (Omega-6)', 'fatty_acid', 'Eicosanoid precursor (prostaglandins, leukotrienes), immune signaling', '444899'),
(45, 'Oleic Acid', 'Oleic Acid (Omega-9)', 'fatty_acid', 'Monounsaturated, reduces LDL oxidation, membrane fluidity', '445639');

-- POLYPHENOLS & FLAVONOIDS
INSERT OR REPLACE INTO compounds (id, name, common_name, category, mechanism_summary, cid) VALUES
(60, 'Quercetin', 'Quercetin', 'flavonoid', 'Antioxidant, anti-inflammatory, mast cell stabilizer, senolytic activity', '5280343'),
(61, 'Kaempferol', 'Kaempferol', 'flavonoid', 'Antioxidant, anti-inflammatory, neuroprotective, cardioprotective', '5280863'),
(62, 'Epigallocatechin Gallate', 'EGCG', 'catechin', 'Potent antioxidant, AMPK activator, thermogenic, neuroprotective', '65064'),
(63, 'Catechins', 'Green Tea Catechins', 'catechin', 'Antioxidant, fat oxidation, cardiovascular protection', '9159'),
(64, 'Resveratrol', 'Resveratrol', 'stilbene', 'SIRT1 activator, anti-aging pathways, cardioprotective, anti-inflammatory', '445154'),
(65, 'Curcumin', 'Curcumin', 'curcuminoid', 'NF-kB inhibitor, COX-2 inhibitor, potent anti-inflammatory, neuroprotective', '969516'),
(66, 'Anthocyanins', 'Anthocyanins', 'anthocyanin', 'Antioxidant, anti-inflammatory, vascular protection, cognitive support', '145858'),
(67, 'Ellagic Acid', 'Ellagic Acid', 'polyphenol', 'Antioxidant, anti-proliferative, supports phase II detoxification', '5281855'),
(68, 'Chlorogenic Acid', 'Chlorogenic Acid', 'phenolic_acid', 'Antioxidant, glucose metabolism modulation, blood pressure support', '1794427'),
(69, 'Rosmarinic Acid', 'Rosmarinic Acid', 'phenolic_acid', 'Antioxidant, anti-inflammatory, anti-allergic, neuroprotective', '5315615'),
(70, 'Hesperidin', 'Hesperidin', 'flavanone', 'Vascular protection, anti-inflammatory, antioxidant', '10621'),
(71, 'Naringenin', 'Naringenin', 'flavanone', 'Antioxidant, lipid metabolism, anti-inflammatory', '932'),
(72, 'Apigenin', 'Apigenin', 'flavone', 'Anxiolytic, anti-inflammatory, promotes GABA activity', '5280443'),
(73, 'Luteolin', 'Luteolin', 'flavone', 'Anti-inflammatory, neuroprotective, mast cell stabilizer', '5280445');

-- CAROTENOIDS
INSERT OR REPLACE INTO compounds (id, name, common_name, category, mechanism_summary, cid) VALUES
(80, 'Lycopene', 'Lycopene', 'carotenoid', 'Potent antioxidant, prostate health, cardiovascular protection, skin protection', '446925'),
(81, 'Lutein', 'Lutein', 'carotenoid', 'Macular pigment, blue light filter, cognitive support', '5281243'),
(82, 'Zeaxanthin', 'Zeaxanthin', 'carotenoid', 'Macular pigment partner to lutein, retinal protection', '5280899'),
(83, 'Astaxanthin', 'Astaxanthin', 'carotenoid', 'Extremely potent antioxidant, crosses blood-brain barrier, anti-inflammatory', '5281224'),
(84, 'Cryptoxanthin', 'Beta-Cryptoxanthin', 'carotenoid', 'Provitamin A activity, bone health, antioxidant', '5281235');

-- AMINO ACIDS & RELATED
INSERT OR REPLACE INTO compounds (id, name, common_name, category, mechanism_summary, cid) VALUES
(90, 'L-Theanine', 'L-Theanine', 'amino_acid', 'Promotes alpha brain waves, GABA modulation, stress reduction without sedation', '228398'),
(91, 'L-Tryptophan', 'Tryptophan', 'amino_acid', 'Serotonin/melatonin precursor, mood and sleep regulation', '6305'),
(92, 'L-Tyrosine', 'Tyrosine', 'amino_acid', 'Dopamine/norepinephrine precursor, stress resilience, cognitive function', '6057'),
(93, 'L-Glutamine', 'Glutamine', 'amino_acid', 'Gut barrier integrity, immune cell fuel, nitrogen transport', '5961'),
(94, 'Glycine', 'Glycine', 'amino_acid', 'Collagen component, inhibitory neurotransmitter, sleep quality', '750'),
(95, 'Taurine', 'Taurine', 'amino_acid', 'Cell membrane stabilization, bile acid conjugation, antioxidant, cardiac function', '1123');

-- FIBER COMPOUNDS
INSERT OR REPLACE INTO compounds (id, name, common_name, category, mechanism_summary, cid) VALUES
(100, 'Beta-Glucan', 'Beta-Glucan', 'fiber', 'Soluble fiber, cholesterol binding, immune modulation via Dectin-1 receptor', '439262'),
(101, 'Inulin', 'Inulin', 'fiber', 'Prebiotic fructan, bifidogenic, SCFA production, but high-FODMAP', '24763'),
(102, 'Pectin', 'Pectin', 'fiber', 'Soluble fiber, cholesterol binding, gut barrier support', '441476'),
(103, 'Psyllium', 'Psyllium Husk', 'fiber', 'Gel-forming fiber, cholesterol reduction, glycemic control, regularity', '6436170'),
(104, 'Resistant Starch', 'Resistant Starch', 'fiber', 'Prebiotic, SCFA production (butyrate), glycemic control', NULL),
(105, 'Cellulose', 'Cellulose', 'fiber', 'Insoluble fiber, bulk formation, transit time reduction', '16211032');

-- ORGANOSULFUR COMPOUNDS
INSERT OR REPLACE INTO compounds (id, name, common_name, category, mechanism_summary, cid) VALUES
(110, 'Allicin', 'Allicin', 'organosulfur', 'Antimicrobial, cardiovascular protection, but high-FODMAP (garlic)', '65036'),
(111, 'Sulforaphane', 'Sulforaphane', 'isothiocyanate', 'Nrf2 activator, phase II enzyme inducer, potent detoxification support', '5350'),
(112, 'Indole-3-Carbinol', 'I3C', 'indole', 'Estrogen metabolism modulation, detoxification support', '3712'),
(113, 'Diallyl Disulfide', 'DADS', 'organosulfur', 'Garlic compound, antimicrobial, cardiovascular support', '16590'),
(114, 'Glucosinolates', 'Glucosinolates', 'glucosinolate', 'Precursors to isothiocyanates, cruciferous vegetable compounds', '9548624');

-- OTHER BIOACTIVES
INSERT OR REPLACE INTO compounds (id, name, common_name, category, mechanism_summary, cid) VALUES
(120, 'Caffeine', 'Caffeine', 'alkaloid', 'Adenosine receptor antagonist, increases alertness, thermogenic, ergogenic', '2519'),
(121, 'Theobromine', 'Theobromine', 'alkaloid', 'Mild stimulant, vasodilator, mood enhancement (chocolate)', '5429'),
(122, 'Capsaicin', 'Capsaicin', 'capsaicinoid', 'TRPV1 agonist, thermogenic, pain modulation, metabolic boost', '1548943'),
(123, 'Piperine', 'Piperine', 'alkaloid', 'Bioavailability enhancer, thermogenic, digestive stimulant', '638024'),
(124, 'Gingerols', 'Gingerols', 'phenol', 'Anti-nausea, anti-inflammatory, digestive support', '442793'),
(125, 'Berberine', 'Berberine', 'alkaloid', 'AMPK activator, glucose metabolism, antimicrobial, lipid support', '2353'),
(126, 'Coenzyme Q10', 'CoQ10', 'quinone', 'Mitochondrial electron carrier, cellular energy, antioxidant', '5281915'),
(127, 'Alpha-Lipoic Acid', 'ALA', 'antioxidant', 'Universal antioxidant (water/fat soluble), glucose metabolism, nerve support', '864'),
(128, 'Choline', 'Choline', 'nutrient', 'Acetylcholine precursor, cell membrane phospholipids, liver fat metabolism', '305'),
(129, 'Betaine', 'Betaine (TMG)', 'nutrient', 'Methyl donor, homocysteine metabolism, liver protection, osmoregulation', '247');

-- PROBLEMATIC COMPOUNDS (for caution flagging)
INSERT OR REPLACE INTO compounds (id, name, common_name, category, mechanism_summary, cid) VALUES
(140, 'Oxalate', 'Oxalic Acid', 'antinutrient', 'Binds calcium, kidney stone risk in susceptible individuals', '971'),
(141, 'Phytate', 'Phytic Acid', 'antinutrient', 'Mineral binding (zinc, iron, calcium), reduced bioavailability', '890'),
(142, 'Lectins', 'Lectins', 'protein', 'Carbohydrate-binding proteins, gut irritation if not denatured by cooking', NULL),
(143, 'Solanine', 'Solanine', 'glycoalkaloid', 'Nightshade compound, GI distress at high doses, cholinesterase inhibition', '6490'),
(144, 'Goitrogens', 'Goitrogens', 'antinutrient', 'Interfere with iodine uptake, thyroid function concern in excess', NULL),
(145, 'Ethanol', 'Alcohol', 'toxin', 'CNS depressant, liver metabolism burden, acetaldehyde formation', '702'),
(146, 'Acrylamide', 'Acrylamide', 'toxin', 'Formed in high-heat cooking of starchy foods, potential carcinogen', '6579'),
(147, 'Added Sugars', 'Added Sugars', 'sugar', 'Rapid glucose spike, insulin resistance risk, inflammatory', NULL),
(148, 'Trans Fats', 'Trans Fatty Acids', 'fatty_acid', 'Increases LDL, decreases HDL, promotes inflammation and atherosclerosis', NULL),
(149, 'Sodium (excess)', 'Excess Sodium', 'mineral', 'Blood pressure elevation, fluid retention, cardiovascular strain', '923'),
(150, 'Fructose (excess)', 'Excess Fructose', 'sugar', 'Liver-metabolized, de novo lipogenesis, uric acid elevation at high doses', '5984');
