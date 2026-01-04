const fs = require("fs");
const https = require("https");

/**
 * Menu Judge v2 - AI-Powered Menu Adjudication
 *
 * Reconciles menu data from multiple sources:
 * - Uber Eats (published_menu.json)
 * - Restaurant Website (website_menu_extracted.json)
 *
 * Uses GPT-4o-mini for intelligent merging decisions.
 */

const CANONICAL_CATEGORIES = [
  "appetizers", "mains", "sides", "desserts",
  "drinks", "combos", "kids", "catering"
];

// Category mapping from common section names
const CATEGORY_MAP = {
  // Appetizers
  "appetizer": "appetizers", "starter": "appetizers", "small plate": "appetizers",
  "shareables": "appetizers", "snack": "appetizers",
  // Mains
  "entree": "mains", "main": "mains", "dinner": "mains", "lunch": "mains",
  "burger": "mains", "sandwich": "mains", "wrap": "mains", "taco": "mains",
  "pizza": "mains", "pasta": "mains", "chicken": "mains", "beef": "mains",
  "seafood": "mains", "steak": "mains", "wings": "mains",
  // Sides
  "side": "sides", "fries": "sides", "onion ring": "sides",
  // Desserts
  "dessert": "desserts", "sweet": "desserts", "shake": "desserts",
  "ice cream": "desserts", "cookie": "desserts",
  // Combos
  "combo": "combos", "meal": "combos", "bundle": "combos", "box": "combos",
  // Kids
  "kid": "kids", "child": "kids", "junior": "kids",
  // Catering
  "catering": "catering", "party": "catering", "tray": "catering"
};

/**
 * Call GPT-4o-mini API
 */
