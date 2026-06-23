// ─────────────────────────────────────────────
//  APP.JS — UI orchestration
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  loadTheme();
  buildAllPanels();
  buildLayerStrip();
  wireTopBar();
  wireFabs();
  wireMeasure();
  wireSearch();
  initMapEngine();
});

// ─── THEME ────────────────────────────────────

function loadTheme() {
  setTheme(localStorage.getItem("theme") || "light", false);
}

function setTheme(t, save) {
  document.documentElement.setAttribute("data-theme", t);
  if (save !== false) localStorage.setItem("theme", t);
  document.querySelectorAll('[data-ctrl="theme"]').forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.theme === t);
  });
}

// ─── MAP INIT ─────────────────────────────────

function initMapEngine() {
  mapEngine = new MapLibreEngine();
  mapEngine.init("map", DEFAULT_CENTER, DEFAULT_ZOOM).then(function () {
    afterEngineInit(true);
    wireLocationButtons();
  });
}

// ─── PANEL BUILDER ────────────────────────────

function layerGradientStyle(layer) {
  if (layer.type === "solid") {
    return "background:" + layer.preset.slice(0, 7) + ";";
  }
  return "background:" + buildGradient(layer.preset, layer.reverse) + ";";
}

// Row of colour-ramp preset buttons for a layer's scheme picker (panel + sheet).
function schemeButtonsHTML(layer) {
  return Object.keys(COLORMAP_PRESETS)
    .map(function (name) {
      var active = layer.preset === name ? " active" : "";
      return (
        '<button class="scheme-btn' +
        active +
        '" data-ctrl="scheme-pick" data-layer="' +
        layer.id +
        '" data-preset="' +
        name +
        '" title="' +
        name +
        '" style="background:' +
        buildGradient(name, false, { forceFull: true }) +
        '"></button>'
      );
    })
    .join("");
}

// Repaints every live gradient bar, layer tab and scheme-button highlight for a layer.
function applyLayerColor(layer) {
  var grad = layerGradientStyle(layer);
  document
    .querySelectorAll('[data-grad="' + layer.id + '"]')
    .forEach(function (el) {
      el.style.cssText = grad;
    });
  var tabGrad = document.querySelector(
    '[data-tab-layer="' + layer.id + '"] .layer-tab-grad',
  );
  if (tabGrad) tabGrad.style.cssText = grad;
  document
    .querySelectorAll('.scheme-btn[data-layer="' + layer.id + '"]')
    .forEach(function (b) {
      b.classList.toggle("active", b.dataset.preset === layer.preset);
    });
}

// Repaints the live gradient swatches (layer bars, tabs and the colour-sheet
// bar). Needed when hotspot mode toggles, since buildGradient collapses these to
// a solid swatch in hotspot mode but the backgrounds are baked in at render time.
// The scheme-picker buttons are intentionally left alone — they always show the
// full ramp (forceFull) regardless of hotspot mode.
function repaintAllGradients() {
  layerState.forEach(function (layer) {
    applyLayerColor(layer);
  });
}

// Data-layer opacity slider row (shared by full panel + mini panel + color sheet).
function dataOpacityRowHTML(label) {
  var v = Math.round(dataLayerOpacity * 100);
  return [
    '<div class="opacity-row">',
    '  <div class="opacity-head">',
    '    <span class="opacity-label">' + (label || "Opacity") + "</span>",
    '    <span class="opacity-val" data-disp="data-opacity">' + v + "%</span>",
    "  </div>",
    '  <input type="range" data-ctrl="data-opacity" min="0" max="100" value="' +
      v +
      '">',
    "</div>",
  ].join("\n");
}

