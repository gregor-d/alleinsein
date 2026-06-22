// ─────────────────────────────────────────────
//  MAP.JS — MapLibre map engine implementation
// ─────────────────────────────────────────────

class MapLibreEngine {
    constructor() {
        this.map = null;
        this.debounceTimer = null;
    }

    /**
     * Initialises MapLibre GL with pre-defined basemap sources and layers (all hidden),
     * adds navigation, attribution and scale controls, and loads the Germany mask GeoJSON.
     * Returns a Promise that resolves once the map style has loaded.
     */
    init(containerId, center, zoom, navPos = 'top-left') {
        const self = this;
        this._navPos = navPos;

        return new Promise(function(resolve) {
            self.map = new maplibregl.Map({
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
                            layout: { visibility: 'none' },
                            paint: { 'raster-opacity': 1.0 }
                        },
                        {
                            id: 'basemap-satellite-layer',
                            type: 'raster',
                            source: 'basemap-satellite',
                            layout: { visibility: 'none' },
                            paint: { 'raster-opacity': 1.0 }
                        },
                        {
                            id: 'basemap-schummerung-layer',
                            type: 'raster',
                            source: 'basemap-schummerung',
                            layout: { visibility: 'none' },
                            paint: { 'raster-opacity': 1.0 }
                        }
                    ]
                },
                center: center,
                zoom: zoom - 1,
                minZoom: CONFIG.minimal_zoom - 1
            });

            self.map.addControl(
                new maplibregl.NavigationControl({ showCompass: true }),
                self._navPos
            );
            self.map.addControl(
                new maplibregl.ScaleControl({ maxWidth: 80, unit: 'metric' }),
                'bottom-left'
            );

            self.map.on('load', function() {
                fetch('germany-mask.geojson')
                    .then(function(res) { return res.json(); })
                    .then(function(data) {
                        if (!self.map) return;
                        self.map.addSource('germany-mask-source', { type: 'geojson', data: data });
                        self.map.addLayer({
                            id: 'germany-mask-layer',
                            type: 'fill',
                            source: 'germany-mask-source',
                            paint: {
                                'fill-color': CONFIG.mask_color,
                                'fill-opacity': CONFIG.mask_opacity
                            }
                        }, self.map.getLayer('data-layer') ? 'data-layer' : undefined);
                    })
                    .catch(function(err) { console.error('Error loading MapLibre mask:', err); });

                resolve();
            });
        });
    }

    /**
     * Cancels any pending debounce timer and removes the MapLibre map instance.
     */
    destroy() {
        clearTimeout(this.debounceTimer);
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
    }

    /**
     * Debounces and applies a colormap update to the raster data source.
     * Creates the source and layer on the first call; updates the tile URL on subsequent calls.
     * Removes the layer entirely when the colormap is empty.
     */
    updateDataLayer(colormapJson, opacity) {
        if (!this.map || !this.map.isStyleLoaded()) return;

        clearTimeout(this.debounceTimer);

        if (colormapJson === '{}') {
            if (this.map.getLayer('data-layer'))   this.map.removeLayer('data-layer');
            if (this.map.getSource('data-source')) this.map.removeSource('data-source');
            return;
        }

        const self = this;
        this.debounceTimer = setTimeout(async function() {
            TILE_JSON_URL.searchParams.set('raster', CONFIG.raster_name);
            TILE_JSON_URL.searchParams.set('colormap', colormapJson);

            try {
                const res = await fetch(TILE_JSON_URL.toString());
                const tj = await res.json();

                if (!tj.tiles || tj.tiles.length === 0) return;

                if (!boundsSet && tj.bounds) {
                    const [west, south, east, north] = tj.bounds;
                    self.map.fitBounds([[west, south], [east, north]], { padding: 20 });
                    boundsSet = true;
                }

                const tileUrl = tj.tiles[0];

                if (!self.map.getSource('data-source')) {
                    self.map.addSource('data-source', {
                        type: 'raster',
                        tiles: [tileUrl],
                        tileSize: CONFIG.tile_size,
                        minzoom: tj.minzoom,
                        maxzoom: tj.maxzoom || 12
                    });

                    let beforeId;
                    const layers = self.map.getStyle().layers;
                    if (layers) {
                        const firstOverlay = layers.find(function(l) {
                            return l.id.startsWith('overlay-layer-');
                        });
                        if (firstOverlay) beforeId = firstOverlay.id;
                    }

                    self.map.addLayer({
                        id: 'data-layer',
                        type: 'raster',
                        source: 'data-source',
                        paint: {
                            'raster-opacity': opacity,
                            'raster-fade-duration': 0,
                            'raster-resampling': 'nearest'
                        }
                    }, beforeId);
                } else {
                    self.map.getSource('data-source').setTiles([tileUrl]);
                    self.map.setPaintProperty('data-layer', 'raster-opacity', opacity);
                }
            } catch (e) {
                console.error('Error fetching TileJSON in MapLibre:', e);
            }
        }, 50);
    }

    /**
     * Updates the raster-opacity of the data layer without re-fetching tiles.
     */
    updateDataLayerOpacity(opacity) {
        if (this.map && this.map.getLayer('data-layer')) {
            this.map.setPaintProperty('data-layer', 'raster-opacity', opacity);
        }
    }

    /**
     * Shows the basemap layer identified by key and hides all others.
     * Pass 'none' to hide every basemap layer.
     */
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

    /**
     * Sets the raster-opacity of all basemap layers simultaneously.
     */
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

    /**
     * Adds or removes a named overlay raster source and layer (e.g. 'hiking', 'cycling').
     */
    toggleOverlay(id, visible) {
        if (!this.map) return;
        const key      = id.toLowerCase();
        const sourceId = `overlay-source-${key}`;
        const layerId  = `overlay-layer-${key}`;

        if (visible) {
            const def = BASEMAPS[key];
            if (!def) return;
            if (!this.map.getSource(sourceId)) {
                this.map.addSource(sourceId, {
                    type: 'raster',
                    tiles: [def.url],
                    tileSize: CONFIG.tile_size,
                    attribution: def.options.attribution || '',
                    maxzoom: def.options.maxZoom || 15
                });
            }
            if (!this.map.getLayer(layerId)) {
                this.map.addLayer({
                    id: layerId,
                    type: 'raster',
                    source: sourceId,
                    paint: { 'raster-opacity': 1.0 }
                });
            }
        } else {
            if (this.map.getLayer(layerId))   this.map.removeLayer(layerId);
            if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
        }
    }

    /**
     * Smoothly flies the map to the given [lng, lat] coordinate at the specified zoom level.
     */
    flyTo(lngLat, zoom) {
        if (this.map) {
            this.map.flyTo({ center: lngLat, zoom: zoom - 1, duration: 1200, essential: true });
        }
    }

    /**
     * Returns the current map center as [lng, lat].
     */
    getCenter() {
        if (!this.map) return DEFAULT_CENTER;
        const c = this.map.getCenter();
        return [c.lng, c.lat];
    }

    /**
     * Returns the current zoom level, adjusted for the 512-tile-size zoom offset.
     */
    getZoom() {
        if (!this.map) return DEFAULT_ZOOM;
        return this.map.getZoom() + 1;
    }
}

window.MapLibreEngine = MapLibreEngine;
