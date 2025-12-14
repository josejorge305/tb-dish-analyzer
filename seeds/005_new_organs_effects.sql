-- ============================
-- New Organs: Eyes, Skin, Bones, Thyroid
-- Expanding from 6 to 10 organ systems
-- ============================

-- Add new organ systems
INSERT OR IGNORE INTO organ_systems (organ, system, description) VALUES
('eyes', 'Sensory', 'Visual system including retina, macula, lens, and optic nerve'),
('skin', 'Integumentary', 'Largest organ - barrier function, collagen structure, UV protection'),
('bones', 'Skeletal', 'Bone density, mineralization, remodeling, and joint health'),
('thyroid', 'Endocrine', 'Thyroid hormone production regulating metabolism, energy, and temperature');

-- ============================================================================
-- EYES / VISION EFFECTS
-- ============================================================================

INSERT OR REPLACE INTO compound_organ_effects
(compound_id, organ, effect, strength, mechanism, pathway, explanation, citations, threshold_mg, optimal_mg, dose_response, population_notes) VALUES

-- Lutein - Eyes (PRIMARY)
(81, 'eyes', 'benefit', 5,
 'macular pigment, blue light filter',
 'accumulates in macula, filters 40-90% of blue light, antioxidant in retina',
 'Lutein is one of only two carotenoids that accumulate in the macula, the retinal region responsible for sharp central vision. It filters damaging blue light and neutralizes free radicals from light exposure. Higher macular pigment density correlates with reduced AMD risk and improved visual performance.',
 'PMID:28425969,PMID:28756618',
 6, 10, 'linear',
 'Benefits increase with age; most diets provide only 1-2mg'),

-- Zeaxanthin - Eyes
(82, 'eyes', 'benefit', 5,
 'central macula protection',
 'concentrated in fovea, complements lutein distribution',
 'Zeaxanthin dominates the central fovea where visual acuity is highest. Together with lutein, it provides complete macular protection. The AREDS2 study confirmed lutein+zeaxanthin reduced AMD progression by 18% in those with low dietary intake.',
 'PMID:23571649,PMID:28756618',
 2, 2, 'threshold',
 'Often paired with lutein in 5:1 ratio'),

-- Astaxanthin - Eyes
(83, 'eyes', 'benefit', 4,
 'retinal antioxidant, accommodative function',
 'crosses blood-retinal barrier, reduces eye fatigue',
 'Astaxanthin is one of few antioxidants that can cross the blood-retinal barrier. Studies show it reduces eye fatigue from screen use, improves accommodation (focusing ability), and increases retinal blood flow. Particularly beneficial for digital eye strain.',
 'PMID:22043017,PMID:28208784',
 4, 12, 'linear',
 'Notable benefits for screen workers and digital eye strain'),

-- DHA (Omega-3) - Eyes
(41, 'eyes', 'benefit', 4,
 'retinal structure, dry eye relief',
 'DHA comprises 60% of retinal photoreceptor fatty acids',
 'DHA is the predominant structural fatty acid in retinal photoreceptors. Adequate intake maintains photoreceptor membrane fluidity essential for the visual cycle. Also reduces dry eye symptoms by improving tear film quality and reducing ocular surface inflammation.',
 'PMID:25097045,PMID:28364474',
 250, 1000, 'threshold',
 'Dry eye benefits require 1000mg+ EPA+DHA daily'),

-- Vitamin A (Retinol) - Eyes
(12, 'eyes', 'benefit', 5,
 'rhodopsin synthesis, corneal health',
 'essential component of visual pigment rhodopsin',
 'Vitamin A is literally named after the retina. It forms rhodopsin, the light-sensitive pigment in rod cells essential for night vision. Deficiency causes night blindness first, then xerophthalmia (dry eye) and eventually corneal damage. The most critical nutrient for basic visual function.',
 'PMID:25029230,PMID:26447482',
 700, 900, 'threshold',
 'Deficiency is leading cause of preventable blindness worldwide'),

