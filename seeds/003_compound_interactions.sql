-- ============================
-- Compound Interactions (Synergies & Antagonisms)
-- "Smart Doctor" knows these combinations matter
-- ============================

-- ============================================================================
-- SYNERGISTIC INTERACTIONS (compounds that work better together)
-- ============================================================================

INSERT OR REPLACE INTO compound_interactions
(compound_a_id, compound_b_id, interaction_type, effect_description, mechanism, strength, organs_affected, citations) VALUES

-- Curcumin + Piperine (Black Pepper)
(65, 123, 'absorption_enhance',
 'Piperine increases curcumin bioavailability by 2000%',
 'Piperine inhibits glucuronidation in liver and intestine, preventing rapid curcumin metabolism. Also inhibits P-glycoprotein efflux pump.',
 0.95, '["brain","liver","gut","immune"]',
 'PMID:9619120,PMID:24841956'),

-- Vitamin C + Iron
(1, 22, 'absorption_enhance',
 'Vitamin C increases non-heme iron absorption 2-3 fold',
 'Ascorbic acid reduces ferric iron (Fe3+) to ferrous (Fe2+), the absorbable form. Also chelates iron, keeping it soluble in alkaline duodenum.',
 0.85, '["immune","gut"]',
 'PMID:20200263,PMID:24778671'),

-- Vitamin D + Calcium
(2, 25, 'synergy',
 'Vitamin D is essential for calcium absorption and bone incorporation',
 'Vitamin D induces calcium-binding proteins (calbindin) in intestine. Without adequate D, only 10-15% of dietary calcium is absorbed vs 30-40% with adequate D.',
 0.90, '["immune"]',
 'PMID:21118827,PMID:17684225'),

-- Vitamin D + Vitamin K2
(2, 5, 'synergy',
 'K2 directs calcium to bones and away from arteries',
 'Vitamin D increases calcium absorption; K2 activates osteocalcin (puts calcium in bone) and matrix Gla protein (prevents arterial calcification). Together they optimize calcium metabolism.',
 0.85, '["heart"]',
 'PMID:27178529,PMID:26516910'),

-- Quercetin + Zinc
(60, 21, 'synergy',
 'Quercetin acts as zinc ionophore, enhancing antiviral effects',
 'Quercetin transports zinc into cells where zinc inhibits viral RNA-dependent RNA polymerase. This combination has synergistic antiviral activity.',
 0.80, '["immune"]',
 'PMID:32340551,PMID:25050823'),

-- Quercetin + Vitamin C
(60, 1, 'synergy',
 'Vitamin C regenerates quercetin and enhances its stability',
 'Ascorbic acid reduces oxidized quercetin back to active form, extending its antioxidant capacity. Combined effect greater than sum of parts.',
 0.75, '["immune","heart"]',
 'PMID:28963159,PMID:29577920'),

-- EPA + DHA (Omega-3s together)
(40, 41, 'synergy',
 'EPA and DHA have complementary mechanisms in brain and heart',
 'EPA produces anti-inflammatory resolvins; DHA integrates into membranes. EPA better for mood, DHA better for structure. Together cover full spectrum of omega-3 benefits.',
 0.85, '["brain","heart"]',
 'PMID:28954549,PMID:30869881'),

-- Curcumin + Omega-3
(65, 41, 'synergy',
 'Synergistic anti-inflammatory and neuroprotective effects',
 'Both target overlapping but distinct inflammatory pathways (NF-kB, COX-2, resolvins). Combination shows enhanced BDNF expression and reduced neuroinflammation in studies.',
 0.80, '["brain","gut"]',
 'PMID:29234591,PMID:30308025'),

-- Sulforaphane + Curcumin
(111, 65, 'synergy',
 'Dual-pathway activation of detoxification',
 'Sulforaphane activates Nrf2 (phase II enzymes); curcumin inhibits NF-kB (inflammation). Together they optimize cellular defense against oxidative stress and inflammation.',
 0.75, '["liver","gut","immune"]',
 'PMID:28774722,PMID:30568424'),

-- L-Theanine + Caffeine
(90, 120, 'synergy',
 'Alert focus without jitters or anxiety',
 'Caffeine provides alertness; L-theanine smooths the stimulation curve, reduces anxiety, and promotes alpha brain waves. The combination improves attention better than either alone.',
 0.85, '["brain"]',
 'PMID:18681988,PMID:21040626'),

-- Vitamin E + Vitamin C
(3, 1, 'synergy',
 'Vitamin C regenerates vitamin E in membranes',
 'When vitamin E neutralizes lipid peroxyl radicals in membranes, it becomes oxidized. Vitamin C at the membrane-water interface regenerates vitamin E to active form.',
 0.80, '["heart","brain","immune"]',
 'PMID:10517182,PMID:8621061'),

-- Lycopene + Fat
(80, 45, 'absorption_enhance',
 'Fat dramatically increases carotenoid absorption',
 'Lycopene is fat-soluble; consuming with fat increases absorption 2-5 fold. Cooking tomatoes in olive oil is the optimal delivery method.',
 0.85, '["heart"]',
 'PMID:24915331,PMID:25773776'),

-- Lutein + Zeaxanthin (natural combination)
(81, 82, 'synergy',
 'Together provide complete macular protection',
 'Lutein predominates in peripheral macula; zeaxanthin in central fovea. Together they provide complete blue light filtration and antioxidant protection across the retina.',
 0.90, '["brain"]',
 'PMID:28425969,PMID:29439725');

