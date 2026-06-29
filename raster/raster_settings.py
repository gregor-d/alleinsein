from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

script_dir: Path = Path(__file__).resolve().parent
osm_dir: Path = script_dir / "input" / "osm"


@dataclass(frozen=True)
class Settings:
    data_type: str = "Byte"
    roads_rasterized: Path = osm_dir / "germany_roads_rasterized.tif"


settings = Settings()


area: str = "germany"
# Output version (mirrors RASTER_VERSION in raster.conf); names the slope COG tier.
raster_version: str = "3"
overwrite: bool = True
dry_run: bool = False

target_epsg: str = "EPSG:3035"
web_epsg: str = "EPSG:3857"

resolution: str = "20,20"
nodata: int = 255
data_type: str = "Byte"

# Coarse-raster downsampling tiers (metres), built by create_coarse_raster.py.
coarse_resolutions: tuple[int, ...] = (320, 640, 1280)

# Multi-country mosaic pipeline (raster/eu/create_eu_raster.py). Each country is
# processed individually on its own buffered extent (so the road-smoothing kernel
# sees cross-border roads), kept in TARGET_EPSG, then mosaicked, clipped to the
# dissolved boundary, reprojected and written as one combined COG.
eu_countries: tuple[str, ...] = ("germany", "switzerland", "austria")
# Name of the combined product; drives the output COG and dissolved-boundary names
# (out/<eu_output_area>_20m_v<N>.tif, input/bounds/<eu_output_area>.gpkg).
eu_output_area: str = "dach"
# Cross-border buffer (metres, TARGET_EPSG) added to each country's processing
# extent; must exceed the smoothing kernel footprint. Discarded by the final clip.
eu_bounds_buffer_m: int = 1000
# Snap the buffered bbox to this grid (metres) so every country shares one global
# pixel grid and the tiles mosaic seamlessly.
eu_bounds_snap_m: int = 100
# Europe-wide source PBF the one-time extract helper cuts each country out of.
eu_europe_pbf_name: str = "europe-latest.osm.pbf"

gdal_cachemax: str = "2048"
osm_max_tmpfile_size: str = "2048"
cpl_tmpdir: str = "/tmp"

minx: int = 4031300
miny: int = 2684000
maxx: int = 4672600
maxy: int = 3556600

gtiff_creation_options: list[str] = [
    "TILED=YES",
    "COMPRESS=DEFLATE",
    "PREDICTOR=2",
    "BIGTIFF=IF_SAFER",
]
cog_blocksize: int = 512


clc_dir: Path = script_dir / "input" / "clc"
bounds_dir: Path = script_dir / "input" / "bounds"
dem_dir: Path = script_dir / "input" / "dem"
transformed_dir: Path = script_dir / "input" / "transformed"
output_dir: Path = script_dir / "out"
temp_dir: Path = output_dir / "temp"

osm_latest: Path = osm_dir / f"{area}-latest.osm.pbf"
osm_filtered: Path = osm_dir / f"{area}-filtered.osmp.pbf"
roads_gpkg: Path = osm_dir / f"{area}_roadsp.gpkg"
roads_rasterized: Path = osm_dir / f"{area}_roads_rasterized.tif"
roads_smooth: Path = osm_dir / f"{area}_roads_smoothp.tif"

clc_source: Path = clc_dir / "U2018_CLC2018_V2020_20u1.tif"
clc_mapping: Path = clc_dir / "custom_classes.txt"
clc_classified: Path = clc_dir / f"{area}_clc_classesp.tif"
clc_stack: Path = clc_dir / f"{area}_clc_classes_stackp.tif"

# Slope: EPSG:3035 DEM input + reclassify mapping, and the slope-class raster
# (1..4) on the shared 20m grid produced from them.
dem_slope_source: Path = dem_dir / "eudem_slop_3035_europe.tif"
slope_mapping: Path = dem_dir / "slope_classes.txt"
slope_classes: Path = dem_dir / f"{area}_slope_classes.tif"
bounds_gpkg: Path = bounds_dir / f"{area}.gpkg"
output_cog: Path = output_dir / f"{area}_20m_v3_2band.tif"
raw_calc: Path = temp_dir / f"{area}_raster_rawp136.tif"
reprojected: Path = temp_dir / f"{output_cog.stem}_3857p136.tif"

# Slope-modified aloneness band (band 2 of the final COG: the whole aloneness band
# re-scored by slope class) and the 2-band stack that combines it with the raw
# heatmap (band 1) before web-COG finalization.
slope_mod_modified: Path = temp_dir / f"{area}_20m_v{raster_version}_slope_modified.tif"
raster_stack: Path = temp_dir / f"{area}_raster_stackp136.tif"

bbox: str = f"{minx},{miny},{maxx},{maxy}"
overwrite_arg: str = "--overwrite" if overwrite else ""
gtiff: str = " ".join(
    ["--of=GTiff", *[f"--co={opt}" for opt in gtiff_creation_options]]
)