-- Beta-Carotene - Eyes
(13, 'eyes', 'benefit', 3,
 'provitamin A, macular antioxidant',
 'converts to retinol as needed, provides antioxidant protection',
 'Beta-carotene serves as a safe vitamin A precursor - the body only converts what it needs, preventing toxicity. It also accumulates in ocular tissues providing antioxidant protection. Conversion efficiency varies by individual genetics.',
 'PMID:26447482,PMID:23571649',
 3000, 6000, 'threshold',
 'Smokers should avoid high-dose supplements (lung cancer risk)'),

-- Zinc - Eyes
(21, 'eyes', 'benefit', 4,
 'retinal enzyme cofactor, vitamin A transport',
 'essential for retinol dehydrogenase, transports vitamin A to retina',
 'Zinc is highly concentrated in the retina and is essential for vitamin A metabolism in the eye. It activates retinol dehydrogenase for the visual cycle and helps transport vitamin A from liver to retina. AREDS2 included zinc for AMD prevention.',
 'PMID:23571649,PMID:24557349',
 8, 40, 'threshold',
 'AREDS2 used 80mg but 25-40mg may be equally effective with fewer GI side effects'),

-- Vitamin C - Eyes
(1, 'eyes', 'benefit', 3,
 'lens antioxidant, aqueous humor component',
 'concentrated in aqueous humor at 20x plasma levels',
 'Vitamin C is actively concentrated in the eye''s aqueous humor at levels 20-fold higher than blood. It protects the lens from oxidative damage that leads to cataracts. Higher dietary intake associated with 33% lower cataract risk in prospective studies.',
 'PMID:26447482,PMID:27688221',
 90, 500, 'linear',
 'Cataract prevention requires long-term adequate intake'),

-- Vitamin E - Eyes
(3, 'eyes', 'benefit', 3,
 'lipid peroxidation prevention',
 'protects photoreceptor membranes from oxidation',
 'Vitamin E protects the lipid-rich photoreceptor membranes from oxidative damage. Combined with other antioxidants in AREDS formula, it helped slow AMD progression. Works synergistically with vitamin C which regenerates oxidized vitamin E.',
 'PMID:23571649,PMID:26447482',
 15, 400, 'threshold',
 'Part of AREDS2 formula for AMD');

-- ============================================================================
-- SKIN EFFECTS
-- ============================================================================

INSERT OR REPLACE INTO compound_organ_effects
(compound_id, organ, effect, strength, mechanism, pathway, explanation, citations, threshold_mg, optimal_mg, dose_response, population_notes) VALUES

-- Vitamin C - Skin
(1, 'skin', 'benefit', 5,
 'collagen synthesis, antioxidant, photoprotection',
 'essential cofactor for prolyl and lysyl hydroxylase in collagen formation',
 'Vitamin C is absolutely essential for collagen synthesis - without it, collagen cannot form stable triple-helix structure (hence scurvy). It also regenerates vitamin E in skin, neutralizes UV-generated free radicals, and inhibits melanin production. Both oral and topical forms benefit skin.',
 'PMID:28805671,PMID:29099763',
 90, 500, 'linear',
 'Smokers need 35mg more daily; topical vitamin C also beneficial'),

-- Vitamin E - Skin
(3, 'skin', 'benefit', 4,
 'lipid antioxidant, UV protection',
 'protects cell membranes, reduces UV-induced damage',
 'Vitamin E is the primary lipid-soluble antioxidant in skin, protecting cell membranes from UV-induced lipid peroxidation. Oral supplementation increases skin vitamin E levels and provides modest photoprotection. Most effective when combined with vitamin C.',
 'PMID:28805671,PMID:26062574',
 15, 400, 'threshold',
 'Topical application more effective than oral for direct UV protection'),

