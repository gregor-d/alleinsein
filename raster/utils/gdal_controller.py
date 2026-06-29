# pyright: reportMissingImports=false
"""Raster assembly steps: heatmap encoding, web-COG output, mosaic and coarse build.

The per-domain GDAL/osmium stages now live in their own modules — ``osm`` (roads),
``clc`` (land cover) and ``dem`` (slope) — with the shared ``make_pipeline`` /
``configure_gdal`` helpers in ``gdal_common``. This module holds the cross-cutting
steps that combine those domain outputs into the final products, called by the
``create_*.py`` coordinators.

Each function takes its input and output files as explicit ``Path`` arguments (threaded
in by the coordinators from ``raster_settings``), while configuration knobs (bbox,
resolution, EPSG, creation options, …) and ``settings.dry_run`` are read from
``raster_settings``. A dry run prints the command it would run without touching GDAL.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from osgeo import gdal  # ty: ignore[unresolved-import]
from osgeo_utils.gdal_calc import Calc  # ty: ignore[unresolved-import]
from raster import raster_settings as settings
from raster.utils.clc import build_clc_onehot_stack
from raster.utils.gdal_common import make_pipeline
from raster.utils.helpers import banner


# ---------------------------------------------------------------------------
# Encode the masked road heatmap into a single band
# (previously inline in create_raster.py)
# ---------------------------------------------------------------------------


def encode_heatmap(roads: Path, clc_stack: Path, out: Path) -> None:
    """Combine the road-proximity heatmap (single band, A) with the 5-band one-hot
    CLC stack (B-F) into the single-band encoded raster ``out``: each land-cover
    class occupies its own value range (nature A, farm A+10, park A+20, urban A+30,
    water 200). Shared by the fine and coarse pipelines (mirrors heatmap_calc in
    utils/sh/raster_lib.sh). muparser is buggy, so this stays in gdal_calc."""
    print(f"gdal_calc.Calc -> {out}")
    if settings.dry_run:
        return
    Calc(
        calc="where(F==1, 200, A*B + (A+10)*C + (A+20)*D + (A+30)*E)",
        outfile=str(out),
        type=settings.data_type,
        NoDataValue=settings.nodata,
        creation_options=list(settings.gtiff_creation_options),
        overwrite=settings.overwrite,
        quiet=False,
        A=str(roads),
        A_band=1,
        B=str(clc_stack),
        B_band=1,
        C=str(clc_stack),
        C_band=2,
        D=str(clc_stack),
        D_band=3,
        E=str(clc_stack),
        E_band=4,
        F=str(clc_stack),
        F_band=5,
    )


def calculate_heatmap(roads_smooth: Path, clc_stack: Path, raw_calc: Path) -> None:
    banner("Calculate heatmap raster")
    if not settings.dry_run:
        if not roads_smooth.is_file():
            raise FileNotFoundError(f"Missing roads smooth raster: {roads_smooth}")
        if not clc_stack.is_file():
            raise FileNotFoundError(f"Missing CLC one-hot stack: {clc_stack}")
    encode_heatmap(roads_smooth, clc_stack, raw_calc)


# ---------------------------------------------------------------------------
# Clip, reproject and write the Web Mercator COG
# (previously inline in create_raster.py)
# ---------------------------------------------------------------------------


def clip_reproject_web_cog(
    src: Path,
    out_cog: Path,
    reprojected: Path,
    bounds_gpkg: Path,
    layer: str | None = None,
) -> None:
    """Turn a raster on the TARGET_EPSG grid into the final web product: clip it
    to the AREA bounds, reproject to WEB_EPSG, then ``write_web_cog`` a Web Mercator
    tile-matrix aligned COG with overviews. The clip + reproject prefix is what
    distinguishes this from the bare ``write_web_cog`` (which the coarse pipeline,
    already clipped on its own grid, calls directly). Shared tail of the heatmap
    pipeline and the slope-mod band (mirrors finalize_web_cog in utils/sh/raster_lib.sh).
    ``reprojected`` is the intermediate reprojected GeoTIFF written before the COG.
    ``layer`` is the clip layer inside ``bounds_gpkg`` (defaults to ``settings.area``;
    the multi-country pipeline passes the dissolved-boundary layer instead).
    """
    layer = layer or settings.area
    if not settings.dry_run and not bounds_gpkg.is_file():
        raise FileNotFoundError(f"Missing bounds GeoPackage: {bounds_gpkg}")

    pipeline = make_pipeline(
        f"""
        ! read {src.as_posix()}
        ! clip --like {bounds_gpkg.as_posix()} --like-layer {layer} --allow-bbox-outside-source
        ! reproject -d {settings.web_epsg}
        ! write {settings.overwrite_arg} {settings.gtiff} {reprojected.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    if not settings.dry_run:
        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()

    write_web_cog(reprojected, out_cog)


def write_web_cog(src: Path, out_cog: Path) -> None:
    """Write a web-optimized COG from an already-prepared SRC via rio-cogeo:
    ``web_optimized`` reprojects to WEB_EPSG and aligns to the tiling scheme. nearest
    everywhere preserves the exact categorical encoding (no averaging of the composite
    codes); 512 blocks match the frontend tile size. Shared leaf of the fine, slope-mod
    and coarse COGs — callers that still need to clip/reproject a raw TARGET_EPSG raster
    go through ``clip_reproject_web_cog`` instead.
    """
    print(f"rio_cogeo.cog_translate -> {out_cog}")
    if settings.dry_run:
        return
    from rio_cogeo.cogeo import cog_translate
    from rio_cogeo.profiles import cog_profiles

    output_profile = cog_profiles.get("deflate")
    output_profile.update(
        {
            "BIGTIFF": "IF_SAFER",
            "blockxsize": settings.cog_blocksize,
            "blockysize": settings.cog_blocksize,
        }
    )
    cog_translate(
        str(src),
        str(out_cog),
        output_profile,
        web_optimized=True,
        resampling="nearest",
        overview_resampling="nearest",
        in_memory=False,
        quiet=False,
        config={"GDAL_TIFF_OVR_BLOCKSIZE": str(settings.cog_blocksize)},
    )


def create_web_cog(
    raw_calc: Path, slope_mod_modified: Path, output_cog: Path, bounds_gpkg: Path
) -> None:
    # Stack the raw aloneness band (1, from calculate_heatmap) and the slope-modified
    # band (2, from dem.calculate_slope_mod_band) into a single 2-band raster on the
    # TARGET_EPSG grid, then clip/reproject/web-optimize it into the final COG.
    # ``raster_stack`` and ``reprojected`` are internal intermediates from settings.
    banner("Stack bands and create web COG")
    if not settings.dry_run:
        for path, label in (
            (raw_calc, "raw heatmap raster"),
            (slope_mod_modified, "slope-modified band"),
        ):
            if not path.is_file():
                raise FileNotFoundError(f"Missing {label}: {path}")

    pipeline = make_pipeline(
        f"""
        ! stack {raw_calc.as_posix()} {slope_mod_modified.as_posix()} --dst-nodata {settings.nodata} --resolution {settings.resolution}
        ! write {settings.gtiff} {settings.overwrite_arg} {settings.raster_stack.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    if not settings.dry_run:
        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()

    clip_reproject_web_cog(
        settings.raster_stack, output_cog, settings.reprojected, bounds_gpkg
    )
    print(f"Successfully created 2-band masked COG raster: {output_cog}")


# ---------------------------------------------------------------------------
# Mosaic per-country rasters onto the shared grid (multi-country)
# (used by eu/create_eu_raster.py)
#
# Merge the per-country encoded heatmaps (each already on the shared TARGET_EPSG
# grid, on its own buffered extent) into a single virtual raster. A VRT references
# the sources in place, so no pixels are copied; the buffer rings are discarded by
# the single clip to the dissolved boundary in the clip_reproject_web_cog tail.
# ---------------------------------------------------------------------------


def mosaic_rasters(rasters: list[Path], mosaic_vrt: Path) -> None:
    banner("Mosaic per-country rasters")
    if not settings.dry_run:
        for raster in rasters:
            if not raster.is_file():
                raise FileNotFoundError(f"Missing per-country raster: {raster}")

    sources = " ".join(raster.as_posix() for raster in rasters)
    print(
        f"$ gdalbuildvrt -overwrite -srcnodata {settings.nodata} "
        f"-vrtnodata {settings.nodata} {mosaic_vrt.as_posix()} {sources}"
    )
    if settings.dry_run:
        return

    options = gdal.BuildVRTOptions(srcNodata=settings.nodata, VRTNodata=settings.nodata)
    vrt = gdal.BuildVRT(
        str(mosaic_vrt), [str(raster) for raster in rasters], options=options
    )
    vrt.FlushCache()
    vrt = None  # close the dataset so the .vrt is fully written to disk


# ---------------------------------------------------------------------------
# Downsample the fine inputs into a coarse-resolution COG
# (from create_coarse_raster.sh)
#
# Downsamples the fine 20m road-proximity heatmap (average + restretch) and the
# reclassified CLC (mode) onto a coarser grid, rebuilds the one-hot CLC stack at that
# resolution, then re-uses the shared heatmap encoding and web-COG tail. The result
# keeps the exact same per-land-cover value encoding as the fine COG so the frontend
# can switch tiers without changing how it reads pixels.
# ---------------------------------------------------------------------------


def build_coarse_raster(
    resolution: int,
    roads_smooth: Path,
    clc_classified: Path,
    bounds_gpkg: Path,
    output_cog: Path,
) -> None:
    res_pair = f"{resolution},{resolution}"
    stem = output_cog.stem

    banner(f"Coarse resolution: {resolution}m  ->  {output_cog.name}")
    if not settings.dry_run and not bounds_gpkg.is_file():
        raise FileNotFoundError(f"Missing bounds GeoPackage: {bounds_gpkg}")

    with tempfile.TemporaryDirectory(prefix="coarse_", dir=settings.temp_dir) as tmp:
        tmp_dir = Path(tmp)
        coarse_roads = tmp_dir / f"{stem}_roads.tif"
        coarse_clc = tmp_dir / f"{stem}_clc.tif"
        coarse_clc_stack = tmp_dir / f"{stem}_clc_stack.tif"
        raw = tmp_dir / f"{stem}_raw.tif"
        clipped = tmp_dir / f"{stem}_clipped.tif"

        # 1. Resample the road heatmap to the coarse grid (average + restretch 1..10).
        print("Resampling roads_smooth to coarse grid (average + restretch)...")
        pipeline = make_pipeline(
            f"""
            ! read {roads_smooth.as_posix()}
            ! reproject --resolution {res_pair} -r average --target-aligned-pixels
            ! scale --dst-min 1 --dst-max 10 --ot {settings.data_type}
            ! write {settings.overwrite_arg} {settings.gtiff} {coarse_roads.as_posix()}
            """
        )
        print(f"$ gdal raster pipeline {pipeline}")
        if not settings.dry_run:
            result = gdal.Run("raster pipeline", pipeline=pipeline)
            if hasattr(result, "Finalize"):
                result.Finalize()

        # 2. Resample the reclassified CLC to the coarse grid (mode).
        print("Resampling CLC classes to coarse grid (mode)...")
        pipeline = make_pipeline(
            f"""
            ! read {clc_classified.as_posix()}
            ! reproject --resolution {res_pair} -r mode --target-aligned-pixels
            ! edit --nodata={settings.nodata}
            ! write {settings.overwrite_arg} {settings.gtiff} {coarse_clc.as_posix()}
            """
        )
        print(f"$ gdal raster pipeline {pipeline}")
        if not settings.dry_run:
            result = gdal.Run("raster pipeline", pipeline=pipeline)
            if hasattr(result, "Finalize"):
                result.Finalize()

        # 3. Rebuild the one-hot CLC stack at the coarse resolution.
        print(f"Rebuilding one-hot CLC stack at {resolution}m...")
        build_clc_onehot_stack(coarse_clc, coarse_clc_stack, res_pair)

        # 4. Encode the heatmap raster (same per-land-cover encoding as the fine COG).
        print(f"Encoding heatmap raster -> {output_cog.name}...")
        encode_heatmap(coarse_roads, coarse_clc_stack, raw)

        # 5. Clip to the AREA bounds (stays in TARGET_EPSG; web-optimize reprojects).
        print("Clipping to bounds...")
        pipeline = make_pipeline(
            f"""
            ! read {raw.as_posix()}
            ! clip --like {bounds_gpkg.as_posix()} --like-layer {settings.area} --allow-bbox-outside-source
            ! write {settings.overwrite_arg} {settings.gtiff} {clipped.as_posix()}
            """
        )
        print(f"$ gdal raster pipeline {pipeline}")
        if not settings.dry_run:
            result = gdal.Run("raster pipeline", pipeline=pipeline)
            if hasattr(result, "Finalize"):
                result.Finalize()

        # 6. Write the web-optimized COG.
        print("Writing web-optimized COG with rio-cogeo...")
        write_web_cog(clipped, output_cog)

    print(f"Successfully created coarse COG raster: {output_cog}")
