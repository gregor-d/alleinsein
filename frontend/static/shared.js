// ─────────────────────────────────────────────
//  SHARED.JS — Shared state, helpers & UI builder
// ─────────────────────────────────────────────

// ─── CONFIG ───
const TILE_JSON_URL = new URL(CONFIG.tile_json_path, CONFIG.fqdn);
console.log("Using TileJSON URL:", TILE_JSON_URL.toString());
const RASTER_SOURCE_FILE = CONFIG.raster_name;

// ─── COLORMAP PRESETS ───
const COLORMAP_PRESETS = {
    viridis: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'],
    plasma: ['#0d0887', '#4b03a1', '#7d03a8', '#a82296', '#cb4679', '#e56b5d', '#f89441', '#fdc527', '#f0f921'],
    magma: ['#000004', '#180f3e', '#440f76', '#721f81', '#9e2f7f', '#cd4071', '#f1605d', '#fd9668', '#fcfdbf'],
    YlGnBu: ['#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494', '#081d58'],
    YlOrRd: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
    PuBuGn: ['#fff7fb', '#ece2f0', '#d0d1e6', '#a6bddb', '#67a9cf', '#3690c0', '#02818a', '#016c59', '#014636']
};

// ─── LAYER STATE ───
const layerState = [
    { id: 'Nature', start: 1, preset: 'viridis', visible: true, reverse: false, type: 'category' },
    { id: 'Farm', start: 11, preset: 'YlOrRd', visible: false, reverse: false, type: 'category' },
    { id: 'Parks', start: 21, preset: 'PuBuGn', visible: false, reverse: false, type: 'category' },
    { id: 'Urban', start: 31, preset: 'magma', visible: false, reverse: false, type: 'category' },
    { id: 'Water', start: 200, preset: '#4da6ff', visible: false, reverse: false, type: 'solid' }
];

// ─── BASEMAP DEFINITIONS ───
const BASEMAPS = {
    osm: {
        label: 'OpenStreetMap',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 15
        }
    },
    satellite: {
        label: 'Satellite Hybrid',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: {
            attribution: '&copy; <a href="https://www.esri.com/">Esri</a> · Sources: Esri, Maxar, Earthstar Geographics',
            maxZoom: 15
        }
    }
};

let activeBasemapKey = 'osm';
let basemapOpacity = 1.0;
let dataLayerOpacity = 0.9;

// ─── COLORMAP HELPERS ───
function hexToRgba(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b, 255];
}

function buildGradient(preset, reverse) {
    let colors = [...COLORMAP_PRESETS[preset]];
    if (reverse) colors = [...colors].reverse();
    return `linear-gradient(to right, ${colors.join(', ')})`;
}

function getCombinedColormapJson() {
    const cmap = {};
    layerState.forEach(layer => {
        if (!layer.visible) return;

        if (layer.type === 'solid') {
            cmap[layer.start] = hexToRgba(layer.preset);
        } else {
            let colors = [...COLORMAP_PRESETS[layer.preset]];
            if (layer.reverse) colors.reverse();
            for (let i = 0; i < 9; i++) {
                cmap[layer.start + i] = hexToRgba(colors[i]);
            }
        }
    });
    return JSON.stringify(cmap);
}

