// ─────────────────────────────────────────────
//  SHARED.JS — State, helpers, layout builders
// ─────────────────────────────────────────────

window.boundsSet = false;

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
            for (let i = 0; i < 9; i++) cmap[layer.start + i] = hexToRgba(colors[i]);
        }
    });
    return JSON.stringify(cmap);
}

function refreshDataLayer() {
    if (mapEngine) mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity);
}

// ─── ENGINE STATE ───

let activeEngine = localStorage.getItem('map-engine') || 'leaflet';
let mapEngine = null;
let _l4PopupHandlerAttached = false;

function getNavControlPos() {
    return { leaflet: 'topleft', maplibre: 'top-left' };
}

function switchEngine(newKey) {
    if (newKey === activeEngine && mapEngine) return;

    let center = [13.3, 51.0], zoom = 8;
    if (mapEngine) {
        center = mapEngine.getCenter();
        zoom   = mapEngine.getZoom();
        mapEngine.destroy();
    }

    const oldEl = document.getElementById('map');
    oldEl.parentNode.replaceChild(oldEl.cloneNode(false), oldEl);

    activeEngine = newKey;
    localStorage.setItem('map-engine', activeEngine);

    const pos = getNavControlPos();
    const ctor = activeEngine === 'leaflet' ? LeafletEngine : MapLibreEngine;
    const cpos = activeEngine === 'leaflet' ? pos.leaflet    : pos.maplibre;

    mapEngine = new ctor();
    mapEngine.init('map', center, zoom, cpos).then(afterEngineInit);

    document.querySelectorAll('.engine-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.engine === activeEngine)
    );
}

function afterEngineInit() {
    mapEngine.switchBasemap(activeBasemapKey);
    mapEngine.updateBasemapOpacity(basemapOpacity);
    refreshDataLayer();
}

function initEngineBtns(container) {
    container.querySelectorAll('.engine-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.engine === activeEngine);
        btn.addEventListener('click', () => switchEngine(btn.dataset.engine));
    });
}

// ─── VISIBILITY SYNC ───
// Called whenever a layer's visible flag changes — updates all live UI elements.
function syncLayerVisible(layer) {
    const l4Chip = document.getElementById(`l4-chip-${layer.id}`);
    if (l4Chip) {
        l4Chip.classList.toggle('inactive', !layer.visible);
        l4Chip.setAttribute('aria-checked', String(layer.visible));
    }
    const dcb = document.getElementById(`dvis-${layer.id}`);
    if (dcb) {
        dcb.checked = layer.visible;
        const dcard = dcb.closest('.layer-card');
        if (dcard) dcard.classList.toggle('inactive', !layer.visible);
    }
}

// ─── COLOR SYNC ───
function syncLayerColor(layer) {
    const chipColor = document.getElementById(`l4-chip-color-${layer.id}`);
    if (!chipColor) return;
    chipColor.style.background = layer.type === 'category'
        ? buildGradient(layer.preset, layer.reverse)
        : layer.preset;
}

function updateDrawerBar(layer) {
    const bar = document.getElementById(`dbar-${layer.id}`);
    if (bar) bar.style.background = buildGradient(layer.preset, layer.reverse);
}

// ─── TOGGLE WIDGET (no ID on checkbox — use container IDs for sync) ───