async function callGPT(systemPrompt, userPrompt, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const options = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else {
            const content = parsed.choices?.[0]?.message?.content || "{}";
            resolve(JSON.parse(content));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Normalize item name for comparison
 */
function normalizeName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculate string similarity (Jaccard on words)
 */
function nameSimilarity(name1, name2) {
  const words1 = new Set(normalizeName(name1).split(" ").filter(w => w.length > 1));
  const words2 = new Set(normalizeName(name2).split(" ").filter(w => w.length > 1));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return intersection / union;
}

/**
 * Map section name to canonical category
 */
function mapToCategory(sectionName) {
  if (!sectionName) return { category: "mains", flagged: true };

  const lower = sectionName.toLowerCase();

  for (const [pattern, category] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(pattern)) {
      return { category, flagged: false };
    }
  }

  return { category: "mains", flagged: true };
}

/**
 * Check if item is likely non-food (utensils, fees, etc.)
 */
function isNonFoodItem(name) {
  const nonFoodPatterns = [
    /utensil/i, /napkin/i, /straw/i, /bag/i,
    /fee/i, /delivery/i, /service/i, /tip/i,
    /extra sauce/i, /side of sauce/i,
    /cutlery/i, /fork/i, /knife/i, /spoon/i
  ];

  return nonFoodPatterns.some(p => p.test(name));
}

/**
 * Check if item looks like navigation/UI element
 */
function isNavigationItem(name) {
  const navPatterns = [
    /^(home|about|contact|menu|order|location|hours)$/i,
    /^(facebook|twitter|instagram|linkedin|youtube)$/i,
    /^(sign in|log in|sign up|register|subscribe|newsletter)$/i,
    /^(cart|checkout|search|toggle|navigation|skip to)$/i,
    /^(join|shop|gift card|waitlist|team)$/i,
    /^(online ordering|reservation|catering|delivery)$/i,
    /^(privacy|terms|copyright|all rights reserved)/i,
    /^(contact us|locations|toggle navigation)$/i
  ];

  return navPatterns.some(p => p.test(name));
}

/**
 * Load and validate input files
 */
function loadInputs(uberPath, websitePath) {
  let uberMenu = null;
  let websiteMenu = null;

  // Load Uber menu
  if (fs.existsSync(uberPath)) {
    try {
      uberMenu = JSON.parse(fs.readFileSync(uberPath, "utf-8"));
      console.log(`📥 Loaded Uber menu: ${uberPath}`);
    } catch (e) {
      console.log(`⚠️  Could not parse Uber menu: ${e.message}`);
    }
  } else {
    console.log(`⚠️  Uber menu not found: ${uberPath}`);
  }

  // Load website menu
  if (fs.existsSync(websitePath)) {
    try {
      websiteMenu = JSON.parse(fs.readFileSync(websitePath, "utf-8"));
      console.log(`📥 Loaded website menu: ${websitePath}`);
    } catch (e) {
      console.log(`⚠️  Could not parse website menu: ${e.message}`);
    }
  } else {
    console.log(`⚠️  Website menu not found: ${websitePath}`);
  }

  return { uberMenu, websiteMenu };
}

/**
 * Extract flat item list from Uber published menu
 */
function extractUberItems(uberMenu) {
  const items = [];

  if (!uberMenu?.categories) return items;

  for (const category of uberMenu.categories) {
    for (const item of category.items || []) {
      items.push({
        name: item.name,
        source_id: item.id,
        price_cents: item.price_cents,
        calories: item.calories,
        image_url: item.image_url,
        uber_category: category.name,
        source: "uber"
      });
    }
  }

  return items;
}

/**
 * Extract flat item list from website menu (filtered)
 */
function extractWebsiteItems(websiteMenu) {
  const items = [];

  if (!websiteMenu?.sections) return items;

  for (const section of websiteMenu.sections) {
    for (const item of section.items || []) {
      // Skip items that look like navigation remnants
      if (!item.name || item.name.length < 3) continue;
      if (isNavigationItem(item.name)) continue;

      // Skip if it's clearly not a menu item (no price and short name)
      if (!item.price && item.name.length < 10) continue;

      items.push({
        name: item.name,
        description: item.description,
        price: item.price,
        image_url: item.image_url,
        website_section: section.name,
        source: "website"
      });
    }
  }

  return items;
}

/**
 * Find best matching item by name similarity
 */
function findBestMatch(targetName, candidates, threshold = 0.5) {
  let bestMatch = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = nameSimilarity(targetName, candidate.name);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestMatch ? { item: bestMatch, score: bestScore } : null;
}

/**
 * Use GPT to perform intelligent matching
 */
async function aiMatchItems(uberItems, websiteItems, apiKey) {
  const systemPrompt = `You are a menu item matching engine. You compare items from two menu sources and identify matches.

RULES:
- Match items that are clearly the same dish (e.g., "Shackburger" matches "ShackBurger", "10 wings" matches "Chicken Wings (10)")
- Do NOT match items that are different dishes
- Do NOT match modifiers/add-ons with main items
- If unsure, do NOT match

Respond with JSON:
{
  "matches": [
    { "uber_idx": 0, "website_idx": 2, "confidence": 0.9, "reason": "same burger" }
  ]
}`;

  const uberList = uberItems.map((item, i) => `${i}: ${item.name}`).join("\n");
  const websiteList = websiteItems.map((item, i) => `${i}: ${item.name}`).join("\n");

  const userPrompt = `Match these menu items between two sources.

UBER MENU:
${uberList}

WEBSITE MENU:
${websiteList}

Return matches as JSON. Only match if you're confident they're the same dish.`;

  try {
    const result = await callGPT(systemPrompt, userPrompt, apiKey);
    return result.matches || [];
  } catch (e) {
    console.log(`⚠️  AI matching failed: ${e.message}`);
    return [];
  }
}

/**
 * Perform deterministic adjudication (fallback if no API key)
 */
function adjudicateDeterministic(uberItems, websiteItems, restaurantName) {
  const adjudicatedItems = [];
  const usedUberItems = new Set();

  let itemsAddedFromWebsite = 0;
  let itemsRemovedFromUber = 0;
  let itemsMerged = 0;
  let flaggedItems = 0;

  // Step 1: Match website items to Uber items
  for (const webItem of websiteItems) {
    const match = findBestMatch(
      webItem.name,
      uberItems.filter((_, idx) => !usedUberItems.has(idx))
    );

    const { category, flagged: categoryFlagged } = mapToCategory(webItem.website_section);
    const flags = [];

    if (categoryFlagged) {
      flags.push("category_uncertain");
    }

    if (match && match.score >= 0.5) {
      // Found a match - MERGE
      const uberIdx = uberItems.findIndex(u => u === match.item);
      usedUberItems.add(uberIdx);

      adjudicatedItems.push({
        name: webItem.name,
        canonical_category: category,
        price_cents: match.item.price_cents,
        image_url: match.item.image_url,
        source_decision: "merged",
        flags: flags,
        reason: `Matched Uber item "${match.item.name}" (similarity: ${(match.score * 100).toFixed(0)}%)`
      });

      itemsMerged++;
    } else {
      // No match - ADD from website only
      let priceCents = null;
      if (webItem.price) {
        const priceNum = parseFloat(webItem.price);
        if (!isNaN(priceNum)) {
          priceCents = Math.round(priceNum * 100);
        }
      }

      flags.push("no_uber_match");

      adjudicatedItems.push({
        name: webItem.name,
        canonical_category: category,
        price_cents: priceCents,
        image_url: webItem.image_url || null,
        source_decision: "website",
        flags: flags,
        reason: "Item exists on website only"
      });

      itemsAddedFromWebsite++;
    }

    if (flags.length > 0) flaggedItems++;
  }

  // Step 2: Add remaining Uber items not matched
  for (let i = 0; i < uberItems.length; i++) {
    if (usedUberItems.has(i)) continue;

    const uberItem = uberItems[i];

    if (isNonFoodItem(uberItem.name)) {
      itemsRemovedFromUber++;
      continue;
    }

    const { category, flagged: categoryFlagged } = mapToCategory(uberItem.uber_category);
    const flags = ["uber_only"];

    if (categoryFlagged) {
      flags.push("category_uncertain");
    }

    adjudicatedItems.push({
      name: uberItem.name,
      canonical_category: category,
      price_cents: uberItem.price_cents,
      image_url: uberItem.image_url,
      source_decision: "uber",
      flags: flags,
      reason: "Item exists on Uber only (delivery-specific or missing from website)"
    });

    flaggedItems++;
  }

  const totalItems = adjudicatedItems.length;
  const mergedRatio = totalItems > 0 ? itemsMerged / totalItems : 0;
  const flaggedRatio = totalItems > 0 ? flaggedItems / totalItems : 1;
  const confidenceScore = Math.max(0, Math.min(1, mergedRatio * 0.7 + (1 - flaggedRatio) * 0.3));

  return {
    restaurant: {
      name: restaurantName || "Unknown Restaurant",
      source: "ubereats+website"
    },
    items: adjudicatedItems,
    judge_summary: {
      items_added_from_website: itemsAddedFromWebsite,
      items_removed_from_uber: itemsRemovedFromUber,
      items_merged: itemsMerged,
      flagged_items: flaggedItems,
      confidence_score: Math.round(confidenceScore * 100) / 100
    }
  };
}

/**
 * Perform AI-powered adjudication
 */
async function adjudicateWithAI(uberItems, websiteItems, restaurantName, apiKey) {
  console.log("🤖 Using GPT-4o-mini for intelligent matching...\n");

  // Get AI matches
  const aiMatches = await aiMatchItems(uberItems, websiteItems, apiKey);
  console.log(`📊 AI found ${aiMatches.length} matches\n`);

  const adjudicatedItems = [];
  const usedUberItems = new Set();
  const usedWebsiteItems = new Set();

  let itemsAddedFromWebsite = 0;
  let itemsRemovedFromUber = 0;
  let itemsMerged = 0;
  let flaggedItems = 0;

  // Apply AI matches first
  for (const match of aiMatches) {
    if (match.uber_idx === undefined || match.website_idx === undefined) continue;
    if (usedUberItems.has(match.uber_idx)) continue;
    if (usedWebsiteItems.has(match.website_idx)) continue;

    const uberItem = uberItems[match.uber_idx];
    const webItem = websiteItems[match.website_idx];

    if (!uberItem || !webItem) continue;

    usedUberItems.add(match.uber_idx);
    usedWebsiteItems.add(match.website_idx);

    const { category } = mapToCategory(webItem.website_section || uberItem.uber_category);

    adjudicatedItems.push({
      name: webItem.name || uberItem.name,
      canonical_category: category,
      price_cents: uberItem.price_cents,
      image_url: uberItem.image_url,
      source_decision: "merged",
      flags: [],
      reason: `AI matched: ${match.reason || "same item"} (confidence: ${Math.round((match.confidence || 0.8) * 100)}%)`
    });

    itemsMerged++;
  }

  // Add remaining website items
  for (let i = 0; i < websiteItems.length; i++) {
    if (usedWebsiteItems.has(i)) continue;

    const webItem = websiteItems[i];
    const { category, flagged: categoryFlagged } = mapToCategory(webItem.website_section);
    const flags = ["no_uber_match"];

    if (categoryFlagged) flags.push("category_uncertain");

    let priceCents = null;
    if (webItem.price) {
      const priceNum = parseFloat(webItem.price);
      if (!isNaN(priceNum)) priceCents = Math.round(priceNum * 100);
    }

    adjudicatedItems.push({
      name: webItem.name,
      canonical_category: category,
      price_cents: priceCents,
      image_url: webItem.image_url || null,
      source_decision: "website",
      flags: flags,
      reason: "Item exists on website only"
    });

    itemsAddedFromWebsite++;
    flaggedItems++;
  }

  // Add remaining Uber items
  for (let i = 0; i < uberItems.length; i++) {
    if (usedUberItems.has(i)) continue;

    const uberItem = uberItems[i];

    if (isNonFoodItem(uberItem.name)) {
      itemsRemovedFromUber++;
      continue;
    }

    const { category, flagged: categoryFlagged } = mapToCategory(uberItem.uber_category);
    const flags = ["uber_only"];

    if (categoryFlagged) flags.push("category_uncertain");

    adjudicatedItems.push({
      name: uberItem.name,
      canonical_category: category,
      price_cents: uberItem.price_cents,
      image_url: uberItem.image_url,
      source_decision: "uber",
      flags: flags,
      reason: "Item exists on Uber only"
    });

    flaggedItems++;
  }

  const totalItems = adjudicatedItems.length;
  const mergedRatio = totalItems > 0 ? itemsMerged / totalItems : 0;
  const flaggedRatio = totalItems > 0 ? flaggedItems / totalItems : 1;
  const confidenceScore = Math.max(0, Math.min(1, mergedRatio * 0.7 + (1 - flaggedRatio) * 0.3));

  return {
    restaurant: {
      name: restaurantName || "Unknown Restaurant",
      source: "ubereats+website"
    },
    items: adjudicatedItems,
    judge_summary: {
      items_added_from_website: itemsAddedFromWebsite,
      items_removed_from_uber: itemsRemovedFromUber,
      items_merged: itemsMerged,
      flagged_items: flaggedItems,
      confidence_score: Math.round(confidenceScore * 100) / 100
    }
  };
}

/**
 * Main judge function
 */
async function judgeMenus(
  uberPath = "published_menu.json",
  websitePath = "website_menu_extracted.json",
  outputPath = "adjudicated_menu.json"
) {
  console.log("⚖️  Menu Judge v2 - AI-Powered Adjudication\n");

  // Check for API key
  const apiKey = process.env.OPENAI_API_KEY;
  const useAI = !!apiKey;

  if (useAI) {
    console.log("🔑 OpenAI API key found - using GPT-4o-mini\n");
  } else {
    console.log("⚠️  No OPENAI_API_KEY - using deterministic matching\n");
    console.log("   Set OPENAI_API_KEY environment variable for AI matching\n");
  }

  // Load inputs
  const { uberMenu, websiteMenu } = loadInputs(uberPath, websitePath);

  if (!uberMenu && !websiteMenu) {
    console.error("\n❌ Error: No menu data available for adjudication");
    process.exit(1);
  }

  // Extract flat item lists
  const uberItems = uberMenu ? extractUberItems(uberMenu) : [];
  const websiteItems = websiteMenu ? extractWebsiteItems(websiteMenu) : [];

  console.log(`\n📊 Uber items: ${uberItems.length}`);
  console.log(`📊 Website items (filtered): ${websiteItems.length}`);

  // Get restaurant name
  const restaurantName = uberMenu?.restaurant?.name ||
                         websiteMenu?.restaurant?.name ||
                         "Unknown Restaurant";

  console.log(`📊 Restaurant: ${restaurantName}\n`);

  // Handle edge cases
  if (uberItems.length === 0 && websiteItems.length === 0) {
    console.log("⚠️  No items found in either source");
    const emptyResult = {
      restaurant: { name: restaurantName, source: "none" },
      items: [],
      judge_summary: {
        items_added_from_website: 0,
        items_removed_from_uber: 0,
        items_merged: 0,
        flagged_items: 0,
        confidence_score: 0
      }
    };
    fs.writeFileSync(outputPath, JSON.stringify(emptyResult, null, 2));
    console.log(`\n💾 Saved: ${outputPath}`);
    return emptyResult;
  }

  // Perform adjudication
  console.log("🔄 Performing adjudication...\n");

  let result;
  if (useAI && uberItems.length > 0 && websiteItems.length > 0) {
    result = await adjudicateWithAI(uberItems, websiteItems, restaurantName, apiKey);
  } else {
    result = adjudicateDeterministic(uberItems, websiteItems, restaurantName);
  }

  // Save result
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  // Summary
  console.log("═".repeat(60));
  console.log("ADJUDICATION COMPLETE");
  console.log("═".repeat(60));

  console.log(`\n📊 Total adjudicated items: ${result.items.length}`);
  console.log(`📊 Merged (both sources): ${result.judge_summary.items_merged}`);
  console.log(`📊 Added from website: ${result.judge_summary.items_added_from_website}`);
  console.log(`📊 Removed from Uber: ${result.judge_summary.items_removed_from_uber}`);
  console.log(`📊 Flagged for review: ${result.judge_summary.flagged_items}`);
  console.log(`📊 Confidence score: ${(result.judge_summary.confidence_score * 100).toFixed(0)}%`);

  // Show sample items
  if (result.items.length > 0) {
    console.log("\n📋 Sample adjudicated items:");
    result.items.slice(0, 5).forEach((item, i) => {
      const price = item.price_cents ? `$${(item.price_cents / 100).toFixed(2)}` : "N/A";
      const flags = item.flags.length > 0 ? ` [${item.flags.join(", ")}]` : "";
      console.log(`   ${i + 1}. ${item.name} - ${price} (${item.source_decision})${flags}`);
    });
  }

  console.log(`\n💾 Saved: ${outputPath}`);
  console.log("\n✅ Adjudication complete\n");

  return result;
}

// Run if called directly
if (require.main === module) {
  const uberPath = process.argv[2] || "published_menu.json";
  const websitePath = process.argv[3] || "website_menu_extracted.json";
  const outputPath = process.argv[4] || "adjudicated_menu.json";

  judgeMenus(uberPath, websitePath, outputPath).catch(console.error);
}

module.exports = { judgeMenus, adjudicateDeterministic, normalizeName, nameSimilarity };
