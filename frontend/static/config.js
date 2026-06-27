const isLocal =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "";

const CONFIG = {
  fqdn: isLocal ? "http://127.0.0.1:8000" : "https://tiles.alleinseinkarte.de",
  tile_json_path: "WebMercatorQuad/tilejson.json",
  tile_size: 512,
  // Optional: pin a single raster (e.g. "germany_raster_v3.tif") bypassing the backend's per-zoom
  // tiering. Leave null/empty to let the backend tier by zoom (the default).
  raster_override: "germany_20m_v3.tif",
  mask_opacity: 0.45,
  mask_color: "#111111",
  measure_color: "#e6007e",
  minimal_zoom: 6,
  maximal_zoom: 18,
  location_zoom: 12,
};

// Default map view used when no stored position is available.
const DEFAULT_CENTER = [10.45, 51.16];
const DEFAULT_ZOOM = 6;

const TILE_JSON_URL = new URL(CONFIG.tile_json_path, CONFIG.fqdn);

// ─── COLORMAP PRESETS ───
// All ramps are sequential and ordered dark → light: colors[0] is the high end,
// drawn on the right (buildGradient draws "to left"), the lightest is the low
// end. So a glance reads the value direction unambiguously.
const COLORMAP_PRESETS = {
  greens: [
    "#003912",
    "#00501B",
    "#006626",
    "#007E30",
    "#00963A",
    "#00AE45",
    "#00C751",
    "#00E15C",
    "#00FB67",
  ],
  ylorbr: [
    "#4E1D00",
    "#6B2B00",
    "#893900",
    "#A74700",
    "#C65600",
    "#E66500",
    "#FF7A2A",
    "#FFA171",
    "#FFC2A5",
  ],
  blues: [
    "#00314F",
    "#00456C",
    "#005989",
    "#006EA8",
    "#0084C7",
    "#0099E7",
    "#2FB0FF",
    "#75C5FF",
    "#A7D9FF",
  ],
  purples: [
    "#4D0056",
    "#690075",
    "#860095",
    "#A400B6",
    "#C300D7",
    "#E200FA",
    "#ED5EFF",
    "#F38FFF",
    "#F8B7FF",
  ],
  viridis: [
    "#440154",
    "#472d7b",
    "#3b528b",
    "#2c728e",
    "#21918c",
    "#28ae80",
    "#5ec962",
    "#addc30",
    "#fde725",
  ],
};

// ─── LAYER STATE ───
const layerState = [
  {
    id: "Nature",
    start: 1,
    preset: "purples",
    visible: true,
    type: "category",
  },
  {
    id: "Farm",
    start: 11,
    preset: "greens",
    visible: false,
    type: "category",
  },
  {
    id: "Parks",
    start: 21,
    preset: "blues",
    visible: true,
    type: "category",
  },
  {
    id: "Urban",
    start: 31,
    preset: "ylorbr",
    visible: false,
    type: "category",
  },
  {
    id: "Water",
    start: 200,
    preset: "#008fa8",
    visible: false,
    type: "solid",
  },
];

// ─── BASEMAP DEFINITIONS ───
const BASEMAPS = {
  // Tile sizes below are fixed by each provider:
  // • OSM standard tiles ...................... 256 px
  // • Esri World Imagery (ArcGIS XYZ) ......... 256 px
  // • Waymarked Trails (hiking/cycling) ....... 256 px
  // • basemap.de Schummerung WMS .............. any size via width/height (256 px requested)
  // The titiler data raster uses CONFIG.tile_size (512) instead — that is separate.
  osm: {
    label: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      tileSize: 256,
      maxZoom: 19,
    },
  },
  satellite: {
    label: "Satellite Hybrid",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: {
      attribution:
        '&copy; <a href="https://www.esri.com/">Esri</a> · Sources: Esri, Maxar, Earthstar Geographics',
      tileSize: 256,
      maxZoom: 19,
    },
  },
  schummerung: {
    label: "Relief",
    type: "wms",
    url: "https://sgx.geodatenzentrum.de/wms_basemapde_schummerung",
    options: {
      layers: "de_basemapde_web_raster_combshade",
      format: "image/png",
      transparent: true,
      version: "1.1.1",
      srs: "EPSG:3857",
      attribution: '&copy; <a href="https://www.bkg.bund.de">BKG</a>',
      tileSize: 256,
      maxZoom: 18,
    },
  },
  hiking: {
    label: "Hiking",
    type: "overlay",
    url: "https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png",
    options: {
      attribution:
        '&copy; <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>',
      tileSize: 256,
      maxZoom: 18,
    },
  },
  cycling: {
    label: "Cycling",
    type: "overlay",
    url: "https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png",
    options: {
      attribution:
        '&copy; <a href="https://cycling.waymarkedtrails.org">Waymarked Trails</a>',
      tileSize: 256,
      maxZoom: 18,
    },
  },
};

// ─── MUTABLE APP STATE ───
let activeBasemapKey = "osm";
let basemapOpacity = 0.8;
let dataLayerOpacity = 1.0;
let boundsSet = false;
let hotspotMode = false;
// Bottom layer bar visibility (toggle in settings → Theme). Enabled by default.
let bottomBarEnabled = true;
// Data-layer raster source mode. true = pin CONFIG.raster_override (single raster,
// no tiering); false = let the backend pick a raster per zoom tier. Defaults to tiering.
let useRasterOverride = false;

let activeOverlays = {
  hiking: false,
  cycling: false,
};