-- Astaxanthin - Skin
(83, 'skin', 'benefit', 4,
 'photoprotection, wrinkle reduction',
 'potent singlet oxygen quencher, inhibits MMP enzymes',
 'Astaxanthin is 6000x more potent than vitamin C as an antioxidant. Oral supplementation (4-12mg/day) reduces UV-induced skin damage, improves elasticity, reduces wrinkle depth, and increases moisture. It inhibits MMP enzymes that break down collagen.',
 'PMID:29665271,PMID:27259855',
 4, 12, 'linear',
 'Visible skin improvements in 4-6 weeks'),

-- Omega-3 (EPA) - Skin
(40, 'skin', 'benefit', 4,
 'anti-inflammatory, UV protection',
 'reduces inflammatory eicosanoids, improves skin barrier',
 'EPA reduces skin inflammation by shifting eicosanoid production from pro-inflammatory to anti-inflammatory. Studies show increased sunburn threshold (photoprotection), reduced acne severity, and improved skin barrier function. Also helps inflammatory skin conditions like psoriasis.',
 'PMID:26062574,PMID:29989090',
 500, 2000, 'linear',
 'Benefits for acne, psoriasis, and general photoaging'),

-- Zinc - Skin
(21, 'skin', 'benefit', 4,
 'wound healing, sebum regulation, anti-inflammatory',
 'essential for keratinocyte function, regulates sebaceous glands',
 'Zinc is critical for skin cell division, wound healing, and immune function in skin. It regulates sebum production (helps acne) and has anti-inflammatory effects. Deficiency causes dermatitis and impaired wound healing. Often deficient in acne patients.',
 'PMID:29193602,PMID:28895843',
 8, 30, 'threshold',
 'Effective for acne at 30mg/day; zinc deficiency common'),

-- Selenium - Skin
(23, 'skin', 'benefit', 3,
 'antioxidant defense, UV protection',
 'component of glutathione peroxidase in skin',
 'Selenium is essential for glutathione peroxidase, a key antioxidant enzyme in skin. Adequate selenium status supports skin''s defense against UV damage and oxidative stress. May help protect against skin cancer, though evidence is mixed.',
 'PMID:26062574,PMID:22583550',
 55, 100, 'threshold',
 'Do not exceed 400mcg; narrow therapeutic window'),

-- Glycine - Skin (collagen component)
(94, 'skin', 'benefit', 4,
 'collagen synthesis',
 'comprises 33% of collagen amino acids',
 'Glycine is the most abundant amino acid in collagen, comprising every third position in the collagen helix. Collagen supplements (rich in glycine) have shown improvements in skin elasticity, hydration, and wrinkle depth in multiple RCTs. The body may not synthesize enough glycine for optimal collagen production.',
 'PMID:30681787,PMID:31076828',
 3000, 10000, 'linear',
 'Collagen/gelatin supplements provide glycine effectively'),

-- Beta-Carotene - Skin
(13, 'skin', 'benefit', 3,
 'photoprotection, skin color',
 'accumulates in skin, provides internal sunscreen effect',
 'Beta-carotene accumulates in skin''s stratum corneum, providing modest internal sun protection (SPF ~4). High intake creates a healthy golden skin tone. Takes 10+ weeks of supplementation to accumulate protective levels. Provides systemic photoprotection that topical sunscreen cannot.',
 'PMID:26062574,PMID:22583550',
 15000, 30000, 'slow-accumulation',
 'Smokers should not supplement; carotenodermia (orange skin) harmless at high doses'),

-- Alcohol - Skin (CAUTION)
(145, 'skin', 'caution', 4,
 'dehydration, inflammation, accelerated aging',
 'diuretic effect, increases inflammatory cytokines, depletes nutrients',
 'Alcohol dehydrates skin, dilates blood vessels (causing redness/rosacea), triggers inflammation, and depletes skin-protective nutrients like vitamin A and zinc. Chronic use accelerates skin aging through oxidative stress and impaired collagen synthesis. Even moderate drinking affects skin quality.',
 'PMID:28727685,PMID:26904154',
 0, NULL, 'linear-harm',
 'Visible effects: dehydration, puffiness, redness, accelerated wrinkles'),

