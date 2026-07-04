#!/usr/bin/env python3
# pyright: reportMissingImports=false
"""CLC classification and one-hot stack steps."""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from osgeo import gdal

from raster import raster_settings as settings
from raster.utils.gdal_common import (
    configure_gdal,
    downsample_classified,
    make_pipeline,
)
from raster.utils.helpers import banner

CLASS_CODES = (1, 2, 3, 4, 5)


def _create_source_clc_classified(*, clc_source: Path, clc_mapping: Path) -> None:
    """Create area-wide classified CLC rasters and coarse one-hot stacks.

    Args:
        clc_source: Source CLC raster.
        clc_mapping: GDAL reclassify mapping file.

    Raises:
        FileNotFoundError: If the source raster or mapping file is missing.
    """
    banner("Create area-wide coarse CLC one-hot stacks")
    if not clc_source.is_file():
        raise FileNotFoundError(f"Missing CLC input raster: {clc_source}")
    if not clc_mapping.is_file():
        raise FileNotFoundError(f"Missing CLC mapping file: {clc_mapping}")

    classified = settings.eu_clc_classified
    pipeline = make_pipeline(
        f"""
        ! read {clc_source.as_posix()}
        ! reclassify --mapping=@{clc_mapping.as_posix()} --ot={settings.data_type}
        ! edit --nodata={settings.nodata}
        ! write {settings.gdal_pipeline_creation_options} {settings.overwrite_arg} {classified.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    result = gdal.Run("raster pipeline", pipeline=pipeline)
    if hasattr(result, "Finalize"):
        result.Finalize()
    with tempfile.TemporaryDirectory(prefix="clc_class_", dir=settings.temp_dir) as tmp:
        for resolution in settings.coarse_resolutions:
            coarse_classified = Path(tmp) / f"eu_{resolution}m_clc_classes.tif"
            coarse_stack = settings.clc_dir / f"eu_{resolution}m_clc_classes_stack.tif"
            downsample_classified(
                source=classified, resolution=resolution, output=coarse_classified
            )
            build_clc_onehot_stack(
                classified=coarse_classified,
                out=coarse_stack,
                resolution=f"{resolution},{resolution}",
            )


def build_clc_onehot_stack(
    *,
    classified: Path,
    out: Path,
    resolution: str = settings.resolution,
) -> None:
    """Build a five-band one-hot CLC stack.

    Args:
        classified: Classified CLC raster with values from ``CLASS_CODES``.
        out: Output stack raster.
        resolution: Output resolution as ``"xres,yres"``.
    """
    with tempfile.TemporaryDirectory(prefix="clc_hot_", dir=settings.temp_dir) as tmp:
        band_files = []
        for class_code in CLASS_CODES:
            class_dataset = Path(tmp) / f"clc_{class_code}.gdalg.json"
            band_files.append(class_dataset)
            mapping = f'"{class_code}=1;DEFAULT=0;NO_DATA=NO_DATA"'
            pipeline = make_pipeline(
                f"""
                ! read {classified.as_posix()}
                ! reclassify --mapping {mapping} --ot={settings.data_type}
                ! write --of=GDALG {settings.overwrite_arg} {class_dataset.as_posix()}
                """
            )
            print(f"$ gdal raster pipeline {pipeline}")
            result = gdal.Run("raster pipeline", pipeline=pipeline)
            if hasattr(result, "Finalize"):
                result.Finalize()

        band_inputs = " ".join(path.as_posix() for path in band_files)
        pipeline = make_pipeline(
            f"""
            ! stack {band_inputs} --dst-nodata {settings.nodata} --resolution {resolution}
            ! write {settings.gdal_pipeline_creation_options} {settings.overwrite_arg} {out.as_posix()}
            """
        )
        print(f"$ gdal raster pipeline {pipeline}")
        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()


def main() -> None:
    common = argparse.ArgumentParser(add_help=False)

    parser = argparse.ArgumentParser(
        parents=[common],
        description=(
            "CLC land-cover stage. Run a single step by name, or no subcommand for the "
            "full stack (clip + reclassify -> one-hot band stack). All paths come from "
            "raster_settings."
        ),
    )
    sub = parser.add_subparsers(dest="command")
    sub.add_parser(
        "classify", parents=[common], help="Area-wide coarse CLC one-hot stacks"
    )

    args = parser.parse_args()

    for directory in (settings.clc_dir, settings.temp_dir):
        directory.mkdir(parents=True, exist_ok=True)
    configure_gdal()

    if args.command == "classify":
        _create_source_clc_classified(
            clc_source=settings.clc_source, clc_mapping=settings.clc_mapping
        )


if __name__ == "__main__":
    main()
