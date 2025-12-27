-- ============================
-- Enriched Organ Effects with Medical Explanations
-- "Smart Doctor" level reasoning for each compound-organ relationship
-- ============================

-- ============================================================================
-- BRAIN EFFECTS
-- ============================================================================

INSERT OR REPLACE INTO compound_organ_effects
(compound_id, organ, effect, strength, mechanism, pathway, explanation, citations, threshold_mg, optimal_mg, dose_response, notes) VALUES

-- Omega-3s (DHA) - Brain
(41, 'brain', 'benefit', 5,
 'membrane fluidity, anti-inflammatory, neuroprotection',
 'integrates into neuronal membranes, modulates GPR120/PPARgamma, reduces microglial activation',
 'DHA constitutes 40% of brain polyunsaturated fatty acids and is critical for neuronal membrane integrity. It reduces neuroinflammation by inhibiting NF-kB signaling and promotes BDNF expression, supporting synaptic plasticity and cognitive function. Studies show improved memory and reduced cognitive decline risk.',
 'PMID:28899506,PMID:31722458,PMID:26890759',
 250, 1000, 'threshold-then-plateau',
 'Benefits strongest in elderly and those with low baseline intake'),

-- EPA - Brain (anti-inflammatory focus)
(40, 'brain', 'benefit', 4,
 'anti-inflammatory, mood regulation',
 'reduces pro-inflammatory eicosanoids, modulates serotonin signaling',
 'EPA reduces brain inflammation by competing with arachidonic acid for COX/LOX enzymes, producing less inflammatory mediators. Clinical trials show significant effects on depression, particularly in inflammatory phenotypes. EPA also supports cerebral blood flow.',
 'PMID:30869881,PMID:31247944',
 250, 1000, 'linear',
 'Particularly effective for mood disorders with inflammatory component'),

-- L-Theanine - Brain
(90, 'brain', 'benefit', 4,
 'anxiolytic, alpha-wave promotion',
 'crosses BBB, increases GABA/dopamine/serotonin, promotes alpha brain waves',
 'L-theanine crosses the blood-brain barrier within 30 minutes and promotes relaxed alertness by increasing alpha brain wave activity. It modulates glutamate receptors and increases inhibitory neurotransmitter levels without causing sedation, uniquely supporting calm focus.',
 'PMID:18296328,PMID:31623400',
 50, 200, 'linear',
 'Synergistic with caffeine for focused attention'),

-- Anthocyanins - Brain
(66, 'brain', 'benefit', 4,
 'antioxidant, vascular, neuroprotection',
 'crosses BBB, reduces oxidative stress, improves cerebral blood flow, modulates signaling',
 'Anthocyanins accumulate in brain regions associated with learning and memory. They enhance neuronal signaling, reduce oxidative damage to neurons, and improve cerebral blood flow. Berry consumption linked to 2.5-year delay in cognitive aging in epidemiological studies.',
 'PMID:31128303,PMID:28983915',
 50, 150, 'linear',
 'Blueberries, blackberries particularly studied'),

-- Caffeine - Brain (caution at high doses)
(120, 'brain', 'caution', 3,
 'adenosine antagonism, vasoconstriction',
 'blocks adenosine A1/A2A receptors, increases catecholamines',
 'While moderate caffeine (up to 400mg/day) can enhance alertness and cognitive performance, excess intake causes anxiety, disrupted sleep architecture, and dependency. Withdrawal causes headaches and fatigue. Individual metabolism varies significantly based on CYP1A2 genetics.',
 'PMID:28603504,PMID:30137774',
 300, NULL, 'U-shaped',
 'Benefits at moderate doses, harms at high. 400mg/day upper limit for adults'),

-- Curcumin - Brain
(65, 'brain', 'benefit', 4,
 'anti-inflammatory, antioxidant, neurogenesis',
 'inhibits NF-kB, reduces amyloid aggregation, increases BDNF',
 'Curcumin crosses the blood-brain barrier and exhibits potent anti-inflammatory effects by inhibiting NF-kB and COX-2. It reduces amyloid-beta plaque formation and increases brain-derived neurotrophic factor (BDNF), supporting neuroplasticity. Studies show improved memory and attention.',
 'PMID:28946379,PMID:31279955',
 80, 500, 'threshold',
 'Bioavailability enhanced 2000% with piperine'),