-- Added Sugars - Skin (CAUTION)
(147, 'skin', 'caution', 4,
 'glycation, collagen damage',
 'AGE formation crosslinks collagen, reducing elasticity',
 'Excess sugar causes glycation - glucose binds to collagen forming Advanced Glycation End products (AGEs). AGEs make collagen stiff and prone to breakage, causing wrinkles and sagging. High-glycemic diets also worsen acne through insulin/IGF-1 signaling.',
 'PMID:26376476,PMID:28606553',
 25000, NULL, 'cumulative-harm',
 'Glycation is irreversible; prevention is key');

-- ============================================================================
-- BONES / SKELETAL EFFECTS
-- ============================================================================

INSERT OR REPLACE INTO compound_organ_effects
(compound_id, organ, effect, strength, mechanism, pathway, explanation, citations, threshold_mg, optimal_mg, dose_response, population_notes) VALUES

-- Calcium - Bones
(25, 'bones', 'benefit', 5,
 'bone mineralization',
 'primary structural mineral, hydroxyapatite formation',
 'Calcium is the primary mineral in bones, comprising 99% of body calcium stores. Adequate intake during growth maximizes peak bone mass; in adults it slows bone loss. However, calcium alone is insufficient - requires vitamin D for absorption and vitamin K2 for proper deposition.',
 'PMID:26174589,PMID:27702385',
 1000, 1200, 'threshold',
 'Spread intake throughout day for better absorption; >500mg at once poorly absorbed'),

-- Vitamin D - Bones
(2, 'bones', 'benefit', 5,
 'calcium absorption, bone remodeling',
 'induces intestinal calcium-binding proteins, regulates osteoblast/osteoclast balance',
 'Vitamin D is essential for calcium absorption - without it only 10-15% of dietary calcium is absorbed vs 30-40% with adequate D. It also directly regulates bone cells, promoting formation and controlled resorption. Deficiency causes rickets in children, osteomalacia in adults.',
 'PMID:26174589,PMID:29126694',
 600, 2000, 'threshold',
 'Target serum 25(OH)D >30ng/mL; most adults need 1000-4000 IU/day'),

-- Vitamin K2 (MK-7) - Bones
(5, 'bones', 'benefit', 5,
 'osteocalcin activation',
 'carboxylates osteocalcin enabling calcium binding to bone matrix',
 'Vitamin K2 activates osteocalcin, a protein that binds calcium to bone matrix. Without K2, calcium may deposit in arteries instead of bones. MK-7 form has longest half-life and best evidence. Studies show reduced fracture risk and improved bone density with K2 supplementation.',
 'PMID:26516910,PMID:27178529',
 90, 200, 'threshold',
 'MK-7 preferred over MK-4 for once-daily dosing; synergistic with D3'),

-- Magnesium - Bones
(20, 'bones', 'benefit', 4,
 'bone crystal formation, vitamin D activation',
 'incorporated into hydroxyapatite, required for D metabolism',
 'Magnesium is incorporated directly into bone crystal structure and is required to convert vitamin D to its active form. Deficiency impairs both bone formation and vitamin D function. Studies show higher magnesium intake associated with greater bone density, especially in elderly.',
 'PMID:29126694,PMID:28959144',
 320, 400, 'linear',
 '50% of Americans deficient; particularly important for bone health'),

-- Vitamin C - Bones
(1, 'bones', 'benefit', 3,
 'collagen synthesis',
 'essential for bone collagen matrix formation',
 'Bone is 90% type I collagen by organic weight. Vitamin C is essential for collagen synthesis, providing the organic scaffold for mineral deposition. Deficiency weakens bone matrix. Higher vitamin C intake associated with better bone density in epidemiological studies.',
 'PMID:26174589,PMID:30248960',
 90, 500, 'linear',
 'Often overlooked for bone health; important for collagen matrix'),