// BACKEND block: map engine, basemap (+ opacity), overlays (shared by full + mini panel).
function backendSectionHTML() {
  var basemapOpacityVal = Math.round(basemapOpacity * 100);
  var basemapEnabled = activeBasemapKey !== "none";
  return [
    '<div class="section-label">BACKEND</div>',

    '<div class="sub-card">',
    '  <div class="sub-label-row">',
    '    <div class="sub-label">BASEMAP</div>',
    '    <label class="toggle">',
    '      <input type="checkbox" data-ctrl="basemap-toggle" ' +
      (basemapEnabled ? "checked" : "") +
      ">",
    '      <span class="toggle-track"></span>',
    "    </label>",
    "  </div>",
    '  <div class="btn-group">',
    '    <button class="seg-btn' +
      (activeBasemapKey === "osm" ? " active" : "") +
      '" data-ctrl="basemap" data-basemap="osm">OSM</button>',
    '    <button class="seg-btn' +
      (activeBasemapKey === "satellite" ? " active" : "") +
      '" data-ctrl="basemap" data-basemap="satellite">Satellite</button>',
    '    <button class="seg-btn' +
      (activeBasemapKey === "schummerung" ? " active" : "") +
      '" data-ctrl="basemap" data-basemap="schummerung">Relief</button>',
    "  </div>",
    '  <div class="opacity-row">',
    '    <div class="opacity-head">',
    '      <span class="opacity-label">Opacity</span>',
    '      <span class="opacity-val" data-disp="basemap-opacity">' +
      basemapOpacityVal +
      "%</span>",
    "    </div>",
    '    <input type="range" data-ctrl="basemap-opacity" min="0" max="100" value="' +
      basemapOpacityVal +
      '">',
    "  </div>",
    "</div>",

    '<div class="sub-card">',
    '  <div class="sub-label">OVERLAYS</div>',
    '  <div class="btn-group">',
    '    <button class="seg-btn' +
      (activeOverlays.hiking ? " toggled" : "") +
      '" data-ctrl="overlay" data-overlay="hiking">Hiking</button>',
    '    <button class="seg-btn' +
      (activeOverlays.cycling ? " toggled" : "") +
      '" data-ctrl="overlay" data-overlay="cycling">Cycling</button>',
    "  </div>",
    "</div>",
  ].join("\n");
}

// Compact quick-settings shown from the settings FAB: data-layer opacity + BACKEND only.
function buildMiniPanelHTML() {
  return [
    '<div class="panel-header">',
    '  <span class="mini-title">Quick Settings</span>',
    '  <button class="icon-btn" data-ctrl="mini-close" title="Close">',
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    "  </button>",
    "</div>",
    '<div class="section-label">DATA LAYER</div>',
    dataOpacityRowHTML("Opacity"),
    '<div class="divider"></div>',
    backendSectionHTML(),
  ].join("\n");
}