-- Vitamin B12 - Brain
(10, 'brain', 'benefit', 4,
 'myelin synthesis, homocysteine metabolism',
 'methylation cofactor, S-adenosylmethionine production',
 'B12 is essential for myelin sheath maintenance and neurotransmitter synthesis. Deficiency causes irreversible neurological damage including peripheral neuropathy and cognitive decline. It also helps lower homocysteine, an independent risk factor for dementia.',
 'PMID:27029615,PMID:26677203',
 2.4, 100, 'threshold',
 'Deficiency common in elderly and vegans; sublingual or injection may be needed'),

-- Lutein/Zeaxanthin - Brain
(81, 'brain', 'benefit', 3,
 'antioxidant, membrane integrity',
 'accumulates in brain tissue, reduces oxidative stress',
 'Lutein accumulates in brain tissue (especially frontal and occipital cortex) and correlates with cognitive function in elderly. It protects neural membranes from oxidative damage and supports visual processing speed, which declines with age.',
 'PMID:28036274,PMID:29439725',
 6, 20, 'linear',
 'Same compounds that protect macula also benefit brain'),

-- Flavanols - Brain
(63, 'brain', 'benefit', 3,
 'vascular, neuroprotection',
 'increases nitric oxide, improves cerebral blood flow, BDNF modulation',
 'Cocoa flavanols increase cerebral blood flow by enhancing nitric oxide bioavailability. Acute intake improves cognitive performance on demanding tasks. Long-term intake associated with reduced dementia risk through vascular mechanisms.',
 'PMID:28159011,PMID:31713186',
 200, 500, 'linear',
 'Dark chocolate (>70% cacao) or cocoa powder');

-- ============================================================================
-- HEART / CARDIOVASCULAR EFFECTS
-- ============================================================================

INSERT OR REPLACE INTO compound_organ_effects
(compound_id, organ, effect, strength, mechanism, pathway, explanation, citations, threshold_mg, optimal_mg, dose_response, notes) VALUES

-- Omega-3 EPA - Heart
(40, 'heart', 'benefit', 5,
 'anti-inflammatory, triglyceride reduction, antiarrhythmic',
 'reduces VLDL production, stabilizes cardiac ion channels, resolvin production',
 'EPA reduces triglycerides by 15-30% at therapeutic doses by decreasing hepatic VLDL synthesis. It stabilizes cardiac cell membranes, reducing arrhythmia risk. The REDUCE-IT trial showed 25% cardiovascular event reduction with high-dose EPA (4g/day).',
 'PMID:30415628,PMID:31791151',
 500, 2000, 'linear',
 'Prescription-strength (4g) for high triglycerides'),

-- Beta-Glucan - Heart
(100, 'heart', 'benefit', 5,
 'cholesterol binding, bile acid sequestration',
 'forms viscous gel in gut, binds bile acids, upregulates LDL receptors',
 'Beta-glucan from oats forms a viscous gel that traps bile acids, forcing the liver to use cholesterol to make more. This lowers LDL cholesterol by 5-10% with 3g/day intake. FDA-approved health claim for oat beta-glucan and heart disease risk reduction.',
 'PMID:27724985,PMID:28160440',
 3000, 3000, 'threshold',
 'FDA: 3g/day for cholesterol-lowering claim'),

-- Soluble Fiber - Heart
(102, 'heart', 'benefit', 4,
 'cholesterol binding, glycemic modulation',
 'bile acid sequestration, slows glucose absorption',
 'Soluble fiber binds bile acids and cholesterol in the intestine, reducing absorption. It also slows carbohydrate digestion, reducing postprandial glucose spikes and improving lipid profiles. Each 5-10g increase in soluble fiber reduces LDL by 5%.',
 'PMID:28160440,PMID:29276461',
 5000, 10000, 'linear',
 'Target 25-30g total fiber/day, at least 25% soluble'),

-- Lycopene - Heart
(80, 'heart', 'benefit', 4,
 'antioxidant, LDL oxidation prevention',
 'quenches singlet oxygen, inhibits HMG-CoA reductase',
 'Lycopene is the most potent singlet oxygen quencher among carotenoids. It prevents LDL oxidation, a key step in atherosclerosis, and may inhibit cholesterol synthesis. Meta-analyses show reduced stroke risk and blood pressure with higher intake.',
 'PMID:28799780,PMID:31035321',
 10, 30, 'linear',
 'Cooking tomatoes increases bioavailability 4-fold'),

