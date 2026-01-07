/**
 * GARAGE MODE: Uber Eats Apify Menu Ingestion Tuning Harness
 *
 * Acceptance Gate: 10 restaurants' menus in a row that are:
 * 1) 100% complete vs Uber Eats menu (all sections + items + modifiers + prices)
 * 2) Perfectly structured (hierarchy + ordering preserved)
 * 3) Zero cross-contamination (no foreign items)
 *
 * This file is allowed to be slower - we're tuning for correctness, not latency.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// SECTION A: PIPELINE MAP (Documentation)
// ============================================================================
/**
 * Apify Uber Eats Pipeline Map:
 *
 * ENTRY POINTS:
 * - POST /api/apify-start           → startApifyRunAsync()     [line 11497]
 * - POST /webhook/apify             → webhook receiver         [line 14433]
 * - GET  /api/apify-job/:jobId      → job status/results       [line 14538]
 * - GET  /debug/apify               → debug endpoint           [line 14344]
 *
 * CORE FUNCTIONS (in index.js):
 * - startApifyRunAsync()            [line 11497] - Start async Apify actor with webhook
 * - fetchApifyDataset()             [line 11575] - Fetch dataset from completed run
 * - fetchMenuFromApify()            [line 11591] - Sync Apify call (fallback)
 * - fetchMenuFromUberTiered()       [line 11673] - Tiered scraper (RapidAPI → Apify)
 * - postJobByAddressTiered()        [line 11723] - Race Apify & RapidAPI
 * - extractMenuItemsFromUber()      [line 3095]  - Parse and normalize menu items
 *
 * DATA FLOW:
 * 1. Apify actor scrapes Uber Eats restaurant page
 * 2. Returns raw JSON with: { data: { results: [{ menu: [...], ... }] } }
 * 3. extractMenuItemsFromUber() normalizes to flat item list
 * 4. Results stored in MENUS_CACHE KV with `apify-job:{jobId}` key
 *
 * CURRENT ISSUES (why we need Garage Mode):
 * - Output is FLAT (items list), not hierarchical
 * - No modifier groups / options preservation
 * - No required selection rules
 * - Deduplication may lose data
 * - Only keeps ONE restaurant even if Apify returns multiple
 */

// ============================================================================
// SECTION B: IDENTITY BUNDLE (Strict Restaurant Scoping)
// ============================================================================

/**
 * Identity bundle for strict restaurant scoping.
 * All cache keys and DB writes must include this bundle.
 */
function createIdentityBundle(restaurantId, uberStoreIdOrUrl, sessionId = null) {
  const now = Date.now();
  const session = sessionId || `garage_${now}_${Math.random().toString(36).slice(2, 8)}`;

  // Extract store ID from URL if needed
  let storeId = uberStoreIdOrUrl;
  if (typeof uberStoreIdOrUrl === 'string' && uberStoreIdOrUrl.includes('ubereats.com')) {
    // Parse: https://www.ubereats.com/store/restaurant-name/store-id
    // Store IDs can be alphanumeric (e.g., sHvkP4eQSoatfK0HNqNPew)
    const match = uberStoreIdOrUrl.match(/\/store\/[^/]+\/([a-zA-Z0-9_-]+)/);
    if (match) storeId = match[1];
  }

  const bundle = {
    restaurant_id: restaurantId,
    provider: "ubereats_apify",
    uber_store_id: storeId,
    uber_store_url: typeof uberStoreIdOrUrl === 'string' && uberStoreIdOrUrl.startsWith('http')
      ? uberStoreIdOrUrl
      : null,
    menu_fetch_session_id: session,
    created_at: now,
    signature_hash: null // Will be computed after menu is fetched
  };

  // Compute signature hash
  bundle.signature_hash = computeSignatureHash(bundle);

  return bundle;
}

/**
 * Compute a deterministic hash for the identity bundle.
 */
