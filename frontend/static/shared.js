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
 * Reverses the colour order when reverse is true.
 */
function buildGradient(preset, reverse) {
    let colors = [...COLORMAP_PRESETS[preset]];
    if (reverse) colors = [...colors].reverse();
    return `linear-gradient(to right, ${colors.join(', ')})`;
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
let _popupHandlerAttached = false;

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

    document.querySelectorAll('.control-btn[data-engine]').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.engine === activeEngine);
    });
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

/**
 * Marks the button matching the active engine as active and wires each button
 * to call switchEngine when clicked.
 */
function initEngineBtns(container) {
    container.querySelectorAll('.control-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.engine === activeEngine);
        btn.addEventListener('click', function() { switchEngine(btn.dataset.engine); });
    });
}

// ─── VISIBILITY SYNC ───

/**
 * Syncs all live UI elements (strip chip, drawer checkbox) to a layer's current
 * visible state after it has been toggled programmatically.
 */
function syncLayerVisible(layer) {
    const layerChip = document.getElementById(`layer-chip-${layer.id}`);
    if (layerChip) {
        layerChip.classList.toggle('active', layer.visible);
        layerChip.setAttribute('aria-checked', String(layer.visible));
    }
    const dcb = document.getElementById(`dvis-${layer.id}`);
    if (dcb) {
        dcb.checked = layer.visible;
        const dcard = dcb.closest('.layer-card');
        if (dcard) dcard.classList.toggle('inactive', !layer.visible);
    }
}

// ─── COLOR SYNC ───

/**
 * Updates the colour swatch or gradient bar in all live UI elements
 * to reflect the layer's current preset and reverse setting.
 */
function syncLayerColor(layer) {
    if (layer.type === 'overlay') return;
    const chipColor = document.getElementById(`layer-chip-color-${layer.id}`);
    if (!chipColor) return;
    chipColor.style.background = layer.type === 'category'
        ? buildGradient(layer.preset, layer.reverse)
        : layer.preset;
}

/**
 * Repaints the gradient bar inside the drawer card for the given layer.
 */
function updateDrawerBar(layer) {
    const bar = document.getElementById(`dbar-${layer.id}`);
    if (bar) bar.style.background = buildGradient(layer.preset, layer.reverse);
}

// ─── BASEMAP BLOCK ───

/**
 * Renders a reusable basemap control block into the given element.
 * Handles basemap toggle, basemap selector buttons, overlay buttons,
 * basemap opacity slider, and optionally a data layer opacity slider.
 */