-- Potassium - Heart
(24, 'heart', 'benefit', 5,
 'blood pressure regulation, cardiac rhythm',
 'sodium-potassium pump, vascular smooth muscle relaxation',
 'Potassium promotes sodium excretion and relaxes blood vessel walls, lowering blood pressure. Adequate intake (4700mg/day) reduces stroke risk by 24% and heart disease risk significantly. Most adults consume only half the recommended amount.',
 'PMID:27455317,PMID:23558164',
 2000, 4700, 'linear',
 'Most Americans severely deficient; bananas, potatoes, beans excellent sources'),

-- Magnesium - Heart
(20, 'heart', 'benefit', 4,
 'vasodilation, anti-arrhythmic, blood pressure',
 'calcium channel regulation, endothelial function',
 'Magnesium is nature''s calcium channel blocker, promoting vasodilation and normal heart rhythm. Deficiency increases arrhythmia risk. Studies show 100mg/day increase in Mg reduces heart failure risk by 22% and stroke risk by 7%.',
 'PMID:26404370,PMID:28959144',
 200, 400, 'linear',
 '50% of Americans deficient; nuts, seeds, leafy greens excellent sources'),

-- Resveratrol - Heart
(64, 'heart', 'benefit', 3,
 'antioxidant, endothelial function, SIRT1 activation',
 'increases nitric oxide, reduces oxidative stress, activates longevity genes',
 'Resveratrol improves endothelial function by increasing nitric oxide production and reducing oxidative stress. It activates SIRT1, associated with metabolic health. While promising in studies, high doses needed and bioavailability is limited.',
 'PMID:29098156,PMID:31252646',
 150, 500, 'threshold',
 'Bioavailability low; combined with piperine or liposomal forms may help'),

-- CoQ10 - Heart
(126, 'heart', 'benefit', 4,
 'mitochondrial energy, antioxidant',
 'electron carrier in ATP synthesis, regenerates vitamin E',
 'CoQ10 is essential for mitochondrial ATP production in the energy-demanding heart muscle. Levels decline with age and statin use. Supplementation improves heart failure outcomes and reduces statin-related muscle symptoms. Q-SYMBIO trial showed reduced cardiac events.',
 'PMID:25282031,PMID:29600770',
 100, 300, 'threshold',
 'Ubiquinol form better absorbed than ubiquinone'),

-- Added Sugars - Heart (CAUTION)
(147, 'heart', 'caution', 4,
 'metabolic dysfunction, inflammation',
 'de novo lipogenesis, AGE formation, insulin resistance',
 'Excess added sugar increases triglycerides, promotes visceral fat accumulation, raises blood pressure, and triggers chronic inflammation. The AHA recommends limiting to 25g/day (women) or 36g/day (men). High intake independently increases cardiovascular mortality.',
 'PMID:31589243,PMID:24493081',
 25000, NULL, 'J-shaped',
 'Sugar-sweetened beverages particularly harmful'),

-- Trans Fats - Heart (CAUTION)
(148, 'heart', 'caution', 5,
 'atherogenic, inflammatory',
 'increases LDL, decreases HDL, promotes endothelial dysfunction',
 'Trans fats are the most harmful dietary fat for cardiovascular health. They raise LDL, lower HDL, increase Lp(a), and promote inflammation. Each 2% increase in trans fat calories increases heart disease risk by 23%. Banned in many countries.',
 'PMID:16611951,PMID:30571451',
 0, NULL, 'linear-harm',
 'No safe level; avoid partially hydrogenated oils entirely'),

-- Excess Sodium - Heart (CAUTION)
(149, 'heart', 'caution', 4,
 'blood pressure elevation, fluid retention',
 'increases blood volume, arterial stiffness',
 'Excess sodium raises blood pressure through fluid retention and direct vascular effects. Reducing intake from average (3400mg) to recommended (2300mg or less) can lower blood pressure by 2-8 mmHg. Salt-sensitive individuals see greater effects.',
 'PMID:27216139,PMID:28882599',
 2300, NULL, 'linear-harm',
 'Processed foods account for 70% of intake; cook at home to control');

-- ============================================================================
-- LIVER EFFECTS
-- ============================================================================