-- Protein - Bones (general)
-- Note: Would need to add protein as a compound, using glycine as proxy
(94, 'bones', 'benefit', 3,
 'collagen synthesis, IGF-1 signaling',
 'provides amino acids for bone matrix, stimulates bone formation',
 'Adequate protein is essential for bone health - it provides amino acids for collagen matrix and stimulates IGF-1, which promotes bone formation. Low protein intake is a risk factor for hip fracture. The outdated concern that protein causes bone loss has been disproven.',
 'PMID:26174589,PMID:28404575',
 50000, 70000, 'threshold',
 'Higher protein needs in elderly for bone preservation'),

-- Phosphorus - Bones
(26, 'bones', 'benefit', 3,
 'bone mineralization',
 'forms calcium phosphate hydroxyapatite',
 'Phosphorus combines with calcium to form hydroxyapatite, the mineral that gives bones strength. However, excess phosphorus (especially from processed foods) can impair calcium balance. The ratio of calcium to phosphorus matters more than absolute intake.',
 'PMID:26174589,PMID:29043898',
 700, 1000, 'U-shaped',
 'Excess phosphorus (from soda/processed foods) can harm bones; balance with calcium'),

-- Oxalate - Bones (CAUTION - indirect)
(140, 'bones', 'caution', 2,
 'calcium binding',
 'reduces calcium bioavailability from high-oxalate foods',
 'Oxalate binds calcium in the gut, reducing absorption. High-oxalate foods like spinach provide calcium that is mostly unavailable. This doesn''t actively harm bones but means the calcium content of high-oxalate foods shouldn''t be counted for bone health.',
 'PMID:29679017,PMID:27888903',
 100, NULL, 'context-dependent',
 'Concern only if relying on high-oxalate foods for calcium'),

-- Alcohol - Bones (CAUTION)
(145, 'bones', 'caution', 4,
 'osteoblast inhibition, nutrient depletion',
 'directly toxic to bone-forming cells, impairs calcium/vitamin D status',
 'Alcohol is directly toxic to osteoblasts (bone-building cells) and impairs calcium absorption and vitamin D metabolism. Heavy drinking significantly increases osteoporosis and fracture risk. Even moderate drinking may have negative effects on bone in postmenopausal women.',
 'PMID:26710251,PMID:29480737',
 0, NULL, 'linear-harm',
 'Risk increases with amount; heavy drinking major osteoporosis risk factor'),

-- Caffeine - Bones (mild CAUTION)
(120, 'bones', 'caution', 2,
 'calcium excretion',
 'increases urinary calcium loss',
 'Caffeine modestly increases urinary calcium excretion. However, the effect is small and easily offset by adequate calcium intake. The concern is mainly for those with low calcium intake who consume large amounts of caffeine. Moderate coffee consumption is not a significant bone risk.',
 'PMID:26174589,PMID:28936942',
 300, NULL, 'context-dependent',
 'Only concerning with inadequate calcium intake; 1 tbsp milk offsets 1 cup coffee');

-- ============================================================================
-- THYROID EFFECTS
-- ============================================================================

INSERT OR REPLACE INTO compound_organ_effects
(compound_id, organ, effect, strength, mechanism, pathway, explanation, citations, threshold_mg, optimal_mg, dose_response, population_notes) VALUES

-- Iodine - Thyroid
(31, 'thyroid', 'benefit', 5,
 'thyroid hormone synthesis',
 'incorporated into T4 and T3 hormones',
 'Iodine is the essential element in thyroid hormones - T4 contains 4 iodine atoms, T3 contains 3. Without adequate iodine, the thyroid cannot produce hormones, leading to hypothyroidism and goiter. Iodine deficiency remains the leading cause of preventable intellectual disability worldwide.',
 'PMID:29263455,PMID:27845103',
 0.15, 0.15, 'U-shaped',
 'Both deficiency AND excess are harmful; iodized salt solved deficiency in many countries'),

