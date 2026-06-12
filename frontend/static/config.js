const isLocal = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
    || window.location.hostname === '';

const CONFIG = {
    fqdn: isLocal ? 'http://127.0.0.1:8000' : 'https://tiles.alleinseinkarte.de',
    tile_json_path: 'WebMercatorQuad/tilejson.json',
    raster_name: 'germany_raster_v2.tif',
    mask_opacity: 0.45,
    mask_color: '#111111',
    minimal_zoom: 6,
    location_zoom: 12
};

// Default map view used when no stored position is available.
const DEFAULT_CENTER = [13.3, 51.0];
const DEFAULT_ZOOM = 8;

// Zoom-control position strings differ between Leaflet and MapLibre.
const NAV_CONTROL_POSITIONS = {
    leaflet: 'topleft',
    maplibre: 'top-left'
};

const TILE_JSON_URL = new URL(CONFIG.tile_json_path, CONFIG.fqdn);

// ─── COLORMAP PRESETS ───
const COLORMAP_PRESETS = {
    'Thai Lily': ['#3a7300ff', '#478d00ff', '#53a600ff', '#83a63cff', '#ebb788ff', '#e39199ff', '#d957b9ff', '#c62ca0ff', '#ab0080ff'],
    'Halloween Morning': ['#ffaa00ff', '#f28e00ff', '#e67500ff', '#b45a00ff', '#315b61ff', '#008c74ff', '#00b294ff', '#00d9b4ff', '#00ffd4ff'],
    'Blue 2': ['#fffcd4ff', '#cde0caff', '#b4d2c6ff', '#82b6bcff', '#69a8b7ff', '#5a93a8ff', '#3d6a89ff', '#2e557aff', '#102b5bff'],
    viridis: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'],
    magma: ['#000004', '#180f3e', '#440f76', '#721f81', '#9e2f7f', '#cd4071', '#f1605d', '#fd9668', '#fcfdbf']
};

// ─── LAYER STATE ───
const layerState = [
    { id: 'Nature', start: 1,   preset: 'viridis', visible: true,  reverse: false, type: 'category' },
    { id: 'Farm',   start: 11,  preset: 'Halloween Morning', visible: false, reverse: false, type: 'category' },
    { id: 'Parks',  start: 21,  preset: 'Blue 2',  visible: false, reverse: false, type: 'category' },
    { id: 'Urban',  start: 31,  preset: 'magma',   visible: false, reverse: false, type: 'category' },
    { id: 'Water',  start: 200, preset: '#4da6ff', visible: false, reverse: false, type: 'solid'    }
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
    },
    schummerung: {
        label: 'Relief',
        type: 'wms',
        url: 'https://sgx.geodatenzentrum.de/wms_basemapde_schummerung',
        options: {
            layers: 'de_basemapde_web_raster_combshade',
            format: 'image/png',
            transparent: true,
            attribution: '&copy; <a href="https://www.bkg.bund.de">BKG</a>',
            maxZoom: 15
        }
    },
    hiking: {
        label: 'Hiking',
        type: 'overlay',
        url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
        options: {
            attribution: '&copy; <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>',
            maxZoom: 15
        }
    },
    cycling: {
        label: 'Cycling',
        type: 'overlay',
        url: 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png',
        options: {
            attribution: '&copy; <a href="https://cycling.waymarkedtrails.org">Waymarked Trails</a>',
            maxZoom: 15
        }
    }
};

// ─── MUTABLE APP STATE ───
let activeBasemapKey = 'osm';
let basemapOpacity   = 1.0;
let dataLayerOpacity = 0.9;
let boundsSet        = false;
let hotspotMode      = false;

let activeOverlays = {
    hiking:  false,
    cycling: false
};