INSERT OR REPLACE INTO compound_organ_effects
(compound_id, organ, effect, strength, mechanism, pathway, explanation, citations, threshold_mg, optimal_mg, dose_response, notes) VALUES

-- Choline - Liver
(128, 'liver', 'benefit', 5,
 'phosphatidylcholine synthesis, VLDL export',
 'prevents hepatic fat accumulation, methylation support',
 'Choline is essential for packaging and exporting fat from the liver as VLDL. Deficiency leads to fatty liver disease even in the absence of alcohol. 90% of Americans are deficient. Critical during pregnancy for fetal brain development.',
 'PMID:28806359,PMID:29387426',
 400, 550, 'threshold',
 'Eggs are best source (147mg/egg); deficiency very common'),

-- Betaine - Liver
(129, 'liver', 'benefit', 4,
 'methyl donor, osmoprotection',
 'homocysteine metabolism, hepatocyte protection',
 'Betaine serves as a methyl donor, converting homocysteine to methionine. It protects liver cells from osmotic stress and reduces fatty liver by promoting fat export. Studies show improvement in liver enzymes and steatosis markers.',
 'PMID:27604772,PMID:28267855',
 500, 2000, 'linear',
 'Found in beets, spinach, quinoa'),

-- Sulforaphane - Liver
(111, 'liver', 'benefit', 5,
 'Nrf2 activation, phase II enzymes',
 'induces glutathione synthesis, enhances detoxification capacity',
 'Sulforaphane is the most potent natural inducer of Nrf2, the master regulator of detoxification. It upregulates glutathione production by 300% and induces phase II enzymes (GST, NQO1) that neutralize carcinogens and oxidative stressors.',
 'PMID:25617536,PMID:31187029',
 30, 100, 'linear',
 'Broccoli sprouts contain 20-100x more than mature broccoli'),

-- Silymarin - Liver
-- Note: Adding silymarin as it's so important for liver
-- Would need to add to compounds table first

-- Alcohol - Liver (CAUTION)
(145, 'liver', 'caution', 5,
 'direct hepatotoxicity, oxidative stress',
 'acetaldehyde toxicity, CYP2E1 induction, glutathione depletion',
 'Alcohol is directly toxic to liver cells. Metabolism produces acetaldehyde, a carcinogen that damages hepatocytes. Chronic use depletes glutathione, induces CYP2E1 (generating free radicals), and promotes fatty liver, hepatitis, and cirrhosis. No safe level for liver health.',
 'PMID:30390747,PMID:29613090',
 0, NULL, 'linear-harm',
 'Even moderate drinking increases liver fat; risk increases exponentially with amount'),

-- Excess Fructose - Liver (CAUTION)
(150, 'liver', 'caution', 4,
 'de novo lipogenesis, uric acid generation',
 'fructokinase pathway bypasses metabolic regulation',
 'Unlike glucose, fructose is metabolized almost exclusively by the liver. High intake overwhelms the liver, driving de novo lipogenesis (fat production) and uric acid generation. This pathway is unregulated, making excess fructose particularly hepatotoxic.',
 'PMID:29408694,PMID:28802057',
 25000, NULL, 'threshold-harm',
 'Whole fruit fine due to fiber; concern is added fructose/HFCS in processed foods'),

-- Vitamin E - Liver
(3, 'liver', 'benefit', 3,
 'antioxidant, anti-inflammatory',
 'reduces hepatocyte oxidative damage and inflammation',
 'Vitamin E reduces oxidative stress and inflammation in the liver. The PIVENS trial showed significant improvement in non-alcoholic steatohepatitis (NASH) with 800 IU/day. Primary treatment for NASH in non-diabetics.',
 'PMID:20427778,PMID:25461851',
 15, 400, 'threshold',
 'High doses (>400 IU) may have risks; use under medical supervision for liver disease');

-- ============================================================================
-- GUT / DIGESTIVE EFFECTS
-- ============================================================================

INSERT OR REPLACE INTO compound_organ_effects
(compound_id, organ, effect, strength, mechanism, pathway, explanation, citations, threshold_mg, optimal_mg, dose_response, notes) VALUES

-- Glutamine - Gut
(93, 'gut', 'benefit', 5,
 'enterocyte fuel, tight junction support',
 'primary fuel for intestinal epithelial cells, maintains barrier integrity',
 'Glutamine is the primary fuel source for intestinal epithelial cells and maintains tight junction integrity. During stress, illness, or intense exercise, gut glutamine demand increases dramatically. Supplementation supports gut barrier function and reduces intestinal permeability.',
 'PMID:28177764,PMID:29350560',
 5000, 15000, 'linear',
 'Depleted during stress/illness; important for leaky gut'),

