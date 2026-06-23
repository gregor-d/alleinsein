// ─────────────────────────────────────────────
//  SHARED.JS — State, helpers, layout builders
// ─────────────────────────────────────────────

// ─── COLORMAP HELPERS ───

/**
 * Converts a CSS hex colour string (e.g. '#ff0000') to an [r, g, b, 255] RGBA array
 * suitable for use as a TileJSON colormap entry.
 */
function hexToRgba(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b, 255];
}

/**
 * Returns the colour list for a named COLORMAP_PRESETS entry as a fresh array,
 * reversed when reverse is true (never mutates the preset).
 */
function resolveColors(preset, reverse) {
  const colors = [...COLORMAP_PRESETS[preset]];
  return reverse ? colors.reverse() : colors;
}

/**
 * Builds a CSS background value from a named COLORMAP_PRESETS entry.
 * Reverses the colour order when reverse is true.
 *
 * By default the highest colour fills the first 20% of the bar as a solid block,
 * with the remaining colours spread linearly across the rest. Options:
 *   - forceFull: ignore hotspot mode and always render the full ramp
 *     (the scheme picker uses this).
 *   - linear:    spread all colours evenly with no 20% emphasis block.
 * In hotspot mode (unless forceFull) only the single colour actually used is
 * shown, as a solid swatch.
 */
function buildGradient(preset, reverse, opts) {
  opts = opts || {};
  const colors = resolveColors(preset, reverse);

  // Hotspot mode (and degenerate single-colour presets) collapse to a solid swatch.
  if ((hotspotMode && !opts.forceFull) || colors.length <= 1) {
    return colors[0] || "transparent";
  }

  let stops;
  if (opts.linear) {
    // Even spread across the whole bar.
    const step = 100 / (colors.length - 1);
    stops = colors.map(function (color, i) {
      return `${color} ${step * i}%`;
    });
  } else {
    // Highest colour fills the first 20%; the rest spread across 20–100%.
    const firstColorWidth = 20;
    const step = (100 - firstColorWidth) / (colors.length - 1);
    stops = [`${colors[0]} 0%`].concat(
      colors.map(function (color, i) {
        return `${color} ${firstColorWidth + step * i}%`;
      }),
    );
  }

  return `linear-gradient(to left, ${stops.join(", ")})`;
}

/**
 * Combines all visible layers into a single colormap JSON string
 * to be sent as a query parameter to the tile server.
 */
function getCombinedColormapJson() {
  const cmap = {};
  layerState.forEach(function (layer) {
    if (!layer.visible || layer.type === "overlay") return;

    if (layer.type === "solid") {
      cmap[layer.start] = hexToRgba(layer.preset);
      return;
    }

    const colors = resolveColors(layer.preset, layer.reverse);
    if (hotspotMode) {
      cmap[layer.start] = hexToRgba(colors[0]);
    } else {
      colors.forEach(function (color, i) {
        cmap[layer.start + i] = hexToRgba(color);
      });
    }
  });
  return JSON.stringify(cmap);
}

/**
 * Triggers a full data layer refresh on the active map engine
 * using the current layer visibility and colormap settings.
 */
function refreshDataLayer() {
  if (mapEngine)
    mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity);
}

// ─── GEO HELPERS ───

/**
 * Great-circle distance in metres between two [lng, lat] points (haversine).
 */
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Formats a distance in metres as a human-readable string (m below 1 km, otherwise km).
 */
function formatDistance(meters) {
  if (meters < 1000) return Math.round(meters) + " m";
  return (meters / 1000).toFixed(meters < 10000 ? 2 : 1) + " km";
}

// ─── ENGINE STATE ───

let mapEngine = null;

/**
 * Runs after every engine initialisation: applies the active basemap,
 * opacity settings, overlay states, and on first load flies to the IP-geolocated position.
 */
function afterEngineInit(isFirstLoad) {
  mapEngine.switchBasemap(activeBasemapKey);
  mapEngine.updateBasemapOpacity(basemapOpacity);
  refreshDataLayer();

  for (const key in activeOverlays) {
    if (activeOverlays[key]) {
      mapEngine.toggleOverlay(key, true);
    }
  }

  if (isFirstLoad) {
    showLocationPrompt();
  }
}
