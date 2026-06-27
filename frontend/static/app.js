// ─────────────────────────────────────────────
//  APP.JS — UI orchestration
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  loadTheme();
  loadBottomBarPref();
  loadPixelInMapPref();
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

// ─── BOTTOM BAR ───────────────────────────────

function loadBottomBarPref() {
  bottomBarEnabled = localStorage.getItem("bottomBar") !== "off";
  applyBottomBarVisibility();
}

function applyBottomBarVisibility() {
  document.body.classList.toggle("bottombar-hidden", !bottomBarEnabled);
}

// ─── PIXEL READOUT IN MAP ─────────────────────

function loadPixelInMapPref() {
  pixelInMapEnabled = localStorage.getItem("pixelInMap") !== "off";
}

// ─── MAP INIT ─────────────────────────────────

function initMapEngine() {
  mapEngine = new MapLibreEngine();
  mapEngine.init("map", DEFAULT_CENTER, DEFAULT_ZOOM).then(function () {
    afterEngineInit(true);
    wireLocationButtons();
    wirePixelInspect();
  });
}

// ─── PIXEL INSPECT ────────────────────────────
// Click anywhere on the map to read the raw raster value under the cursor and
// show its area type + aloneness level in a fixed readout. Skipped while the
// measure tool is active (that mode owns clicks).

var _pixelReqSeq = 0;
var _pixelLngLat = null; // geographic point of the last click, for positioning

var COPY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
var CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
var SHARE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

function wirePixelInspect() {
  mapEngine.onClick(function (e) {
    if (measureActive) return;
    showPixelInfo(e.lngLat);
  });
  var closeBtn = document.getElementById("pixel-info-close");
  if (closeBtn) closeBtn.addEventListener("click", hidePixelInfo);
  // Keep the floating readout pinned next to its point while the map moves.
  mapEngine.onMove(positionFloatingReadout);
  // Copy/share buttons render in both the floating readout and the LOCATION
  // panel card, so delegate at document level rather than per-container.
  document.addEventListener("click", function (e) {
    var coordsBtn = e.target.closest(".pixel-info-coords");
    if (coordsBtn) {
      copyCoords(coordsBtn);
      return;
    }
    var shareBtn = e.target.closest(".pixel-info-share");
    if (shareBtn) shareCoords(shareBtn);
  });
}

// Coordinate line: a copy button (copy icon → "Copied!") plus a share button.
// The share button opens the native share sheet on touch devices (any map/app on
// the device) and opens a Google Maps tab on desktop — see shareCoords.
function coordsRowHTML(lngLat) {
  var lat = lngLat.lat.toFixed(4);
  var lng = lngLat.lng.toFixed(4);
  var coords = lat + ", " + lng;
  var mapsUrl =
    "https://www.google.com/maps/search/?api=1&query=" + lat + "," + lng;
  return (
    '<div class="pixel-info-coords-row">' +
    '<button type="button" class="pixel-info-coords" data-copy="' +
    coords +
    '" title="Copy coordinates">' +
    '<span class="coords-icon">' +
    COPY_ICON +
    '</span><span class="coords-text">' +
    coords +
    "</span></button>" +
    '<button type="button" class="pixel-info-share" data-coords="' +
    coords +
    '" data-maps="' +
    mapsUrl +
    '" title="Share location" aria-label="Share location">' +
    SHARE_ICON +
    "</button>" +
    "</div>"
  );
}

function copyCoords(btn) {
  var text = btn.getAttribute("data-copy");
  if (!text) return;
  copyToClipboard(text).then(function (ok) {
    if (ok) showCopied(btn);
  });
}