-- Resistant Starch - Gut
(104, 'gut', 'benefit', 5,
 'prebiotic, butyrate production',
 'fermented by colonic bacteria to SCFAs, especially butyrate',
 'Resistant starch reaches the colon intact where bacteria ferment it to short-chain fatty acids, particularly butyrate - the primary fuel for colonocytes. Butyrate strengthens gut barrier, reduces inflammation, and may protect against colorectal cancer.',
 'PMID:28420091,PMID:31249528',
 15000, 30000, 'linear',
 'Cooked-then-cooled potatoes/rice, green bananas excellent sources'),

-- Beta-Glucan - Gut
(100, 'gut', 'benefit', 4,
 'prebiotic, immune modulation',
 'fermented to SCFAs, activates gut immune cells via Dectin-1',
 'Beta-glucan serves as a prebiotic, feeding beneficial gut bacteria. It also directly activates intestinal immune cells through the Dectin-1 receptor, enhancing mucosal immunity. Helps maintain healthy microbiome diversity.',
 'PMID:28245835,PMID:29420377',
 3000, 6000, 'linear',
 'Oats, barley, mushrooms are sources'),

-- Polyphenols - Gut
(60, 'gut', 'benefit', 4,
 'prebiotic-like, antimicrobial selectivity',
 'inhibits pathogenic bacteria while supporting beneficial species',
 'Polyphenols act as selective antimicrobials, inhibiting pathogenic bacteria while promoting beneficial species like Akkermansia and Bifidobacteria. Only 5-10% are absorbed in small intestine; the rest reach the colon where they modulate microbiome composition.',
 'PMID:29415825,PMID:31426216',
 500, 1500, 'linear',
 'Berries, tea, cocoa, olive oil excellent sources'),

-- Ginger (Gingerols) - Gut
(124, 'gut', 'benefit', 4,
 'prokinetic, anti-emetic, anti-inflammatory',
 'accelerates gastric emptying, 5-HT3 antagonism',
 'Ginger accelerates gastric emptying and reduces nausea through serotonin receptor modulation. It''s as effective as metoclopramide for gastroparesis and superior to placebo for morning sickness. Also has anti-inflammatory effects on intestinal tissue.',
 'PMID:30680163,PMID:29370048',
 250, 1000, 'linear',
 'Fresh or dried ginger; 1g dried = ~4g fresh'),

-- Inulin - Gut (MIXED - prebiotic but FODMAP)
(101, 'gut', 'caution', 3,
 'prebiotic but fermentable',
 'bifidogenic effect but rapid fermentation causes gas',
 'Inulin is a potent prebiotic that dramatically increases Bifidobacteria. However, it''s a FODMAP (fructan) that ferments rapidly, causing significant gas, bloating, and discomfort in IBS patients. Benefits for those who tolerate it; problematic for FODMAP-sensitive individuals.',
 'PMID:29114527,PMID:30589338',
 2000, 5000, 'U-shaped',
 'Start low (2g) and increase slowly; avoid if FODMAP-sensitive'),

-- Capsaicin - Gut (CAUTION for sensitive)
(122, 'gut', 'caution', 2,
 'TRPV1 activation, motility effects',
 'stimulates gut sensory neurons, may accelerate transit',
 'Capsaicin activates TRPV1 receptors in the gut, which can cause burning sensation and accelerated motility in sensitive individuals. While some studies show benefits for functional dyspepsia, it can worsen symptoms in IBS or those with existing GI sensitivity.',
 'PMID:27259855,PMID:28557467',
 0, NULL, 'individual-dependent',
 'Tolerance varies widely; avoid if GI sensitivity present'),

-- Lectins - Gut (CAUTION if not properly prepared)
(142, 'gut', 'caution', 3,
 'gut barrier disruption, inflammation',
 'binds to intestinal epithelium if not denatured',
 'Raw or undercooked lectins (especially in kidney beans) can bind to intestinal cells, causing severe GI distress, increased permeability, and inflammation. Proper cooking (boiling, not slow cooking) denatures lectins completely, eliminating risk.',
 'PMID:19774556,PMID:28945461',
 0, NULL, 'threshold-harm',
 'Always boil beans/legumes adequately; slow cookers may not reach needed temperature');

