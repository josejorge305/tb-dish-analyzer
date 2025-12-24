#!/usr/bin/env node
/**
 * Seed Canonical Dish Aliases
 *
 * This script generates SQL to populate the dish_canonicals and dish_aliases tables.
 * Run: node seed_data/scripts/seed_canonical_dishes.js
 *
 * To import to D1:
 *   npx wrangler d1 execute tb-database --remote --file seed_data/staging/canonical_dishes.sql
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// NORMALIZATION FUNCTION (must match index.js)
// ============================================

/**
 * Normalize a dish name for canonical matching.
 * This function MUST match the normalizeDishNameCanonical() in index.js
 */
function normalizeDishName(input) {
  if (!input) return '';

  let s = String(input);

  // 1. Trim and lowercase
  s = s.trim().toLowerCase();

  // 2. Unicode normalize NFKD + strip diacritics (ragù -> ragu)
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

  // 3. Replace common abbreviations
  s = s.replace(/\bw\//g, 'with');
  s = s.replace(/\s*&\s*/g, ' and ');

  // 4. Remove parenthetical marketing text like (gf), (spicy), (v), (vg), (new!)
  s = s.replace(/\([^)]*\)/g, '');

  // 5. Remove punctuation except spaces; collapse whitespace
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ');

  // 6. Remove menu fluff tokens (whole words only)
  const fluffTokens = [
    'chef', 'chefs', 'signature', 'house', 'style', 'famous', 'special', 'classic',
    'homemade', 'handmade', 'artisan', 'artisanal', 'authentic', 'traditional',
    'our', 'the', 'a', 'an', 'fresh', 'freshly', 'made', 'prepared',
    'served', 'topped', 'drizzled', 'garnished', 'featuring', 'with',
    'new', 'seasonal', 'limited', 'award', 'winning', 'world', 'best'
  ];

  const words = s.split(' ').filter(w => w && !fluffTokens.includes(w));
  s = words.join(' ');

  return s.trim();
}

// ============================================
// CANONICAL DISHES DATA
// ============================================