// Touch-first devices (coarse pointer: phones/tablets, incl. iOS/iPadOS) get the
// native share sheet so the coords can go to any map/app installed. Desktops —
// including macOS Safari, which supports the API but is mouse-driven, and Firefox,
// which doesn't — open a Google Maps tab instead.
function shareCoords(btn) {
  var coords = btn.getAttribute("data-coords");
  var mapsUrl = btn.getAttribute("data-maps");
  var coarsePointer =
    window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  if (typeof navigator.share === "function" && coarsePointer) {
    navigator
      .share({ title: "Coordinates", text: coords, url: mapsUrl })
      .catch(function () {}); // user dismissed the sheet, or share unavailable — no-op
    return;
  }
  window.open(mapsUrl, "_blank", "noopener");
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(
      function () {
        return true;
      },
      function () {
        return legacyCopy(text); // clipboard API can reject without a user gesture / on http
      },
    );
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text) {
  try {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

var _copiedTimer = null;
function showCopied(btn) {
  var iconEl = btn.querySelector(".coords-icon");
  var textEl = btn.querySelector(".coords-text");
  if (!iconEl || !textEl) return;
  var original = btn.getAttribute("data-copy");
  btn.classList.add("copied");
  iconEl.innerHTML = CHECK_ICON;
  textEl.textContent = "Copied!";
  clearTimeout(_copiedTimer);
  _copiedTimer = setTimeout(function () {
    // A newer click may have replaced the body; only revert if still mounted.
    if (!document.body.contains(btn)) return;
    btn.classList.remove("copied");
    iconEl.innerHTML = COPY_ICON;
    textEl.textContent = original;
  }, 1200);
}

function showPixelInfo(lngLat) {
  _pixelLngLat = lngLat;
  // The settings-panel readout (Interact card) always updates; the floating
  // on-map window only appears when "Show in Map" is enabled.
  var floatPanel = document.getElementById("pixel-info");
  if (floatPanel) {
    if (pixelInMapEnabled) floatPanel.removeAttribute("hidden");
    else floatPanel.setAttribute("hidden", "");
  }

  setPixelInfoHTML('<div class="pixel-info-loading">Reading…</div>');
  positionFloatingReadout();

  var reqId = ++_pixelReqSeq;
  mapEngine
    .getPointValue(lngLat)
    .then(function (data) {
      if (reqId !== _pixelReqSeq) return; // a newer click (or close) superseded this
      setPixelInfoHTML(renderPixelInfoHTML(data, lngLat));
      positionFloatingReadout();
    })
    .catch(function () {
      if (reqId !== _pixelReqSeq) return;
      // A failed lookup is almost always a point outside the raster footprint
      // (titiler returns 500 out-of-bounds), so present it as "No data here"
      // rather than an error — renderPixelInfoHTML(null, …) yields exactly that.
      setPixelInfoHTML(renderPixelInfoHTML(null, lngLat));
      positionFloatingReadout();
    });
}

// Places the floating readout next to the clicked point, flipping and clamping so
// it stays inside the viewport (and below the top bar). No-op while hidden.
function positionFloatingReadout() {
  var panel = document.getElementById("pixel-info");
  if (!panel || panel.hasAttribute("hidden") || !_pixelLngLat || !mapEngine)
    return;
  var pos = mapEngine.projectToPage(_pixelLngLat);
  if (!pos) return;

  var rect = panel.getBoundingClientRect();
  var margin = 8;
  var offset = 7; // gap from the cursor so the box doesn't sit under it
  var topbar =
    parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--topbar-h"),
      10,
    ) || 40;

  var left = pos.x + offset;
  if (left + rect.width + margin > window.innerWidth)
    left = pos.x - rect.width - offset; // flip to the left edge of the cursor
  if (left < margin) left = margin;

  var top = pos.y + offset;
  if (top + rect.height + margin > window.innerHeight)
    top = pos.y - rect.height - offset; // flip above the cursor
  if (top < topbar + margin) top = topbar + margin;

  panel.style.left = left + "px";
  panel.style.top = top + "px";
}

// Mirror the readout into every sink: the floating box and the LOCATION panel
// card (which shows the hint until the first click replaces it).
function setPixelInfoHTML(html) {
  var floatBody = document.getElementById("pixel-info-body");
  if (floatBody) floatBody.innerHTML = html;
  var panelBody = document.getElementById("panel-picker-body");
  if (panelBody) panelBody.innerHTML = html;
}

function renderPixelInfoHTML(data, lngLat) {
  var raw = data && data.values ? data.values[0] : null;
  var info = describePixelValue(raw);

  if (!info) {
    return (
      '<div class="pixel-info-area">No data here</div>' + coordsRowHTML(lngLat)
    );
  }

  var levelHTML = "";
  if (info.bucket !== null) {
    // bucket 0 (A=1, least road influence) is the most-alone end — the one
    // hotspot mode highlights — so it reads as 10 / 10, matching "higher →".
    var level = CATEGORY_SPAN - info.bucket;
    levelHTML =
      '<div class="pixel-info-row"><span>Aloneness</span><b>' +
      level +
      " / " +
      CATEGORY_SPAN +
      "</b></div>";
  }

  return (
    '<div class="pixel-info-area">' +
    info.area +
    "</div>" +
    levelHTML +
    coordsRowHTML(lngLat)
  );
}

function hidePixelInfo() {
  _pixelReqSeq++; // invalidate any in-flight lookup
  var panel = document.getElementById("pixel-info");
  if (panel) panel.setAttribute("hidden", "");
}

// ─── PANEL BUILDER ────────────────────────────

function layerGradientStyle(layer) {
  if (layer.type === "solid") {
    return "background:" + layer.preset.slice(0, 7) + ";";
  }
  return "background:" + buildGradient(layer.preset) + ";";
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
        buildGradient(name, { forceFull: true }) +
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
// Data-layer raster source switch (single pinned raster vs. backend zoom-tiering).
// Only meaningful when a raster_override is configured; otherwise the backend
// always tiers by zoom, so the switch is omitted.
function rasterSourceRowHTML() {
  if (!CONFIG.raster_override) return "";
  return [
    '<div class="sub-label-row raster-source-row">',
    '  <div class="sub-label">Detail</div>',
    '  <div class="btn-group">',
    '    <button class="seg-btn' +
      (useRasterOverride ? " active" : "") +
      '" data-ctrl="raster-mode" data-raster-mode="override">Fine</button>',
    '    <button class="seg-btn' +
      (!useRasterOverride ? " active" : "") +
      '" data-ctrl="raster-mode" data-raster-mode="tiers">Auto</button>',
    "  </div>",
    "</div>",
  ].join("\n");
}

function backendSectionHTML(showLabel) {
  var basemapOpacityVal = Math.round(basemapOpacity * 100);
  var basemapEnabled = activeBasemapKey !== "none";
  return [
    showLabel === false ? "" : '<div class="section-label">Map Style</div>',

    '<div class="sub-card">',
    '  <div class="sub-label-row">',
    '    <div class="sub-label">Background Map</div>',
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
    '  <div class="sub-label">Trail Overlays</div>',
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
    '<div class="sub-card">',
    '  <div class="sub-label">Aloneness Map</div>',
    rasterSourceRowHTML(),
    "</div>",
    backendSectionHTML(false),
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
    '  <span class="mini-title">Settings</span>',
    '  <button class="icon-btn" data-ctrl="panel-close" title="Close">',
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    "  </button>",
    "</div>",

    "<!-- Intro -->",
    '<p class="panel-intro">',
    '  <a href="https://alleinseinkarte.de" target="_blank" rel="noopener noreferrer">alleinseinkarte.de</a>',
    "   is a map for finding places where you can be alone. It guides you to areas where you’re least likely to encounter other people.",
    "</p>",

    "<!-- Aloneness Map -->",
    '<div class="section-label">Aloneness Map</div>',

    "<!-- Best Spots -->",
    '<div class="sub-card">',
    '  <div class="sub-label">Highest value only</div>',
    '  <div class="hotspot-row">',
    '    <label class="toggle">',
    '      <input type="checkbox" data-ctrl="hotspot" ' + hotspotChecked + ">",
    '      <span class="toggle-track"></span>',
    "    </label>",
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    '    <span class="row-name">Hotspots</span>',
    "  </div>",
    "</div>",
    '<div class="sub-card">',
    // '  <div class="sub-label">Aloneness Legend</div>',
    '  <div class="legend-head">',
    '    <span class="legend-head-name">Area</span>',
    '    <span class="legend-head-scale">Color</span>',
    "  </div>",
    layersHTML,
    dataOpacityRowHTML("Opacity"),
    rasterSourceRowHTML(),
    "</div>",

    "<!-- Backend -->",
    backendSectionHTML(),

    "<!-- Location -->",
    '<div class="section-label">LOCATION</div>',

    "<!-- Search sub-panel: geocoding search + my-location -->",
    '<div class="sub-card">',
    '  <div class="sub-label">Search</div>',
    '  <div class="search-row">',
    '    <input type="text" data-ctrl="location-input" placeholder="Search location…" autocomplete="off">',
    '    <button class="btn-go" data-ctrl="location-go">Go</button>',
    "  </div>",
    '  <ul class="search-results" data-ctrl="location-results"></ul>',
    '  <button class="btn-full" data-ctrl="my-location">',
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>',
    "    My Location",
    "  </button>",
    "</div>",

    "<!-- Info sub-panel: coordinate information; header row carries the show-in-map toggle -->",
    '<div class="sub-card">',
    '  <div class="sub-label-row">',
    '    <div class="sub-label">Info</div>',
    '    <div class="picker-showmap">',
    '      <span class="picker-showmap-hint">Show in map</span>',
    '      <label class="toggle">',
    '        <input type="checkbox" data-ctrl="pixel-in-map" ' +
      (pixelInMapEnabled ? "checked" : "") +
      ">",
    '        <span class="toggle-track"></span>',
    "      </label>",
    "    </div>",
    "  </div>",
    "  <!-- Coordinate information: hint until a map click fills it with the readout -->",
    '  <div class="picker-info" id="panel-picker-body">',
    '    <div class="picker-hint">',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="2"/></svg>',
    "      <span>Click on the map to get information about an area and its coordinates.</span>",
    "    </div>",
    "  </div>",
    "</div>",

    "<!-- About / links -->",
    '<div class="panel-footer">',
    '<div class="section-label">ABOUT</div>',
    '<div class="sub-card">',
    '  <a class="panel-link" href="https://www.linkedin.com/in/gregor-didenko-855a711a9" target="_blank" rel="noopener noreferrer">',
    '    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3V9zm6 0h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.4c0-1.29-.02-2.95-1.8-2.95-1.8 0-2.08 1.4-2.08 2.85V21H9V9z"/></svg>',
    "    LinkedIn",
    "  </a>",
    '  <a class="panel-link" href="https://github.com/gregor-d/alleinsein" target="_blank" rel="noopener noreferrer">',
    '    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.48l-.01-1.7c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.85.09-.67.35-1.12.63-1.38-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9l-.01 2.81c0 .27.18.59.69.48A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>',
    "    GitHub repository",
    "  </a>",
    "  </div>",
    "<!-- Display: theme + bottom bar -->",
    '<div class="section-label">Display</div>',
    '<div class="sub-card">',
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
    '  <div class="theme-switch bottombar-switch">',
    '    <span class="theme-switch-label">BOTTOM BAR</span>',
    '    <label class="toggle">',
    '      <input type="checkbox" data-ctrl="bottombar-toggle" ' +
      (bottomBarEnabled ? "checked" : "") +
      ">",
    '      <span class="toggle-track"></span>',
    "    </label>",
    "  </div>",
    "</div>",
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

  if (ctrl === "bottombar-toggle") {
    bottomBarEnabled = e.target.checked;
    localStorage.setItem("bottomBar", bottomBarEnabled ? "on" : "off");
    syncCheckboxes("bottombar-toggle", null, bottomBarEnabled);
    applyBottomBarVisibility();
  }

  if (ctrl === "pixel-in-map") {
    pixelInMapEnabled = e.target.checked;
    localStorage.setItem("pixelInMap", pixelInMapEnabled ? "on" : "off");
    syncCheckboxes("pixel-in-map", null, pixelInMapEnabled);
    // Reflect the change on the live floating readout right away: hide it when
    // turned off, or bring it back at the last clicked point when turned on.
    var floatPanel = document.getElementById("pixel-info");
    if (floatPanel) {
      if (!pixelInMapEnabled) {
        floatPanel.setAttribute("hidden", "");
      } else if (_pixelLngLat) {
        floatPanel.removeAttribute("hidden");
        positionFloatingReadout();
      }
    }
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

  if (ctrl === "raster-mode") {
    useRasterOverride = btn.dataset.rasterMode === "override";
    syncActiveBtn("raster-mode", btn.dataset.rasterMode);
    refreshDataLayer();
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
    runPanelSearch(
      btn.parentElement.querySelector('[data-ctrl="location-input"]'),
    );
  }
}

// Runs a search from the settings-panel LOCATION section, rendering results
// into that section's own list. Picking a result flies the map there but leaves
// the panel (and the results list) open — the list has its own close button.
function runPanelSearch(input) {
  if (!input || !input.value.trim()) return;
  var card = input.closest(".sub-card");
  var results = card
    ? card.querySelector('[data-ctrl="location-results"]')
    : null;
  doSearch(input.value.trim(), results);
}

// Enter key on location inputs
document.addEventListener("keydown", function (e) {
  if (e.key !== "Enter") return;
  var ctrl = e.target.dataset.ctrl;
  if (ctrl === "location-input") {
    runPanelSearch(e.target);
  }
  if (e.target.id === "search-popover-input") {
    if (e.target.value.trim()) {
      doSearch(
        e.target.value.trim(),
        document.getElementById("search-popover-results"),
        hideSearchPopover,
      );
    }
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

  // Grid (set in CSS): captions on row 1 sit above their controls on row 2,
  // so the markup order is Area, Higher, close, then name-group, ramp.
  header.innerHTML = [
    '<span class="cs-caption cs-cap-area">Area</span>',
    '<span class="cs-caption cs-cap-higher">Color</span>',
    '<button class="icon-btn" id="cs-close" aria-label="Close">',
    '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    "</button>",
    '<div class="cs-namegroup">',
    '  <label class="toggle">',
    '    <input type="checkbox" data-ctrl="layer-toggle" data-layer="' +
      layer.id +
      '" ' +
      (layer.visible ? "checked" : "") +
      ">",
    '    <span class="toggle-track"></span>',
    "  </label>",
    '  <span class="layer-name">' + layer.id + "</span>",
    "</div>",
    '<div class="color-sheet-gradient-bar" data-grad="' +
      layer.id +
      '" style="' +
      layerGradientStyle(layer) +
      '"></div>',
  ].join("");

  body.innerHTML = [
    '<span class="cs-caption">New Color</span>',
    '<div class="color-sheet-scheme-grid">' +
      schemeButtonsHTML(layer) +
      "</div>",
  ].join("");

  document.getElementById("cs-close").onclick = closeColorSheet;

  var sheet = document.getElementById("color-sheet");
  var backdrop = document.getElementById("color-sheet-backdrop");
  backdrop.removeAttribute("hidden");
  sheet.classList.add("open");
  positionColorSheetArrow(layer.id);
  backdrop.addEventListener("click", closeColorSheet, { once: true });
}

// Aligns the floating card's tail with the horizontal center of the layer tab
// being edited, so it's obvious which colour is in play. Left is relative to the
// card and clamped so the tail never slides past its rounded corners.
function positionColorSheetArrow(layerId) {
  var arrow = document.getElementById("color-sheet-arrow");
  var sheet = document.getElementById("color-sheet");
  var tab = document.querySelector('[data-tab-layer="' + layerId + '"]');
  if (!arrow || !sheet || !tab) return;
  var sheetRect = sheet.getBoundingClientRect();
  var tabRect = tab.getBoundingClientRect();
  var tabCenter = tabRect.left + tabRect.width / 2 - sheetRect.left;
  var x = Math.max(18, Math.min(sheetRect.width - 18, tabCenter));
  arrow.style.left = x + "px";
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
  hidePixelInfo(); // measure mode owns clicks; clear any stale pixel readout
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
      if (input && input.value.trim()) {
        doSearch(
          input.value.trim(),
          document.getElementById("search-popover-results"),
          hideSearchPopover,
        );
      }
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
  var results = document.getElementById("search-popover-results");
  if (results) results.innerHTML = "";
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
  positionFloatingReadout(); // keep the click readout pinned to its point
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
