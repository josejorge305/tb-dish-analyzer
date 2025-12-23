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
  // === CHINESE CUISINE (20 base recipes) ===
  // ============================================

  // --- CHICKEN DISHES ---
  {
    dish_name: 'Kung Pao Chicken',
    ingredients: [
      { name: 'chicken thigh', quantity: 300, unit: 'g' },
      { name: 'peanuts', quantity: 50, unit: 'g' },
      { name: 'dried red chilies', quantity: 8, unit: 'pieces' },
      { name: 'Sichuan peppercorns', quantity: 5, unit: 'g' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' },
      { name: 'rice vinegar', quantity: 20, unit: 'ml' },
      { name: 'shaoxing wine', quantity: 15, unit: 'ml' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'ginger', quantity: 10, unit: 'g' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'cornstarch', quantity: 15, unit: 'g' }
    ],
    nutrition: { calories: 480, protein: 35, carbs: 22, fat: 28, fiber: 3, sugar: 6, sodium: 980 },
    allergens: ['peanut', 'soy'],
    fodmap: ['high_fructan', 'high_gos'],
    diet_tags: ['gluten-free', 'dairy-free']
  },
  {
    dish_name: 'General Tso Chicken',
    ingredients: [
      { name: 'chicken thigh', quantity: 350, unit: 'g' },
      { name: 'cornstarch', quantity: 60, unit: 'g' },
      { name: 'soy sauce', quantity: 45, unit: 'ml' },
      { name: 'rice vinegar', quantity: 30, unit: 'ml' },
      { name: 'hoisin sauce', quantity: 30, unit: 'ml' },
      { name: 'brown sugar', quantity: 40, unit: 'g' },
      { name: 'ginger', quantity: 15, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'dried red chilies', quantity: 6, unit: 'pieces' },
      { name: 'vegetable oil', quantity: 80, unit: 'ml' },
      { name: 'sesame oil', quantity: 10, unit: 'ml' }
    ],
    nutrition: { calories: 620, protein: 32, carbs: 52, fat: 32, fiber: 1, sugar: 28, sodium: 1350 },
    allergens: ['soy', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- PORK DISHES ---
  {
    dish_name: 'Sweet and Sour Pork',
    ingredients: [
      { name: 'pork loin', quantity: 350, unit: 'g' },
      { name: 'pineapple chunks', quantity: 150, unit: 'g' },
      { name: 'bell peppers', quantity: 100, unit: 'g' },
      { name: 'cornstarch', quantity: 50, unit: 'g' },
      { name: 'rice vinegar', quantity: 60, unit: 'ml' },
      { name: 'ketchup', quantity: 45, unit: 'ml' },
      { name: 'sugar', quantity: 50, unit: 'g' },
      { name: 'soy sauce', quantity: 20, unit: 'ml' },
      { name: 'vegetable oil', quantity: 100, unit: 'ml' }
    ],
    nutrition: { calories: 580, protein: 28, carbs: 55, fat: 26, fiber: 2, sugar: 38, sodium: 680 },
    allergens: ['soy'],
    fodmap: ['high_fructose', 'high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Twice Cooked Pork',
    ingredients: [
      { name: 'pork belly', quantity: 350, unit: 'g' },
      { name: 'leeks', quantity: 100, unit: 'g' },
      { name: 'bell peppers', quantity: 80, unit: 'g' },
      { name: 'doubanjiang', quantity: 30, unit: 'g' },
      { name: 'soy sauce', quantity: 20, unit: 'ml' },
      { name: 'shaoxing wine', quantity: 15, unit: 'ml' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'ginger', quantity: 10, unit: 'g' },
      { name: 'sugar', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 25, carbs: 15, fat: 40, fiber: 2, sugar: 8, sodium: 920 },
    allergens: ['soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Char Siu',
    ingredients: [
      { name: 'pork shoulder', quantity: 500, unit: 'g' },
      { name: 'hoisin sauce', quantity: 60, unit: 'ml' },
      { name: 'honey', quantity: 45, unit: 'ml' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' },
      { name: 'five spice powder', quantity: 5, unit: 'g' },
      { name: 'shaoxing wine', quantity: 30, unit: 'ml' },
      { name: 'red food coloring', quantity: 2, unit: 'ml' },
      { name: 'garlic', quantity: 4, unit: 'cloves' }
    ],
    nutrition: { calories: 380, protein: 35, carbs: 22, fat: 16, fiber: 1, sugar: 18, sodium: 850 },
    allergens: ['soy'],
    fodmap: ['high_fructan', 'high_fructose'],
    diet_tags: ['dairy-free']
  },

  // --- TOFU & VEGETARIAN ---
  {
    dish_name: 'Mapo Tofu',
    ingredients: [
      { name: 'silken tofu', quantity: 400, unit: 'g' },
      { name: 'ground pork', quantity: 150, unit: 'g' },
      { name: 'doubanjiang', quantity: 40, unit: 'g' },
      { name: 'Sichuan peppercorns', quantity: 5, unit: 'g' },
      { name: 'fermented black beans', quantity: 15, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'ginger', quantity: 10, unit: 'g' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'soy sauce', quantity: 15, unit: 'ml' },
      { name: 'cornstarch', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 320, protein: 22, carbs: 12, fat: 22, fiber: 2, sugar: 3, sodium: 980 },
    allergens: ['soy'],
    fodmap: ['high_fructan', 'high_gos'],
    diet_tags: ['gluten-free']
  },

  // --- DUCK ---
  {
    dish_name: 'Peking Duck',
    ingredients: [
      { name: 'whole duck', quantity: 2000, unit: 'g' },
      { name: 'maltose', quantity: 60, unit: 'ml' },
      { name: 'rice vinegar', quantity: 30, unit: 'ml' },
      { name: 'five spice powder', quantity: 5, unit: 'g' },
      { name: 'Mandarin pancakes', quantity: 12, unit: 'pieces' },
      { name: 'hoisin sauce', quantity: 80, unit: 'ml' },
      { name: 'green onion', quantity: 60, unit: 'g' },
      { name: 'cucumber', quantity: 100, unit: 'g' }
    ],
    nutrition: { calories: 680, protein: 45, carbs: 35, fat: 40, fiber: 2, sugar: 15, sodium: 720 },
    allergens: ['gluten', 'soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- HOT POT ---
  {
    dish_name: 'Hot Pot',
    ingredients: [
      { name: 'beef slices', quantity: 200, unit: 'g' },
      { name: 'lamb slices', quantity: 150, unit: 'g' },
      { name: 'tofu', quantity: 150, unit: 'g' },
      { name: 'napa cabbage', quantity: 200, unit: 'g' },
      { name: 'mushrooms', quantity: 150, unit: 'g' },
      { name: 'glass noodles', quantity: 100, unit: 'g' },
      { name: 'hot pot broth', quantity: 1000, unit: 'ml' },
      { name: 'Sichuan peppercorns', quantity: 10, unit: 'g' },
      { name: 'dried chilies', quantity: 15, unit: 'g' },
      { name: 'sesame dipping sauce', quantity: 60, unit: 'ml' }
    ],
    nutrition: { calories: 520, protein: 42, carbs: 35, fat: 25, fiber: 5, sugar: 4, sodium: 1200 },
    allergens: ['soy', 'sesame'],
    fodmap: ['high_mannitol', 'high_fructan'],
    diet_tags: ['gluten-free']
  },

  // --- DUMPLINGS ---
  {
    dish_name: 'Xiaolongbao',
    ingredients: [
      { name: 'pork', quantity: 300, unit: 'g' },
      { name: 'pork gelatin', quantity: 100, unit: 'g' },
      { name: 'dumpling wrapper', quantity: 250, unit: 'g' },
      { name: 'ginger', quantity: 15, unit: 'g' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'soy sauce', quantity: 20, unit: 'ml' },
      { name: 'sesame oil', quantity: 10, unit: 'ml' },
      { name: 'shaoxing wine', quantity: 15, unit: 'ml' }
    ],
    nutrition: { calories: 420, protein: 25, carbs: 42, fat: 18, fiber: 2, sugar: 2, sodium: 780 },
    allergens: ['gluten', 'soy', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Jiaozi',
    ingredients: [
      { name: 'ground pork', quantity: 300, unit: 'g' },
      { name: 'napa cabbage', quantity: 200, unit: 'g' },
      { name: 'dumpling wrapper', quantity: 250, unit: 'g' },
      { name: 'ginger', quantity: 10, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'green onion', quantity: 40, unit: 'g' },
      { name: 'soy sauce', quantity: 25, unit: 'ml' },
      { name: 'sesame oil', quantity: 15, unit: 'ml' }
    ],
    nutrition: { calories: 380, protein: 22, carbs: 40, fat: 15, fiber: 3, sugar: 2, sodium: 720 },
    allergens: ['gluten', 'soy', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Wonton Soup',
    ingredients: [
      { name: 'ground pork', quantity: 200, unit: 'g' },
      { name: 'shrimp', quantity: 100, unit: 'g' },
      { name: 'wonton wrappers', quantity: 200, unit: 'g' },
      { name: 'chicken broth', quantity: 800, unit: 'ml' },
      { name: 'bok choy', quantity: 100, unit: 'g' },
      { name: 'ginger', quantity: 10, unit: 'g' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'sesame oil', quantity: 10, unit: 'ml' }
    ],
    nutrition: { calories: 320, protein: 25, carbs: 32, fat: 12, fiber: 2, sugar: 2, sodium: 920 },
    allergens: ['gluten', 'shellfish', 'soy', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- NOODLES ---
  {
    dish_name: 'Chow Mein',
    ingredients: [
      { name: 'egg noodles', quantity: 250, unit: 'g' },
      { name: 'chicken breast', quantity: 150, unit: 'g' },
      { name: 'bean sprouts', quantity: 100, unit: 'g' },
      { name: 'cabbage', quantity: 100, unit: 'g' },
      { name: 'carrot', quantity: 50, unit: 'g' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' },
      { name: 'oyster sauce', quantity: 20, unit: 'ml' },
      { name: 'sesame oil', quantity: 10, unit: 'ml' },
      { name: 'garlic', quantity: 3, unit: 'cloves' }
    ],
    nutrition: { calories: 480, protein: 28, carbs: 58, fat: 16, fiber: 4, sugar: 6, sodium: 1050 },
    allergens: ['gluten', 'egg', 'soy', 'shellfish', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Lo Mein',
    ingredients: [
      { name: 'lo mein noodles', quantity: 250, unit: 'g' },
      { name: 'beef', quantity: 150, unit: 'g' },
      { name: 'bok choy', quantity: 100, unit: 'g' },
      { name: 'mushrooms', quantity: 80, unit: 'g' },
      { name: 'soy sauce', quantity: 40, unit: 'ml' },
      { name: 'oyster sauce', quantity: 25, unit: 'ml' },
      { name: 'sesame oil', quantity: 15, unit: 'ml' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'ginger', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 30, carbs: 60, fat: 18, fiber: 3, sugar: 5, sodium: 1120 },
    allergens: ['gluten', 'soy', 'shellfish', 'sesame'],
    fodmap: ['high_fructan', 'high_mannitol'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Dan Dan Noodles',
    ingredients: [
      { name: 'wheat noodles', quantity: 250, unit: 'g' },
      { name: 'ground pork', quantity: 150, unit: 'g' },
      { name: 'preserved vegetables', quantity: 30, unit: 'g' },
      { name: 'sesame paste', quantity: 40, unit: 'g' },
      { name: 'chili oil', quantity: 30, unit: 'ml' },
      { name: 'soy sauce', quantity: 25, unit: 'ml' },
      { name: 'Sichuan peppercorns', quantity: 5, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'green onion', quantity: 20, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 28, carbs: 55, fat: 28, fiber: 3, sugar: 4, sodium: 1080 },
    allergens: ['gluten', 'soy', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- RICE ---
  {
    dish_name: 'Yangzhou Fried Rice',
    ingredients: [
      { name: 'jasmine rice', quantity: 400, unit: 'g' },
      { name: 'char siu pork', quantity: 100, unit: 'g' },
      { name: 'shrimp', quantity: 100, unit: 'g' },
      { name: 'egg', quantity: 3, unit: 'whole' },
      { name: 'peas', quantity: 50, unit: 'g' },
      { name: 'carrot', quantity: 50, unit: 'g' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'soy sauce', quantity: 20, unit: 'ml' },
      { name: 'sesame oil', quantity: 10, unit: 'ml' }
    ],
    nutrition: { calories: 520, protein: 28, carbs: 65, fat: 16, fiber: 3, sugar: 4, sodium: 820 },
    allergens: ['shellfish', 'egg', 'soy', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['gluten-free', 'dairy-free']
  },

  // --- BEEF ---
  {
    dish_name: 'Beef with Broccoli',
    ingredients: [
      { name: 'beef sirloin', quantity: 300, unit: 'g' },
      { name: 'broccoli florets', quantity: 250, unit: 'g' },
      { name: 'soy sauce', quantity: 45, unit: 'ml' },
      { name: 'oyster sauce', quantity: 30, unit: 'ml' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'ginger', quantity: 15, unit: 'g' },
      { name: 'cornstarch', quantity: 15, unit: 'g' },
      { name: 'sesame oil', quantity: 10, unit: 'ml' }
    ],
    nutrition: { calories: 420, protein: 38, carbs: 22, fat: 22, fiber: 5, sugar: 6, sodium: 1180 },
    allergens: ['soy', 'shellfish', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },

  // --- SICHUAN ---
  {
    dish_name: 'Sichuan Boiled Fish',
    ingredients: [
      { name: 'white fish fillets', quantity: 400, unit: 'g' },
      { name: 'dried chilies', quantity: 30, unit: 'g' },
      { name: 'Sichuan peppercorns', quantity: 15, unit: 'g' },
      { name: 'doubanjiang', quantity: 40, unit: 'g' },
      { name: 'bean sprouts', quantity: 150, unit: 'g' },
      { name: 'napa cabbage', quantity: 150, unit: 'g' },
      { name: 'garlic', quantity: 6, unit: 'cloves' },
      { name: 'ginger', quantity: 15, unit: 'g' },
      { name: 'vegetable oil', quantity: 100, unit: 'ml' }
    ],
    nutrition: { calories: 480, protein: 38, carbs: 12, fat: 32, fiber: 3, sugar: 4, sodium: 1050 },
    allergens: ['fish', 'soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['gluten-free', 'dairy-free']
  },

  // --- EGG DISHES ---
  {
    dish_name: 'Egg Foo Young',
    ingredients: [
      { name: 'egg', quantity: 6, unit: 'whole' },
      { name: 'bean sprouts', quantity: 100, unit: 'g' },
      { name: 'char siu pork', quantity: 80, unit: 'g' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'mushrooms', quantity: 60, unit: 'g' },
      { name: 'soy sauce', quantity: 20, unit: 'ml' },
      { name: 'oyster sauce', quantity: 30, unit: 'ml' },
      { name: 'chicken broth', quantity: 150, unit: 'ml' },
      { name: 'cornstarch', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 380, protein: 28, carbs: 15, fat: 24, fiber: 2, sugar: 4, sodium: 920 },
    allergens: ['egg', 'soy', 'shellfish'],
    fodmap: ['high_fructan', 'high_mannitol'],
    diet_tags: ['gluten-free', 'dairy-free']
  },

  // --- APPETIZERS ---
  {
    dish_name: 'Spring Rolls',
    ingredients: [
      { name: 'spring roll wrappers', quantity: 200, unit: 'g' },
      { name: 'cabbage', quantity: 150, unit: 'g' },
      { name: 'carrot', quantity: 80, unit: 'g' },
      { name: 'bean sprouts', quantity: 80, unit: 'g' },
      { name: 'ground pork', quantity: 100, unit: 'g' },
      { name: 'glass noodles', quantity: 50, unit: 'g' },
      { name: 'soy sauce', quantity: 15, unit: 'ml' },
      { name: 'vegetable oil', quantity: 200, unit: 'ml' }
    ],
    nutrition: { calories: 320, protein: 12, carbs: 35, fat: 16, fiber: 3, sugar: 4, sodium: 580 },
    allergens: ['gluten', 'soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- DESSERTS ---
  {
    dish_name: 'Mooncakes',
    ingredients: [
      { name: 'lotus seed paste', quantity: 300, unit: 'g' },
      { name: 'flour', quantity: 200, unit: 'g' },
      { name: 'golden syrup', quantity: 100, unit: 'ml' },
      { name: 'vegetable oil', quantity: 50, unit: 'ml' },
      { name: 'salted egg yolks', quantity: 4, unit: 'pieces' },
      { name: 'lye water', quantity: 5, unit: 'ml' }
    ],
    nutrition: { calories: 450, protein: 8, carbs: 65, fat: 18, fiber: 2, sugar: 42, sodium: 280 },
    allergens: ['gluten', 'egg'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'vegetarian']
  },

  // ============================================
  // === JAPANESE CUISINE (20 base recipes) ===
  // ============================================

  // --- SUSHI & SASHIMI ---
  {
    dish_name: 'Nigiri Sushi',
    ingredients: [
      { name: 'sushi rice', quantity: 200, unit: 'g' },
      { name: 'fresh salmon', quantity: 80, unit: 'g' },
      { name: 'fresh tuna', quantity: 80, unit: 'g' },
      { name: 'shrimp', quantity: 60, unit: 'g' },
      { name: 'rice vinegar', quantity: 30, unit: 'ml' },
      { name: 'sugar', quantity: 15, unit: 'g' },
      { name: 'wasabi', quantity: 5, unit: 'g' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' },
      { name: 'pickled ginger', quantity: 20, unit: 'g' }
    ],
    nutrition: { calories: 380, protein: 28, carbs: 48, fat: 8, fiber: 1, sugar: 8, sodium: 720 },
    allergens: ['fish', 'shellfish', 'soy'],
    fodmap: ['low'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Sashimi',
    ingredients: [
      { name: 'fresh salmon', quantity: 100, unit: 'g' },
      { name: 'fresh tuna', quantity: 100, unit: 'g' },
      { name: 'yellowtail', quantity: 80, unit: 'g' },
      { name: 'wasabi', quantity: 8, unit: 'g' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' },
      { name: 'pickled ginger', quantity: 20, unit: 'g' },
      { name: 'daikon radish', quantity: 50, unit: 'g' },
      { name: 'shiso leaves', quantity: 5, unit: 'pieces' }
    ],
    nutrition: { calories: 280, protein: 42, carbs: 6, fat: 10, fiber: 1, sugar: 3, sodium: 680 },
    allergens: ['fish', 'soy'],
    fodmap: ['low'],
    diet_tags: ['dairy-free', 'gluten-free', 'keto', 'low-carb']
  },
  {
    dish_name: 'Maki Rolls',
    ingredients: [
      { name: 'sushi rice', quantity: 250, unit: 'g' },
      { name: 'nori sheets', quantity: 4, unit: 'pieces' },
      { name: 'fresh salmon', quantity: 100, unit: 'g' },
      { name: 'cucumber', quantity: 80, unit: 'g' },
      { name: 'avocado', quantity: 80, unit: 'g' },
      { name: 'cream cheese', quantity: 50, unit: 'g' },
      { name: 'rice vinegar', quantity: 30, unit: 'ml' },
      { name: 'sesame seeds', quantity: 10, unit: 'g' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' }
    ],
    nutrition: { calories: 450, protein: 22, carbs: 55, fat: 16, fiber: 4, sugar: 6, sodium: 780 },
    allergens: ['fish', 'milk', 'soy', 'sesame'],
    fodmap: ['moderate_polyol'],
    diet_tags: []
  },

  // --- NOODLES ---
  {
    dish_name: 'Tonkotsu Ramen',
    ingredients: [
      { name: 'ramen noodles', quantity: 200, unit: 'g' },
      { name: 'pork belly', quantity: 100, unit: 'g' },
      { name: 'tonkotsu broth', quantity: 500, unit: 'ml' },
      { name: 'soft-boiled egg', quantity: 1, unit: 'whole' },
      { name: 'green onion', quantity: 20, unit: 'g' },
      { name: 'nori', quantity: 2, unit: 'sheets' },
      { name: 'bamboo shoots', quantity: 30, unit: 'g' },
      { name: 'garlic oil', quantity: 10, unit: 'ml' },
      { name: 'sesame seeds', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 680, protein: 35, carbs: 65, fat: 32, fiber: 3, sugar: 4, sodium: 1450 },
    allergens: ['gluten', 'egg', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Shoyu Ramen',
    ingredients: [
      { name: 'ramen noodles', quantity: 200, unit: 'g' },
      { name: 'chashu pork', quantity: 80, unit: 'g' },
      { name: 'soy sauce broth', quantity: 500, unit: 'ml' },
      { name: 'soft-boiled egg', quantity: 1, unit: 'whole' },
      { name: 'green onion', quantity: 20, unit: 'g' },
      { name: 'nori', quantity: 2, unit: 'sheets' },
      { name: 'bamboo shoots', quantity: 30, unit: 'g' },
      { name: 'corn', quantity: 30, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 32, carbs: 68, fat: 20, fiber: 3, sugar: 5, sodium: 1380 },
    allergens: ['gluten', 'egg', 'soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Udon',
    ingredients: [
      { name: 'udon noodles', quantity: 250, unit: 'g' },
      { name: 'dashi broth', quantity: 400, unit: 'ml' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' },
      { name: 'mirin', quantity: 20, unit: 'ml' },
      { name: 'green onion', quantity: 20, unit: 'g' },
      { name: 'tempura flakes', quantity: 20, unit: 'g' },
      { name: 'kamaboko', quantity: 30, unit: 'g' }
    ],
    nutrition: { calories: 420, protein: 14, carbs: 78, fat: 6, fiber: 3, sugar: 8, sodium: 1120 },
    allergens: ['gluten', 'fish', 'soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Soba',
    ingredients: [
      { name: 'soba noodles', quantity: 200, unit: 'g' },
      { name: 'dashi broth', quantity: 300, unit: 'ml' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' },
      { name: 'mirin', quantity: 20, unit: 'ml' },
      { name: 'green onion', quantity: 20, unit: 'g' },
      { name: 'wasabi', quantity: 5, unit: 'g' },
      { name: 'nori', quantity: 1, unit: 'sheet' }
    ],
    nutrition: { calories: 350, protein: 14, carbs: 68, fat: 3, fiber: 4, sugar: 6, sodium: 980 },
    allergens: ['gluten', 'fish', 'soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'vegan']
  },

  // --- FRIED DISHES ---
  {
    dish_name: 'Tempura',
    ingredients: [
      { name: 'shrimp', quantity: 150, unit: 'g' },
      { name: 'sweet potato', quantity: 80, unit: 'g' },
      { name: 'eggplant', quantity: 60, unit: 'g' },
      { name: 'green beans', quantity: 50, unit: 'g' },
      { name: 'tempura flour', quantity: 100, unit: 'g' },
      { name: 'ice water', quantity: 150, unit: 'ml' },
      { name: 'vegetable oil', quantity: 200, unit: 'ml' },
      { name: 'tentsuyu sauce', quantity: 60, unit: 'ml' },
      { name: 'daikon', quantity: 30, unit: 'g' }
    ],
    nutrition: { calories: 480, protein: 22, carbs: 45, fat: 24, fiber: 4, sugar: 6, sodium: 680 },
    allergens: ['shellfish', 'gluten', 'soy'],
    fodmap: ['high_fructan', 'moderate_sorbitol'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Tonkatsu',
    ingredients: [
      { name: 'pork loin', quantity: 200, unit: 'g' },
      { name: 'panko breadcrumbs', quantity: 80, unit: 'g' },
      { name: 'flour', quantity: 30, unit: 'g' },
      { name: 'egg', quantity: 1, unit: 'whole' },
      { name: 'cabbage', quantity: 100, unit: 'g' },
      { name: 'tonkatsu sauce', quantity: 40, unit: 'ml' },
      { name: 'vegetable oil', quantity: 100, unit: 'ml' },
      { name: 'rice', quantity: 150, unit: 'g' }
    ],
    nutrition: { calories: 720, protein: 35, carbs: 65, fat: 35, fiber: 3, sugar: 8, sodium: 820 },
    allergens: ['gluten', 'egg'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Chicken Karaage',
    ingredients: [
      { name: 'chicken thigh', quantity: 300, unit: 'g' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' },
      { name: 'sake', quantity: 20, unit: 'ml' },
      { name: 'ginger', quantity: 15, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'potato starch', quantity: 60, unit: 'g' },
      { name: 'vegetable oil', quantity: 200, unit: 'ml' },
      { name: 'lemon', quantity: 1, unit: 'wedge' }
    ],
    nutrition: { calories: 450, protein: 32, carbs: 25, fat: 26, fiber: 1, sugar: 2, sodium: 780 },
    allergens: ['soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },

  // --- GRILLED ---
  {
    dish_name: 'Yakitori',
    ingredients: [
      { name: 'chicken thigh', quantity: 300, unit: 'g' },
      { name: 'chicken skin', quantity: 50, unit: 'g' },
      { name: 'green onion', quantity: 60, unit: 'g' },
      { name: 'tare sauce', quantity: 60, unit: 'ml' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' },
      { name: 'mirin', quantity: 30, unit: 'ml' },
      { name: 'sake', quantity: 20, unit: 'ml' },
      { name: 'shichimi togarashi', quantity: 3, unit: 'g' }
    ],
    nutrition: { calories: 380, protein: 35, carbs: 18, fat: 18, fiber: 1, sugar: 12, sodium: 920 },
    allergens: ['soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Teriyaki Chicken',
    ingredients: [
      { name: 'chicken thigh', quantity: 300, unit: 'g' },
      { name: 'soy sauce', quantity: 60, unit: 'ml' },
      { name: 'mirin', quantity: 40, unit: 'ml' },
      { name: 'sake', quantity: 30, unit: 'ml' },
      { name: 'sugar', quantity: 25, unit: 'g' },
      { name: 'ginger', quantity: 10, unit: 'g' },
      { name: 'garlic', quantity: 2, unit: 'cloves' },
      { name: 'sesame seeds', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 420, protein: 35, carbs: 28, fat: 18, fiber: 0, sugar: 22, sodium: 1380 },
    allergens: ['soy', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- RICE BOWLS ---
  {
    dish_name: 'Gyudon',
    ingredients: [
      { name: 'beef sirloin', quantity: 200, unit: 'g' },
      { name: 'onion', quantity: 100, unit: 'g' },
      { name: 'rice', quantity: 200, unit: 'g' },
      { name: 'dashi broth', quantity: 100, unit: 'ml' },
      { name: 'soy sauce', quantity: 40, unit: 'ml' },
      { name: 'mirin', quantity: 30, unit: 'ml' },
      { name: 'sake', quantity: 20, unit: 'ml' },
      { name: 'pickled ginger', quantity: 15, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 32, carbs: 65, fat: 20, fiber: 2, sugar: 10, sodium: 980 },
    allergens: ['soy', 'fish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- HOT POTS ---
  {
    dish_name: 'Sukiyaki',
    ingredients: [
      { name: 'beef ribeye', quantity: 300, unit: 'g' },
      { name: 'tofu', quantity: 150, unit: 'g' },
      { name: 'napa cabbage', quantity: 150, unit: 'g' },
      { name: 'shiitake mushrooms', quantity: 80, unit: 'g' },
      { name: 'shirataki noodles', quantity: 100, unit: 'g' },
      { name: 'green onion', quantity: 60, unit: 'g' },
      { name: 'soy sauce', quantity: 80, unit: 'ml' },
      { name: 'mirin', quantity: 60, unit: 'ml' },
      { name: 'sugar', quantity: 40, unit: 'g' },
      { name: 'raw egg', quantity: 1, unit: 'whole' }
    ],
    nutrition: { calories: 620, protein: 42, carbs: 35, fat: 35, fiber: 4, sugar: 25, sodium: 1250 },
    allergens: ['soy', 'egg'],
    fodmap: ['high_fructan', 'high_mannitol'],
    diet_tags: ['gluten-free', 'dairy-free']
  },
  {
    dish_name: 'Shabu Shabu',
    ingredients: [
      { name: 'beef ribeye', quantity: 250, unit: 'g' },
      { name: 'tofu', quantity: 150, unit: 'g' },
      { name: 'napa cabbage', quantity: 150, unit: 'g' },
      { name: 'enoki mushrooms', quantity: 100, unit: 'g' },
      { name: 'shirataki noodles', quantity: 100, unit: 'g' },
      { name: 'kombu dashi', quantity: 600, unit: 'ml' },
      { name: 'ponzu sauce', quantity: 60, unit: 'ml' },
      { name: 'sesame dipping sauce', quantity: 60, unit: 'ml' }
    ],
    nutrition: { calories: 520, protein: 40, carbs: 22, fat: 30, fiber: 4, sugar: 6, sodium: 980 },
    allergens: ['soy', 'sesame', 'fish'],
    fodmap: ['high_fructan', 'high_mannitol'],
    diet_tags: ['gluten-free', 'dairy-free']
  },

  // --- SAVORY PANCAKES ---
  {
    dish_name: 'Okonomiyaki',
    ingredients: [
      { name: 'flour', quantity: 100, unit: 'g' },
      { name: 'cabbage', quantity: 200, unit: 'g' },
      { name: 'pork belly', quantity: 100, unit: 'g' },
      { name: 'egg', quantity: 2, unit: 'whole' },
      { name: 'dashi broth', quantity: 100, unit: 'ml' },
      { name: 'okonomiyaki sauce', quantity: 50, unit: 'ml' },
      { name: 'mayonnaise', quantity: 30, unit: 'g' },
      { name: 'bonito flakes', quantity: 10, unit: 'g' },
      { name: 'aonori', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 22, carbs: 45, fat: 28, fiber: 4, sugar: 12, sodium: 920 },
    allergens: ['gluten', 'egg', 'fish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Takoyaki',
    ingredients: [
      { name: 'takoyaki batter', quantity: 200, unit: 'g' },
      { name: 'octopus', quantity: 100, unit: 'g' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'pickled ginger', quantity: 20, unit: 'g' },
      { name: 'tenkasu', quantity: 20, unit: 'g' },
      { name: 'takoyaki sauce', quantity: 40, unit: 'ml' },
      { name: 'mayonnaise', quantity: 20, unit: 'g' },
      { name: 'bonito flakes', quantity: 10, unit: 'g' },
      { name: 'aonori', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 380, protein: 18, carbs: 42, fat: 16, fiber: 2, sugar: 8, sodium: 780 },
    allergens: ['gluten', 'egg', 'shellfish', 'fish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- RICE BALLS & DUMPLINGS ---
  {
    dish_name: 'Onigiri',
    ingredients: [
      { name: 'sushi rice', quantity: 200, unit: 'g' },
      { name: 'nori', quantity: 2, unit: 'sheets' },
      { name: 'salmon flakes', quantity: 50, unit: 'g' },
      { name: 'umeboshi', quantity: 2, unit: 'pieces' },
      { name: 'salt', quantity: 3, unit: 'g' },
      { name: 'sesame seeds', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 280, protein: 12, carbs: 48, fat: 4, fiber: 1, sugar: 2, sodium: 580 },
    allergens: ['fish', 'sesame'],
    fodmap: ['low'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Gyoza',
    ingredients: [
      { name: 'ground pork', quantity: 250, unit: 'g' },
      { name: 'cabbage', quantity: 150, unit: 'g' },
      { name: 'gyoza wrappers', quantity: 200, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'ginger', quantity: 10, unit: 'g' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'soy sauce', quantity: 20, unit: 'ml' },
      { name: 'sesame oil', quantity: 15, unit: 'ml' },
      { name: 'rice vinegar', quantity: 20, unit: 'ml' }
    ],
    nutrition: { calories: 420, protein: 24, carbs: 42, fat: 18, fiber: 3, sugar: 3, sodium: 720 },
    allergens: ['gluten', 'soy', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- SOUP ---
  {
    dish_name: 'Miso Soup',
    ingredients: [
      { name: 'dashi broth', quantity: 400, unit: 'ml' },
      { name: 'miso paste', quantity: 40, unit: 'g' },
      { name: 'silken tofu', quantity: 100, unit: 'g' },
      { name: 'wakame seaweed', quantity: 5, unit: 'g' },
      { name: 'green onion', quantity: 15, unit: 'g' }
    ],
    nutrition: { calories: 80, protein: 6, carbs: 8, fat: 3, fiber: 2, sugar: 3, sodium: 820 },
    allergens: ['soy', 'fish'],
    fodmap: ['high_gos', 'high_fructan'],
    diet_tags: ['vegetarian', 'gluten-free', 'dairy-free', 'low-carb']
  },

  // --- DESSERTS ---
  {
    dish_name: 'Matcha Dessert',
    ingredients: [
      { name: 'matcha powder', quantity: 10, unit: 'g' },
      { name: 'heavy cream', quantity: 200, unit: 'ml' },
      { name: 'sugar', quantity: 60, unit: 'g' },
      { name: 'milk', quantity: 150, unit: 'ml' },
      { name: 'gelatin', quantity: 5, unit: 'g' },
      { name: 'red bean paste', quantity: 50, unit: 'g' }
    ],
    nutrition: { calories: 320, protein: 6, carbs: 38, fat: 18, fiber: 2, sugar: 32, sodium: 60 },
    allergens: ['milk'],
    fodmap: ['high_lactose', 'high_gos'],
    diet_tags: ['vegetarian', 'gluten-free']
  },

  // ============================================
  // === KOREAN CUISINE (20 base recipes) ===
  // ============================================

  // --- BBQ & GRILLED MEATS ---
  {
    dish_name: 'Bulgogi',
    ingredients: [
      { name: 'beef sirloin', quantity: 400, unit: 'g' },
      { name: 'soy sauce', quantity: 60, unit: 'ml' },
      { name: 'brown sugar', quantity: 30, unit: 'g' },
      { name: 'sesame oil', quantity: 20, unit: 'ml' },
      { name: 'garlic', quantity: 5, unit: 'cloves' },
      { name: 'ginger', quantity: 10, unit: 'g' },
      { name: 'pear', quantity: 100, unit: 'g' },
      { name: 'green onion', quantity: 40, unit: 'g' },
      { name: 'sesame seeds', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 420, protein: 38, carbs: 22, fat: 20, fiber: 2, sugar: 16, sodium: 980 },
    allergens: ['soy', 'sesame'],
    fodmap: ['high_fructan', 'high_fructose'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Galbi',
    ingredients: [
      { name: 'beef short ribs', quantity: 500, unit: 'g' },
      { name: 'soy sauce', quantity: 80, unit: 'ml' },
      { name: 'brown sugar', quantity: 40, unit: 'g' },
      { name: 'sesame oil', quantity: 25, unit: 'ml' },
      { name: 'garlic', quantity: 6, unit: 'cloves' },
      { name: 'ginger', quantity: 15, unit: 'g' },
      { name: 'Asian pear', quantity: 100, unit: 'g' },
      { name: 'green onion', quantity: 40, unit: 'g' },
      { name: 'black pepper', quantity: 3, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 42, carbs: 25, fat: 35, fiber: 1, sugar: 20, sodium: 1120 },
    allergens: ['soy', 'sesame'],
    fodmap: ['high_fructan', 'high_fructose'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Samgyeopsal',
    ingredients: [
      { name: 'pork belly', quantity: 400, unit: 'g' },
      { name: 'ssamjang', quantity: 40, unit: 'g' },
      { name: 'lettuce leaves', quantity: 100, unit: 'g' },
      { name: 'perilla leaves', quantity: 50, unit: 'g' },
      { name: 'garlic', quantity: 6, unit: 'cloves' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'kimchi', quantity: 80, unit: 'g' },
      { name: 'sesame oil', quantity: 15, unit: 'ml' }
    ],
    nutrition: { calories: 520, protein: 28, carbs: 8, fat: 42, fiber: 2, sugar: 3, sodium: 780 },
    allergens: ['soy', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free', 'keto', 'low-carb']
  },

  // --- RICE DISHES ---
  {
    dish_name: 'Bibimbap',
    ingredients: [
      { name: 'steamed rice', quantity: 250, unit: 'g' },
      { name: 'beef', quantity: 100, unit: 'g' },
      { name: 'spinach', quantity: 50, unit: 'g' },
      { name: 'bean sprouts', quantity: 50, unit: 'g' },
      { name: 'carrot', quantity: 40, unit: 'g' },
      { name: 'zucchini', quantity: 40, unit: 'g' },
      { name: 'shiitake mushrooms', quantity: 40, unit: 'g' },
      { name: 'fried egg', quantity: 1, unit: 'whole' },
      { name: 'gochujang', quantity: 30, unit: 'g' },
      { name: 'sesame oil', quantity: 15, unit: 'ml' }
    ],
    nutrition: { calories: 580, protein: 28, carbs: 72, fat: 20, fiber: 5, sugar: 8, sodium: 820 },
    allergens: ['soy', 'egg', 'sesame'],
    fodmap: ['high_fructan', 'high_mannitol'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Kimchi Fried Rice',
    ingredients: [
      { name: 'steamed rice', quantity: 300, unit: 'g' },
      { name: 'kimchi', quantity: 150, unit: 'g' },
      { name: 'pork belly', quantity: 100, unit: 'g' },
      { name: 'egg', quantity: 1, unit: 'whole' },
      { name: 'gochujang', quantity: 20, unit: 'g' },
      { name: 'sesame oil', quantity: 15, unit: 'ml' },
      { name: 'green onion', quantity: 20, unit: 'g' },
      { name: 'sesame seeds', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 22, carbs: 65, fat: 20, fiber: 4, sugar: 5, sodium: 920 },
    allergens: ['soy', 'egg', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },

  // --- STEWS (JJIGAE) ---
  {
    dish_name: 'Kimchi Jjigae',
    ingredients: [
      { name: 'aged kimchi', quantity: 300, unit: 'g' },
      { name: 'pork belly', quantity: 150, unit: 'g' },
      { name: 'tofu', quantity: 200, unit: 'g' },
      { name: 'gochugaru', quantity: 15, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'anchovy broth', quantity: 400, unit: 'ml' }
    ],
    nutrition: { calories: 380, protein: 25, carbs: 15, fat: 26, fiber: 5, sugar: 6, sodium: 1250 },
    allergens: ['soy', 'fish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Sundubu Jjigae',
    ingredients: [
      { name: 'soft tofu', quantity: 400, unit: 'g' },
      { name: 'pork', quantity: 100, unit: 'g' },
      { name: 'clams', quantity: 80, unit: 'g' },
      { name: 'egg', quantity: 1, unit: 'whole' },
      { name: 'gochugaru', quantity: 20, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'green onion', quantity: 20, unit: 'g' },
      { name: 'anchovy broth', quantity: 400, unit: 'ml' }
    ],
    nutrition: { calories: 320, protein: 28, carbs: 12, fat: 18, fiber: 2, sugar: 3, sodium: 1080 },
    allergens: ['soy', 'shellfish', 'egg', 'fish'],
    fodmap: ['high_fructan', 'high_gos'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Doenjang Jjigae',
    ingredients: [
      { name: 'doenjang paste', quantity: 60, unit: 'g' },
      { name: 'tofu', quantity: 200, unit: 'g' },
      { name: 'zucchini', quantity: 100, unit: 'g' },
      { name: 'potato', quantity: 100, unit: 'g' },
      { name: 'onion', quantity: 60, unit: 'g' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'anchovy broth', quantity: 500, unit: 'ml' },
      { name: 'gochugaru', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 280, protein: 18, carbs: 28, fat: 12, fiber: 5, sugar: 6, sodium: 1150 },
    allergens: ['soy', 'fish'],
    fodmap: ['high_fructan', 'high_gos'],
    diet_tags: ['dairy-free', 'vegetarian']
  },

  // --- NOODLES ---
  {
    dish_name: 'Japchae',
    ingredients: [
      { name: 'sweet potato noodles', quantity: 200, unit: 'g' },
      { name: 'beef', quantity: 100, unit: 'g' },
      { name: 'spinach', quantity: 80, unit: 'g' },
      { name: 'carrot', quantity: 60, unit: 'g' },
      { name: 'shiitake mushrooms', quantity: 60, unit: 'g' },
      { name: 'onion', quantity: 50, unit: 'g' },
      { name: 'soy sauce', quantity: 40, unit: 'ml' },
      { name: 'sesame oil', quantity: 20, unit: 'ml' },
      { name: 'sugar', quantity: 15, unit: 'g' },
      { name: 'sesame seeds', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 420, protein: 18, carbs: 58, fat: 14, fiber: 4, sugar: 12, sodium: 780 },
    allergens: ['soy', 'sesame'],
    fodmap: ['high_fructan', 'high_mannitol'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Naengmyeon',
    ingredients: [
      { name: 'buckwheat noodles', quantity: 200, unit: 'g' },
      { name: 'beef brisket', quantity: 80, unit: 'g' },
      { name: 'cold beef broth', quantity: 400, unit: 'ml' },
      { name: 'cucumber', quantity: 50, unit: 'g' },
      { name: 'Asian pear', quantity: 50, unit: 'g' },
      { name: 'hard-boiled egg', quantity: 1, unit: 'half' },
      { name: 'rice vinegar', quantity: 20, unit: 'ml' },
      { name: 'mustard', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 380, protein: 22, carbs: 58, fat: 8, fiber: 4, sugar: 8, sodium: 720 },
    allergens: ['gluten', 'egg'],
    fodmap: ['high_fructan', 'high_fructose'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Jjajangmyeon',
    ingredients: [
      { name: 'wheat noodles', quantity: 250, unit: 'g' },
      { name: 'pork belly', quantity: 150, unit: 'g' },
      { name: 'black bean paste', quantity: 80, unit: 'g' },
      { name: 'onion', quantity: 100, unit: 'g' },
      { name: 'zucchini', quantity: 80, unit: 'g' },
      { name: 'potato', quantity: 80, unit: 'g' },
      { name: 'cabbage', quantity: 60, unit: 'g' },
      { name: 'cucumber', quantity: 30, unit: 'g' }
    ],
    nutrition: { calories: 620, protein: 25, carbs: 78, fat: 24, fiber: 5, sugar: 10, sodium: 1080 },
    allergens: ['gluten', 'soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Jjampong',
    ingredients: [
      { name: 'wheat noodles', quantity: 250, unit: 'g' },
      { name: 'seafood mix', quantity: 200, unit: 'g' },
      { name: 'pork', quantity: 80, unit: 'g' },
      { name: 'napa cabbage', quantity: 100, unit: 'g' },
      { name: 'zucchini', quantity: 60, unit: 'g' },
      { name: 'gochugaru', quantity: 25, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'seafood broth', quantity: 500, unit: 'ml' }
    ],
    nutrition: { calories: 520, protein: 32, carbs: 62, fat: 16, fiber: 4, sugar: 6, sodium: 1320 },
    allergens: ['gluten', 'shellfish', 'fish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- STREET FOOD ---
  {
    dish_name: 'Tteokbokki',
    ingredients: [
      { name: 'rice cakes', quantity: 300, unit: 'g' },
      { name: 'gochujang', quantity: 60, unit: 'g' },
      { name: 'gochugaru', quantity: 15, unit: 'g' },
      { name: 'fish cakes', quantity: 100, unit: 'g' },
      { name: 'cabbage', quantity: 80, unit: 'g' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'sugar', quantity: 20, unit: 'g' },
      { name: 'anchovy broth', quantity: 300, unit: 'ml' }
    ],
    nutrition: { calories: 420, protein: 12, carbs: 78, fat: 6, fiber: 3, sugar: 18, sodium: 1080 },
    allergens: ['fish', 'soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Kimbap',
    ingredients: [
      { name: 'sushi rice', quantity: 250, unit: 'g' },
      { name: 'nori', quantity: 4, unit: 'sheets' },
      { name: 'beef', quantity: 80, unit: 'g' },
      { name: 'spinach', quantity: 50, unit: 'g' },
      { name: 'carrot', quantity: 40, unit: 'g' },
      { name: 'pickled radish', quantity: 40, unit: 'g' },
      { name: 'egg', quantity: 2, unit: 'whole' },
      { name: 'sesame oil', quantity: 15, unit: 'ml' },
      { name: 'sesame seeds', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 450, protein: 20, carbs: 65, fat: 14, fiber: 3, sugar: 5, sodium: 680 },
    allergens: ['soy', 'egg', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- FRIED CHICKEN ---
  {
    dish_name: 'Korean Fried Chicken',
    ingredients: [
      { name: 'chicken wings', quantity: 500, unit: 'g' },
      { name: 'potato starch', quantity: 80, unit: 'g' },
      { name: 'gochujang', quantity: 40, unit: 'g' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' },
      { name: 'honey', quantity: 40, unit: 'ml' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'ginger', quantity: 10, unit: 'g' },
      { name: 'vegetable oil', quantity: 300, unit: 'ml' },
      { name: 'sesame seeds', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 35, carbs: 38, fat: 32, fiber: 1, sugar: 22, sodium: 920 },
    allergens: ['soy', 'sesame'],
    fodmap: ['high_fructan', 'high_fructose'],
    diet_tags: ['dairy-free', 'gluten-free']
  },

  // --- PORK DISHES ---
  {
    dish_name: 'Bossam',
    ingredients: [
      { name: 'pork belly', quantity: 500, unit: 'g' },
      { name: 'doenjang', quantity: 30, unit: 'g' },
      { name: 'ginger', quantity: 20, unit: 'g' },
      { name: 'garlic', quantity: 6, unit: 'cloves' },
      { name: 'green onion', quantity: 40, unit: 'g' },
      { name: 'lettuce leaves', quantity: 100, unit: 'g' },
      { name: 'ssamjang', quantity: 50, unit: 'g' },
      { name: 'kimchi', quantity: 100, unit: 'g' },
      { name: 'salted shrimp', quantity: 20, unit: 'g' }
    ],
    nutrition: { calories: 480, protein: 32, carbs: 12, fat: 35, fiber: 3, sugar: 5, sodium: 1150 },
    allergens: ['soy', 'shellfish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Dakgalbi',
    ingredients: [
      { name: 'chicken thigh', quantity: 400, unit: 'g' },
      { name: 'gochujang', quantity: 50, unit: 'g' },
      { name: 'gochugaru', quantity: 15, unit: 'g' },
      { name: 'cabbage', quantity: 150, unit: 'g' },
      { name: 'sweet potato', quantity: 100, unit: 'g' },
      { name: 'rice cakes', quantity: 100, unit: 'g' },
      { name: 'perilla leaves', quantity: 30, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'soy sauce', quantity: 20, unit: 'ml' }
    ],
    nutrition: { calories: 520, protein: 38, carbs: 45, fat: 20, fiber: 5, sugar: 12, sodium: 980 },
    allergens: ['soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- PANCAKES ---
  {
    dish_name: 'Haemul Pajeon',
    ingredients: [
      { name: 'flour', quantity: 150, unit: 'g' },
      { name: 'egg', quantity: 2, unit: 'whole' },
      { name: 'green onion', quantity: 150, unit: 'g' },
      { name: 'squid', quantity: 80, unit: 'g' },
      { name: 'shrimp', quantity: 80, unit: 'g' },
      { name: 'clams', quantity: 60, unit: 'g' },
      { name: 'vegetable oil', quantity: 40, unit: 'ml' },
      { name: 'soy dipping sauce', quantity: 30, unit: 'ml' }
    ],
    nutrition: { calories: 420, protein: 25, carbs: 38, fat: 20, fiber: 3, sugar: 4, sodium: 780 },
    allergens: ['gluten', 'egg', 'shellfish', 'soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- DUMPLINGS ---
  {
    dish_name: 'Mandu',
    ingredients: [
      { name: 'ground pork', quantity: 200, unit: 'g' },
      { name: 'tofu', quantity: 100, unit: 'g' },
      { name: 'kimchi', quantity: 100, unit: 'g' },
      { name: 'mandu wrappers', quantity: 200, unit: 'g' },
      { name: 'glass noodles', quantity: 50, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'sesame oil', quantity: 15, unit: 'ml' },
      { name: 'soy sauce', quantity: 20, unit: 'ml' }
    ],
    nutrition: { calories: 380, protein: 22, carbs: 40, fat: 16, fiber: 3, sugar: 3, sodium: 720 },
    allergens: ['gluten', 'soy', 'sesame'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // --- SIDE DISHES ---
  {
    dish_name: 'Kimchi',
    ingredients: [
      { name: 'napa cabbage', quantity: 500, unit: 'g' },
      { name: 'gochugaru', quantity: 60, unit: 'g' },
      { name: 'fish sauce', quantity: 40, unit: 'ml' },
      { name: 'garlic', quantity: 8, unit: 'cloves' },
      { name: 'ginger', quantity: 20, unit: 'g' },
      { name: 'green onion', quantity: 50, unit: 'g' },
      { name: 'salted shrimp', quantity: 30, unit: 'g' },
      { name: 'sugar', quantity: 15, unit: 'g' }
    ],
    nutrition: { calories: 40, protein: 2, carbs: 8, fat: 0, fiber: 2, sugar: 4, sodium: 680 },
    allergens: ['fish', 'shellfish'],
    fodmap: ['high_fructan'],
    diet_tags: ['vegan', 'gluten-free', 'dairy-free', 'low-carb']
  },

  // ============================================
  // === VIETNAMESE CUISINE (20 base recipes) ===
  // ============================================

  // === PHỞ & SOUPS ===
  {
    dish_name: 'Phở Bò',
    ingredients: [
      { name: 'rice noodles', quantity: 200, unit: 'g' },
      { name: 'beef brisket', quantity: 150, unit: 'g' },
      { name: 'beef bone broth', quantity: 500, unit: 'ml' },
      { name: 'star anise', quantity: 2, unit: 'whole' },
      { name: 'cinnamon stick', quantity: 1, unit: 'piece' },
      { name: 'ginger', quantity: 30, unit: 'g' },
      { name: 'onion', quantity: 100, unit: 'g' },
      { name: 'bean sprouts', quantity: 50, unit: 'g' },
      { name: 'thai basil', quantity: 10, unit: 'g' },
      { name: 'lime', quantity: 1, unit: 'wedge' },
      { name: 'hoisin sauce', quantity: 15, unit: 'ml' },
      { name: 'sriracha', quantity: 10, unit: 'ml' }
    ],
    nutrition: { calories: 450, protein: 32, carbs: 55, fat: 12, fiber: 3, sugar: 6, sodium: 1200 },
    allergens: ['soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Phở Gà',
    ingredients: [
      { name: 'rice noodles', quantity: 200, unit: 'g' },
      { name: 'chicken breast', quantity: 150, unit: 'g' },
      { name: 'chicken broth', quantity: 500, unit: 'ml' },
      { name: 'star anise', quantity: 2, unit: 'whole' },
      { name: 'cinnamon stick', quantity: 1, unit: 'piece' },
      { name: 'ginger', quantity: 30, unit: 'g' },
      { name: 'onion', quantity: 100, unit: 'g' },
      { name: 'bean sprouts', quantity: 50, unit: 'g' },
      { name: 'cilantro', quantity: 10, unit: 'g' },
      { name: 'green onion', quantity: 20, unit: 'g' },
      { name: 'lime', quantity: 1, unit: 'wedge' }
    ],
    nutrition: { calories: 380, protein: 35, carbs: 48, fat: 6, fiber: 2, sugar: 4, sodium: 980 },
    allergens: [],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free', 'low-fat']
  },
  {
    dish_name: 'Bún Riêu',
    ingredients: [
      { name: 'rice vermicelli', quantity: 200, unit: 'g' },
      { name: 'crab paste', quantity: 60, unit: 'g' },
      { name: 'tomatoes', quantity: 150, unit: 'g' },
      { name: 'tofu puffs', quantity: 80, unit: 'g' },
      { name: 'egg', quantity: 1, unit: 'whole' },
      { name: 'shrimp paste', quantity: 15, unit: 'g' },
      { name: 'pork broth', quantity: 500, unit: 'ml' },
      { name: 'water spinach', quantity: 50, unit: 'g' },
      { name: 'bean sprouts', quantity: 30, unit: 'g' },
      { name: 'shallots', quantity: 30, unit: 'g' }
    ],
    nutrition: { calories: 420, protein: 24, carbs: 52, fat: 14, fiber: 3, sugar: 6, sodium: 1100 },
    allergens: ['shellfish', 'egg', 'soy'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Bún Bò Huế',
    ingredients: [
      { name: 'rice vermicelli', quantity: 200, unit: 'g' },
      { name: 'beef shank', quantity: 150, unit: 'g' },
      { name: 'pork knuckle', quantity: 80, unit: 'g' },
      { name: 'lemongrass', quantity: 30, unit: 'g' },
      { name: 'shrimp paste', quantity: 20, unit: 'g' },
      { name: 'chili oil', quantity: 15, unit: 'ml' },
      { name: 'banana blossom', quantity: 50, unit: 'g' },
      { name: 'water spinach', quantity: 50, unit: 'g' },
      { name: 'bean sprouts', quantity: 30, unit: 'g' },
      { name: 'pork blood cake', quantity: 40, unit: 'g' },
      { name: 'lime', quantity: 1, unit: 'wedge' }
    ],
    nutrition: { calories: 520, protein: 38, carbs: 48, fat: 20, fiber: 3, sugar: 4, sodium: 1350 },
    allergens: ['shellfish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Hủ Tiếu',
    ingredients: [
      { name: 'rice noodles', quantity: 200, unit: 'g' },
      { name: 'pork', quantity: 100, unit: 'g' },
      { name: 'shrimp', quantity: 80, unit: 'g' },
      { name: 'pork liver', quantity: 50, unit: 'g' },
      { name: 'pork broth', quantity: 450, unit: 'ml' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'bean sprouts', quantity: 50, unit: 'g' },
      { name: 'chinese celery', quantity: 20, unit: 'g' },
      { name: 'fried shallots', quantity: 15, unit: 'g' },
      { name: 'green onion', quantity: 20, unit: 'g' }
    ],
    nutrition: { calories: 480, protein: 36, carbs: 50, fat: 15, fiber: 2, sugar: 3, sodium: 1050 },
    allergens: ['shellfish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },

  // === BÁNH MÌ & ROLLS ===
  {
    dish_name: 'Bánh Mì',
    ingredients: [
      { name: 'baguette', quantity: 150, unit: 'g' },
      { name: 'pork belly', quantity: 80, unit: 'g' },
      { name: 'vietnamese ham', quantity: 50, unit: 'g' },
      { name: 'pate', quantity: 30, unit: 'g' },
      { name: 'pickled carrots', quantity: 40, unit: 'g' },
      { name: 'pickled daikon', quantity: 40, unit: 'g' },
      { name: 'cucumber', quantity: 30, unit: 'g' },
      { name: 'cilantro', quantity: 10, unit: 'g' },
      { name: 'jalapeño', quantity: 10, unit: 'g' },
      { name: 'mayonnaise', quantity: 20, unit: 'g' },
      { name: 'maggi sauce', quantity: 5, unit: 'ml' }
    ],
    nutrition: { calories: 580, protein: 26, carbs: 52, fat: 30, fiber: 3, sugar: 8, sodium: 1400 },
    allergens: ['wheat', 'egg', 'soy'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Gỏi Cuốn',
    ingredients: [
      { name: 'rice paper', quantity: 4, unit: 'sheets' },
      { name: 'shrimp', quantity: 80, unit: 'g' },
      { name: 'pork belly', quantity: 60, unit: 'g' },
      { name: 'rice vermicelli', quantity: 60, unit: 'g' },
      { name: 'lettuce', quantity: 40, unit: 'g' },
      { name: 'mint', quantity: 10, unit: 'g' },
      { name: 'thai basil', quantity: 10, unit: 'g' },
      { name: 'chives', quantity: 15, unit: 'g' },
      { name: 'peanut sauce', quantity: 40, unit: 'ml' },
      { name: 'hoisin sauce', quantity: 20, unit: 'ml' }
    ],
    nutrition: { calories: 320, protein: 22, carbs: 35, fat: 10, fiber: 2, sugar: 6, sodium: 680 },
    allergens: ['shellfish', 'peanut', 'soy'],
    fodmap: ['high_fructan', 'high_gos'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Chả Giò',
    ingredients: [
      { name: 'rice paper', quantity: 8, unit: 'sheets' },
      { name: 'ground pork', quantity: 200, unit: 'g' },
      { name: 'crab meat', quantity: 50, unit: 'g' },
      { name: 'wood ear mushrooms', quantity: 30, unit: 'g' },
      { name: 'glass noodles', quantity: 40, unit: 'g' },
      { name: 'carrots', quantity: 50, unit: 'g' },
      { name: 'taro', quantity: 50, unit: 'g' },
      { name: 'shallots', quantity: 20, unit: 'g' },
      { name: 'fish sauce', quantity: 15, unit: 'ml' },
      { name: 'vegetable oil', quantity: 100, unit: 'ml' }
    ],
    nutrition: { calories: 450, protein: 18, carbs: 32, fat: 28, fiber: 2, sugar: 3, sodium: 720 },
    allergens: ['shellfish', 'fish'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free', 'gluten-free']
  },

  // === BÚN (VERMICELLI BOWLS) ===
  {
    dish_name: 'Bún Chả',
    ingredients: [
      { name: 'rice vermicelli', quantity: 200, unit: 'g' },
      { name: 'pork patties', quantity: 150, unit: 'g' },
      { name: 'pork belly', quantity: 100, unit: 'g' },
      { name: 'fish sauce', quantity: 30, unit: 'ml' },
      { name: 'sugar', quantity: 20, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'lettuce', quantity: 40, unit: 'g' },
      { name: 'herbs', quantity: 30, unit: 'g' },
      { name: 'pickled papaya', quantity: 40, unit: 'g' },
      { name: 'lime', quantity: 1, unit: 'wedge' }
    ],
    nutrition: { calories: 580, protein: 32, carbs: 55, fat: 26, fiber: 2, sugar: 12, sodium: 1100 },
    allergens: ['fish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Bún Thịt Nướng',
    ingredients: [
      { name: 'rice vermicelli', quantity: 200, unit: 'g' },
      { name: 'grilled pork', quantity: 150, unit: 'g' },
      { name: 'lettuce', quantity: 50, unit: 'g' },
      { name: 'cucumber', quantity: 40, unit: 'g' },
      { name: 'pickled carrots', quantity: 40, unit: 'g' },
      { name: 'bean sprouts', quantity: 40, unit: 'g' },
      { name: 'peanuts', quantity: 20, unit: 'g' },
      { name: 'fried shallots', quantity: 15, unit: 'g' },
      { name: 'nuoc cham', quantity: 60, unit: 'ml' },
      { name: 'mint', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 30, carbs: 55, fat: 20, fiber: 3, sugar: 10, sodium: 950 },
    allergens: ['fish', 'peanut'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },

  // === CƠM (RICE DISHES) ===
  {
    dish_name: 'Cơm Tấm',
    ingredients: [
      { name: 'broken rice', quantity: 200, unit: 'g' },
      { name: 'grilled pork chop', quantity: 150, unit: 'g' },
      { name: 'pork skin', quantity: 50, unit: 'g' },
      { name: 'steamed egg meatloaf', quantity: 80, unit: 'g' },
      { name: 'pickled vegetables', quantity: 40, unit: 'g' },
      { name: 'cucumber', quantity: 30, unit: 'g' },
      { name: 'tomato', quantity: 40, unit: 'g' },
      { name: 'fried shallots', quantity: 10, unit: 'g' },
      { name: 'nuoc cham', quantity: 50, unit: 'ml' },
      { name: 'scallion oil', quantity: 15, unit: 'ml' }
    ],
    nutrition: { calories: 650, protein: 38, carbs: 60, fat: 28, fiber: 2, sugar: 8, sodium: 1050 },
    allergens: ['fish', 'egg'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Xôi',
    ingredients: [
      { name: 'sticky rice', quantity: 200, unit: 'g' },
      { name: 'mung beans', quantity: 80, unit: 'g' },
      { name: 'coconut milk', quantity: 60, unit: 'ml' },
      { name: 'shallots', quantity: 30, unit: 'g' },
      { name: 'vegetable oil', quantity: 15, unit: 'ml' },
      { name: 'salt', quantity: 2, unit: 'g' },
      { name: 'sugar', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 380, protein: 10, carbs: 68, fat: 8, fiber: 4, sugar: 6, sodium: 320 },
    allergens: [],
    fodmap: ['high_gos', 'high_fructan'],
    diet_tags: ['vegan', 'dairy-free', 'gluten-free']
  },

  // === BÁNH (SAVORY CAKES/PANCAKES) ===
  {
    dish_name: 'Bánh Xèo',
    ingredients: [
      { name: 'rice flour', quantity: 100, unit: 'g' },
      { name: 'coconut milk', quantity: 100, unit: 'ml' },
      { name: 'turmeric', quantity: 5, unit: 'g' },
      { name: 'shrimp', quantity: 80, unit: 'g' },
      { name: 'pork belly', quantity: 80, unit: 'g' },
      { name: 'bean sprouts', quantity: 60, unit: 'g' },
      { name: 'mung beans', quantity: 40, unit: 'g' },
      { name: 'green onion', quantity: 20, unit: 'g' },
      { name: 'lettuce', quantity: 40, unit: 'g' },
      { name: 'nuoc cham', quantity: 50, unit: 'ml' }
    ],
    nutrition: { calories: 480, protein: 24, carbs: 42, fat: 24, fiber: 3, sugar: 5, sodium: 850 },
    allergens: ['shellfish', 'fish'],
    fodmap: ['high_fructan', 'high_gos'],
    diet_tags: ['dairy-free', 'gluten-free']
  },

  // === CÁ & THỊT (FISH & MEAT) ===
  {
    dish_name: 'Cá Kho Tộ',
    ingredients: [
      { name: 'catfish', quantity: 300, unit: 'g' },
      { name: 'fish sauce', quantity: 45, unit: 'ml' },
      { name: 'coconut water', quantity: 100, unit: 'ml' },
      { name: 'caramel sauce', quantity: 30, unit: 'ml' },
      { name: 'sugar', quantity: 20, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'shallots', quantity: 30, unit: 'g' },
      { name: 'black pepper', quantity: 3, unit: 'g' },
      { name: 'chili', quantity: 10, unit: 'g' },
      { name: 'green onion', quantity: 15, unit: 'g' }
    ],
    nutrition: { calories: 380, protein: 32, carbs: 22, fat: 18, fiber: 1, sugar: 18, sodium: 1400 },
    allergens: ['fish'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Thịt Kho Trứng',
    ingredients: [
      { name: 'pork belly', quantity: 300, unit: 'g' },
      { name: 'eggs', quantity: 4, unit: 'whole' },
      { name: 'coconut water', quantity: 200, unit: 'ml' },
      { name: 'fish sauce', quantity: 40, unit: 'ml' },
      { name: 'caramel sauce', quantity: 30, unit: 'ml' },
      { name: 'sugar', quantity: 25, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'shallots', quantity: 20, unit: 'g' },
      { name: 'black pepper', quantity: 2, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 28, carbs: 18, fat: 38, fiber: 0, sugar: 16, sodium: 1250 },
    allergens: ['fish', 'egg'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free', 'gluten-free', 'keto-friendly']
  },
  {
    dish_name: 'Lemongrass Chicken',
    ingredients: [
      { name: 'chicken thighs', quantity: 400, unit: 'g' },
      { name: 'lemongrass', quantity: 40, unit: 'g' },
      { name: 'fish sauce', quantity: 30, unit: 'ml' },
      { name: 'sugar', quantity: 20, unit: 'g' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'shallots', quantity: 30, unit: 'g' },
      { name: 'chili', quantity: 15, unit: 'g' },
      { name: 'vegetable oil', quantity: 30, unit: 'ml' },
      { name: 'black pepper', quantity: 2, unit: 'g' }
    ],
    nutrition: { calories: 420, protein: 36, carbs: 12, fat: 26, fiber: 1, sugar: 10, sodium: 980 },
    allergens: ['fish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free', 'low-carb']
  },

  // === GỎI (SALADS) ===
  {
    dish_name: 'Gỏi Đu Đủ',
    ingredients: [
      { name: 'green papaya', quantity: 200, unit: 'g' },
      { name: 'shrimp', quantity: 60, unit: 'g' },
      { name: 'pork', quantity: 50, unit: 'g' },
      { name: 'carrots', quantity: 40, unit: 'g' },
      { name: 'vietnamese coriander', quantity: 15, unit: 'g' },
      { name: 'thai basil', quantity: 10, unit: 'g' },
      { name: 'peanuts', quantity: 25, unit: 'g' },
      { name: 'fried shallots', quantity: 15, unit: 'g' },
      { name: 'nuoc cham', quantity: 50, unit: 'ml' },
      { name: 'chili', quantity: 5, unit: 'g' }
    ],
    nutrition: { calories: 280, protein: 18, carbs: 22, fat: 14, fiber: 4, sugar: 12, sodium: 720 },
    allergens: ['shellfish', 'fish', 'peanut'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free', 'gluten-free', 'low-carb']
  },

  // === DRINKS & DESSERTS ===
  {
    dish_name: 'Vietnamese Iced Coffee',
    ingredients: [
      { name: 'vietnamese coffee', quantity: 25, unit: 'g' },
      { name: 'condensed milk', quantity: 40, unit: 'ml' },
      { name: 'hot water', quantity: 100, unit: 'ml' },
      { name: 'ice', quantity: 150, unit: 'g' }
    ],
    nutrition: { calories: 180, protein: 3, carbs: 28, fat: 6, fiber: 0, sugar: 26, sodium: 45 },
    allergens: ['milk'],
    fodmap: ['high_lactose'],
    diet_tags: ['vegetarian', 'gluten-free']
  },
  {
    dish_name: 'Chè',
    ingredients: [
      { name: 'mung beans', quantity: 80, unit: 'g' },
      { name: 'tapioca pearls', quantity: 40, unit: 'g' },
      { name: 'coconut milk', quantity: 150, unit: 'ml' },
      { name: 'sugar', quantity: 50, unit: 'g' },
      { name: 'pandan leaves', quantity: 5, unit: 'g' },
      { name: 'red beans', quantity: 40, unit: 'g' },
      { name: 'palm sugar', quantity: 20, unit: 'g' },
      { name: 'ice', quantity: 100, unit: 'g' }
    ],
    nutrition: { calories: 320, protein: 8, carbs: 58, fat: 8, fiber: 4, sugar: 38, sodium: 25 },
    allergens: [],
    fodmap: ['high_gos', 'high_fructan'],
    diet_tags: ['vegan', 'dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Fish Sauce Wings',
    ingredients: [
      { name: 'chicken wings', quantity: 500, unit: 'g' },
      { name: 'fish sauce', quantity: 45, unit: 'ml' },
      { name: 'sugar', quantity: 40, unit: 'g' },
      { name: 'garlic', quantity: 6, unit: 'cloves' },
      { name: 'butter', quantity: 30, unit: 'g' },
      { name: 'black pepper', quantity: 3, unit: 'g' },
      { name: 'vegetable oil', quantity: 50, unit: 'ml' }
    ],
    nutrition: { calories: 580, protein: 38, carbs: 18, fat: 40, fiber: 0, sugar: 16, sodium: 1350 },
    allergens: ['fish', 'milk'],
    fodmap: ['high_fructan'],
    diet_tags: ['gluten-free', 'keto-friendly']
  },

  // ============================================
  // === THAI CUISINE (20 base recipes) ===
  // ============================================

  // === NOODLES ===
  {
    dish_name: 'Pad Thai',
    ingredients: [
      { name: 'rice noodles', quantity: 200, unit: 'g' },
      { name: 'shrimp', quantity: 100, unit: 'g' },
      { name: 'tofu', quantity: 80, unit: 'g' },
      { name: 'egg', quantity: 2, unit: 'whole' },
      { name: 'bean sprouts', quantity: 80, unit: 'g' },
      { name: 'garlic chives', quantity: 30, unit: 'g' },
      { name: 'peanuts', quantity: 30, unit: 'g' },
      { name: 'tamarind paste', quantity: 30, unit: 'g' },
      { name: 'fish sauce', quantity: 30, unit: 'ml' },
      { name: 'palm sugar', quantity: 25, unit: 'g' },
      { name: 'dried shrimp', quantity: 15, unit: 'g' },
      { name: 'lime', quantity: 1, unit: 'wedge' }
    ],
    nutrition: { calories: 520, protein: 28, carbs: 62, fat: 18, fiber: 3, sugar: 14, sodium: 1150 },
    allergens: ['shellfish', 'egg', 'peanut', 'fish', 'soy'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Pad See Ew',
    ingredients: [
      { name: 'wide rice noodles', quantity: 250, unit: 'g' },
      { name: 'chicken breast', quantity: 150, unit: 'g' },
      { name: 'chinese broccoli', quantity: 150, unit: 'g' },
      { name: 'egg', quantity: 2, unit: 'whole' },
      { name: 'soy sauce', quantity: 30, unit: 'ml' },
      { name: 'dark soy sauce', quantity: 20, unit: 'ml' },
      { name: 'oyster sauce', quantity: 20, unit: 'ml' },
      { name: 'garlic', quantity: 4, unit: 'cloves' },
      { name: 'vegetable oil', quantity: 30, unit: 'ml' },
      { name: 'white pepper', quantity: 2, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 32, carbs: 68, fat: 20, fiber: 3, sugar: 6, sodium: 1400 },
    allergens: ['egg', 'soy', 'shellfish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Pad Kee Mao',
    ingredients: [
      { name: 'wide rice noodles', quantity: 250, unit: 'g' },
      { name: 'beef sirloin', quantity: 150, unit: 'g' },
      { name: 'thai basil', quantity: 30, unit: 'g' },
      { name: 'thai chilies', quantity: 20, unit: 'g' },
      { name: 'garlic', quantity: 5, unit: 'cloves' },
      { name: 'bell peppers', quantity: 80, unit: 'g' },
      { name: 'tomatoes', quantity: 60, unit: 'g' },
      { name: 'baby corn', quantity: 50, unit: 'g' },
      { name: 'oyster sauce', quantity: 25, unit: 'ml' },
      { name: 'fish sauce', quantity: 20, unit: 'ml' },
      { name: 'soy sauce', quantity: 15, unit: 'ml' },
      { name: 'egg', quantity: 1, unit: 'whole' }
    ],
    nutrition: { calories: 550, protein: 30, carbs: 65, fat: 18, fiber: 4, sugar: 8, sodium: 1250 },
    allergens: ['egg', 'soy', 'shellfish', 'fish'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Khao Soi',
    ingredients: [
      { name: 'egg noodles', quantity: 200, unit: 'g' },
      { name: 'chicken thighs', quantity: 200, unit: 'g' },
      { name: 'coconut milk', quantity: 300, unit: 'ml' },
      { name: 'red curry paste', quantity: 40, unit: 'g' },
      { name: 'turmeric', quantity: 5, unit: 'g' },
      { name: 'fish sauce', quantity: 25, unit: 'ml' },
      { name: 'palm sugar', quantity: 15, unit: 'g' },
      { name: 'shallots', quantity: 30, unit: 'g' },
      { name: 'pickled mustard greens', quantity: 30, unit: 'g' },
      { name: 'lime', quantity: 1, unit: 'wedge' },
      { name: 'crispy noodles', quantity: 30, unit: 'g' }
    ],
    nutrition: { calories: 680, protein: 35, carbs: 55, fat: 38, fiber: 3, sugar: 10, sodium: 1100 },
    allergens: ['wheat', 'egg', 'fish'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free']
  },

  // === CURRIES ===
  {
    dish_name: 'Green Curry',
    ingredients: [
      { name: 'chicken thighs', quantity: 250, unit: 'g' },
      { name: 'coconut milk', quantity: 400, unit: 'ml' },
      { name: 'green curry paste', quantity: 50, unit: 'g' },
      { name: 'thai eggplant', quantity: 100, unit: 'g' },
      { name: 'bamboo shoots', quantity: 80, unit: 'g' },
      { name: 'thai basil', quantity: 20, unit: 'g' },
      { name: 'kaffir lime leaves', quantity: 4, unit: 'leaves' },
      { name: 'fish sauce', quantity: 25, unit: 'ml' },
      { name: 'palm sugar', quantity: 15, unit: 'g' },
      { name: 'thai chilies', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 520, protein: 32, carbs: 18, fat: 38, fiber: 4, sugar: 10, sodium: 980 },
    allergens: ['fish'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free', 'gluten-free', 'low-carb']
  },
  {
    dish_name: 'Red Curry',
    ingredients: [
      { name: 'beef sirloin', quantity: 250, unit: 'g' },
      { name: 'coconut milk', quantity: 400, unit: 'ml' },
      { name: 'red curry paste', quantity: 50, unit: 'g' },
      { name: 'bamboo shoots', quantity: 100, unit: 'g' },
      { name: 'bell peppers', quantity: 80, unit: 'g' },
      { name: 'thai basil', quantity: 20, unit: 'g' },
      { name: 'kaffir lime leaves', quantity: 4, unit: 'leaves' },
      { name: 'fish sauce', quantity: 25, unit: 'ml' },
      { name: 'palm sugar', quantity: 15, unit: 'g' }
    ],
    nutrition: { calories: 550, protein: 34, carbs: 16, fat: 40, fiber: 3, sugar: 10, sodium: 1020 },
    allergens: ['fish'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free', 'gluten-free', 'low-carb']
  },
  {
    dish_name: 'Massaman Curry',
    ingredients: [
      { name: 'beef chuck', quantity: 300, unit: 'g' },
      { name: 'coconut milk', quantity: 400, unit: 'ml' },
      { name: 'massaman curry paste', quantity: 50, unit: 'g' },
      { name: 'potatoes', quantity: 150, unit: 'g' },
      { name: 'onion', quantity: 100, unit: 'g' },
      { name: 'peanuts', quantity: 40, unit: 'g' },
      { name: 'tamarind paste', quantity: 20, unit: 'g' },
      { name: 'fish sauce', quantity: 25, unit: 'ml' },
      { name: 'palm sugar', quantity: 20, unit: 'g' },
      { name: 'cinnamon stick', quantity: 1, unit: 'piece' },
      { name: 'cardamom', quantity: 3, unit: 'pods' }
    ],
    nutrition: { calories: 620, protein: 38, carbs: 32, fat: 42, fiber: 4, sugar: 14, sodium: 1050 },
    allergens: ['fish', 'peanut'],
    fodmap: ['high_fructan', 'high_polyol', 'high_gos'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Panang Curry',
    ingredients: [
      { name: 'pork tenderloin', quantity: 250, unit: 'g' },
      { name: 'coconut milk', quantity: 350, unit: 'ml' },
      { name: 'panang curry paste', quantity: 50, unit: 'g' },
      { name: 'kaffir lime leaves', quantity: 5, unit: 'leaves' },
      { name: 'thai basil', quantity: 20, unit: 'g' },
      { name: 'fish sauce', quantity: 20, unit: 'ml' },
      { name: 'palm sugar', quantity: 15, unit: 'g' },
      { name: 'peanuts', quantity: 25, unit: 'g' },
      { name: 'red chilies', quantity: 10, unit: 'g' }
    ],
    nutrition: { calories: 540, protein: 35, carbs: 14, fat: 40, fiber: 2, sugar: 10, sodium: 920 },
    allergens: ['fish', 'peanut'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free', 'low-carb']
  },

  // === SOUPS ===
  {
    dish_name: 'Tom Yum Soup',
    ingredients: [
      { name: 'shrimp', quantity: 200, unit: 'g' },
      { name: 'mushrooms', quantity: 100, unit: 'g' },
      { name: 'lemongrass', quantity: 30, unit: 'g' },
      { name: 'galangal', quantity: 20, unit: 'g' },
      { name: 'kaffir lime leaves', quantity: 5, unit: 'leaves' },
      { name: 'thai chilies', quantity: 15, unit: 'g' },
      { name: 'fish sauce', quantity: 30, unit: 'ml' },
      { name: 'lime juice', quantity: 40, unit: 'ml' },
      { name: 'tom yum paste', quantity: 30, unit: 'g' },
      { name: 'cilantro', quantity: 15, unit: 'g' },
      { name: 'cherry tomatoes', quantity: 80, unit: 'g' }
    ],
    nutrition: { calories: 180, protein: 26, carbs: 12, fat: 4, fiber: 2, sugar: 6, sodium: 1350 },
    allergens: ['shellfish', 'fish'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free', 'gluten-free', 'low-carb', 'low-fat']
  },
  {
    dish_name: 'Tom Kha Gai',
    ingredients: [
      { name: 'chicken breast', quantity: 200, unit: 'g' },
      { name: 'coconut milk', quantity: 400, unit: 'ml' },
      { name: 'mushrooms', quantity: 100, unit: 'g' },
      { name: 'galangal', quantity: 25, unit: 'g' },
      { name: 'lemongrass', quantity: 25, unit: 'g' },
      { name: 'kaffir lime leaves', quantity: 4, unit: 'leaves' },
      { name: 'fish sauce', quantity: 25, unit: 'ml' },
      { name: 'lime juice', quantity: 30, unit: 'ml' },
      { name: 'thai chilies', quantity: 10, unit: 'g' },
      { name: 'cilantro', quantity: 15, unit: 'g' }
    ],
    nutrition: { calories: 420, protein: 32, carbs: 12, fat: 30, fiber: 2, sugar: 6, sodium: 980 },
    allergens: ['fish'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free', 'gluten-free', 'low-carb', 'keto-friendly']
  },

  // === SALADS & APPETIZERS ===
  {
    dish_name: 'Som Tam',
    ingredients: [
      { name: 'green papaya', quantity: 250, unit: 'g' },
      { name: 'cherry tomatoes', quantity: 60, unit: 'g' },
      { name: 'long beans', quantity: 50, unit: 'g' },
      { name: 'dried shrimp', quantity: 20, unit: 'g' },
      { name: 'peanuts', quantity: 25, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'thai chilies', quantity: 15, unit: 'g' },
      { name: 'palm sugar', quantity: 20, unit: 'g' },
      { name: 'fish sauce', quantity: 25, unit: 'ml' },
      { name: 'lime juice', quantity: 30, unit: 'ml' }
    ],
    nutrition: { calories: 220, protein: 10, carbs: 28, fat: 9, fiber: 5, sugar: 18, sodium: 920 },
    allergens: ['shellfish', 'fish', 'peanut'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Larb',
    ingredients: [
      { name: 'ground pork', quantity: 300, unit: 'g' },
      { name: 'shallots', quantity: 40, unit: 'g' },
      { name: 'mint', quantity: 25, unit: 'g' },
      { name: 'cilantro', quantity: 20, unit: 'g' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'toasted rice powder', quantity: 20, unit: 'g' },
      { name: 'fish sauce', quantity: 30, unit: 'ml' },
      { name: 'lime juice', quantity: 40, unit: 'ml' },
      { name: 'thai chilies', quantity: 15, unit: 'g' },
      { name: 'lettuce', quantity: 60, unit: 'g' }
    ],
    nutrition: { calories: 320, protein: 28, carbs: 12, fat: 18, fiber: 2, sugar: 4, sodium: 1100 },
    allergens: ['fish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free', 'low-carb']
  },
  {
    dish_name: 'Satay',
    ingredients: [
      { name: 'chicken thighs', quantity: 400, unit: 'g' },
      { name: 'coconut milk', quantity: 100, unit: 'ml' },
      { name: 'turmeric', quantity: 5, unit: 'g' },
      { name: 'coriander powder', quantity: 5, unit: 'g' },
      { name: 'cumin', quantity: 3, unit: 'g' },
      { name: 'lemongrass', quantity: 20, unit: 'g' },
      { name: 'peanut sauce', quantity: 100, unit: 'ml' },
      { name: 'fish sauce', quantity: 15, unit: 'ml' },
      { name: 'palm sugar', quantity: 15, unit: 'g' },
      { name: 'cucumber', quantity: 50, unit: 'g' }
    ],
    nutrition: { calories: 480, protein: 38, carbs: 18, fat: 30, fiber: 2, sugar: 12, sodium: 850 },
    allergens: ['peanut', 'fish'],
    fodmap: ['high_fructan', 'high_gos'],
    diet_tags: ['dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Thai Spring Rolls',
    ingredients: [
      { name: 'spring roll wrappers', quantity: 8, unit: 'sheets' },
      { name: 'glass noodles', quantity: 50, unit: 'g' },
      { name: 'ground pork', quantity: 150, unit: 'g' },
      { name: 'cabbage', quantity: 80, unit: 'g' },
      { name: 'carrots', quantity: 50, unit: 'g' },
      { name: 'wood ear mushrooms', quantity: 30, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'cloves' },
      { name: 'soy sauce', quantity: 15, unit: 'ml' },
      { name: 'white pepper', quantity: 2, unit: 'g' },
      { name: 'vegetable oil', quantity: 150, unit: 'ml' },
      { name: 'sweet chili sauce', quantity: 50, unit: 'ml' }
    ],
    nutrition: { calories: 380, protein: 14, carbs: 38, fat: 20, fiber: 2, sugar: 8, sodium: 680 },
    allergens: ['wheat', 'soy'],
    fodmap: ['high_fructan', 'high_polyol'],
    diet_tags: ['dairy-free']
  },

  // === STIR-FRIES ===
  {
    dish_name: 'Pad Kra Pao',
    ingredients: [
      { name: 'ground chicken', quantity: 300, unit: 'g' },
      { name: 'thai holy basil', quantity: 40, unit: 'g' },
      { name: 'thai chilies', quantity: 20, unit: 'g' },
      { name: 'garlic', quantity: 6, unit: 'cloves' },
      { name: 'shallots', quantity: 30, unit: 'g' },
      { name: 'fish sauce', quantity: 25, unit: 'ml' },
      { name: 'oyster sauce', quantity: 20, unit: 'ml' },
      { name: 'soy sauce', quantity: 15, unit: 'ml' },
      { name: 'sugar', quantity: 10, unit: 'g' },
      { name: 'fried egg', quantity: 1, unit: 'whole' },
      { name: 'jasmine rice', quantity: 200, unit: 'g' }
    ],
    nutrition: { calories: 580, protein: 35, carbs: 55, fat: 24, fiber: 2, sugar: 6, sodium: 1250 },
    allergens: ['fish', 'soy', 'shellfish', 'egg'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },
  {
    dish_name: 'Pad Prik King',
    ingredients: [
      { name: 'pork belly', quantity: 250, unit: 'g' },
      { name: 'long beans', quantity: 150, unit: 'g' },
      { name: 'red curry paste', quantity: 40, unit: 'g' },
      { name: 'kaffir lime leaves', quantity: 4, unit: 'leaves' },
      { name: 'fish sauce', quantity: 20, unit: 'ml' },
      { name: 'palm sugar', quantity: 15, unit: 'g' },
      { name: 'vegetable oil', quantity: 30, unit: 'ml' }
    ],
    nutrition: { calories: 480, protein: 24, carbs: 18, fat: 36, fiber: 4, sugar: 10, sodium: 920 },
    allergens: ['fish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free', 'low-carb']
  },
  {
    dish_name: 'Crispy Pork Belly with Basil',
    ingredients: [
      { name: 'crispy pork belly', quantity: 300, unit: 'g' },
      { name: 'thai holy basil', quantity: 40, unit: 'g' },
      { name: 'thai chilies', quantity: 20, unit: 'g' },
      { name: 'garlic', quantity: 6, unit: 'cloves' },
      { name: 'oyster sauce', quantity: 25, unit: 'ml' },
      { name: 'fish sauce', quantity: 20, unit: 'ml' },
      { name: 'soy sauce', quantity: 15, unit: 'ml' },
      { name: 'sugar', quantity: 10, unit: 'g' },
      { name: 'jasmine rice', quantity: 200, unit: 'g' }
    ],
    nutrition: { calories: 720, protein: 32, carbs: 52, fat: 44, fiber: 2, sugar: 6, sodium: 1350 },
    allergens: ['fish', 'soy', 'shellfish'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free']
  },

  // === RICE DISHES ===
  {
    dish_name: 'Thai Fried Rice',
    ingredients: [
      { name: 'jasmine rice', quantity: 300, unit: 'g' },
      { name: 'shrimp', quantity: 100, unit: 'g' },
      { name: 'egg', quantity: 2, unit: 'whole' },
      { name: 'onion', quantity: 60, unit: 'g' },
      { name: 'tomatoes', quantity: 60, unit: 'g' },
      { name: 'green onion', quantity: 30, unit: 'g' },
      { name: 'fish sauce', quantity: 25, unit: 'ml' },
      { name: 'soy sauce', quantity: 15, unit: 'ml' },
      { name: 'white pepper', quantity: 2, unit: 'g' },
      { name: 'lime', quantity: 1, unit: 'wedge' },
      { name: 'cucumber', quantity: 40, unit: 'g' }
    ],
    nutrition: { calories: 480, protein: 22, carbs: 65, fat: 14, fiber: 2, sugar: 5, sodium: 1100 },
    allergens: ['shellfish', 'egg', 'fish', 'soy'],
    fodmap: ['high_fructan'],
    diet_tags: ['dairy-free', 'gluten-free']
  },

  // === DESSERTS & DRINKS ===
  {
    dish_name: 'Mango Sticky Rice',
    ingredients: [
      { name: 'sticky rice', quantity: 150, unit: 'g' },
      { name: 'ripe mango', quantity: 200, unit: 'g' },
      { name: 'coconut milk', quantity: 200, unit: 'ml' },
      { name: 'sugar', quantity: 60, unit: 'g' },
      { name: 'salt', quantity: 2, unit: 'g' },
      { name: 'toasted sesame seeds', quantity: 10, unit: 'g' },
      { name: 'mung beans', quantity: 20, unit: 'g' }
    ],
    nutrition: { calories: 480, protein: 6, carbs: 82, fat: 14, fiber: 3, sugar: 45, sodium: 180 },
    allergens: ['sesame'],
    fodmap: ['high_fructose', 'high_polyol'],
    diet_tags: ['vegan', 'dairy-free', 'gluten-free']
  },
  {
    dish_name: 'Thai Iced Tea',
    ingredients: [
      { name: 'thai tea mix', quantity: 30, unit: 'g' },
      { name: 'condensed milk', quantity: 50, unit: 'ml' },
      { name: 'evaporated milk', quantity: 30, unit: 'ml' },
      { name: 'sugar', quantity: 20, unit: 'g' },
      { name: 'hot water', quantity: 200, unit: 'ml' },
      { name: 'ice', quantity: 150, unit: 'g' }
    ],
    nutrition: { calories: 220, protein: 4, carbs: 38, fat: 6, fiber: 0, sugar: 36, sodium: 80 },
    allergens: ['milk'],
    fodmap: ['high_lactose'],
    diet_tags: ['vegetarian', 'gluten-free']
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