function buildBasemapBlock(el, opts) {
    opts = opts || {};
    const uid = el.id || ('bm' + Math.random().toString(36).slice(2, 7));

    const isEnabled  = activeBasemapKey !== 'none';
    const uiBaseKey  = activeBasemapKey === 'none' ? 'osm' : activeBasemapKey;

    el.innerHTML = `
        <div class="bm-row">
            <div class="bm-row-label" style="display:flex;justify-content:space-between;align-items:center;">
                <span>Basemap</span>
                <label class="toggle">
                    <input type="checkbox" id="bm-toggle-${uid}" ${isEnabled ? 'checked' : ''} />
                    <span class="toggle-track"></span>
                </label>
            </div>
            <div class="control-options" id="bm-opts-${uid}" style="${!isEnabled ? 'opacity:0.5;pointer-events:none;' : ''}">
                <button class="control-btn${uiBaseKey === 'osm'         ? ' active' : ''}" data-key="osm">OSM</button>
                <button class="control-btn${uiBaseKey === 'satellite'   ? ' active' : ''}" data-key="satellite">Satellite</button>
                <button class="control-btn${uiBaseKey === 'schummerung' ? ' active' : ''}" data-key="schummerung">Relief</button>
            </div>
            <div class="ctrl-row">
                <div class="ctrl-label">
                    <span>Basemap Opacity</span>
                    <span class="val" id="bm-op-val-${uid}">${Math.round(basemapOpacity * 100)}%</span>
                </div>
                <input type="range" id="bm-op-${uid}" min="0" max="1" step="0.01" value="${basemapOpacity}" />
            </div>
        </div>
        <div class="bm-row" style="margin-top:10px;">
            <div class="bm-row-label">Overlays</div>
            <div class="control-options" style="padding:0;">
                <button class="control-btn${activeOverlays.hiking  ? ' active' : ''}" data-overlay="hiking">Hiking</button>
                <button class="control-btn${activeOverlays.cycling ? ' active' : ''}" data-overlay="cycling">Cycling</button>
            </div>
        </div>
        ${opts.includeDataLayerOpacity ? `
        <div class="ctrl-row" style="margin-top:10px;">
            <div class="ctrl-label">
                <span>Data Layer Opacity</span>
                <span class="val" id="dl-op-val-${uid}">${Math.round(dataLayerOpacity * 100)}%</span>
            </div>
            <input type="range" id="dl-op-${uid}" min="0" max="1" step="0.01" value="${dataLayerOpacity}" />
        </div>
        ` : ''}
    `;

    document.getElementById(`bm-toggle-${uid}`).addEventListener('change', function(e) {
        const enabled = e.target.checked;
        const optsDiv = document.getElementById(`bm-opts-${uid}`);
        if (enabled) {
            optsDiv.style.opacity = '1';
            optsDiv.style.pointerEvents = 'auto';
            if (activeBasemapKey === 'none') {
                activeBasemapKey = 'osm';
                el.querySelectorAll('.control-btn[data-key]').forEach(function(b) {
                    b.classList.toggle('active', b.dataset.key === activeBasemapKey);
                });
            }
            if (mapEngine) mapEngine.switchBasemap(activeBasemapKey);
        } else {
            optsDiv.style.opacity = '0.5';
            optsDiv.style.pointerEvents = 'none';
            if (mapEngine) mapEngine.switchBasemap('none');
        }
    });

    el.querySelectorAll('.control-btn[data-key]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            activeBasemapKey = btn.dataset.key;
            if (mapEngine) mapEngine.switchBasemap(activeBasemapKey);
            el.querySelectorAll('.control-btn[data-key]').forEach(function(b) {
                b.classList.toggle('active', b.dataset.key === activeBasemapKey);
            });
        });
    });

    el.querySelectorAll('button[data-overlay]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const key = btn.dataset.overlay;
            activeOverlays[key] = !activeOverlays[key];
            document.querySelectorAll(`button[data-overlay="${key}"]`).forEach(function(b) {
                b.classList.toggle('active', activeOverlays[key]);
            });
            if (mapEngine) mapEngine.toggleOverlay(key, activeOverlays[key]);
        });
    });

    document.getElementById(`bm-op-${uid}`).addEventListener('input', function(e) {
        basemapOpacity = parseFloat(e.target.value);
        document.getElementById(`bm-op-val-${uid}`).textContent = `${Math.round(basemapOpacity * 100)}%`;
        if (mapEngine) mapEngine.updateBasemapOpacity(basemapOpacity);
    });

    if (opts.includeDataLayerOpacity) {
        document.getElementById(`dl-op-${uid}`).addEventListener('input', function(e) {
            dataLayerOpacity = parseFloat(e.target.value);
            document.getElementById(`dl-op-val-${uid}`).textContent = `${Math.round(dataLayerOpacity * 100)}%`;
            if (mapEngine) mapEngine.updateDataLayerOpacity(dataLayerOpacity);
        });
    }
}

// ─── LAYER STRIP CARD ───

const _eyeOpenSvg = `<svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const _eyeOffSvg  = `<svg class="eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

/**
 * Creates and returns a layer strip card DOM element for the given layer.
 * Top half: name + eye icon (click = toggle visibility).
 * Divider.
 * Bottom half: colour ramp (click = open colour sheet) or solid swatch.
 */
