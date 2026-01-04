/**
 * Legacy Menu Source Deprecation Layer
 *
 * DEPRECATED — DO NOT USE — Replaced by in-house Uber Menu Pipeline
 *
 * This module provides deprecation wrappers for:
 * - Apify Uber Eats actors
 * - RapidAPI Uber Eats endpoints
 *
 * All menu requests should route through:
 * - menuGateway.cjs → getMenuForApp()
 *
 * Feature Flag:
 * - USE_LEGACY_MENU_SOURCE = false (default) → use in-house pipeline
 * - USE_LEGACY_MENU_SOURCE = true → enable legacy sources (rollback only)
 */

// DEPRECATED — DO NOT USE — Replaced by in-house Uber Menu Pipeline

const DEPRECATION_WARNING = {
  deprecated: true,
  replacement: "menuGateway.getMenuForApp()",
  docs: [
    "FINAL_PIPELINE_README.md",
    "FINAL_PIPELINE_V2_README.md"
  ]
};

/**
 * Check if legacy sources are enabled (rollback mode)
 */
function isLegacyEnabled(env = {}) {
  const flag = env?.USE_LEGACY_MENU_SOURCE ||
               (typeof process !== "undefined" ? process.env?.USE_LEGACY_MENU_SOURCE : null) ||
               "false";

  return flag === "true" || flag === "1";
}

/**
 * DEPRECATED: Apify fetch wrapper
 *
 * @deprecated Use menuGateway.getMenuForApp() instead
 */
function deprecatedApifyFetch(env, query, address, maxRows, locale) {
  if (!isLegacyEnabled(env)) {
    console.warn("[DEPRECATED] Apify fetch blocked - USE_LEGACY_MENU_SOURCE=false");
    console.warn("[DEPRECATED] Use menuGateway.getMenuForApp() instead");

    return Promise.reject(new Error(
      "Apify is deprecated. Set USE_LEGACY_MENU_SOURCE=true for rollback or migrate to menuGateway.getMenuForApp()"
    ));
  }

  // Legacy mode enabled - log warning but allow
  console.warn("[LEGACY MODE] Apify fetch called - this is deprecated");
  console.warn("[LEGACY MODE] Migrate to menuGateway.getMenuForApp()");

  // Return null to indicate caller should use original implementation
  return null;
}

/**
 * DEPRECATED: RapidAPI fetch wrapper
 *
 * @deprecated Use menuGateway.getMenuForApp() instead
 */
function deprecatedRapidApiFetch(env, query, address, maxRows, lat, lng, radius) {
  if (!isLegacyEnabled(env)) {
    console.warn("[DEPRECATED] RapidAPI fetch blocked - USE_LEGACY_MENU_SOURCE=false");
    console.warn("[DEPRECATED] Use menuGateway.getMenuForApp() instead");

    return Promise.reject(new Error(
      "RapidAPI is deprecated. Set USE_LEGACY_MENU_SOURCE=true for rollback or migrate to menuGateway.getMenuForApp()"
    ));
  }

  // Legacy mode enabled - log warning but allow
  console.warn("[LEGACY MODE] RapidAPI fetch called - this is deprecated");
  console.warn("[LEGACY MODE] Migrate to menuGateway.getMenuForApp()");

  // Return null to indicate caller should use original implementation
  return null;
}

/**
 * DEPRECATED: Apify async start wrapper
 *
 * @deprecated Scrapers no longer run on user request
 */
function deprecatedApifyStartAsync(env, query, address, maxRows, locale, jobId) {
  if (!isLegacyEnabled(env)) {
    console.warn("[DEPRECATED] Apify async start blocked - scrapers no longer run on user request");

    return Promise.reject(new Error(
      "Scrapers no longer run on user request. Menus are served from cache. Use menuGateway.getMenuForApp()"
    ));
  }

  console.warn("[LEGACY MODE] Apify async start called - this is deprecated");
  return null;
}

/**
 * DEPRECATED: Tiered scraper wrapper
 *
 * @deprecated Use menuGateway.getMenuForApp() instead
 */
function deprecatedTieredFetch(env, query, address, maxRows, locale, lat, lng, radius) {
  if (!isLegacyEnabled(env)) {
    console.warn("[DEPRECATED] Tiered scraper blocked - USE_LEGACY_MENU_SOURCE=false");

    return Promise.reject(new Error(
      "Tiered scraper is deprecated. Use menuGateway.getMenuForApp()"
    ));
  }

  console.warn("[LEGACY MODE] Tiered scraper called - this is deprecated");
  return null;
}

/**
 * Get deprecation status for monitoring
 */
function getDeprecationStatus(env = {}) {
  return {
    legacy_enabled: isLegacyEnabled(env),
    deprecated_sources: [
      {
        name: "Apify Uber Eats Actor",
        status: "deprecated",
        endpoints: [
          "/api/apify-start",
          "/webhook/apify",
          "/api/apify-job/:jobId",
          "/debug/apify"
        ]
      },
      {
        name: "RapidAPI Uber Eats",
        status: "deprecated",
        endpoints: [
          "/debug/rapid",
          "/debug/rapid-job",
          "/debug/uber-tiered"
        ]
      }
    ],
    active_source: {
      name: "In-house Uber Menu Pipeline",
      status: "active",
      endpoints: [
        "GET /menu/{restaurant_slug}?location={location_slug}"
      ],
      modules: [
        "menuGateway.cjs",
        "menuTierResolver.cjs",
        "serveMenu.cjs",
        "franchiseResolver.cjs",
        "menuConfidence.cjs",
        "menuJudge.cjs"
      ]
    },
    rollback_instructions: {
      enable: "Set USE_LEGACY_MENU_SOURCE=true in environment",
      disable: "Set USE_LEGACY_MENU_SOURCE=false (default)"
    }
  };
}

/**
 * Log deprecation event for monitoring
 */
function logDeprecationEvent(source, endpoint, env = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    type: "DEPRECATION_CALL",
    source: source,
    endpoint: endpoint,
    legacy_enabled: isLegacyEnabled(env),
    blocked: !isLegacyEnabled(env)
  };

  console.log(`[DEPRECATION] ${JSON.stringify(event)}`);

  return event;
}

module.exports = {
  DEPRECATION_WARNING,
  isLegacyEnabled,
  deprecatedApifyFetch,
  deprecatedRapidApiFetch,
  deprecatedApifyStartAsync,
  deprecatedTieredFetch,
  getDeprecationStatus,
  logDeprecationEvent
};
