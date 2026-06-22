// ─────────────────────────────────────────────
//  APP.JS — UI orchestration
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
    loadTheme();
    buildAllPanels();
    buildLayerStrip();
    wireTopBar();
    wireFabs();
    wireSearch();
    initMapEngine();
});

// ─── THEME ────────────────────────────────────

function loadTheme() {
    setTheme(localStorage.getItem('theme') || 'light', false);
}

function setTheme(t, save) {
    document.documentElement.setAttribute('data-theme', t);
    if (save !== false) localStorage.setItem('theme', t);
    document.querySelectorAll('.theme-seg-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.theme === t);
    });
}

// ─── MAP INIT ─────────────────────────────────

function initMapEngine() {
    var ctor = activeEngine === 'leaflet' ? LeafletEngine : MapLibreEngine;
    mapEngine = new ctor();
    mapEngine.init('map', DEFAULT_CENTER, DEFAULT_ZOOM, NAV_CONTROL_POSITIONS[activeEngine])
        .then(function () {
            afterEngineInit(true);
            wireLocationButtons();
        });
}

// ─── PANEL BUILDER ────────────────────────────

function layerGradientStyle(layer) {
    if (layer.type === 'solid') {
        return 'background:' + layer.preset.slice(0, 7) + ';';
    }
    return 'background:' + buildGradient(layer.preset, layer.reverse) + ';';
}