function buildPanelHTML() {
  var layersHTML = layerState
    .map(function (layer) {
      var grad = layerGradientStyle(layer);
      var checked = layer.visible ? "checked" : "";
      var isWater = layer.type === "solid";
      var rowHTML = [
        '<div class="layer-row" data-layer="' + layer.id + '">',
        '  <label class="toggle">',
        '    <input type="checkbox" data-ctrl="layer-toggle" data-layer="' +
          layer.id +
          '" ' +
          checked +
          ">",
        '    <span class="toggle-track"></span>',
        "  </label>",
        '  <span class="layer-name">' + layer.id + "</span>",
        isWater
          ? '  <div class="gradient-bar" data-grad="' +
            layer.id +
            '" style="' +
            grad +
            '"></div>'
          : '  <div class="gradient-bar" data-grad="' +
            layer.id +
            '" data-ctrl="colormap-pick" data-layer="' +
            layer.id +
            '" style="' +
            grad +
            '" role="button" tabindex="0" title="Farbschema wählen"></div>',
        '  <button class="reverse-btn' +
          (isWater ? " hidden" : "") +
          '" data-ctrl="layer-reverse" data-layer="' +
          layer.id +
          '" title="Umkehren">⇄</button>',
        "</div>",
      ].join("");
      var dropdownHTML = isWater
        ? ""
        : [
            '<div class="scheme-dropdown" data-dropdown="' + layer.id + '">',
            '  <div class="scheme-grid">' + schemeButtonsHTML(layer) + "</div>",
            "</div>",
          ].join("");
      return (
        '<div class="layer-block" data-block="' +
        layer.id +
        '">' +
        rowHTML +
        dropdownHTML +
        "</div>"
      );
    })
    .join("");

  var currentTheme =
    document.documentElement.getAttribute("data-theme") || "light";
  var hotspotChecked = hotspotMode ? "checked" : "";

  return [
    "<!-- Panel header -->",
    '<div class="panel-header">',
    '  <div class="theme-switch">',
    '    <span class="theme-switch-label">THEME</span>',
    '    <div class="btn-group">',
    '      <button class="seg-btn' +
      (currentTheme === "light" ? " active" : "") +
      '" data-ctrl="theme" data-theme="light">Light</button>',
    '      <button class="seg-btn' +
      (currentTheme === "dark" ? " active" : "") +
      '" data-ctrl="theme" data-theme="dark">Dark</button>',
    "    </div>",
    "  </div>",
    '  <button class="icon-btn" data-ctrl="panel-close" title="Close">',
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    "  </button>",
    "</div>",

    "<!-- Intro -->",
    '<p class="panel-intro">',
    '  <a href="https://alleinseinkarte.de" target="_blank" rel="noopener noreferrer">alleinseinkarte.de</a>',
    "  is a map for finding places where you can be alone. It shows you areas which have the lowest chance of having other people around.",
    "</p>",

    "<!-- Hotspot mode -->",
    '<div class="section-label">HOTSPOT MODE</div>',
    '<div class="sub-card">',
    '  <div class="hotspot-row">',
    '    <label class="toggle">',
    '      <input type="checkbox" data-ctrl="hotspot" ' + hotspotChecked + ">",
    '      <span class="toggle-track"></span>',
    "    </label>",
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    '    <span class="row-name">Hotspots</span>',
    '    <span class="row-hint">Top values only</span>',
    "  </div>",
    "</div>",

    '<div class="divider"></div>',

    "<!-- Data layers -->",
    '<div class="section-label">DATA LAYERS</div>',
    '<div class="sub-card">',
    layersHTML,
    dataOpacityRowHTML("Opacity"),
    "</div>",

    '<div class="divider"></div>',

    "<!-- Backend -->",
    backendSectionHTML(),

    '<div class="divider"></div>',

    "<!-- Location -->",
    '<div class="section-label">LOCATION</div>',
    '<div class="sub-card">',
    '<div class="search-row">',
    '  <input type="text" data-ctrl="location-input" placeholder="Search location…" autocomplete="off">',
    '  <button class="btn-go" data-ctrl="location-go">Go</button>',
    "</div>",
    '<button class="btn-full" data-ctrl="my-location">',
    '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>',
    "  My Location",
    "</button>",
    '<button class="btn-full' +
      (measureActive ? " active" : "") +
      '" data-ctrl="measure">',
    '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="8" rx="1"/><path d="M6 8v3M10 8v4M14 8v3M18 8v4"/></svg>',
    "  Measure Distance",
    "</button>",
    "</div>",
  ].join("\n");
}

function buildAllPanels() {
  var html = buildPanelHTML();

  var panel = document.getElementById("settings-panel");
  if (panel) {
    panel.innerHTML = html;
    // Show panel on desktop
    if (window.innerWidth >= 768) {
      panel.classList.add("visible");
      document.body.classList.add("panel-open");
    }
  }

  wireAllPanelEvents();
}

// ─── PANEL EVENTS (delegated) ──────────────────

function wireAllPanelEvents() {
  // Use document-level delegation so the settings panel works on any layout
  document.addEventListener("change", onControlChange);
  document.addEventListener("input", onControlInput);
  document.addEventListener("click", onControlClick);
}

function onControlChange(e) {
  var ctrl = e.target.dataset.ctrl;
  if (!ctrl) return;

  if (ctrl === "layer-toggle") {
    var id = e.target.dataset.layer;
    var layer = layerState.find(function (l) {
      return l.id === id;
    });
    if (!layer) return;
    layer.visible = e.target.checked;
    syncCheckboxes("layer-toggle", id, e.target.checked);
    refreshDataLayer();
    updateLayerTab(id, e.target.checked);
  }

  if (ctrl === "hotspot") {
    hotspotMode = e.target.checked;
    syncCheckboxes("hotspot", null, e.target.checked);
    refreshDataLayer();
    updateHotspotTab(hotspotMode);
    repaintAllGradients();
  }

  if (ctrl === "basemap-toggle") {
    var enabled = e.target.checked;
    syncCheckboxes("basemap-toggle", null, enabled);
    if (!enabled) {
      activeBasemapKey = "none";
      if (mapEngine) mapEngine.switchBasemap("none");
    } else {
      activeBasemapKey = "osm";
      syncActiveBtn("basemap", "osm");
      if (mapEngine) mapEngine.switchBasemap("osm");
    }
  }
}

