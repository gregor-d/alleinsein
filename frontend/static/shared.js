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
 */
function resolveColors(preset) {
  const colors = [...COLORMAP_PRESETS[preset]];
  return colors;
}

/**
 * Builds a CSS background value from a named COLORMAP_PRESETS entry: the colours
 * shown as equal-width discrete blocks (one per data bucket)
 *
 * Drawn "to left" so the highest bucket (colors[0]) sits on the right, matching
 * the legend's "higher →".
 *
 * forceFull ignores hotspot mode and always renders the full ramp (the scheme
 * picker uses this). In hotspot mode (unless forceFull), or for single-colour
 * presets, only the one colour in use is shown as a solid swatch.
 */
function buildGradient(preset, opts) {
  opts = opts || {};
  const colors = resolveColors(preset);

  // Hotspot mode (and degenerate single-colour presets) collapse to a solid swatch.
  if ((hotspotMode && !opts.forceFull) || colors.length <= 1) {
    return colors[4] || "transparent";
  }

  // Equal-width blocks with hard edges (each colour spans [from%, to%] with no
  // blend into its neighbour).
  const step = 100 / colors.length;
  const stops = colors.map(function (color, i) {
    return `${color} ${step * i}%, ${color} ${step * (i + 1)}%`;
  });

  return `linear-gradient(to left, ${stops.join(", ")})`;
}

// Each category layer occupies a contiguous run of CATEGORY_SPAN raster values
// starting at layer.start — the road-influence index A (1..10) offset per land
// cover (see raster/create_raster.sh: A, A+10, A+20, A+30). Note the colormap
// only colours the first 9 of these, so A=10 pixels are valid data but render
// transparent.
const CATEGORY_SPAN = 10;

/**
 * Decodes a raw raster pixel value into its area type and within-category bucket.
 *
 * Category layers store A (1..10) offset by layer.start; bucket = value - start,
 * so bucket 0 (A=1, least road influence) is the most-alone end — the one hotspot
 * mode highlights. `solid` layers (Water) use a single value. Returns null for
 * nodata / unmapped values.
 *
 * Shape: { area: "Parks", bucket: 2, value: 23 }  (bucket is null for solid layers).
 */
function describePixelValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  for (let i = 0; i < layerState.length; i++) {
    const layer = layerState[i];
    if (layer.type === "overlay") continue;
    if (layer.type === "solid") {
      if (value === layer.start)
        return { area: layer.id, bucket: null, value: value };
    } else if (value >= layer.start && value < layer.start + CATEGORY_SPAN) {
      return { area: layer.id, bucket: value - layer.start, value: value };
    }
  }
  return null;
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

    const colors = resolveColors(layer.preset);
    if (hotspotMode) {
      // Hotspot mode highlights the two highest buckets, each in its own colour.
      cmap[layer.start] = hexToRgba(colors[4]);
      // cmap[layer.start + 1] = hexToRgba(colors[1]);
      cmap[layer.start + 1] = hexToRgba(colors[4]);
    } else {
      colors.forEach(function (color, i) {
        cmap[layer.start + i] = hexToRgba(color);
      });
    }
  });
  return JSON.stringify(cmap);
}

/**
 * Colormap for the "Slope spots" band (data band 2). Per visible category layer it
 * reuses that layer's own ramp but only its first four colours, mapped to the four
 * slope classes of the most-secluded group (start..start+3, where start+0 = steepest
 * => colors[0], the darkest). Everything else is left unmapped and so renders
 * transparent — "all but the first four ramp colours" hidden per land cover.
 */
function getHotspotSlopeColormapJson() {
  const cmap = {};
  layerState.forEach(function (layer) {
    if (!layer.visible || layer.type !== "category") return;
    const colors = resolveColors(layer.preset);
    for (let i = 0; i < 4; i++) {
      cmap[layer.start + i] = hexToRgba(colors[i]);
    }
  });
  return JSON.stringify(cmap);
}

/**
 * Triggers a full data layer refresh on the active map engine:
 *  - "Slope spots": pin the 2-band raster, render band 2 with the first-four-colours ramp.
 *  - "Slope map": pin the fully slope-modified raster, render band 1 with the normal ramp.
 *  - default: render band 1 of the tiered/override raster with the combined colormap.
 */
function refreshDataLayer() {
  if (!mapEngine) return;
  if (slopeHotspotMode) {
    mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity, {
      bidx: 1,
      raster: CONFIG.slope_hotspot_raster,
    });
  } else if (slopeModifiedMode) {
    mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity, {
      bidx: 1,
      raster: CONFIG.slope_modified_raster,
    });
  } else {
    mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity, {
      bidx: 1,
    });
  }
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