// ─── UI BUILDER ───
function buildPanel() {
    const container = document.getElementById('panel-body');
    container.innerHTML = '';

    // ── Basemap Section ──
    const basemapSection = document.createElement('div');
    basemapSection.innerHTML = `<div class="section-label">Basemap</div>`;
    container.appendChild(basemapSection);

    const cogSvg = `<svg class="settings-cog" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

    const basemapCard = document.createElement('div');
    basemapCard.className = 'basemap-card';
    basemapCard.innerHTML = `
        <div class="basemap-header" id="basemap-header">
            <svg style="width:16px;height:16px;color:var(--accent);flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            <span class="basemap-label">Basemap</span>
            ${cogSvg}
        </div>
        <div class="basemap-body">
            <div class="basemap-options">
                <button class="basemap-btn active" data-key="osm" id="basemap-osm">OSM</button>
                <button class="basemap-btn" data-key="satellite" id="basemap-satellite">Satellite</button>
                <button class="basemap-btn" data-key="none" id="basemap-none">None</button>
            </div>
            <div style="padding: 4px 14px 12px;">
                <div class="ctrl-row">
                    <div class="ctrl-label">
                        <span>Opacity</span>
                        <span class="val" id="basemap-op-val">${Math.round(basemapOpacity * 100)}%</span>
                    </div>
                    <input type="range" id="basemap-opacity" min="0" max="1" step="0.01" value="${basemapOpacity}" />
                </div>
            </div>
        </div>
    `;
    container.appendChild(basemapCard);

    // Basemap header toggle
    document.getElementById('basemap-header').addEventListener('click', () => {
        basemapCard.classList.toggle('open');
    });

    // Basemap button events
    basemapCard.querySelectorAll('.basemap-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            activeBasemapKey = key;
            if (mapEngine) {
                mapEngine.switchBasemap(key);
            }
            // Update button UI
            basemapCard.querySelectorAll('.basemap-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.key === key);
            });
        });
    });

    // Basemap opacity slider
    document.getElementById('basemap-opacity').addEventListener('input', (e) => {
        basemapOpacity = parseFloat(e.target.value);
        document.getElementById('basemap-op-val').textContent = `${Math.round(basemapOpacity * 100)}%`;
        if (mapEngine) {
            mapEngine.updateBasemapOpacity(basemapOpacity);
        }
    });

    // ── Layers Section ──
    const layerSection = document.createElement('div');
    layerSection.innerHTML = `<div class="section-label">Data Layers</div>`;
    container.appendChild(layerSection);

    // ── Layer Cards ──
    layerState.forEach((layer) => {
        const card = document.createElement('div');
        card.className = `layer-card${layer.visible ? '' : ' inactive'}`;
        card.id = `card-${layer.id}`;

        let headerControls = '';
        let dropdownHtml = '';

        if (layer.type === 'category') {
            const schemeButtons = Object.keys(COLORMAP_PRESETS)
                .map(k => `<button class="scheme-btn${k === layer.preset ? ' active' : ''}" data-scheme="${k}" data-layer="${layer.id}" title="${k}" style="background: ${buildGradient(k, false)};"></button>`)
                .join('');

            headerControls = `
                <button class="btn-reverse${layer.reverse ? ' active' : ''}" id="rev-${layer.id}" title="Reverse palette">⇄</button>
                <div class="scheme-bar-btn" id="bar-${layer.id}" title="Change color scheme" style="background: ${buildGradient(layer.preset, layer.reverse)};"></div>
            `;

            dropdownHtml = `
                <div class="scheme-dropdown" id="dropdown-${layer.id}">
                    <div class="scheme-grid" id="schemes-${layer.id}">
                        ${schemeButtons}
                    </div>
                </div>
            `;
        } else if (layer.type === 'solid') {
            headerControls = `
                <input type="color" id="color-${layer.id}" value="${layer.preset}" class="header-color-picker" title="Pick color" />
            `;
        }

        card.innerHTML = `
            <div class="layer-header" id="hdr-${layer.id}">
                <label class="toggle" title="Toggle visibility">
                    <input type="checkbox" id="vis-${layer.id}" ${layer.visible ? 'checked' : ''} />
                    <span class="toggle-track"></span>
                </label>
                <span class="layer-name">${layer.id}</span>
                ${headerControls}
            </div>
            ${dropdownHtml}
        `;

        container.appendChild(card);

        // ── EVENTS ──

        // Visibility toggle
        document.getElementById(`vis-${layer.id}`).addEventListener('change', (e) => {
            layer.visible = e.target.checked;
            card.classList.toggle('inactive', !layer.visible);
            if (mapEngine) {
                mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity);
            }
        });

        // Click on header (not on interactive elements) toggles visibility
        document.getElementById(`hdr-${layer.id}`).addEventListener('click', (e) => {
            if (e.target.closest('.toggle') || e.target.closest('.scheme-bar-btn') || e.target.closest('.btn-reverse') || e.target.closest('.header-color-picker')) return;
            const checkbox = document.getElementById(`vis-${layer.id}`);
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        });

        if (layer.type === 'category') {
            // Gradient bar toggles dropdown
            document.getElementById(`bar-${layer.id}`).addEventListener('click', (e) => {
                e.stopPropagation();
                // Close other open dropdowns
                document.querySelectorAll('.scheme-dropdown.open').forEach(d => {
                    if (d.id !== `dropdown-${layer.id}`) d.classList.remove('open');
                });
                document.getElementById(`dropdown-${layer.id}`).classList.toggle('open');
            });

            // Color scheme buttons
            document.getElementById(`schemes-${layer.id}`).querySelectorAll('.scheme-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    layer.preset = btn.dataset.scheme;
                    document.getElementById(`schemes-${layer.id}`).querySelectorAll('.scheme-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    // Update the gradient bar in header
                    document.getElementById(`bar-${layer.id}`).style.background = buildGradient(layer.preset, layer.reverse);
                    updateColorbar(layer);
                    if (mapEngine) {
                        mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity);
                    }
                    // Close dropdown after selection
                    document.getElementById(`dropdown-${layer.id}`).classList.remove('open');
                });
            });

            // Reverse button
            document.getElementById(`rev-${layer.id}`).addEventListener('click', (e) => {
                e.stopPropagation();
                layer.reverse = !layer.reverse;
                document.getElementById(`rev-${layer.id}`).classList.toggle('active', layer.reverse);
                document.getElementById(`bar-${layer.id}`).style.background = buildGradient(layer.preset, layer.reverse);
                updateColorbar(layer);
                if (mapEngine) {
                    mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity);
                }
            });
        } else if (layer.type === 'solid') {
            // Color picker
            document.getElementById(`color-${layer.id}`).addEventListener('input', (e) => {
                layer.preset = e.target.value;
                if (mapEngine) {
                    mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity);
                }
            });
        }
    });

    // ── Global Data Layer Opacity ──
    const opacitySection = document.createElement('div');
    opacitySection.innerHTML = `
        <div class="section-label">Data Layer Opacity</div>
        <div style="padding: 4px 14px 12px;">
            <div class="ctrl-row">
                <div class="ctrl-label">
                    <span>Opacity</span>
                    <span class="val" id="data-layer-op-val">${Math.round(dataLayerOpacity * 100)}%</span>
                </div>
                <input type="range" id="data-layer-opacity" min="0" max="1" step="0.01" value="${dataLayerOpacity}" />
            </div>
        </div>
    `;
    container.appendChild(opacitySection);

    document.getElementById('data-layer-opacity').addEventListener('input', (e) => {
        dataLayerOpacity = parseFloat(e.target.value);
        document.getElementById('data-layer-op-val').textContent = `${Math.round(dataLayerOpacity * 100)}%`;
        if (mapEngine) {
            mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity);
        }
    });
}

function updateColorbar(layer) {
    const colors = COLORMAP_PRESETS[layer.preset];
    if (!colors) return; // solid type — no ramp to update

    const bar = document.getElementById(`bar-${layer.id}`);
    if (bar) {
        bar.style.background = buildGradient(layer.preset, layer.reverse);
    }
}

// ─── THEME CONFIG ───
function initThemeSwitcher() {
    const themeSwitcher = document.getElementById('theme-switcher');
    const savedTheme = localStorage.getItem('map-theme') || 'glass';
    themeSwitcher.value = savedTheme;
    document.getElementById('theme-link').href = `themes/theme_${savedTheme}.css?v1`;

    themeSwitcher.addEventListener('change', (e) => {
        const theme = e.target.value;
        document.getElementById('theme-link').href = `themes/theme_${theme}.css`;
        localStorage.setItem('map-theme', theme);
    });
}

// ─── MAP ENGINE SWITCHER ───
let activeEngine = localStorage.getItem('map-engine') || 'leaflet';
let mapEngine = null;

function switchEngine(newEngineKey) {
    if (newEngineKey === activeEngine && mapEngine) return;

    let center = [13.3, 51.0]; // Default [lng, lat]
    let zoom = 8;

    if (mapEngine) {
        center = mapEngine.getCenter();
        zoom = mapEngine.getZoom();
        mapEngine.destroy();
    }

    // Clean up container
    const oldMapEl = document.getElementById('map');
    const newMapEl = oldMapEl.cloneNode(false);
    oldMapEl.parentNode.replaceChild(newMapEl, oldMapEl);

    activeEngine = newEngineKey;
    localStorage.setItem('map-engine', activeEngine);

    if (activeEngine === 'leaflet') {
        mapEngine = new LeafletEngine();
    } else {
        mapEngine = new MapLibreEngine();
    }

    mapEngine.init('map', center, zoom).then(() => {
        mapEngine.switchBasemap(activeBasemapKey);
        mapEngine.updateBasemapOpacity(basemapOpacity);
        mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity);
    });

    // Update switcher buttons UI
    document.querySelectorAll('.engine-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.engine === activeEngine);
    });

    // Update panel subtext description
    const engineDesc = activeEngine === 'leaflet' ? 'Leaflet' : 'MapLibre GL JS';
    document.getElementById('engine-desc').textContent = `Server-side colormap · single tile layer · ${engineDesc}`;
}

function initEngineSwitcher() {
    document.querySelectorAll('.engine-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.engine === activeEngine);
        btn.addEventListener('click', () => {
            switchEngine(btn.dataset.engine);
        });
    });
}

// ─── STARTUP ───
document.addEventListener('DOMContentLoaded', () => {
    buildPanel();
    initThemeSwitcher();
    initEngineSwitcher();
    // Initialize the starting engine
    switchEngine(activeEngine);
});