function buildPanelHTML() {
    var layersHTML = layerState.map(function (layer) {
        var grad = layerGradientStyle(layer);
        var checked = layer.visible ? 'checked' : '';
        var isWater = layer.type === 'solid';
        return [
            '<div class="layer-row" data-layer="' + layer.id + '">',
            '  <label class="toggle">',
            '    <input type="checkbox" data-ctrl="layer-toggle" data-layer="' + layer.id + '" ' + checked + '>',
            '    <span class="toggle-track"></span>',
            '  </label>',
            '  <span class="layer-name">' + layer.id + '</span>',
            (isWater
                ? '  <div class="gradient-bar" data-grad="' + layer.id + '" style="' + grad + '"></div>'
                : '  <div class="gradient-bar" data-grad="' + layer.id + '" data-ctrl="colormap-pick" data-layer="' + layer.id + '" style="' + grad + '" role="button" tabindex="0" title="Farbschema wählen"></div>'
            ),
            '  <button class="reverse-btn' + (isWater ? ' hidden' : '') + '" data-ctrl="layer-reverse" data-layer="' + layer.id + '" title="Umkehren">⇄</button>',
            '</div>'
        ].join('');
    }).join('');

    var currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    var hotspotChecked = hotspotMode ? 'checked' : '';
    var dataOpacityVal = Math.round(dataLayerOpacity * 100);
    var basemapOpacityVal = Math.round(basemapOpacity * 100);
    var basemapEnabled = activeBasemapKey !== 'none';

    return [
        '<!-- Panel header with theme switcher -->',
        '<div class="panel-header">',
        '  <div class="theme-seg">',
        '    <button class="theme-seg-btn' + (currentTheme === 'light' ? ' active' : '') + '" data-ctrl="theme" data-theme="light">Light</button>',
        '    <button class="theme-seg-btn' + (currentTheme === 'dark'  ? ' active' : '') + '" data-ctrl="theme" data-theme="dark">Dark</button>',
        '  </div>',
        '  <button class="icon-btn" data-ctrl="panel-close" title="Schließen">',
        '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
        '  </button>',
        '</div>',

        '<!-- Hotspot mode -->',
        '<div class="section-label">HOTSPOT MODE</div>',
        '<div class="hotspot-row">',
        '  <label class="toggle">',
        '    <input type="checkbox" data-ctrl="hotspot" ' + hotspotChecked + '>',
        '    <span class="toggle-track"></span>',
        '  </label>',
        '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2c0 6-6 8-6 14a6 6 0 0 0 12 0c0-6-6-8-6-14z"/></svg>',
        '  <span class="row-name">Hotspot</span>',
        '  <span class="row-hint">Top values only</span>',
        '</div>',

        '<div class="divider"></div>',

        '<!-- Data layers -->',
        '<div class="section-label">DATA LAYERS</div>',
        layersHTML,
        '<div class="opacity-row">',
        '  <span class="opacity-label">Opacity</span>',
        '  <input type="range" data-ctrl="data-opacity" min="0" max="100" value="' + dataOpacityVal + '">',
        '  <span class="opacity-val" data-disp="data-opacity">' + dataOpacityVal + '%</span>',
        '</div>',

        '<div class="divider"></div>',

        '<!-- Backend -->',
        '<div class="section-label">BACKEND</div>',

        '<div class="sub-card">',
        '  <div class="sub-label">MAP ENGINE</div>',
        '  <div class="btn-group">',
        '    <button class="seg-btn' + (activeEngine === 'leaflet'   ? ' active' : '') + '" data-ctrl="engine" data-engine="leaflet">Leaflet</button>',
        '    <button class="seg-btn' + (activeEngine === 'maplibre'  ? ' active' : '') + '" data-ctrl="engine" data-engine="maplibre">MapLibre</button>',
        '  </div>',
        '</div>',

        '<div class="sub-card">',
        '  <div class="sub-label-row">',
        '    <div class="sub-label">BASEMAP</div>',
        '    <label class="toggle">',
        '      <input type="checkbox" data-ctrl="basemap-toggle" ' + (basemapEnabled ? 'checked' : '') + '>',
        '      <span class="toggle-track"></span>',
        '    </label>',
        '  </div>',
        '  <div class="btn-group">',
        '    <button class="seg-btn' + (activeBasemapKey === 'osm'         ? ' active' : '') + '" data-ctrl="basemap" data-basemap="osm">OSM</button>',
        '    <button class="seg-btn' + (activeBasemapKey === 'satellite'   ? ' active' : '') + '" data-ctrl="basemap" data-basemap="satellite">Satellite</button>',
        '    <button class="seg-btn' + (activeBasemapKey === 'schummerung' ? ' active' : '') + '" data-ctrl="basemap" data-basemap="schummerung">Relief</button>',
        '  </div>',
        '  <div class="opacity-row">',
        '    <span class="opacity-label">Opacity</span>',
        '    <input type="range" data-ctrl="basemap-opacity" min="0" max="100" value="' + basemapOpacityVal + '">',
        '    <span class="opacity-val" data-disp="basemap-opacity">' + basemapOpacityVal + '%</span>',
        '  </div>',
        '</div>',

        '<div class="sub-card">',
        '  <div class="sub-label">OVERLAYS</div>',
        '  <div class="btn-group">',
        '    <button class="seg-btn' + (activeOverlays.hiking   ? ' toggled' : '') + '" data-ctrl="overlay" data-overlay="hiking">Hiking</button>',
        '    <button class="seg-btn' + (activeOverlays.cycling  ? ' toggled' : '') + '" data-ctrl="overlay" data-overlay="cycling">Cycling</button>',
        '  </div>',
        '</div>',

        '<div class="divider"></div>',

        '<!-- Location -->',
        '<div class="section-label">LOCATION</div>',
        '<div class="search-row">',
        '  <input type="text" data-ctrl="location-input" placeholder="Ort suchen…" autocomplete="off">',
        '  <button class="btn-go" data-ctrl="location-go">Go</button>',
        '</div>',
        '<button class="btn-full" data-ctrl="my-location">',
        '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L19 21L12 18L5 21Z"/></svg>',
        '  Mein Standort',
        '</button>'
    ].join('\n');
}

function buildAllPanels() {
    var html = buildPanelHTML();

    var panel = document.getElementById('settings-panel');
    if (panel) {
        panel.innerHTML = html;
        // Show panel on desktop
        if (window.innerWidth >= 768) {
            panel.classList.add('visible');
            document.body.classList.add('panel-open');
        }
    }

    var drawerScroll = document.querySelector('#mobile-drawer .drawer-scroll');
    if (drawerScroll) drawerScroll.innerHTML = html;

    wireAllPanelEvents();
}

// ─── PANEL EVENTS (delegated) ──────────────────

function wireAllPanelEvents() {
    // Use document-level delegation so both panel and drawer work
    document.addEventListener('change', onControlChange);
    document.addEventListener('input',  onControlInput);
    document.addEventListener('click',  onControlClick);
}

