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

    init(containerId, center, zoom) {
        return new Promise((resolve) => {
            // center is [lng, lat], Leaflet setView expects [lat, lng]
            const latlng = [center[1], center[0]];

            this.map = L.map(containerId, {
                zoomControl: false
            }).setView(latlng, zoom);

            // Add zoom control top-left
            L.control.zoom({ position: 'topleft' }).addTo(this.map);

            resolve();
        });
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