-- ============================================================================
-- KIDNEY EFFECTS
-- ============================================================================

INSERT OR REPLACE INTO compound_organ_effects
(compound_id, organ, effect, strength, mechanism, pathway, explanation, citations, threshold_mg, optimal_mg, dose_response, notes) VALUES

-- Potassium - Kidney
(24, 'kidney', 'benefit', 4,
 'sodium excretion, acid-base balance',
 'promotes natriuresis, alkalinizing effect reduces stone risk',
 'Potassium promotes sodium excretion through the kidneys, reducing blood pressure and kidney workload. It also provides an alkaline load that reduces urinary calcium excretion, lowering kidney stone risk. However, must be cautious in advanced kidney disease.',
 'PMID:28986438,PMID:27402861',
 2000, 4700, 'context-dependent',
 'Beneficial for healthy kidneys; restrict if eGFR <45'),

-- Citrate - Kidney (would need to add to compounds)
-- Important for kidney stones but not in current compound list

-- Magnesium - Kidney
(20, 'kidney', 'benefit', 3,
 'stone prevention, blood pressure',
 'inhibits calcium oxalate crystal formation',
 'Magnesium inhibits calcium oxalate crystal formation in the kidneys, reducing stone risk. It also supports blood pressure control, reducing hypertensive kidney damage. However, primarily excreted by kidneys, so caution in advanced CKD.',
 'PMID:29435516,PMID:25008857',
 200, 400, 'context-dependent',
 'Beneficial for stone prevention; reduce dose if kidney function impaired'),

-- Vitamin C - Kidney (CONTEXT-DEPENDENT)
(1, 'kidney', 'caution', 2,
 'oxalate production',
 'metabolized to oxalate in some individuals',
 'High-dose vitamin C (>1000mg/day) can increase urinary oxalate in some individuals, potentially raising kidney stone risk in susceptible people. Normal dietary intake is not concerning. Those with history of calcium oxalate stones should limit supplemental C.',
 'PMID:23381448,PMID:29675301',
 1000, NULL, 'threshold-harm',
 'Normal dietary intake fine; concern is high-dose supplements in stone formers'),

-- Oxalate - Kidney (CAUTION)
(140, 'kidney', 'caution', 4,
 'stone formation',
 'combines with calcium to form calcium oxalate stones',
 'Oxalate binds with calcium in the kidney to form calcium oxalate, the most common type of kidney stone (80%). High-oxalate foods (spinach, rhubarb, nuts) can significantly increase stone risk in susceptible individuals. Adequate calcium intake paradoxically reduces risk by binding oxalate in the gut.',
 'PMID:29679017,PMID:27888903',
 100, NULL, 'cumulative',
 'Drink adequate fluids; pair high-oxalate foods with calcium sources'),

-- Phosphorus - Kidney (CAUTION in CKD)
(26, 'kidney', 'caution', 4,
 'phosphorus accumulation, vascular calcification',
 'damaged kidneys cannot excrete phosphorus; accumulation causes bone/vascular disease',
 'Healthy kidneys easily handle dietary phosphorus. However, in chronic kidney disease, phosphorus accumulates, causing hyperparathyroidism, bone disease, and vascular calcification - a major cause of cardiovascular death in CKD. Phosphorus additives in processed foods are 100% absorbed.',
 'PMID:28178436,PMID:29587429',
 800, NULL, 'context-dependent',
 'No concern if healthy kidneys; critical to limit in CKD stages 3-5'),

-- Sodium - Kidney (CAUTION)
(27, 'kidney', 'caution', 3,
 'hyperfiltration, proteinuria',
 'increases glomerular pressure, worsens proteinuria',
 'High sodium intake increases kidney workload through hyperfiltration and worsens proteinuria, accelerating kidney disease progression. In CKD, limiting sodium to <2000mg/day slows decline. Also raises blood pressure, the second leading cause of kidney failure.',
 'PMID:28716620,PMID:27009577',
 2000, NULL, 'linear-harm',
 'Particularly important to limit in existing kidney disease or hypertension');

-- ============================================================================
-- IMMUNE SYSTEM EFFECTS
-- ============================================================================