function onControlChange(e) {
    var ctrl = e.target.dataset.ctrl;
    if (!ctrl) return;

    if (ctrl === 'layer-toggle') {
        var id = e.target.dataset.layer;
        var layer = layerState.find(function (l) { return l.id === id; });
        if (!layer) return;
        layer.visible = e.target.checked;
        syncCheckboxes('layer-toggle', id, e.target.checked);
        refreshDataLayer();
        updateLayerTab(id, e.target.checked);
    }

    if (ctrl === 'hotspot') {
        hotspotMode = e.target.checked;
        syncCheckboxes('hotspot', null, e.target.checked);
        refreshDataLayer();
        updateHotspotTab(hotspotMode);
    }

    if (ctrl === 'basemap-toggle') {
        var enabled = e.target.checked;
        syncCheckboxes('basemap-toggle', null, enabled);
        if (!enabled) {
            activeBasemapKey = 'none';
            if (mapEngine) mapEngine.switchBasemap('none');
        } else {
            activeBasemapKey = 'osm';
            syncActiveBtn('basemap', 'osm');
            if (mapEngine) mapEngine.switchBasemap('osm');
        }
    }
}

function onControlInput(e) {
    var ctrl = e.target.dataset.ctrl;
    if (!ctrl) return;

    if (ctrl === 'data-opacity') {
        dataLayerOpacity = e.target.value / 100;
        document.querySelectorAll('[data-disp="data-opacity"]').forEach(function (el) {
            el.textContent = e.target.value + '%';
        });
        document.querySelectorAll('[data-ctrl="data-opacity"]').forEach(function (el) {
            if (el !== e.target) el.value = e.target.value;
        });
        if (mapEngine) mapEngine.updateDataLayerOpacity(dataLayerOpacity);
    }

    if (ctrl === 'basemap-opacity') {
        basemapOpacity = e.target.value / 100;
        document.querySelectorAll('[data-disp="basemap-opacity"]').forEach(function (el) {
            el.textContent = e.target.value + '%';
        });
        document.querySelectorAll('[data-ctrl="basemap-opacity"]').forEach(function (el) {
            if (el !== e.target) el.value = e.target.value;
        });
        if (mapEngine) mapEngine.updateBasemapOpacity(basemapOpacity);
    }
}

function onControlClick(e) {
    var btn = e.target.closest('[data-ctrl]');
    if (!btn) return;
    var ctrl = btn.dataset.ctrl;

    if (ctrl === 'theme') {
        setTheme(btn.dataset.theme);
    }

    if (ctrl === 'panel-close') {
        closePanel();
    }

    if (ctrl === 'colormap-pick') {
        openColormapPicker(btn, btn.dataset.layer);
        return;
    }

    if (ctrl === 'layer-reverse') {
        var id = btn.dataset.layer;
        var layer = layerState.find(function (l) { return l.id === id; });
        if (!layer) return;
        layer.reverse = !layer.reverse;
        var grad = layerGradientStyle(layer);
        document.querySelectorAll('[data-grad="' + id + '"]').forEach(function (el) {
            el.style.cssText = grad;
        });
        refreshDataLayer();
    }

    if (ctrl === 'engine') {
        var eng = btn.dataset.engine;
        if (eng === activeEngine) return;
        syncActiveBtn('engine', eng);
        switchEngine(eng);
        // rebind location buttons after engine switch
        setTimeout(wireLocationButtons, 1200);
    }

    if (ctrl === 'basemap') {
        var bm = btn.dataset.basemap;
        activeBasemapKey = bm;
        syncActiveBtn('basemap', bm);
        // ensure basemap toggle is checked
        document.querySelectorAll('[data-ctrl="basemap-toggle"]').forEach(function (el) {
            el.checked = true;
        });
        if (mapEngine) mapEngine.switchBasemap(bm);
    }

    if (ctrl === 'overlay') {
        var ov = btn.dataset.overlay;
        activeOverlays[ov] = !activeOverlays[ov];
        btn.classList.toggle('toggled', activeOverlays[ov]);
        // sync sibling button in other panel
        document.querySelectorAll('[data-ctrl="overlay"][data-overlay="' + ov + '"]').forEach(function (el) {
            el.classList.toggle('toggled', activeOverlays[ov]);
        });
        if (mapEngine) mapEngine.toggleOverlay(ov, activeOverlays[ov]);
    }

    if (ctrl === 'location-go') {
        var input = btn.parentElement.querySelector('[data-ctrl="location-input"]');
        if (input && input.value.trim()) {
            doSearch(input.value.trim());
        }
    }

}

