// ─────────────────────────────────────────────
//  LEAFLET_MAP.JS — Leaflet-specific map engine
// ─────────────────────────────────────────────

class LeafletEngine {
    constructor() {
        this.map = null;
        this.basemapLayer = null;
        this.dataLayer = null;
        this.maskLayer = null;
        this.boundsSet = false;
        this.overlays = {};
    }

    init(containerId, center, zoom, zoomPos = 'topleft') {
        return new Promise((resolve) => {
            // center is [lng, lat], Leaflet setView expects [lat, lng]
            const latlng = [center[1], center[0]];

            const minZoomSetting = CONFIG.minimal_zoom !== undefined ? CONFIG.minimal_zoom : (CONFIG['minimal-zoom'] !== undefined ? CONFIG['minimal-zoom'] : undefined);
            const mapOptions = {
                zoomControl: false
            };
            if (minZoomSetting !== undefined) {
                mapOptions.minZoom = minZoomSetting;
            }

            this.map = L.map(containerId, mapOptions).setView(latlng, zoom);

            L.control.zoom({ position: zoomPos }).addTo(this.map);
            L.control.scale({ position: 'bottomleft', imperial: false }).addTo(this.map);

            // Load Germany mask
            fetch('germany-mask.geojson')
                .then(res => res.json())
                .then(data => {
                    if (!this.map) return;
                    this.maskLayer = L.geoJSON(data, {
                        style: {
                            stroke: false,
                            fillColor: CONFIG.mask_color || '#111111',
                            fillOpacity: CONFIG.mask_opacity !== undefined ? CONFIG.mask_opacity : 0.45,
                            interactive: false
                        }
                    }).addTo(this.map);
                    // Ensure data layer stays on top if it's already loaded
                    if (this.dataLayer) {
                        this.dataLayer.bringToFront();
                    }
                })
                .catch(err => console.error("Error loading Leaflet mask:", err));

            resolve();
        });
    }

    flyTo(lngLat, zoom) {
        if (this.map) {
            this.map.flyTo([lngLat[1], lngLat[0]], zoom, { duration: 1.2 });
        }
    }

    destroy() {
        if (this.map) {
            for (const id in this.overlays) {
                if (this.map.hasLayer(this.overlays[id])) {
                    this.map.removeLayer(this.overlays[id]);
                }
            }
            this.map.remove();
            this.map = null;
        }
        this.basemapLayer = null;
        this.dataLayer = null;
        this.overlays = {};
    }

    async updateDataLayer(colormapJson, opacity) {
        // If no layers are visible, remove the data layer entirely
        if (colormapJson === '{}') {
            if (this.dataLayer) {
                this.map.removeLayer(this.dataLayer);
                this.dataLayer = null;
            }
            return;
        }

        TILE_JSON_URL.searchParams.set('raster', CONFIG.raster_name);
        TILE_JSON_URL.searchParams.set('colormap', colormapJson);

        try {
            const res = await fetch(TILE_JSON_URL.toString());
            const tj = await res.json();

            if (!tj.tiles || tj.tiles.length === 0) return;

            // Fit map to raster bounds on first load
            if (!window.boundsSet && tj.bounds) {
                const [west, south, east, north] = tj.bounds;
                this.map.fitBounds([[south, west], [north, east]]);
                window.boundsSet = true;
            }

            let tileUrl = tj.tiles[0];

            if (!this.dataLayer) {
                this.dataLayer = L.tileLayer(tileUrl, {
                    maxNativeZoom: tj.maxzoom || 12,
                    maxZoom: 15,
                    updateWhenZooming: false,
                    updateWhenIdle: true,
                    keepBuffer: 2,
                    zoomOffset: -1,
                    tileSize: 512,
                    minZoom: tj.minzoom,
                    opacity: opacity
                }).addTo(this.map);
            } else {
                this.dataLayer.setUrl(tileUrl);
                this.dataLayer.setOpacity(opacity);
            }

            // Bring overlays to front
            for (const id in this.overlays) {
                if (this.map.hasLayer(this.overlays[id])) {
                    this.overlays[id].bringToFront();
                }
            }
        } catch (e) {
            console.error("Error fetching TileJSON in Leaflet:", e);
        }
    }

