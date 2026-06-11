window.boundsSet = false;

const DEFAULT_CENTER = [13.3, 51.0];
const DEFAULT_ZOOM = 8;
const VALID_LAYOUTS = ['layout-1', 'layout-2', 'layout-3'];

let activeLayout = localStorage.getItem('map-layout') || 'layout-1';
if (!VALID_LAYOUTS.includes(activeLayout)) activeLayout = 'layout-1';

let activeEngine = localStorage.getItem('map-engine') || 'leaflet';
let mapEngine = null;
let activePopover = null;

const icons = {
    layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/></svg>',
    map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    location: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 .9-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5.9h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1Z"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    flip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11l-3-3"/><path d="m18 7-3 3"/><path d="M17 17H6l3 3"/><path d="m6 17 3-3"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7Z"/></svg>'
};

function domKey(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getLayerByKey(key) {
    return layerState.find(layer => domKey(layer.id) === key);
}

function hexToRgba(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b, 255];
}

function buildGradient(preset, reverse) {
    const presetColors = COLORMAP_PRESETS[preset];
    if (!presetColors) return preset;
    let colors = [...presetColors];
    if (reverse) colors = colors.reverse();
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
            if (layer.reverse) colors = colors.reverse();
            for (let i = 0; i < 9; i++) {
                cmap[layer.start + i] = hexToRgba(colors[i]);
            }
        }
    });
    return JSON.stringify(cmap);
}

function refreshDataLayer() {
    if (mapEngine) {
        mapEngine.updateDataLayer(getCombinedColormapJson(), dataLayerOpacity);
    }
}

function makeIconButton(kind, label, onClick, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `icon-action ${extraClass}`.trim();
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = icons[kind];
    button.addEventListener('click', onClick);
    return button;
}

function renderToggle(layer, context) {
    const key = domKey(layer.id);
    const id = `${context}-vis-${key}`;
    return `
        <label class="toggle" title="Toggle ${layer.id}">
            <input type="checkbox" id="${id}" data-role="layer-toggle" data-layer-key="${key}" ${layer.visible ? 'checked' : ''} />
            <span class="toggle-track"></span>
        </label>
    `;
}

function renderSchemeGrid(layer, context) {
    if (layer.type !== 'category') return '';
    const key = domKey(layer.id);
    const buttons = Object.keys(COLORMAP_PRESETS).map(name => `
        <button
            type="button"
            class="scheme-btn${name === layer.preset ? ' active' : ''}"
            data-role="scheme-option"
            data-layer-key="${key}"
            data-scheme="${name}"
            title="${name}"
            aria-label="${name}"
            style="background: ${buildGradient(name, false)};"
        ></button>
    `).join('');

    return `
        <div class="scheme-dropdown" id="${context}-schemes-${key}" data-role="scheme-dropdown" data-layer-key="${key}">
            <div class="scheme-grid">
                ${buttons}
            </div>
        </div>
    `;
}

function renderPaletteControl(layer, context) {
    const key = domKey(layer.id);

    if (layer.type === 'solid') {
        return `
            <label class="solid-color-btn" title="Change ${layer.id} color" style="background: ${layer.preset};">
                <input type="color" data-role="solid-color" data-layer-key="${key}" value="${layer.preset}" />
            </label>
        `;
    }

    return `
        <div class="palette-control">
            <button
                type="button"
                class="palette-bar"
                data-role="scheme-trigger"
                data-layer-key="${key}"
                title="Change ${layer.id} color scheme"
                aria-label="Change ${layer.id} color scheme"
                style="background: ${buildGradient(layer.preset, layer.reverse)};"
            ></button>
            <button
                type="button"
                class="reverse-btn${layer.reverse ? ' active' : ''}"
                data-role="scheme-reverse"
                data-layer-key="${key}"
                title="Reverse ${layer.id} color scheme"
                aria-label="Reverse ${layer.id} color scheme"
            >${icons.flip}</button>
        </div>
    `;
}

function renderLayerChip(layer, context) {
    const key = domKey(layer.id);
    const chip = document.createElement('article');
    chip.className = `layer-chip${layer.visible ? '' : ' inactive'}`;
    chip.dataset.layerKey = key;
    chip.innerHTML = `
        <div class="layer-chip-row">
            ${renderToggle(layer, context)}
            <span class="layer-name">${layer.id}</span>
            ${renderPaletteControl(layer, context)}
        </div>
        ${renderSchemeGrid(layer, context)}
    `;
    bindLayerControls(chip);
    return chip;
}

