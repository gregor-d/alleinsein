#!/usr/bin/env python3
"""Mosaic rasters into an existing area web COG.

Subcommands:
  patch-country  Reproject + mask one raw EPSG:3035 country, then fold it into
                 the base COG.
  mosaic         Fold one or more already-web-grid rasters into the base COG.

Both paths share the same tail: build a VRT mosaic (base COG at the bottom,
additions painted on top) and materialize one web COG via gdal.Warp.
"""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from raster import raster_settings as settings
from raster.utils import bounds, gdal_common, gdal_controller
from raster.utils.helpers import banner


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Mosaic rasters into an existing area web COG."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    patch = sub.add_parser(
        "patch-country",
        help="reproject + mask one raw EPSG:3035 country, then fold it into the base COG",
    )
    patch.add_argument(
        "country", help="country key, e.g. 'spain' (matches its bounds gpkg)"
    )
    patch.add_argument(
        "--area-tif",
        type=Path,
        default=settings.area_output_cog,
        help=f"existing area COG to patch (default: {settings.area_output_cog})",
    )
    patch.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="output COG path (default: <area-tif stem>_patched_<country>.tif in out/)",
    )
    patch.add_argument(
        "--simplify",
        type=int,
        default=0,
        metavar="METRES",
        help="boundary simplify tolerance in metres; MUST match the area COG's for a coastal "
        "country (default: 0 = exact)",
    )

    mosaic = sub.add_parser(
        "mosaic",
        help="fold one or more already-web-grid rasters into the base COG",
    )
    mosaic.add_argument(
        "rasters",
        nargs="+",
        type=Path,
        help="already-reprojected rasters to fold into each other",
    )
    mosaic.add_argument(
        "-o",
        "--output",
        type=Path,
        required=True,
        help="output COG path",
    )

    return parser.parse_args()


def _mosaic_and_write(
    *, rasters: list[Path], output: Path, tmp: Path, stem: str
) -> None:
    """Mosaic web-grid rasters into a VRT and materialize one web COG.

    Args:
        rasters: Sources in paint order; the base COG first, additions on top.
        output: Output COG path.
        tmp: Working directory for the intermediate VRT.
        stem: Filename stem for the intermediate VRT.
    """
    mosaic_vrt = tmp / f"{stem}_mosaic.vrt"
    gdal_controller.mosaic_rasters(rasters=rasters, mosaic_vrt=mosaic_vrt)
    output.parent.mkdir(parents=True, exist_ok=True)
    gdal_controller.write_web_cog(src=mosaic_vrt, out_cog=output)


def _run_patch_country(args: argparse.Namespace) -> None:
    """Reproject + mask one country and fold it into the base COG.

    Args:
        args: Parsed ``patch-country`` arguments.

    Raises:
        FileNotFoundError: If the base COG or the country 3035 raster is missing.
    """
    country = args.country.lower().replace(" ", "_")
    country_3035 = settings.pre_out_dir / f"{country}_3035.tif"
    output = args.output or (
        settings.output_dir / f"{args.area_tif.stem}_patched_{country}.tif"
    )

    for path, label in (
        (args.area_tif, "area COG"),
        (country_3035, "country 3035 raster"),
    ):
        if not path.is_file():
            raise FileNotFoundError(f"Missing {label}: {path}")

    banner(f"Patch {country} into {args.area_tif.name}")
    print(f"country raster: {country_3035}")
    print(f"simplify:       {args.simplify} m")
    print(f"output:         {output}")

    boundary_name = f"{country}_patch"
    boundary = bounds.create_dissolved_bounds(
        output_area=boundary_name, areas=[country], simplify_tolerance=args.simplify
    )

    with tempfile.TemporaryDirectory(
        prefix=f"patch_{country}_", dir=settings.temp_dir
    ) as tmp:
        patch_cog = Path(tmp) / f"{country}_patch.tif"
        gdal_controller.create_web_cog_from_stacked(
            stacked_3035=country_3035,
            output_cog=patch_cog,
            bounds_gpkg=boundary,
            boundary_name=boundary_name,
        )
        _mosaic_and_write(
            rasters=[args.area_tif, patch_cog],
            output=output,
            tmp=Path(tmp),
            stem=f"{country}_patched",
        )

    banner(f"Wrote patched area COG: {output}")


def _run_mosaic(args: argparse.Namespace) -> None:
    """Fold already-reprojected rasters into the base COG.

    Args:
        args: Parsed ``mosaic`` arguments.

    Raises:
        FileNotFoundError: If the base COG or any input raster is missing.
    """
    input_rasters = [path.resolve() for path in args.rasters]

    for path in input_rasters:
        if not path.is_file():
            raise FileNotFoundError(f"Missing input raster: {path}")

    banner("Mosaic reprojected rasters into base COG")
    print(f"inputs:   {', '.join(str(path) for path in input_rasters)}")
    print(f"output:   {args.output}")

    with tempfile.TemporaryDirectory(
        prefix=f"{args.output.stem}_", dir=settings.temp_dir
    ) as tmp:
        _mosaic_and_write(
            rasters=input_rasters,
            output=args.output,
            tmp=Path(tmp),
            stem=args.output.stem,
        )

    banner(f"Wrote mosaicked area COG: {args.output}")


def main() -> None:
    args = parse_args()
    gdal_common.configure_gdal()
    settings.temp_dir.mkdir(parents=True, exist_ok=True)

    if args.command == "patch-country":
        _run_patch_country(args)
    elif args.command == "mosaic":
        _run_mosaic(args)


if __name__ == "__main__":
    main()