function onControlInput(e) {
  var ctrl = e.target.dataset.ctrl;
  if (!ctrl) return;

  if (ctrl === "data-opacity") {
    dataLayerOpacity = e.target.value / 100;
    document
      .querySelectorAll('[data-disp="data-opacity"]')
      .forEach(function (el) {
        el.textContent = e.target.value + "%";
      });
    document
      .querySelectorAll('[data-ctrl="data-opacity"]')
      .forEach(function (el) {
        if (el !== e.target) el.value = e.target.value;
      });
    if (mapEngine) mapEngine.updateDataLayerOpacity(dataLayerOpacity);
  }

  if (ctrl === "basemap-opacity") {
    basemapOpacity = e.target.value / 100;
    document
      .querySelectorAll('[data-disp="basemap-opacity"]')
      .forEach(function (el) {
        el.textContent = e.target.value + "%";
      });
    document
      .querySelectorAll('[data-ctrl="basemap-opacity"]')
      .forEach(function (el) {
        if (el !== e.target) el.value = e.target.value;
      });
    if (mapEngine) mapEngine.updateBasemapOpacity(basemapOpacity);
  }
}

function onControlClick(e) {
  var btn = e.target.closest("[data-ctrl]");
  if (!btn) return;
  var ctrl = btn.dataset.ctrl;

  if (ctrl === "theme") {
    setTheme(btn.dataset.theme);
  }

  if (ctrl === "panel-close") {
    closePanel();
  }

  if (ctrl === "mini-close") {
    hideMiniPanel();
  }

  if (ctrl === "measure") {
    toggleMeasure();
  }

  if (ctrl === "colormap-pick") {
    toggleSchemeDropdown(btn.dataset.layer, btn);
    return;
  }

  if (ctrl === "scheme-pick") {
    var sid = btn.dataset.layer;
    var slayer = layerState.find(function (l) {
      return l.id === sid;
    });
    if (!slayer) return;
    slayer.preset = btn.dataset.preset;
    applyLayerColor(slayer);
    refreshDataLayer();
    return;
  }

  if (ctrl === "layer-reverse") {
    var id = btn.dataset.layer;
    var layer = layerState.find(function (l) {
      return l.id === id;
    });
    if (!layer) return;
    layer.reverse = !layer.reverse;
    applyLayerColor(layer);
    refreshDataLayer();
  }

  if (ctrl === "basemap") {
    var bm = btn.dataset.basemap;
    activeBasemapKey = bm;
    syncActiveBtn("basemap", bm);
    // ensure basemap toggle is checked
    document
      .querySelectorAll('[data-ctrl="basemap-toggle"]')
      .forEach(function (el) {
        el.checked = true;
      });
    if (mapEngine) mapEngine.switchBasemap(bm);
  }

  if (ctrl === "overlay") {
    var ov = btn.dataset.overlay;
    activeOverlays[ov] = !activeOverlays[ov];
    btn.classList.toggle("toggled", activeOverlays[ov]);
    // sync sibling button in other panel
    document
      .querySelectorAll('[data-ctrl="overlay"][data-overlay="' + ov + '"]')
      .forEach(function (el) {
        el.classList.toggle("toggled", activeOverlays[ov]);
      });
    if (mapEngine) mapEngine.toggleOverlay(ov, activeOverlays[ov]);
  }

  if (ctrl === "location-go") {
    var input = btn.parentElement.querySelector('[data-ctrl="location-input"]');
    if (input && input.value.trim()) {
      doSearch(input.value.trim());
    }
  }
}