const canonicalDishes = [
  // === ITALIAN ===
  {
    canonical_id: 'DISH_ITALY_PASTA_CARBONARA',
    canonical_name: 'Pasta Carbonara',
    cuisine: 'Italian',
    course: 'entree',
    tags: ['pasta', 'pork', 'egg', 'cheese'],
    aliases: [
      'spaghetti carbonara',
      'carbonara',
      'rigatoni carbonara',
      'pasta carbonara',
      'carbonara spaghetti',
      'fettuccine carbonara',
      'bucatini carbonara',
      'carbonara pasta'
    ]
  },
  {
    canonical_id: 'DISH_ITALY_PASTA_CACIO_E_PEPE',
    canonical_name: 'Cacio e Pepe',
    cuisine: 'Italian',
    course: 'entree',
    tags: ['pasta', 'cheese', 'pepper'],
    aliases: [
      'cacio e pepe',
      'cacio pepe',
      'cheese and pepper pasta',
      'pecorino pepper pasta',
      'cacio e pepe pasta',
      'spaghetti cacio e pepe'
    ]
  },
  {
    canonical_id: 'DISH_ITALY_PIZZA_MARGHERITA',
    canonical_name: 'Pizza Margherita',
    cuisine: 'Italian',
    course: 'entree',
    tags: ['pizza', 'cheese', 'tomato', 'basil'],
    aliases: [
      'margherita pizza',
      'pizza margherita',
      'classic margherita',
      'margherita',
      'margarita pizza',
      'pizza margarita'
    ]
  },
  {
    canonical_id: 'DISH_ITALY_PASTA_BOLOGNESE',
    canonical_name: 'Pasta Bolognese',
    cuisine: 'Italian',
    course: 'entree',
    tags: ['pasta', 'beef', 'tomato', 'meat sauce'],
    aliases: [
      'spaghetti bolognese',
      'bolognese',
      'ragu alla bolognese',
      'ragu bolognese',
      'pasta bolognese',
      'tagliatelle bolognese',
      'meat sauce pasta',
      'spag bol'
    ]
  },
  {
    canonical_id: 'DISH_ITALY_LASAGNA',
    canonical_name: 'Lasagna',
    cuisine: 'Italian',
    course: 'entree',
    tags: ['pasta', 'beef', 'cheese', 'tomato', 'baked'],
    aliases: [
      'lasagna',
      'lasagne',
      'beef lasagna',
      'meat lasagna',
      'lasagna bolognese',
      'classic lasagna'
    ]
  },

  // === MEXICAN ===
  {
    canonical_id: 'DISH_MEXICO_TACOS_AL_PASTOR',
    canonical_name: 'Tacos al Pastor',
    cuisine: 'Mexican',
    course: 'entree',
    tags: ['tacos', 'pork', 'pineapple'],
    aliases: [
      'tacos al pastor',
      'al pastor tacos',
      'pastor tacos',
      'tacos pastor',
      'al pastor',
      'taco al pastor'
    ]
  },
  {
    canonical_id: 'DISH_MEXICO_ENCHILADAS',
    canonical_name: 'Enchiladas',
    cuisine: 'Mexican',
    course: 'entree',
    tags: ['tortilla', 'cheese', 'sauce'],
    aliases: [
      'enchiladas',
      'enchiladas verdes',
      'enchiladas rojas',
      'enchiladas suizas',
      'chicken enchiladas',
      'beef enchiladas',
      'cheese enchiladas'
    ]
  },
  {
    canonical_id: 'DISH_MEXICO_TACOS_CARNITAS',
    canonical_name: 'Tacos de Carnitas',
    cuisine: 'Mexican',
    course: 'entree',
    tags: ['tacos', 'pork', 'braised'],
    aliases: [
      'carnitas tacos',
      'tacos carnitas',
      'tacos de carnitas',
      'carnitas',
      'pork carnitas tacos'
    ]
  },
  {
    canonical_id: 'DISH_MEXICO_BURRITO',
    canonical_name: 'Burrito',
    cuisine: 'Mexican',
    course: 'entree',
    tags: ['tortilla', 'rice', 'beans', 'meat'],
    aliases: [
      'burrito',
      'burritos',
      'chicken burrito',
      'beef burrito',
      'carnitas burrito',
      'steak burrito',
      'carne asada burrito'
    ]
  },
  {
    canonical_id: 'DISH_MEXICO_GUACAMOLE',
    canonical_name: 'Guacamole',
    cuisine: 'Mexican',
    course: 'appetizer',
    tags: ['avocado', 'dip', 'fresh'],
    aliases: [
      'guacamole',
      'guac',
      'tableside guacamole',
      'fresh guacamole',
      'avocado dip'
    ]
  },

  // === JAPANESE ===
  {
    canonical_id: 'DISH_JAPAN_RAMEN_TONKOTSU',
    canonical_name: 'Tonkotsu Ramen',
    cuisine: 'Japanese',
    course: 'entree',
    tags: ['ramen', 'pork', 'noodles', 'broth'],
    aliases: [
      'tonkotsu ramen',
      'pork broth ramen',
      'hakata ramen',
      'kyushu ramen',
      'tonkotsu',
      'pork bone ramen',
      'creamy pork ramen'
    ]
  },
  {
    canonical_id: 'DISH_JAPAN_SUSHI_NIGIRI',
    canonical_name: 'Nigiri Sushi',
    cuisine: 'Japanese',
    course: 'entree',
    tags: ['sushi', 'fish', 'rice'],
    aliases: [
      'nigiri',
      'nigiri sushi',
      'assorted nigiri',
      'sushi nigiri',
      'nigiri set',
      'nigiri platter'
    ]
  },
  {
    canonical_id: 'DISH_JAPAN_RAMEN_SHOYU',
    canonical_name: 'Shoyu Ramen',
    cuisine: 'Japanese',
    course: 'entree',
    tags: ['ramen', 'soy sauce', 'noodles', 'broth'],
    aliases: [
      'shoyu ramen',
      'soy sauce ramen',
      'soy ramen',
      'tokyo ramen',
      'classic ramen'
    ]
  },
  {
    canonical_id: 'DISH_JAPAN_TEMPURA',
    canonical_name: 'Tempura',
    cuisine: 'Japanese',
    course: 'appetizer',
    tags: ['fried', 'battered', 'vegetables', 'shrimp'],
    aliases: [
      'tempura',
      'vegetable tempura',
      'shrimp tempura',
      'mixed tempura',
      'tempura combo',
      'ebi tempura'
    ]
  },

  // === CHINESE ===
  {
    canonical_id: 'DISH_CHINA_MAPO_TOFU',
    canonical_name: 'Mapo Tofu',
    cuisine: 'Chinese',
    course: 'entree',
    tags: ['tofu', 'pork', 'spicy', 'sichuan'],
    aliases: [
      'mapo tofu',
      'ma po tofu',
      'mapo doufu',
      'mapo bean curd',
      'spicy tofu',
      'sichuan tofu',
      'ma po doufu'
    ]
  },
  {
    canonical_id: 'DISH_CHINA_KUNG_PAO_CHICKEN',
    canonical_name: 'Kung Pao Chicken',
    cuisine: 'Chinese',
    course: 'entree',
    tags: ['chicken', 'peanuts', 'spicy', 'sichuan'],
    aliases: [
      'kung pao chicken',
      'gong bao chicken',
      'kung po chicken',
      'kungpao chicken',
      'kung pao',
      'gong bao ji ding'
    ]
  },
  {
    canonical_id: 'DISH_CHINA_DIM_SUM',
    canonical_name: 'Dim Sum',
    cuisine: 'Chinese',
    course: 'appetizer',
    tags: ['dumplings', 'steamed', 'cantonese'],
    aliases: [
      'dim sum',
      'dimsum',
      'yum cha',
      'dim sum platter',
      'assorted dim sum'
    ]
  },
  {
    canonical_id: 'DISH_CHINA_PEKING_DUCK',
    canonical_name: 'Peking Duck',
    cuisine: 'Chinese',
    course: 'entree',
    tags: ['duck', 'roasted', 'beijing'],
    aliases: [
      'peking duck',
      'beijing duck',
      'roast duck',
      'crispy duck',
      'peking roast duck'
    ]
  },

  // === KOREAN ===
  {
    canonical_id: 'DISH_KOREA_BIBIMBAP',
    canonical_name: 'Bibimbap',
    cuisine: 'Korean',
    course: 'entree',
    tags: ['rice', 'vegetables', 'egg', 'gochujang'],
    aliases: [
      'bibimbap',
      'bi bim bap',
      'stone bowl bibimbap',
      'dolsot bibimbap',
      'bibim bap',
      'korean rice bowl'
    ]
  },
  {
    canonical_id: 'DISH_KOREA_BULGOGI',
    canonical_name: 'Bulgogi',
    cuisine: 'Korean',
    course: 'entree',
    tags: ['beef', 'grilled', 'marinated'],
    aliases: [
      'bulgogi',
      'korean bbq beef',
      'beef bulgogi',
      'bulgogi beef',
      'grilled bulgogi'
    ]
  },
  {
    canonical_id: 'DISH_KOREA_KIMCHI_JJIGAE',
    canonical_name: 'Kimchi Jjigae',
    cuisine: 'Korean',
    course: 'entree',
    tags: ['stew', 'kimchi', 'pork', 'spicy'],
    aliases: [
      'kimchi jjigae',
      'kimchi stew',
      'kimchi soup',
      'kimchee stew',
      'kimchi jigae'
    ]
  },

  // === THAI ===
  {
    canonical_id: 'DISH_THAI_PAD_THAI',
    canonical_name: 'Pad Thai',
    cuisine: 'Thai',
    course: 'entree',
    tags: ['noodles', 'stir-fried', 'peanuts', 'shrimp'],
    aliases: [
      'pad thai',
      'phad thai',
      'pad-thai',
      'thai stir fried noodles',
      'padthai',
      'phat thai',
      'chicken pad thai',
      'shrimp pad thai'
    ]
  },
  {
    canonical_id: 'DISH_THAI_GREEN_CURRY',
    canonical_name: 'Thai Green Curry',
    cuisine: 'Thai',
    course: 'entree',
    tags: ['curry', 'coconut', 'spicy', 'chicken'],
    aliases: [
      'green curry',
      'thai green curry',
      'gang keow wan',
      'chicken green curry',
      'green curry chicken'
    ]
  },
  {
    canonical_id: 'DISH_THAI_TOM_YUM',
    canonical_name: 'Tom Yum',
    cuisine: 'Thai',
    course: 'appetizer',
    tags: ['soup', 'spicy', 'sour', 'shrimp'],
    aliases: [
      'tom yum',
      'tom yum soup',
      'tom yum goong',
      'tom yam',
      'hot and sour soup',
      'tom yum kung'
    ]
  },

  // === INDIAN ===
  {
    canonical_id: 'DISH_INDIA_BUTTER_CHICKEN',
    canonical_name: 'Butter Chicken',
    cuisine: 'Indian',
    course: 'entree',
    tags: ['chicken', 'curry', 'creamy', 'tomato'],
    aliases: [
      'butter chicken',
      'murgh makhani',
      'chicken makhani',
      'makhani chicken'
    ]
  },
  {
    canonical_id: 'DISH_INDIA_TIKKA_MASALA',
    canonical_name: 'Chicken Tikka Masala',
    cuisine: 'Indian',
    course: 'entree',
    tags: ['chicken', 'curry', 'creamy', 'tomato'],
    aliases: [
      'chicken tikka masala',
      'tikka masala',
      'ctm',
      'chicken tikka',
      'tikka masala chicken'
    ]
  },
  {
    canonical_id: 'DISH_INDIA_BIRYANI',
    canonical_name: 'Biryani',
    cuisine: 'Indian',
    course: 'entree',
    tags: ['rice', 'spiced', 'meat', 'aromatic'],
    aliases: [
      'biryani',
      'chicken biryani',
      'lamb biryani',
      'goat biryani',
      'hyderabadi biryani',
      'dum biryani'
    ]
  },

  // === VIETNAMESE ===
  {
    canonical_id: 'DISH_VIETNAM_PHO',
    canonical_name: 'Pho',
    cuisine: 'Vietnamese',
    course: 'entree',
    tags: ['soup', 'noodles', 'beef', 'broth'],
    aliases: [
      'pho',
      'pho bo',
      'beef pho',
      'vietnamese pho',
      'pho ga',
      'chicken pho',
      'pho noodle soup'
    ]
  },
  {
    canonical_id: 'DISH_VIETNAM_BANH_MI',
    canonical_name: 'Banh Mi',
    cuisine: 'Vietnamese',
    course: 'entree',
    tags: ['sandwich', 'pork', 'pickled vegetables'],
    aliases: [
      'banh mi',
      'bahn mi',
      'vietnamese sandwich',
      'banh mi sandwich',
      'pork banh mi'
    ]
  },

  // === AMERICAN ===
  {
    canonical_id: 'DISH_USA_CHEESEBURGER',
    canonical_name: 'Cheeseburger',
    cuisine: 'American',
    course: 'entree',
    tags: ['beef', 'cheese', 'burger', 'sandwich'],
    aliases: [
      'cheeseburger',
      'cheese burger',
      'classic cheeseburger',
      'double cheeseburger',
      'bacon cheeseburger'
    ]
  },
  {
    canonical_id: 'DISH_USA_MAC_AND_CHEESE',
    canonical_name: 'Mac and Cheese',
    cuisine: 'American',
    course: 'entree',
    tags: ['pasta', 'cheese', 'comfort food'],
    aliases: [
      'mac and cheese',
      'mac n cheese',
      'macaroni and cheese',
      'baked mac and cheese',
      'mac cheese'
    ]
  },
  {
    canonical_id: 'DISH_USA_BBQ_RIBS',
    canonical_name: 'BBQ Ribs',
    cuisine: 'American',
    course: 'entree',
    tags: ['pork', 'bbq', 'grilled', 'smoked'],
    aliases: [
      'bbq ribs',
      'barbecue ribs',
      'baby back ribs',
      'spare ribs',
      'pork ribs',
      'smoked ribs'
    ]
  },

  // === FRENCH ===
  {
    canonical_id: 'DISH_FRANCE_CROISSANT',
    canonical_name: 'Croissant',
    cuisine: 'French',
    course: 'breakfast',
    tags: ['pastry', 'buttery', 'flaky'],
    aliases: [
      'croissant',
      'butter croissant',
      'plain croissant',
      'french croissant'
    ]
  },
  {
    canonical_id: 'DISH_FRANCE_COQAUVIN',
    canonical_name: 'Coq au Vin',
    cuisine: 'French',
    course: 'entree',
    tags: ['chicken', 'wine', 'braised'],
    aliases: [
      'coq au vin',
      'chicken in wine',
      'coq au vin rouge'
    ]
  },
  {
    canonical_id: 'DISH_FRANCE_CREPES',
    canonical_name: 'Crepes',
    cuisine: 'French',
    course: 'dessert',
    tags: ['pancake', 'thin', 'sweet'],
    aliases: [
      'crepes',
      'crepe',
      'french crepes',
      'sweet crepes',
      'nutella crepes'
    ]
  }
];

