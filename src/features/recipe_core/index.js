// src/features/recipe_core/index.js
function buildHeuristicRecipe(dishName, menuDescription, menuSection) {
  const text = `${dishName || ""} ${menuDescription || ""} ${menuSection || ""}`.toLowerCase();

  const ingredients = [];
  const add = (name, textLine) => {
    if (!name) return;
    if (ingredients.some((i) => i.name === name)) return;
    ingredients.push({
      name,
      text: textLine || name,
      grams: null,
      qty: null
    });
  };

  // Very simple heuristics for now
  const isBurger =
    text.includes("burger") ||
    text.includes("cheeseburger") ||
    (menuSection || "").toLowerCase().includes("burger");

  const isPizza =
    text.includes("pizza") ||
    (menuSection || "").toLowerCase().includes("pizza");

  if (isBurger) {
    add("burger bun", "wheat burger bun (contains gluten)");
    if (text.includes("double") || text.includes("two patties")) {
      add("beef patty", "beef patties (red meat)");
    } else {
      add("beef patty", "beef patties (red meat)");
    }
    if (text.includes("bacon")) {
      add("bacon", "crispy bacon strips (processed pork)");
    }
    if (text.includes("cheese")) {
      add("cheese", "American cheese slices (dairy, cheese)");
    }
    if (text.includes("ketchup") || text.includes("mayo") || text.includes("sauce")) {
      add("burger sauce", "burger sauce (mayonnaise, ketchup, dairy/egg possible)");
    }
  }

  if (isPizza) {
    add("pizza crust", "wheat pizza crust (contains gluten)");
    add("mozzarella cheese", "mozzarella cheese (dairy)");
    if (text.includes("pepperoni")) add("pepperoni", "pepperoni slices");
    if (text.includes("buffalo")) add("buffalo sauce", "buffalo sauce (spicy, may contain butter/dairy)");
  }

  // Generic clues
  if (text.includes("chicken")) add("chicken", "chicken");
  if (text.includes("beef")) add("beef", "beef");
  if (text.includes("cheese") && !ingredients.some((i) => i.name.includes("cheese")))
    add("cheese", "cheese (dairy)");
  if (text.includes("egg")) add("egg", "egg");
  if (text.includes("bun") && !ingredients.some((i) => i.name.includes("bun")))
    add("bun", "bread bun (wheat, gluten)");

  return {
    title: dishName || "Dish",
    image: null,
    ingredients
  };
}

export async function resolveRecipe(
  env,
  {
    title,
    restaurantName = null,
    menuDescription = null,
    menuSection = null,
    forceLLM = false,
    ingredients
  }
) {
  const dishName = (title || "").trim();

  console.log(
    "resolveRecipe called",
    JSON.stringify({
      dishName,
      restaurantName,
      menuSection,
      forceLLM
    })
  );

  // ------------------------------
  // TIER 1 + 2 — external APIs (only if NOT forceLLM)
  // ------------------------------
  if (!forceLLM) {
    // ------------------------------
    // TIER 1 — EDAMAM RESOLUTION
    // ------------------------------
    let edamamResult = await tryEdamam(dishName, env);
    if (edamamResult && edamamResult.ok && edamamResult.recipe) {
      return {
        ok: true,
        source: "edamam",
        recipe: edamamResult.recipe
      };
    }

    // ------------------------------
    // TIER 2 — SPOONACULAR
    // ------------------------------
    let spoonResult = await trySpoonacular(dishName, env);
    if (spoonResult && spoonResult.ok && spoonResult.recipe) {
      return {
        ok: true,
        source: "spoonacular",
        recipe: spoonResult.recipe
      };
    }
  }

  // ------------------------------
  // TIER 3 — HEURISTIC INGREDIENT EXTRACTION (NO LLM)
  // ------------------------------
  const heuristic = buildHeuristicRecipe(dishName, menuDescription, menuSection);

  if (heuristic && heuristic.ingredients && heuristic.ingredients.length > 0) {
    return {
      ok: true,
      source: "heuristic_fallback",
      recipe: heuristic
    };
  }

  // ------------------------------
  // TIER 4 — ULTRA FALLBACK
  // ------------------------------
  return {
    ok: false,
    source: "no_match",
    error: "No recipe could be resolved by Edamam, Spoonacular, or heuristic fallback.",
    recipe: {
      title: dishName,
      image: null,
      ingredients: []
    }
  };
}

