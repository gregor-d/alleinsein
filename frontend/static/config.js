const CONFIG = {
    fqdn: "http://127.0.0.1:8080",
    // on prod the fqdn is on the same origin
    // test cloudflare wrangler trigger
    // fqdn: "https://tiles.alleinseinkarte.de",
    tile_json_path: "WebMercatorQuad/tilejson.json",
    raster_name: "germany_raster_v2.tif"
};

const TILE_JSON_URL = new URL(CONFIG.tile_json_path, CONFIG.fqdn);

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