function makeL4LayerCard(layer) {
    const key  = layer.id.toLowerCase();
    const card = document.createElement('div');
    card.className = `control-btn layer-strip-card layer-chip layer-chip--${key}${layer.visible ? ' active' : ''}`;
    card.id = `layer-chip-${layer.id}`;
    card.tabIndex = 0;
    card.setAttribute('role', 'switch');
    card.setAttribute('aria-checked', String(layer.visible));

    // Top half — name + eye icon
    const top = document.createElement('div');
    top.className = 'layer-strip-card-top';

    const eyeEl = document.createElement('span');
    eyeEl.className = 'layer-chip-eye';
    eyeEl.innerHTML = _eyeOpenSvg + _eyeOffSvg;
    top.appendChild(eyeEl);

    const nameEl = document.createElement('span');
    nameEl.className   = 'layer-name';
    nameEl.textContent = layer.id;
    top.appendChild(nameEl);
    card.appendChild(top);

    // Divider
    const divider = document.createElement('div');
    divider.className = 'layer-strip-divider';
    card.appendChild(divider);

    // Bottom half — ramp / swatch
    const bottom = document.createElement('div');
    bottom.className = 'layer-strip-card-bottom';

    if (layer.type === 'category') {
        const ramp = document.createElement('div');
        ramp.className = 'layer-strip-ramp';
        ramp.id = `layer-chip-color-${layer.id}`;
        ramp.style.background = buildGradient(layer.preset, layer.reverse);
        ramp.addEventListener('click', function(e) { e.stopPropagation(); openColorSheet(layer); });
        bottom.appendChild(ramp);
    } else if (layer.type === 'solid') {
        const swatch = document.createElement('div');
        swatch.className = 'layer-strip-solid-swatch';
        swatch.id = `layer-chip-color-${layer.id}`;
        swatch.style.background = layer.preset;

        const picker = document.createElement('input');
        picker.type     = 'color';
        picker.value    = layer.preset;
        picker.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none;';
        card.appendChild(picker);

        swatch.addEventListener('click', function(e) { e.stopPropagation(); picker.click(); });
        picker.addEventListener('input', function(e) {
            layer.preset           = e.target.value;
            swatch.style.background = layer.preset;
            refreshDataLayer();
        });
        bottom.appendChild(swatch);
    }
    card.appendChild(bottom);

    function toggleLayer() {
        layer.visible = !layer.visible;
        syncLayerVisible(layer);
        refreshDataLayer();
    }

    card.addEventListener('click', toggleLayer);
    card.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleLayer();
    });

    return card;
}

// ─── HOTSPOT CHIP ───

