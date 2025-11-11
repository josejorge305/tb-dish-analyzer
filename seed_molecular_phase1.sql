-- �� Phase 1 seed: organs + a few well-known compounds

-- Organ lookup (simple names used by the app)
INSERT OR IGNORE INTO organ_systems (organ, system, description) VALUES
('gut','Digestive','Intestinal tract and microbiome'),
('liver','Digestive','Hepatic metabolism and detox'),
('heart','Cardiovascular','Cardiac muscle and vessels'),
('brain','Nervous','Central nervous system'),
('immune','Immune','Innate/adaptive immune responses');

-- A few common food compounds (name, common_name, formula, cid, description)
INSERT OR IGNORE INTO compounds (name, common_name, formula, cid, description) VALUES
('Allicin','Garlic active','C6H10OS2','65036','Sulfur compound from crushed garlic'),
('Quercetin','Onion/Apple flavonoid','C15H10O7','5280343','Polyphenol found in many plants'),
('Curcumin','Turmeric pigment','C21H20O6','969516','Principal curcuminoid of turmeric'),
('Piperine','Black pepper alkaloid','C17H19NO3','638024','Enhances bioavailability of some nutrients'),
('Catechin','Green tea catechin','C15H14O6','9064','Tea polyphenol'),
('Theobromine','Cocoa methylxanthine','C7H8N4O2','5429','Cocoa/Chocolate compound'),
('Lycopene','Tomato carotenoid','C40H56','446925','Red carotenoid in tomatoes'),
('Caffeine','Coffee/Tea stimulant','C8H10N4O2','2519','Mild CNS stimulant'),
('Genistein','Soy isoflavone','C15H10O5','5280961','Representative soy isoflavone'),
('Histamine','Biogenic amine','C5H9N3','774','Occurs in aged cheeses like parmesan');

-- Compound -> organ effects (very simple placeholders for demo/UI tests)
INSERT OR IGNORE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'gut', 'benefit', 3, 'Traditional association with GI support'
FROM compounds c WHERE c.name='Allicin';

INSERT OR IGNORE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'liver', 'benefit', 2, 'General antioxidant link'
FROM compounds c WHERE c.name='Curcumin';

INSERT OR IGNORE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'brain', 'benefit', 2, 'Mild CNS stimulant'
FROM compounds c WHERE c.name='Caffeine';

INSERT OR IGNORE INTO compound_organ_effects (compound_id, organ, effect, strength, notes)
SELECT c.id, 'gut', 'risk', 3, 'Biogenic amine—watch sensitivity (aged cheese)'
FROM compounds c WHERE c.name='Histamine';

-- Optional example “edges” connecting compounds to generic targets/pathways (for dev-only demos)
INSERT OR IGNORE INTO bio_edges (compound_id, target, pathway, evidence_level, citation)
SELECT c.id, 'NF-κB', 'Inflammation (generic)', 'weak', 'seed/demo'
FROM compounds c WHERE c.name='Curcumin';

INSERT OR IGNORE INTO bio_edges (compound_id, target, pathway, evidence_level, citation)
SELECT c.id, 'Adenosine receptors', 'Neuromodulation (generic)', 'weak', 'seed/demo'
FROM compounds c WHERE c.name='Caffeine';
