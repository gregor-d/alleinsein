## v2.3.0 (2026-06-27)

### Feat

- update colormap presets and adjust hotspot color
- add logging configuration and rotation for tiler service.  include Docker log rotation instructions in VPS setup

### Refactor

- remove color-ramp and show distincnt colors and remove reverse functionality in colormap

## v2.2.1 (2026-06-25)

### Refactor

- **ui**: rework settings panel, color sheet, and mobile controls

## v2.2.0 (2026-06-24)

### Feat

- add LinkedIn and GitHub links to header and panel footer

## v2.1.0 (2026-06-24)

### Feat

- add data-layer raster source mode default config tiering

## v2.0.0 (2026-06-24)

### Feat

- implement raster source switch for data layers
- set default raster override to germany_raster_v3.tif for backwards compatibility
- add script for generating coarse overview rasters with COG output
- add support for raster tier 9 in settings and tests
- enhance Docker setup with environment file support and improved smoke tests
- implement raster tier selection and configuration in backend and frontend
- hotspot mode shows the two largest values

### Refactor

- remove raster_file_z9 from environment settings and tests

## v1.2.0 (2026-06-23)

### Feat

- enhance location search results with a header and close button
- implement location search functionality with results display
- enable changelog generation on version bump

## v1.1.0 (2026-06-23)

### Feat

- enable changelog generation on version bump

## v1.0.0 (2026-06-23)

### BREAKING CHANGE

- Hotspot-Mode color mode changes color gradient handling

## v0.10.1 (2026-06-23)

### Fix

- implement request sequencing to handle stale TileJSON responses
- adjust minimal zoom level and default map view settings

### Refactor

- update colormap presets
- enhance location prompt UI and styling for better user experience

## v0.10.0 (2026-06-23)

### Feat

- update color tokens and enhance button styles for improved UI
- add subcards
- reorder map controls and enhance styles for better visibility
- update map controls and adjust styles for better layout
- add margin-bottom to html and body styles
- add measure
- new web app

### Refactor

- improve test structure and assertions for health endpoints
- delete static-frontend make new-ui the default
- remove all old frontend code
- remove Leaflet references and consolidate map controls in the bottom left
- update minimal zoom level and default zoom value for consistency
- adjust layer tab icon size and enhance visibility for active layer blocks
- remove dropdown closing logic and adjust mini panel positioning for improved layout
- remove unused sheet handle and adjust settings panel width for improved layout
- remove mobile drawer and update settings panel for improved layout
- remove unused color tokens and adjust styles for improved consistency

## v0.9.0 (2026-06-17)

### Feat

- implement location prompt for user geolocation

## v0.8.1 (2026-06-17)

### Fix

- update raster name to v3 and adjust smoke test scripts

## v0.8.0 (2026-06-17)

### Feat

- add frontend smoke tests and update lint scripts

### Fix

- update error message for invalid environment and remove skipped test
- adjust basemap opacity from 1.0 to 0.7 for improved visibility
- update domain references in architecture documentation
- add missing output message and correct write options in raster pipeline
- update links to reflect the correct domain for alleinsein

## v0.7.0 (2026-06-16)

### Feat

- add introductory description to settings drawer and style adjustments

### Fix

- update README to clarify project description and correct raster pipeline stages

## v0.6.0 (2026-06-16)

### Feat

- update raster processing scripts and improve GDAL configurations for OSM handling
- add CLC raster creation script with GDAL processing pipeline
- refactor raster processing scripts and add new utilities for OSM data handling
- update raster pipeline scripts and add new rasterization utility for OSM roads

### Fix

- update raster creation documentation to reflect changes in script names and pipeline stages
- optimize GDAL environment variables for memory usage in OSM processing
- update tile size to 512 and adjust related configurations in map rendering
- update CLC classes path and streamline required variables in load_raster_config.sh

### Refactor

- update raster scripts to use centralized input directory and add error handling for missing files

## v0.5.0 (2026-06-16)

### Feat

- update Cloudflare setup documentation for static frontend deployment
- add PC and mobile layout images to README

### Fix

- standardize OVERWRITE usage across raster scripts

## v0.4.0 (2026-06-16)

### Feat

- update default basemap and map engine to 'osm' and 'maplibre'
- update documentation for scripts and raster creation pipeline
- add docu

## v0.3.0 (2026-06-16)

### Feat

- add test for browsing simulation and improve raster performance tests
- refactor raster creation scripts and remove unused test and utility scripts
- add create_germany_mask script for generating GeoJSON mask of Germany
- refactor tile size configuration to use centralized CONFIG value
- update docker-compose.yaml to enable GDAL environment variables and adjust uvicorn command parameters
- refactor raster processing scripts to use centralized configuration and improve readability
- update environment variable configuration to load from .env file

## v0.2.0 (2026-06-15)

### Feat

- add pre-commit hooks configuration and update setup script
- update font sizes and remove unnecessary styles for improved readability
- update CSS variables and improve layout styling for better responsiveness
- enhance buildGradient function to support single color gradients and improved color stop handling
- add hotspot pulse animation to active layer cards for enhanced visibility
- update colormap presets and layer state for improved visualization
- add hotspot chip functionality with toggle and UI updates
- enhance layer strip card with eye icon toggle and improved layout
- add pulsing animation to active layer strip card
- implement map engine abstraction for Leaflet and MapLibre with unified data layer handling
- add shared UI logic, styling, and base HTML structure for map interface
- enhance search functionality and UI components in the drawer
- add example screenshots to frontend UI
- add Docker Compose configuration and smoke test script
- combine shared config
- add 'None' basemap option and improve layer header controls
- enhance data layer opacity control and streamline colormap handling
- add bounds fitting for raster layer on initial load

### Fix

- update map footer controls positioning and add settings button
- enable compass in MapLibre navigation control and remove attribution control
- make main drawer scrollable
- correct local server URL in CONFIG for development
- update CONFIG to use local server during development
- update create_raster.sh for improved output paths and GDAL processing
- rename service from alleinsein to tiler in docker-compose.yaml
- enhance Docker command for proxy headers to fix http forward when it should forward https
- update .gitignore to allow test raster file and add test raster data
- update raster path configuration and adjust environment file settings
- add Dockerfile for setting up the application environment
- update setup script to install python3-gdal and ensure GDAL is available
- remove obsolete Docker configuration files
- update raster endpoint paths in test cases to remove API prefix
- refactor Leaflet map engine and remove obsolete Leaflet-specific code
- refactor data layer update logic and improve panel styling
- implement updateDataLayerOpacity method for Leaflet and MapLibre engines
- add tilejson method registration in CustomTiler for production environment
- update CORS settings
- update fqdn to use HTTPS for production environment
- update fqdn for production environment
- update cloudflare wrangler jsonc
- zoom between maplibre and leaflet was different
- unify boundsSet handling across Leaflet and MapLibre engines
- add titiler exception handlers to FastAPI app

### Refactor

- update styles for drawer and scrollbar behavior
- rename L4 elements to settings for consistency
- js files
- rename basemap classes to control classes for consistency
- rename basemap-btn to control-btn for consistency
- clean up repo
- update configuration for tile JSON and raster source handling