function renderLayerSettingsRow(layer, context) {
    const key = domKey(layer.id);
    const row = document.createElement('article');
    row.className = `layer-settings-row${layer.visible ? '' : ' inactive'}`;
    row.dataset.layerKey = key;
    row.innerHTML = `
        <div class="settings-row-main">
            <div class="settings-row-title">
                <span>${layer.id}</span>
            </div>
            ${renderToggle(layer, context)}
        </div>
        ${renderPaletteControl(layer, context)}
        ${renderSchemeGrid(layer, context)}
    `;
    bindLayerControls(row);
    return row;
}

function renderFloatingLayerToggle(layer, context) {
    const key = domKey(layer.id);
    const label = document.createElement('label');
    label.className = `floating-layer-toggle${layer.visible ? '' : ' inactive'}`;
    label.dataset.layerKey = key;
    label.title = `Toggle ${layer.id}`;
    label.innerHTML = `
        <span class="floating-layer-name">${layer.id}</span>
        ${renderToggle(layer, context)}
    `;
    bindLayerControls(label);
    return label;
}

function renderDataOpacityControl(context) {
    const wrapper = document.createElement('div');
    wrapper.className = 'range-control data-opacity-control';
    wrapper.innerHTML = `
        <div class="ctrl-label">
            <span>Data opacity</span>
            <span class="val" data-role="data-opacity-value">${Math.round(dataLayerOpacity * 100)}%</span>
        </div>
        <input type="range" min="0" max="1" step="0.01" value="${dataLayerOpacity}" data-role="data-opacity" id="${context}-data-opacity" />
    `;
    bindDataOpacityControl(wrapper);
    return wrapper;
}

function renderLayerStrip(context, extraClass = '') {
    const section = document.createElement('section');
    section.className = `layer-strip surface ${extraClass}`.trim();
    section.innerHTML = `
        <div class="strip-scroll" data-role="layer-strip"></div>
        <div class="strip-meta"></div>
    `;

    const scroll = section.querySelector('[data-role="layer-strip"]');
    layerState.forEach(layer => scroll.appendChild(renderLayerChip(layer, context)));
    section.querySelector('.strip-meta').appendChild(renderDataOpacityControl(context));
    return section;
}

function renderEngineSwitcher(context) {
    const wrapper = document.createElement('div');
    wrapper.className = 'engine-control';
    wrapper.innerHTML = `
        <span class="control-title">Map engine</span>
        <div class="engine-switcher" role="group" aria-label="Map engine">
            <button type="button" class="engine-btn" data-role="engine-btn" data-engine="leaflet" id="${context}-engine-leaflet">Leaflet</button>
            <button type="button" class="engine-btn" data-role="engine-btn" data-engine="maplibre" id="${context}-engine-maplibre">MapLibre</button>
        </div>
    `;
    bindEngineControls(wrapper);
    syncEngineButtons(wrapper);
    return wrapper;
}

function renderBasemapControls(context, compact = false) {
    const wrapper = document.createElement('div');
    wrapper.className = `basemap-controls${compact ? ' compact' : ''}`;
    wrapper.innerHTML = `
        <div class="basemap-main">
            <span class="control-title">Base map</span>
            <div class="basemap-options" role="group" aria-label="Base map">
                <button type="button" class="basemap-btn" data-role="basemap-btn" data-key="osm" id="${context}-basemap-osm">OSM</button>
                <button type="button" class="basemap-btn" data-role="basemap-btn" data-key="satellite" id="${context}-basemap-satellite">Satellite</button>
                <button type="button" class="basemap-btn" data-role="basemap-btn" data-key="none" id="${context}-basemap-none">Off</button>
            </div>
        </div>
        <div class="range-control basemap-opacity-control">
            <div class="ctrl-label">
                <span>Base opacity</span>
                <span class="val" data-role="basemap-opacity-value">${Math.round(basemapOpacity * 100)}%</span>
            </div>
            <input type="range" min="0" max="1" step="0.01" value="${basemapOpacity}" data-role="basemap-opacity" id="${context}-basemap-opacity" />
        </div>
    `;
    bindBasemapControls(wrapper);
    return wrapper;
}

