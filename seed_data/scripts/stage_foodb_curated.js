#!/usr/bin/env node
/**
 * FooDB Curated Bioactive Compounds
 *
 * Pre-curated list of the most important bioactive compounds with their food sources.
 * Based on FooDB data and scientific literature on bioactive food compounds.
 *
 * This covers the major classes:
 * - Flavonoids (quercetin, kaempferol, catechins, anthocyanins)
 * - Carotenoids (beta-carotene, lycopene, lutein, zeaxanthin)
 * - Polyphenols (resveratrol, curcumin, chlorogenic acid)
 * - Organosulfur (sulforaphane, allicin)
 * - Alkaloids (caffeine, theobromine)
 * - Phytosterols (beta-sitosterol, campesterol)
 *
 * OUTPUT: seed_data/out/foodb_bioactives.sql
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.join(__dirname, '..', 'out');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function sqlEscape(str) {
  if (str == null) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

// Curated bioactive compounds database
// Format: { compound, class, subclass, foods: [{name, amount_per_100g, unit}], effects, organs }
const BIOACTIVE_COMPOUNDS = [
  // ============ FLAVONOIDS ============
  {
    compound: 'Quercetin',
    class: 'flavonoid',
    subclass: 'flavonol',
    effects: ['antioxidant', 'anti-inflammatory', 'antihistamine', 'cardioprotective'],
    organs: ['heart', 'immune', 'respiratory'],
    foods: [
      { name: 'onion', amount: 45, unit: 'mg' },
      { name: 'apple', amount: 4.4, unit: 'mg' },
      { name: 'kale', amount: 22.6, unit: 'mg' },
      { name: 'broccoli', amount: 2.8, unit: 'mg' },
      { name: 'blueberry', amount: 14.2, unit: 'mg' },
      { name: 'cherry', amount: 17.4, unit: 'mg' },
      { name: 'grape', amount: 3.5, unit: 'mg' },
      { name: 'tomato', amount: 0.7, unit: 'mg' },
      { name: 'green tea', amount: 2.7, unit: 'mg' },
      { name: 'capers', amount: 233, unit: 'mg' },
    ]
  },
  {
    compound: 'Kaempferol',
    class: 'flavonoid',
    subclass: 'flavonol',
    effects: ['antioxidant', 'anti-inflammatory', 'neuroprotective', 'anticancer'],
    organs: ['brain', 'heart', 'immune'],
    foods: [
      { name: 'kale', amount: 47, unit: 'mg' },
      { name: 'spinach', amount: 55, unit: 'mg' },
      { name: 'broccoli', amount: 7.2, unit: 'mg' },
      { name: 'cabbage', amount: 0.1, unit: 'mg' },
      { name: 'green tea', amount: 1.5, unit: 'mg' },
      { name: 'strawberry', amount: 1.1, unit: 'mg' },
      { name: 'leek', amount: 5.7, unit: 'mg' },
    ]
  },
  {
    compound: 'Myricetin',
    class: 'flavonoid',
    subclass: 'flavonol',
    effects: ['antioxidant', 'anticancer', 'antiviral', 'neuroprotective'],
    organs: ['brain', 'immune', 'liver'],
    foods: [
      { name: 'cranberry', amount: 6.6, unit: 'mg' },
      { name: 'grape', amount: 0.7, unit: 'mg' },
      { name: 'blueberry', amount: 1.3, unit: 'mg' },
      { name: 'blackberry', amount: 0.7, unit: 'mg' },
      { name: 'swiss chard', amount: 3.2, unit: 'mg' },
    ]
  },
  {
    compound: 'Epigallocatechin gallate',
    class: 'flavonoid',
    subclass: 'catechin',
    effects: ['antioxidant', 'metabolism-boost', 'neuroprotective', 'cardioprotective'],
    organs: ['brain', 'heart', 'metabolism'],
    foods: [
      { name: 'green tea', amount: 70, unit: 'mg' },
      { name: 'matcha', amount: 137, unit: 'mg' },
      { name: 'black tea', amount: 9.4, unit: 'mg' },
      { name: 'apple', amount: 0.1, unit: 'mg' },
      { name: 'dark chocolate', amount: 0.1, unit: 'mg' },
    ]
  },
  {
    compound: 'Catechin',
    class: 'flavonoid',
    subclass: 'catechin',
    effects: ['antioxidant', 'cardioprotective', 'anti-obesity'],
    organs: ['heart', 'metabolism', 'blood'],
    foods: [
      { name: 'green tea', amount: 10.1, unit: 'mg' },
      { name: 'dark chocolate', amount: 53.5, unit: 'mg' },
      { name: 'apple', amount: 11.1, unit: 'mg' },
      { name: 'pear', amount: 4.0, unit: 'mg' },
      { name: 'red wine', amount: 8.0, unit: 'mg' },
      { name: 'apricot', amount: 9.6, unit: 'mg' },
    ]
  },
  {
    compound: 'Epicatechin',
    class: 'flavonoid',
    subclass: 'catechin',
    effects: ['antioxidant', 'cardioprotective', 'vasodilator', 'muscle-recovery'],
    organs: ['heart', 'blood', 'muscles'],
    foods: [
      { name: 'dark chocolate', amount: 70, unit: 'mg' },
      { name: 'cocoa powder', amount: 158, unit: 'mg' },
      { name: 'apple', amount: 10.4, unit: 'mg' },
      { name: 'blackberry', amount: 18.7, unit: 'mg' },
      { name: 'cherry', amount: 7.2, unit: 'mg' },
      { name: 'grape', amount: 8.7, unit: 'mg' },
    ]
  },
  {
    compound: 'Cyanidin',
    class: 'flavonoid',
    subclass: 'anthocyanin',
    effects: ['antioxidant', 'anti-inflammatory', 'neuroprotective', 'vision-support'],
    organs: ['brain', 'eyes', 'heart'],
    foods: [
      { name: 'blueberry', amount: 163, unit: 'mg' },
      { name: 'blackberry', amount: 245, unit: 'mg' },
      { name: 'cherry', amount: 122, unit: 'mg' },
      { name: 'raspberry', amount: 90, unit: 'mg' },
      { name: 'red cabbage', amount: 209, unit: 'mg' },
      { name: 'black bean', amount: 44, unit: 'mg' },
      { name: 'eggplant', amount: 86, unit: 'mg' },
    ]
  },
  {
    compound: 'Delphinidin',
    class: 'flavonoid',
    subclass: 'anthocyanin',
    effects: ['antioxidant', 'anti-inflammatory', 'anticancer', 'cardioprotective'],
    organs: ['heart', 'immune', 'brain'],
    foods: [
      { name: 'blueberry', amount: 48, unit: 'mg' },
      { name: 'blackcurrant', amount: 134, unit: 'mg' },
      { name: 'grape', amount: 9.3, unit: 'mg' },
      { name: 'pomegranate', amount: 41, unit: 'mg' },
      { name: 'eggplant', amount: 85, unit: 'mg' },
    ]
  },
  {
    compound: 'Pelargonidin',
    class: 'flavonoid',
    subclass: 'anthocyanin',
    effects: ['antioxidant', 'anti-inflammatory', 'cardioprotective'],
    organs: ['heart', 'blood', 'skin'],
    foods: [
      { name: 'strawberry', amount: 68, unit: 'mg' },
      { name: 'raspberry', amount: 32, unit: 'mg' },
      { name: 'radish', amount: 63, unit: 'mg' },
      { name: 'kidney bean', amount: 5, unit: 'mg' },
    ]
  },
  {
    compound: 'Hesperetin',
    class: 'flavonoid',
    subclass: 'flavanone',
    effects: ['antioxidant', 'cholesterol-lowering', 'anti-inflammatory'],
    organs: ['heart', 'blood', 'liver'],
    foods: [
      { name: 'orange', amount: 43, unit: 'mg' },
      { name: 'grapefruit', amount: 31, unit: 'mg' },
      { name: 'lemon', amount: 20, unit: 'mg' },
      { name: 'lime', amount: 15, unit: 'mg' },
    ]
  },
  {
    compound: 'Naringenin',
    class: 'flavonoid',
    subclass: 'flavanone',
    effects: ['antioxidant', 'hepatoprotective', 'anti-obesity', 'cholesterol-lowering'],
    organs: ['liver', 'metabolism', 'heart'],
    foods: [
      { name: 'grapefruit', amount: 53, unit: 'mg' },
      { name: 'orange', amount: 15, unit: 'mg' },
      { name: 'tomato', amount: 0.7, unit: 'mg' },
      { name: 'cherry', amount: 0.5, unit: 'mg' },
    ]
  },
  {
    compound: 'Apigenin',
    class: 'flavonoid',
    subclass: 'flavone',
    effects: ['anti-inflammatory', 'anxiolytic', 'sleep-promoting', 'neuroprotective'],
    organs: ['brain', 'nervous', 'immune'],
    foods: [
      { name: 'parsley', amount: 225, unit: 'mg' },
      { name: 'celery', amount: 19.1, unit: 'mg' },
      { name: 'chamomile', amount: 3, unit: 'mg' },
      { name: 'thyme', amount: 45, unit: 'mg' },
      { name: 'oregano', amount: 4, unit: 'mg' },
    ]
  },
  {
    compound: 'Luteolin',
    class: 'flavonoid',
    subclass: 'flavone',
    effects: ['anti-inflammatory', 'neuroprotective', 'anticancer', 'antiallergic'],
    organs: ['brain', 'immune', 'respiratory'],
    foods: [
      { name: 'parsley', amount: 1.1, unit: 'mg' },
      { name: 'celery', amount: 3.5, unit: 'mg' },
      { name: 'artichoke', amount: 42, unit: 'mg' },
      { name: 'thyme', amount: 51, unit: 'mg' },
      { name: 'broccoli', amount: 0.8, unit: 'mg' },
      { name: 'pepper', amount: 5.1, unit: 'mg' },
    ]
  },
  {
    compound: 'Genistein',
    class: 'flavonoid',
    subclass: 'isoflavone',
    effects: ['phytoestrogen', 'bone-health', 'menopause-relief', 'cardioprotective'],
    organs: ['bone', 'heart', 'hormones'],
    foods: [
      { name: 'soybean', amount: 81, unit: 'mg' },
      { name: 'tofu', amount: 21, unit: 'mg' },
      { name: 'tempeh', amount: 19, unit: 'mg' },
      { name: 'edamame', amount: 17, unit: 'mg' },
      { name: 'miso', amount: 8.9, unit: 'mg' },
    ]
  },
  {
    compound: 'Daidzein',
    class: 'flavonoid',
    subclass: 'isoflavone',
    effects: ['phytoestrogen', 'bone-health', 'cardiovascular'],
    organs: ['bone', 'heart', 'hormones'],
    foods: [
      { name: 'soybean', amount: 62, unit: 'mg' },
      { name: 'tofu', amount: 13, unit: 'mg' },
      { name: 'tempeh', amount: 17, unit: 'mg' },
      { name: 'edamame', amount: 18, unit: 'mg' },
    ]
  },

  // ============ CAROTENOIDS ============
  {
    compound: 'Beta-carotene',
    class: 'carotenoid',
    subclass: 'carotene',
    effects: ['vitamin-a-precursor', 'antioxidant', 'immune-support', 'skin-health'],
    organs: ['eyes', 'skin', 'immune'],
    foods: [
      { name: 'carrot', amount: 8285, unit: 'µg' },
      { name: 'sweet potato', amount: 8509, unit: 'µg' },
      { name: 'spinach', amount: 5626, unit: 'µg' },
      { name: 'kale', amount: 6202, unit: 'µg' },
      { name: 'pumpkin', amount: 3100, unit: 'µg' },
      { name: 'mango', amount: 445, unit: 'µg' },
      { name: 'cantaloupe', amount: 2020, unit: 'µg' },
      { name: 'apricot', amount: 1094, unit: 'µg' },
      { name: 'papaya', amount: 274, unit: 'µg' },
    ]
  },
  {
    compound: 'Alpha-carotene',
    class: 'carotenoid',
    subclass: 'carotene',
    effects: ['antioxidant', 'vitamin-a-precursor', 'anticancer'],
    organs: ['eyes', 'immune', 'skin'],
    foods: [
      { name: 'carrot', amount: 3477, unit: 'µg' },
      { name: 'pumpkin', amount: 4016, unit: 'µg' },
      { name: 'butternut squash', amount: 834, unit: 'µg' },
      { name: 'orange', amount: 16, unit: 'µg' },
    ]
  },
  {
    compound: 'Lycopene',
    class: 'carotenoid',
    subclass: 'carotene',
    effects: ['antioxidant', 'cardioprotective', 'prostate-health', 'skin-protection'],
    organs: ['heart', 'prostate', 'skin'],
    foods: [
      { name: 'tomato', amount: 2573, unit: 'µg' },
      { name: 'watermelon', amount: 4532, unit: 'µg' },
      { name: 'grapefruit', amount: 1419, unit: 'µg' },
      { name: 'papaya', amount: 1828, unit: 'µg' },
      { name: 'guava', amount: 5204, unit: 'µg' },
      { name: 'tomato paste', amount: 28764, unit: 'µg' },
      { name: 'sun-dried tomato', amount: 45902, unit: 'µg' },
    ]
  },
  {
    compound: 'Lutein',
    class: 'carotenoid',
    subclass: 'xanthophyll',
    effects: ['eye-health', 'macular-protection', 'antioxidant', 'cognitive'],
    organs: ['eyes', 'brain', 'skin'],
    foods: [
      { name: 'kale', amount: 18246, unit: 'µg' },
      { name: 'spinach', amount: 12198, unit: 'µg' },
      { name: 'swiss chard', amount: 11000, unit: 'µg' },
      { name: 'egg yolk', amount: 1094, unit: 'µg' },
      { name: 'corn', amount: 1355, unit: 'µg' },
      { name: 'broccoli', amount: 1403, unit: 'µg' },
      { name: 'orange pepper', amount: 1665, unit: 'µg' },
    ]
  },
  {
    compound: 'Zeaxanthin',
    class: 'carotenoid',
    subclass: 'xanthophyll',
    effects: ['eye-health', 'macular-protection', 'antioxidant'],
    organs: ['eyes', 'brain'],
    foods: [
      { name: 'corn', amount: 528, unit: 'µg' },
      { name: 'orange pepper', amount: 1665, unit: 'µg' },
      { name: 'egg yolk', amount: 587, unit: 'µg' },
      { name: 'goji berry', amount: 16000, unit: 'µg' },
      { name: 'spinach', amount: 331, unit: 'µg' },
    ]
  },
  {
    compound: 'Beta-cryptoxanthin',
    class: 'carotenoid',
    subclass: 'xanthophyll',
    effects: ['vitamin-a-precursor', 'antioxidant', 'bone-health', 'anti-inflammatory'],
    organs: ['bone', 'immune', 'eyes'],
    foods: [
      { name: 'orange', amount: 116, unit: 'µg' },
      { name: 'tangerine', amount: 407, unit: 'µg' },
      { name: 'papaya', amount: 761, unit: 'µg' },
      { name: 'persimmon', amount: 1447, unit: 'µg' },
      { name: 'pumpkin', amount: 2145, unit: 'µg' },
    ]
  },
  {
    compound: 'Astaxanthin',
    class: 'carotenoid',
    subclass: 'xanthophyll',
    effects: ['antioxidant', 'anti-inflammatory', 'skin-health', 'exercise-recovery'],
    organs: ['skin', 'muscles', 'heart'],
    foods: [
      { name: 'salmon', amount: 4600, unit: 'µg' },
      { name: 'shrimp', amount: 1200, unit: 'µg' },
      { name: 'lobster', amount: 800, unit: 'µg' },
      { name: 'crab', amount: 400, unit: 'µg' },
      { name: 'trout', amount: 1000, unit: 'µg' },
    ]
  },

  // ============ POLYPHENOLS (NON-FLAVONOIDS) ============
  {
    compound: 'Resveratrol',
    class: 'polyphenol',
    subclass: 'stilbene',
    effects: ['antioxidant', 'anti-aging', 'cardioprotective', 'neuroprotective'],
    organs: ['heart', 'brain', 'metabolism'],
    foods: [
      { name: 'red wine', amount: 1.98, unit: 'mg' },
      { name: 'grape', amount: 1.5, unit: 'mg' },
      { name: 'peanut', amount: 0.08, unit: 'mg' },
      { name: 'blueberry', amount: 0.38, unit: 'mg' },
      { name: 'cranberry', amount: 0.2, unit: 'mg' },
      { name: 'dark chocolate', amount: 0.35, unit: 'mg' },
    ]
  },
  {
    compound: 'Curcumin',
    class: 'polyphenol',
    subclass: 'curcuminoid',
    effects: ['anti-inflammatory', 'antioxidant', 'anticancer', 'neuroprotective'],
    organs: ['brain', 'joints', 'liver', 'gut'],
    foods: [
      { name: 'turmeric', amount: 3140, unit: 'mg' },
      { name: 'curry powder', amount: 285, unit: 'mg' },
      { name: 'ginger', amount: 0.5, unit: 'mg' },
    ]
  },
  {
    compound: 'Chlorogenic acid',
    class: 'polyphenol',
    subclass: 'hydroxycinnamic_acid',
    effects: ['antioxidant', 'blood-sugar-regulation', 'weight-management', 'hepatoprotective'],
    organs: ['liver', 'metabolism', 'heart'],
    foods: [
      { name: 'coffee', amount: 70, unit: 'mg' },
      { name: 'apple', amount: 5, unit: 'mg' },
      { name: 'pear', amount: 4.7, unit: 'mg' },
      { name: 'artichoke', amount: 24, unit: 'mg' },
      { name: 'potato', amount: 28, unit: 'mg' },
      { name: 'blueberry', amount: 18, unit: 'mg' },
      { name: 'sunflower seed', amount: 12, unit: 'mg' },
    ]
  },
  {
    compound: 'Ellagic acid',
    class: 'polyphenol',
    subclass: 'ellagitannin',
    effects: ['antioxidant', 'anticancer', 'anti-inflammatory', 'skin-protection'],
    organs: ['skin', 'immune', 'liver'],
    foods: [
      { name: 'pomegranate', amount: 57, unit: 'mg' },
      { name: 'raspberry', amount: 38, unit: 'mg' },
      { name: 'strawberry', amount: 2.1, unit: 'mg' },
      { name: 'blackberry', amount: 44, unit: 'mg' },
      { name: 'walnut', amount: 59, unit: 'mg' },
      { name: 'pecan', amount: 33, unit: 'mg' },
    ]
  },
  {
    compound: 'Rosmarinic acid',
    class: 'polyphenol',
    subclass: 'hydroxycinnamic_acid',
    effects: ['anti-inflammatory', 'antioxidant', 'antiallergic', 'antimicrobial'],
    organs: ['respiratory', 'immune', 'skin'],
    foods: [
      { name: 'rosemary', amount: 1820, unit: 'mg' },
      { name: 'oregano', amount: 1272, unit: 'mg' },
      { name: 'sage', amount: 1200, unit: 'mg' },
      { name: 'thyme', amount: 890, unit: 'mg' },
      { name: 'basil', amount: 610, unit: 'mg' },
      { name: 'mint', amount: 570, unit: 'mg' },
    ]
  },

  // ============ ORGANOSULFUR COMPOUNDS ============
  {
    compound: 'Sulforaphane',
    class: 'organosulfur',
    subclass: 'isothiocyanate',
    effects: ['detoxification', 'anticancer', 'anti-inflammatory', 'neuroprotective'],
    organs: ['liver', 'immune', 'brain'],
    foods: [
      { name: 'broccoli sprouts', amount: 250, unit: 'mg' },
      { name: 'broccoli', amount: 44, unit: 'mg' },
      { name: 'brussels sprouts', amount: 44, unit: 'mg' },
      { name: 'cabbage', amount: 36, unit: 'mg' },
      { name: 'cauliflower', amount: 28, unit: 'mg' },
      { name: 'kale', amount: 25, unit: 'mg' },
    ]
  },
  {
    compound: 'Allicin',
    class: 'organosulfur',
    subclass: 'thiosulfinate',
    effects: ['antimicrobial', 'cardioprotective', 'immune-boost', 'blood-pressure'],
    organs: ['heart', 'immune', 'blood'],
    foods: [
      { name: 'garlic', amount: 28, unit: 'mg' },
      { name: 'onion', amount: 0.05, unit: 'mg' },
      { name: 'leek', amount: 0.03, unit: 'mg' },
    ]
  },
  {
    compound: 'Diallyl disulfide',
    class: 'organosulfur',
    subclass: 'diallyl_sulfide',
    effects: ['anticancer', 'cardioprotective', 'antimicrobial'],
    organs: ['heart', 'immune', 'liver'],
    foods: [
      { name: 'garlic', amount: 4.3, unit: 'mg' },
      { name: 'onion', amount: 0.7, unit: 'mg' },
      { name: 'chives', amount: 0.5, unit: 'mg' },
    ]
  },
  {
    compound: 'Indole-3-carbinol',
    class: 'organosulfur',
    subclass: 'indole',
    effects: ['hormone-balance', 'detoxification', 'anticancer'],
    organs: ['liver', 'hormones', 'immune'],
    foods: [
      { name: 'broccoli', amount: 107, unit: 'mg' },
      { name: 'brussels sprouts', amount: 104, unit: 'mg' },
      { name: 'cabbage', amount: 98, unit: 'mg' },
      { name: 'cauliflower', amount: 72, unit: 'mg' },
      { name: 'kale', amount: 67, unit: 'mg' },
      { name: 'bok choy', amount: 56, unit: 'mg' },
    ]
  },

  // ============ ALKALOIDS ============
  {
    compound: 'Caffeine',
    class: 'alkaloid',
    subclass: 'purine',
    effects: ['stimulant', 'alertness', 'metabolism-boost', 'cognitive-enhancement'],
    organs: ['brain', 'metabolism', 'heart'],
    foods: [
      { name: 'coffee', amount: 40, unit: 'mg' },
      { name: 'espresso', amount: 212, unit: 'mg' },
      { name: 'green tea', amount: 20, unit: 'mg' },
      { name: 'black tea', amount: 40, unit: 'mg' },
      { name: 'dark chocolate', amount: 43, unit: 'mg' },
      { name: 'cocoa powder', amount: 230, unit: 'mg' },
    ]
  },
  {
    compound: 'Theobromine',
    class: 'alkaloid',
    subclass: 'purine',
    effects: ['mild-stimulant', 'vasodilator', 'mood-enhancing', 'diuretic'],
    organs: ['heart', 'brain', 'blood'],
    foods: [
      { name: 'dark chocolate', amount: 802, unit: 'mg' },
      { name: 'cocoa powder', amount: 2057, unit: 'mg' },
      { name: 'milk chocolate', amount: 211, unit: 'mg' },
      { name: 'green tea', amount: 2, unit: 'mg' },
    ]
  },
  {
    compound: 'L-theanine',
    class: 'alkaloid',
    subclass: 'amino_acid_derivative',
    effects: ['relaxation', 'focus', 'stress-reduction', 'sleep-quality'],
    organs: ['brain', 'nervous'],
    foods: [
      { name: 'green tea', amount: 25, unit: 'mg' },
      { name: 'matcha', amount: 44, unit: 'mg' },
      { name: 'black tea', amount: 8, unit: 'mg' },
    ]
  },
  {
    compound: 'Capsaicin',
    class: 'alkaloid',
    subclass: 'capsaicinoid',
    effects: ['metabolism-boost', 'pain-relief', 'anti-inflammatory', 'appetite-suppression'],
    organs: ['metabolism', 'pain', 'digestive'],
    foods: [
      { name: 'cayenne pepper', amount: 198, unit: 'mg' },
      { name: 'jalapeno', amount: 0.5, unit: 'mg' },
      { name: 'habanero', amount: 28, unit: 'mg' },
      { name: 'serrano pepper', amount: 1.5, unit: 'mg' },
      { name: 'chili powder', amount: 85, unit: 'mg' },
    ]
  },
  {
    compound: 'Piperine',
    class: 'alkaloid',
    subclass: 'piperidine',
    effects: ['bioavailability-enhancer', 'thermogenic', 'antioxidant', 'digestive'],
    organs: ['metabolism', 'digestive', 'liver'],
    foods: [
      { name: 'black pepper', amount: 50, unit: 'mg' },
      { name: 'white pepper', amount: 40, unit: 'mg' },
    ]
  },

  // ============ PHYTOSTEROLS ============
  {
    compound: 'Beta-sitosterol',
    class: 'phytosterol',
    subclass: 'sterol',
    effects: ['cholesterol-lowering', 'prostate-health', 'anti-inflammatory'],
    organs: ['heart', 'prostate', 'blood'],
    foods: [
      { name: 'avocado', amount: 76, unit: 'mg' },
      { name: 'almond', amount: 143, unit: 'mg' },
      { name: 'pistachio', amount: 198, unit: 'mg' },
      { name: 'walnut', amount: 72, unit: 'mg' },
      { name: 'olive oil', amount: 118, unit: 'mg' },
      { name: 'sesame seed', amount: 118, unit: 'mg' },
      { name: 'wheat germ', amount: 197, unit: 'mg' },
    ]
  },
  {
    compound: 'Campesterol',
    class: 'phytosterol',
    subclass: 'sterol',
    effects: ['cholesterol-lowering', 'cardioprotective'],
    organs: ['heart', 'blood'],
    foods: [
      { name: 'canola oil', amount: 27, unit: 'mg' },
      { name: 'wheat germ', amount: 17, unit: 'mg' },
      { name: 'corn oil', amount: 44, unit: 'mg' },
      { name: 'soybean', amount: 20, unit: 'mg' },
    ]
  },
  {
    compound: 'Stigmasterol',
    class: 'phytosterol',
    subclass: 'sterol',
    effects: ['cholesterol-lowering', 'anti-inflammatory', 'anticancer'],
    organs: ['heart', 'blood', 'immune'],
    foods: [
      { name: 'soybean oil', amount: 49, unit: 'mg' },
      { name: 'cocoa butter', amount: 96, unit: 'mg' },
      { name: 'kidney bean', amount: 15, unit: 'mg' },
    ]
  },

  // ============ LIGNANS ============
  {
    compound: 'Secoisolariciresinol',
    class: 'polyphenol',
    subclass: 'lignan',
    effects: ['phytoestrogen', 'antioxidant', 'cardioprotective', 'hormone-balance'],
    organs: ['heart', 'hormones', 'breast'],
    foods: [
      { name: 'flaxseed', amount: 369, unit: 'mg' },
      { name: 'sesame seed', amount: 29, unit: 'mg' },
      { name: 'sunflower seed', amount: 0.9, unit: 'mg' },
      { name: 'cashew', amount: 0.6, unit: 'mg' },
    ]
  },

  // ============ TERPENES ============
  {
    compound: 'Limonene',
    class: 'terpene',
    subclass: 'monoterpene',
    effects: ['anticancer', 'detoxification', 'digestive', 'mood-enhancing'],
    organs: ['liver', 'digestive', 'brain'],
    foods: [
      { name: 'orange peel', amount: 9000, unit: 'mg' },
      { name: 'lemon peel', amount: 8200, unit: 'mg' },
      { name: 'grapefruit', amount: 5000, unit: 'mg' },
      { name: 'lime', amount: 4500, unit: 'mg' },
    ]
  },
  {
    compound: 'Menthol',
    class: 'terpene',
    subclass: 'monoterpene',
    effects: ['cooling', 'digestive', 'respiratory', 'pain-relief'],
    organs: ['digestive', 'respiratory', 'pain'],
    foods: [
      { name: 'peppermint', amount: 4000, unit: 'mg' },
      { name: 'spearmint', amount: 500, unit: 'mg' },
    ]
  },
  {
    compound: 'Gingerol',
    class: 'terpene',
    subclass: 'phenolic_terpene',
    effects: ['anti-nausea', 'anti-inflammatory', 'digestive', 'circulation'],
    organs: ['digestive', 'joints', 'blood'],
    foods: [
      { name: 'ginger', amount: 250, unit: 'mg' },
    ]
  },
];

function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║     FooDB Curated Bioactive Compounds Generator           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const outPath = path.join(OUT_DIR, 'foodb_bioactives.sql');
  const out = fs.createWriteStream(outPath);

  out.write('-- FooDB Curated Bioactive Compounds\n');
  out.write('-- Generated: ' + new Date().toISOString() + '\n');
  out.write('-- Source: FooDB (https://foodb.ca) + scientific literature\n');
  out.write('-- Contains major bioactive compound classes for health scoring\n\n');

  let totalRecords = 0;

  for (const compound of BIOACTIVE_COMPOUNDS) {
    out.write(`-- ${compound.compound} (${compound.class}/${compound.subclass || 'general'})\n`);

    for (const food of compound.foods) {
      const ingredientName = food.name.toLowerCase();
      const effectsJson = JSON.stringify(compound.effects);
      const organsJson = JSON.stringify(compound.organs);

      out.write(`INSERT OR IGNORE INTO ingredient_bioactives (ingredient_id, compound_name, compound_class, compound_subclass, amount_per_100g, unit, health_effects, target_organs, source, source_id) SELECT i.id, ${sqlEscape(compound.compound)}, ${sqlEscape(compound.class)}, ${sqlEscape(compound.subclass)}, ${food.amount}, ${sqlEscape(food.unit)}, ${sqlEscape(effectsJson)}, ${sqlEscape(organsJson)}, 'foodb_curated', ${sqlEscape('FDB_' + compound.compound.replace(/\s+/g, '_').toUpperCase())} FROM ingredients i WHERE i.canonical_name = ${sqlEscape(ingredientName)};\n`);

      totalRecords++;
    }
    out.write('\n');
  }

  out.end();

  console.log(`Generated ${totalRecords} bioactive compound records`);
  console.log(`Covering ${BIOACTIVE_COMPOUNDS.length} unique compounds`);
  console.log(`Output: ${outPath}`);

  // Summary by class
  console.log('\nCompound classes covered:');
  const classCounts = {};
  for (const c of BIOACTIVE_COMPOUNDS) {
    classCounts[c.class] = (classCounts[c.class] || 0) + 1;
  }
  for (const [cls, count] of Object.entries(classCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${cls}: ${count} compounds`);
  }

  console.log('\n✅ Done! Run split_sql.js to create batches, then import.');
}

main();