// Enter key on location inputs
document.addEventListener("keydown", function (e) {
  if (e.key !== "Enter") return;
  var ctrl = e.target.dataset.ctrl;
  if (ctrl === "location-input") {
    if (e.target.value.trim()) doSearch(e.target.value.trim());
  }
  if (e.target.id === "search-popover-input") {
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
  var attr = "data-" + ctrl;
  document
    .querySelectorAll('[data-ctrl="' + ctrl + '"]')
    .forEach(function (el) {
      el.classList.toggle("active", el.getAttribute(attr) === value);
    });
}

// ─── PANEL OPEN / CLOSE ───────────────────────

function openPanel() {
  var panel = document.getElementById("settings-panel");
  if (!panel) return;
  panel.classList.remove("sliding-out");
  panel.classList.add("visible");
  document.body.classList.add("panel-open");
}

function closePanel() {
  var panel = document.getElementById("settings-panel");
  if (!panel) return;
  panel.classList.add("sliding-out");
  document.body.classList.remove("panel-open");
  setTimeout(function () {
    panel.classList.remove("visible");
  }, 200);
}

// ─── LAYER STRIP (MOBILE) ─────────────────────

var STRIP_LAYERS = ["Nature", "Farm", "Parks", "Urban"];

var EYE_ON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
var EYE_OFF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
var FIRE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>';

function buildLayerStrip() {
  var strip = document.getElementById("layer-strip");
  if (!strip) return;

  var html = STRIP_LAYERS.map(function (id) {
    var layer = layerState.find(function (l) {
      return l.id === id;
    });
    if (!layer) return "";
    var grad = layerGradientStyle(layer);
    var active = layer.visible ? " active" : "";
    var icon = layer.visible ? EYE_ON : EYE_OFF;
    return [
      '<button class="layer-tab' +
        active +
        '" data-tab-layer="' +
        id +
        '" aria-label="' +
        id +
        ' Layer">',
      "  " + icon,
      '  <span class="layer-tab-name">' + id + "</span>",
      '  <div class="layer-tab-grad" style="' + grad + '"></div>',
      "</button>",
    ].join("");
  }).join("");

  // Hotspot tab
  var hotspotActive = hotspotMode ? " active" : "";
  html += [
    '<button class="layer-tab' +
      hotspotActive +
      '" data-tab-hotspot aria-label="Hotspot">',
    "  " + FIRE_ICON,
    '  <span class="layer-tab-name">Hotspots</span>',
    "</button>",
  ].join("");

  strip.innerHTML = html;

  strip.addEventListener("click", function (e) {
    var tab = e.target.closest(".layer-tab");
    if (!tab) return;

    if (tab.hasAttribute("data-tab-hotspot")) {
      hotspotMode = !hotspotMode;
      tab.classList.toggle("active", hotspotMode);
      document.querySelectorAll('[data-ctrl="hotspot"]').forEach(function (el) {
        el.checked = hotspotMode;
      });
      refreshDataLayer();
      repaintAllGradients();
      return;
    }

    var id = tab.dataset.tabLayer;

    // Tap on the colour ramp opens the colour-ramp sheet instead of toggling
    if (e.target.closest(".layer-tab-grad")) {
      openColorSheet(id);
      return;
    }

    var layer = layerState.find(function (l) {
      return l.id === id;
    });
    if (!layer) return;
    layer.visible = !layer.visible;
    tab.classList.toggle("active", layer.visible);
    tab.querySelector("svg").outerHTML; // replaced below
    tab.querySelector("svg").remove();
    var iconEl = document.createElement("div");
    iconEl.innerHTML = layer.visible ? EYE_ON : EYE_OFF;
    tab.insertBefore(iconEl.firstElementChild, tab.firstElementChild);
    syncCheckboxes("layer-toggle", id, layer.visible);
    refreshDataLayer();
  });
}

function updateLayerTab(id, visible) {
  var tab = document.querySelector('[data-tab-layer="' + id + '"]');
  if (!tab) return;
  tab.classList.toggle("active", visible);
  var svg = tab.querySelector("svg");
  if (svg) {
    var tmp = document.createElement("div");
    tmp.innerHTML = visible ? EYE_ON : EYE_OFF;
    tab.replaceChild(tmp.firstElementChild, svg);
  }
}

function updateHotspotTab(active) {
  var tab = document.querySelector("[data-tab-hotspot]");
  if (tab) tab.classList.toggle("active", active);
}

// ─── COLORMAP PICKER (side panel — inline dropdown) ──

// Toggles the inline scheme dropdown below a layer row. Only one is open at a time.
function toggleSchemeDropdown(layerId, gradEl) {
  var block = gradEl.closest(".layer-block");
  if (!block) return;
  var dd = block.querySelector(
    '.scheme-dropdown[data-dropdown="' + layerId + '"]',
  );
  if (!dd) return;
  var willOpen = !dd.classList.contains("open");
  document.querySelectorAll(".scheme-dropdown.open").forEach(function (d) {
    d.classList.remove("open");
  });
  if (willOpen) dd.classList.add("open");
}

// ─── COLOR-RAMP SHEET (mobile bottom bar) ─────

var _csLayerId = null;

function openColorSheet(layerId) {
  var layer = layerState.find(function (l) {
    return l.id === layerId;
  });
  if (!layer || layer.type === "solid") return;
  _csLayerId = layerId;

  var header = document.getElementById("color-sheet-header");
  var body = document.getElementById("color-sheet-body");
  if (!header || !body) return;

  var dataOpacityVal = Math.round(dataLayerOpacity * 100);

  header.innerHTML = [
    '<label class="toggle">',
    '  <input type="checkbox" data-ctrl="layer-toggle" data-layer="' +
      layer.id +
      '" ' +
      (layer.visible ? "checked" : "") +
      ">",
    '  <span class="toggle-track"></span>',
    "</label>",
    '<span class="layer-name">' + layer.id + "</span>",
    '<div class="color-sheet-gradient-bar" data-grad="' +
      layer.id +
      '" style="' +
      layerGradientStyle(layer) +
      '"></div>',
    '<button class="reverse-btn" data-ctrl="layer-reverse" data-layer="' +
      layer.id +
      '" title="Umkehren">⇄</button>',
    '<button class="icon-btn" id="cs-close" aria-label="Close">',
    '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    "</button>",
  ].join("");

  body.innerHTML = [
    '<div class="color-sheet-scheme-grid">' +
      schemeButtonsHTML(layer) +
      "</div>",
    '<div class="opacity-row">',
    '  <div class="opacity-head">',
    '    <span class="opacity-label">Opacity</span>',
    '    <span class="opacity-val" data-disp="data-opacity">' +
      dataOpacityVal +
      "%</span>",
    "  </div>",
    '  <input type="range" data-ctrl="data-opacity" min="0" max="100" value="' +
      dataOpacityVal +
      '">',
    "</div>",
  ].join("");

  document.getElementById("cs-close").onclick = closeColorSheet;

  var sheet = document.getElementById("color-sheet");
  var backdrop = document.getElementById("color-sheet-backdrop");
  backdrop.removeAttribute("hidden");
  sheet.classList.add("open");
  backdrop.addEventListener("click", closeColorSheet, { once: true });
}

function closeColorSheet() {
  var sheet = document.getElementById("color-sheet");
  var backdrop = document.getElementById("color-sheet-backdrop");
  if (sheet) sheet.classList.remove("open");
  if (backdrop) backdrop.setAttribute("hidden", "");
  _csLayerId = null;
}

// ─── TOP BAR ──────────────────────────────────

function wireTopBar() {
  var btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-theme");
      setTheme(current === "dark" ? "light" : "dark");
    });
  }

  // Cog button toggles the settings panel (sidebar on desktop, bottom sheet on mobile).
  var cog = document.getElementById("settings-cog");
  if (cog) {
    cog.addEventListener("click", function () {
      hideMiniPanel();
      var panel = document.getElementById("settings-panel");
      if (panel && panel.classList.contains("visible")) {
        closePanel();
      } else {
        openPanel();
      }
    });
  }
}

