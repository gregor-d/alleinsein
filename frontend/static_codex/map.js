function getLeafletControlPosition(layout) {
    if (layout === 'layout-1') return 'bottomright';
    if (layout === 'layout-3') return 'bottomleft';
    return 'topleft';
}

function getMapLibreControlPosition(layout) {
    if (layout === 'layout-1') return 'bottom-right';
    if (layout === 'layout-3') return 'bottom-left';
    return 'top-left';
}

function getMarkerColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5e81ac';
}

class LeafletEngine {
    constructor() {
        this.map = null;
        this.basemapLayer = null;
        this.dataLayer = null;
        this.boundsSet = false;
        this.zoomControl = null;
        this.pointMarker = null;
    }

    init(containerId, center, zoom, layout) {
        return new Promise(resolve => {
            const latlng = [center[1], center[0]];

            this.map = L.map(containerId, {
                zoomControl: false
            }).setView(latlng, zoom);

            this.setControlLayout(layout);
            resolve();
        });
    }

    setControlLayout(layout) {
        if (!this.map) return;
        if (this.zoomControl) {
            this.map.removeControl(this.zoomControl);
        }
        this.zoomControl = L.control.zoom({
            position: getLeafletControlPosition(layout)
        }).addTo(this.map);
    }

    destroy() {
        if (this.pointMarker) {
            this.map.removeLayer(this.pointMarker);
            this.pointMarker = null;
        }
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        this.basemapLayer = null;
        this.dataLayer = null;
        this.zoomControl = null;
    }

    async updateDataLayer(colormapJson, opacity) {
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

            if (!window.boundsSet && tj.bounds) {
                const [west, south, east, north] = tj.bounds;
                this.map.fitBounds([[south, west], [north, east]]);
                window.boundsSet = true;
            }

            const tileUrl = tj.tiles[0];

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
                    opacity
                }).addTo(this.map);
            } else {
                this.dataLayer.setUrl(tileUrl);
                this.dataLayer.setOpacity(opacity);
            }
        } catch (e) {
            console.error('Error fetching TileJSON in Leaflet:', e);
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

    focusPoint(lng, lat, zoom = 13, label = '') {
        if (!this.map) return;
        this.map.setView([lat, lng], zoom);

        if (this.pointMarker) {
            this.map.removeLayer(this.pointMarker);
        }

        this.pointMarker = L.marker([lat, lng]).addTo(this.map);
        if (label) {
            this.pointMarker.bindPopup(label).openPopup();
        }
    }

    getCenter() {
        if (!this.map) return [13.3, 51.0];
        const c = this.map.getCenter();
        return [c.lng, c.lat];
    }

    getZoom() {
        if (!this.map) return 10;
        return this.map.getZoom();
    }
}

window.LeafletEngine = LeafletEngine;

class MapLibreEngine {
    constructor() {
        this.map = null;
        this.boundsSet = false;
        this.debounceTimer = null;
        this.navControl = null;
        this.pointMarker = null;
    }

    init(containerId, center, zoom, layout) {
        return new Promise(resolve => {
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
                center,
                zoom: zoom - 1,
                attributionControl: false
            });

            this.setControlLayout(layout);

            this.map.addControl(new maplibregl.AttributionControl({
                compact: false
            }), 'bottom-right');

            this.map.on('load', () => {
                resolve();
            });
        });
    }

    setControlLayout(layout) {
        if (!this.map) return;
        if (this.navControl) {
            this.map.removeControl(this.navControl);
        }
        this.navControl = new maplibregl.NavigationControl({
            showCompass: false
        });
        this.map.addControl(this.navControl, getMapLibreControlPosition(layout));
    }

    destroy() {
        clearTimeout(this.debounceTimer);
        if (this.pointMarker) {
            this.pointMarker.remove();
            this.pointMarker = null;
        }
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        this.navControl = null;
    }

    updateDataLayer(colormapJson, opacity) {
        if (!this.map || !this.map.isStyleLoaded()) return;

        clearTimeout(this.debounceTimer);

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

                if (!window.boundsSet && tj.bounds) {
                    const [west, south, east, north] = tj.bounds;
                    this.map.fitBounds([[west, south], [east, north]], { padding: 20 });
                    window.boundsSet = true;
                }

                const tileUrl = tj.tiles[0];

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
                            'raster-fade-duration': 0,
                            'raster-resampling': 'nearest'
                        }
                    });
                } else {
                    this.map.getSource('data-source').setTiles([tileUrl]);
                    this.map.setPaintProperty('data-layer', 'raster-opacity', opacity);
                }
            } catch (e) {
                console.error('Error fetching TileJSON in MapLibre:', e);
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

    focusPoint(lng, lat, zoom = 13, label = '') {
        if (!this.map) return;
        this.map.flyTo({
            center: [lng, lat],
            zoom,
            essential: true
        });

        if (this.pointMarker) {
            this.pointMarker.remove();
        }

        const marker = new maplibregl.Marker({ color: getMarkerColor() }).setLngLat([lng, lat]);
        if (label) {
            marker.setPopup(new maplibregl.Popup({ offset: 16 }).setText(label));
        }
        marker.addTo(this.map);
        if (label) marker.togglePopup();
        this.pointMarker = marker;
    }

    getCenter() {
        if (!this.map) return [13.3, 51.0];
        const c = this.map.getCenter();
        return [c.lng, c.lat];
    }

    getZoom() {
        if (!this.map) return 14;
        return this.map.getZoom() + 1;
    }
}

window.MapLibreEngine = MapLibreEngine;