// ============================================
// SQL GENERATION
// ============================================

function escapeSQL(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

function generateSQL() {
  const statements = [];

  // Add header
  statements.push('-- Canonical Dish Aliases Seed Data');
  statements.push('-- Generated: ' + new Date().toISOString());
  statements.push('-- Run with: npx wrangler d1 execute tb-database --remote --file seed_data/staging/canonical_dishes.sql');
  statements.push('');

  // Insert canonicals
  statements.push('-- ============================================');
  statements.push('-- INSERT CANONICAL DISHES');
  statements.push('-- ============================================');
  statements.push('');

  for (const dish of canonicalDishes) {
    const tagsJson = dish.tags ? JSON.stringify(dish.tags) : null;
    statements.push(`INSERT OR REPLACE INTO dish_canonicals (canonical_id, canonical_name, cuisine, course, tags_json) VALUES (${escapeSQL(dish.canonical_id)}, ${escapeSQL(dish.canonical_name)}, ${escapeSQL(dish.cuisine)}, ${escapeSQL(dish.course || null)}, ${escapeSQL(tagsJson)});`);
  }

  statements.push('');
  statements.push('-- ============================================');
  statements.push('-- INSERT ALIASES');
  statements.push('-- ============================================');
  statements.push('');

  // Insert aliases
  for (const dish of canonicalDishes) {
    statements.push(`-- Aliases for ${dish.canonical_name}`);

    // Add the canonical name itself as an alias
    const canonicalNorm = normalizeDishName(dish.canonical_name);
    statements.push(`INSERT OR REPLACE INTO dish_aliases (alias_norm, locale, canonical_id, raw_alias, confidence, match_type) VALUES (${escapeSQL(canonicalNorm)}, 'en', ${escapeSQL(dish.canonical_id)}, ${escapeSQL(dish.canonical_name)}, 1.0, 'exact');`);

    // Add all aliases
    for (const alias of dish.aliases) {
      const aliasNorm = normalizeDishName(alias);
      // Skip if same as canonical (already added)
      if (aliasNorm !== canonicalNorm) {
        statements.push(`INSERT OR REPLACE INTO dish_aliases (alias_norm, locale, canonical_id, raw_alias, confidence, match_type) VALUES (${escapeSQL(aliasNorm)}, 'en', ${escapeSQL(dish.canonical_id)}, ${escapeSQL(alias)}, 1.0, 'exact');`);
      }
    }
    statements.push('');
  }

  return statements.join('\n');
}

// ============================================
// MAIN
// ============================================

function main() {
  console.log('=== Generating Canonical Dish Aliases SQL ===\n');

  const sql = generateSQL();

  // Ensure staging directory exists
  const stagingDir = path.join(__dirname, '..', 'staging');
  if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir, { recursive: true });
  }

  // Write SQL file
  const outputPath = path.join(stagingDir, 'canonical_dishes.sql');
  fs.writeFileSync(outputPath, sql);

  // Count stats
  const canonicalCount = canonicalDishes.length;
  const aliasCount = canonicalDishes.reduce((sum, d) => sum + d.aliases.length + 1, 0); // +1 for canonical name

  console.log(`Total canonical dishes: ${canonicalCount}`);
  console.log(`Total aliases: ${aliasCount}`);
  console.log(`\nGenerated: ${outputPath}`);
  console.log('\nTo import to D1 (remote):');
  console.log('  npx wrangler d1 execute tb-database --remote --file seed_data/staging/canonical_dishes.sql');
  console.log('\nTo import to D1 (local):');
  console.log('  npx wrangler d1 execute tb-database --local --file seed_data/staging/canonical_dishes.sql');
}

// Export for use in other scripts
module.exports = { normalizeDishName, canonicalDishes };

main();