function renderBottomBasemapBar() {
    const section = document.createElement('section');
    section.className = 'bottom-basemap surface';
    section.appendChild(renderBasemapControls('layout1-basemap', true));
    section.appendChild(renderEngineSwitcher('layout1-engine'));
    return section;
}

function renderBottomLayerDock() {
    const section = document.createElement('section');
    section.className = 'bottom-layer-dock surface';
    const top = document.createElement('div');
    top.className = 'dock-toolbar';
    top.appendChild(renderEngineSwitcher('layout2-engine'));
    top.appendChild(renderDataOpacityControl('layout2'));
    section.appendChild(top);

    const scroll = document.createElement('div');
    scroll.className = 'strip-scroll';
    layerState.forEach(layer => scroll.appendChild(renderLayerChip(layer, 'layout2')));
    section.appendChild(scroll);
    return section;
}

function renderFloatingActions(kinds, extraClass = '') {
    const actions = document.createElement('div');
    actions.className = `floating-actions ${extraClass}`.trim();
    kinds.forEach(kind => {
        if (kind === 'base') {
            actions.appendChild(makeIconButton('map', 'Base map', () => toggleFloatingPanel('base')));
        }
        if (kind === 'search') {
            actions.appendChild(makeIconButton('search', 'Search location', () => toggleFloatingPanel('search')));
        }
        if (kind === 'location') {
            actions.appendChild(makeIconButton('location', 'Current location', () => openLocationPanel()));
        }
        if (kind === 'settings') {
            actions.appendChild(makeIconButton('settings', 'Settings', openSettingsDrawer));
        }
    });
    return actions;
}

function renderFloatingLayerList() {
    const wrapper = document.createElement('div');
    wrapper.className = 'floating-layer-list';
    layerState.forEach(layer => wrapper.appendChild(renderFloatingLayerToggle(layer, 'layout3-float')));
    return wrapper;
}

function buildLayout() {
    const root = document.getElementById('app-ui');
    root.innerHTML = '';
    closeFloatingPanel();
    closeSettingsDrawer();
    document.body.dataset.layout = activeLayout;

    if (activeLayout === 'layout-1') {
        root.appendChild(renderLayerStrip('layout1', 'layout1-top'));
        root.appendChild(renderFloatingActions(['search', 'location'], 'layout1-actions'));
        root.appendChild(renderBottomBasemapBar());
    }

    if (activeLayout === 'layout-2') {
        root.appendChild(renderBottomLayerDock());
        root.appendChild(renderFloatingActions(['base', 'search', 'location'], 'layout2-actions'));
    }

    if (activeLayout === 'layout-3') {
        root.appendChild(renderFloatingLayerList());
        root.appendChild(renderFloatingActions(['settings', 'search', 'location'], 'layout3-actions'));
    }

    syncAllLayerUi();
    syncEngineButtons(document);
    syncBasemapButtons(document);
}

function bindLayerControls(scope) {
    scope.querySelectorAll('[data-role="layer-toggle"]').forEach(input => {
        input.addEventListener('change', event => {
            const layer = getLayerByKey(event.currentTarget.dataset.layerKey);
            if (!layer) return;
            layer.visible = event.currentTarget.checked;
            syncLayerVisibility(layer);
            refreshDataLayer();
        });
    });

    scope.querySelectorAll('[data-role="scheme-trigger"]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            toggleSchemeDropdown(event.currentTarget.dataset.layerKey, scope);
        });
    });

    scope.querySelectorAll('[data-role="scheme-option"]').forEach(button => {
        button.addEventListener('click', event => {
            const layer = getLayerByKey(event.currentTarget.dataset.layerKey);
            if (!layer) return;
            layer.preset = event.currentTarget.dataset.scheme;
            closeSchemeDropdowns();
            syncLayerPalette(layer);
            refreshDataLayer();
        });
    });

    scope.querySelectorAll('[data-role="scheme-reverse"]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            const layer = getLayerByKey(event.currentTarget.dataset.layerKey);
            if (!layer) return;
            layer.reverse = !layer.reverse;
            syncLayerPalette(layer);
            refreshDataLayer();
        });
    });

    scope.querySelectorAll('[data-role="solid-color"]').forEach(input => {
        input.addEventListener('input', event => {
            const layer = getLayerByKey(event.currentTarget.dataset.layerKey);
            if (!layer) return;
            layer.preset = event.currentTarget.value;
            syncLayerPalette(layer);
            refreshDataLayer();
        });
    });
}