const _flameSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`;

function makeHotspotChip() {
    const card = document.createElement('div');
    card.className = `control-btn layer-strip-card layer-chip layer-chip--hotspot${hotspotMode ? ' active' : ''}`;
    card.id = 'hotspot-chip';
    card.tabIndex = 0;
    card.setAttribute('role', 'switch');
    card.setAttribute('aria-checked', String(hotspotMode));
    card.title = 'Hotspot — show top values only';

    const top = document.createElement('div');
    top.className = 'layer-strip-card-top';
    const iconEl = document.createElement('span');
    iconEl.className = 'hotspot-icon';
    iconEl.innerHTML = _flameSvg;
    top.appendChild(iconEl);
    const nameEl = document.createElement('span');
    nameEl.className   = 'layer-name';
    nameEl.textContent = 'Hotspot';
    top.appendChild(nameEl);
    card.appendChild(top);

    const divider = document.createElement('div');
    divider.className = 'layer-strip-divider';
    card.appendChild(divider);

    const bottom = document.createElement('div');
    bottom.className = 'layer-strip-card-bottom layer-strip-card-bottom--hotspot';
    bottom.innerHTML = `
        <div class="hotspot-toggle-row">
            <span class="hotspot-side-label hotspot-no-label">NO</span>
            <label class="toggle hotspot-chip-toggle" style="pointer-events:none;">
                <input type="checkbox" id="hotspot-chip-input" ${hotspotMode ? 'checked' : ''} style="pointer-events:none;" />
                <span class="toggle-track"></span>
            </label>
            <span class="hotspot-side-label hotspot-top-label">TOP</span>
        </div>`;
    card.appendChild(bottom);

    function toggleHotspot() {
        hotspotMode = !hotspotMode;
        syncHotspotMode();
        refreshDataLayer();
    }

    card.addEventListener('click', toggleHotspot);
    card.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleHotspot();
    });

    return card;
}

function syncHotspotMode() {
    const chip = document.getElementById('hotspot-chip');
    if (chip) {
        chip.classList.toggle('active', hotspotMode);
        chip.setAttribute('aria-checked', String(hotspotMode));
    }
    const chipInput = document.getElementById('hotspot-chip-input');
    if (chipInput) chipInput.checked = hotspotMode;
    const drawerCard = document.getElementById('drawer-hotspot-card');
    if (drawerCard) drawerCard.classList.toggle('active', hotspotMode);
    const drawerToggle = document.getElementById('drawer-hotspot-toggle');
    if (drawerToggle) drawerToggle.checked = hotspotMode;
}

// ─── COLOR SHEET ───

/**
 * Opens the colour scheme bottom sheet for the given layer.
 * Header row mirrors the drawer layer-header (toggle · name · gradient bar · reverse · close).
 * Body contains the palette grid and data-layer opacity slider.
 * No backdrop — the map remains fully interactive behind the sheet.
 */
function openColorSheet(layer) {
    const header = document.getElementById('color-sheet-header');
    const body   = document.getElementById('color-sheet-body');

    header.innerHTML = `
        <label class="toggle">
            <input type="checkbox" id="cs-vis" ${layer.visible ? 'checked' : ''} />
            <span class="toggle-track"></span>
        </label>
        <span class="layer-name">${layer.id}</span>
        <div class="color-sheet-gradient-bar" id="cs-bar" style="background:${buildGradient(layer.preset, layer.reverse)};"></div>
        <button class="btn-reverse${layer.reverse ? ' active' : ''}" id="cs-rev">&#x21C4;</button>
        <button class="icon-btn" id="cs-close" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
        </button>`;

    const schemeBtns = Object.keys(COLORMAP_PRESETS)
        .map(function(k) {
            return `<button class="scheme-btn${k === layer.preset ? ' active' : ''}" data-scheme="${k}" title="${k}" style="background:${buildGradient(k, false)};"></button>`;
        })
        .join('');

    body.innerHTML = `
        <div class="color-sheet-scheme-grid">${schemeBtns}</div>
        <div class="ctrl-row" style="margin-top:12px;">
            <div class="ctrl-label">
                <span>Data Layer Opacity</span>
                <span class="val" id="cs-op-val">${Math.round(dataLayerOpacity * 100)}%</span>
            </div>
            <input type="range" id="cs-op-slider" min="0" max="1" step="0.01" value="${dataLayerOpacity}" />
        </div>`;

    document.getElementById('cs-close').addEventListener('click', closeColorSheet);

    document.getElementById('cs-vis').addEventListener('change', function(e) {
        layer.visible = e.target.checked;
        syncLayerVisible(layer);
        if (layer.type === 'overlay') {
            if (mapEngine) mapEngine.toggleOverlay(layer.id, layer.visible);
        } else {
            refreshDataLayer();
        }
    });

    document.getElementById('cs-rev').addEventListener('click', function() {
        layer.reverse = !layer.reverse;
        document.getElementById('cs-rev').classList.toggle('active', layer.reverse);
        document.getElementById('cs-bar').style.background = buildGradient(layer.preset, layer.reverse);
        syncLayerColor(layer);
        updateDrawerBar(layer);
        refreshDataLayer();
    });

    body.querySelectorAll('.scheme-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            layer.preset = btn.dataset.scheme;
            body.querySelectorAll('.scheme-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            document.getElementById('cs-bar').style.background = buildGradient(layer.preset, layer.reverse);
            syncLayerColor(layer);
            updateDrawerBar(layer);
            refreshDataLayer();
        });
    });

    document.getElementById('cs-op-slider').addEventListener('input', function(e) {
        dataLayerOpacity = parseFloat(e.target.value);
        document.getElementById('cs-op-val').textContent = `${Math.round(dataLayerOpacity * 100)}%`;
        if (mapEngine) mapEngine.updateDataLayerOpacity(dataLayerOpacity);
    });

    document.getElementById('color-sheet').classList.add('open');
}

/**
 * Closes the colour scheme bottom sheet.
 */
function closeColorSheet() {
    document.getElementById('color-sheet').classList.remove('open');
}

// ─── SEARCH SHEET ───

/**
 * Opens the location search popup and focuses the input field.
 */
function openSearchSheet() {
    document.getElementById('search-sheet').classList.add('open');
    document.getElementById('search-sheet-backdrop').classList.add('open');
    setTimeout(function() { document.getElementById('search-input').focus(); }, 180);
}

/**
 * Closes the location search popup.
 */
function closeSearchSheet() {
    document.getElementById('search-sheet').classList.remove('open');
    document.getElementById('search-sheet-backdrop').classList.remove('open');
}

/**
 * Queries the Nominatim geocoding API with the value from the given input element
 * and renders results into the given list element.
 * Clicking a result flies the map to that location.
 */
async function doSearch(inputId, resultsId, opts) {
    inputId   = inputId   || 'search-input';
    resultsId = resultsId || 'search-results';
    opts      = opts      || {};

    const input = document.getElementById(inputId);
    const list  = document.getElementById(resultsId);
    if (!input || !list) return;

    const q = input.value.trim();
    if (!q) return;
    list.innerHTML = '<li class="result-empty">Searching…</li>';

    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
            { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        list.innerHTML = '';
        if (!data.length) {
            list.innerHTML = '<li class="result-empty">No results found.</li>';
            return;
        }
        data.forEach(function(item) {
            const parts = item.display_name.split(',');
            const li    = document.createElement('li');
            li.innerHTML = `<div class="result-name">${parts[0].trim()}</div>
                <div class="result-detail">${parts.slice(1, 3).map(function(s) { return s.trim(); }).join(', ')}</div>`;
            li.addEventListener('click', function() {
                if (mapEngine) mapEngine.flyTo([parseFloat(item.lon), parseFloat(item.lat)], 12);
                if (opts.closeOnSelect) opts.closeOnSelect();
            });
            list.appendChild(li);
        });
    } catch (e) {
        list.innerHTML = '<li class="result-empty">Search failed.</li>';
    }
}

/**
 * Attaches the close button and backdrop listeners for the search sheet,
 * then wires up the main search input and button.
 */
function initSearch() {
    document.getElementById('search-sheet-close').addEventListener('click', closeSearchSheet);
    document.getElementById('search-sheet-backdrop').addEventListener('click', closeSearchSheet);
    bindSearchControls('search-input', 'search-go', 'search-results', { closeOnSelect: closeSearchSheet });
}

/**
 * Wires the Go button and Enter key on the given input to call doSearch.
 */
function bindSearchControls(inputId, buttonId, resultsId, opts) {
    opts = opts || {};
    const input  = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    if (!input || !button) return;

    button.addEventListener('click', function() { doSearch(inputId, resultsId, opts); });
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doSearch(inputId, resultsId, opts);
    });
}

/**
 * Wires a button element to open the search sheet when clicked.
 */
function bindSearchBtn(id) {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = openSearchSheet;
}

// ─── LAYOUT 4 ───

/**
 * Clears all dynamic content from the Layout 4 layer strip, basemap popup, and drawer body.
 */
function clearLayout4() {
    ['layer-strip', 'basemap-popup', 'drawer-body'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    document.getElementById('basemap-popup')?.classList.remove('open');
    document.getElementById('settings-drawer')?.classList.remove('open');
    document.getElementById('settings-backdrop')?.classList.remove('open');
}

/**
 * Builds the full Layout 4 UI: layer strip chips, basemap popup with engine switcher,
 * settings drawer, FAB button bindings, and the bottom-bar height CSS variable.
 */
function buildLayout4() {
    clearLayout4();

    const strip = document.getElementById('layer-strip');

    layerState.forEach(function(layer) {
        if (layer.id === 'Water') return;
        strip.appendChild(makeL4LayerCard(layer));
    });
    strip.appendChild(makeHotspotChip());

    const popup = document.getElementById('basemap-popup');
    popup.innerHTML = '';

    const popupHeader = document.createElement('div');
    popupHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';

    const engLabel = document.createElement('div');
    engLabel.className    = 'bm-row-label';
    engLabel.style.margin = '0';
    engLabel.textContent  = 'Map Engine';

    const closeBtn = document.createElement('button');
    closeBtn.className   = 'icon-btn';
    closeBtn.title       = 'Close';
    closeBtn.style.padding = '2px';
    closeBtn.style.cursor  = 'pointer';
    closeBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>`;
    closeBtn.onclick = function(e) {
        e.stopPropagation();
        popup.classList.remove('open');
    };

    popupHeader.appendChild(engLabel);
    popupHeader.appendChild(closeBtn);
    popup.appendChild(popupHeader);

    const engWrap = document.createElement('div');
    engWrap.className        = 'control-options';
    engWrap.style.padding    = '0';
    engWrap.style.marginBottom = '12px';
    engWrap.innerHTML = `
        <button class="control-btn" data-engine="leaflet">Leaflet</button>
        <button class="control-btn" data-engine="maplibre">MapLibre</button>`;
    popup.appendChild(engWrap);
    initEngineBtns(engWrap);

    const divider = document.createElement('div');
    divider.style.cssText = 'border-top:1px solid var(--border);margin-bottom:12px;';
    popup.appendChild(divider);

    const bmBlock = document.createElement('div');
    bmBlock.id = 'bm-inner';
    popup.appendChild(bmBlock);
    buildBasemapBlock(bmBlock, { includeDataLayerOpacity: true });

    const bmBtn = document.getElementById('basemap-btn');
    const settingsBtn = document.getElementById('settings-btn');

    bmBtn.onclick = function(e) {
        e.stopPropagation();
        closeLayout4Drawer();
        popup.classList.toggle('open');
    };
    if (!_popupHandlerAttached) {
        _popupHandlerAttached = true;
        document.addEventListener('click', e => {
            const p = document.getElementById('basemap-popup');
            const b = document.getElementById('basemap-btn');
            if (p && b && !p.contains(e.target) && e.target !== b) {
                p.classList.remove('open');
            }
        });
    }

    buildDrawerBody(document.getElementById('drawer-body'), { includeLocationTools: true });

    settingsBtn.onclick = function() {
        popup.classList.remove('open');
        const drawer = document.getElementById('settings-drawer');
        const backdrop = document.getElementById('settings-backdrop');
        if (drawer.classList.contains('open')) {
            drawer.classList.remove('open');
            backdrop.classList.remove('open');
        } else {
            drawer.classList.add('open');
            backdrop.classList.add('open');
        }
    };
    document.getElementById('drawer-close').onclick = closeLayout4Drawer;
    document.getElementById('settings-backdrop').onclick = closeLayout4Drawer;

    bindSearchBtn('search-btn');
    bindLocBtn('loc-btn');

    requestAnimationFrame(() => {
        const h = document.getElementById('bottom-bar')?.offsetHeight;
        if (h) document.documentElement.style.setProperty('--bottom-bar-h', `${h}px`);
    });
}