// ─── BASEMAP BLOCK (reusable) ───
function buildBasemapBlock(el, opts = {}) {
    const uid = el.id || ('bm' + Math.random().toString(36).slice(2, 7));

    el.innerHTML = `
        <div class="bm-row">
            <div class="bm-row-label">Basemap</div>
            <div class="basemap-options">
                <button class="basemap-btn${activeBasemapKey === 'osm'       ? ' active' : ''}" data-key="osm">OSM</button>
                <button class="basemap-btn${activeBasemapKey === 'satellite' ? ' active' : ''}" data-key="satellite">Satellite</button>
                <button class="basemap-btn${activeBasemapKey === 'none'      ? ' active' : ''}" data-key="none">None</button>
            </div>
            <div class="ctrl-row">
                <div class="ctrl-label">
                    <span>Basemap Opacity</span>
                    <span class="val" id="bm-op-val-${uid}">${Math.round(basemapOpacity * 100)}%</span>
                </div>
                <input type="range" id="bm-op-${uid}" min="0" max="1" step="0.01" value="${basemapOpacity}" />
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

    el.querySelectorAll('.basemap-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeBasemapKey = btn.dataset.key;
            if (mapEngine) mapEngine.switchBasemap(activeBasemapKey);
            el.querySelectorAll('.basemap-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.key === activeBasemapKey)
            );
        });
    });

    document.getElementById(`bm-op-${uid}`).addEventListener('input', e => {
        basemapOpacity = parseFloat(e.target.value);
        document.getElementById(`bm-op-val-${uid}`).textContent = `${Math.round(basemapOpacity * 100)}%`;
        if (mapEngine) mapEngine.updateBasemapOpacity(basemapOpacity);
    });

    if (opts.includeDataLayerOpacity) {
        document.getElementById(`dl-op-${uid}`).addEventListener('input', e => {
            dataLayerOpacity = parseFloat(e.target.value);
            document.getElementById(`dl-op-val-${uid}`).textContent = `${Math.round(dataLayerOpacity * 100)}%`;
            if (mapEngine) mapEngine.updateDataLayerOpacity(dataLayerOpacity);
        });
    }
}

// ─── VERTICAL CARD (L2 bottom bar) ───

// ─── LAYOUT 4 LAYER CARD (L2 base with per-layer status icons) ───
function makeL4LayerCard(layer) {
    const key = layer.id.toLowerCase();
    const card = document.createElement('div');
    card.className = `layer-strip-card l4-layer-card l4-layer-card--${key}${layer.visible ? '' : ' inactive'}`;
    card.id = `l4-chip-${layer.id}`;
    card.tabIndex = 0;
    card.setAttribute('role', 'switch');
    card.setAttribute('aria-checked', String(layer.visible));

    const status = document.createElement('span');
    status.className = `l4-layer-status l4-status-${key}`;
    status.innerHTML = getL4LayerStatusMarkup(key);
    card.appendChild(status);

    const nameEl = document.createElement('span');
    nameEl.className = 'layer-name';
    nameEl.textContent = layer.id;
    card.appendChild(nameEl);

    if (layer.type === 'category') {
        const ramp = document.createElement('div');
        ramp.className = 'layer-strip-ramp';
        ramp.id = `l4-chip-color-${layer.id}`;
        ramp.style.background = buildGradient(layer.preset, layer.reverse);
        ramp.addEventListener('click', e => { e.stopPropagation(); openColorSheet(layer); });
        card.appendChild(ramp);
    } else {
        const swatch = document.createElement('div');
        swatch.className = 'layer-strip-solid-swatch';
        swatch.id = `l4-chip-color-${layer.id}`;
        swatch.style.background = layer.preset;

        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = layer.preset;
        picker.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none;';
        card.appendChild(picker);

        swatch.addEventListener('click', e => { e.stopPropagation(); picker.click(); });
        picker.addEventListener('input', e => {
            layer.preset = e.target.value;
            swatch.style.background = layer.preset;
            refreshDataLayer();
        });
        card.appendChild(swatch);
    }

    const toggleLayer = () => {
        layer.visible = !layer.visible;
        syncLayerVisible(layer);
        refreshDataLayer();
    };

    card.addEventListener('click', toggleLayer);
    card.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleLayer();
    });

    return card;
}

function getL4LayerStatusMarkup(key) {
    if (key === 'parks') {
        return `
            <svg class="state-on" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>
            <svg class="state-off" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.6 10.6A2 2 0 0 0 13.4 13.4"/>
                <path d="M9.9 4.4A10.4 10.4 0 0 1 12 4c6.5 0 10 8 10 8a18.8 18.8 0 0 1-3.1 4.2"/>
                <path d="M6.6 6.6C3.7 8.5 2 12 2 12a18.6 18.6 0 0 0 7.4 6.1A10.8 10.8 0 0 0 12 18c.7 0 1.4-.1 2.1-.3"/>
                <line x1="3" y1="3" x2="21" y2="21"/>
            </svg>
        `;
    }

    if (key === 'urban') {
        return `
            <svg class="state-on" viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
            <svg class="state-off" viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        `;
    }

    return '';
}

// ─── STRIP CHIP (L1) ───

// ─── COLOR SHEET (L1 + L2) ───

function openColorSheet(layer) {
    document.getElementById('color-sheet-title').textContent = layer.id;
    const body = document.getElementById('color-sheet-body');

    const schemeBtns = Object.keys(COLORMAP_PRESETS)
        .map(k => `<button class="scheme-btn${k === layer.preset ? ' active' : ''}" data-scheme="${k}" title="${k}" style="background:${buildGradient(k, false)};"></button>`)
        .join('');

    body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-lo);">Palette</span>
            <button class="btn-reverse${layer.reverse ? ' active' : ''}" id="cs-rev">&#x21C4; Reverse</button>
        </div>
        <div class="color-sheet-scheme-grid">${schemeBtns}</div>
        <div class="color-sheet-preview" id="cs-preview" style="background:${buildGradient(layer.preset, layer.reverse)};height:14px;border-radius:4px;border:1px solid var(--border);margin-top:8px;transition:background var(--transition);"></div>
    `;

    body.querySelectorAll('.scheme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            layer.preset = btn.dataset.scheme;
            body.querySelectorAll('.scheme-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('cs-preview').style.background = buildGradient(layer.preset, layer.reverse);
            syncLayerColor(layer);
            updateDrawerBar(layer);
            refreshDataLayer();
        });
    });

    document.getElementById('cs-rev').addEventListener('click', () => {
        layer.reverse = !layer.reverse;
        document.getElementById('cs-rev').classList.toggle('active', layer.reverse);
        document.getElementById('cs-preview').style.background = buildGradient(layer.preset, layer.reverse);
        syncLayerColor(layer);
        updateDrawerBar(layer);
        refreshDataLayer();
    });

    document.getElementById('color-sheet').classList.add('open');
    document.getElementById('color-sheet-backdrop').classList.add('open');
}