function bindDataOpacityControl(scope) {
    scope.querySelectorAll('[data-role="data-opacity"]').forEach(input => {
        input.addEventListener('input', event => {
            dataLayerOpacity = parseFloat(event.currentTarget.value);
            syncDataOpacityControls(document);
            if (mapEngine) mapEngine.updateDataLayerOpacity(dataLayerOpacity);
        });
    });
}

function bindBasemapControls(scope) {
    scope.querySelectorAll('[data-role="basemap-btn"]').forEach(button => {
        button.addEventListener('click', event => {
            activeBasemapKey = event.currentTarget.dataset.key;
            syncBasemapButtons(document);
            if (mapEngine) mapEngine.switchBasemap(activeBasemapKey);
        });
    });

    scope.querySelectorAll('[data-role="basemap-opacity"]').forEach(input => {
        input.addEventListener('input', event => {
            basemapOpacity = parseFloat(event.currentTarget.value);
            syncBasemapOpacityControls(document);
            if (mapEngine) mapEngine.updateBasemapOpacity(basemapOpacity);
        });
    });

    syncBasemapButtons(scope);
    syncBasemapOpacityControls(scope);
}

function bindEngineControls(scope) {
    scope.querySelectorAll('[data-role="engine-btn"]').forEach(button => {
        button.addEventListener('click', event => {
            switchEngine(event.currentTarget.dataset.engine);
        });
    });
}

function toggleSchemeDropdown(layerKey, scope) {
    const dropdown = scope.querySelector(`[data-role="scheme-dropdown"][data-layer-key="${layerKey}"]`);
    if (!dropdown) return;
    const wasOpen = dropdown.classList.contains('open');
    closeSchemeDropdowns();
    dropdown.classList.toggle('open', !wasOpen);
}

function closeSchemeDropdowns() {
    document.querySelectorAll('[data-role="scheme-dropdown"].open').forEach(dropdown => {
        dropdown.classList.remove('open');
    });
}

function syncLayerVisibility(layer) {
    const key = domKey(layer.id);
    document.querySelectorAll(`[data-layer-key="${key}"]`).forEach(element => {
        if (element.classList.contains('layer-chip') || element.classList.contains('layer-settings-row') || element.classList.contains('floating-layer-toggle')) {
            element.classList.toggle('inactive', !layer.visible);
        }
    });
    document.querySelectorAll(`[data-role="layer-toggle"][data-layer-key="${key}"]`).forEach(input => {
        input.checked = layer.visible;
    });
}

function syncLayerPalette(layer) {
    const key = domKey(layer.id);
    if (layer.type === 'solid') {
        document.querySelectorAll(`[data-role="solid-color"][data-layer-key="${key}"]`).forEach(input => {
            input.value = layer.preset;
            input.parentElement.style.background = layer.preset;
        });
        return;
    }

    document.querySelectorAll(`[data-role="scheme-trigger"][data-layer-key="${key}"]`).forEach(button => {
        button.style.background = buildGradient(layer.preset, layer.reverse);
    });
    document.querySelectorAll(`[data-role="scheme-reverse"][data-layer-key="${key}"]`).forEach(button => {
        button.classList.toggle('active', layer.reverse);
    });
    document.querySelectorAll(`[data-role="scheme-option"][data-layer-key="${key}"]`).forEach(button => {
        button.classList.toggle('active', button.dataset.scheme === layer.preset);
    });
}

function syncAllLayerUi() {
    layerState.forEach(layer => {
        syncLayerVisibility(layer);
        syncLayerPalette(layer);
    });
    syncDataOpacityControls(document);
}

function syncDataOpacityControls(scope) {
    scope.querySelectorAll('[data-role="data-opacity"]').forEach(input => {
        input.value = dataLayerOpacity;
    });
    scope.querySelectorAll('[data-role="data-opacity-value"]').forEach(value => {
        value.textContent = `${Math.round(dataLayerOpacity * 100)}%`;
    });
}