// Enter key on location inputs
document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var ctrl = e.target.dataset.ctrl;
    if (ctrl === 'location-input') {
        if (e.target.value.trim()) doSearch(e.target.value.trim());
    }
    if (e.target.id === 'search-popover-input') {
        if (e.target.value.trim()) doSearch(e.target.value.trim());
    }
});

// ─── SYNC HELPERS ─────────────────────────────

function syncCheckboxes(ctrl, layer, checked) {
    var sel = '[data-ctrl="' + ctrl + '"]';
    if (layer) sel += '[data-layer="' + layer + '"]';
    document.querySelectorAll(sel).forEach(function (el) {
        el.checked = checked;
    });
}

function syncActiveBtn(ctrl, value) {
    var attr = ctrl === 'engine' ? 'data-engine' : 'data-basemap';
    document.querySelectorAll('[data-ctrl="' + ctrl + '"]').forEach(function (el) {
        el.classList.toggle('active', el.getAttribute(attr) === value);
    });
}

// ─── PANEL OPEN / CLOSE ───────────────────────

function openPanel() {
    var panel = document.getElementById('settings-panel');
    if (!panel) return;
    panel.classList.remove('sliding-out');
    panel.classList.add('visible');
    document.body.classList.add('panel-open');
}

function closePanel() {
    var panel = document.getElementById('settings-panel');
    if (!panel) return;
    panel.classList.add('sliding-out');
    document.body.classList.remove('panel-open');
    setTimeout(function () {
        panel.classList.remove('visible');
    }, 200);
}

// ─── LAYER STRIP (MOBILE) ─────────────────────

var STRIP_LAYERS = ['Nature', 'Farm', 'Parks', 'Urban'];

var EYE_ON  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
var FIRE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2c0 6-6 8-6 14a6 6 0 0 0 12 0c0-6-6-8-6-14z"/></svg>';

function buildLayerStrip() {
    var strip = document.getElementById('layer-strip');
    if (!strip) return;

    var html = STRIP_LAYERS.map(function (id) {
        var layer = layerState.find(function (l) { return l.id === id; });
        if (!layer) return '';
        var grad = layerGradientStyle(layer);
        var active = layer.visible ? ' active' : '';
        var icon = layer.visible ? EYE_ON : EYE_OFF;
        return [
            '<button class="layer-tab' + active + '" data-tab-layer="' + id + '" aria-label="' + id + ' Layer">',
            '  ' + icon,
            '  <span class="layer-tab-name">' + id + '</span>',
            '  <div class="layer-tab-grad" style="' + grad + '"></div>',
            '</button>'
        ].join('');
    }).join('');

    // Hotspot tab
    var hotspotActive = hotspotMode ? ' active' : '';
    html += [
        '<button class="layer-tab' + hotspotActive + '" data-tab-hotspot aria-label="Hotspot">',
        '  ' + FIRE_ICON,
        '  <span class="layer-tab-name">Hotspot</span>',
        '  <div class="layer-tab-grad" style="background: var(--c-border);"></div>',
        '</button>'
    ].join('');

    strip.innerHTML = html;

    strip.addEventListener('click', function (e) {
        var tab = e.target.closest('.layer-tab');
        if (!tab) return;

        if (tab.hasAttribute('data-tab-hotspot')) {
            hotspotMode = !hotspotMode;
            tab.classList.toggle('active', hotspotMode);
            tab.querySelector('svg').outerHTML; // no change needed for fire icon
            document.querySelectorAll('[data-ctrl="hotspot"]').forEach(function (el) {
                el.checked = hotspotMode;
            });
            refreshDataLayer();
            return;
        }

        var id = tab.dataset.tabLayer;
        var layer = layerState.find(function (l) { return l.id === id; });
        if (!layer) return;
        layer.visible = !layer.visible;
        tab.classList.toggle('active', layer.visible);
        tab.querySelector('svg').outerHTML; // replaced below
        tab.querySelector('svg').remove();
        var iconEl = document.createElement('div');
        iconEl.innerHTML = layer.visible ? EYE_ON : EYE_OFF;
        tab.insertBefore(iconEl.firstElementChild, tab.firstElementChild);
        syncCheckboxes('layer-toggle', id, layer.visible);
        refreshDataLayer();
    });
}