function closeColorSheet() {
    document.getElementById('color-sheet').classList.remove('open');
    document.getElementById('color-sheet-backdrop').classList.remove('open');
}

// ─── SEARCH SHEET ───

function openSearchSheet() {
    document.getElementById('search-sheet').classList.add('open');
    document.getElementById('search-sheet-backdrop').classList.add('open');
    setTimeout(() => document.getElementById('search-input').focus(), 180);
}

function closeSearchSheet() {
    document.getElementById('search-sheet').classList.remove('open');
    document.getElementById('search-sheet-backdrop').classList.remove('open');
}

async function doSearch(inputId = 'search-input', resultsId = 'search-results', opts = {}) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(resultsId);
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
        data.forEach(item => {
            const parts = item.display_name.split(',');
            const li = document.createElement('li');
            li.innerHTML = `<div class="result-name">${parts[0].trim()}</div>
                <div class="result-detail">${parts.slice(1, 3).map(s => s.trim()).join(', ')}</div>`;
            li.addEventListener('click', () => {
                if (mapEngine) mapEngine.flyTo([parseFloat(item.lon), parseFloat(item.lat)], 12);
                if (opts.closeOnSelect) opts.closeOnSelect();
            });
            list.appendChild(li);
        });
    } catch {
        list.innerHTML = '<li class="result-empty">Search failed.</li>';
    }
}

function initSearch() {
    document.getElementById('search-sheet-close').addEventListener('click', closeSearchSheet);
    document.getElementById('search-sheet-backdrop').addEventListener('click', closeSearchSheet);
    bindSearchControls('search-input', 'search-go', 'search-results', { closeOnSelect: closeSearchSheet });
}