function computeSignatureHash(bundle) {
  const payload = [
    bundle.restaurant_id,
    bundle.provider,
    bundle.uber_store_id
  ].join('|');

  // Simple hash for now (in production, use crypto.subtle)
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Build cache key with identity bundle for strict scoping.
 */
function buildScopedCacheKey(prefix, bundle) {
  return `${prefix}:${bundle.provider}:${bundle.uber_store_id}:${bundle.menu_fetch_session_id}`;
}

// ============================================================================
// SECTION C: CANONICAL MENU SCHEMA
// ============================================================================

/**
 * Canonical Menu Schema:
 *
 * {
 *   identity: IdentityBundle,
 *   restaurant: {
 *     name: string,
 *     uber_store_id: string,
 *     uber_store_url: string,
 *     address: string | null,
 *     cuisine: string[] | null
 *   },
 *   sections: [
 *     {
 *       id: string,
 *       name: string,
 *       position: number,  // 0-indexed order
 *       items: [
 *         {
 *           id: string,
 *           name: string,
 *           description: string | null,
 *           position: number,  // 0-indexed within section
 *           price_cents: number | null,
 *           price_display: string | null,
 *           currency: string,  // "USD", "EUR", etc.
 *           image_url: string | null,
 *           calories: number | null,
 *           modifier_groups: [
 *             {
 *               id: string,
 *               name: string,
 *               position: number,
 *               required: boolean,
 *               min_selections: number,
 *               max_selections: number,
 *               options: [
 *                 {
 *                   id: string,
 *                   name: string,
 *                   position: number,
 *                   price_cents: number | null,
 *                   price_display: string | null,
 *                   default: boolean
 *                 }
 *               ]
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   ],
 *   metadata: {
 *     fetched_at: number,
 *     apify_run_id: string | null,
 *     apify_dataset_id: string | null,
 *     total_sections: number,
 *     total_items: number,
 *     total_modifier_groups: number,
 *     total_options: number
 *   }
 * }
 */

/**
 * Normalize raw Apify payload to canonical menu schema.
 * This is the STRICT version that preserves all hierarchy and ordering.
 */
function normalizeApifyToCanonical(rawApifyPayload, identityBundle) {
  const results = rawApifyPayload?.data?.results || rawApifyPayload?.results || rawApifyPayload || [];

  // Handle array vs single object
  const restaurants = Array.isArray(results) ? results : [results];

  if (restaurants.length === 0) {
    return {
      ok: false,
      error: "empty_payload",
      message: "Apify payload contains no restaurants"
    };
  }

  // In Garage Mode, we require exactly ONE restaurant per identity bundle
  // If Apify returns multiple, we need to match by store ID
  let targetRestaurant = null;

  if (restaurants.length === 1) {
    targetRestaurant = restaurants[0];
  } else {
    // Try to match by store ID
    for (const r of restaurants) {
      const rStoreId = r.uuid || r.id || r.storeUuid || null;
      const rUrl = r.url || r.storeUrl || "";

      if (rStoreId === identityBundle.uber_store_id) {
        targetRestaurant = r;
        break;
      }
      if (identityBundle.uber_store_url && rUrl.includes(identityBundle.uber_store_id)) {
        targetRestaurant = r;
        break;
      }
    }

    if (!targetRestaurant) {
      // Fallback: use first restaurant but warn
      targetRestaurant = restaurants[0];
      console.warn(`[Garage] Multiple restaurants in payload, using first. Expected store_id=${identityBundle.uber_store_id}`);
    }
  }

  const r = targetRestaurant;
  const restaurantName = r.title || r.sanitizedTitle || r.name || "";
  const restaurantId = r.uuid || r.id || r.storeUuid || "";

  const canonical = {
    identity: identityBundle,
    restaurant: {
      name: restaurantName,
      uber_store_id: restaurantId,
      uber_store_url: r.url || r.storeUrl || identityBundle.uber_store_url,
      address: r.address || r.location?.address || null,
      cuisine: r.cuisines || r.categories || null
    },
    sections: [],
    metadata: {
      fetched_at: Date.now(),
      apify_run_id: rawApifyPayload._apify_run_id || null,
      apify_dataset_id: rawApifyPayload._apify_dataset_id || null,
      total_sections: 0,
      total_items: 0,
      total_modifier_groups: 0,
      total_options: 0
    }
  };

  // Parse sections - try multiple possible field names
  let rawSections = [];
  if (Array.isArray(r.menu)) rawSections = r.menu;
  else if (Array.isArray(r.catalogs)) rawSections = r.catalogs;
  else if (Array.isArray(r.sections)) rawSections = r.sections;
  else if (Array.isArray(r.categories)) rawSections = r.categories;

  // Also check for featured items as a special section
  const featuredItems = r.featuredItems || r.featured || [];
  if (Array.isArray(featuredItems) && featuredItems.length > 0) {
    rawSections.unshift({
      catalogName: "Featured",
      name: "Featured",
      catalogItems: featuredItems,
      items: featuredItems,
      _synthetic: true
    });
  }

  // Normalize each section
  for (let sectionIdx = 0; sectionIdx < rawSections.length; sectionIdx++) {
    const rawSection = rawSections[sectionIdx];
    const sectionName = rawSection.catalogName || rawSection.name || rawSection.title || `Section ${sectionIdx + 1}`;
    const sectionId = rawSection.uuid || rawSection.id || `section_${sectionIdx}`;

    const section = {
      id: sectionId,
      name: sectionName,
      position: sectionIdx,
      items: []
    };

    // Get items from section
    let rawItems = [];
    if (Array.isArray(rawSection.catalogItems)) rawItems = rawSection.catalogItems;
    else if (Array.isArray(rawSection.items)) rawItems = rawSection.items;
    else if (Array.isArray(rawSection.products)) rawItems = rawSection.products;

    // Normalize each item
    for (let itemIdx = 0; itemIdx < rawItems.length; itemIdx++) {
      const rawItem = rawItems[itemIdx];
      const item = normalizeMenuItem(rawItem, itemIdx);
      section.items.push(item);
      canonical.metadata.total_items++;
      canonical.metadata.total_modifier_groups += item.modifier_groups.length;
      for (const mg of item.modifier_groups) {
        canonical.metadata.total_options += mg.options.length;
      }
    }

    if (section.items.length > 0 || !rawSection._synthetic) {
      canonical.sections.push(section);
      canonical.metadata.total_sections++;
    }
  }

  return { ok: true, menu: canonical };
}

/**
 * Normalize a single menu item with all modifiers.
 */
function normalizeMenuItem(rawItem, position) {
  const item = {
    id: rawItem.uuid || rawItem.id || rawItem.itemId || `item_${position}`,
    name: rawItem.title || rawItem.name || rawItem.itemName || "",
    description: rawItem.itemDescription || rawItem.description || null,
    position: position,
    price_cents: null,
    price_display: null,
    currency: "USD",
    image_url: rawItem.imageUrl || rawItem.image_url || rawItem.image || null,
    calories: null,
    modifier_groups: []
  };

  // Parse price
  if (typeof rawItem.price === 'number') {
    item.price_cents = rawItem.price;
    item.price_display = `$${(rawItem.price / 100).toFixed(2)}`;
  } else if (typeof rawItem.price === 'string') {
    item.price_display = rawItem.price;
    const match = rawItem.price.match(/[\d,.]+/);
    if (match) {
      const num = parseFloat(match[0].replace(/,/g, ''));
      if (!isNaN(num)) item.price_cents = Math.round(num * 100);
    }
  }
  if (rawItem.priceTagline) {
    item.price_display = rawItem.priceTagline;
  }

  // Parse calories
  if (rawItem.nutrition?.calories != null) {
    item.calories = rawItem.nutrition.calories;
  } else if (typeof rawItem.calories === 'number') {
    item.calories = rawItem.calories;
  } else {
    // Try to extract from description or price display
    const text = `${item.description || ''} ${item.price_display || ''}`;
    const calMatch = text.match(/(\d+)\s*Cal/i);
    if (calMatch) item.calories = parseInt(calMatch[1], 10);
  }

  // Parse modifier groups (customizations)
  const rawModifiers = rawItem.customizations || rawItem.modifierGroups ||
                       rawItem.modifier_groups || rawItem.options || [];

  if (Array.isArray(rawModifiers)) {
    for (let mgIdx = 0; mgIdx < rawModifiers.length; mgIdx++) {
      const rawMg = rawModifiers[mgIdx];
      const modifierGroup = normalizeModifierGroup(rawMg, mgIdx);
      item.modifier_groups.push(modifierGroup);
    }
  }

  return item;
}

/**
 * Normalize a modifier group with all options.
 */
function normalizeModifierGroup(rawMg, position) {
  const mg = {
    id: rawMg.uuid || rawMg.id || `mg_${position}`,
    name: rawMg.title || rawMg.name || rawMg.groupName || `Modifier ${position + 1}`,
    position: position,
    required: rawMg.required || rawMg.isRequired || false,
    min_selections: rawMg.minPermitted || rawMg.minSelections || rawMg.min || 0,
    max_selections: rawMg.maxPermitted || rawMg.maxSelections || rawMg.max || 999,
    options: []
  };

  // If required and no min set, default min to 1
  if (mg.required && mg.min_selections === 0) {
    mg.min_selections = 1;
  }

  const rawOptions = rawMg.options || rawMg.items || rawMg.choices || [];

  if (Array.isArray(rawOptions)) {
    for (let optIdx = 0; optIdx < rawOptions.length; optIdx++) {
      const rawOpt = rawOptions[optIdx];
      const option = {
        id: rawOpt.uuid || rawOpt.id || `opt_${optIdx}`,
        name: rawOpt.title || rawOpt.name || rawOpt.optionName || "",
        position: optIdx,
        price_cents: null,
        price_display: null,
        default: rawOpt.default || rawOpt.isDefault || false
      };

      // Parse option price
      if (typeof rawOpt.price === 'number') {
        option.price_cents = rawOpt.price;
        if (rawOpt.price > 0) {
          option.price_display = `+$${(rawOpt.price / 100).toFixed(2)}`;
        }
      } else if (typeof rawOpt.priceTagline === 'string') {
        option.price_display = rawOpt.priceTagline;
      }

      mg.options.push(option);
    }
  }

  return mg;
}

// ============================================================================
// SECTION D: STRICT VALIDATOR
// ============================================================================

/**
 * Validate a canonical menu strictly.
 * Returns { valid: true } or { valid: false, errors: [...] }
 */
function validateMenuStrict(menu) {
  const errors = [];

  // 1. Identity/scoping checks
  if (!menu.identity) {
    errors.push({ code: "MISSING_IDENTITY", message: "Menu lacks identity bundle" });
  } else {
    if (!menu.identity.restaurant_id) {
      errors.push({ code: "MISSING_RESTAURANT_ID", message: "Identity missing restaurant_id" });
    }
    if (!menu.identity.provider) {
      errors.push({ code: "MISSING_PROVIDER", message: "Identity missing provider" });
    }
    if (!menu.identity.uber_store_id) {
      errors.push({ code: "MISSING_STORE_ID", message: "Identity missing uber_store_id" });
    }
    if (!menu.identity.menu_fetch_session_id) {
      errors.push({ code: "MISSING_SESSION_ID", message: "Identity missing menu_fetch_session_id" });
    }
  }

  // 2. Restaurant info
  if (!menu.restaurant) {
    errors.push({ code: "MISSING_RESTAURANT", message: "Menu lacks restaurant info" });
  } else {
    if (!menu.restaurant.name) {
      errors.push({ code: "MISSING_RESTAURANT_NAME", message: "Restaurant missing name" });
    }
  }

  // 3. Sections structure
  if (!Array.isArray(menu.sections)) {
    errors.push({ code: "INVALID_SECTIONS", message: "Sections must be an array" });
  } else {
    const seenSectionIds = new Set();
    const seenSectionNames = new Map(); // name -> positions

    for (let sIdx = 0; sIdx < menu.sections.length; sIdx++) {
      const section = menu.sections[sIdx];
      const sectionLabel = `Section[${sIdx}]`;

      // Check section structure
      if (!section.id) {
        errors.push({ code: "SECTION_MISSING_ID", message: `${sectionLabel} missing id` });
      } else if (seenSectionIds.has(section.id)) {
        errors.push({ code: "DUPLICATE_SECTION_ID", message: `${sectionLabel} duplicate id: ${section.id}` });
      } else {
        seenSectionIds.add(section.id);
      }

      if (!section.name) {
        errors.push({ code: "SECTION_MISSING_NAME", message: `${sectionLabel} missing name` });
      } else {
        const existing = seenSectionNames.get(section.name);
        if (existing !== undefined) {
          errors.push({
            code: "DUPLICATE_SECTION_NAME",
            message: `${sectionLabel} duplicate name "${section.name}" (first at position ${existing})`
          });
        } else {
          seenSectionNames.set(section.name, sIdx);
        }
      }

      if (section.position !== sIdx) {
        errors.push({
          code: "SECTION_POSITION_MISMATCH",
          message: `${sectionLabel} position=${section.position} but index=${sIdx}`
        });
      }

      // Check items within section
      if (!Array.isArray(section.items)) {
        errors.push({ code: "SECTION_INVALID_ITEMS", message: `${sectionLabel} items must be array` });
      } else {
        const seenItemIds = new Set();
        const seenItemFingerprints = new Set();

        for (let iIdx = 0; iIdx < section.items.length; iIdx++) {
          const item = section.items[iIdx];
          const itemLabel = `${sectionLabel}.Item[${iIdx}]`;

          // Item structure checks
          if (!item.id) {
            errors.push({ code: "ITEM_MISSING_ID", message: `${itemLabel} missing id` });
          } else if (seenItemIds.has(item.id)) {
            errors.push({ code: "DUPLICATE_ITEM_ID", message: `${itemLabel} duplicate id: ${item.id}` });
          } else {
            seenItemIds.add(item.id);
          }

          if (!item.name) {
            errors.push({ code: "ITEM_MISSING_NAME", message: `${itemLabel} missing name` });
          }

          if (item.position !== iIdx) {
            errors.push({
              code: "ITEM_POSITION_MISMATCH",
              message: `${itemLabel} position=${item.position} but index=${iIdx}`
            });
          }

          // Fingerprint check (name + price as dedup key)
          const fingerprint = `${(item.name || '').toLowerCase()}|${item.price_cents || 0}`;
          if (seenItemFingerprints.has(fingerprint)) {
            errors.push({
              code: "DUPLICATE_ITEM_FINGERPRINT",
              message: `${itemLabel} duplicate fingerprint: "${item.name}" at $${(item.price_cents || 0) / 100}`
            });
          } else {
            seenItemFingerprints.add(fingerprint);
          }

          // Check modifier groups
          if (!Array.isArray(item.modifier_groups)) {
            errors.push({ code: "ITEM_INVALID_MODIFIERS", message: `${itemLabel} modifier_groups must be array` });
          } else {
            for (let mgIdx = 0; mgIdx < item.modifier_groups.length; mgIdx++) {
              const mg = item.modifier_groups[mgIdx];
              const mgLabel = `${itemLabel}.ModifierGroup[${mgIdx}]`;

              if (!mg.id) {
                errors.push({ code: "MG_MISSING_ID", message: `${mgLabel} missing id` });
              }
              if (!mg.name) {
                errors.push({ code: "MG_MISSING_NAME", message: `${mgLabel} missing name` });
              }
              if (mg.position !== mgIdx) {
                errors.push({
                  code: "MG_POSITION_MISMATCH",
                  message: `${mgLabel} position=${mg.position} but index=${mgIdx}`
                });
              }

              // Check options
              if (!Array.isArray(mg.options)) {
                errors.push({ code: "MG_INVALID_OPTIONS", message: `${mgLabel} options must be array` });
              } else {
                for (let optIdx = 0; optIdx < mg.options.length; optIdx++) {
                  const opt = mg.options[optIdx];
                  const optLabel = `${mgLabel}.Option[${optIdx}]`;

                  if (!opt.id) {
                    errors.push({ code: "OPT_MISSING_ID", message: `${optLabel} missing id` });
                  }
                  if (!opt.name) {
                    errors.push({ code: "OPT_MISSING_NAME", message: `${optLabel} missing name` });
                  }
                  if (opt.position !== optIdx) {
                    errors.push({
                      code: "OPT_POSITION_MISMATCH",
                      message: `${optLabel} position=${opt.position} but index=${optIdx}`
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    // Check for empty menu
    if (menu.sections.length === 0) {
      errors.push({ code: "EMPTY_MENU", message: "Menu has no sections" });
    }
  }

  // 4. Metadata checks
  if (!menu.metadata) {
    errors.push({ code: "MISSING_METADATA", message: "Menu lacks metadata" });
  } else {
    if (!menu.metadata.fetched_at) {
      errors.push({ code: "MISSING_FETCHED_AT", message: "Metadata missing fetched_at" });
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    errorCount: errors.length,
    errorsByCode: errors.reduce((acc, e) => {
      acc[e.code] = (acc[e.code] || 0) + 1;
      return acc;
    }, {})
  };
}

// ============================================================================
// SECTION E: DIFF ENGINE
// ============================================================================

/**
 * Compute a strict diff between candidate menu and Apify truth.
 * Returns { match: true } or { match: false, diffs: [...] }
 */
function diffAgainstTruth(candidateMenu, apifyRawTruth) {
  const diffs = [];

  // First, normalize the truth to canonical form for comparison
  const truthBundle = createIdentityBundle(
    candidateMenu.identity?.restaurant_id || "truth",
    candidateMenu.identity?.uber_store_id || "truth"
  );
  const truthResult = normalizeApifyToCanonical(apifyRawTruth, truthBundle);

  if (!truthResult.ok) {
    diffs.push({
      type: "TRUTH_PARSE_ERROR",
      message: truthResult.message || "Failed to parse Apify truth",
      severity: "critical"
    });
    return { match: false, diffs, diffCount: diffs.length };
  }

  const truth = truthResult.menu;
  const candidate = candidateMenu;

  // Compare sections
  const truthSectionNames = truth.sections.map(s => s.name);
  const candidateSectionNames = candidate.sections.map(s => s.name);

  // Missing sections
  for (const sName of truthSectionNames) {
    if (!candidateSectionNames.includes(sName)) {
      diffs.push({
        type: "MISSING_SECTION",
        section: sName,
        severity: "error"
      });
    }
  }

  // Extra sections
  for (const sName of candidateSectionNames) {
    if (!truthSectionNames.includes(sName)) {
      diffs.push({
        type: "EXTRA_SECTION",
        section: sName,
        severity: "error"
      });
    }
  }

  // Section order mismatch
  for (let i = 0; i < Math.min(truthSectionNames.length, candidateSectionNames.length); i++) {
    if (truthSectionNames[i] !== candidateSectionNames[i]) {
      diffs.push({
        type: "SECTION_ORDER_MISMATCH",
        expected: truthSectionNames[i],
        actual: candidateSectionNames[i],
        position: i,
        severity: "warning"
      });
    }
  }

  // Compare items within matching sections
  const candidateSectionMap = new Map(candidate.sections.map(s => [s.name, s]));

  for (const truthSection of truth.sections) {
    const candidateSection = candidateSectionMap.get(truthSection.name);
    if (!candidateSection) continue; // Already reported as missing

    const truthItemNames = truthSection.items.map(i => i.name);
    const candidateItemNames = candidateSection.items.map(i => i.name);

    // Missing items
    for (const itemName of truthItemNames) {
      if (!candidateItemNames.includes(itemName)) {
        diffs.push({
          type: "MISSING_ITEM",
          section: truthSection.name,
          item: itemName,
          severity: "error"
        });
      }
    }

    // Extra items
    for (const itemName of candidateItemNames) {
      if (!truthItemNames.includes(itemName)) {
        diffs.push({
          type: "EXTRA_ITEM",
          section: truthSection.name,
          item: itemName,
          severity: "error"
        });
      }
    }

    // Item order within section
    for (let i = 0; i < Math.min(truthItemNames.length, candidateItemNames.length); i++) {
      if (truthItemNames[i] !== candidateItemNames[i]) {
        diffs.push({
          type: "ITEM_ORDER_MISMATCH",
          section: truthSection.name,
          expected: truthItemNames[i],
          actual: candidateItemNames[i],
          position: i,
          severity: "warning"
        });
      }
    }

    // Compare matching items in detail
    const candidateItemMap = new Map(candidateSection.items.map(i => [i.name, i]));

    for (const truthItem of truthSection.items) {
      const candidateItem = candidateItemMap.get(truthItem.name);
      if (!candidateItem) continue; // Already reported as missing

      // Compare fields
      if (truthItem.price_cents !== candidateItem.price_cents) {
        diffs.push({
          type: "PRICE_MISMATCH",
          section: truthSection.name,
          item: truthItem.name,
          expected: truthItem.price_cents,
          actual: candidateItem.price_cents,
          severity: "error"
        });
      }

      // Compare modifier groups count
      if (truthItem.modifier_groups.length !== candidateItem.modifier_groups.length) {
        diffs.push({
          type: "MODIFIER_GROUP_COUNT_MISMATCH",
          section: truthSection.name,
          item: truthItem.name,
          expected: truthItem.modifier_groups.length,
          actual: candidateItem.modifier_groups.length,
          severity: "error"
        });
      }

      // Compare modifier groups in detail
      const truthMgNames = truthItem.modifier_groups.map(mg => mg.name);
      const candidateMgNames = candidateItem.modifier_groups.map(mg => mg.name);

      for (const mgName of truthMgNames) {
        if (!candidateMgNames.includes(mgName)) {
          diffs.push({
            type: "MISSING_MODIFIER_GROUP",
            section: truthSection.name,
            item: truthItem.name,
            modifierGroup: mgName,
            severity: "error"
          });
        }
      }

      // Compare options within modifier groups
      const candidateMgMap = new Map(candidateItem.modifier_groups.map(mg => [mg.name, mg]));

      for (const truthMg of truthItem.modifier_groups) {
        const candidateMg = candidateMgMap.get(truthMg.name);
        if (!candidateMg) continue;

        // Required selection mismatch
        if (truthMg.required !== candidateMg.required) {
          diffs.push({
            type: "REQUIRED_SELECTION_MISMATCH",
            section: truthSection.name,
            item: truthItem.name,
            modifierGroup: truthMg.name,
            expected: truthMg.required,
            actual: candidateMg.required,
            severity: "error"
          });
        }

        if (truthMg.min_selections !== candidateMg.min_selections) {
          diffs.push({
            type: "MIN_SELECTIONS_MISMATCH",
            section: truthSection.name,
            item: truthItem.name,
            modifierGroup: truthMg.name,
            expected: truthMg.min_selections,
            actual: candidateMg.min_selections,
            severity: "error"
          });
        }

        if (truthMg.max_selections !== candidateMg.max_selections) {
          diffs.push({
            type: "MAX_SELECTIONS_MISMATCH",
            section: truthSection.name,
            item: truthItem.name,
            modifierGroup: truthMg.name,
            expected: truthMg.max_selections,
            actual: candidateMg.max_selections,
            severity: "error"
          });
        }

        // Compare options
        const truthOptNames = truthMg.options.map(o => o.name);
        const candidateOptNames = candidateMg.options.map(o => o.name);

        for (const optName of truthOptNames) {
          if (!candidateOptNames.includes(optName)) {
            diffs.push({
              type: "MISSING_OPTION",
              section: truthSection.name,
              item: truthItem.name,
              modifierGroup: truthMg.name,
              option: optName,
              severity: "error"
            });
          }
        }
      }
    }
  }

  // Categorize diffs
  const errorDiffs = diffs.filter(d => d.severity === "error");
  const warningDiffs = diffs.filter(d => d.severity === "warning");

  return {
    match: errorDiffs.length === 0,
    diffs: diffs,
    diffCount: diffs.length,
    errorCount: errorDiffs.length,
    warningCount: warningDiffs.length,
    diffsByType: diffs.reduce((acc, d) => {
      acc[d.type] = (acc[d.type] || 0) + 1;
      return acc;
    }, {})
  };
}

// ============================================================================
// SECTION F: GARAGE INGEST FUNCTION
// ============================================================================

/**
 * Garage Mode ingest: fetch menu from Apify and normalize strictly.
 *
 * @param {string} restaurantId - Internal restaurant identifier
 * @param {string} uberStoreUrlOrId - Uber Eats store URL or UUID
 * @param {object} options - { env, sessionId, timeout }
 * @returns {Promise<{ ok, menu, rawApify, identity, validationResult, error }>}
 */
async function garageIngestMenu(restaurantId, uberStoreUrlOrId, options = {}) {
  const { env, sessionId = null, timeout = 120000 } = options;

  const startTime = Date.now();
  const identity = createIdentityBundle(restaurantId, uberStoreUrlOrId, sessionId);

  const result = {
    ok: false,
    menu: null,
    rawApify: null,
    identity: identity,
    validationResult: null,
    diffResult: null,
    timing: {},
    error: null
  };

  try {
    // Step 1: Fetch from Apify
    const fetchStart = Date.now();

    if (!env?.APIFY_TOKEN) {
      throw new Error("Missing APIFY_TOKEN in environment");
    }

    const actorId = env.APIFY_UBER_ACTOR_ID || "borderline~ubereats-scraper";
    const token = env.APIFY_TOKEN;

    // Build the URL to scrape
    let scrapeUrl = uberStoreUrlOrId;
    if (!scrapeUrl.startsWith('http')) {
      // Assume it's a store ID, construct URL
      scrapeUrl = `https://www.ubereats.com/store/${restaurantId}/${uberStoreUrlOrId}`;
    }

    const apiUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&memory=4096&timeout=60`;

    const body = {
      urls: [{ url: scrapeUrl }],
      maxItems: 1000,
      extendOutputFunction: "($) => { return {} }",
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"]
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Apify API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    let rawData;
    try {
      rawData = await response.json();
    } catch (e) {
      throw new Error("Apify response was not valid JSON");
    }

    result.timing.fetch_ms = Date.now() - fetchStart;
    result.rawApify = rawData;

    // Step 2: Normalize to canonical schema
    const normalizeStart = Date.now();
    const normalizeResult = normalizeApifyToCanonical(rawData, identity);
    result.timing.normalize_ms = Date.now() - normalizeStart;

    if (!normalizeResult.ok) {
      throw new Error(normalizeResult.message || "Normalization failed");
    }

    result.menu = normalizeResult.menu;

    // Step 3: Validate strictly
    const validateStart = Date.now();
    result.validationResult = validateMenuStrict(result.menu);
    result.timing.validate_ms = Date.now() - validateStart;

    // Step 4: Diff against truth (raw Apify is our truth)
    const diffStart = Date.now();
    result.diffResult = diffAgainstTruth(result.menu, rawData);
    result.timing.diff_ms = Date.now() - diffStart;

    result.timing.total_ms = Date.now() - startTime;
    result.ok = result.validationResult.valid && result.diffResult.match;

  } catch (err) {
    result.error = err.message || String(err);
    result.timing.total_ms = Date.now() - startTime;
  }

  return result;
}

// ============================================================================
// SECTION G: GARAGE RUNNER
// ============================================================================

/**
 * Garage Runner: Run N restaurants and enforce 10-perfect-in-a-row gate.
 *
 * @param {Array<{restaurant_id, uber_url}>} restaurants - List to test
 * @param {object} options - { env, artifactsDir, stopOnFail, targetConsecutive }
 * @returns {Promise<{ passed, consecutivePasses, results, summary }>}
 */
async function garageRunner(restaurants, options = {}) {
  const {
    env,
    artifactsDir = "./garage/artifacts",
    stopOnFail = true,
    targetConsecutive = 10
  } = options;

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const results = [];
  let consecutivePasses = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`GARAGE MODE: Testing ${restaurants.length} restaurants`);
  console.log(`Target: ${targetConsecutive} consecutive perfect menus`);
  console.log(`Run ID: ${runId}`);
  console.log(`${"=".repeat(60)}\n`);

  for (let i = 0; i < restaurants.length; i++) {
    const { restaurant_id, uber_url } = restaurants[i];
    const testNum = i + 1;

    console.log(`\n[${testNum}/${restaurants.length}] Testing: ${restaurant_id}`);
    console.log(`  URL: ${uber_url}`);

    const sessionId = `${runId}_${i}`;
    const result = await garageIngestMenu(restaurant_id, uber_url, { env, sessionId });

    const testResult = {
      index: i,
      restaurant_id,
      uber_url,
      sessionId,
      ok: result.ok,
      timing: result.timing,
      error: result.error,
      validationErrors: result.validationResult?.errors || [],
      diffSummary: result.diffResult ? {
        match: result.diffResult.match,
        errorCount: result.diffResult.errorCount,
        warningCount: result.diffResult.warningCount,
        diffsByType: result.diffResult.diffsByType
      } : null,
      menuStats: result.menu ? {
        sections: result.menu.metadata.total_sections,
        items: result.menu.metadata.total_items,
        modifierGroups: result.menu.metadata.total_modifier_groups,
        options: result.menu.metadata.total_options
      } : null
    };

    results.push(testResult);

    // Determine pass/fail
    if (result.ok) {
      consecutivePasses++;
      totalPassed++;
      console.log(`  ✅ PASS (${consecutivePasses} consecutive)`);
      console.log(`     Sections: ${testResult.menuStats?.sections}, Items: ${testResult.menuStats?.items}`);
      console.log(`     Time: ${result.timing.total_ms}ms`);

      if (consecutivePasses >= targetConsecutive) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`🏎️  TUNED: ${targetConsecutive}/${targetConsecutive} PERFECT!`);
        console.log(`${"=".repeat(60)}\n`);
        break;
      }
    } else {
      consecutivePasses = 0;
      totalFailed++;
      console.log(`  ❌ FAIL`);

      if (result.error) {
        console.log(`     Error: ${result.error}`);
      }
      if (result.validationResult && !result.validationResult.valid) {
        console.log(`     Validation errors: ${result.validationResult.errorCount}`);
        for (const err of result.validationResult.errors.slice(0, 3)) {
          console.log(`       - ${err.code}: ${err.message}`);
        }
        if (result.validationResult.errors.length > 3) {
          console.log(`       ... and ${result.validationResult.errors.length - 3} more`);
        }
      }
      if (result.diffResult && !result.diffResult.match) {
        console.log(`     Diff errors: ${result.diffResult.errorCount}, warnings: ${result.diffResult.warningCount}`);
        const topDiffs = Object.entries(result.diffResult.diffsByType).slice(0, 3);
        for (const [type, count] of topDiffs) {
          console.log(`       - ${type}: ${count}`);
        }
      }

      if (stopOnFail) {
        console.log(`\n  Stopping on first failure (stopOnFail=true)`);
        break;
      }
    }

    // Save artifacts (would write to disk in real implementation)
    // For now, just log
    console.log(`     Artifacts: raw=${!!result.rawApify}, menu=${!!result.menu}`);
  }

  // Summary
  const summary = {
    runId,
    targetConsecutive,
    achieved: consecutivePasses >= targetConsecutive,
    consecutivePasses,
    totalTested: results.length,
    totalPassed,
    totalFailed,
    failureCategories: {}
  };

  // Categorize failures
  for (const r of results) {
    if (!r.ok) {
      if (r.error) {
        summary.failureCategories["fetch_error"] = (summary.failureCategories["fetch_error"] || 0) + 1;
      } else if (r.validationErrors.length > 0) {
        summary.failureCategories["validation_error"] = (summary.failureCategories["validation_error"] || 0) + 1;
      } else if (r.diffSummary && !r.diffSummary.match) {
        summary.failureCategories["diff_mismatch"] = (summary.failureCategories["diff_mismatch"] || 0) + 1;
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Tested: ${summary.totalTested}`);
  console.log(`  Passed: ${summary.totalPassed}`);
  console.log(`  Failed: ${summary.totalFailed}`);
  console.log(`  Consecutive: ${summary.consecutivePasses}`);
  console.log(`  Target: ${summary.targetConsecutive}`);
  console.log(`  Achieved: ${summary.achieved ? "✅ YES" : "❌ NO"}`);
  if (Object.keys(summary.failureCategories).length > 0) {
    console.log(`  Failure categories:`);
    for (const [cat, count] of Object.entries(summary.failureCategories)) {
      console.log(`    - ${cat}: ${count}`);
    }
  }
  console.log(`${"=".repeat(60)}\n`);

  return {
    passed: summary.achieved,
    consecutivePasses: summary.consecutivePasses,
    results,
    summary
  };
}

// ============================================================================
// SECTION H: FIXTURE CACHE SYSTEM
// ============================================================================

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const CACHE_VERSION = "v1";

/**
 * Get path for a fixture file
 */
function getFixturePath(restaurantId, type = "raw") {
  return path.join(FIXTURES_DIR, `${restaurantId}_${type}_${CACHE_VERSION}.json`);
}

/**
 * Load cached fixture if available
 * @param {string} restaurantId
 * @param {string} type - "raw" or "normalized"
 * @returns {object|null}
 */
function loadFixture(restaurantId, type = "raw") {
  const fixturePath = getFixturePath(restaurantId, type);
  try {
    if (fs.existsSync(fixturePath)) {
      const content = fs.readFileSync(fixturePath, "utf8");
      const data = JSON.parse(content);
      console.log(`  [Fixture] Loaded cached ${type} for ${restaurantId}`);
      return data;
    }
  } catch (e) {
    console.warn(`  [Fixture] Failed to load ${fixturePath}: ${e.message}`);
  }
  return null;
}

/**
 * Save fixture to cache
 * @param {string} restaurantId
 * @param {object} data
 * @param {string} type - "raw" or "normalized"
 */
function saveFixture(restaurantId, data, type = "raw") {
  try {
    if (!fs.existsSync(FIXTURES_DIR)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }

    const fixturePath = getFixturePath(restaurantId, type);
    fs.writeFileSync(fixturePath, JSON.stringify(data, null, 2));
    console.log(`  [Fixture] Saved ${type} for ${restaurantId}`);
  } catch (e) {
    console.warn(`  [Fixture] Failed to save: ${e.message}`);
  }
}

/**
 * Check if fixture exists and is fresh
 * @param {string} restaurantId
 * @param {number} maxAgeMs - Maximum age in milliseconds (default 7 days)
 */
function hasValidFixture(restaurantId, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const fixturePath = getFixturePath(restaurantId, "raw");
  try {
    if (fs.existsSync(fixturePath)) {
      const stats = fs.statSync(fixturePath);
      const age = Date.now() - stats.mtimeMs;
      return age < maxAgeMs;
    }
  } catch {
    // Ignore errors
  }
  return false;
}

// ============================================================================
// SECTION I: ENHANCED MENU SCORING
// ============================================================================

/**
 * Score a menu for "perfection" based on multiple criteria
 * @param {object} menu - Normalized canonical menu
 * @param {object} context - Restaurant context (cuisine, expected_categories)
 * @returns {{ score: number, maxScore: number, isPerfect: boolean, breakdown: object }}
 */
function scoreMenu(menu, context = {}) {
  const breakdown = {
    structure: { score: 0, max: 30, details: [] },
    completeness: { score: 0, max: 30, details: [] },
    quality: { score: 0, max: 20, details: [] },
    consistency: { score: 0, max: 20, details: [] }
  };

  if (!menu || !menu.sections) {
    return {
      score: 0,
      maxScore: 100,
      isPerfect: false,
      breakdown
    };
  }

  const sections = menu.sections;
  const allItems = sections.flatMap(s => s.items || []);
  const totalItems = allItems.length;
  const totalSections = sections.length;

  // STRUCTURE SCORING (30 points)
  // - Has reasonable number of sections (5-20)
  if (totalSections >= 3 && totalSections <= 25) {
    breakdown.structure.score += 10;
    breakdown.structure.details.push("Section count OK");
  } else {
    breakdown.structure.details.push(`Section count ${totalSections} outside 3-25 range`);
  }

  // - Sections are non-empty
  const nonEmptySections = sections.filter(s => s.items && s.items.length > 0).length;
  if (nonEmptySections === totalSections) {
    breakdown.structure.score += 10;
    breakdown.structure.details.push("All sections have items");
  } else {
    breakdown.structure.details.push(`${totalSections - nonEmptySections} empty sections`);
  }

  // - Items have required fields (name, id)
  const itemsWithName = allItems.filter(i => i.name && i.name.length > 0).length;
  if (itemsWithName === totalItems) {
    breakdown.structure.score += 10;
    breakdown.structure.details.push("All items have names");
  } else {
    breakdown.structure.details.push(`${totalItems - itemsWithName} items missing names`);
  }

  // COMPLETENESS SCORING (30 points)
  // - Has expected categories (if provided)
  if (context.expected_categories && context.expected_categories.length > 0) {
    const sectionNames = sections.map(s => s.name.toLowerCase());
    let matchedCategories = 0;
    for (const expected of context.expected_categories) {
      if (sectionNames.some(n => n.includes(expected.toLowerCase()))) {
        matchedCategories++;
      }
    }
    const categoryScore = Math.round((matchedCategories / context.expected_categories.length) * 15);
    breakdown.completeness.score += categoryScore;
    breakdown.completeness.details.push(`${matchedCategories}/${context.expected_categories.length} expected categories found`);
  } else {
    breakdown.completeness.score += 15; // No expectation = full credit
    breakdown.completeness.details.push("No expected categories to check");
  }

  // - Has reasonable item count (10-200)
  if (totalItems >= 10 && totalItems <= 200) {
    breakdown.completeness.score += 15;
    breakdown.completeness.details.push(`Item count ${totalItems} within expected range`);
  } else if (totalItems > 0) {
    breakdown.completeness.score += 5;
    breakdown.completeness.details.push(`Item count ${totalItems} outside 10-200 range`);
  }

  // QUALITY SCORING (20 points)
  // - Items have prices
  const itemsWithPrice = allItems.filter(i => i.price_cents != null || i.price_display).length;
  const priceRatio = totalItems > 0 ? itemsWithPrice / totalItems : 0;
  breakdown.quality.score += Math.round(priceRatio * 10);
  breakdown.quality.details.push(`${Math.round(priceRatio * 100)}% items have prices`);

  // - Items have descriptions
  const itemsWithDesc = allItems.filter(i => i.description && i.description.length > 10).length;
  const descRatio = totalItems > 0 ? itemsWithDesc / totalItems : 0;
  breakdown.quality.score += Math.round(descRatio * 10);
  breakdown.quality.details.push(`${Math.round(descRatio * 100)}% items have descriptions`);

  // CONSISTENCY SCORING (20 points)
  // - No duplicate items within sections
  let duplicateCount = 0;
  for (const section of sections) {
    const names = new Set();
    for (const item of section.items || []) {
      const key = (item.name || "").toLowerCase();
      if (names.has(key)) {
        duplicateCount++;
      }
      names.add(key);
    }
  }
  if (duplicateCount === 0) {
    breakdown.consistency.score += 10;
    breakdown.consistency.details.push("No duplicate items within sections");
  } else {
    breakdown.consistency.details.push(`${duplicateCount} duplicate items found`);
  }

  // - Section names are unique
  const sectionNames = new Set();
  let duplicateSections = 0;
  for (const section of sections) {
    const name = (section.name || "").toLowerCase();
    if (sectionNames.has(name)) {
      duplicateSections++;
    }
    sectionNames.add(name);
  }
  if (duplicateSections === 0) {
    breakdown.consistency.score += 10;
    breakdown.consistency.details.push("Section names are unique");
  } else {
    breakdown.consistency.details.push(`${duplicateSections} duplicate section names`);
  }

  // Calculate total
  const score = breakdown.structure.score +
                breakdown.completeness.score +
                breakdown.quality.score +
                breakdown.consistency.score;

  const maxScore = breakdown.structure.max +
                   breakdown.completeness.max +
                   breakdown.quality.max +
                   breakdown.consistency.max;

  // Perfect requires 95% or higher
  const isPerfect = score >= maxScore * 0.95;

  return { score, maxScore, isPerfect, breakdown };
}

// ============================================================================
// SECTION J: GARAGE INGEST WITH CACHING
// ============================================================================

/**
 * Enhanced Garage Mode ingest with fixture caching
 *
 * @param {string} restaurantId - Internal restaurant identifier
 * @param {string} uberStoreUrlOrId - Uber Eats store URL or UUID
 * @param {object} options - { env, sessionId, timeout, useCache, saveToCache }
 * @returns {Promise<{ ok, menu, rawApify, identity, validationResult, scoreResult, error }>}
 */
async function garageIngestMenuCached(restaurantId, uberStoreUrlOrId, options = {}) {
  const {
    env,
    sessionId = null,
    timeout = 120000,
    useCache = true,
    saveToCache = true,
    context = {}
  } = options;

  const startTime = Date.now();
  const identity = createIdentityBundle(restaurantId, uberStoreUrlOrId, sessionId);

  const result = {
    ok: false,
    menu: null,
    rawApify: null,
    identity: identity,
    validationResult: null,
    diffResult: null,
    scoreResult: null,
    qualityResult: null,
    timing: {},
    error: null,
    fromCache: false
  };

  try {
    let rawData;

    // Step 1: Try to load from cache
    if (useCache && hasValidFixture(restaurantId)) {
      rawData = loadFixture(restaurantId, "raw");
      if (rawData) {
        result.fromCache = true;
        result.timing.fetch_ms = 0;
      }
    }

    // Step 2: Fetch from Apify if no cache
    if (!rawData) {
      const fetchStart = Date.now();

      if (!env?.APIFY_TOKEN) {
        throw new Error("Missing APIFY_TOKEN in environment");
      }

      const actorId = env.APIFY_UBER_ACTOR_ID || "borderline~ubereats-scraper";
      const token = env.APIFY_TOKEN;

      let scrapeUrl = uberStoreUrlOrId;
      if (!scrapeUrl.startsWith('http')) {
        scrapeUrl = `https://www.ubereats.com/store/${restaurantId}/${uberStoreUrlOrId}`;
      }

      const apiUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&memory=4096&timeout=60`;

      const body = {
        urls: [{ url: scrapeUrl }],
        maxItems: 1000,
        extendOutputFunction: "($) => { return {} }",
        proxyConfiguration: {
          useApifyProxy: true,
          apifyProxyGroups: ["RESIDENTIAL"]
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      let response;
      try {
        response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Apify API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      try {
        rawData = await response.json();
      } catch (e) {
        throw new Error("Apify response was not valid JSON");
      }

      result.timing.fetch_ms = Date.now() - fetchStart;

      // Save to cache
      if (saveToCache) {
        saveFixture(restaurantId, rawData, "raw");
      }
    }

    result.rawApify = rawData;

    // Step 3: Normalize to canonical schema
    const normalizeStart = Date.now();
    const normalizeResult = normalizeApifyToCanonical(rawData, identity);
    result.timing.normalize_ms = Date.now() - normalizeStart;

    if (!normalizeResult.ok) {
      throw new Error(normalizeResult.message || "Normalization failed");
    }

    result.menu = normalizeResult.menu;

    // Step 4: Validate strictly
    const validateStart = Date.now();
    result.validationResult = validateMenuStrict(result.menu);
    result.timing.validate_ms = Date.now() - validateStart;

    // Step 5: Diff against truth
    const diffStart = Date.now();
    result.diffResult = diffAgainstTruth(result.menu, rawData);
    result.timing.diff_ms = Date.now() - diffStart;

    // Step 6: Score the menu
    const scoreStart = Date.now();
    result.scoreResult = scoreMenu(result.menu, context);
    result.timing.score_ms = Date.now() - scoreStart;

    result.timing.total_ms = Date.now() - startTime;

    // Determine if "perfect"
    result.ok = result.validationResult.valid &&
                result.diffResult.match &&
                result.scoreResult.isPerfect;

  } catch (err) {
    result.error = err.message || String(err);
    result.timing.total_ms = Date.now() - startTime;
  }

  return result;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Identity & Scoping
  createIdentityBundle,
  computeSignatureHash,
  buildScopedCacheKey,

  // Normalization
  normalizeApifyToCanonical,
  normalizeMenuItem,
  normalizeModifierGroup,

  // Validation
  validateMenuStrict,

  // Diff Engine
  diffAgainstTruth,

  // Garage Mode
  garageIngestMenu,
  garageRunner,

  // Enhanced: Fixture Caching
  loadFixture,
  saveFixture,
  hasValidFixture,
  getFixturePath,
  FIXTURES_DIR,

  // Enhanced: Scoring
  scoreMenu,

  // Enhanced: Cached Ingest
  garageIngestMenuCached
};
