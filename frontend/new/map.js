// ─────────────────────────────────────────────
//  MAP.JS — MapLibre map engine implementation
// ─────────────────────────────────────────────

class MapLibreEngine {
    constructor() {
        this.map = null;
        this.debounceTimer = null;
        this.measureActive = false;
        this.measurePoints = [];
        this._measureClick = null;
        this._measureContext = null;
        this._measureLabel = null;
        this._labelAdded = false;
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
                minZoom: CONFIG.minimal_zoom - 1,
                attributionControl: false
            });

            self.map.addControl(
                new maplibregl.NavigationControl({ showCompass: true, showZoom: false }),
                self._navPos
            );
            self.map.addControl(
                new maplibregl.ScaleControl({ maxWidth: 80, unit: 'metric' }),
                'bottom-left'
            );
            self.map.addControl(
                new maplibregl.AttributionControl({ compact: false }),
                'bottom-right'
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
     * Smoothly zooms the map in by one level from the custom zoom control.
     */
    zoomIn() {
        if (this.map) {
            this.map.zoomIn({ duration: 250, essential: true });
        }
    }

    /**
     * Smoothly zooms the map out by one level from the custom zoom control.
     */
    zoomOut() {
        if (this.map) {
            this.map.zoomOut({ duration: 250, essential: true });
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

    // ─── MEASURE DISTANCE ───

    /**
     * Enters distance-measuring mode. Left-click adds a point, right-click removes
     * the last one. The cumulative distance is shown in a label pinned to the most
     * recently added point.
     */
    startMeasure() {
        if (!this.map || !this.map.isStyleLoaded() || this.measureActive) return false;
        this.measureActive = true;
        this.measurePoints = [];

        if (!this.map.getSource('measure-source')) {
            this.map.addSource('measure-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
            this.map.addLayer({
                id: 'measure-line',
                type: 'line',
                source: 'measure-source',
                filter: ['==', '$type', 'LineString'],
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': CONFIG.measure_color,
                    'line-width': 2.5,
                    'line-dasharray': [2, 1.5]
                }
            });
            this.map.addLayer({
                id: 'measure-points',
                type: 'circle',
                source: 'measure-source',
                filter: ['==', '$type', 'Point'],
                paint: {
                    'circle-radius': 5,
                    'circle-color': '#ffffff',
                    'circle-stroke-color': CONFIG.measure_color,
                    'circle-stroke-width': 2.5
                }
            });
        }

        this.map.getCanvas().style.cursor = 'crosshair';

        const self = this;
        this._measureClick = function(e) {
            self.measurePoints.push([e.lngLat.lng, e.lngLat.lat]);
            self._renderMeasure();
        };
        this._measureContext = function(e) {
            e.preventDefault();
            self.measurePoints.pop();
            self._renderMeasure();
        };
        this.map.on('click', this._measureClick);
        this.map.on('contextmenu', this._measureContext);

        this._renderMeasure();
        return true;
    }

    /**
     * Exits measuring mode, removes all drawn points/lines and restores the cursor.
     */
    stopMeasure() {
        if (!this.map) return;
        this.measureActive = false;

        if (this._measureClick)   this.map.off('click', this._measureClick);
        if (this._measureContext) this.map.off('contextmenu', this._measureContext);
        this._measureClick = null;
        this._measureContext = null;

        this.measurePoints = [];
        const src = this.map.getSource('measure-source');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });

        if (this._measureLabel) {
            this._measureLabel.remove();
            this._labelAdded = false;
        }

        this.map.getCanvas().style.cursor = '';
    }

    /**
     * Rebuilds the measure GeoJSON (points + connecting line) and updates the
     * distance label pinned to the last point with the cumulative great-circle distance.
     */
    _renderMeasure() {
        const features = this.measurePoints.map(function(p) {
            return { type: 'Feature', geometry: { type: 'Point', coordinates: p } };
        });
        if (this.measurePoints.length >= 2) {
            features.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: this.measurePoints }
            });
        }

        const src = this.map.getSource('measure-source');
        if (src) src.setData({ type: 'FeatureCollection', features: features });

        this._updateMeasureLabel();
    }

    /**
     * Places (or hides) a small label at the last point showing the total distance.
     */
    _updateMeasureLabel() {
        if (this.measurePoints.length < 2) {
            if (this._measureLabel && this._labelAdded) {
                this._measureLabel.remove();
                this._labelAdded = false;
            }
            return;
        }

        let total = 0;
        for (let i = 1; i < this.measurePoints.length; i++) {
            total += haversineMeters(this.measurePoints[i - 1], this.measurePoints[i]);
        }

        if (!this._measureLabel) {
            const el = document.createElement('div');
            el.className = 'measure-label';
            this._measureLabel = new maplibregl.Marker({ element: el, anchor: 'left', offset: [12, 0] });
        }

        this._measureLabel.getElement().textContent = formatDistance(total);
        this._measureLabel.setLngLat(this.measurePoints[this.measurePoints.length - 1]);
        if (!this._labelAdded) {
            this._measureLabel.addTo(this.map);
            this._labelAdded = true;
        }
    }
}

window.MapLibreEngine = MapLibreEngine;