/**
 * Closes the Layout 4 settings drawer and its backdrop.
 */
function closeLayout4Drawer() {
    document.getElementById('settings-drawer').classList.remove('open');
    document.getElementById('settings-backdrop').classList.remove('open');
}

// ─── DRAWER BODY ───

/**
 * Populates the settings drawer with data layer cards, data layer opacity slider,
 * map engine switcher, basemap block, and optionally location tools.
 */
function buildDrawerBody(container, opts) {
    opts = opts || {};
    container.innerHTML = '';

    addSectionLabel(container, 'Hotspot Mode');
    const hotspotCard = document.createElement('div');
    hotspotCard.className = `layer-card${hotspotMode ? ' active' : ''}`;
    hotspotCard.id = 'drawer-hotspot-card';
    hotspotCard.innerHTML = `
        <div class="layer-header">
            <label class="toggle">
                <input type="checkbox" id="drawer-hotspot-toggle" ${hotspotMode ? 'checked' : ''} />
                <span class="toggle-track"></span>
            </label>
            <span class="hotspot-icon" style="display:flex;align-items:center;flex-shrink:0;">${_flameSvg}</span>
            <span class="layer-name">Hotspot</span>
            <span style="font-size:10px;color:var(--text-lo);flex-shrink:0;white-space:nowrap;">Top values only</span>
        </div>`;
    container.appendChild(hotspotCard);
    document.getElementById('drawer-hotspot-toggle').addEventListener('change', function(e) {
        hotspotMode = e.target.checked;
        syncHotspotMode();
        refreshDataLayer();
    });

    addSectionLabel(container, 'Data Layers');

    layerState.forEach(function(layer) {
        const card = document.createElement('div');
        card.className = `layer-card${layer.visible ? '' : ' inactive'}`;

        let headerControls = '';
        let dropdownHtml   = '';

        if (layer.type === 'category') {
            const schemeBtns = Object.keys(COLORMAP_PRESETS)
                .map(function(k) {
                    return `<button class="scheme-btn${k === layer.preset ? ' active' : ''}" data-scheme="${k}" style="background:${buildGradient(k, false)};"></button>`;
                })
                .join('');
            headerControls = `
                <button class="btn-reverse${layer.reverse ? ' active' : ''}" id="drev-${layer.id}">&#x21C4;</button>
                <div class="scheme-bar-btn" id="dbar-${layer.id}" style="background:${buildGradient(layer.preset, layer.reverse)};"></div>`;
            dropdownHtml = `
                <div class="scheme-dropdown" id="ddrop-${layer.id}">
                    <div class="scheme-grid" id="dschemes-${layer.id}">${schemeBtns}</div>
                </div>`;
        } else if (layer.type === 'solid') {
            headerControls = `<input type="color" id="dcol-${layer.id}" value="${layer.preset}" class="header-color-picker" />`;
        }

        card.innerHTML = `
            <div class="layer-header">
                <label class="toggle">
                    <input type="checkbox" id="dvis-${layer.id}" ${layer.visible ? 'checked' : ''} />
                    <span class="toggle-track"></span>
                </label>
                <span class="layer-name">${layer.id}</span>
                ${headerControls}
            </div>
            ${dropdownHtml}`;
        container.appendChild(card);

        document.getElementById(`dvis-${layer.id}`).addEventListener('change', function(e) {
            layer.visible = e.target.checked;
            card.classList.toggle('inactive', !layer.visible);
            syncLayerVisible(layer);
            if (layer.type === 'overlay') {
                if (mapEngine) mapEngine.toggleOverlay(layer.id, layer.visible);
            } else {
                refreshDataLayer();
            }
        });

        if (layer.type === 'category') {
            document.getElementById(`dbar-${layer.id}`).addEventListener('click', function(e) {
                e.stopPropagation();
                document.querySelectorAll('.scheme-dropdown.open').forEach(function(d) {
                    if (d.id !== `ddrop-${layer.id}`) d.classList.remove('open');
                });
                document.getElementById(`ddrop-${layer.id}`).classList.toggle('open');
            });

            document.getElementById(`dschemes-${layer.id}`).querySelectorAll('.scheme-btn').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    layer.preset = btn.dataset.scheme;
                    document.getElementById(`dschemes-${layer.id}`).querySelectorAll('.scheme-btn')
                        .forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    document.getElementById(`dbar-${layer.id}`).style.background = buildGradient(layer.preset, layer.reverse);
                    syncLayerColor(layer);
                    refreshDataLayer();
                    document.getElementById(`ddrop-${layer.id}`).classList.remove('open');
                });
            });

            document.getElementById(`drev-${layer.id}`).addEventListener('click', function(e) {
                e.stopPropagation();
                layer.reverse = !layer.reverse;
                document.getElementById(`drev-${layer.id}`).classList.toggle('active', layer.reverse);
                document.getElementById(`dbar-${layer.id}`).style.background = buildGradient(layer.preset, layer.reverse);
                syncLayerColor(layer);
                refreshDataLayer();
            });
        } else if (layer.type === 'solid') {
            document.getElementById(`dcol-${layer.id}`).addEventListener('input', function(e) {
                layer.preset = e.target.value;
                syncLayerColor(layer);
                refreshDataLayer();
            });
        }
    });

    addSectionLabel(container, 'Data Layer Opacity');
    const opDiv = document.createElement('div');
    opDiv.style.padding = '2px 4px 8px';
    opDiv.innerHTML = `
        <div class="ctrl-row">
            <div class="ctrl-label">
                <span>Opacity</span>
                <span class="val" id="drawer-dl-val">${Math.round(dataLayerOpacity * 100)}%</span>
            </div>
            <input type="range" id="drawer-dl-opacity" min="0" max="1" step="0.01" value="${dataLayerOpacity}" />
        </div>`;
    container.appendChild(opDiv);

    document.getElementById('drawer-dl-opacity').addEventListener('input', function(e) {
        dataLayerOpacity = parseFloat(e.target.value);
        document.getElementById('drawer-dl-val').textContent = `${Math.round(dataLayerOpacity * 100)}%`;
        if (mapEngine) mapEngine.updateDataLayerOpacity(dataLayerOpacity);
    });

    addSectionLabel(container, 'Map Engine');
    const engWrap = document.createElement('div');
    engWrap.className    = 'control-card';
    engWrap.style.padding = '10px 12px';
    engWrap.innerHTML = `
        <div class="control-options" style="padding:0;">
            <button class="control-btn" data-engine="leaflet">Leaflet</button>
            <button class="control-btn" data-engine="maplibre">MapLibre</button>
        </div>`;
    container.appendChild(engWrap);
    initEngineBtns(engWrap);

    addSectionLabel(container, 'Basemap');
    const bmWrap = document.createElement('div');
    bmWrap.className    = 'control-card';
    bmWrap.id           = 'drawer-bm-area';
    bmWrap.style.padding = '10px 12px';
    container.appendChild(bmWrap);
    buildBasemapBlock(bmWrap);

    if (opts.includeLocationTools) appendDrawerLocationTools(container);
}