function updateLayerTab(id, visible) {
    var tab = document.querySelector('[data-tab-layer="' + id + '"]');
    if (!tab) return;
    tab.classList.toggle('active', visible);
    var svg = tab.querySelector('svg');
    if (svg) {
        var tmp = document.createElement('div');
        tmp.innerHTML = visible ? EYE_ON : EYE_OFF;
        tab.replaceChild(tmp.firstElementChild, svg);
    }
}

function updateHotspotTab(active) {
    var tab = document.querySelector('[data-tab-hotspot]');
    if (tab) tab.classList.toggle('active', active);
}

// ─── COLORMAP PICKER ──────────────────────────

var _cpLayerId = null;

function openColormapPicker(triggerEl, layerId) {
    var layer = layerState.find(function (l) { return l.id === layerId; });
    if (!layer || layer.type === 'solid') return;

    _cpLayerId = layerId;

    var picker = document.getElementById('colormap-picker');
    if (!picker) return;

    // Build swatch rows for every preset
    picker.innerHTML = Object.keys(COLORMAP_PRESETS).map(function (name) {
        var grad = buildGradient(name, layer.reverse);
        var isActive = layer.preset === name;
        return [
            '<div class="cp-row' + (isActive ? ' active' : '') + '" data-preset="' + name + '">',
            '  <div class="cp-swatch-bar" style="background:' + grad + '"></div>',
            '  <span class="cp-name">' + name + '</span>',
            '  <div class="cp-dot"></div>',
            '</div>'
        ].join('');
    }).join('');

    // Position: below the trigger element, clamped to viewport
    var rect = triggerEl.getBoundingClientRect();
    var pickerH = Object.keys(COLORMAP_PRESETS).length * 30 + 12;
    var top = (rect.bottom + 6 + pickerH <= window.innerHeight)
        ? rect.bottom + 6
        : rect.top - pickerH - 6;
    var left = Math.min(rect.left, window.innerWidth - 218);

    picker.style.top  = Math.max(8, top)  + 'px';
    picker.style.left = Math.max(8, left) + 'px';
    picker.removeAttribute('hidden');

    // Close on next outside click
    requestAnimationFrame(function () {
        document.addEventListener('click', _cpOutsideHandler);
    });
}

function _cpOutsideHandler(e) {
    var picker = document.getElementById('colormap-picker');
    if (picker && picker.contains(e.target)) return;
    closeColormapPicker();
}

function closeColormapPicker() {
    var picker = document.getElementById('colormap-picker');
    if (picker) picker.setAttribute('hidden', '');
    document.removeEventListener('click', _cpOutsideHandler);
    _cpLayerId = null;
}

// Picker swatch clicks
document.addEventListener('DOMContentLoaded', function () {
    var picker = document.getElementById('colormap-picker');
    if (!picker) return;
    picker.addEventListener('click', function (e) {
        var row = e.target.closest('.cp-row');
        if (!row || !_cpLayerId) return;

        var presetName = row.dataset.preset;
        var layer = layerState.find(function (l) { return l.id === _cpLayerId; });
        if (!layer) return;

        layer.preset = presetName;

        // Update all gradient bars for this layer in panel + drawer
        var grad = layerGradientStyle(layer);
        document.querySelectorAll('[data-grad="' + layer.id + '"]').forEach(function (el) {
            el.style.cssText = grad;
        });

        // Update the layer tab strip gradient
        var tabGrad = document.querySelector('[data-tab-layer="' + layer.id + '"] .layer-tab-grad');
        if (tabGrad) tabGrad.style.cssText = grad;

        refreshDataLayer();
        closeColormapPicker();
    });
});

// ─── TOP BAR ──────────────────────────────────

function wireTopBar() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme');
        setTheme(current === 'dark' ? 'light' : 'dark');
    });
}

// ─── FABs ─────────────────────────────────────

