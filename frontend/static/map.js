// ─────────────────────────────────────────────
//  LEAFLET_MAP.JS — Leaflet-specific map engine
// ─────────────────────────────────────────────

class LeafletEngine {
    constructor() {
        this.map = null;
        this.basemapLayer = null;
        this.dataLayer = null;
        this.boundsSet = false;
    }

    init(containerId, center, zoom, zoomPos = 'topleft') {
        return new Promise((resolve) => {
            // center is [lng, lat], Leaflet setView expects [lat, lng]
            const latlng = [center[1], center[0]];

            this.map = L.map(containerId, {
                zoomControl: false
            }).setView(latlng, zoom);

            resolve();
        });
    }

    zoomIn() {
        if (this.map) this.map.zoomIn();
    }

    zoomOut() {
        if (this.map) this.map.zoomOut();
    }

    flyTo(lngLat, zoom) {
        if (this.map) {
            this.map.flyTo([lngLat[1], lngLat[0]], zoom, { duration: 1.2 });
        }
    }

    destroy() {
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        this.basemapLayer = null;
        this.dataLayer = null;
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
            this.basemapLayer = L.tileLayer(def.url, def.options).addTo(this.map);
            this.basemapLayer.setOpacity(basemapOpacity);

            // Re-add data layer on top
            if (this.dataLayer) {
                this.dataLayer.bringToFront();
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
            this.map = new maplibregl.Map({
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
                        }
                    ]
                },
                center: center, // MapLibre center format is [lng, lat]
                zoom: zoom - 1,
                attributionControl: false
            });

            // Add attribution control bottom-right
            this.map.addControl(new maplibregl.AttributionControl({
                compact: false
            }), 'bottom-right');

            this.map.on('load', () => {
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
                    this.map.addLayer({
                        id: 'data-layer',
                        type: 'raster',
                        source: 'data-source',
                        paint: {
                            'raster-opacity': opacity,
                            'raster-fade-duration': 0, // disables style fade-in transition
                            'raster-resampling': 'nearest' // prevents interpolation between classes
                        }
                    });
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
    }

    updateBasemapOpacity(opacity) {
        if (!this.map) return;
        if (this.map.getLayer('basemap-osm-layer')) {
            this.map.setPaintProperty('basemap-osm-layer', 'raster-opacity', opacity);
        }
        if (this.map.getLayer('basemap-satellite-layer')) {
            this.map.setPaintProperty('basemap-satellite-layer', 'raster-opacity', opacity);
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

    zoomIn() {
        if (this.map) this.map.zoomIn();
    }

    zoomOut() {
        if (this.map) this.map.zoomOut();
    }
}

// Expose globally
window.MapLibreEngine = MapLibreEngine;