-- ============================================================================
-- ANTAGONISTIC INTERACTIONS (compounds that interfere with each other)
-- ============================================================================

INSERT OR REPLACE INTO compound_interactions
(compound_a_id, compound_b_id, interaction_type, effect_description, mechanism, strength, organs_affected, citations) VALUES

-- Calcium + Iron (timing matters)
(25, 22, 'absorption_block',
 'Calcium inhibits iron absorption when taken together',
 'Calcium competes with iron for DMT1 transporter in intestine. Taking 300mg calcium with a meal reduces iron absorption by 50-60%. Separate by 2+ hours.',
 0.70, '["gut"]',
 'PMID:20200263,PMID:11029014'),

-- Zinc + Copper (chronic high zinc)
(21, 28, 'antagonism',
 'High-dose zinc causes copper deficiency',
 'Zinc induces metallothionein in intestinal cells, which binds copper and prevents absorption. Chronic zinc >50mg/day can cause copper deficiency anemia and neurological problems.',
 0.75, '["immune","brain"]',
 'PMID:20150599,PMID:28861230'),

-- Phytate + Minerals
(141, 22, 'absorption_block',
 'Phytate strongly binds iron, zinc, and calcium',
 'Phytic acid (IP6) chelates minerals in the gut, forming insoluble complexes that cannot be absorbed. Reduces zinc absorption by 15-50% and iron similarly.',
 0.65, '["gut","immune"]',
 'PMID:25694676,PMID:26318445'),

-- Oxalate + Calcium
(140, 25, 'absorption_block',
 'Oxalate binds calcium, reducing absorption of both',
 'Oxalic acid forms insoluble calcium oxalate in the gut. High-oxalate foods (spinach) provide little bioavailable calcium despite high content. Pairing them can reduce stone risk.',
 0.70, '["gut","kidney"]',
 'PMID:27888903,PMID:29679017'),

-- Caffeine + Iron
(120, 22, 'absorption_block',
 'Coffee/tea polyphenols inhibit iron absorption',
 'Polyphenols in coffee and tea bind iron, reducing absorption by up to 60% when consumed with meals. Wait 1 hour after eating before coffee/tea.',
 0.60, '["gut"]',
 'PMID:10024903,PMID:29595717'),

-- Fiber + Minerals (excessive fiber)
(105, 21, 'absorption_block',
 'Very high fiber can reduce mineral absorption',
 'Extremely high fiber intake (>50g/day) can physically trap minerals and speed transit, reducing absorption time. Normal fiber intake (25-35g) is not problematic.',
 0.40, '["gut"]',
 'PMID:29378044,PMID:26561618'),

-- Alcohol + B Vitamins
(145, 6, 'antagonism',
 'Alcohol depletes B vitamins and impairs absorption',
 'Alcohol damages intestinal lining reducing B vitamin absorption, increases urinary excretion, and interferes with conversion to active forms. Thiamine (B1) deficiency particularly common.',
 0.80, '["liver","brain"]',
 'PMID:29549693,PMID:28808507'),

-- Alcohol + Folate
(145, 11, 'antagonism',
 'Alcohol impairs folate absorption and metabolism',
 'Alcohol inhibits intestinal folate absorption, reduces hepatic storage, and increases urinary loss. Heavy drinkers commonly folate deficient, increasing homocysteine and neurological risk.',
 0.75, '["liver","brain"]',
 'PMID:27329232,PMID:29549693'),

-- High-dose Vitamin E + Vitamin K
(3, 4, 'antagonism',
 'Very high vitamin E may interfere with vitamin K',
 'At doses >1000 IU, vitamin E may antagonize vitamin K-dependent clotting factors, increasing bleeding risk. Normal supplemental doses (400 IU) are not problematic.',
 0.45, '["heart"]',
 'PMID:22419320,PMID:24285428');

-- ============================================================================
-- CONTEXT-DEPENDENT INTERACTIONS
-- ============================================================================

INSERT OR REPLACE INTO compound_interactions
(compound_a_id, compound_b_id, interaction_type, effect_description, mechanism, strength, organs_affected, citations) VALUES

-- Vitamin C + B12 (high dose C)
(1, 10, 'antagonism',
 'Very high vitamin C may degrade B12 in supplements',
 'High-dose vitamin C (>1g) can convert B12 to inactive analogues in multi-ingredient supplements. Not a concern with food or when taken separately.',
 0.35, '["gut"]',
 'PMID:28244193'),

-- Magnesium + Calcium (high doses)
(20, 25, 'absorption_block',
 'High calcium can reduce magnesium absorption',
 'At very high calcium intakes (>2000mg), magnesium absorption may be reduced due to competition for shared transporters. Balanced intake is fine.',
 0.40, '["gut"]',
 'PMID:30248960,PMID:25540137'),

-- Polyphenols + Iron (with food)
(60, 22, 'absorption_block',
 'Polyphenols inhibit non-heme iron absorption',
 'Quercetin and other polyphenols chelate iron in the gut. However, vitamin C in the same meal can overcome this inhibition. Not clinically significant with varied diet.',
 0.50, '["gut"]',
 'PMID:28946262,PMID:24458893');