function wireFabs() {
    var fabLoc = document.getElementById('fab-location');
    if (fabLoc) {
        fabLoc.onclick = function () { triggerMyLocation(fabLoc); };
    }

    var fabSearch = document.getElementById('fab-search');
    if (fabSearch) {
        fabSearch.addEventListener('click', function () {
            toggleSearchPopover();
        });
    }

    var fabSettings = document.getElementById('fab-settings');
    if (fabSettings) {
        fabSettings.addEventListener('click', function () {
            if (window.innerWidth >= 768) {
                var panel = document.getElementById('settings-panel');
                if (panel && panel.classList.contains('visible')) {
                    closePanel();
                } else {
                    openPanel();
                }
            } else {
                openDrawer();
            }
        });
    }
}

// ─── MOBILE DRAWER ────────────────────────────

function openDrawer() {
    var drawer = document.getElementById('mobile-drawer');
    var backdrop = document.getElementById('drawer-backdrop');
    if (!drawer) return;
    drawer.removeAttribute('hidden');
    backdrop.removeAttribute('hidden');
    requestAnimationFrame(function () {
        drawer.classList.add('open');
    });
    backdrop.addEventListener('click', closeDrawer, { once: true });
}

function closeDrawer() {
    var drawer = document.getElementById('mobile-drawer');
    var backdrop = document.getElementById('drawer-backdrop');
    if (!drawer) return;
    drawer.classList.remove('open');
    setTimeout(function () {
        drawer.setAttribute('hidden', '');
        backdrop.setAttribute('hidden', '');
    }, 300);
}

// Close drawer on close button (delegated, re-uses onControlClick → panel-close)
document.addEventListener('click', function (e) {
    if (e.target.closest('[data-ctrl="panel-close"]') && window.innerWidth < 768) {
        closeDrawer();
    }
});

// ─── SEARCH ───────────────────────────────────

function wireSearch() {
    var goBtn = document.getElementById('search-popover-go');
    if (goBtn) {
        goBtn.addEventListener('click', function () {
            var input = document.getElementById('search-popover-input');
            if (input && input.value.trim()) doSearch(input.value.trim());
        });
    }

    var closeBtn = document.getElementById('search-popover-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            hideSearchPopover();
        });
    }
}

function toggleSearchPopover() {
    var pop = document.getElementById('search-popover');
    if (!pop) return;
    if (pop.hidden) {
        pop.removeAttribute('hidden');
        var input = document.getElementById('search-popover-input');
        if (input) input.focus();
    } else {
        hideSearchPopover();
    }
}

function hideSearchPopover() {
    var pop = document.getElementById('search-popover');
    if (pop) pop.setAttribute('hidden', '');
}

async function doSearch(query) {
    if (!query || !mapEngine) return;
    try {
        var url = 'https://nominatim.openstreetmap.org/search?q='
            + encodeURIComponent(query)
            + '&format=json&limit=1&countrycodes=de&email=kontakt@alleinseinkarte.de';
        var res = await fetch(url, { headers: { 'Accept-Language': 'de' } });
        var data = await res.json();
        if (data && data.length > 0) {
            var lon = parseFloat(data[0].lon);
            var lat = parseFloat(data[0].lat);
            mapEngine.flyTo([lon, lat], CONFIG.location_zoom);
            hideSearchPopover();
        }
    } catch (err) {
        console.warn('Search failed:', err);
    }
}

// ─── LOCATION BUTTON ──────────────────────────

function wireLocationButtons() {
    // Only binds the panel/drawer buttons — FAB is handled in wireFabs()
    document.querySelectorAll('[data-ctrl="my-location"]').forEach(function (btn) {
        btn.onclick = function () { triggerMyLocation(btn); };
    });
}

function triggerMyLocation(btn) {
    if (!navigator.geolocation || !mapEngine) return;
    btn.classList.add('active');
    navigator.geolocation.getCurrentPosition(
        function (pos) {
            btn.classList.remove('active');
            mapEngine.flyTo([pos.coords.longitude, pos.coords.latitude], CONFIG.location_zoom);
        },
        function () {
            btn.classList.remove('active');
        }
    );
}

// ─── RESPONSIVE RESIZE ────────────────────────

window.addEventListener('resize', function () {
    var panel = document.getElementById('settings-panel');
    if (!panel) return;
    if (window.innerWidth >= 768) {
        closeDrawer();
        if (!panel.classList.contains('visible')) {
            openPanel();
        }
    } else {
        panel.classList.remove('visible');
        document.body.classList.remove('panel-open');
    }
});
