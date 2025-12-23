#!/usr/bin/env node
/**
 * Stage Popular Recipes for D1 Recipe Cache
 *
 * Creates SQL batch files for common dishes with ingredients,
 * nutrition, allergens, and FODMAP flags pre-computed.
 *
 * Usage: node seed_data/scripts/stage_recipes.js
 * Output: seed_data/staging/recipes_batch_*.sql
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Popular dishes with curated recipe data
const RECIPES = [
  // ============================================
  // === ITALIAN CUISINE (20 base recipes) ===
  // ============================================

  // --- PIZZA ---
  {
    dish_name: 'Margherita Pizza',
    ingredients: [
      { name: 'pizza dough', quantity: 250, unit: 'g' },
      { name: 'San Marzano tomatoes', quantity: 100, unit: 'g' },
      { name: 'fresh mozzarella', quantity: 150, unit: 'g' },
      { name: 'fresh basil', quantity: 10, unit: 'g' },
      { name: 'extra virgin olive oil', quantity: 15, unit: 'ml' },
      { name: 'sea salt', quantity: 2, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 22, carbs: 68, fat: 24, fiber: 3, sugar: 5, sodium: 920 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_fructan', 'moderate_lactose'],
    diet_tags: ['vegetarian']
  },
  {
    dish_name: 'Pepperoni Pizza',
    ingredients: [
      { name: 'pizza dough', quantity: 250, unit: 'g' },
      { name: 'tomato sauce', quantity: 100, unit: 'ml' },
      { name: 'mozzarella cheese', quantity: 150, unit: 'g' },
      { name: 'pepperoni', quantity: 60, unit: 'g' },
      { name: 'oregano', quantity: 2, unit: 'g' }
    ],
    nutrition: { calories: 680, protein: 28, carbs: 65, fat: 32, fiber: 3, sugar: 5, sodium: 1450 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_fructan', 'moderate_lactose'],
    diet_tags: []
  },

  // --- PASTA ---
  {
    dish_name: 'Lasagna',
    ingredients: [
      { name: 'lasagna noodles', quantity: 250, unit: 'g' },
      { name: 'ground beef', quantity: 400, unit: 'g' },
      { name: 'ricotta cheese', quantity: 250, unit: 'g' },
      { name: 'mozzarella cheese', quantity: 200, unit: 'g' },
      { name: 'parmesan cheese', quantity: 50, unit: 'g' },
      { name: 'marinara sauce', quantity: 500, unit: 'ml' },
      { name: 'egg', quantity: 1, unit: 'whole' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'Italian seasoning', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 550, protein: 32, carbs: 45, fat: 28, fiber: 3, sugar: 7, sodium: 920 },
    allergens: ['gluten', 'milk', 'egg'],
    fodmap: ['high_lactose', 'high_fructan'],
    diet_tags: []
  },
  {
    dish_name: 'Spaghetti Carbonara',
    ingredients: [
      { name: 'spaghetti', quantity: 200, unit: 'g' },
      { name: 'guanciale', quantity: 100, unit: 'g' },
      { name: 'egg yolks', quantity: 4, unit: 'whole' },
      { name: 'pecorino romano', quantity: 50, unit: 'g' },
      { name: 'parmesan cheese', quantity: 30, unit: 'g' },
      { name: 'black pepper', quantity: 3, unit: 'g' }
    ],
    nutrition: { calories: 720, protein: 28, carbs: 60, fat: 40, fiber: 2, sugar: 2, sodium: 780 },
    allergens: ['gluten', 'egg', 'milk'],
    fodmap: ['high_fructan'],
    diet_tags: []
  },
  {
    dish_name: 'Spaghetti Bolognese',
    ingredients: [
      { name: 'spaghetti', quantity: 200, unit: 'g' },
      { name: 'ground beef', quantity: 250, unit: 'g' },
      { name: 'ground pork', quantity: 100, unit: 'g' },
      { name: 'crushed tomatoes', quantity: 400, unit: 'g' },
      { name: 'onion', quantity: 80, unit: 'g' },
      { name: 'carrot', quantity: 50, unit: 'g' },
      { name: 'celery', quantity: 30, unit: 'g' },
      { name: 'red wine', quantity: 100, unit: 'ml' },
      { name: 'garlic', quantity: 2, unit: 'cloves' },
      { name: 'olive oil', quantity: 20, unit: 'ml' },
      { name: 'parmesan cheese', quantity: 30, unit: 'g' }
    ],
    nutrition: { calories: 680, protein: 35, carbs: 65, fat: 28, fiber: 4, sugar: 8, sodium: 720 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_fructan'],
    diet_tags: []
  },
  {
    dish_name: 'Cacio e Pepe',
    ingredients: [
      { name: 'spaghetti', quantity: 200, unit: 'g' },
      { name: 'pecorino romano', quantity: 100, unit: 'g' },
      { name: 'black pepper', quantity: 5, unit: 'g' },
      { name: 'pasta water', quantity: 100, unit: 'ml' }
    ],
    nutrition: { calories: 550, protein: 22, carbs: 58, fat: 26, fiber: 2, sugar: 1, sodium: 680 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_fructan'],
    diet_tags: ['vegetarian']
  },
  {
    dish_name: 'Fettuccine Alfredo',
    ingredients: [
      { name: 'fettuccine pasta', quantity: 200, unit: 'g' },
      { name: 'butter', quantity: 60, unit: 'g' },
      { name: 'heavy cream', quantity: 240, unit: 'ml' },
      { name: 'parmesan cheese', quantity: 100, unit: 'g' },
      { name: 'garlic', quantity: 2, unit: 'cloves' },
      { name: 'black pepper', quantity: 2, unit: 'g' }
    ],
    nutrition: { calories: 850, protein: 22, carbs: 65, fat: 55, fiber: 2, sugar: 3, sodium: 650 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_lactose', 'high_fructan'],
    diet_tags: ['vegetarian']
  },
  {
    dish_name: 'Pasta alla Norma',
    ingredients: [
      { name: 'rigatoni', quantity: 200, unit: 'g' },
      { name: 'eggplant', quantity: 300, unit: 'g' },
      { name: 'San Marzano tomatoes', quantity: 400, unit: 'g' },
      { name: 'ricotta salata', quantity: 60, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'fresh basil', quantity: 15, unit: 'g' },
      { name: 'olive oil', quantity: 45, unit: 'ml' }
    ],
    nutrition: { calories: 520, protein: 16, carbs: 68, fat: 20, fiber: 8, sugar: 10, sodium: 480 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_fructan', 'moderate_sorbitol'],
    diet_tags: ['vegetarian']
  },
  {
    dish_name: 'Pesto Pasta',
    ingredients: [
      { name: 'linguine', quantity: 200, unit: 'g' },
      { name: 'fresh basil', quantity: 60, unit: 'g' },
      { name: 'pine nuts', quantity: 30, unit: 'g' },
      { name: 'parmesan cheese', quantity: 50, unit: 'g' },
      { name: 'garlic', quantity: 2, unit: 'cloves' },
      { name: 'extra virgin olive oil', quantity: 80, unit: 'ml' },
      { name: 'sea salt', quantity: 2, unit: 'g' }
    ],
    nutrition: { calories: 680, protein: 18, carbs: 58, fat: 42, fiber: 3, sugar: 2, sodium: 420 },
    allergens: ['gluten', 'milk', 'tree nuts'],
    fodmap: ['high_fructan'],
    diet_tags: ['vegetarian']
  },

  // --- RISOTTO ---
  {
    dish_name: 'Risotto alla Milanese',
    ingredients: [
      { name: 'arborio rice', quantity: 200, unit: 'g' },
      { name: 'beef bone marrow', quantity: 30, unit: 'g' },
      { name: 'saffron threads', quantity: 0.2, unit: 'g' },
      { name: 'white wine', quantity: 100, unit: 'ml' },
      { name: 'chicken broth', quantity: 750, unit: 'ml' },
      { name: 'butter', quantity: 50, unit: 'g' },
      { name: 'parmesan cheese', quantity: 60, unit: 'g' },
      { name: 'onion', quantity: 60, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 14, carbs: 62, fat: 22, fiber: 1, sugar: 2, sodium: 680 },
    allergens: ['milk'],
    fodmap: ['high_fructan'],
    diet_tags: ['gluten-free']
  },
  {
    dish_name: 'Risotto ai Funghi',
    ingredients: [
      { name: 'arborio rice', quantity: 200, unit: 'g' },
      { name: 'porcini mushrooms', quantity: 100, unit: 'g' },
      { name: 'cremini mushrooms', quantity: 150, unit: 'g' },
      { name: 'white wine', quantity: 100, unit: 'ml' },
      { name: 'vegetable broth', quantity: 750, unit: 'ml' },
      { name: 'butter', quantity: 40, unit: 'g' },
      { name: 'parmesan cheese', quantity: 50, unit: 'g' },
      { name: 'shallot', quantity: 40, unit: 'g' },
      { name: 'fresh thyme', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 480, protein: 12, carbs: 58, fat: 20, fiber: 3, sugar: 3, sodium: 580 },
    allergens: ['milk'],
    fodmap: ['high_mannitol', 'high_fructan'],
    diet_tags: ['vegetarian', 'gluten-free']
  },

  // --- MAIN COURSES ---
  {
    dish_name: 'Osso Buco',
    ingredients: [
      { name: 'veal shanks', quantity: 400, unit: 'g' },
      { name: 'white wine', quantity: 200, unit: 'ml' },
      { name: 'beef broth', quantity: 300, unit: 'ml' },
      { name: 'crushed tomatoes', quantity: 200, unit: 'g' },
      { name: 'onion', quantity: 80, unit: 'g' },
      { name: 'carrot', quantity: 60, unit: 'g' },
      { name: 'celery', quantity: 40, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'lemon zest', quantity: 5, unit: 'g' },
      { name: 'parsley', quantity: 15, unit: 'g' },
      { name: 'olive oil', quantity: 30, unit: 'ml' }
    ],
    nutrition: { calories: 420, protein: 38, carbs: 12, fat: 22, fiber: 3, sugar: 6, sodium: 620 },
    allergens: [],
    fodmap: ['high_fructan'],
    diet_tags: ['gluten-free', 'dairy-free']
  },
  {
    dish_name: 'Chicken Parmigiana',
    ingredients: [
      { name: 'chicken breast', quantity: 200, unit: 'g' },
      { name: 'breadcrumbs', quantity: 60, unit: 'g' },
      { name: 'parmesan cheese', quantity: 40, unit: 'g' },
      { name: 'mozzarella cheese', quantity: 80, unit: 'g' },
      { name: 'marinara sauce', quantity: 150, unit: 'ml' },
      { name: 'egg', quantity: 1, unit: 'whole' },
      { name: 'flour', quantity: 30, unit: 'g' },
      { name: 'olive oil', quantity: 45, unit: 'ml' },
      { name: 'fresh basil', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 42, carbs: 32, fat: 30, fiber: 2, sugar: 5, sodium: 850 },
    allergens: ['gluten', 'milk', 'egg'],
    fodmap: ['high_fructan'],
    diet_tags: []
  },
  {
    dish_name: 'Veal Parmigiana',
    ingredients: [
      { name: 'veal cutlet', quantity: 200, unit: 'g' },
      { name: 'breadcrumbs', quantity: 60, unit: 'g' },
      { name: 'parmesan cheese', quantity: 40, unit: 'g' },
      { name: 'mozzarella cheese', quantity: 80, unit: 'g' },
      { name: 'marinara sauce', quantity: 150, unit: 'ml' },
      { name: 'egg', quantity: 1, unit: 'whole' },
      { name: 'flour', quantity: 30, unit: 'g' },
      { name: 'olive oil', quantity: 45, unit: 'ml' },
      { name: 'fresh basil', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 560, protein: 38, carbs: 32, fat: 30, fiber: 2, sugar: 5, sodium: 820 },
    allergens: ['gluten', 'milk', 'egg'],
    fodmap: ['high_fructan'],
    diet_tags: []
  },
  {
    dish_name: 'Eggplant Parmigiana',
    ingredients: [
      { name: 'eggplant', quantity: 400, unit: 'g' },
      { name: 'breadcrumbs', quantity: 80, unit: 'g' },
      { name: 'parmesan cheese', quantity: 60, unit: 'g' },
      { name: 'mozzarella cheese', quantity: 150, unit: 'g' },
      { name: 'marinara sauce', quantity: 300, unit: 'ml' },
      { name: 'egg', quantity: 2, unit: 'whole' },
      { name: 'flour', quantity: 40, unit: 'g' },
      { name: 'olive oil', quantity: 60, unit: 'ml' },
      { name: 'fresh basil', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 480, protein: 20, carbs: 38, fat: 28, fiber: 8, sugar: 10, sodium: 780 },
    allergens: ['gluten', 'milk', 'egg'],
    fodmap: ['high_fructan', 'moderate_sorbitol'],
    diet_tags: ['vegetarian']
  },

  // --- SALADS & APPETIZERS ---
  {
    dish_name: 'Caprese Salad',
    ingredients: [
      { name: 'fresh mozzarella', quantity: 200, unit: 'g' },
      { name: 'tomato', quantity: 250, unit: 'g' },
      { name: 'fresh basil', quantity: 20, unit: 'g' },
      { name: 'extra virgin olive oil', quantity: 30, unit: 'ml' },
      { name: 'balsamic glaze', quantity: 15, unit: 'ml' },
      { name: 'sea salt', quantity: 2, unit: 'g' },
      { name: 'black pepper', quantity: 1, unit: 'g' }
    ],
    nutrition: { calories: 380, protein: 18, carbs: 10, fat: 30, fiber: 2, sugar: 6, sodium: 520 },
    allergens: ['milk'],
    fodmap: ['moderate_lactose', 'high_fructose'],
    diet_tags: ['vegetarian', 'gluten-free', 'keto', 'low-carb']
  },
  {
    dish_name: 'Bruschetta',
    ingredients: [
      { name: 'Italian bread', quantity: 150, unit: 'g' },
      { name: 'tomato', quantity: 200, unit: 'g' },
      { name: 'fresh basil', quantity: 15, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'extra virgin olive oil', quantity: 30, unit: 'ml' },
      { name: 'balsamic vinegar', quantity: 10, unit: 'ml' },
      { name: 'sea salt', quantity: 2, unit: 'g' }
    ],
    nutrition: { calories: 280, protein: 6, carbs: 38, fat: 12, fiber: 3, sugar: 5, sodium: 420 },
    allergens: ['gluten'],
    fodmap: ['high_fructan', 'high_fructose'],
    diet_tags: ['vegan', 'dairy-free', 'vegetarian']
  },

  // --- SOUPS ---
  {
    dish_name: 'Minestrone',
    ingredients: [
      { name: 'cannellini beans', quantity: 150, unit: 'g' },
      { name: 'pasta (ditalini)', quantity: 80, unit: 'g' },
      { name: 'zucchini', quantity: 100, unit: 'g' },
      { name: 'carrot', quantity: 80, unit: 'g' },
      { name: 'celery', quantity: 60, unit: 'g' },
      { name: 'potato', quantity: 100, unit: 'g' },
      { name: 'crushed tomatoes', quantity: 200, unit: 'g' },
      { name: 'vegetable broth', quantity: 500, unit: 'ml' },
      { name: 'onion', quantity: 60, unit: 'g' },
      { name: 'garlic', quantity: 2, unit: 'cloves' },
      { name: 'parmesan rind', quantity: 30, unit: 'g' },
      { name: 'olive oil', quantity: 20, unit: 'ml' }
    ],
    nutrition: { calories: 320, protein: 14, carbs: 48, fat: 8, fiber: 10, sugar: 8, sodium: 680 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_gos', 'high_fructan'],
    diet_tags: ['vegetarian']
  },

  // --- DESSERTS ---
  {
    dish_name: 'Tiramisu',
    ingredients: [
      { name: 'mascarpone cheese', quantity: 250, unit: 'g' },
      { name: 'ladyfinger cookies', quantity: 200, unit: 'g' },
      { name: 'espresso coffee', quantity: 200, unit: 'ml' },
      { name: 'egg yolks', quantity: 4, unit: 'whole' },
      { name: 'sugar', quantity: 80, unit: 'g' },
      { name: 'cocoa powder', quantity: 20, unit: 'g' },
      { name: 'Marsala wine', quantity: 30, unit: 'ml' }
    ],
    nutrition: { calories: 420, protein: 8, carbs: 45, fat: 24, fiber: 1, sugar: 32, sodium: 120 },
    allergens: ['gluten', 'milk', 'egg'],
    fodmap: ['high_lactose'],
    diet_tags: ['vegetarian']
  },
  {
    dish_name: 'Gelato',
    ingredients: [
      { name: 'whole milk', quantity: 400, unit: 'ml' },
      { name: 'heavy cream', quantity: 150, unit: 'ml' },
      { name: 'sugar', quantity: 120, unit: 'g' },
      { name: 'egg yolks', quantity: 4, unit: 'whole' },
      { name: 'vanilla bean', quantity: 1, unit: 'whole' }
    ],
    nutrition: { calories: 280, protein: 5, carbs: 32, fat: 15, fiber: 0, sugar: 28, sodium: 60 },
    allergens: ['milk', 'egg'],
    fodmap: ['high_lactose'],
    diet_tags: ['vegetarian', 'gluten-free']
  },

  // ============================================
  // === MEXICAN CUISINE (20 base recipes) ===
  // ============================================

  // --- TACOS ---
  {
    dish_name: 'Tacos al Pastor',
    ingredients: [
      { name: 'pork shoulder', quantity: 300, unit: 'g' },
      { name: 'corn tortillas', quantity: 6, unit: 'pieces' },
      { name: 'pineapple', quantity: 100, unit: 'g' },
      { name: 'achiote paste', quantity: 30, unit: 'g' },
      { name: 'onion', quantity: 60, unit: 'g' },
      { name: 'cilantro', quantity: 15, unit: 'g' },
      { name: 'lime', quantity: 1, unit: 'whole' },
      { name: 'guajillo chilies', quantity: 3, unit: 'pieces' }
    ],
    nutrition: { calories: 520, protein: 32, carbs: 45, fat: 22, fiber: 4, sugar: 12, sodium: 680 },
    allergens: [],
    fodmap: ['high_fructan', 'high_fructose'],
    diet_tags: ['gluten-free', 'dairy-free']
  },
  {
    dish_name: 'Carne Asada Tacos',
    ingredients: [
      { name: 'flank steak', quantity: 300, unit: 'g' },
      { name: 'corn tortillas', quantity: 6, unit: 'pieces' },
      { name: 'lime juice', quantity: 30, unit: 'ml' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'cilantro', quantity: 15, unit: 'g' },
      { name: 'onion', quantity: 60, unit: 'g' },
      { name: 'jalapeño', quantity: 1, unit: 'whole' },
      { name: 'cumin', quantity: 3, unit: 'g' }
    ],
    nutrition: { calories: 480, protein: 35, carbs: 38, fat: 20, fiber: 3, sugar: 3, sodium: 520 },
    allergens: [],
    fodmap: ['high_fructan'],
    diet_tags: ['gluten-free', 'dairy-free']
  },
  {
    dish_name: 'Barbacoa Tacos',
    ingredients: [
      { name: 'beef cheeks', quantity: 350, unit: 'g' },
      { name: 'corn tortillas', quantity: 6, unit: 'pieces' },
      { name: 'chipotle peppers', quantity: 2, unit: 'pieces' },
      { name: 'cumin', quantity: 3, unit: 'g' },
      { name: 'oregano', quantity: 2, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'lime juice', quantity: 30, unit: 'ml' },
      { name: 'onion', quantity: 50, unit: 'g' },
      { name: 'cilantro', quantity: 15, unit: 'g' }
    ],
    nutrition: { calories: 540, protein: 38, carbs: 40, fat: 24, fiber: 4, sugar: 2, sodium: 620 },
    allergens: [],
    fodmap: ['high_fructan'],
    diet_tags: ['gluten-free', 'dairy-free']
  },
  {
    dish_name: 'Birria Tacos',
    ingredients: [
      { name: 'beef chuck', quantity: 400, unit: 'g' },
      { name: 'corn tortillas', quantity: 6, unit: 'pieces' },
      { name: 'guajillo chilies', quantity: 4, unit: 'pieces' },
      { name: 'ancho chilies', quantity: 2, unit: 'pieces' },
      { name: 'onion', quantity: 80, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'cumin', quantity: 3, unit: 'g' },
      { name: 'oregano', quantity: 2, unit: 'g' },
      { name: 'queso fresco', quantity: 60, unit: 'g' },
      { name: 'cilantro', quantity: 15, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 42, carbs: 42, fat: 26, fiber: 4, sugar: 4, sodium: 720 },
    allergens: ['milk'],
    fodmap: ['high_fructan'],
    diet_tags: ['gluten-free']
  },

  // --- MAIN DISHES ---
  {
    dish_name: 'Carnitas',
    ingredients: [
      { name: 'pork shoulder', quantity: 500, unit: 'g' },
      { name: 'lard', quantity: 60, unit: 'g' },
      { name: 'orange juice', quantity: 120, unit: 'ml' },
      { name: 'lime juice', quantity: 30, unit: 'ml' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'cumin', quantity: 3, unit: 'g' },
      { name: 'oregano', quantity: 2, unit: 'g' },
      { name: 'bay leaves', quantity: 2, unit: 'pieces' }
    ],
    nutrition: { calories: 420, protein: 35, carbs: 8, fat: 28, fiber: 1, sugar: 5, sodium: 480 },
    allergens: [],
    fodmap: ['high_fructan', 'high_fructose'],
    diet_tags: ['gluten-free', 'dairy-free', 'keto', 'low-carb']
  },
  {
    dish_name: 'Enchiladas',
    ingredients: [
      { name: 'corn tortillas', quantity: 8, unit: 'pieces' },
      { name: 'shredded chicken', quantity: 300, unit: 'g' },
      { name: 'enchilada sauce', quantity: 400, unit: 'ml' },
      { name: 'queso fresco', quantity: 100, unit: 'g' },
      { name: 'sour cream', quantity: 60, unit: 'g' },
      { name: 'onion', quantity: 50, unit: 'g' },
      { name: 'cilantro', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 35, carbs: 45, fat: 22, fiber: 5, sugar: 6, sodium: 920 },
    allergens: ['milk'],
    fodmap: ['high_fructan', 'moderate_lactose'],
    diet_tags: ['gluten-free']
  },
  {
    dish_name: 'Chiles Rellenos',
    ingredients: [
      { name: 'poblano peppers', quantity: 4, unit: 'pieces' },
      { name: 'queso Oaxaca', quantity: 200, unit: 'g' },
      { name: 'egg', quantity: 3, unit: 'whole' },
      { name: 'flour', quantity: 30, unit: 'g' },
      { name: 'tomato sauce', quantity: 200, unit: 'ml' },
      { name: 'onion', quantity: 60, unit: 'g' },
      { name: 'garlic', quantity: 2, unit: 'cloves' },
      { name: 'vegetable oil', quantity: 60, unit: 'ml' }
    ],
    nutrition: { calories: 480, protein: 22, carbs: 25, fat: 32, fiber: 4, sugar: 8, sodium: 680 },
    allergens: ['milk', 'egg', 'gluten'],
    fodmap: ['high_fructan'],
    diet_tags: ['vegetarian']
  },
  {
    dish_name: 'Tamales',
    ingredients: [
      { name: 'masa harina', quantity: 300, unit: 'g' },
      { name: 'lard', quantity: 150, unit: 'g' },
      { name: 'pork', quantity: 250, unit: 'g' },
      { name: 'dried corn husks', quantity: 12, unit: 'pieces' },
      { name: 'guajillo chilies', quantity: 4, unit: 'pieces' },
      { name: 'chicken broth', quantity: 200, unit: 'ml' },
      { name: 'cumin', quantity: 2, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' }
    ],
    nutrition: { calories: 380, protein: 15, carbs: 32, fat: 22, fiber: 3, sugar: 1, sodium: 520 },
    allergens: [],
    fodmap: ['high_fructan'],
    diet_tags: ['gluten-free', 'dairy-free']
  },
  {
    dish_name: 'Mole Poblano',
    ingredients: [
      { name: 'chicken thighs', quantity: 400, unit: 'g' },
      { name: 'ancho chilies', quantity: 4, unit: 'pieces' },
      { name: 'pasilla chilies', quantity: 3, unit: 'pieces' },
      { name: 'mulato chilies', quantity: 2, unit: 'pieces' },
      { name: 'Mexican chocolate', quantity: 50, unit: 'g' },
      { name: 'almonds', quantity: 30, unit: 'g' },
      { name: 'sesame seeds', quantity: 20, unit: 'g' },
      { name: 'onion', quantity: 80, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'cinnamon', quantity: 2, unit: 'g' },
      { name: 'cumin', quantity: 2, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 35, carbs: 28, fat: 32, fiber: 6, sugar: 12, sodium: 580 },
    allergens: ['tree nuts', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['gluten-free', 'dairy-free']
  },
  {
    dish_name: 'Cochinita Pibil',
    ingredients: [
      { name: 'pork shoulder', quantity: 500, unit: 'g' },
      { name: 'achiote paste', quantity: 60, unit: 'g' },
      { name: 'sour orange juice', quantity: 150, unit: 'ml' },
      { name: 'banana leaves', quantity: 2, unit: 'pieces' },
      { name: 'habanero pepper', quantity: 1, unit: 'whole' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'cumin', quantity: 2, unit: 'g' },
      { name: 'oregano', quantity: 2, unit: 'g' },
      { name: 'pickled red onion', quantity: 80, unit: 'g' }
    ],
    nutrition: { calories: 450, protein: 38, carbs: 12, fat: 28, fiber: 2, sugar: 6, sodium: 520 },
    allergens: [],
    fodmap: ['high_fructan', 'high_fructose'],
    diet_tags: ['gluten-free', 'dairy-free']
  },

  // --- SOUPS ---
  {
    dish_name: 'Pozole',
    ingredients: [
      { name: 'pork shoulder', quantity: 400, unit: 'g' },
      { name: 'hominy', quantity: 400, unit: 'g' },
      { name: 'guajillo chilies', quantity: 4, unit: 'pieces' },
      { name: 'ancho chilies', quantity: 2, unit: 'pieces' },
      { name: 'onion', quantity: 100, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'oregano', quantity: 3, unit: 'g' },
      { name: 'cabbage', quantity: 100, unit: 'g' },
      { name: 'radishes', quantity: 50, unit: 'g' },
      { name: 'lime', quantity: 2, unit: 'wedges' }
    ],
    nutrition: { calories: 420, protein: 32, carbs: 38, fat: 18, fiber: 6, sugar: 4, sodium: 720 },
    allergens: [],
    fodmap: ['high_fructan', 'high_gos'],
    diet_tags: ['gluten-free', 'dairy-free']
  },
  {
    dish_name: 'Menudo',
    ingredients: [
      { name: 'beef tripe', quantity: 500, unit: 'g' },
      { name: 'hominy', quantity: 400, unit: 'g' },
      { name: 'guajillo chilies', quantity: 6, unit: 'pieces' },
      { name: 'onion', quantity: 80, unit: 'g' },
      { name: 'garlic', quantity: 5, unit: 'cloves' },
      { name: 'oregano', quantity: 3, unit: 'g' },
      { name: 'bay leaves', quantity: 2, unit: 'pieces' },
      { name: 'lime', quantity: 2, unit: 'wedges' },
      { name: 'cilantro', quantity: 15, unit: 'g' }
    ],
    nutrition: { calories: 380, protein: 28, carbs: 35, fat: 14, fiber: 5, sugar: 3, sodium: 680 },
    allergens: [],
    fodmap: ['high_fructan', 'high_gos'],
    diet_tags: ['gluten-free', 'dairy-free']
  },

  // --- ANTOJITOS ---
  {
    dish_name: 'Quesadillas',
    ingredients: [
      { name: 'flour tortillas', quantity: 2, unit: 'large' },
      { name: 'queso Oaxaca', quantity: 150, unit: 'g' },
      { name: 'grilled chicken', quantity: 100, unit: 'g' },
      { name: 'onion', quantity: 30, unit: 'g' },
      { name: 'peppers', quantity: 40, unit: 'g' },
      { name: 'sour cream', quantity: 30, unit: 'g' },
      { name: 'salsa', quantity: 40, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 35, carbs: 42, fat: 30, fiber: 3, sugar: 4, sodium: 980 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_fructan'],
    diet_tags: []
  },
  {
    dish_name: 'Gorditas',
    ingredients: [
      { name: 'masa harina', quantity: 200, unit: 'g' },
      { name: 'carnitas', quantity: 150, unit: 'g' },
      { name: 'refried beans', quantity: 80, unit: 'g' },
      { name: 'queso fresco', quantity: 50, unit: 'g' },
      { name: 'lettuce', quantity: 30, unit: 'g' },
      { name: 'salsa verde', quantity: 40, unit: 'ml' },
      { name: 'sour cream', quantity: 30, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 28, carbs: 48, fat: 24, fiber: 6, sugar: 3, sodium: 720 },
    allergens: ['milk'],
    fodmap: ['high_gos', 'high_fructan'],
    diet_tags: ['gluten-free']
  },
  {
    dish_name: 'Sopes',
    ingredients: [
      { name: 'masa harina', quantity: 200, unit: 'g' },
      { name: 'refried beans', quantity: 100, unit: 'g' },
      { name: 'shredded chicken', quantity: 120, unit: 'g' },
      { name: 'queso fresco', quantity: 60, unit: 'g' },
      { name: 'lettuce', quantity: 30, unit: 'g' },
      { name: 'salsa roja', quantity: 50, unit: 'ml' },
      { name: 'sour cream', quantity: 30, unit: 'g' }
    ],
    nutrition: { calories: 480, protein: 28, carbs: 45, fat: 20, fiber: 7, sugar: 3, sodium: 680 },
    allergens: ['milk'],
    fodmap: ['high_gos', 'high_fructan'],
    diet_tags: ['gluten-free']
  },
  {
    dish_name: 'Tostadas',
    ingredients: [
      { name: 'corn tostadas', quantity: 4, unit: 'pieces' },
      { name: 'refried beans', quantity: 120, unit: 'g' },
      { name: 'shredded chicken', quantity: 150, unit: 'g' },
      { name: 'lettuce', quantity: 60, unit: 'g' },
      { name: 'tomato', quantity: 80, unit: 'g' },
      { name: 'queso fresco', quantity: 60, unit: 'g' },
      { name: 'sour cream', quantity: 40, unit: 'g' },
      { name: 'salsa', quantity: 50, unit: 'ml' }
    ],
    nutrition: { calories: 520, protein: 32, carbs: 48, fat: 22, fiber: 8, sugar: 5, sodium: 780 },
    allergens: ['milk'],
    fodmap: ['high_gos', 'high_fructan'],
    diet_tags: ['gluten-free']
  },

  // --- SIDES & APPETIZERS ---
  {
    dish_name: 'Elote',
    ingredients: [
      { name: 'corn on the cob', quantity: 2, unit: 'pieces' },
      { name: 'mayonnaise', quantity: 40, unit: 'g' },
      { name: 'cotija cheese', quantity: 40, unit: 'g' },
      { name: 'chili powder', quantity: 3, unit: 'g' },
      { name: 'lime juice', quantity: 15, unit: 'ml' },
      { name: 'cilantro', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 320, protein: 8, carbs: 32, fat: 20, fiber: 3, sugar: 8, sodium: 420 },
    allergens: ['milk', 'egg'],
    fodmap: ['moderate_sorbitol'],
    diet_tags: ['vegetarian', 'gluten-free']
  },
  {
    dish_name: 'Guacamole',
    ingredients: [
      { name: 'avocado', quantity: 300, unit: 'g' },
      { name: 'lime juice', quantity: 30, unit: 'ml' },
      { name: 'onion', quantity: 40, unit: 'g' },
      { name: 'tomato', quantity: 60, unit: 'g' },
      { name: 'jalapeño', quantity: 1, unit: 'whole' },
      { name: 'cilantro', quantity: 15, unit: 'g' },
      { name: 'garlic', quantity: 1, unit: 'clove' },
      { name: 'sea salt', quantity: 3, unit: 'g' }
    ],
    nutrition: { calories: 280, protein: 4, carbs: 16, fat: 24, fiber: 12, sugar: 3, sodium: 480 },
    allergens: [],
    fodmap: ['moderate_polyol', 'high_fructan'],
    diet_tags: ['vegan', 'vegetarian', 'gluten-free', 'dairy-free', 'keto']
  },
  {
    dish_name: 'Ceviche',
    ingredients: [
      { name: 'white fish', quantity: 300, unit: 'g' },
      { name: 'lime juice', quantity: 150, unit: 'ml' },
      { name: 'tomato', quantity: 100, unit: 'g' },
      { name: 'onion', quantity: 60, unit: 'g' },
      { name: 'jalapeño', quantity: 1, unit: 'whole' },
      { name: 'cilantro', quantity: 20, unit: 'g' },
      { name: 'cucumber', quantity: 80, unit: 'g' },
      { name: 'avocado', quantity: 80, unit: 'g' }
    ],
    nutrition: { calories: 220, protein: 28, carbs: 12, fat: 8, fiber: 4, sugar: 5, sodium: 380 },
    allergens: ['fish'],
    fodmap: ['high_fructan', 'moderate_polyol'],
    diet_tags: ['gluten-free', 'dairy-free', 'low-carb']
  },

  // --- DESSERTS ---
  {
    dish_name: 'Churros',
    ingredients: [
      { name: 'flour', quantity: 150, unit: 'g' },
      { name: 'water', quantity: 200, unit: 'ml' },
      { name: 'butter', quantity: 60, unit: 'g' },
      { name: 'egg', quantity: 1, unit: 'whole' },
      { name: 'sugar', quantity: 60, unit: 'g' },
      { name: 'cinnamon', quantity: 5, unit: 'g' },
      { name: 'vegetable oil', quantity: 200, unit: 'ml' },
      { name: 'chocolate sauce', quantity: 60, unit: 'ml' }
    ],
    nutrition: { calories: 380, protein: 5, carbs: 45, fat: 20, fiber: 1, sugar: 22, sodium: 180 },
    allergens: ['gluten', 'milk', 'egg'],
    fodmap: ['high_fructan'],
    diet_tags: ['vegetarian']
  },

  // ============================================
  // === OTHER CUISINES ===
  // ============================================

  // === PASTA (Non-Italian) ===
  {
    dish_name: 'Spaghetti and Meatballs',
    ingredients: [
      { name: 'spaghetti', quantity: 200, unit: 'g' },
      { name: 'ground beef', quantity: 300, unit: 'g' },
      { name: 'breadcrumbs', quantity: 30, unit: 'g' },
      { name: 'egg', quantity: 1, unit: 'whole' },
      { name: 'parmesan cheese', quantity: 30, unit: 'g' },
      { name: 'marinara sauce', quantity: 250, unit: 'ml' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'olive oil', quantity: 15, unit: 'ml' },
      { name: 'basil', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 650, protein: 35, carbs: 70, fat: 25, fiber: 4, sugar: 8, sodium: 850 },
    allergens: ['gluten', 'egg', 'milk'],
    fodmap: ['high_fructan', 'moderate_lactose'],
    diet_tags: []
  },
  {
    dish_name: 'Penne Arrabbiata',
    ingredients: [
      { name: 'penne pasta', quantity: 200, unit: 'g' },
      { name: 'crushed tomatoes', quantity: 400, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'red chili flakes', quantity: 5, unit: 'g' },
      { name: 'olive oil', quantity: 30, unit: 'ml' },
      { name: 'parsley', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 420, protein: 12, carbs: 72, fat: 10, fiber: 4, sugar: 6, sodium: 320 },
    allergens: ['gluten'],
    fodmap: ['high_fructan'],
    diet_tags: ['vegan', 'dairy-free']
  },

  // === BURGERS ===
  {
    dish_name: 'Classic Cheeseburger',
    ingredients: [
      { name: 'ground beef patty', quantity: 150, unit: 'g' },
      { name: 'hamburger bun', quantity: 1, unit: 'whole' },
      { name: 'cheddar cheese', quantity: 30, unit: 'g' },
      { name: 'lettuce', quantity: 20, unit: 'g' },
      { name: 'tomato', quantity: 30, unit: 'g' },
      { name: 'onion', quantity: 20, unit: 'g' },
      { name: 'pickles', quantity: 15, unit: 'g' },
      { name: 'ketchup', quantity: 15, unit: 'ml' },
      { name: 'mustard', quantity: 10, unit: 'ml' }
    ],
    nutrition: { calories: 550, protein: 32, carbs: 35, fat: 32, fiber: 2, sugar: 8, sodium: 850 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_fructan', 'moderate_polyol'],
    diet_tags: []
  },
  {
    dish_name: 'Bacon Cheeseburger',
    ingredients: [
      { name: 'ground beef patty', quantity: 150, unit: 'g' },
      { name: 'hamburger bun', quantity: 1, unit: 'whole' },
      { name: 'bacon', quantity: 40, unit: 'g' },
      { name: 'cheddar cheese', quantity: 30, unit: 'g' },
      { name: 'lettuce', quantity: 20, unit: 'g' },
      { name: 'tomato', quantity: 30, unit: 'g' },
      { name: 'onion', quantity: 20, unit: 'g' }
    ],
    nutrition: { calories: 680, protein: 38, carbs: 35, fat: 42, fiber: 2, sugar: 6, sodium: 1150 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_fructan'],
    diet_tags: []
  },

  // === ASIAN ===
  {
    dish_name: 'Pad Thai',
    ingredients: [
      { name: 'rice noodles', quantity: 200, unit: 'g' },
      { name: 'shrimp', quantity: 150, unit: 'g' },
      { name: 'egg', quantity: 2, unit: 'whole' },
      { name: 'tofu', quantity: 100, unit: 'g' },
      { name: 'bean sprouts', quantity: 80, unit: 'g' },
      { name: 'peanuts', quantity: 30, unit: 'g' },
      { name: 'green onion', quantity: 20, unit: 'g' },
      { name: 'fish sauce', quantity: 30, unit: 'ml' },
      { name: 'tamarind paste', quantity: 20, unit: 'g' },
      { name: 'palm sugar', quantity: 15, unit: 'g' },
      { name: 'lime', quantity: 1, unit: 'wedge' }
    ],
    nutrition: { calories: 580, protein: 28, carbs: 65, fat: 22, fiber: 3, sugar: 12, sodium: 1200 },
    allergens: ['shellfish', 'peanut', 'egg', 'soy', 'fish'],
    fodmap: ['high_fructan', 'high_gos'],
    diet_tags: ['gluten-free']
  },
  {
    dish_name: 'Chicken Fried Rice',
    ingredients: [
      { name: 'jasmine rice', quantity: 300, unit: 'g' },
      { name: 'chicken breast', quantity: 150, unit: 'g' },
      { name: 'egg', quantity: 2, unit: 'whole' },
      { name: 'peas', quantity: 50, unit: 'g' },
      { name: 'carrot', quantity: 50, unit: 'g' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' },
      { name: 'sesame oil', quantity: 10, unit: 'ml' },
      { name: 'green onion', quantity: 20, unit: 'g' },
      { name: 'garlic', quantity: 2, unit: 'cloves' }
    ],
    nutrition: { calories: 520, protein: 28, carbs: 62, fat: 16, fiber: 3, sugar: 4, sodium: 980 },
    allergens: ['soy', 'egg', 'sesame'],
    fodmap: ['high_fructan', 'moderate_gos'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'General Tso Chicken',
    ingredients: [
      { name: 'chicken thigh', quantity: 300, unit: 'g' },
      { name: 'cornstarch', quantity: 50, unit: 'g' },
      { name: 'soy sauce', quantity: 45, unit: 'ml' },
      { name: 'rice vinegar', quantity: 30, unit: 'ml' },
      { name: 'brown sugar', quantity: 30, unit: 'g' },
      { name: 'ginger', quantity: 10, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'dried red chilies', quantity: 5, unit: 'g' },
      { name: 'vegetable oil', quantity: 60, unit: 'ml' }
    ],
    nutrition: { calories: 620, protein: 32, carbs: 48, fat: 32, fiber: 1, sugar: 22, sodium: 1350 },
    allergens: ['soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Beef and Broccoli',
    ingredients: [
      { name: 'beef sirloin', quantity: 250, unit: 'g' },
      { name: 'broccoli florets', quantity: 200, unit: 'g' },
      { name: 'soy sauce', quantity: 45, unit: 'ml' },
      { name: 'oyster sauce', quantity: 30, unit: 'ml' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'ginger', quantity: 10, unit: 'g' },
      { name: 'cornstarch', quantity: 15, unit: 'g' },
      { name: 'sesame oil', quantity: 10, unit: 'ml' }
    ],
    nutrition: { calories: 420, protein: 35, carbs: 22, fat: 22, fiber: 4, sugar: 6, sodium: 1180 },
    allergens: ['soy', 'shellfish', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Chicken Teriyaki',
    ingredients: [
      { name: 'chicken thigh', quantity: 250, unit: 'g' },
      { name: 'soy sauce', quantity: 60, unit: 'ml' },
      { name: 'mirin', quantity: 30, unit: 'ml' },
      { name: 'sake', quantity: 30, unit: 'ml' },
      { name: 'brown sugar', quantity: 20, unit: 'g' },
      { name: 'ginger', quantity: 5, unit: 'g' },
      { name: 'garlic', quantity: 2, unit: 'cloves' },
      { name: 'sesame seeds', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 380, protein: 32, carbs: 25, fat: 16, fiber: 0, sugar: 18, sodium: 1450 },
    allergens: ['soy', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // === MEXICAN ===
  {
    dish_name: 'Chicken Burrito',
    ingredients: [
      { name: 'flour tortilla', quantity: 1, unit: 'large' },
      { name: 'grilled chicken', quantity: 150, unit: 'g' },
      { name: 'rice', quantity: 100, unit: 'g' },
      { name: 'black beans', quantity: 80, unit: 'g' },
      { name: 'cheddar cheese', quantity: 40, unit: 'g' },
      { name: 'sour cream', quantity: 30, unit: 'g' },
      { name: 'guacamole', quantity: 50, unit: 'g' },
      { name: 'salsa', quantity: 50, unit: 'g' },
      { name: 'lettuce', quantity: 30, unit: 'g' }
    ],
    nutrition: { calories: 720, protein: 42, carbs: 68, fat: 28, fiber: 8, sugar: 4, sodium: 1250 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_gos', 'moderate_fructan'],
    diet_tags: []
  },
  {
    dish_name: 'Beef Tacos',
    ingredients: [
      { name: 'corn tortillas', quantity: 3, unit: 'pieces' },
      { name: 'ground beef', quantity: 150, unit: 'g' },
      { name: 'taco seasoning', quantity: 15, unit: 'g' },
      { name: 'cheddar cheese', quantity: 40, unit: 'g' },
      { name: 'lettuce', quantity: 30, unit: 'g' },
      { name: 'tomato', quantity: 40, unit: 'g' },
      { name: 'sour cream', quantity: 30, unit: 'g' },
      { name: 'salsa', quantity: 40, unit: 'g' }
    ],
    nutrition: { calories: 480, protein: 28, carbs: 35, fat: 26, fiber: 4, sugar: 4, sodium: 820 },
    allergens: ['milk'],
    fodmap: ['moderate_fructan'],
    diet_tags: ['gluten-free']
  },
  {
    dish_name: 'Chicken Quesadilla',
    ingredients: [
      { name: 'flour tortilla', quantity: 2, unit: 'large' },
      { name: 'grilled chicken', quantity: 120, unit: 'g' },
      { name: 'cheddar cheese', quantity: 80, unit: 'g' },
      { name: 'peppers', quantity: 40, unit: 'g' },
      { name: 'onion', quantity: 30, unit: 'g' },
      { name: 'sour cream', quantity: 30, unit: 'g' },
      { name: 'salsa', quantity: 40, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 35, carbs: 42, fat: 30, fiber: 3, sugar: 4, sodium: 980 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_fructan'],
    diet_tags: []
  },

  // === SALADS ===
  {
    dish_name: 'Caesar Salad',
    ingredients: [
      { name: 'romaine lettuce', quantity: 200, unit: 'g' },
      { name: 'parmesan cheese', quantity: 40, unit: 'g' },
      { name: 'croutons', quantity: 40, unit: 'g' },
      { name: 'caesar dressing', quantity: 60, unit: 'ml' },
      { name: 'lemon juice', quantity: 15, unit: 'ml' },
      { name: 'anchovy paste', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 380, protein: 12, carbs: 18, fat: 30, fiber: 4, sugar: 3, sodium: 780 },
    allergens: ['gluten', 'milk', 'egg', 'fish'],
    fodmap: ['low'],
    diet_tags: ['vegetarian']
  },
  {
    dish_name: 'Chicken Caesar Salad',
    ingredients: [
      { name: 'romaine lettuce', quantity: 200, unit: 'g' },
      { name: 'grilled chicken breast', quantity: 150, unit: 'g' },
      { name: 'parmesan cheese', quantity: 40, unit: 'g' },
      { name: 'croutons', quantity: 40, unit: 'g' },
      { name: 'caesar dressing', quantity: 60, unit: 'ml' },
      { name: 'lemon juice', quantity: 15, unit: 'ml' }
    ],
    nutrition: { calories: 520, protein: 42, carbs: 18, fat: 32, fiber: 4, sugar: 3, sodium: 920 },
    allergens: ['gluten', 'milk', 'egg', 'fish'],
    fodmap: ['low'],
    diet_tags: []
  },
  {
    dish_name: 'Greek Salad',
    ingredients: [
      { name: 'cucumber', quantity: 100, unit: 'g' },
      { name: 'tomato', quantity: 120, unit: 'g' },
      { name: 'red onion', quantity: 40, unit: 'g' },
      { name: 'kalamata olives', quantity: 40, unit: 'g' },
      { name: 'feta cheese', quantity: 60, unit: 'g' },
      { name: 'olive oil', quantity: 30, unit: 'ml' },
      { name: 'oregano', quantity: 2, unit: 'g' },
      { name: 'red wine vinegar', quantity: 15, unit: 'ml' }
    ],
    nutrition: { calories: 320, protein: 8, carbs: 12, fat: 28, fiber: 3, sugar: 6, sodium: 680 },
    allergens: ['milk'],
    fodmap: ['high_fructan', 'moderate_polyol'],
    diet_tags: ['vegetarian', 'gluten-free', 'keto']
  },
  {
    dish_name: 'Cobb Salad',
    ingredients: [
      { name: 'mixed greens', quantity: 150, unit: 'g' },
      { name: 'grilled chicken', quantity: 120, unit: 'g' },
      { name: 'bacon', quantity: 40, unit: 'g' },
      { name: 'hard-boiled egg', quantity: 2, unit: 'whole' },
      { name: 'avocado', quantity: 80, unit: 'g' },
      { name: 'tomato', quantity: 60, unit: 'g' },
      { name: 'blue cheese', quantity: 40, unit: 'g' },
      { name: 'red wine vinaigrette', quantity: 45, unit: 'ml' }
    ],
    nutrition: { calories: 580, protein: 38, carbs: 14, fat: 42, fiber: 6, sugar: 4, sodium: 920 },
    allergens: ['egg', 'milk'],
    fodmap: ['moderate_polyol'],
    diet_tags: ['gluten-free', 'keto']
  },

  // === SANDWICHES ===
  {
    dish_name: 'Club Sandwich',
    ingredients: [
      { name: 'white bread', quantity: 3, unit: 'slices' },
      { name: 'turkey breast', quantity: 80, unit: 'g' },
      { name: 'bacon', quantity: 40, unit: 'g' },
      { name: 'lettuce', quantity: 30, unit: 'g' },
      { name: 'tomato', quantity: 40, unit: 'g' },
      { name: 'mayonnaise', quantity: 30, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 28, carbs: 38, fat: 28, fiber: 3, sugar: 5, sodium: 1150 },
    allergens: ['gluten', 'egg'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'BLT Sandwich',
    ingredients: [
      { name: 'white bread', quantity: 2, unit: 'slices' },
      { name: 'bacon', quantity: 60, unit: 'g' },
      { name: 'lettuce', quantity: 40, unit: 'g' },
      { name: 'tomato', quantity: 60, unit: 'g' },
      { name: 'mayonnaise', quantity: 30, unit: 'g' }
    ],
    nutrition: { calories: 450, protein: 18, carbs: 28, fat: 30, fiber: 2, sugar: 4, sodium: 980 },
    allergens: ['gluten', 'egg'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Grilled Cheese Sandwich',
    ingredients: [
      { name: 'white bread', quantity: 2, unit: 'slices' },
      { name: 'cheddar cheese', quantity: 60, unit: 'g' },
      { name: 'butter', quantity: 20, unit: 'g' }
    ],
    nutrition: { calories: 420, protein: 15, carbs: 28, fat: 28, fiber: 1, sugar: 3, sodium: 680 },
    allergens: ['gluten', 'milk'],
    fodmap: ['high_fructan', 'moderate_lactose'],
    diet_tags: ['vegetarian']
  },

  // === BREAKFAST ===
  {
    dish_name: 'Eggs Benedict',
    ingredients: [
      { name: 'English muffin', quantity: 1, unit: 'whole' },
      { name: 'Canadian bacon', quantity: 60, unit: 'g' },
      { name: 'poached egg', quantity: 2, unit: 'whole' },
      { name: 'hollandaise sauce', quantity: 60, unit: 'ml' }
    ],
    nutrition: { calories: 580, protein: 25, carbs: 28, fat: 42, fiber: 2, sugar: 2, sodium: 1150 },
    allergens: ['gluten', 'egg', 'milk'],
    fodmap: ['high_fructan'],
    diet_tags: []
  },
  {
    dish_name: 'Pancakes',
    ingredients: [
      { name: 'all-purpose flour', quantity: 150, unit: 'g' },
      { name: 'milk', quantity: 240, unit: 'ml' },
      { name: 'egg', quantity: 1, unit: 'whole' },
      { name: 'butter', quantity: 30, unit: 'g' },
      { name: 'maple syrup', quantity: 60, unit: 'ml' },
      { name: 'baking powder', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 12, carbs: 82, fat: 16, fiber: 2, sugar: 35, sodium: 580 },
    allergens: ['gluten', 'milk', 'egg'],
    fodmap: ['high_fructan', 'moderate_lactose'],
    diet_tags: ['vegetarian']
  },
  {
    dish_name: 'French Toast',
    ingredients: [
      { name: 'brioche bread', quantity: 3, unit: 'slices' },
      { name: 'egg', quantity: 2, unit: 'whole' },
      { name: 'milk', quantity: 60, unit: 'ml' },
      { name: 'cinnamon', quantity: 2, unit: 'g' },
      { name: 'vanilla extract', quantity: 5, unit: 'ml' },
      { name: 'butter', quantity: 20, unit: 'g' },
      { name: 'maple syrup', quantity: 45, unit: 'ml' },
      { name: 'powdered sugar', quantity: 15, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 15, carbs: 72, fat: 25, fiber: 2, sugar: 42, sodium: 420 },
    allergens: ['gluten', 'milk', 'egg'],
    fodmap: ['high_fructan', 'moderate_lactose'],
    diet_tags: ['vegetarian']
  },
  {
    dish_name: 'Avocado Toast',
    ingredients: [
      { name: 'sourdough bread', quantity: 2, unit: 'slices' },
      { name: 'avocado', quantity: 150, unit: 'g' },
      { name: 'lemon juice', quantity: 10, unit: 'ml' },
      { name: 'red pepper flakes', quantity: 1, unit: 'g' },
      { name: 'sea salt', quantity: 2, unit: 'g' },
      { name: 'olive oil', quantity: 10, unit: 'ml' }
    ],
    nutrition: { calories: 380, protein: 8, carbs: 35, fat: 24, fiber: 10, sugar: 2, sodium: 520 },
    allergens: ['gluten'],
    fodmap: ['moderate_polyol', 'high_fructan'],
    diet_tags: ['vegan', 'dairy-free', 'vegetarian']
  },

  // === SOUPS ===
  {
    dish_name: 'Chicken Noodle Soup',
    ingredients: [
      { name: 'chicken breast', quantity: 150, unit: 'g' },
      { name: 'egg noodles', quantity: 100, unit: 'g' },
      { name: 'chicken broth', quantity: 500, unit: 'ml' },
      { name: 'carrot', quantity: 60, unit: 'g' },
      { name: 'celery', quantity: 40, unit: 'g' },
      { name: 'onion', quantity: 50, unit: 'g' },
      { name: 'parsley', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 280, protein: 25, carbs: 28, fat: 8, fiber: 2, sugar: 4, sodium: 980 },
    allergens: ['gluten', 'egg'],
    fodmap: ['high_fructan', 'moderate_polyol'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Tomato Soup',
    ingredients: [
      { name: 'crushed tomatoes', quantity: 400, unit: 'g' },
      { name: 'onion', quantity: 80, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'vegetable broth', quantity: 250, unit: 'ml' },
      { name: 'heavy cream', quantity: 60, unit: 'ml' },
      { name: 'butter', quantity: 20, unit: 'g' },
      { name: 'basil', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 220, protein: 4, carbs: 18, fat: 15, fiber: 4, sugar: 10, sodium: 680 },
    allergens: ['milk'],
    fodmap: ['high_fructan', 'high_fructose'],
    diet_tags: ['vegetarian', 'gluten-free']
  },
  {
    dish_name: 'Clam Chowder',
    ingredients: [
      { name: 'clams', quantity: 200, unit: 'g' },
      { name: 'potato', quantity: 200, unit: 'g' },
      { name: 'heavy cream', quantity: 240, unit: 'ml' },
      { name: 'bacon', quantity: 40, unit: 'g' },
      { name: 'onion', quantity: 60, unit: 'g' },
      { name: 'celery', quantity: 40, unit: 'g' },
      { name: 'butter', quantity: 30, unit: 'g' },
      { name: 'flour', quantity: 20, unit: 'g' }
    ],
    nutrition: { calories: 420, protein: 18, carbs: 32, fat: 26, fiber: 2, sugar: 4, sodium: 850 },
    allergens: ['shellfish', 'milk', 'gluten'],
    fodmap: ['high_fructan', 'high_lactose', 'moderate_polyol'],
    diet_tags: []
  },

  // === SEAFOOD ===
  {
    dish_name: 'Fish and Chips',
    ingredients: [
      { name: 'cod fillet', quantity: 200, unit: 'g' },
      { name: 'flour', quantity: 100, unit: 'g' },
      { name: 'beer', quantity: 120, unit: 'ml' },
      { name: 'potato', quantity: 250, unit: 'g' },
      { name: 'vegetable oil', quantity: 100, unit: 'ml' },
      { name: 'tartar sauce', quantity: 40, unit: 'g' },
      { name: 'lemon wedge', quantity: 1, unit: 'piece' }
    ],
    nutrition: { calories: 780, protein: 32, carbs: 68, fat: 42, fiber: 4, sugar: 2, sodium: 720 },
    allergens: ['fish', 'gluten', 'egg'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Grilled Salmon',
    ingredients: [
      { name: 'salmon fillet', quantity: 180, unit: 'g' },
      { name: 'olive oil', quantity: 15, unit: 'ml' },
      { name: 'lemon', quantity: 30, unit: 'g' },
      { name: 'dill', quantity: 5, unit: 'g' },
      { name: 'garlic', quantity: 2, unit: 'cloves' },
      { name: 'butter', quantity: 15, unit: 'g' }
    ],
    nutrition: { calories: 380, protein: 36, carbs: 2, fat: 25, fiber: 0, sugar: 1, sodium: 280 },
    allergens: ['fish', 'milk'],
    fodmap: ['high_fructan'],
    diet_tags: ['gluten-free', 'keto', 'low-carb']
  },
  {
    dish_name: 'Shrimp Scampi',
    ingredients: [
      { name: 'shrimp', quantity: 300, unit: 'g' },
      { name: 'linguine', quantity: 200, unit: 'g' },
      { name: 'butter', quantity: 60, unit: 'g' },
      { name: 'garlic', quantity: 5, unit: 'cloves' },
      { name: 'white wine', quantity: 120, unit: 'ml' },
      { name: 'lemon juice', quantity: 30, unit: 'ml' },
      { name: 'parsley', quantity: 15, unit: 'g' },
      { name: 'red pepper flakes', quantity: 2, unit: 'g' }
    ],
    nutrition: { calories: 620, protein: 35, carbs: 58, fat: 28, fiber: 3, sugar: 3, sodium: 720 },
    allergens: ['shellfish', 'gluten', 'milk'],
    fodmap: ['high_fructan'],
    diet_tags: []
  }
];

// Helper to normalize dish names
function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Escape SQL strings
function esc(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

// Generate SQL statements
function generateSQL(recipes) {
  const statements = [];

  for (const recipe of recipes) {
    const normalized = normalizeName(recipe.dish_name);
    const ingredientsJson = JSON.stringify(recipe.ingredients);
    const allergensJson = JSON.stringify(recipe.allergens);
    const fodmapJson = JSON.stringify(recipe.fodmap);
    const dietTagsJson = JSON.stringify(recipe.diet_tags);

    statements.push(`
INSERT INTO cached_recipes (
  dish_name_normalized, dish_name_display, ingredients_json, servings,
  calories_kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg,
  allergen_flags_json, fodmap_flags_json, diet_tags_json,
  source, confidence
) VALUES (
  ${esc(normalized)},
  ${esc(recipe.dish_name)},
  ${esc(ingredientsJson)},
  1,
  ${recipe.nutrition.calories},
  ${recipe.nutrition.protein},
  ${recipe.nutrition.carbs},
  ${recipe.nutrition.fat},
  ${recipe.nutrition.fiber},
  ${recipe.nutrition.sugar},
  ${recipe.nutrition.sodium},
  ${esc(allergensJson)},
  ${esc(fodmapJson)},
  ${esc(dietTagsJson)},
  'curated',
  0.95
) ON CONFLICT(dish_name_normalized) DO UPDATE SET
  ingredients_json = excluded.ingredients_json,
  calories_kcal = excluded.calories_kcal,
  protein_g = excluded.protein_g,
  carbs_g = excluded.carbs_g,
  fat_g = excluded.fat_g,
  fiber_g = excluded.fiber_g,
  sugar_g = excluded.sugar_g,
  sodium_mg = excluded.sodium_mg,
  allergen_flags_json = excluded.allergen_flags_json,
  fodmap_flags_json = excluded.fodmap_flags_json,
  diet_tags_json = excluded.diet_tags_json,
  updated_at = datetime('now');`.trim());
  }

  return statements;
}

// Main
const STAGING_DIR = path.join(__dirname, '..', 'staging');
if (!fs.existsSync(STAGING_DIR)) {
  fs.mkdirSync(STAGING_DIR, { recursive: true });
}

console.log(`=== Staging Recipe Cache Data ===\n`);
console.log(`Total recipes: ${RECIPES.length}`);

const statements = generateSQL(RECIPES);
const BATCH_SIZE = 50;
let batchNum = 1;
let batchStatements = [];

for (let i = 0; i < statements.length; i++) {
  batchStatements.push(statements[i]);

  if (batchStatements.length >= BATCH_SIZE || i === statements.length - 1) {
    const filename = `recipes_batch_${String(batchNum).padStart(3, '0')}.sql`;
    const filepath = path.join(STAGING_DIR, filename);
    fs.writeFileSync(filepath, batchStatements.join('\n\n') + '\n');
    console.log(`  → ${filename} (${batchStatements.length} recipes)`);
    batchNum++;
    batchStatements = [];
  }
}

console.log(`\nDone! Created ${batchNum - 1} batch file(s) in seed_data/staging/`);
console.log(`\nTo import to D1:`);
console.log(`  npx wrangler d1 execute tb-database --local --file seed_data/staging/recipes_batch_001.sql`);