-- Selenium - Thyroid
(23, 'thyroid', 'benefit', 5,
 'hormone conversion, antioxidant protection',
 'deiodinase enzymes convert T4 to active T3, GPx protects thyroid',
 'Selenium is essential for thyroid function in two ways: selenoprotein deiodinases convert inactive T4 to active T3, and glutathione peroxidase protects the thyroid from oxidative damage during hormone synthesis. The thyroid contains more selenium per gram than any other tissue.',
 'PMID:29263455,PMID:27702392',
 0.055, 0.1, 'threshold',
 'Critical for T4→T3 conversion; deficiency impairs thyroid function even with adequate iodine'),

-- Zinc - Thyroid
(21, 'thyroid', 'benefit', 3,
 'hormone synthesis and receptor function',
 'required for TSH production and T3 receptor binding',
 'Zinc is required for synthesis of TSH (thyroid-stimulating hormone) and for T3 to bind its nuclear receptor. Deficiency impairs both thyroid hormone production and action. Zinc status should be assessed in hypothyroid patients not responding to treatment.',
 'PMID:29263455,PMID:26268594',
 8, 15, 'threshold',
 'Deficiency can mimic or exacerbate hypothyroidism'),

-- Iron - Thyroid
(22, 'thyroid', 'benefit', 3,
 'hormone synthesis',
 'thyroid peroxidase is iron-dependent enzyme',
 'Iron is a cofactor for thyroid peroxidase, the enzyme that incorporates iodine into thyroid hormones. Iron deficiency impairs thyroid hormone synthesis and is a common cause of persistent hypothyroid symptoms. Particularly relevant in menstruating women.',
 'PMID:29263455,PMID:26268594',
 8, 18, 'threshold',
 'Iron deficiency common in hypothyroidism; correct both'),

-- Vitamin D - Thyroid
(2, 'thyroid', 'benefit', 3,
 'immune modulation',
 'reduces autoimmune thyroid attack',
 'Vitamin D deficiency is strongly associated with autoimmune thyroid disease (Hashimoto''s, Graves''). D modulates immune function and may reduce autoimmune attack on the thyroid. Supplementation may help reduce thyroid antibody levels in autoimmune thyroiditis.',
 'PMID:29263455,PMID:30060266',
 1000, 4000, 'threshold',
 'Particularly important in Hashimoto''s thyroiditis'),

-- Goitrogens - Thyroid (CAUTION)
(144, 'thyroid', 'caution', 3,
 'iodine uptake interference',
 'thiocyanates and isothiocyanates compete with iodine',
 'Goitrogens in cruciferous vegetables, soy, and millet can interfere with iodine uptake by the thyroid. However, this is mainly a concern with very high intake AND inadequate iodine. Normal consumption of cooked cruciferous vegetables is not a problem for most people.',
 'PMID:29263455,PMID:28242200',
 0, NULL, 'context-dependent',
 'Only problematic with iodine deficiency or very high raw cruciferous intake; cooking reduces goitrogens'),

-- Excess Iodine - Thyroid (CAUTION)
-- Note: Using iodine compound but marking as caution for excess
(31, 'thyroid', 'caution', 3,
 'thyroid suppression (excess)',
 'Wolff-Chaikoff effect - excess iodine blocks hormone synthesis',
 'Paradoxically, excess iodine can suppress thyroid function (Wolff-Chaikoff effect) and trigger or worsen autoimmune thyroiditis. Kelp supplements and some seaweed contain extremely high iodine levels. The therapeutic window for iodine is narrow.',
 'PMID:29263455,PMID:27845103',
 1.1, NULL, 'U-shaped-harm',
 'Avoid kelp/seaweed supplements; can contain 1000x+ RDA');