function syncBasemapButtons(scope) {
    scope.querySelectorAll('[data-role="basemap-btn"]').forEach(button => {
        button.classList.toggle('active', button.dataset.key === activeBasemapKey);
    });
}

function syncBasemapOpacityControls(scope) {
    scope.querySelectorAll('[data-role="basemap-opacity"]').forEach(input => {
        input.value = basemapOpacity;
    });
    scope.querySelectorAll('[data-role="basemap-opacity-value"]').forEach(value => {
        value.textContent = `${Math.round(basemapOpacity * 100)}%`;
    });
}

function syncEngineButtons(scope) {
    scope.querySelectorAll('[data-role="engine-btn"]').forEach(button => {
        button.classList.toggle('active', button.dataset.engine === activeEngine);
    });
}

function toggleFloatingPanel(kind) {
    if (activePopover === kind) {
        closeFloatingPanel();
        return;
    }
    openFloatingPanel(kind);
}

function openFloatingPanel(kind) {
    closeFloatingPanel();
    activePopover = kind;

    const root = document.getElementById('app-ui');
    const panel = document.createElement('section');
    panel.id = 'floating-popover';
    panel.className = `floating-popover ${kind}-popover surface`;

    if (kind === 'search') {
        panel.appendChild(renderSearchPanel('floating-search'));
    }

    if (kind === 'base') {
        panel.appendChild(renderBasemapControls('floating-base'));
    }

    if (kind === 'location') {
        const status = document.createElement('div');
        status.className = 'location-status';
        status.textContent = 'Locating...';
        panel.appendChild(status);
        requestCurrentLocation(status);
    }

    root.appendChild(panel);
}

function closeFloatingPanel() {
    const panel = document.getElementById('floating-popover');
    if (panel) panel.remove();
    activePopover = null;
}

function openLocationPanel() {
    openFloatingPanel('location');
}

function renderSearchPanel(context) {
    const wrapper = document.createElement('div');
    wrapper.className = 'search-panel';
    wrapper.innerHTML = `
        <form class="search-form" id="${context}-form">
            <input type="search" name="q" placeholder="Search location" autocomplete="off" />
            <button type="submit" class="icon-action inline" title="Search" aria-label="Search">${icons.send}</button>
        </form>
        <div class="search-status" data-role="search-status"></div>
    `;

    wrapper.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const input = event.currentTarget.elements.q;
        const status = wrapper.querySelector('[data-role="search-status"]');
        await searchLocation(input.value.trim(), status);
    });

    setTimeout(() => wrapper.querySelector('input').focus(), 0);
    return wrapper;
}

