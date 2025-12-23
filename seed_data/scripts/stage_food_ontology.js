#!/usr/bin/env node
/**
 * Food Ontology Staging Script
 *
 * Curated food classification data based on:
 * - FoodOn ontology (https://foodon.org)
 * - LanguaL thesaurus (https://langual.org)
 * - USDA food groups
 *
 * Creates:
 * - Food categories (hierarchical classification)
 * - Cooking methods with nutrient effects
 * - Processing levels
 * - Food tags for dietary/origin classification
 *
 * OUTPUT: seed_data/out/food_ontology.sql
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

// ============================================
// FOOD CATEGORIES (Hierarchical)
// Based on FoodOn top-level categories
// ============================================
const FOOD_CATEGORIES = [
  // Top-level categories
  { code: 'vegetables', name: 'Vegetables', parent: null, foodon: 'FOODON:00001015' },
  { code: 'fruits', name: 'Fruits', parent: null, foodon: 'FOODON:00001138' },
  { code: 'grains', name: 'Grains & Cereals', parent: null, foodon: 'FOODON:00001024' },
  { code: 'proteins', name: 'Protein Foods', parent: null, foodon: 'FOODON:00001057' },
  { code: 'dairy', name: 'Dairy & Eggs', parent: null, foodon: 'FOODON:00001256' },
  { code: 'fats_oils', name: 'Fats & Oils', parent: null, foodon: 'FOODON:00001066' },
  { code: 'beverages', name: 'Beverages', parent: null, foodon: 'FOODON:00001164' },
  { code: 'sweets', name: 'Sweets & Sweeteners', parent: null, foodon: 'FOODON:03411196' },
  { code: 'herbs_spices', name: 'Herbs & Spices', parent: null, foodon: 'FOODON:00001242' },
  { code: 'legumes', name: 'Legumes & Pulses', parent: null, foodon: 'FOODON:00001264' },
  { code: 'nuts_seeds', name: 'Nuts & Seeds', parent: null, foodon: 'FOODON:00001137' },
  { code: 'fungi', name: 'Mushrooms & Fungi', parent: null, foodon: 'FOODON:03411222' },
  { code: 'condiments', name: 'Condiments & Sauces', parent: null, foodon: 'FOODON:00002275' },

  // Vegetable subcategories
  { code: 'leafy_greens', name: 'Leafy Greens', parent: 'vegetables', foodon: 'FOODON:03301710' },
  { code: 'cruciferous', name: 'Cruciferous Vegetables', parent: 'vegetables', foodon: 'FOODON:03301142' },
  { code: 'root_vegetables', name: 'Root Vegetables', parent: 'vegetables', foodon: 'FOODON:03301146' },
  { code: 'alliums', name: 'Alliums (Onion Family)', parent: 'vegetables', foodon: 'FOODON:03301104' },
  { code: 'nightshades', name: 'Nightshades', parent: 'vegetables', foodon: 'FOODON:03301147' },
  { code: 'squashes', name: 'Squashes & Gourds', parent: 'vegetables', foodon: 'FOODON:03301143' },
  { code: 'sea_vegetables', name: 'Sea Vegetables', parent: 'vegetables', foodon: 'FOODON:03411282' },

  // Fruit subcategories
  { code: 'citrus', name: 'Citrus Fruits', parent: 'fruits', foodon: 'FOODON:03301250' },
  { code: 'berries', name: 'Berries', parent: 'fruits', foodon: 'FOODON:03301279' },
  { code: 'stone_fruits', name: 'Stone Fruits', parent: 'fruits', foodon: 'FOODON:03301277' },
  { code: 'tropical_fruits', name: 'Tropical Fruits', parent: 'fruits', foodon: 'FOODON:03301278' },
  { code: 'pome_fruits', name: 'Pome Fruits', parent: 'fruits', foodon: 'FOODON:03301276' },
  { code: 'melons', name: 'Melons', parent: 'fruits', foodon: 'FOODON:03301275' },
  { code: 'dried_fruits', name: 'Dried Fruits', parent: 'fruits', foodon: 'FOODON:03301513' },

  // Grain subcategories
  { code: 'whole_grains', name: 'Whole Grains', parent: 'grains', foodon: 'FOODON:03310358' },
  { code: 'refined_grains', name: 'Refined Grains', parent: 'grains', foodon: 'FOODON:03310360' },
  { code: 'bread', name: 'Bread & Bakery', parent: 'grains', foodon: 'FOODON:00001183' },
  { code: 'pasta', name: 'Pasta & Noodles', parent: 'grains', foodon: 'FOODON:00001185' },
  { code: 'rice', name: 'Rice', parent: 'grains', foodon: 'FOODON:03301367' },
  { code: 'cereals', name: 'Breakfast Cereals', parent: 'grains', foodon: 'FOODON:03311000' },

  // Protein subcategories
  { code: 'red_meat', name: 'Red Meat', parent: 'proteins', foodon: 'FOODON:00001058' },
  { code: 'poultry', name: 'Poultry', parent: 'proteins', foodon: 'FOODON:00001101' },
  { code: 'fish', name: 'Fish', parent: 'proteins', foodon: 'FOODON:03411222' },
  { code: 'shellfish', name: 'Shellfish', parent: 'proteins', foodon: 'FOODON:03411136' },
  { code: 'processed_meat', name: 'Processed Meat', parent: 'proteins', foodon: 'FOODON:00002737' },
  { code: 'plant_protein', name: 'Plant Proteins', parent: 'proteins', foodon: 'FOODON:03310671' },

  // Dairy subcategories
  { code: 'milk', name: 'Milk', parent: 'dairy', foodon: 'FOODON:03301439' },
  { code: 'cheese', name: 'Cheese', parent: 'dairy', foodon: 'FOODON:00001013' },
  { code: 'yogurt', name: 'Yogurt', parent: 'dairy', foodon: 'FOODON:03301571' },
  { code: 'eggs', name: 'Eggs', parent: 'dairy', foodon: 'FOODON:00001274' },
  { code: 'dairy_alternatives', name: 'Dairy Alternatives', parent: 'dairy', foodon: 'FOODON:03310440' },

  // Beverage subcategories
  { code: 'coffee_tea', name: 'Coffee & Tea', parent: 'beverages', foodon: 'FOODON:03301580' },
  { code: 'juice', name: 'Fruit & Vegetable Juice', parent: 'beverages', foodon: 'FOODON:03301583' },
  { code: 'alcohol', name: 'Alcoholic Beverages', parent: 'beverages', foodon: 'FOODON:03301200' },
  { code: 'soft_drinks', name: 'Soft Drinks', parent: 'beverages', foodon: 'FOODON:03301584' },
  { code: 'water', name: 'Water', parent: 'beverages', foodon: 'FOODON:03301585' },
];

// ============================================
// COOKING METHODS with nutrient effects
// Based on LanguaL cooking process facet
// ============================================
const COOKING_METHODS = [
  {
    code: 'raw',
    name: 'Raw/Uncooked',
    vitC: 1.0, vitB: 1.0, mineral: 1.0, protein: 0.85,
    antioxidant: 'preserved', gi: 'unchanged',
    notes: 'Maximum nutrient retention; some nutrients less bioavailable',
    langual: 'H0100'
  },
  {
    code: 'steaming',
    name: 'Steaming',
    vitC: 0.85, vitB: 0.90, mineral: 0.95, protein: 1.0,
    antioxidant: 'preserved', gi: 'unchanged',
    notes: 'Excellent retention; minimal nutrient leaching',
    langual: 'H0138'
  },
  {
    code: 'boiling',
    name: 'Boiling',
    vitC: 0.50, vitB: 0.60, mineral: 0.70, protein: 1.0,
    antioxidant: 'reduced', gi: 'increased',
    notes: 'Significant water-soluble vitamin loss; starch gelatinization increases GI',
    langual: 'H0134'
  },
  {
    code: 'blanching',
    name: 'Blanching',
    vitC: 0.75, vitB: 0.80, mineral: 0.90, protein: 1.0,
    antioxidant: 'preserved', gi: 'unchanged',
    notes: 'Brief cooking preserves most nutrients; stops enzyme activity',
    langual: 'H0136'
  },
  {
    code: 'sauteing',
    name: 'Sautéing/Stir-frying',
    vitC: 0.70, vitB: 0.80, mineral: 0.95, protein: 1.0,
    antioxidant: 'enhanced', gi: 'unchanged',
    notes: 'Quick cooking preserves nutrients; fat aids carotenoid absorption',
    langual: 'H0152'
  },
  {
    code: 'roasting',
    name: 'Roasting/Baking',
    vitC: 0.60, vitB: 0.75, mineral: 0.90, protein: 1.05,
    antioxidant: 'enhanced', gi: 'increased',
    notes: 'Maillard reaction creates antioxidants; increases protein digestibility',
    langual: 'H0158'
  },
  {
    code: 'grilling',
    name: 'Grilling/Broiling',
    vitC: 0.55, vitB: 0.70, mineral: 0.85, protein: 1.05,
    antioxidant: 'variable', gi: 'unchanged',
    notes: 'High heat can create HCAs in meat; caramelization enhances flavor',
    langual: 'H0156'
  },
  {
    code: 'frying',
    name: 'Deep Frying',
    vitC: 0.40, vitB: 0.60, mineral: 0.80, protein: 1.0,
    antioxidant: 'reduced', gi: 'increased',
    notes: 'High heat degrades vitamins; oil absorption adds calories',
    langual: 'H0154'
  },
  {
    code: 'microwaving',
    name: 'Microwaving',
    vitC: 0.80, vitB: 0.85, mineral: 0.95, protein: 1.0,
    antioxidant: 'preserved', gi: 'unchanged',
    notes: 'Short cooking time preserves nutrients well',
    langual: 'H0164'
  },
  {
    code: 'pressure_cooking',
    name: 'Pressure Cooking',
    vitC: 0.70, vitB: 0.80, mineral: 0.90, protein: 1.05,
    antioxidant: 'preserved', gi: 'unchanged',
    notes: 'Short time compensates for high temp; improves protein digestibility',
    langual: 'H0166'
  },
  {
    code: 'slow_cooking',
    name: 'Slow Cooking/Braising',
    vitC: 0.45, vitB: 0.55, mineral: 0.85, protein: 1.10,
    antioxidant: 'reduced', gi: 'increased',
    notes: 'Long cooking time degrades vitamins; excellent protein breakdown',
    langual: 'H0162'
  },
  {
    code: 'fermenting',
    name: 'Fermenting',
    vitC: 0.90, vitB: 1.20, mineral: 1.0, protein: 1.15,
    antioxidant: 'enhanced', gi: 'decreased',
    notes: 'B vitamins increase; probiotics produced; enhanced mineral bioavailability',
    langual: 'H0220'
  },
  {
    code: 'pickling',
    name: 'Pickling',
    vitC: 0.70, vitB: 0.80, mineral: 1.0, protein: 1.0,
    antioxidant: 'preserved', gi: 'unchanged',
    notes: 'Acidic environment preserves some nutrients; adds sodium',
    langual: 'H0222'
  },
  {
    code: 'drying',
    name: 'Drying/Dehydrating',
    vitC: 0.50, vitB: 0.70, mineral: 1.0, protein: 1.0,
    antioxidant: 'reduced', gi: 'increased',
    notes: 'Concentrates nutrients per weight; vitamin C sensitive to drying',
    langual: 'H0190'
  },
  {
    code: 'smoking',
    name: 'Smoking',
    vitC: 0.40, vitB: 0.60, mineral: 0.90, protein: 1.0,
    antioxidant: 'variable', gi: 'unchanged',
    notes: 'Adds antioxidants from smoke; can form carcinogenic compounds',
    langual: 'H0210'
  },
  {
    code: 'sous_vide',
    name: 'Sous Vide',
    vitC: 0.85, vitB: 0.90, mineral: 1.0, protein: 1.10,
    antioxidant: 'preserved', gi: 'unchanged',
    notes: 'Precise temperature control; excellent nutrient retention',
    langual: 'H0170'
  },
];

// ============================================
// PROCESSING LEVELS
// ============================================
const PROCESSING_LEVELS = [
  {
    code: 'unprocessed',
    name: 'Unprocessed/Minimally Processed',
    nova: 1,
    impact: 'positive',
    desc: 'Fresh, dried, or frozen whole foods with no added ingredients',
    examples: ['fresh vegetables', 'fruits', 'eggs', 'plain nuts', 'fresh meat']
  },
  {
    code: 'culinary_ingredients',
    name: 'Processed Culinary Ingredients',
    nova: 2,
    impact: 'neutral',
    desc: 'Substances extracted from group 1 foods or nature, used in cooking',
    examples: ['olive oil', 'butter', 'sugar', 'salt', 'flour']
  },
  {
    code: 'processed',
    name: 'Processed Foods',
    nova: 3,
    impact: 'caution',
    desc: 'Group 1 foods with added salt, oil, sugar, or other group 2 ingredients',
    examples: ['canned vegetables', 'cheese', 'bread', 'cured meats', 'canned fish']
  },
  {
    code: 'ultra_processed',
    name: 'Ultra-Processed Foods',
    nova: 4,
    impact: 'negative',
    desc: 'Industrial formulations with additives and little whole food content',
    examples: ['soft drinks', 'packaged snacks', 'instant noodles', 'chicken nuggets']
  },
];

// ============================================
// FOOD TAGS
// ============================================
const FOOD_TAGS = [
  // Dietary tags
  { code: 'vegan', name: 'Vegan', category: 'dietary', desc: 'Contains no animal products' },
  { code: 'vegetarian', name: 'Vegetarian', category: 'dietary', desc: 'No meat or fish' },
  { code: 'pescatarian', name: 'Pescatarian-friendly', category: 'dietary', desc: 'Fish but no meat' },
  { code: 'keto', name: 'Keto-friendly', category: 'dietary', desc: 'Very low carb' },
  { code: 'paleo', name: 'Paleo-friendly', category: 'dietary', desc: 'No grains, legumes, or dairy' },
  { code: 'whole30', name: 'Whole30-compliant', category: 'dietary', desc: 'No sugar, grains, dairy, legumes' },
  { code: 'low_fodmap', name: 'Low FODMAP', category: 'dietary', desc: 'IBS-friendly' },
  { code: 'gluten_free', name: 'Gluten-free', category: 'dietary', desc: 'No gluten-containing grains' },
  { code: 'dairy_free', name: 'Dairy-free', category: 'dietary', desc: 'No milk products' },
  { code: 'nut_free', name: 'Nut-free', category: 'dietary', desc: 'No tree nuts' },
  { code: 'soy_free', name: 'Soy-free', category: 'dietary', desc: 'No soy products' },
  { code: 'halal', name: 'Halal', category: 'dietary', desc: 'Permissible under Islamic law' },
  { code: 'kosher', name: 'Kosher', category: 'dietary', desc: 'Prepared according to Jewish law' },

  // Origin tags
  { code: 'organic', name: 'Organic', category: 'origin', desc: 'Certified organic production' },
  { code: 'wild_caught', name: 'Wild-caught', category: 'origin', desc: 'Caught in natural habitat' },
  { code: 'farm_raised', name: 'Farm-raised', category: 'origin', desc: 'Raised in controlled environment' },
  { code: 'grass_fed', name: 'Grass-fed', category: 'origin', desc: 'Animals fed primarily grass' },
  { code: 'free_range', name: 'Free-range', category: 'origin', desc: 'Animals with outdoor access' },
  { code: 'local', name: 'Local/Regional', category: 'origin', desc: 'Locally sourced' },
  { code: 'seasonal', name: 'Seasonal', category: 'origin', desc: 'Harvested in season' },

  // Preparation tags
  { code: 'raw', name: 'Raw', category: 'preparation', desc: 'Uncooked' },
  { code: 'cooked', name: 'Cooked', category: 'preparation', desc: 'Heat-treated' },
  { code: 'fermented', name: 'Fermented', category: 'preparation', desc: 'Undergone fermentation' },
  { code: 'pickled', name: 'Pickled', category: 'preparation', desc: 'Preserved in brine or vinegar' },
  { code: 'smoked', name: 'Smoked', category: 'preparation', desc: 'Preserved by smoking' },
  { code: 'dried', name: 'Dried', category: 'preparation', desc: 'Dehydrated' },
  { code: 'canned', name: 'Canned', category: 'preparation', desc: 'Heat-sealed in container' },
  { code: 'frozen', name: 'Frozen', category: 'preparation', desc: 'Preserved by freezing' },

  // Texture tags
  { code: 'crunchy', name: 'Crunchy', category: 'texture', desc: 'Crisp texture' },
  { code: 'creamy', name: 'Creamy', category: 'texture', desc: 'Smooth, rich texture' },
  { code: 'chewy', name: 'Chewy', category: 'texture', desc: 'Requires chewing' },
  { code: 'tender', name: 'Tender', category: 'texture', desc: 'Soft, easy to bite' },
  { code: 'fibrous', name: 'Fibrous', category: 'texture', desc: 'High in fiber, stringy' },

  // Health-related tags
  { code: 'high_protein', name: 'High Protein', category: 'nutrition', desc: '>20g protein per serving' },
  { code: 'high_fiber', name: 'High Fiber', category: 'nutrition', desc: '>5g fiber per serving' },
  { code: 'low_sodium', name: 'Low Sodium', category: 'nutrition', desc: '<140mg sodium per serving' },
  { code: 'heart_healthy', name: 'Heart Healthy', category: 'nutrition', desc: 'Supports cardiovascular health' },
  { code: 'anti_inflammatory', name: 'Anti-inflammatory', category: 'nutrition', desc: 'Contains anti-inflammatory compounds' },
  { code: 'probiotic', name: 'Probiotic', category: 'nutrition', desc: 'Contains live beneficial bacteria' },
  { code: 'prebiotic', name: 'Prebiotic', category: 'nutrition', desc: 'Feeds beneficial gut bacteria' },
];

// ============================================
// INGREDIENT CATEGORY MAPPINGS
// Map common ingredients to their categories
// ============================================
const INGREDIENT_CATEGORIES = [
  // Leafy greens
  { ingredient: 'spinach', categories: ['vegetables', 'leafy_greens'] },
  { ingredient: 'kale', categories: ['vegetables', 'leafy_greens'] },
  { ingredient: 'lettuce', categories: ['vegetables', 'leafy_greens'] },
  { ingredient: 'arugula', categories: ['vegetables', 'leafy_greens'] },
  { ingredient: 'swiss chard', categories: ['vegetables', 'leafy_greens'] },
  { ingredient: 'collard greens', categories: ['vegetables', 'leafy_greens'] },
  { ingredient: 'bok choy', categories: ['vegetables', 'leafy_greens', 'cruciferous'] },

  // Cruciferous
  { ingredient: 'broccoli', categories: ['vegetables', 'cruciferous'] },
  { ingredient: 'cauliflower', categories: ['vegetables', 'cruciferous'] },
  { ingredient: 'cabbage', categories: ['vegetables', 'cruciferous'] },
  { ingredient: 'brussels sprouts', categories: ['vegetables', 'cruciferous'] },
  { ingredient: 'broccoli sprouts', categories: ['vegetables', 'cruciferous'] },

  // Root vegetables
  { ingredient: 'carrot', categories: ['vegetables', 'root_vegetables'] },
  { ingredient: 'potato', categories: ['vegetables', 'root_vegetables'] },
  { ingredient: 'sweet potato', categories: ['vegetables', 'root_vegetables'] },
  { ingredient: 'beet', categories: ['vegetables', 'root_vegetables'] },
  { ingredient: 'turnip', categories: ['vegetables', 'root_vegetables'] },
  { ingredient: 'parsnip', categories: ['vegetables', 'root_vegetables'] },
  { ingredient: 'radish', categories: ['vegetables', 'root_vegetables'] },
  { ingredient: 'ginger', categories: ['vegetables', 'root_vegetables', 'herbs_spices'] },
  { ingredient: 'turmeric', categories: ['vegetables', 'root_vegetables', 'herbs_spices'] },

  // Alliums
  { ingredient: 'onion', categories: ['vegetables', 'alliums'] },
  { ingredient: 'garlic', categories: ['vegetables', 'alliums'] },
  { ingredient: 'leek', categories: ['vegetables', 'alliums'] },
  { ingredient: 'shallot', categories: ['vegetables', 'alliums'] },
  { ingredient: 'chives', categories: ['vegetables', 'alliums', 'herbs_spices'] },
  { ingredient: 'scallion', categories: ['vegetables', 'alliums'] },

  // Nightshades
  { ingredient: 'tomato', categories: ['vegetables', 'nightshades'] },
  { ingredient: 'bell pepper', categories: ['vegetables', 'nightshades'] },
  { ingredient: 'eggplant', categories: ['vegetables', 'nightshades'] },
  { ingredient: 'jalapeno', categories: ['vegetables', 'nightshades'] },
  { ingredient: 'cayenne pepper', categories: ['vegetables', 'nightshades', 'herbs_spices'] },

  // Squashes
  { ingredient: 'zucchini', categories: ['vegetables', 'squashes'] },
  { ingredient: 'butternut squash', categories: ['vegetables', 'squashes'] },
  { ingredient: 'acorn squash', categories: ['vegetables', 'squashes'] },
  { ingredient: 'pumpkin', categories: ['vegetables', 'squashes'] },
  { ingredient: 'cucumber', categories: ['vegetables', 'squashes'] },

  // Citrus fruits
  { ingredient: 'orange', categories: ['fruits', 'citrus'] },
  { ingredient: 'lemon', categories: ['fruits', 'citrus'] },
  { ingredient: 'lime', categories: ['fruits', 'citrus'] },
  { ingredient: 'grapefruit', categories: ['fruits', 'citrus'] },
  { ingredient: 'tangerine', categories: ['fruits', 'citrus'] },

  // Berries
  { ingredient: 'blueberry', categories: ['fruits', 'berries'] },
  { ingredient: 'strawberry', categories: ['fruits', 'berries'] },
  { ingredient: 'raspberry', categories: ['fruits', 'berries'] },
  { ingredient: 'blackberry', categories: ['fruits', 'berries'] },
  { ingredient: 'cranberry', categories: ['fruits', 'berries'] },

  // Stone fruits
  { ingredient: 'peach', categories: ['fruits', 'stone_fruits'] },
  { ingredient: 'plum', categories: ['fruits', 'stone_fruits'] },
  { ingredient: 'cherry', categories: ['fruits', 'stone_fruits'] },
  { ingredient: 'apricot', categories: ['fruits', 'stone_fruits'] },
  { ingredient: 'nectarine', categories: ['fruits', 'stone_fruits'] },
  { ingredient: 'mango', categories: ['fruits', 'stone_fruits', 'tropical_fruits'] },

  // Tropical fruits
  { ingredient: 'pineapple', categories: ['fruits', 'tropical_fruits'] },
  { ingredient: 'papaya', categories: ['fruits', 'tropical_fruits'] },
  { ingredient: 'banana', categories: ['fruits', 'tropical_fruits'] },
  { ingredient: 'coconut', categories: ['fruits', 'tropical_fruits'] },
  { ingredient: 'guava', categories: ['fruits', 'tropical_fruits'] },
  { ingredient: 'passion fruit', categories: ['fruits', 'tropical_fruits'] },

  // Pome fruits
  { ingredient: 'apple', categories: ['fruits', 'pome_fruits'] },
  { ingredient: 'pear', categories: ['fruits', 'pome_fruits'] },

  // Melons
  { ingredient: 'watermelon', categories: ['fruits', 'melons'] },
  { ingredient: 'cantaloupe', categories: ['fruits', 'melons'] },
  { ingredient: 'honeydew', categories: ['fruits', 'melons'] },

  // Whole grains
  { ingredient: 'brown rice', categories: ['grains', 'whole_grains', 'rice'] },
  { ingredient: 'quinoa', categories: ['grains', 'whole_grains'] },
  { ingredient: 'oats', categories: ['grains', 'whole_grains'] },
  { ingredient: 'barley', categories: ['grains', 'whole_grains'] },
  { ingredient: 'bulgur', categories: ['grains', 'whole_grains'] },
  { ingredient: 'farro', categories: ['grains', 'whole_grains'] },
  { ingredient: 'buckwheat', categories: ['grains', 'whole_grains'] },

  // Rice varieties
  { ingredient: 'white rice', categories: ['grains', 'refined_grains', 'rice'] },
  { ingredient: 'jasmine rice', categories: ['grains', 'rice'] },
  { ingredient: 'basmati rice', categories: ['grains', 'rice'] },
  { ingredient: 'wild rice', categories: ['grains', 'whole_grains', 'rice'] },

  // Pasta
  { ingredient: 'spaghetti', categories: ['grains', 'pasta'] },
  { ingredient: 'penne', categories: ['grains', 'pasta'] },
  { ingredient: 'whole wheat pasta', categories: ['grains', 'whole_grains', 'pasta'] },
  { ingredient: 'rice noodles', categories: ['grains', 'pasta'] },

  // Legumes
  { ingredient: 'lentils', categories: ['legumes'] },
  { ingredient: 'chickpeas', categories: ['legumes'] },
  { ingredient: 'black beans', categories: ['legumes'] },
  { ingredient: 'kidney beans', categories: ['legumes'] },
  { ingredient: 'soybeans', categories: ['legumes', 'plant_protein'] },
  { ingredient: 'edamame', categories: ['legumes', 'plant_protein'] },
  { ingredient: 'tofu', categories: ['legumes', 'plant_protein'] },
  { ingredient: 'tempeh', categories: ['legumes', 'plant_protein'] },

  // Nuts and seeds
  { ingredient: 'almonds', categories: ['nuts_seeds'] },
  { ingredient: 'walnuts', categories: ['nuts_seeds'] },
  { ingredient: 'cashews', categories: ['nuts_seeds'] },
  { ingredient: 'peanuts', categories: ['nuts_seeds', 'legumes'] },
  { ingredient: 'chia seeds', categories: ['nuts_seeds'] },
  { ingredient: 'flaxseed', categories: ['nuts_seeds'] },
  { ingredient: 'sunflower seeds', categories: ['nuts_seeds'] },
  { ingredient: 'pumpkin seeds', categories: ['nuts_seeds'] },

  // Proteins
  { ingredient: 'chicken', categories: ['proteins', 'poultry'] },
  { ingredient: 'turkey', categories: ['proteins', 'poultry'] },
  { ingredient: 'beef', categories: ['proteins', 'red_meat'] },
  { ingredient: 'pork', categories: ['proteins', 'red_meat'] },
  { ingredient: 'lamb', categories: ['proteins', 'red_meat'] },
  { ingredient: 'salmon', categories: ['proteins', 'fish'] },
  { ingredient: 'tuna', categories: ['proteins', 'fish'] },
  { ingredient: 'shrimp', categories: ['proteins', 'shellfish'] },
  { ingredient: 'crab', categories: ['proteins', 'shellfish'] },
  { ingredient: 'lobster', categories: ['proteins', 'shellfish'] },

  // Dairy
  { ingredient: 'milk', categories: ['dairy', 'milk'] },
  { ingredient: 'yogurt', categories: ['dairy', 'yogurt'] },
  { ingredient: 'greek yogurt', categories: ['dairy', 'yogurt'] },
  { ingredient: 'cheese', categories: ['dairy', 'cheese'] },
  { ingredient: 'egg', categories: ['dairy', 'eggs'] },
  { ingredient: 'butter', categories: ['dairy', 'fats_oils'] },

  // Dairy alternatives
  { ingredient: 'almond milk', categories: ['dairy_alternatives', 'beverages'] },
  { ingredient: 'oat milk', categories: ['dairy_alternatives', 'beverages'] },
  { ingredient: 'soy milk', categories: ['dairy_alternatives', 'beverages'] },
  { ingredient: 'coconut milk', categories: ['dairy_alternatives', 'beverages'] },

  // Oils
  { ingredient: 'olive oil', categories: ['fats_oils'] },
  { ingredient: 'coconut oil', categories: ['fats_oils'] },
  { ingredient: 'avocado oil', categories: ['fats_oils'] },
  { ingredient: 'canola oil', categories: ['fats_oils'] },

  // Beverages
  { ingredient: 'coffee', categories: ['beverages', 'coffee_tea'] },
  { ingredient: 'green tea', categories: ['beverages', 'coffee_tea'] },
  { ingredient: 'black tea', categories: ['beverages', 'coffee_tea'] },
  { ingredient: 'matcha', categories: ['beverages', 'coffee_tea'] },
  { ingredient: 'red wine', categories: ['beverages', 'alcohol'] },
  { ingredient: 'beer', categories: ['beverages', 'alcohol'] },

  // Herbs and spices
  { ingredient: 'basil', categories: ['herbs_spices'] },
  { ingredient: 'oregano', categories: ['herbs_spices'] },
  { ingredient: 'thyme', categories: ['herbs_spices'] },
  { ingredient: 'rosemary', categories: ['herbs_spices'] },
  { ingredient: 'parsley', categories: ['herbs_spices'] },
  { ingredient: 'cilantro', categories: ['herbs_spices'] },
  { ingredient: 'cinnamon', categories: ['herbs_spices'] },
  { ingredient: 'cumin', categories: ['herbs_spices'] },
  { ingredient: 'black pepper', categories: ['herbs_spices'] },

  // Sweeteners
  { ingredient: 'honey', categories: ['sweets'] },
  { ingredient: 'maple syrup', categories: ['sweets'] },
  { ingredient: 'sugar', categories: ['sweets'] },
  { ingredient: 'dark chocolate', categories: ['sweets'] },
  { ingredient: 'cocoa powder', categories: ['sweets'] },

  // Fermented foods
  { ingredient: 'kimchi', categories: ['vegetables', 'condiments'] },
  { ingredient: 'sauerkraut', categories: ['vegetables', 'condiments'] },
  { ingredient: 'miso', categories: ['condiments', 'legumes'] },
  { ingredient: 'kombucha', categories: ['beverages'] },
];

function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          Food Ontology Database Generator                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('Sources: FoodOn (foodon.org), LanguaL (langual.org)\n');

  const outPath = path.join(OUT_DIR, 'food_ontology.sql');
  const out = fs.createWriteStream(outPath);

  out.write('-- Food Ontology Database\n');
  out.write('-- Generated: ' + new Date().toISOString() + '\n');
  out.write('-- Sources: FoodOn (https://foodon.org), LanguaL (https://langual.org)\n\n');

  let totalRecords = 0;

  // Write food categories
  out.write('-- ============ FOOD CATEGORIES ============\n');
  for (const cat of FOOD_CATEGORIES) {
    out.write(`INSERT OR IGNORE INTO food_categories (category_code, category_name, parent_code, foodon_id) VALUES (${sqlEscape(cat.code)}, ${sqlEscape(cat.name)}, ${sqlEscape(cat.parent)}, ${sqlEscape(cat.foodon)});\n`);
    totalRecords++;
  }

  // Write cooking methods
  out.write('\n-- ============ COOKING METHODS ============\n');
  for (const method of COOKING_METHODS) {
    out.write(`INSERT OR IGNORE INTO cooking_methods (method_code, method_name, vitamin_c_retention, vitamin_b_retention, mineral_retention, protein_digestibility, antioxidant_effect, gi_effect, health_notes, langual_code) VALUES (${sqlEscape(method.code)}, ${sqlEscape(method.name)}, ${method.vitC}, ${method.vitB}, ${method.mineral}, ${method.protein}, ${sqlEscape(method.antioxidant)}, ${sqlEscape(method.gi)}, ${sqlEscape(method.notes)}, ${sqlEscape(method.langual)});\n`);
    totalRecords++;
  }

  // Write processing levels
  out.write('\n-- ============ PROCESSING LEVELS ============\n');
  for (const level of PROCESSING_LEVELS) {
    out.write(`INSERT OR IGNORE INTO processing_levels (level_code, level_name, nova_equivalent, health_impact, description, examples) VALUES (${sqlEscape(level.code)}, ${sqlEscape(level.name)}, ${level.nova}, ${sqlEscape(level.impact)}, ${sqlEscape(level.desc)}, ${sqlEscape(JSON.stringify(level.examples))});\n`);
    totalRecords++;
  }

  // Write food tags
  out.write('\n-- ============ FOOD TAGS ============\n');
  for (const tag of FOOD_TAGS) {
    out.write(`INSERT OR IGNORE INTO food_tags (tag_code, tag_name, tag_category, description) VALUES (${sqlEscape(tag.code)}, ${sqlEscape(tag.name)}, ${sqlEscape(tag.category)}, ${sqlEscape(tag.desc)});\n`);
    totalRecords++;
  }

  // Write ingredient category mappings
  out.write('\n-- ============ INGREDIENT CATEGORY MAPPINGS ============\n');
  for (const mapping of INGREDIENT_CATEGORIES) {
    for (const cat of mapping.categories) {
      out.write(`INSERT OR IGNORE INTO ingredient_categories (ingredient_id, category_code, source) SELECT i.id, ${sqlEscape(cat)}, 'foodon_curated' FROM ingredients i WHERE i.canonical_name = ${sqlEscape(mapping.ingredient)};\n`);
      totalRecords++;
    }
  }

  out.end();

  console.log(`Generated ${totalRecords} ontology records:`);
  console.log(`  - ${FOOD_CATEGORIES.length} food categories`);
  console.log(`  - ${COOKING_METHODS.length} cooking methods`);
  console.log(`  - ${PROCESSING_LEVELS.length} processing levels`);
  console.log(`  - ${FOOD_TAGS.length} food tags`);
  console.log(`  - ${INGREDIENT_CATEGORIES.reduce((sum, m) => sum + m.categories.length, 0)} ingredient-category mappings`);
  console.log(`\nOutput: ${outPath}`);
  console.log('\n✅ Done! Run split_sql.js then import to D1.');
}

main();