    updateDataLayerOpacity(opacity) {
        if (this.dataLayer) {
            this.dataLayer.setOpacity(opacity);
        }
    }

    switchBasemap(key) {
        if (this.basemapLayer) {
            this.map.removeLayer(this.basemapLayer);
            this.basemapLayer = null;
        }

        if (key !== 'none') {
            const def = BASEMAPS[key];
            if (def.type === 'wms') {
                this.basemapLayer = L.tileLayer.wms(def.url, def.options).addTo(this.map);
            } else {
                this.basemapLayer = L.tileLayer(def.url, def.options).addTo(this.map);
            }
            this.basemapLayer.setOpacity(basemapOpacity);

            // Re-add mask and data layer on top in correct order
            if (this.maskLayer) {
                this.maskLayer.bringToFront();
            }
            if (this.dataLayer) {
                this.dataLayer.bringToFront();
            }

            // Bring overlays to front
            for (const id in this.overlays) {
                if (this.map.hasLayer(this.overlays[id])) {
                    this.overlays[id].bringToFront();
                }
            }
        }
    }

    toggleOverlay(id, visible) {
        if (!this.map) return;
        const key = id.toLowerCase();
        if (visible) {
            const def = BASEMAPS[key];
            if (!def) return;

            if (!this.overlays[key]) {
                this.overlays[key] = L.tileLayer(def.url, def.options);
            }
            if (!this.map.hasLayer(this.overlays[key])) {
                this.overlays[key].addTo(this.map);
                this.overlays[key].bringToFront();
            }
        } else {
            if (this.overlays[key] && this.map.hasLayer(this.overlays[key])) {
                this.map.removeLayer(this.overlays[key]);
            }
        }
    }

    updateBasemapOpacity(opacity) {
        if (this.basemapLayer) {
            this.basemapLayer.setOpacity(opacity);
        }
    }

    getCenter() {
        if (!this.map) return [13.3, 51.0];
        const c = this.map.getCenter();
        return [c.lng, c.lat]; // Return [lng, lat]
    }

    getZoom() {
        if (!this.map) return 10;
        return this.map.getZoom();
    }
}

// Expose globally
window.LeafletEngine = LeafletEngine;


// ─────────────────────────────────────────────
//  MAPLIBRE_MAP.JS — MapLibre-specific map engine
// ─────────────────────────────────────────────

class MapLibreEngine {
    constructor() {
        this.map = null;
        this.boundsSet = false;
        this.debounceTimer = null;
    }

