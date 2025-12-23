#!/usr/bin/env node
/**
 * Glycemic Index Staging Script
 *
 * Curated GI/GL data based on:
 * - International Tables of Glycemic Index and Glycemic Load Values 2021
 * - University of Sydney GI Database (glycemicindex.com)
 *
 * Categories:
 *   - Low GI: ≤55
 *   - Medium GI: 56-69
 *   - High GI: ≥70
 *
 * OUTPUT: seed_data/out/glycemic_index.sql
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

function getGICategory(gi) {
  if (gi <= 55) return 'low';
  if (gi <= 69) return 'medium';
  return 'high';
}

// Curated Glycemic Index Database
// Format: { name, gi, gl (per serving), serving_g, carbs_per_serving_g }
// GL = (GI × carbs per serving) / 100
const GLYCEMIC_DATA = [
  // ============ BREADS & BAKERY ============
  { name: 'white bread', gi: 75, serving_g: 30, carbs: 14 },
  { name: 'whole wheat bread', gi: 74, serving_g: 30, carbs: 12 },
  { name: 'sourdough bread', gi: 54, serving_g: 30, carbs: 14 },
  { name: 'rye bread', gi: 56, serving_g: 30, carbs: 12 },
  { name: 'pumpernickel bread', gi: 50, serving_g: 30, carbs: 11 },
  { name: 'multigrain bread', gi: 53, serving_g: 30, carbs: 12 },
  { name: 'oat bread', gi: 65, serving_g: 30, carbs: 12 },
  { name: 'pita bread', gi: 68, serving_g: 30, carbs: 16 },
  { name: 'bagel', gi: 72, serving_g: 70, carbs: 35 },
  { name: 'croissant', gi: 67, serving_g: 57, carbs: 26 },
  { name: 'english muffin', gi: 77, serving_g: 57, carbs: 26 },
  { name: 'baguette', gi: 95, serving_g: 30, carbs: 15 },
  { name: 'ciabatta', gi: 73, serving_g: 50, carbs: 25 },
  { name: 'tortilla', gi: 52, serving_g: 50, carbs: 24 },
  { name: 'corn tortilla', gi: 46, serving_g: 24, carbs: 11 },
  { name: 'naan bread', gi: 71, serving_g: 90, carbs: 45 },
  { name: 'flatbread', gi: 69, serving_g: 30, carbs: 18 },

  // ============ CEREALS & BREAKFAST ============
  { name: 'cornflakes', gi: 81, serving_g: 30, carbs: 26 },
  { name: 'rice krispies', gi: 82, serving_g: 30, carbs: 27 },
  { name: 'cheerios', gi: 74, serving_g: 30, carbs: 20 },
  { name: 'special k', gi: 69, serving_g: 30, carbs: 22 },
  { name: 'bran flakes', gi: 74, serving_g: 30, carbs: 22 },
  { name: 'all bran', gi: 42, serving_g: 30, carbs: 22 },
  { name: 'muesli', gi: 56, serving_g: 30, carbs: 20 },
  { name: 'granola', gi: 66, serving_g: 50, carbs: 32 },
  { name: 'oatmeal', gi: 55, serving_g: 250, carbs: 27 },
  { name: 'instant oatmeal', gi: 79, serving_g: 250, carbs: 26 },
  { name: 'steel cut oats', gi: 52, serving_g: 250, carbs: 27 },
  { name: 'rolled oats', gi: 55, serving_g: 250, carbs: 27 },
  { name: 'cream of wheat', gi: 66, serving_g: 250, carbs: 25 },
  { name: 'grits', gi: 69, serving_g: 250, carbs: 31 },
  { name: 'pancakes', gi: 67, serving_g: 80, carbs: 23 },
  { name: 'waffles', gi: 76, serving_g: 75, carbs: 25 },
  { name: 'french toast', gi: 59, serving_g: 65, carbs: 16 },

  // ============ RICE & GRAINS ============
  { name: 'white rice', gi: 73, serving_g: 150, carbs: 36 },
  { name: 'brown rice', gi: 68, serving_g: 150, carbs: 33 },
  { name: 'basmati rice', gi: 58, serving_g: 150, carbs: 38 },
  { name: 'jasmine rice', gi: 89, serving_g: 150, carbs: 42 },
  { name: 'wild rice', gi: 45, serving_g: 150, carbs: 32 },
  { name: 'black rice', gi: 42, serving_g: 150, carbs: 34 },
  { name: 'arborio rice', gi: 69, serving_g: 150, carbs: 40 },
  { name: 'sushi rice', gi: 85, serving_g: 150, carbs: 37 },
  { name: 'sticky rice', gi: 87, serving_g: 150, carbs: 37 },
  { name: 'quinoa', gi: 53, serving_g: 150, carbs: 30 },
  { name: 'bulgur', gi: 48, serving_g: 150, carbs: 26 },
  { name: 'couscous', gi: 65, serving_g: 150, carbs: 35 },
  { name: 'barley', gi: 28, serving_g: 150, carbs: 32 },
  { name: 'pearl barley', gi: 28, serving_g: 150, carbs: 32 },
  { name: 'buckwheat', gi: 54, serving_g: 150, carbs: 30 },
  { name: 'millet', gi: 71, serving_g: 150, carbs: 33 },
  { name: 'amaranth', gi: 35, serving_g: 150, carbs: 29 },
  { name: 'freekeh', gi: 43, serving_g: 150, carbs: 28 },
  { name: 'farro', gi: 45, serving_g: 150, carbs: 30 },
  { name: 'spelt', gi: 54, serving_g: 150, carbs: 30 },
  { name: 'teff', gi: 57, serving_g: 150, carbs: 36 },
  { name: 'polenta', gi: 70, serving_g: 150, carbs: 30 },
  { name: 'cornmeal', gi: 69, serving_g: 100, carbs: 22 },

  // ============ PASTA & NOODLES ============
  { name: 'spaghetti', gi: 49, serving_g: 180, carbs: 44 },
  { name: 'whole wheat pasta', gi: 42, serving_g: 180, carbs: 37 },
  { name: 'penne', gi: 50, serving_g: 180, carbs: 43 },
  { name: 'linguine', gi: 52, serving_g: 180, carbs: 43 },
  { name: 'fettuccine', gi: 40, serving_g: 180, carbs: 45 },
  { name: 'macaroni', gi: 47, serving_g: 180, carbs: 44 },
  { name: 'lasagna', gi: 55, serving_g: 180, carbs: 42 },
  { name: 'egg noodles', gi: 40, serving_g: 180, carbs: 40 },
  { name: 'rice noodles', gi: 61, serving_g: 180, carbs: 44 },
  { name: 'udon noodles', gi: 55, serving_g: 180, carbs: 42 },
  { name: 'soba noodles', gi: 46, serving_g: 180, carbs: 35 },
  { name: 'ramen noodles', gi: 52, serving_g: 180, carbs: 38 },
  { name: 'glass noodles', gi: 39, serving_g: 180, carbs: 40 },
  { name: 'vermicelli', gi: 58, serving_g: 180, carbs: 42 },
  { name: 'gnocchi', gi: 68, serving_g: 180, carbs: 33 },
  { name: 'ravioli', gi: 39, serving_g: 180, carbs: 35 },
  { name: 'tortellini', gi: 50, serving_g: 180, carbs: 38 },

  // ============ LEGUMES & BEANS ============
  { name: 'lentils', gi: 32, serving_g: 150, carbs: 20 },
  { name: 'red lentils', gi: 26, serving_g: 150, carbs: 18 },
  { name: 'green lentils', gi: 30, serving_g: 150, carbs: 20 },
  { name: 'chickpeas', gi: 28, serving_g: 150, carbs: 24 },
  { name: 'black beans', gi: 30, serving_g: 150, carbs: 23 },
  { name: 'kidney beans', gi: 24, serving_g: 150, carbs: 22 },
  { name: 'navy beans', gi: 31, serving_g: 150, carbs: 25 },
  { name: 'pinto beans', gi: 39, serving_g: 150, carbs: 26 },
  { name: 'white beans', gi: 31, serving_g: 150, carbs: 25 },
  { name: 'lima beans', gi: 32, serving_g: 150, carbs: 20 },
  { name: 'cannellini beans', gi: 31, serving_g: 150, carbs: 24 },
  { name: 'black-eyed peas', gi: 42, serving_g: 150, carbs: 22 },
  { name: 'split peas', gi: 32, serving_g: 150, carbs: 21 },
  { name: 'green peas', gi: 48, serving_g: 80, carbs: 11 },
  { name: 'edamame', gi: 18, serving_g: 100, carbs: 8 },
  { name: 'soybeans', gi: 16, serving_g: 150, carbs: 10 },
  { name: 'hummus', gi: 6, serving_g: 30, carbs: 4 },
  { name: 'falafel', gi: 32, serving_g: 100, carbs: 20 },
  { name: 'baked beans', gi: 48, serving_g: 150, carbs: 21 },
  { name: 'refried beans', gi: 38, serving_g: 150, carbs: 23 },

  // ============ VEGETABLES ============
  { name: 'potato', gi: 78, serving_g: 150, carbs: 26 },
  { name: 'baked potato', gi: 85, serving_g: 150, carbs: 30 },
  { name: 'boiled potato', gi: 78, serving_g: 150, carbs: 26 },
  { name: 'mashed potato', gi: 83, serving_g: 150, carbs: 20 },
  { name: 'french fries', gi: 63, serving_g: 150, carbs: 44 },
  { name: 'hash browns', gi: 75, serving_g: 150, carbs: 35 },
  { name: 'sweet potato', gi: 63, serving_g: 150, carbs: 24 },
  { name: 'yam', gi: 37, serving_g: 150, carbs: 27 },
  { name: 'taro', gi: 55, serving_g: 150, carbs: 27 },
  { name: 'cassava', gi: 46, serving_g: 150, carbs: 38 },
  { name: 'plantain', gi: 55, serving_g: 150, carbs: 32 },
  { name: 'corn', gi: 52, serving_g: 80, carbs: 17 },
  { name: 'corn on the cob', gi: 48, serving_g: 150, carbs: 25 },
  { name: 'butternut squash', gi: 51, serving_g: 150, carbs: 13 },
  { name: 'acorn squash', gi: 44, serving_g: 150, carbs: 15 },
  { name: 'pumpkin', gi: 75, serving_g: 150, carbs: 6 },
  { name: 'carrots', gi: 39, serving_g: 80, carbs: 6 },
  { name: 'parsnip', gi: 52, serving_g: 80, carbs: 12 },
  { name: 'beets', gi: 64, serving_g: 80, carbs: 8 },
  { name: 'turnip', gi: 62, serving_g: 80, carbs: 5 },
  { name: 'rutabaga', gi: 72, serving_g: 150, carbs: 12 },
  // Low-carb vegetables (minimal glycemic impact)
  { name: 'broccoli', gi: 10, serving_g: 80, carbs: 4 },
  { name: 'cauliflower', gi: 10, serving_g: 80, carbs: 3 },
  { name: 'cabbage', gi: 10, serving_g: 80, carbs: 4 },
  { name: 'spinach', gi: 15, serving_g: 80, carbs: 1 },
  { name: 'kale', gi: 15, serving_g: 80, carbs: 2 },
  { name: 'lettuce', gi: 15, serving_g: 80, carbs: 1 },
  { name: 'cucumber', gi: 15, serving_g: 80, carbs: 2 },
  { name: 'tomato', gi: 15, serving_g: 80, carbs: 3 },
  { name: 'bell pepper', gi: 15, serving_g: 80, carbs: 5 },
  { name: 'zucchini', gi: 15, serving_g: 80, carbs: 3 },
  { name: 'eggplant', gi: 15, serving_g: 80, carbs: 4 },
  { name: 'green beans', gi: 15, serving_g: 80, carbs: 4 },
  { name: 'asparagus', gi: 15, serving_g: 80, carbs: 2 },
  { name: 'celery', gi: 15, serving_g: 80, carbs: 1 },
  { name: 'mushroom', gi: 15, serving_g: 80, carbs: 2 },
  { name: 'onion', gi: 15, serving_g: 80, carbs: 7 },

  // ============ FRUITS ============
  { name: 'apple', gi: 36, serving_g: 120, carbs: 15 },
  { name: 'banana', gi: 51, serving_g: 120, carbs: 25 },
  { name: 'ripe banana', gi: 62, serving_g: 120, carbs: 27 },
  { name: 'orange', gi: 43, serving_g: 120, carbs: 11 },
  { name: 'grapefruit', gi: 25, serving_g: 120, carbs: 9 },
  { name: 'grape', gi: 59, serving_g: 120, carbs: 18 },
  { name: 'strawberry', gi: 41, serving_g: 120, carbs: 7 },
  { name: 'blueberry', gi: 53, serving_g: 120, carbs: 15 },
  { name: 'raspberry', gi: 32, serving_g: 120, carbs: 7 },
  { name: 'blackberry', gi: 25, serving_g: 120, carbs: 6 },
  { name: 'cherry', gi: 22, serving_g: 120, carbs: 14 },
  { name: 'peach', gi: 42, serving_g: 120, carbs: 11 },
  { name: 'plum', gi: 39, serving_g: 120, carbs: 10 },
  { name: 'apricot', gi: 34, serving_g: 120, carbs: 8 },
  { name: 'nectarine', gi: 43, serving_g: 120, carbs: 11 },
  { name: 'pear', gi: 38, serving_g: 120, carbs: 15 },
  { name: 'mango', gi: 51, serving_g: 120, carbs: 17 },
  { name: 'papaya', gi: 60, serving_g: 120, carbs: 11 },
  { name: 'pineapple', gi: 59, serving_g: 120, carbs: 13 },
  { name: 'watermelon', gi: 76, serving_g: 120, carbs: 8 },
  { name: 'cantaloupe', gi: 65, serving_g: 120, carbs: 8 },
  { name: 'honeydew', gi: 65, serving_g: 120, carbs: 9 },
  { name: 'kiwi', gi: 50, serving_g: 120, carbs: 11 },
  { name: 'fig', gi: 61, serving_g: 60, carbs: 10 },
  { name: 'dates', gi: 42, serving_g: 60, carbs: 40 },
  { name: 'raisins', gi: 64, serving_g: 60, carbs: 47 },
  { name: 'dried apricot', gi: 30, serving_g: 60, carbs: 39 },
  { name: 'prunes', gi: 29, serving_g: 60, carbs: 38 },
  { name: 'cranberries', gi: 45, serving_g: 120, carbs: 12 },
  { name: 'pomegranate', gi: 53, serving_g: 120, carbs: 19 },
  { name: 'lychee', gi: 57, serving_g: 120, carbs: 16 },
  { name: 'persimmon', gi: 50, serving_g: 120, carbs: 19 },
  { name: 'guava', gi: 12, serving_g: 120, carbs: 8 },
  { name: 'passion fruit', gi: 30, serving_g: 100, carbs: 11 },
  { name: 'dragon fruit', gi: 48, serving_g: 120, carbs: 11 },
  { name: 'jackfruit', gi: 50, serving_g: 120, carbs: 24 },
  { name: 'durian', gi: 49, serving_g: 120, carbs: 27 },
  { name: 'avocado', gi: 15, serving_g: 150, carbs: 9 },
  { name: 'coconut', gi: 45, serving_g: 80, carbs: 6 },

  // ============ DAIRY & ALTERNATIVES ============
  { name: 'milk', gi: 39, serving_g: 250, carbs: 12 },
  { name: 'skim milk', gi: 37, serving_g: 250, carbs: 12 },
  { name: 'whole milk', gi: 41, serving_g: 250, carbs: 12 },
  { name: 'chocolate milk', gi: 43, serving_g: 250, carbs: 26 },
  { name: 'yogurt', gi: 41, serving_g: 200, carbs: 9 },
  { name: 'greek yogurt', gi: 11, serving_g: 200, carbs: 6 },
  { name: 'fruit yogurt', gi: 41, serving_g: 200, carbs: 27 },
  { name: 'ice cream', gi: 51, serving_g: 50, carbs: 13 },
  { name: 'frozen yogurt', gi: 47, serving_g: 100, carbs: 24 },
  { name: 'soy milk', gi: 34, serving_g: 250, carbs: 8 },
  { name: 'almond milk', gi: 25, serving_g: 250, carbs: 1 },
  { name: 'oat milk', gi: 69, serving_g: 250, carbs: 16 },
  { name: 'rice milk', gi: 86, serving_g: 250, carbs: 23 },
  { name: 'coconut milk', gi: 41, serving_g: 250, carbs: 6 },
  { name: 'custard', gi: 43, serving_g: 100, carbs: 17 },
  { name: 'pudding', gi: 47, serving_g: 100, carbs: 20 },

  // ============ SWEETENERS & SUGARS ============
  { name: 'sugar', gi: 65, serving_g: 10, carbs: 10 },
  { name: 'brown sugar', gi: 64, serving_g: 10, carbs: 10 },
  { name: 'honey', gi: 61, serving_g: 21, carbs: 17 },
  { name: 'maple syrup', gi: 54, serving_g: 20, carbs: 13 },
  { name: 'agave nectar', gi: 15, serving_g: 21, carbs: 16 },
  { name: 'corn syrup', gi: 90, serving_g: 20, carbs: 17 },
  { name: 'molasses', gi: 55, serving_g: 20, carbs: 15 },
  { name: 'coconut sugar', gi: 35, serving_g: 10, carbs: 10 },
  { name: 'stevia', gi: 0, serving_g: 1, carbs: 0 },
  { name: 'erythritol', gi: 0, serving_g: 10, carbs: 4 },
  { name: 'xylitol', gi: 7, serving_g: 10, carbs: 10 },
  { name: 'maltitol', gi: 35, serving_g: 10, carbs: 9 },

  // ============ SNACKS & CRACKERS ============
  { name: 'popcorn', gi: 65, serving_g: 20, carbs: 13 },
  { name: 'potato chips', gi: 56, serving_g: 50, carbs: 26 },
  { name: 'corn chips', gi: 63, serving_g: 50, carbs: 31 },
  { name: 'pretzels', gi: 83, serving_g: 30, carbs: 23 },
  { name: 'rice cakes', gi: 82, serving_g: 25, carbs: 20 },
  { name: 'crackers', gi: 74, serving_g: 30, carbs: 21 },
  { name: 'graham crackers', gi: 74, serving_g: 30, carbs: 22 },
  { name: 'whole wheat crackers', gi: 67, serving_g: 30, carbs: 18 },
  { name: 'oatcakes', gi: 57, serving_g: 30, carbs: 18 },
  { name: 'rice crackers', gi: 91, serving_g: 30, carbs: 25 },
  { name: 'water crackers', gi: 78, serving_g: 25, carbs: 18 },
  { name: 'trail mix', gi: 49, serving_g: 50, carbs: 25 },
  { name: 'granola bar', gi: 61, serving_g: 40, carbs: 28 },
  { name: 'protein bar', gi: 38, serving_g: 60, carbs: 22 },

  // ============ BAKED GOODS & DESSERTS ============
  { name: 'cake', gi: 67, serving_g: 80, carbs: 46 },
  { name: 'pound cake', gi: 54, serving_g: 80, carbs: 42 },
  { name: 'angel food cake', gi: 67, serving_g: 50, carbs: 29 },
  { name: 'chocolate cake', gi: 52, serving_g: 100, carbs: 52 },
  { name: 'cheesecake', gi: 32, serving_g: 100, carbs: 25 },
  { name: 'muffin', gi: 60, serving_g: 80, carbs: 44 },
  { name: 'blueberry muffin', gi: 59, serving_g: 80, carbs: 42 },
  { name: 'bran muffin', gi: 60, serving_g: 80, carbs: 34 },
  { name: 'donut', gi: 76, serving_g: 75, carbs: 34 },
  { name: 'brownie', gi: 42, serving_g: 60, carbs: 36 },
  { name: 'cookie', gi: 68, serving_g: 30, carbs: 20 },
  { name: 'chocolate chip cookie', gi: 55, serving_g: 30, carbs: 19 },
  { name: 'oatmeal cookie', gi: 55, serving_g: 30, carbs: 18 },
  { name: 'shortbread', gi: 64, serving_g: 30, carbs: 19 },
  { name: 'pie', gi: 63, serving_g: 120, carbs: 43 },
  { name: 'apple pie', gi: 41, serving_g: 120, carbs: 40 },
  { name: 'pumpkin pie', gi: 44, serving_g: 120, carbs: 28 },
  { name: 'scone', gi: 92, serving_g: 60, carbs: 28 },
  { name: 'danish pastry', gi: 59, serving_g: 70, carbs: 33 },

  // ============ BEVERAGES ============
  { name: 'orange juice', gi: 50, serving_g: 250, carbs: 26 },
  { name: 'apple juice', gi: 41, serving_g: 250, carbs: 29 },
  { name: 'grape juice', gi: 48, serving_g: 250, carbs: 38 },
  { name: 'cranberry juice', gi: 56, serving_g: 250, carbs: 31 },
  { name: 'grapefruit juice', gi: 48, serving_g: 250, carbs: 22 },
  { name: 'tomato juice', gi: 38, serving_g: 250, carbs: 10 },
  { name: 'carrot juice', gi: 43, serving_g: 250, carbs: 22 },
  { name: 'smoothie', gi: 45, serving_g: 250, carbs: 30 },
  { name: 'cola', gi: 63, serving_g: 250, carbs: 26 },
  { name: 'lemonade', gi: 54, serving_g: 250, carbs: 27 },
  { name: 'sports drink', gi: 78, serving_g: 250, carbs: 15 },
  { name: 'energy drink', gi: 68, serving_g: 250, carbs: 27 },
  { name: 'beer', gi: 66, serving_g: 355, carbs: 13 },
  { name: 'wine', gi: 0, serving_g: 150, carbs: 4 },

  // ============ NUTS & SEEDS (Low GI) ============
  { name: 'almonds', gi: 0, serving_g: 30, carbs: 6 },
  { name: 'walnuts', gi: 0, serving_g: 30, carbs: 4 },
  { name: 'cashews', gi: 22, serving_g: 30, carbs: 9 },
  { name: 'peanuts', gi: 14, serving_g: 30, carbs: 5 },
  { name: 'pistachios', gi: 15, serving_g: 30, carbs: 8 },
  { name: 'pecans', gi: 10, serving_g: 30, carbs: 4 },
  { name: 'macadamia nuts', gi: 10, serving_g: 30, carbs: 4 },
  { name: 'hazelnuts', gi: 15, serving_g: 30, carbs: 5 },
  { name: 'brazil nuts', gi: 10, serving_g: 30, carbs: 4 },
  { name: 'pine nuts', gi: 15, serving_g: 30, carbs: 4 },
  { name: 'sunflower seeds', gi: 35, serving_g: 30, carbs: 6 },
  { name: 'pumpkin seeds', gi: 10, serving_g: 30, carbs: 4 },
  { name: 'chia seeds', gi: 1, serving_g: 30, carbs: 12 },
  { name: 'flaxseed', gi: 0, serving_g: 15, carbs: 4 },
  { name: 'sesame seeds', gi: 35, serving_g: 30, carbs: 7 },
  { name: 'peanut butter', gi: 14, serving_g: 32, carbs: 6 },
  { name: 'almond butter', gi: 10, serving_g: 32, carbs: 6 },

  // ============ PROTEINS (Minimal GI) ============
  { name: 'egg', gi: 0, serving_g: 50, carbs: 0.5 },
  { name: 'chicken', gi: 0, serving_g: 100, carbs: 0 },
  { name: 'beef', gi: 0, serving_g: 100, carbs: 0 },
  { name: 'pork', gi: 0, serving_g: 100, carbs: 0 },
  { name: 'fish', gi: 0, serving_g: 100, carbs: 0 },
  { name: 'salmon', gi: 0, serving_g: 100, carbs: 0 },
  { name: 'tuna', gi: 0, serving_g: 100, carbs: 0 },
  { name: 'shrimp', gi: 0, serving_g: 100, carbs: 0 },
  { name: 'tofu', gi: 15, serving_g: 100, carbs: 2 },
  { name: 'tempeh', gi: 15, serving_g: 100, carbs: 9 },

  // ============ CONDIMENTS & SAUCES ============
  { name: 'ketchup', gi: 55, serving_g: 17, carbs: 4 },
  { name: 'bbq sauce', gi: 48, serving_g: 35, carbs: 14 },
  { name: 'teriyaki sauce', gi: 50, serving_g: 30, carbs: 8 },
  { name: 'sweet chili sauce', gi: 52, serving_g: 30, carbs: 15 },
  { name: 'hoisin sauce', gi: 50, serving_g: 30, carbs: 12 },
  { name: 'jam', gi: 51, serving_g: 30, carbs: 20 },
  { name: 'marmalade', gi: 48, serving_g: 30, carbs: 18 },
  { name: 'nutella', gi: 33, serving_g: 37, carbs: 22 },
];

function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          Glycemic Index Database Generator                ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('Source: International Tables of Glycemic Index 2021');
  console.log('        University of Sydney GI Database\n');

  const outPath = path.join(OUT_DIR, 'glycemic_index.sql');
  const out = fs.createWriteStream(outPath);

  out.write('-- Glycemic Index Database\n');
  out.write('-- Generated: ' + new Date().toISOString() + '\n');
  out.write('-- Source: International Tables of Glycemic Index and Glycemic Load Values 2021\n');
  out.write('--         University of Sydney GI Database (glycemicindex.com)\n\n');

  let totalRecords = 0;
  const categories = { low: 0, medium: 0, high: 0 };

  for (const item of GLYCEMIC_DATA) {
    const gi = item.gi;
    const gl = Math.round((gi * item.carbs) / 100 * 10) / 10; // GL = (GI × carbs) / 100
    const category = getGICategory(gi);
    categories[category]++;

    const ingredientName = item.name.toLowerCase();

    out.write(`INSERT OR IGNORE INTO ingredient_glycemic (ingredient_id, glycemic_index, glycemic_load, serving_size_g, gi_category, source, source_url) SELECT i.id, ${gi}, ${gl}, ${item.serving_g}, ${sqlEscape(category)}, 'international_tables_2021', 'https://glycemicindex.com' FROM ingredients i WHERE i.canonical_name = ${sqlEscape(ingredientName)};\n`);

    totalRecords++;
  }

  out.end();

  console.log(`Generated ${totalRecords} glycemic index records`);
  console.log(`\nGI Categories:`);
  console.log(`  - Low (≤55):    ${categories.low} foods`);
  console.log(`  - Medium (56-69): ${categories.medium} foods`);
  console.log(`  - High (≥70):   ${categories.high} foods`);
  console.log(`\nOutput: ${outPath}`);
  console.log('\n✅ Done! Run split_sql.js then import to D1.');
}

main();