async function searchLocation(query, status) {
    if (!query) {
        status.textContent = 'Enter a location.';
        return;
    }

    status.textContent = 'Searching...';
    try {
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('limit', '1');
        url.searchParams.set('q', query);

        const response = await fetch(url.toString(), {
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error(`Search failed with ${response.status}`);

        const results = await response.json();
        if (!results.length) {
            status.textContent = 'No result.';
            return;
        }

        const result = results[0];
        const lng = parseFloat(result.lon);
        const lat = parseFloat(result.lat);
        const label = result.display_name || query;

        if (mapEngine && typeof mapEngine.focusPoint === 'function') {
            mapEngine.focusPoint(lng, lat, 13, label);
        }

        status.textContent = label.split(',').slice(0, 2).join(',');
    } catch (error) {
        console.error('Location search error:', error);
        status.textContent = 'Search unavailable.';
    }
}

function requestCurrentLocation(status) {
    if (!navigator.geolocation) {
        status.textContent = 'Location unavailable.';
        return;
    }

    navigator.geolocation.getCurrentPosition(
        position => {
            const { latitude, longitude, accuracy } = position.coords;
            if (mapEngine && typeof mapEngine.focusPoint === 'function') {
                mapEngine.focusPoint(longitude, latitude, 14, 'Current location');
            }
            status.textContent = `Accuracy ${Math.round(accuracy)} m`;
        },
        error => {
            console.error('Geolocation error:', error);
            status.textContent = 'Location blocked.';
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
        }
    );
}

function openSettingsDrawer() {
    closeFloatingPanel();

    const drawer = document.getElementById('settings-drawer');
    const scrim = document.getElementById('drawer-scrim');
    drawer.innerHTML = '';
    drawer.hidden = false;
    scrim.hidden = false;

    const header = document.createElement('div');
    header.className = 'drawer-header';
    header.innerHTML = `
        <h2>Settings</h2>
        <button type="button" class="icon-action inline" title="Close settings" aria-label="Close settings">${icons.close}</button>
    `;
    header.querySelector('button').addEventListener('click', closeSettingsDrawer);
    drawer.appendChild(header);

    const body = document.createElement('div');
    body.className = 'drawer-body';

    const dataSection = document.createElement('section');
    dataSection.className = 'drawer-section';
    dataSection.innerHTML = '<h3>Data layers</h3>';
    layerState.forEach(layer => dataSection.appendChild(renderLayerSettingsRow(layer, 'layout3-settings')));
    dataSection.appendChild(renderDataOpacityControl('layout3-settings'));
    body.appendChild(dataSection);

    const engineSection = document.createElement('section');
    engineSection.className = 'drawer-section';
    engineSection.appendChild(renderEngineSwitcher('layout3-settings'));
    body.appendChild(engineSection);

    const basemapSection = document.createElement('section');
    basemapSection.className = 'drawer-section';
    basemapSection.appendChild(renderBasemapControls('layout3-settings'));
    body.appendChild(basemapSection);

    drawer.appendChild(body);
    requestAnimationFrame(() => drawer.classList.add('open'));
    scrim.addEventListener('click', closeSettingsDrawer, { once: true });
}

function closeSettingsDrawer() {
    const drawer = document.getElementById('settings-drawer');
    const scrim = document.getElementById('drawer-scrim');
    if (!drawer || !scrim) return;
    drawer.classList.remove('open');
    drawer.hidden = true;
    scrim.hidden = true;
}

function initThemeSwitcher() {
    const themeSwitcher = document.getElementById('theme-switcher');
    const savedTheme = localStorage.getItem('map-theme') || 'glass';
    themeSwitcher.value = savedTheme;
    document.getElementById('theme-link').href = `themes/theme_${savedTheme}.css?v1`;

    themeSwitcher.addEventListener('change', event => {
        const theme = event.currentTarget.value;
        document.getElementById('theme-link').href = `themes/theme_${theme}.css?v1`;
        localStorage.setItem('map-theme', theme);
    });
}

function initLayoutSwitcher() {
    const switcher = document.getElementById('layout-switcher');
    switcher.value = activeLayout;
    switcher.addEventListener('change', event => {
        activeLayout = event.currentTarget.value;
        localStorage.setItem('map-layout', activeLayout);
        buildLayout();
        if (mapEngine && typeof mapEngine.setControlLayout === 'function') {
            mapEngine.setControlLayout(activeLayout);
        }
    });
}

function switchEngine(newEngineKey, force = false) {
    if (newEngineKey === activeEngine && mapEngine && !force) return;

    let center = DEFAULT_CENTER;
    let zoom = DEFAULT_ZOOM;

    if (mapEngine) {
        center = mapEngine.getCenter();
        zoom = mapEngine.getZoom();
        mapEngine.destroy();
    }

    const oldMapEl = document.getElementById('map');
    const newMapEl = oldMapEl.cloneNode(false);
    oldMapEl.parentNode.replaceChild(newMapEl, oldMapEl);

    activeEngine = newEngineKey;
    localStorage.setItem('map-engine', activeEngine);

    mapEngine = activeEngine === 'leaflet' ? new LeafletEngine() : new MapLibreEngine();
    mapEngine.init('map', center, zoom, activeLayout).then(() => {
        mapEngine.switchBasemap(activeBasemapKey);
        mapEngine.updateBasemapOpacity(basemapOpacity);
        refreshDataLayer();
        if (typeof mapEngine.setControlLayout === 'function') {
            mapEngine.setControlLayout(activeLayout);
        }
    });

    syncEngineButtons(document);
}

function initEngineFromStorage() {
    syncEngineButtons(document);
    switchEngine(activeEngine, true);
}

document.addEventListener('DOMContentLoaded', () => {
    initThemeSwitcher();
    initLayoutSwitcher();
    buildLayout();
    initEngineFromStorage();
});