    init(containerId, center, zoom, navPos = 'top-left') {
        this._navPos = navPos;
        return new Promise((resolve) => {
            const minZoomSetting = CONFIG.minimal_zoom !== undefined ? CONFIG.minimal_zoom : (CONFIG['minimal-zoom'] !== undefined ? CONFIG['minimal-zoom'] : undefined);
            const mapOptions = {
                container: containerId,
                style: {
                    version: 8,
                    sources: {
                        'basemap-osm': {
                            type: 'raster',
                            tiles: [BASEMAPS.osm.url],
                            tileSize: 256,
                            attribution: BASEMAPS.osm.options.attribution,
                            maxzoom: BASEMAPS.osm.options.maxZoom
                        },
                        'basemap-satellite': {
                            type: 'raster',
                            tiles: [BASEMAPS.satellite.url],
                            tileSize: 256,
                            attribution: BASEMAPS.satellite.options.attribution,
                            maxzoom: BASEMAPS.satellite.options.maxZoom
                        },
                        'basemap-schummerung': {
                            type: 'raster',
                            tiles: [
                                'https://sgx.geodatenzentrum.de/wms_basemapde_schummerung?service=WMS&version=1.1.1&request=GetMap&layers=de_basemapde_web_raster_combshade&styles=&format=image/png&transparent=true&height=256&width=256&srs=EPSG:3857&bbox={bbox-epsg-3857}'
                            ],
                            tileSize: 256,
                            attribution: '&copy; <a href="https://www.bkg.bund.de">BKG</a>',
                            maxzoom: 15
                        }
                    },
                    layers: [
                        {
                            id: 'basemap-osm-layer',
                            type: 'raster',
                            source: 'basemap-osm',
                            layout: {
                                visibility: 'none'
                            },
                            paint: {
                                'raster-opacity': 1.0
                            }
                        },
                        {
                            id: 'basemap-satellite-layer',
                            type: 'raster',
                            source: 'basemap-satellite',
                            layout: {
                                visibility: 'none'
                            },
                            paint: {
                                'raster-opacity': 1.0
                            }
                        },
                        {
                            id: 'basemap-schummerung-layer',
                            type: 'raster',
                            source: 'basemap-schummerung',
                            layout: {
                                visibility: 'none'
                            },
                            paint: {
                                'raster-opacity': 1.0
                            }
                        }
                    ]
                },
                center: center, // MapLibre center format is [lng, lat]
                zoom: zoom - 1,
                attributionControl: false
            };
            if (minZoomSetting !== undefined) {
                mapOptions.minZoom = minZoomSetting - 1;
            }
            this.map = new maplibregl.Map(mapOptions);

            this.map.addControl(new maplibregl.NavigationControl({
                showCompass: false
            }), this._navPos || 'top-left');

            // Add attribution control bottom-right
            this.map.addControl(new maplibregl.AttributionControl({
                compact: false
            }), 'bottom-right');

            // Add scale control bottom-left
            this.map.addControl(new maplibregl.ScaleControl({
                maxWidth: 80,
                unit: 'metric'
            }), 'bottom-left');

            this.map.on('load', () => {
                // Fetch and add Germany mask layer
                fetch('germany-mask.geojson')
                    .then(res => res.json())
                    .then(data => {
                        if (!this.map) return;
                        this.map.addSource('germany-mask-source', {
                            type: 'geojson',
                            data: data
                        });
                        this.map.addLayer({
                            id: 'germany-mask-layer',
                            type: 'fill',
                            source: 'germany-mask-source',
                            paint: {
                                'fill-color': CONFIG.mask_color || '#111111',
                                'fill-opacity': CONFIG.mask_opacity !== undefined ? CONFIG.mask_opacity : 0.45
                            }
                        }, this.map.getLayer('data-layer') ? 'data-layer' : undefined);
                    })
                    .catch(err => console.error("Error loading MapLibre mask:", err));

                resolve();
            });
        });
    }

    destroy() {
        clearTimeout(this.debounceTimer);
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
    }

    updateDataLayer(colormapJson, opacity) {
        if (!this.map || !this.map.isStyleLoaded()) return;

        clearTimeout(this.debounceTimer);

        // If no layers are visible, remove the data layer entirely
        if (colormapJson === '{}') {
            if (this.map.getLayer('data-layer')) {
                this.map.removeLayer('data-layer');
            }
            if (this.map.getSource('data-source')) {
                this.map.removeSource('data-source');
            }
            return;
        }

        this.debounceTimer = setTimeout(async () => {
            TILE_JSON_URL.searchParams.set('raster', CONFIG.raster_name);
            TILE_JSON_URL.searchParams.set('colormap', colormapJson);

            try {
                const res = await fetch(TILE_JSON_URL.toString());
                const tj = await res.json();

                if (!tj.tiles || tj.tiles.length === 0) return;

                // Fit map to raster bounds on first load
                if (!window.boundsSet && tj.bounds) {
                    const [west, south, east, north] = tj.bounds;
                    this.map.fitBounds([[west, south], [east, north]], { padding: 20 });
                    window.boundsSet = true;
                }

                let tileUrl = tj.tiles[0];

                if (!this.map.getSource('data-source')) {
                    this.map.addSource('data-source', {
                        type: 'raster',
                        tiles: [tileUrl],
                        tileSize: 512,
                        minzoom: tj.minzoom,
                        maxzoom: tj.maxzoom || 12
                    });

                    let beforeId = undefined;
                    const layers = this.map.getStyle().layers;
                    if (layers) {
                        const firstOverlay = layers.find(l => l.id.startsWith('overlay-layer-'));
                        if (firstOverlay) {
                            beforeId = firstOverlay.id;
                        }
                    }

                    this.map.addLayer({
                        id: 'data-layer',
                        type: 'raster',
                        source: 'data-source',
                        paint: {
                            'raster-opacity': opacity,
                            'raster-fade-duration': 0, // disables style fade-in transition
                            'raster-resampling': 'nearest' // prevents interpolation between classes
                        }
                    }, beforeId);
                } else {
                    this.map.getSource('data-source').setTiles([tileUrl]);
                    this.map.setPaintProperty('data-layer', 'raster-opacity', opacity);
                }
            } catch (e) {
                console.error("Error fetching TileJSON in MapLibre:", e);
            }
        }, 50);
    }

