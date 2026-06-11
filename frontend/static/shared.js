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

let activeLayout = localStorage.getItem('map-layout') || '1';
let activeEngine = localStorage.getItem('map-engine') || 'leaflet';
let mapEngine = null;
let _l2PopupHandlerAttached = false;
let _l4PopupHandlerAttached = false;

function getNavControlPos() {
    if (activeLayout === '1') return { leaflet: 'bottomright', maplibre: 'bottom-right' };
    if (activeLayout === '2' || activeLayout === '4') return { leaflet: 'topleft',     maplibre: 'top-left'     };
    return                           { leaflet: 'bottomleft',  maplibre: 'bottom-left'  };
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
    const chip = document.getElementById(`chip-${layer.id}`);
    if (chip) {
        chip.classList.toggle('inactive', !layer.visible);
        const cb = chip.querySelector('input[type=checkbox]');
        if (cb) cb.checked = layer.visible;
    }
    const pill = document.getElementById(`pill-${layer.id}`);
    if (pill) {
        pill.classList.toggle('inactive', !layer.visible);
        const cb = pill.querySelector('input[type=checkbox]');
        if (cb) cb.checked = layer.visible;
    }
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
    [`chip-color-${layer.id}`, `l4-chip-color-${layer.id}`].forEach(id => {
        const chipColor = document.getElementById(id);
        if (!chipColor) return;
        chipColor.style.background = layer.type === 'category'
            ? buildGradient(layer.preset, layer.reverse)
            : layer.preset;
    });
}

function updateDrawerBar(layer) {
    const bar = document.getElementById(`dbar-${layer.id}`);
    if (bar) bar.style.background = buildGradient(layer.preset, layer.reverse);
}

