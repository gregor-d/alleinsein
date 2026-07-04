#!/usr/bin/env python3
# pyright: reportMissingImports=false
"""DEM slope classification and slope-penalty band steps."""

from __future__ import annotations

import argparse
from pathlib import Path

from osgeo import gdal
from osgeo_utils.gdal_calc import Calc

from raster import raster_settings as settings
from raster.utils.gdal_common import (
    configure_gdal,
    downsample_classified,
    make_pipeline,
)
from raster.utils.helpers import banner


def _create_slope_classes(
    *,
    dem_slope_source: Path,
    slope_mapping: Path,
    output: Path,
    bbox: str | None = None,
) -> None:
    """Create slope-class rasters from a DEM slope source.

    Args:
        dem_slope_source: Source DEM slope raster.
        slope_mapping: GDAL reclassify mapping file.
        output: Output slope-class raster.
        bbox: Optional EPSG:3035 bbox. Full-extent runs also build coarse tiers.

    Raises:
        FileNotFoundError: If the source raster or mapping file is missing.
    """
    banner("Create slope classes raster")
    if not dem_slope_source.is_file():
        raise FileNotFoundError(f"Missing DEM slope input raster: {dem_slope_source}")
    if not slope_mapping.is_file():
        raise FileNotFoundError(f"Missing slope mapping file: {slope_mapping}")

    bbox_args = f" --bbox={bbox} --bbox-crs={settings.target_epsg}" if bbox else ""
    pipeline = make_pipeline(
        f"""
        ! read {dem_slope_source.as_posix()}
        ! reproject -d {settings.target_epsg}{bbox_args} --resolution={settings.resolution} -r nearest
        ! reclassify --mapping=@{slope_mapping.as_posix()} --ot={settings.data_type}
        ! edit --nodata={settings.nodata}
        ! write {settings.gdal_pipeline_creation_options} {settings.overwrite_arg} {output.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    result = gdal.Run("raster pipeline", pipeline=pipeline)
    if hasattr(result, "Finalize"):
        result.Finalize()

    if bbox is None:
        for resolution in settings.coarse_resolutions:
            coarse_slope = settings.dem_dir / f"eu_{resolution}m_slope_classes.tif"
            downsample_classified(
                source=output, resolution=resolution, output=coarse_slope
            )


# Road-score penalty by slope class; unknown classes subtract zero.
SLOPE_PENALTY = {1: 0, 2: 2, 3: 3, 4: 4}


def calculate_slope_mod_band(
    *, raw_calc: Path, slope_classes: Path, slope_mod: Path
) -> None:
    """Apply slope penalties to an encoded aloneness raster.

    Args:
        raw_calc: Encoded raw aloneness raster.
        slope_classes: Slope-class raster aligned to ``raw_calc``.
        slope_mod: Output slope-modified raster.

    Raises:
        FileNotFoundError: If an input raster is missing.
    """
    banner("Calculate slope-modified band")
    if not raw_calc.is_file():
        raise FileNotFoundError(
            f"Missing raw heatmap raster: {raw_calc} (run the heatmap step first)"
        )
    if not slope_classes.is_file():
        raise FileNotFoundError(
            f"Missing slope classes raster: {slope_classes} "
            "(run _create_slope_classes first)"
        )

    slope_penalty = (
        f"where(G==1, {SLOPE_PENALTY[1]}, "
        f"where(G==2, {SLOPE_PENALTY[2]}, "
        f"where(G==3, {SLOPE_PENALTY[3]}, "
        f"where(G==4, {SLOPE_PENALTY[4]}, 0))))"
    )
    calc = (
        "where((P>=1)*(P<=40), "
        "((1.0*P-1)//10)*10 + where((1.0*P-1)%10+1 >= 10, 10, "
        f"maximum((1.0*P-1)%10+1 - ({slope_penalty}), 1)), 1.0*P)"
    )
    print(f"gdal_calc.Calc -> {slope_mod}")
    Calc(
        calc=calc,
        outfile=str(slope_mod),
        type=settings.data_type,
        NoDataValue=settings.nodata,
        creation_options=list(settings.gdal_calc_options),
        overwrite=settings.overwrite,
        quiet=False,
        P=str(raw_calc),
        P_band=1,
        G=str(slope_classes),
        G_band=1,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="DEM / slope stage. All paths come from raster_settings."
    )
    parser.add_argument(
        "command",
        choices=("classify",),
        nargs="?",
        default="classify",
        help="DEM slope -> full area-wide slope classes (one-time build)",
    )

    args = parser.parse_args()

    for directory in (settings.dem_dir, settings.temp_dir):
        directory.mkdir(parents=True, exist_ok=True)
    configure_gdal()

    if args.command == "classify":
        _create_slope_classes(
            dem_slope_source=settings.dem_slope_source,
            slope_mapping=settings.slope_mapping,
            output=settings.eu_slope_classes,
        )


if __name__ == "__main__":
    main()
