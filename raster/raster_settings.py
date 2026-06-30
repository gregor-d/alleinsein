from __future__ import annotations

from pathlib import Path

# ---------------------------------------------------------------------------
# Core pipeline settings
# ---------------------------------------------------------------------------

area: str = "germany"
# Output version (mirrors RASTER_VERSION in raster.conf); names the output COG.
raster_version: str = "4"
overwrite: bool = True
dry_run: bool = False

# ---------------------------------------------------------------------------
# Projections & raster properties
# ---------------------------------------------------------------------------

target_epsg: str = "EPSG:3035"
web_epsg: str = "EPSG:3857"

resolution: str = "20,20"
nodata: int = 255
data_type: str = "Byte"

# ---------------------------------------------------------------------------
# Coarse raster tiers
# ---------------------------------------------------------------------------

# Downsampling resolutions (metres) built by create_coarse_raster.py.
coarse_resolutions: tuple[int, ...] = (320, 640, 1280)

# ---------------------------------------------------------------------------
# Multi-country (EU) pipeline
# ---------------------------------------------------------------------------

# Each country is processed individually on a buffered extent (so the road-smoothing
# kernel sees cross-border roads), kept in TARGET_EPSG, then mosaicked, clipped to
# the dissolved boundary, reprojected and written as one combined COG.
# eu_countries: tuple[str, ...] = ("germany", "switzerland", "austria")
eu_countries: tuple[str, ...] = (
    # Western Europe
    "Germany",
    # "France", "Netherlands", "Belgium", "Luxembourg",
    "Switzerland",
    "Austria",
    "Liechtenstein",
    # Northern Europe
    # "Denmark",
    # "Sweden",
    # "Norway",
    # "Finland",
    #  "Iceland",
    # "Estonia", "Latvia", "Lithuania", "Ireland", "United Kingdom",
    # Southern Europe
    # "Spain",
    # "Portugal",
    # "Italy",
    # "Greece", "Malta", "Cyprus",
    # "Slovenia", "Croatia", "Bosnia and Herzegovina", "Serbia",
    # "Montenegro", "Albania", "North Macedonia", "Kosovo",
    # Eastern Europe
    # "Poland",
    # "Czech Republic",
    # "Slovakia", "Hungary", "Romania",
    # "Bulgaria", "Moldova", "Ukraine", "Belarus",
    # Microstates
    # "Andorra", "Monaco", "San Marino", "Vatican City",
)

# Name of the combined product; drives output COG and dissolved-boundary names.
eu_output_area: str = "dach"
# Cross-border buffer (metres) added to each country's extent; must exceed the
# smoothing kernel footprint. Discarded by the final clip.
eu_bounds_buffer_m: int = 1000
# Snap the buffered bbox to this grid (metres) so every country shares one global
# pixel grid and tiles mosaic seamlessly.
eu_bounds_snap_m: int = 100
# Europe-wide source PBF the one-time extract helper cuts each country out of.
eu_europe_pbf_name: str = "europe-260628.osm.pbf"

# ---------------------------------------------------------------------------
# GDAL environment & output format
# ---------------------------------------------------------------------------

gdal_cachemax: str = "2048"
osm_max_tmpfile_size: str = "2048"
cpl_tmpdir: str = "/tmp"

gdal_calc_options: list[str] = [
    "TILED=YES",
    "COMPRESS=DEFLATE",
    "PREDICTOR=2",
    "BIGTIFF=IF_SAFER",
]
cog_blocksize: int = 512
bbox: str = ""  # set at runtime from bounds_gpkg by the pipeline coordinator
overwrite_arg: str = "--overwrite" if overwrite else ""
gdal_pipeline_creation_options: str = " ".join(
    ["--of=GTiff", *[f"--co={opt}" for opt in gdal_calc_options]]
)

# ---------------------------------------------------------------------------
# Directories
# ---------------------------------------------------------------------------

script_dir: Path = Path(__file__).resolve().parent
clc_dir: Path = script_dir / "input" / "clc"
bounds_dir: Path = script_dir / "input" / "bounds"
dem_dir: Path = script_dir / "input" / "dem"
osm_dir: Path = script_dir / "input" / "osm"
transformed_dir: Path = script_dir / "input" / "transformed"
output_dir: Path = script_dir / "out"
temp_dir: Path = output_dir / "temp"

# ---------------------------------------------------------------------------
# OSM / roads files
# ---------------------------------------------------------------------------

osm_latest: Path = osm_dir / f"{area}-latest.osm.pbf"
osm_filtered: Path = osm_dir / f"{area}-filtered.osm.pbf"
roads_gpkg: Path = osm_dir / f"{area}_roads.gpkg"
roads_rasterized: Path = osm_dir / f"{area}_roads_rasterized.tif"
roads_smooth: Path = osm_dir / f"{area}_roads_smooth.tif"

# ---------------------------------------------------------------------------
# CLC (land cover) files
# ---------------------------------------------------------------------------

clc_source: Path = clc_dir / "U2018_CLC2018_V2020_20u1.tif"
clc_mapping: Path = clc_dir / "custom_classes.txt"
clc_classified: Path = clc_dir / f"{area}_clc_classes.tif"
clc_stack: Path = clc_dir / f"{area}_clc_classes_stack.tif"

# ---------------------------------------------------------------------------
# DEM / slope files
# ---------------------------------------------------------------------------

dem_slope_source: Path = dem_dir / "eudem_slop_3035_europe.tif"
slope_mapping: Path = dem_dir / "slope_classes.txt"
slope_classes: Path = dem_dir / f"{area}_slope_classes.tif"

# ---------------------------------------------------------------------------
# Bounds & output files
# ---------------------------------------------------------------------------

bounds_gpkg: Path = bounds_dir / f"{area}.gpkg"
raw_calc: Path = temp_dir / f"{area}_raw_v{raster_version}.tif"
slope_mod: Path = temp_dir / f"{area}_slope_mod_v{raster_version}.tif"
output_cog: Path = output_dir / f"{area}_20m_v{raster_version}.tif"
eu_output_cog: Path = output_dir / f"{eu_output_area}_20m_v{raster_version}.tif"