export async function normalizeIngredients(env, { lines }) {
  return { ok: true, source: "recipe_core.facade", items: [] };
}

// ----------------------------------------------------------
// Edamam Helper — TIER 1
// ----------------------------------------------------------
async function tryEdamam(dishName, env) {
  console.log("tryEdamam entered for dish:", dishName);

  const brandedPattern =
    /(baconator|big mac|mcflurry|whopper|mcrib|quarter pounder|double stack|bacon king|cheesy gordita|crunchwrap)/i;
  if (brandedPattern.test(dishName || "")) {
    console.log("tryEdamam: skipping branded dish, letting LLM handle:", dishName);
    return null;
  }
  try {
    console.log("tryEdamam: calling Edamam API for dish:", dishName);

    const url =
      `https://api.edamam.com/api/recipes/v2?type=public&q=` +
      encodeURIComponent(dishName) +
      `&app_id=${env.EDAMAM_APP_ID}&app_key=${env.EDAMAM_APP_KEY}`;

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;

    const data = await res.json();
    if (!data || !data.hits || data.hits.length === 0) return null;

    // Pick top hit
    const pick = data.hits[0].recipe;

    // Normalize into our canonical recipe format
    const recipe = {
      title: pick.label,
      image: pick.image || null,
      calories: pick.calories || null,
      macros: {
        protein: pick.totalNutrients?.PROCNT?.quantity ?? null,
        carbs: pick.totalNutrients?.CHOCDF?.quantity ?? null,
        fat: pick.totalNutrients?.FAT?.quantity ?? null
      },
      ingredients: (pick.ingredientLines || []).map((l) => ({
        name: l,
        text: l,
        grams: null,
        qty: null
      }))
    };

    return { ok: true, recipe };
  } catch (err) {
    console.log("tryEdamam error:", err);
    return null;
  }
}

// ----------------------------------------------------------
// Spoonacular Helper — TIER 2
// ----------------------------------------------------------
async function trySpoonacular(dishName, env) {
  const brandedPattern =
    /(baconator|big mac|mcflurry|whopper|mcrib|quarter pounder|double stack|bacon king|cheesy gordita|crunchwrap)/i;
  if (brandedPattern.test(dishName || "")) {
    console.log("trySpoonacular: skipping branded dish, letting LLM handle:", dishName);
    return null;
  }
  try {
    const url =
      `https://api.spoonacular.com/recipes/complexSearch?addRecipeNutrition=true&query=` +
      encodeURIComponent(dishName) +
      `&number=1&apiKey=${env.SPOON_API_KEY}`;

    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.results || data.results.length === 0) return null;

    const pick = data.results[0];

    // Build canonical
    const recipe = {
      title: pick.title,
      image: pick.image || null,
      calories:
        pick.nutrition?.nutrients?.find((n) => n.name === "Calories")
          ?.amount ?? null,
      macros: {
        protein:
          pick.nutrition?.nutrients?.find((n) => n.name === "Protein")
            ?.amount ?? null,
        carbs:
          pick.nutrition?.nutrients?.find((n) => n.name === "Carbohydrates")
            ?.amount ?? null,
        fat:
          pick.nutrition?.nutrients?.find((n) => n.name === "Fat")?.amount ??
          null
      },
      ingredients: (pick.nutrition?.ingredients || []).map((l) => ({
        name: l.name ?? l.original,
        text: l.original,
        grams: l.amount ?? null,
        qty: null
      }))
    };

    return { ok: true, recipe };
  } catch (err) {
    console.log("trySpoonacular error:", err);
    return null;
  }
}
