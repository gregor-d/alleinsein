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
 * Builds a CSS linear-gradient string from a named COLORMAP_PRESETS entry.
 * Reverses the colour order when reverse is true. First color makes up 20 percent
 */
function buildGradient(preset, reverse) {
    let colors = [...COLORMAP_PRESETS[preset]];
    if (reverse) colors = [...colors].reverse();

    if (colors.length <= 1) {
        const color = colors[0] || 'transparent';
        return `linear-gradient(to right, ${color} 0%, ${color} 100%)`;
    }

    const firstColorWidth = 20;
    const stops = [`${colors[0]} 0%`, `${colors[0]} ${firstColorWidth}%`];

    const step = (100 - firstColorWidth) / (colors.length - 1);
    colors.forEach(function(color, index) {
        stops.push(`${color} ${firstColorWidth + step * index}%`);
    });

    return `linear-gradient(to left, ${stops.join(', ')})`;
}

/**
 * Combines all visible layers into a single colormap JSON string
 * to be sent as a query parameter to the tile server.
 */
function getCombinedColormapJson() {
    const cmap = {};
    layerState.forEach(function(layer) {
        if (!layer.visible) return;
        if (layer.type === 'overlay') return;
        if (layer.type === 'solid') {
            cmap[layer.start] = hexToRgba(layer.preset);
        } else {
            let colors = [...COLORMAP_PRESETS[layer.preset]];
            if (layer.reverse) colors.reverse();
            if (hotspotMode) {
                cmap[layer.start] = hexToRgba(colors[0]);
            } else {
                for (let i = 0; i < 9; i++) cmap[layer.start + i] = hexToRgba(colors[i]);
            }
        }
    });
    return JSON.stringify(cmap);
}

/**
 * Triggers a full data layer refresh on the active map engine
 * using the current layer visibility and colormap settings.
 */
function refreshDataLayer() {
    if (mapEngine) mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity);
}

// ─── ENGINE STATE ───

let activeEngine = localStorage.getItem('map-engine') || 'leaflet';
let mapEngine = null;

/**
 * Switches the active map engine to newKey ('leaflet' or 'maplibre').
 * Preserves the current center and zoom, destroys the old engine,
 * re-creates the map container element, and initialises the new engine.
 */
function switchEngine(newKey) {
    if (newKey === activeEngine && mapEngine) return;

    let center = DEFAULT_CENTER;
    let zoom   = DEFAULT_ZOOM;
    if (mapEngine) {
        center = mapEngine.getCenter();
        zoom   = mapEngine.getZoom();
        mapEngine.destroy();
    }

    const oldEl = document.getElementById('map');
    oldEl.parentNode.replaceChild(oldEl.cloneNode(false), oldEl);

    activeEngine = newKey;
    localStorage.setItem('map-engine', activeEngine);

    const ctor = activeEngine === 'leaflet' ? LeafletEngine : MapLibreEngine;
    mapEngine = new ctor();
    mapEngine.init('map', center, zoom, NAV_CONTROL_POSITIONS[activeEngine])
        .then(function() { afterEngineInit(false); });

}

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
        getIpLocation().then(function(coords) {
            if (coords && mapEngine) {
                setTimeout(function() {
                    if (mapEngine) {
                        mapEngine.flyTo(coords, CONFIG.location_zoom);
                    }
                }, 1000);
            }
        });
    }
}
