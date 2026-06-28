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
overwrite: bool = True
dry_run: bool = False

target_epsg: str = "EPSG:3035"
web_epsg: str = "EPSG:3857"

resolution: str = "20,20"
nodata: int = 255
data_type: str = "Byte"

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
transformed_dir: Path = script_dir / "input" / "transformed"
output_dir: Path = script_dir / "out"
temp_dir: Path = output_dir / "temp"

osm_latest: Path = osm_dir / f"{area}-latest.osm.pbf"
osm_filtered: Path = osm_dir / f"{area}-filtered.osmp.pbf"
roads_gpkg: Path = osm_dir / f"{area}_roadsp.gpkg"
roads_rasterized: Path = osm_dir / f"{area}_roads_rasterized.tif"
roads_smooth_base: Path = osm_dir / f"{area}_roads_smooth_basep.tif"
roads_smooth: Path = osm_dir / f"{area}_roads_smoothp.tif"

clc_source: Path = clc_dir / "U2018_CLC2018_V2020_20u1.tif"
clc_mapping: Path = clc_dir / "custom_classes.txt"
clc_classified: Path = clc_dir / f"{area}_clc_classesp.tif"
clc_stack: Path = clc_dir / f"{area}_clc_classes_stackp.tif"

slope_classes: Path = transformed_dir / f"{area}_slope_classes.tif"
bounds_gpkg: Path = bounds_dir / f"{area}.gpkg"
output_cog: Path = output_dir / f"{area}_20m_v3_2band.tif"
raw_calc: Path = temp_dir / f"{area}_raster_rawp136.tif"
reprojected: Path = temp_dir / f"{output_cog.stem}_3857p136.tif"

bbox: str = f"{minx},{miny},{maxx},{maxy}"
overwrite_arg: str = "--overwrite" if overwrite else ""
gtiff: str = " ".join(
    ["--of=GTiff", *[f"--co={opt}" for opt in gtiff_creation_options]]
)