function bindSearchControls(inputId, buttonId, resultsId, opts = {}) {
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    if (!input || !button) return;

    button.addEventListener('click', () => doSearch(inputId, resultsId, opts));
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') doSearch(inputId, resultsId, opts);
    });
}

// ─── GEOLOCATION ───

function bindLocBtn(id) {
    const btn = document.getElementById(id);
    if (!btn) return;
    // Use onclick to avoid listener accumulation on layout switches
    btn.onclick = () => {
        if (!navigator.geolocation) return;
        btn.classList.add('active');
        navigator.geolocation.getCurrentPosition(
            pos => {
                btn.classList.remove('active');
                if (mapEngine) mapEngine.flyTo([pos.coords.longitude, pos.coords.latitude], 14);
            },
            () => btn.classList.remove('active')
        );
    };
}

function bindSearchBtn(id) {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = openSearchSheet;
}

function getMyLocationIconSvg() {
    return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>
            <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
        </svg>
    `;
}

// ════════════════════════════════════════════════
//  LAYOUT BUILDERS
// ════════════════════════════════════════════════

function clearLayout4() {
    ['l4-layer-strip', 'l4-basemap-popup', 'l4-drawer-body'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    document.getElementById('l4-basemap-popup')?.classList.remove('open');
    document.getElementById('l4-drawer')?.classList.remove('open');
    document.getElementById('l4-backdrop')?.classList.remove('open');
}

// ── Layout 1 ──


// ── Layout 2 ──

    // Vertical layer cards — one per layer, all fit in one row inside the strip
    // Toggle popup on config FAB click

// ── Layout 4 ──

function buildLayout4() {
    clearLayout4();

    const strip = document.getElementById('l4-layer-strip');

    layerState.forEach(layer => strip.appendChild(makeL4LayerCard(layer)));

    const popup = document.getElementById('l4-basemap-popup');
    popup.innerHTML = '';

    const engLabel = document.createElement('div');
    engLabel.className = 'bm-row-label';
    engLabel.style.marginBottom = '6px';
    engLabel.textContent = 'Map Engine';
    popup.appendChild(engLabel);

    const engWrap = document.createElement('div');
    engWrap.className = 'engine-switcher';
    engWrap.style.marginBottom = '12px';
    engWrap.innerHTML = `
        <button class="engine-btn" data-engine="leaflet">Leaflet</button>
        <button class="engine-btn" data-engine="maplibre">MapLibre</button>
    `;
    popup.appendChild(engWrap);
    initEngineBtns(engWrap);

    const divider = document.createElement('div');
    divider.style.cssText = 'border-top:1px solid var(--border);margin-bottom:12px;';
    popup.appendChild(divider);

    const bmBlock = document.createElement('div');
    bmBlock.id = 'l4-bm-inner';
    popup.appendChild(bmBlock);
    buildBasemapBlock(bmBlock, { includeDataLayerOpacity: true });

    const bmBtn = document.getElementById('l4-basemap-btn');
    bmBtn.onclick = e => {
        e.stopPropagation();
        document.getElementById('l4-drawer')?.classList.remove('open');
        document.getElementById('l4-backdrop')?.classList.remove('open');
        popup.classList.toggle('open');
    };
    if (!_l4PopupHandlerAttached) {
        _l4PopupHandlerAttached = true;
        document.addEventListener('click', e => {
            const p = document.getElementById('l4-basemap-popup');
            const b = document.getElementById('l4-basemap-btn');
            if (p && b && !p.contains(e.target) && e.target !== b) p.classList.remove('open');
        });
    }

    buildDrawerBody(document.getElementById('l4-drawer-body'), { includeLocationTools: true });

    document.getElementById('l4-settings-btn').onclick = () => {
        popup.classList.remove('open');
        document.getElementById('l4-drawer').classList.add('open');
        document.getElementById('l4-backdrop').classList.add('open');
    };
    document.getElementById('l4-drawer-close').onclick = closeLayout4Drawer;
    document.getElementById('l4-backdrop').onclick = closeLayout4Drawer;

    bindSearchBtn('l4-search-btn');
    bindLocBtn('l4-loc-btn');

    requestAnimationFrame(() => {
        const h = document.getElementById('l4-bottom')?.offsetHeight;
        if (h) document.documentElement.style.setProperty('--l4-bottom-h', `${h}px`);
    });
}

// ── Layout 3 ──

function closeLayout4Drawer() {
    document.getElementById('l4-drawer').classList.remove('open');
    document.getElementById('l4-backdrop').classList.remove('open');
}

// ── Drawer body (L3 settings) ──

function buildDrawerBody(container, opts = {}) {
    container.innerHTML = '';

    addSectionLabel(container, 'Data Layers');

    layerState.forEach(layer => {
        const card = document.createElement('div');
        card.className = `layer-card${layer.visible ? '' : ' inactive'}`;

        let headerControls = '', dropdownHtml = '';
        if (layer.type === 'category') {
            const schemeBtns = Object.keys(COLORMAP_PRESETS)
                .map(k => `<button class="scheme-btn${k === layer.preset ? ' active' : ''}" data-scheme="${k}" style="background:${buildGradient(k, false)};"></button>`)
                .join('');
            headerControls = `
                <button class="btn-reverse${layer.reverse ? ' active' : ''}" id="drev-${layer.id}">&#x21C4;</button>
                <div class="scheme-bar-btn" id="dbar-${layer.id}" style="background:${buildGradient(layer.preset, layer.reverse)};"></div>
            `;
            dropdownHtml = `
                <div class="scheme-dropdown" id="ddrop-${layer.id}">
                    <div class="scheme-grid" id="dschemes-${layer.id}">${schemeBtns}</div>
                </div>
            `;
        } else {
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
            ${dropdownHtml}
        `;
        container.appendChild(card);

        document.getElementById(`dvis-${layer.id}`).addEventListener('change', e => {
            layer.visible = e.target.checked;
            card.classList.toggle('inactive', !layer.visible);
            syncLayerVisible(layer);
            refreshDataLayer();
        });

        if (layer.type === 'category') {
            document.getElementById(`dbar-${layer.id}`).addEventListener('click', e => {
                e.stopPropagation();
                document.querySelectorAll('.scheme-dropdown.open').forEach(d => {
                    if (d.id !== `ddrop-${layer.id}`) d.classList.remove('open');
                });
                document.getElementById(`ddrop-${layer.id}`).classList.toggle('open');
            });

            document.getElementById(`dschemes-${layer.id}`).querySelectorAll('.scheme-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    layer.preset = btn.dataset.scheme;
                    document.getElementById(`dschemes-${layer.id}`).querySelectorAll('.scheme-btn')
                        .forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    document.getElementById(`dbar-${layer.id}`).style.background = buildGradient(layer.preset, layer.reverse);
                    syncLayerColor(layer);
                    refreshDataLayer();
                    document.getElementById(`ddrop-${layer.id}`).classList.remove('open');
                });
            });

            document.getElementById(`drev-${layer.id}`).addEventListener('click', e => {
                e.stopPropagation();
                layer.reverse = !layer.reverse;
                document.getElementById(`drev-${layer.id}`).classList.toggle('active', layer.reverse);
                document.getElementById(`dbar-${layer.id}`).style.background = buildGradient(layer.preset, layer.reverse);
                syncLayerColor(layer);
                refreshDataLayer();
            });
        } else {
            document.getElementById(`dcol-${layer.id}`).addEventListener('input', e => {
                layer.preset = e.target.value;
                syncLayerColor(layer);
                refreshDataLayer();
            });
        }
    });

    // Data Layer Opacity
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
        </div>
    `;
    container.appendChild(opDiv);
    document.getElementById('drawer-dl-opacity').addEventListener('input', e => {
        dataLayerOpacity = parseFloat(e.target.value);
        document.getElementById('drawer-dl-val').textContent = `${Math.round(dataLayerOpacity * 100)}%`;
        if (mapEngine) mapEngine.updateDataLayerOpacity(dataLayerOpacity);
    });

    // Map Engine
    addSectionLabel(container, 'Map Engine');
    const engWrap = document.createElement('div');
    engWrap.className = 'basemap-card';
    engWrap.style.padding = '10px 12px';
    engWrap.innerHTML = `
        <div class="engine-switcher">
            <button class="engine-btn" data-engine="leaflet">Leaflet</button>
            <button class="engine-btn" data-engine="maplibre">MapLibre</button>
        </div>
    `;
    container.appendChild(engWrap);
    initEngineBtns(engWrap);

    // Basemap
    addSectionLabel(container, 'Basemap');
    const bmWrap = document.createElement('div');
    bmWrap.className = 'basemap-card';
    bmWrap.id = 'drawer-bm-area';
    bmWrap.style.padding = '10px 12px';
    container.appendChild(bmWrap);
    buildBasemapBlock(bmWrap);

    if (opts.includeLocationTools) appendDrawerLocationTools(container);
}

function appendDrawerLocationTools(container) {
    const section = document.createElement('div');
    section.className = 'drawer-location-section';
    container.appendChild(section);

    addSectionLabel(section, 'Location');

    const locWrap = document.createElement('div');
    locWrap.className = 'basemap-card drawer-location-card';
    locWrap.innerHTML = `
        <div class="search-input-row drawer-search-row">
            <input id="drawer-search-input" type="text" placeholder="Search location…" autocomplete="off" />
            <button id="drawer-search-go" class="search-go-btn">Go</button>
        </div>
        <ul id="drawer-search-results" class="search-results drawer-search-results"></ul>
        <button id="drawer-loc-btn" class="drawer-action-btn" type="button">
            ${getMyLocationIconSvg()}
            <span>My location</span>
        </button>
    `;
    section.appendChild(locWrap);

    bindSearchControls('drawer-search-input', 'drawer-search-go', 'drawer-search-results');
    bindLocBtn('drawer-loc-btn');
}

function addSectionLabel(parent, text) {
    const div = document.createElement('div');
    div.className = 'section-label';
    div.textContent = text;
    parent.appendChild(div);
}

// ─── LAYOUT SWITCHER ───


// ─── THEME SWITCHER ───

function initThemeSwitcher() {
    const saved = localStorage.getItem('map-theme') || 'glass';
    document.getElementById('theme-link').href = `themes/theme_${saved}.css`;

    const buttons = document.querySelectorAll('.dev-theme-btn');
    buttons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === saved);
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const t = btn.dataset.theme;
            document.getElementById('theme-link').href = `themes/theme_${t}.css`;
            localStorage.setItem('map-theme', t);
        });
    });
}

// ─── STARTUP ───

document.addEventListener('DOMContentLoaded', () => {
    buildLayout4();
    initThemeSwitcher();

    // Shared sheet init
    document.getElementById('color-sheet-close').addEventListener('click', closeColorSheet);
    document.getElementById('color-sheet-backdrop').addEventListener('click', closeColorSheet);
    initSearch();

    // Start map engine
    const pos = getNavControlPos();
    const ctor = activeEngine === 'leaflet' ? LeafletEngine : MapLibreEngine;
    const cpos = activeEngine === 'leaflet' ? pos.leaflet    : pos.maplibre;

    mapEngine = new ctor();
    mapEngine.init('map', [13.3, 51.0], 8, cpos).then(afterEngineInit);

    window.addEventListener('resize', () => {
        requestAnimationFrame(() => {
            const h4 = document.getElementById('l4-bottom')?.offsetHeight;
            if (h4) document.documentElement.style.setProperty('--l4-bottom-h', `${h4}px`);
        });
    });
});