/**
 * Appends an inline location search input and a "My location" button
 * to the given drawer container element.
 */
function appendDrawerLocationTools(container) {
    const section = document.createElement('div');
    section.className = 'drawer-location-section';
    container.appendChild(section);

    addSectionLabel(section, 'Location');

    const locWrap = document.createElement('div');
    locWrap.className = 'control-card drawer-location-card';
    locWrap.innerHTML = `
        <div class="search-input-row drawer-search-row">
            <input id="drawer-search-input" type="text" placeholder="Search location…" autocomplete="off" />
            <button id="drawer-search-go" class="search-go-btn">Go</button>
        </div>
        <ul id="drawer-search-results" class="search-results drawer-search-results"></ul>
        <button id="drawer-loc-btn" class="drawer-action-btn" type="button">
            ${getMyLocationIconSvg()}
            <span>My location</span>
        </button>`;
    section.appendChild(locWrap);

    bindSearchControls('drawer-search-input', 'drawer-search-go', 'drawer-search-results');
    bindLocBtn('drawer-loc-btn');
}

// ─── FAB SHIFT ───

/**
 * Adds or removes the 'fab-shifted' body class to shift the FAB upward
 * when the settings drawer overlaps it on wide viewports.
 */
function updateFabShift() {
    const drawer = document.getElementById('settings-drawer');
    const fab = document.getElementById('fab-group');
    if (!drawer || !fab) return;

    if (window.innerWidth < 769) {
        document.body.classList.remove('fab-shifted');
        return;
    }

    const isOpen    = drawer.classList.contains('open');
    const pos       = drawer.dataset.pos || 'right-middle';
    const isOnRight = !pos.includes('left');

    if (isOpen && isOnRight) {
        const fabHeight  = fab.offsetHeight || 200;
        const drawerRect = drawer.getBoundingClientRect();
        const spaceBelow = window.innerHeight - drawerRect.bottom;

        if (spaceBelow < fabHeight + 24) {
            document.body.classList.add('fab-shifted');
            return;
        }
    }
    document.body.classList.remove('fab-shifted');
}