    updateDataLayerOpacity(opacity) {
        if (this.map && this.map.getLayer('data-layer')) {
            this.map.setPaintProperty('data-layer', 'raster-opacity', opacity);
        }
    }

    switchBasemap(key) {
        if (!this.map) return;
        if (this.map.getLayer('basemap-osm-layer')) {
            this.map.setLayoutProperty('basemap-osm-layer', 'visibility', key === 'osm' ? 'visible' : 'none');
        }
        if (this.map.getLayer('basemap-satellite-layer')) {
            this.map.setLayoutProperty('basemap-satellite-layer', 'visibility', key === 'satellite' ? 'visible' : 'none');
        }
        if (this.map.getLayer('basemap-schummerung-layer')) {
            this.map.setLayoutProperty('basemap-schummerung-layer', 'visibility', key === 'schummerung' ? 'visible' : 'none');
        }
    }

    updateBasemapOpacity(opacity) {
        if (!this.map) return;
        if (this.map.getLayer('basemap-osm-layer')) {
            this.map.setPaintProperty('basemap-osm-layer', 'raster-opacity', opacity);
        }
        if (this.map.getLayer('basemap-satellite-layer')) {
            this.map.setPaintProperty('basemap-satellite-layer', 'raster-opacity', opacity);
        }
        if (this.map.getLayer('basemap-schummerung-layer')) {
            this.map.setPaintProperty('basemap-schummerung-layer', 'raster-opacity', opacity);
        }
    }

    toggleOverlay(id, visible) {
        if (!this.map) return;
        const key = id.toLowerCase();
        const sourceId = `overlay-source-${key}`;
        const layerId = `overlay-layer-${key}`;

        if (visible) {
            const def = BASEMAPS[key];
            if (!def) return;

            if (!this.map.getSource(sourceId)) {
                this.map.addSource(sourceId, {
                    type: 'raster',
                    tiles: [def.url],
                    tileSize: 256,
                    attribution: def.options.attribution || '',
                    maxzoom: def.options.maxZoom || 15
                });
            }
            if (!this.map.getLayer(layerId)) {
                this.map.addLayer({
                    id: layerId,
                    type: 'raster',
                    source: sourceId,
                    paint: {
                        'raster-opacity': 1.0
                    }
                }); // added to the very top
            }
        } else {
            if (this.map.getLayer(layerId)) {
                this.map.removeLayer(layerId);
            }
            if (this.map.getSource(sourceId)) {
                this.map.removeSource(sourceId);
            }
        }
    }

    flyTo(lngLat, zoom) {
        if (this.map) {
            this.map.flyTo({ center: lngLat, zoom: zoom - 1, duration: 1200, essential: true });
        }
    }

    getCenter() {
        if (!this.map) return [13.3, 51.0];
        const c = this.map.getCenter();
        return [c.lng, c.lat]; // MapLibre format [lng, lat]
    }

    getZoom() {
        if (!this.map) return 14;
        return this.map.getZoom() + 1;
    }
}

// Expose globally
window.MapLibreEngine = MapLibreEngine;
