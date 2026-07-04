#!/usr/bin/env python3
"""Mosaic rasters into, or mask countries out of, an existing area web COG.

Subcommands:
  patch-country     Reproject + mask one raw EPSG:3035 country, then fold it
                     into the base COG.
  mosaic            Fold one or more already-web-grid rasters into the base COG.
  remove-countries  Blank out one or more countries already baked into the
                     base COG, using each country's boundary gpkg in
                     input/bounds as an inverse warp cutline.

The patch-country and mosaic paths share the same tail: build a VRT mosaic
(base COG at the bottom, additions painted on top) and materialize one web
COG via gdal.Warp.
"""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from osgeo import gdal

from raster import raster_settings as settings
from raster.utils import bounds, gdal_common, gdal_controller
from raster.utils.helpers import banner, slugify_area, slugify_areas


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
        "--source-cog",
        type=Path,
        default=settings.area_output_cog,
        help=f"source area COG to patch (default: {settings.area_output_cog})",
    )
    patch.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="output COG path (default: <source-cog stem>_patched_<country>.tif in out/)",
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

    remove = sub.add_parser(
        "remove-countries",
        help="blank out one or more countries already baked into the base COG",
    )
    remove.add_argument(
        "countries",
        nargs="+",
        help="country keys, e.g. 'moldova ukraine' (each matches its bounds gpkg "
        "in input/bounds)",
    )
    remove.add_argument(
        "--source-cog",
        type=Path,
        default=settings.area_output_cog,
        help=f"source area COG to cut the countries out of (default: {settings.area_output_cog})",
    )
    remove.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="output COG path (default: <source-cog stem>_masked.tif in out/)",
    )
    remove.add_argument(
        "--simplify",
        type=int,
        default=0,
        metavar="METRES",
        help="boundary simplify tolerance in metres (default: 0 = exact)",
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


def run_patch_country(args: argparse.Namespace) -> None:
    """Reproject + mask one country and fold it into the base COG.

    Args:
        args: Parsed ``patch-country`` arguments.

    Raises:
        FileNotFoundError: If the base COG or the country 3035 raster is missing.
    """
    country = slugify_area(args.country)
    country_3035 = settings.pre_out_dir / f"{country}_3035.tif"
    output = args.output or (
        settings.output_dir / f"{args.source_cog.stem}_patched_{country}.tif"
    )

    for path, label in (
        (args.source_cog, "source COG"),
        (country_3035, "country 3035 raster"),
    ):
        if not path.is_file():
            raise FileNotFoundError(f"Missing {label}: {path}")

    banner(f"Patch {country} into {args.source_cog.name}")
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
            rasters=[args.source_cog, patch_cog],
            output=output,
            tmp=Path(tmp),
            stem=f"{country}_patched",
        )

    banner(f"Wrote patched area COG: {output}")


def run_mosaic(args: argparse.Namespace) -> None:
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


def _create_inverse_cutline_gpkg(
    *,
    countries: list[str],
    source_cog: Path,
    output_gpkg: Path,
    layer_name: str,
    simplify_tolerance: int = 0,
) -> None:
    """Write a bbox-minus-countries cutline polygon in the source COG's CRS.

    Args:
        countries: Normalized country keys; each matches a gpkg in input/bounds.
        source_cog: Source COG providing the target CRS and grid bbox.
        output_gpkg: Output GeoPackage path.
        layer_name: Output layer name.
        simplify_tolerance: Douglas-Peucker tolerance in metres (EPSG:3035);
            0 disables it.

    Raises:
        FileNotFoundError: If a country's boundary GeoPackage is missing.
    """
    import geopandas as gpd
    from shapely.geometry import box
    from shapely.ops import unary_union

    geoms = []
    for country in countries:
        gpkg = bounds.BOUNDS_DIR / f"{country}.gpkg"
        if not gpkg.is_file():
            raise FileNotFoundError(
                f"Missing boundary gpkg: {gpkg} - run 'bounds.py area' for "
                f"'{country}' first"
            )
        geoms.append(gpd.read_file(gpkg, layer=country).union_all())
    dissolved = unary_union(geoms)

    if simplify_tolerance > 0:
        dissolved = dissolved.simplify(simplify_tolerance, preserve_topology=True)
        print(f"Simplified removal outline @ {simplify_tolerance} m tolerance")

    dataset = gdal.Open(str(source_cog))
    source_crs_wkt = dataset.GetSpatialRef().ExportToWkt()
    dataset = None
    minx, miny, maxx, maxy = (
        float(value) for value in gdal_common.raster_grid_bbox(source_cog).split(",")
    )

    dissolved_source_crs = (
        gpd.GeoSeries([dissolved], crs=bounds.TARGET_CRS)
        .to_crs(source_crs_wkt)
        .union_all()
    )
    inverse = box(minx, miny, maxx, maxy).difference(dissolved_source_crs)

    gpd.GeoDataFrame(
        {"name": [layer_name]}, geometry=[inverse], crs=source_crs_wkt
    ).to_file(output_gpkg, layer=layer_name, driver="GPKG")
    print(f"Wrote cutline {output_gpkg} (layer '{layer_name}')")


def run_remove_countries(args: argparse.Namespace) -> None:
    """Blank out one or more countries already baked into the source COG.

    Builds a bbox-minus-countries cutline from the per-country gpkgs in
    input/bounds and applies it through a warped VRT.

    Args:
        args: Parsed ``remove-countries`` arguments.

    Raises:
        FileNotFoundError: If the source COG or a country's boundary gpkg is
            missing.
    """
    countries = slugify_areas(args.countries)
    output = args.output or (settings.output_dir / f"{args.source_cog.stem}_masked.tif")
    source_cog = args.source_cog

    banner(f"Remove {', '.join(countries)} from {source_cog.name}")
    print(f"countries: {', '.join(countries)}")
    print(f"simplify:  {args.simplify} m")
    print(f"output:    {output}")

    if not source_cog.is_file():
        raise FileNotFoundError(f"Missing source COG: {source_cog}")

    layer_name = "remove_cutline"
    with tempfile.TemporaryDirectory(
        prefix="remove_countries_", dir=settings.temp_dir
    ) as tmp:
        tmp_dir = Path(tmp)
        cutline_gpkg = tmp_dir / f"{layer_name}.gpkg"
        _create_inverse_cutline_gpkg(
            countries=countries,
            source_cog=source_cog,
            output_gpkg=cutline_gpkg,
            layer_name=layer_name,
            simplify_tolerance=args.simplify,
        )

        cut_vrt = tmp_dir / "remove_cut.vrt"
        print(f"gdal.Warp cutline VRT -> {cut_vrt}")
        gdal.Warp(
            str(cut_vrt),
            str(source_cog),
            format="VRT",
            cutlineDSName=str(cutline_gpkg),
            cutlineLayer=layer_name,
            dstNodata=settings.nodata,
            errorThreshold=0,
        )

        output.parent.mkdir(parents=True, exist_ok=True)
        gdal_controller.write_web_cog(src=cut_vrt, out_cog=output)

    banner(f"Wrote masked area COG: {output}")


def main() -> None:
    args = parse_args()
    gdal_common.configure_gdal()
    settings.temp_dir.mkdir(parents=True, exist_ok=True)

    if args.command == "patch-country":
        run_patch_country(args)
    elif args.command == "mosaic":
        run_mosaic(args)
    elif args.command == "remove-countries":
        run_remove_countries(args)


if __name__ == "__main__":
    main()