// ─── TOGGLE WIDGET (no ID on checkbox — use container IDs for sync) ───
function buildToggle(layer) {
    const label = document.createElement('label');
    label.className = 'toggle';
    label.title = 'Toggle visibility';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = layer.visible;

    const track = document.createElement('span');
    track.className = 'toggle-track';

    label.appendChild(cb);
    label.appendChild(track);

    cb.addEventListener('change', e => {
        layer.visible = e.target.checked;
        syncLayerVisible(layer);
        refreshDataLayer();
    });

    return label;
}

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
function makeL2LayerCard(layer) {
    const card = document.createElement('div');
    card.className = `l2-layer-card${layer.visible ? '' : ' inactive'}`;
    card.id = `chip-${layer.id}`;  // reuse chip- id so syncLayerVisible works

    // Row 1: toggle
    card.appendChild(buildToggle(layer));

    // Row 2: name
    const nameEl = document.createElement('span');
    nameEl.className = 'layer-name';
    nameEl.textContent = layer.id;
    card.appendChild(nameEl);

    // Row 3: color ramp / solid swatch
    if (layer.type === 'category') {
        const ramp = document.createElement('div');
        ramp.className = 'l2-chip-ramp';
        ramp.id = `chip-color-${layer.id}`;
        ramp.style.background = buildGradient(layer.preset, layer.reverse);
        ramp.addEventListener('click', e => { e.stopPropagation(); openColorSheet(layer); });
        card.appendChild(ramp);
    } else {
        const swatch = document.createElement('div');
        swatch.className = 'l2-chip-solid-swatch';
        swatch.id = `chip-color-${layer.id}`;
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

    return card;
}

// ─── LAYOUT 4 LAYER CARD (L2 base with per-layer status icons) ───
function makeL4LayerCard(layer) {
    const key = layer.id.toLowerCase();
    const card = document.createElement('div');
    card.className = `l2-layer-card l4-layer-card l4-layer-card--${key}${layer.visible ? '' : ' inactive'}`;
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
        ramp.className = 'l2-chip-ramp';
        ramp.id = `l4-chip-color-${layer.id}`;
        ramp.style.background = buildGradient(layer.preset, layer.reverse);
        ramp.addEventListener('click', e => { e.stopPropagation(); openColorSheet(layer); });
        card.appendChild(ramp);
    } else {
        const swatch = document.createElement('div');
        swatch.className = 'l2-chip-solid-swatch';
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
function makeStripChip(layer) {
    const chip = document.createElement('div');
    chip.className = `strip-chip${layer.visible ? '' : ' inactive'}`;
    chip.id = `chip-${layer.id}`;

    chip.appendChild(buildToggle(layer));

    const nameEl = document.createElement('span');
    nameEl.className = 'layer-name';
    nameEl.textContent = layer.id;
    chip.appendChild(nameEl);

    if (layer.type === 'category') {
        const bar = document.createElement('div');
        bar.className = 'chip-gradient';
        bar.id = `chip-color-${layer.id}`;
        bar.style.background = buildGradient(layer.preset, layer.reverse);
        bar.addEventListener('click', e => { e.stopPropagation(); openColorSheet(layer); });
        chip.appendChild(bar);
    } else {
        const swatch = document.createElement('div');
        swatch.className = 'chip-solid';
        swatch.id = `chip-color-${layer.id}`;
        swatch.style.background = layer.preset;

        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = layer.preset;
        picker.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none;';
        chip.appendChild(picker);

        swatch.addEventListener('click', e => { e.stopPropagation(); picker.click(); });
        picker.addEventListener('input', e => {
            layer.preset = e.target.value;
            swatch.style.background = layer.preset;
            refreshDataLayer();
        });
        chip.appendChild(swatch);
    }

    return chip;
}

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
    setTimeout(() => document.getElementById('search-input').focus(), 280);
}

function closeSearchSheet() {
    document.getElementById('search-sheet').classList.remove('open');
    document.getElementById('search-sheet-backdrop').classList.remove('open');
}

async function doSearch() {
    const q = document.getElementById('search-input').value.trim();
    if (!q) return;
    const list = document.getElementById('search-results');
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
                closeSearchSheet();
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
    document.getElementById('search-go').addEventListener('click', doSearch);
    document.getElementById('search-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') doSearch();
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

// ════════════════════════════════════════════════
//  LAYOUT BUILDERS
// ════════════════════════════════════════════════

function clearAllLayouts() {
    ['l1-layer-strip', 'l1-basemap-area',
     'l2-layer-strip', 'l2-engine-row', 'l2-basemap-popup',
     'l3-layers', 'l3-drawer-body',
     'l4-layer-strip', 'l4-engine-row', 'l4-basemap-popup', 'l4-drawer-body'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    // Remove popup open state
    ['l2-basemap-popup', 'l4-basemap-popup'].forEach(id => {
        document.getElementById(id)?.classList.remove('open');
    });
    // Close drawer
    document.getElementById('l3-drawer')?.classList.remove('open');
    document.getElementById('l3-backdrop')?.classList.remove('open');
    document.getElementById('l4-drawer')?.classList.remove('open');
    document.getElementById('l4-backdrop')?.classList.remove('open');
}

function buildCurrentLayout() {
    clearAllLayouts();
    if (activeLayout === '1') buildLayout1();
    else if (activeLayout === '2') buildLayout2();
    else if (activeLayout === '3') buildLayout3();
    else buildLayout4();
}

// ── Layout 1 ──

function buildLayout1() {
    const strip = document.getElementById('l1-layer-strip');
    layerState.forEach(layer => strip.appendChild(makeStripChip(layer)));

    buildBasemapBlock(document.getElementById('l1-basemap-area'), { includeDataLayerOpacity: true });

    bindSearchBtn('l1-search-btn');
    bindLocBtn('l1-loc-btn');

    requestAnimationFrame(() => {
        const h = document.getElementById('l1-bottom')?.offsetHeight;
        if (h) document.documentElement.style.setProperty('--l1-bottom-h', `${h}px`);
    });
}

// ── Layout 2 ──

function buildLayout2() {
    // Vertical layer cards — one per layer, all fit in one row inside the strip
    const strip = document.getElementById('l2-layer-strip');
    strip.innerHTML = '';
    document.getElementById('l2-engine-row').innerHTML = '';

    layerState.forEach(layer => strip.appendChild(makeL2LayerCard(layer)));

    // Config popup: engine switcher + basemap + opacity
    const popup = document.getElementById('l2-basemap-popup');
    popup.innerHTML = '';

    // Engine switcher section
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

    // Divider
    const divider = document.createElement('div');
    divider.style.cssText = 'border-top:1px solid var(--border);margin-bottom:12px;';
    popup.appendChild(divider);

    // Basemap + opacity block
    const bmBlock = document.createElement('div');
    bmBlock.id = 'l2-bm-inner';
    popup.appendChild(bmBlock);
    buildBasemapBlock(bmBlock, { includeDataLayerOpacity: true });

    // Toggle popup on config FAB click
    const bmBtn = document.getElementById('l2-basemap-btn');
    bmBtn.onclick = e => { e.stopPropagation(); popup.classList.toggle('open'); };
    if (!_l2PopupHandlerAttached) {
        _l2PopupHandlerAttached = true;
        document.addEventListener('click', e => {
            const p = document.getElementById('l2-basemap-popup');
            const b = document.getElementById('l2-basemap-btn');
            if (p && b && !p.contains(e.target) && e.target !== b) p.classList.remove('open');
        });
    }

    bindSearchBtn('l2-search-btn');
    bindLocBtn('l2-loc-btn');

    requestAnimationFrame(() => {
        const h = document.getElementById('l2-bottom')?.offsetHeight;
        if (h) document.documentElement.style.setProperty('--l2-bottom-h', `${h}px`);
    });
}

// ── Layout 4 ──

function buildLayout4() {
    const strip = document.getElementById('l4-layer-strip');
    strip.innerHTML = '';
    document.getElementById('l4-engine-row').innerHTML = '';

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

    buildDrawerBody(document.getElementById('l4-drawer-body'));

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

function buildLayout3() {
    // Layer pills
    const pillsEl = document.getElementById('l3-layers');
    layerState.forEach(layer => {
        const pill = document.createElement('div');
        pill.className = `layer-pill${layer.visible ? '' : ' inactive'}`;
        pill.id = `pill-${layer.id}`;
        pill.appendChild(buildToggle(layer));
        const nameEl = document.createElement('span');
        nameEl.className = 'layer-name';
        nameEl.textContent = layer.id;
        pill.appendChild(nameEl);
        pillsEl.appendChild(pill);
    });

    buildDrawerBody(document.getElementById('l3-drawer-body'));

    document.getElementById('l3-settings-btn').onclick = () => {
        document.getElementById('l3-drawer').classList.add('open');
        document.getElementById('l3-backdrop').classList.add('open');
    };
    document.getElementById('l3-drawer-close').onclick = closeDrawer;
    document.getElementById('l3-backdrop').onclick = closeDrawer;

    bindSearchBtn('l3-search-btn');
    bindLocBtn('l3-loc-btn');
}

function closeDrawer() {
    document.getElementById('l3-drawer').classList.remove('open');
    document.getElementById('l3-backdrop').classList.remove('open');
}

function closeLayout4Drawer() {
    document.getElementById('l4-drawer').classList.remove('open');
    document.getElementById('l4-backdrop').classList.remove('open');
}

// ── Drawer body (L3 settings) ──

function buildDrawerBody(container) {
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
                <span class="val" id="d3-dl-val">${Math.round(dataLayerOpacity * 100)}%</span>
            </div>
            <input type="range" id="d3-dl-opacity" min="0" max="1" step="0.01" value="${dataLayerOpacity}" />
        </div>
    `;
    container.appendChild(opDiv);
    document.getElementById('d3-dl-opacity').addEventListener('input', e => {
        dataLayerOpacity = parseFloat(e.target.value);
        document.getElementById('d3-dl-val').textContent = `${Math.round(dataLayerOpacity * 100)}%`;
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
    bmWrap.id = 'l3-bm-area';
    bmWrap.style.padding = '10px 12px';
    container.appendChild(bmWrap);
    buildBasemapBlock(bmWrap);
}

function addSectionLabel(parent, text) {
    const div = document.createElement('div');
    div.className = 'section-label';
    div.textContent = text;
    parent.appendChild(div);
}

// ─── LAYOUT SWITCHER ───

function initLayoutSwitcher() {
    const sw = document.getElementById('layout-switcher');
    sw.value = activeLayout;

    sw.addEventListener('change', e => {
        const next = e.target.value;
        if (next === activeLayout) return;

        let center = [13.3, 51.0], zoom = 8;
        if (mapEngine) {
            center = mapEngine.getCenter();
            zoom   = mapEngine.getZoom();
            mapEngine.destroy();
            mapEngine = null;
        }

        activeLayout = next;
        localStorage.setItem('map-layout', activeLayout);
        document.body.dataset.layout = activeLayout;

        buildCurrentLayout();

        // Reinit engine with new nav-control position
        const oldEl = document.getElementById('map');
        oldEl.parentNode.replaceChild(oldEl.cloneNode(false), oldEl);
        window.boundsSet = true; // keep current viewport

        const pos = getNavControlPos();
        const ctor = activeEngine === 'leaflet' ? LeafletEngine : MapLibreEngine;
        const cpos = activeEngine === 'leaflet' ? pos.leaflet    : pos.maplibre;

        mapEngine = new ctor();
        mapEngine.init('map', center, zoom, cpos).then(afterEngineInit);
    });
}

// ─── THEME SWITCHER ───

function initThemeSwitcher() {
    const sw = document.getElementById('theme-switcher');
    const saved = localStorage.getItem('map-theme') || 'glass';
    sw.value = saved;
    document.getElementById('theme-link').href = `themes/theme_${saved}.css`;

    sw.addEventListener('change', e => {
        const t = e.target.value;
        document.getElementById('theme-link').href = `themes/theme_${t}.css`;
        localStorage.setItem('map-theme', t);
    });
}

// ─── STARTUP ───

document.addEventListener('DOMContentLoaded', () => {
    document.body.dataset.layout = activeLayout;

    buildCurrentLayout();
    initLayoutSwitcher();
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
            const h1 = document.getElementById('l1-bottom')?.offsetHeight;
            if (h1) document.documentElement.style.setProperty('--l1-bottom-h', `${h1}px`);
            const h2 = document.getElementById('l2-bottom')?.offsetHeight;
            if (h2) document.documentElement.style.setProperty('--l2-bottom-h', `${h2}px`);
            const h4 = document.getElementById('l4-bottom')?.offsetHeight;
            if (h4) document.documentElement.style.setProperty('--l4-bottom-h', `${h4}px`);
        });
    });
});
