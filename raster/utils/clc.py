# pyright: reportMissingImports=false
"""CLC land-cover stage of the raster pipeline.

Clip + reclassify the CLC source into the five custom classes, then build a one-hot
band per class (nature, farm, park, urban, water) and stack them at the raster
resolution. Each function takes explicit ``Path`` arguments; config knobs and
``settings.dry_run`` come from ``raster_settings``.

Run standalone — with no subcommand it builds the full stack; a subcommand runs that
single step. All paths come from ``raster_settings``:
    uv run python -m raster.utils.clc [--dry-run]
    uv run python -m raster.utils.clc stack
    uv run python -m raster.utils.clc onehot
"""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from osgeo import gdal  # ty: ignore[unresolved-import]
from raster import raster_settings as settings
from raster.utils.gdal_common import configure_gdal, make_pipeline
from raster.utils.helpers import banner

CLASS_CODES = (1, 2, 3, 4, 5)


def create_clc_stack(
    clc_source: Path, clc_mapping: Path, clc_classified: Path, clc_stack: Path
) -> None:
    banner("Create CLC raster stack")
    if not settings.dry_run:
        if not clc_source.is_file():
            raise FileNotFoundError(f"Missing CLC input raster: {clc_source}")
        if not clc_mapping.is_file():
            raise FileNotFoundError(f"Missing CLC mapping file: {clc_mapping}")

    pipeline = make_pipeline(
        f"""
        ! read {clc_source.as_posix()}
        ! clip --bbox={settings.bbox} --bbox-crs={settings.target_epsg} --allow-bbox-outside-source
        ! reclassify --mapping=@{clc_mapping.as_posix()} --ot={settings.data_type}
        ! edit --nodata={settings.nodata}
        ! write {settings.gdal_pipeline_creation_options} {settings.overwrite_arg} {clc_classified.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    if not settings.dry_run:
        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()

    build_clc_onehot_stack(clc_classified, clc_stack, settings.resolution)


def build_clc_onehot_stack(classified: Path, out: Path, resolution: str) -> None:
    """Build a one-hot band per CLC class (nature, farm, park, urban, water) from a
    classified raster and stack them at ``resolution``. Shared by the fine pipeline
    (create_clc_stack) and the coarse pipeline (build_coarse_raster)."""
    with tempfile.TemporaryDirectory(prefix="clc_", dir=settings.temp_dir) as tmp:
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
            if not settings.dry_run:
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
        if not settings.dry_run:
            result = gdal.Run("raster pipeline", pipeline=pipeline)
            if hasattr(result, "Finalize"):
                result.Finalize()


def main() -> None:
    # --dry-run via a shared parent so it works before or after the subcommand;
    # SUPPRESS keeps the subparser default from clobbering a value set on the parent.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--dry-run", action="store_true", default=argparse.SUPPRESS)

    parser = argparse.ArgumentParser(
        parents=[common],
        description=(
            "CLC land-cover stage. Run a single step by name, or no subcommand for the "
            "full stack (clip + reclassify -> one-hot band stack). All paths come from "
            "raster_settings."
        ),
    )
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("stack", parents=[common], help="clip + reclassify CLC, then one-hot stack")
    sub.add_parser("onehot", parents=[common], help="classified CLC -> one-hot band stack")

    args = parser.parse_args()
    settings.dry_run = getattr(args, "dry_run", False)

    for directory in (settings.clc_dir, settings.temp_dir):
        directory.mkdir(parents=True, exist_ok=True)
    if not settings.dry_run:
        configure_gdal()

    if args.command == "onehot":
        build_clc_onehot_stack(
            settings.clc_classified, settings.clc_stack, settings.resolution
        )
    else:  # "stack" or no subcommand: the full stack
        create_clc_stack(
            settings.clc_source,
            settings.clc_mapping,
            settings.clc_classified,
            settings.clc_stack,
        )


if __name__ == "__main__":
    main()
