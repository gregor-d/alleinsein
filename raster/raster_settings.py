#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

# Core pipeline settings

# Output COG version suffix.
raster_version: str = "v4"
overwrite: bool = True

# Projections & raster properties

target_epsg: str = "EPSG:3035"

resolution: str = "20,20"
nodata: int = 255
data_type: str = "Byte"

# Coarse output resolutions in metres.
coarse_resolutions: tuple[int, ...] = (320, 640, 1280)

# Multi-country pipeline

countries: tuple[str, ...] = (
    "Germany",
    "Switzerland",
    "Austria",
    "Italy",
    "Liechtenstein",
    "Denmark",
    "Andorra",
    "Czech Republic",
    "Monaco",
    "San Marino",
    "Vatican City",
    "Sweden",
    "Poland",
    "Metropolitan France",
    "European Netherlands",
    "Belgium",
    "Luxembourg",
    "Ireland",
    "United Kingdom",
    "Norway",
    "Finland",
    "Spain",
    "Continental Portugal",
    "Slovenia",
    "Estonia",
    "Latvia",
    "Lithuania",
    "Greece",
    "Malta",
    "Cyprus",
    "Croatia",
    "Bosnia and Herzegovina",
    "Serbia",
    "Montenegro",
    "Albania",
    "North Macedonia",
    "Kosovo",
    "Slovakia",
    "Hungary",
    "Romania",
    "Bulgaria",
    "Moldova",
    "Ukraine",
    # missing: "Faroe Islands", "Gibraltar", "Svalbard and Jan Mayen",
    # "Iceland", # island currently is out of bounds
)

# Combined product name for output and dissolved-boundary paths.
output_area: str = "east_eu"
# Country processing buffer in metres; final boundary masking removes it.
bounds_buffer_m: int = 1000
# Buffered bbox snap grid in metres.
bounds_snap_m: int = 100
europe_pbf_name: str = "europe-260628.osm.pbf"

# Directories

script_dir: Path = Path(__file__).resolve().parent
clc_dir: Path = script_dir / "input" / "clc"
bounds_dir: Path = script_dir / "input" / "bounds"
dem_dir: Path = script_dir / "input" / "dem"
osm_dir: Path = script_dir / "input" / "osm"
pre_out_dir: Path = script_dir / "input" / "pre_out"
output_dir: Path = script_dir / "out"
temp_dir: Path = Path("/mnt/c/wsl-tmp")

# output file
area_output_cog: Path = output_dir / f"{output_area}_20m_{raster_version}.tif"

# CLC (land cover) files

clc_source: Path = clc_dir / "U2018_CLC2018_V2020_20u1.tif"
clc_mapping: Path = clc_dir / "custom_classes.txt"
eu_clc_classified: Path = clc_dir / "eu_clc_classes.tif"

# DEM / slope files

dem_slope_source: Path = dem_dir / "eudem_slop_3035_europe.tif"
slope_mapping: Path = dem_dir / "slope_classes.txt"
eu_slope_classes: Path = dem_dir / "eu_slope_classes.tif"


# GDAL environment & output format

# Per-worker GDAL block cache in MiB.
gdal_cachemax: str = "512"
osm_max_tmpfile_size: str = "2048"
cpl_tmpdir: str = "/mnt/c/wsl-tmp"
gdal_num_threads: str = "ALL_CPUS"

gdal_calc_options: list[str] = [
    "TILED=YES",
    "COMPRESS=DEFLATE",
    "BIGTIFF=IF_SAFER",
]
cog_blocksize: int = 512
overwrite_arg: str = "--overwrite" if overwrite else ""
gdal_pipeline_creation_options: str = " ".join(
    ["--of=GTiff", *[f"--co={opt}" for opt in gdal_calc_options]]
)