INSERT OR REPLACE INTO compound_organ_effects
(compound_id, organ, effect, strength, mechanism, pathway, explanation, citations, threshold_mg, optimal_mg, dose_response, notes) VALUES

-- Vitamin C - Immune
(1, 'immune', 'benefit', 4,
 'antioxidant, immune cell function',
 'supports neutrophil/lymphocyte function, enhances phagocytosis',
 'Vitamin C accumulates in immune cells at concentrations 100x higher than plasma. It supports neutrophil chemotaxis, phagocytosis, and microbial killing. During infection, vitamin C is rapidly depleted. Supplementation reduces cold duration by 8% in adults and more in those under physical stress.',
 'PMID:29099763,PMID:28353648',
 200, 500, 'threshold-then-plateau',
 'Extra benefit during infection; megadoses not proven more effective'),

-- Vitamin D - Immune
(2, 'immune', 'benefit', 5,
 'immune modulation, antimicrobial peptides',
 'VDR activation in immune cells, cathelicidin induction',
 'Vitamin D receptors are present on virtually all immune cells. D activates production of cathelicidin, an antimicrobial peptide that kills bacteria, viruses, and fungi. It also modulates inflammation, reducing autoimmune risk. Deficiency strongly linked to increased infections.',
 'PMID:28768407,PMID:31405892',
 1000, 4000, 'threshold',
 'Target serum 25(OH)D 40-60 ng/mL; most need supplementation'),

-- Zinc - Immune
(21, 'immune', 'benefit', 5,
 'immune cell development, antiviral',
 'thymulin cofactor, inhibits viral replication',
 'Zinc is essential for immune cell development and function. It''s a cofactor for thymulin, critical for T-cell maturation. Zinc also directly inhibits viral replication (including coronaviruses) and reduces inflammation. Deficiency, common in elderly, severely impairs immunity.',
 'PMID:28395131,PMID:31305906',
 8, 40, 'U-shaped',
 'Lozenges at cold onset can reduce duration; excess (>40mg) can impair immunity'),

-- Selenium - Immune
(23, 'immune', 'benefit', 4,
 'selenoprotein function, antiviral',
 'glutathione peroxidase activity, thyroid hormone metabolism',
 'Selenium is incorporated into selenoproteins critical for antioxidant defense and immune function. It enhances T-cell proliferation and natural killer cell activity. Deficiency allows viruses to mutate to more virulent forms (observed with Coxsackie virus → Keshan disease).',
 'PMID:29843644,PMID:28931416',
 55, 200, 'U-shaped',
 'Brazil nuts extremely high (1 nut = 75-90mcg); toxicity possible at >400mcg'),

-- Beta-Glucan - Immune
(100, 'immune', 'benefit', 4,
 'innate immune activation',
 'binds Dectin-1 receptor on macrophages, enhances phagocytosis',
 'Beta-glucan directly activates innate immune cells through the Dectin-1 receptor on macrophages and dendritic cells. This primes the immune system to respond faster to pathogens. Studies show reduced respiratory infections in athletes and stressed individuals.',
 'PMID:28245835,PMID:30127747',
 250, 500, 'threshold',
 'Yeast and mushroom beta-glucans most immunologically active'),

-- Quercetin - Immune
(60, 'immune', 'benefit', 3,
 'antiviral, anti-inflammatory, zinc ionophore',
 'inhibits viral entry and replication, stabilizes mast cells',
 'Quercetin has broad antiviral activity by inhibiting viral entry and replication. It acts as a zinc ionophore, helping zinc enter cells where it can inhibit viral RNA polymerase. Also stabilizes mast cells, reducing allergic inflammation.',
 'PMID:32340551,PMID:27187333',
 500, 1000, 'threshold',
 'Synergistic with zinc and vitamin C; bioavailability improved with bromelain'),

-- Elderberry - Immune (would need to add anthocyanins context)
-- Covered under anthocyanins

-- Curcumin - Immune
(65, 'immune', 'benefit', 3,
 'immunomodulatory, anti-inflammatory',
 'modulates NF-kB, supports T-cell function',
 'Curcumin modulates immune function by regulating T-cell, B-cell, and macrophage activity. It inhibits excessive inflammatory responses while supporting appropriate immune activation. Useful for balancing immunity rather than simply boosting it.',
 'PMID:29877470,PMID:31159010',
 500, 1000, 'threshold',
 'Anti-inflammatory effect may help with autoimmune overactivation');