// ─── FABs ─────────────────────────────────────

function wireFabs() {
  var fabLoc = document.getElementById("fab-location");
  if (fabLoc) {
    fabLoc.onclick = function () {
      triggerMyLocation(fabLoc);
    };
  }

  var fabSearch = document.getElementById("fab-search");
  if (fabSearch) {
    fabSearch.addEventListener("click", function () {
      toggleSearchPopover();
    });
  }

  var fabSettings = document.getElementById("fab-settings");
  if (fabSettings) {
    fabSettings.addEventListener("click", function () {
      toggleMiniPanel();
    });
  }

  var zoomIn = document.getElementById("ctrl-zoom-in");
  if (zoomIn) {
    zoomIn.addEventListener("click", function () {
      if (mapEngine) mapEngine.zoomIn();
    });
  }

  var zoomOut = document.getElementById("ctrl-zoom-out");
  if (zoomOut) {
    zoomOut.addEventListener("click", function () {
      if (mapEngine) mapEngine.zoomOut();
    });
  }
}

// ─── MEASURE DISTANCE ─────────────────────────

var measureActive = false;

function wireMeasure() {
  var fab = document.getElementById("fab-measure");
  if (fab) fab.addEventListener("click", toggleMeasure);
}

function toggleMeasure() {
  measureActive ? stopMeasure() : startMeasure();
}