// ─── HELPERS ───

/**
 * Appends a section label div with the given text to the parent element.
 */
function addSectionLabel(parent, text) {
    const div = document.createElement('div');
    div.className   = 'section-label';
    div.textContent = text;
    parent.appendChild(div);
}

// ─── THEME SWITCHER ───

/**
 * Reads the saved theme from localStorage, applies it, and wires the dev-bar
 * theme buttons to switch and persist the active theme.
 */
function initThemeSwitcher() {
    const buttons    = document.querySelectorAll('.dev-theme-btn');
    const themes     = Array.from(buttons).map(function(btn) { return btn.dataset.theme; });
    const saved      = localStorage.getItem('map-theme');
    const activeTheme = themes.includes(saved) ? saved : 'glass';

    document.getElementById('theme-link').href = `themes/theme_${activeTheme}.css`;
    localStorage.setItem('map-theme', activeTheme);

    buttons.forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.theme === activeTheme);
        btn.addEventListener('click', function() {
            buttons.forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            const t = btn.dataset.theme;
            document.getElementById('theme-link').href = `themes/theme_${t}.css`;
            localStorage.setItem('map-theme', t);
        });
    });
}

// ─── STARTUP ───

document.addEventListener('DOMContentLoaded', function() {
    buildLayout4();
    initThemeSwitcher();

    if (window.innerWidth >= 769) {
        document.getElementById('settings-drawer').classList.add('open');
    }

    const drawer = document.getElementById('settings-drawer');
    if (drawer) {
        const observer = new MutationObserver(function() { updateFabShift(); });
        observer.observe(drawer, { attributes: true, attributeFilter: ['class', 'data-pos'] });
    }

    window.addEventListener('resize', updateFabShift);
    requestAnimationFrame(updateFabShift);

    initSearch();

    mapEngine = activeEngine === 'leaflet' ? new LeafletEngine() : new MapLibreEngine();
    mapEngine.init('map', DEFAULT_CENTER, DEFAULT_ZOOM, NAV_CONTROL_POSITIONS[activeEngine])
        .then(function() { afterEngineInit(true); });

    window.addEventListener('resize', () => {
        requestAnimationFrame(() => {
            const h4 = document.getElementById('bottom-bar')?.offsetHeight;
            if (h4) document.documentElement.style.setProperty('--bottom-bar-h', `${h4}px`);
        });
    });
});