function startMeasure() {
  if (!mapEngine || !mapEngine.startMeasure()) return;
  measureActive = true;
  syncMeasureButtons();
}

function stopMeasure() {
  measureActive = false;
  syncMeasureButtons();
  if (mapEngine) mapEngine.stopMeasure();
}

// Reflects the current measuring state on the FAB and the sidebar/drawer buttons.
function syncMeasureButtons() {
  var fab = document.getElementById("fab-measure");
  if (fab) {
    fab.classList.toggle("active", measureActive);
    fab.setAttribute("aria-pressed", measureActive ? "true" : "false");
  }
  document.querySelectorAll('[data-ctrl="measure"]').forEach(function (btn) {
    btn.classList.toggle("active", measureActive);
  });
}

// ─── MINI QUICK-SETTINGS PANEL ────────────────

function toggleMiniPanel() {
  var mp = document.getElementById("mini-panel");
  if (!mp) return;
  if (mp.hidden) {
    mp.innerHTML = buildMiniPanelHTML();
    mp.removeAttribute("hidden");
  } else {
    mp.setAttribute("hidden", "");
  }
}

function hideMiniPanel() {
  var mp = document.getElementById("mini-panel");
  if (mp) mp.setAttribute("hidden", "");
}

// ─── SEARCH UI ────────────────────────────────
// The geocoding lookup itself (doSearch) lives in location.js.

function wireSearch() {
  var goBtn = document.getElementById("search-popover-go");
  if (goBtn) {
    goBtn.addEventListener("click", function () {
      var input = document.getElementById("search-popover-input");
      if (input && input.value.trim()) doSearch(input.value.trim());
    });
  }

  var closeBtn = document.getElementById("search-popover-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      hideSearchPopover();
    });
  }
}

function toggleSearchPopover() {
  var pop = document.getElementById("search-popover");
  if (!pop) return;
  if (pop.hidden) {
    pop.removeAttribute("hidden");
    var input = document.getElementById("search-popover-input");
    if (input) input.focus();
  } else {
    hideSearchPopover();
  }
}

function hideSearchPopover() {
  var pop = document.getElementById("search-popover");
  if (pop) pop.setAttribute("hidden", "");
}

// ─── LOCATION BUTTON ──────────────────────────

function wireLocationButtons() {
  // Only binds the panel/drawer buttons — FAB is handled in wireFabs()
  document
    .querySelectorAll('[data-ctrl="my-location"]')
    .forEach(function (btn) {
      btn.onclick = function () {
        triggerMyLocation(btn);
      };
    });
}

function triggerMyLocation(btn) {
  if (!navigator.geolocation || !mapEngine) return;
  btn.classList.add("active");
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      btn.classList.remove("active");
      mapEngine.flyTo(
        [pos.coords.longitude, pos.coords.latitude],
        CONFIG.location_zoom,
      );
    },
    function () {
      btn.classList.remove("active");
    },
  );
}

// ─── RESPONSIVE RESIZE ────────────────────────

window.addEventListener("resize", function () {
  var panel = document.getElementById("settings-panel");
  if (!panel) return;
  if (window.innerWidth >= 768) {
    if (!panel.classList.contains("visible")) {
      openPanel();
    }
  } else {
    panel.classList.remove("visible");
    document.body.classList.remove("panel-open");
  }
});
