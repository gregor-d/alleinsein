#!/usr/bin/env python3
# pyright: reportMissingImports=false
"""Raster assembly, mosaic, coarse-build, and COG output steps."""

from __future__ import annotations

import tempfile
from pathlib import Path

from osgeo import gdal
from osgeo_utils.gdal_calc import Calc

from raster import raster_settings as settings
from raster.utils.dem import calculate_slope_mod_band
from raster.utils.gdal_common import make_pipeline, raster_grid_bbox
from raster.utils.helpers import banner


def encode_heatmap(*, roads: Path, clc_stack: Path, out: Path) -> None:
    """Encode roads and one-hot CLC bands into one raster band.

    Value ranges: nature 1..10, farm 11..20, park 21..30, urban 31..40,
    water 200.

    Args:
        roads: Road-proximity heatmap raster.
        clc_stack: Five-band one-hot CLC stack.
        out: Output encoded raster.

    Raises:
        FileNotFoundError: If an input raster is missing.
    """
    banner("Encode heatmap raster")
    if not roads.is_file():
        raise FileNotFoundError(f"Missing roads smooth raster: {roads}")
    if not clc_stack.is_file():
        raise FileNotFoundError(f"Missing CLC one-hot stack: {clc_stack}")
    print(f"gdal_calc.Calc -> {out}")
    Calc(
        calc="where(F==1, 200, A*B + (A+10)*C + (A+20)*D + (A+30)*E)",
        outfile=str(out),
        type=settings.data_type,
        NoDataValue=settings.nodata,
        creation_options=list(settings.gdal_calc_options),
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


def write_web_cog(*, src: Path, out_cog: Path) -> None:
    """Write a GoogleMapsCompatible COG.

    Args:
        src: Source raster.
        out_cog: Output COG path.
    """
    print(f"gdal.Warp COG (GoogleMapsCompatible) -> {out_cog}")
    # Exact coordinate transforms keep nearest-neighbor picks reproducible.
    # COG driver intermediates inherit output compression.
    gdal.Warp(
        str(out_cog),
        str(src),
        format="COG",
        multithread=True,
        dstNodata=settings.nodata,
        errorThreshold=0,
        warpOptions=["NUM_THREADS=ALL_CPUS"],
        creationOptions=[
            "TILING_SCHEME=GoogleMapsCompatible",
            "COMPRESS=DEFLATE",
            # Horizontal differencing inflates the categorical byte encoding.
            f"BLOCKSIZE={settings.cog_blocksize}",
            "RESAMPLING=NEAREST",
            "OVERVIEW_RESAMPLING=NEAREST",
            "NUM_THREADS=ALL_CPUS",
            "BIGTIFF=IF_SAFER",
            "ADD_ALPHA=NO",
        ],
        callback=gdal.TermProgress_nocb,
    )


def raster_has_band_count(*, path: Path, band_count: int) -> bool:
    """Check a raster's band count.

    Args:
        path: Raster path.
        band_count: Required band count.

    Returns:
        True when the raster exists and has exactly ``band_count`` bands.
    """
    if not path.is_file():
        return False
    dataset = gdal.Open(str(path))
    if dataset is None:
        return False
    actual_band_count = dataset.RasterCount
    dataset = None
    return actual_band_count == band_count


def stack_raw_and_slope_bands(
    *,
    raw_calc: Path,
    slope_mod: Path,
    output_dir: Path | None = None,
    output_path: Path | None = None,
    resolution: str | None = None,
) -> Path:
    """Stack raw and slope-modified aloneness bands.

    Args:
        raw_calc: Raw encoded aloneness raster.
        slope_mod: Slope-modified aloneness raster.
        output_dir: Directory the two-band raster is written into (default filename: stacked.tif).
        output_path: Direct path to the output raster. Exactly one of output_dir or output_path must be specified.
        resolution: Optional stack resolution as ``"xres,yres"``.

    Returns:
        Path to the written two-band raster.

    Raises:
        ValueError: If both output_dir and output_path are specified or neither is specified.
        FileNotFoundError: If an input raster is missing.
    """
    if (output_dir is None) == (output_path is None):
        raise ValueError("Exactly one of output_dir or output_path must be specified.")

    resolution = resolution or settings.resolution
    banner("Stack raw and slope-modified bands")
    for path, label in (
        (raw_calc, "raw heatmap raster"),
        (slope_mod, "slope-modified band"),
    ):
        if not path.is_file():
            raise FileNotFoundError(f"Missing {label}: {path}")

    if output_path is not None:
        output = output_path
    else:
        assert output_dir is not None
        output = output_dir / "stacked.tif"
    pipeline = make_pipeline(
        f"""
        ! stack {raw_calc.as_posix()} {slope_mod.as_posix()} --dst-nodata {settings.nodata} --resolution {resolution}
        ! write {settings.overwrite_arg} {settings.gdal_pipeline_creation_options} {output.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    result = gdal.Run("raster pipeline", pipeline=pipeline)
    if hasattr(result, "Finalize"):
        result.Finalize()
    return output


def mask_raster_to_boundary(
    *,
    src: Path,
    output: Path,
    bounds_gpkg: Path,
    boundary_name: str,
) -> None:
    """Mask a stacked TARGET_EPSG raster to a boundary and save the output.

    Args:
        src: Source raster path.
        output: Output raster path.
        bounds_gpkg: Boundary GeoPackage path.
        boundary_name: Boundary layer name.

    Raises:
        FileNotFoundError: If the source raster or boundary GeoPackage is missing.
    """
    if not src.is_file():
        raise FileNotFoundError(f"Missing source raster: {src}")
    if not bounds_gpkg.is_file():
        raise FileNotFoundError(f"Missing boundary GeoPackage: {bounds_gpkg}")

    fast_creation_options = [
        "TILED=YES",
        "COMPRESS=ZSTD",
        "NUM_THREADS=ALL_CPUS",
        "BIGTIFF=IF_SAFER",
    ]

    with tempfile.TemporaryDirectory(dir=settings.temp_dir) as tmp:
        mask = Path(tmp) / "mask.tif"
        minx, miny, maxx, maxy = (
            float(value) for value in raster_grid_bbox(src).split(",")
        )
        source = gdal.Open(str(src))
        if source is None:
            raise RuntimeError(f"Could not open source raster: {src}")
        geotransform = source.GetGeoTransform()
        source = None

        print(f"Rasterizing boundary mask {bounds_gpkg}:{boundary_name} -> {mask}")
        gdal.Rasterize(
            str(mask),
            str(bounds_gpkg),
            layers=[boundary_name],
            burnValues=[1],
            initValues=[0],
            outputType=gdal.GDT_Byte,
            outputBounds=(minx, miny, maxx, maxy),
            xRes=geotransform[1],
            yRes=abs(geotransform[5]),
            creationOptions=fast_creation_options,
        )

        print(f"Masking {src} -> {output}")
        Calc(
            calc=f"(A*(M==1)) + ({settings.nodata}*(M!=1))",
            outfile=str(output),
            type=settings.data_type,
            NoDataValue=settings.nodata,
            creation_options=fast_creation_options,
            overwrite=True,
            quiet=False,
            A=str(src),
            allBands="A",
            M=str(mask),
        )


def create_web_cog_from_stacked(
    *,
    stacked_3035: Path,
    output_cog: Path,
    bounds_gpkg: Path,
    boundary_name: str,
    clip_to_layer: bool = False,
) -> None:
    """Mask a stacked TARGET_EPSG raster and write a web COG.

    Args:
        stacked_3035: Source raster with final output bands in TARGET_EPSG.
        output_cog: Output web COG path.
        bounds_gpkg: Boundary GeoPackage.
        boundary_name: Boundary layer name.
        clip_to_layer: Crop with GDAL clip.

    Raises:
        FileNotFoundError: If the source raster is missing.
    """
    banner("Mask stacked raster and create web COG")
    if not stacked_3035.is_file():
        raise FileNotFoundError(f"Missing stacked raster: {stacked_3035}")

    if clip_to_layer:
        with tempfile.TemporaryDirectory(dir=settings.temp_dir) as tmp:
            clipped = Path(tmp) / f"{output_cog.stem}_clipped.tif"
            # Clip before the Web Mercator warp to avoid a second resample.
            pipeline = make_pipeline(
                f"""
                ! read {stacked_3035.as_posix()}
                ! clip --like {bounds_gpkg.as_posix()} --like-layer {boundary_name} --allow-bbox-outside-source
                ! write {settings.overwrite_arg} {settings.gdal_pipeline_creation_options} {clipped.as_posix()}
                """
            )
            print(f"$ gdal raster pipeline {pipeline}")
            result = gdal.Run("raster pipeline", pipeline=pipeline)
            if hasattr(result, "Finalize"):
                result.Finalize()

            write_web_cog(src=clipped, out_cog=output_cog)
        print(f"Successfully created 2-band masked COG raster: {output_cog}")
        return

    with tempfile.TemporaryDirectory(dir=settings.temp_dir) as tmp:
        masked = Path(tmp) / f"{output_cog.stem}_masked.tif"
        mask_raster_to_boundary(
            src=stacked_3035,
            output=masked,
            bounds_gpkg=bounds_gpkg,
            boundary_name=boundary_name,
        )
        write_web_cog(src=masked, out_cog=output_cog)
    print(f"Successfully created 2-band masked COG raster: {output_cog}")


def mosaic_rasters(*, rasters: list[Path], mosaic_vrt: Path) -> None:
    """Build a VRT mosaic from raster sources.

    Args:
        rasters: Source rasters in mosaic order.
        mosaic_vrt: Output VRT path.

    Raises:
        FileNotFoundError: If any source raster is missing.
    """
    banner("Mosaic per-country rasters")
    for raster in rasters:
        if not raster.is_file():
            raise FileNotFoundError(f"Missing per-country raster: {raster}")

    sources = " ".join(raster.as_posix() for raster in rasters)
    print(
        f"$ gdalbuildvrt -overwrite -srcnodata {settings.nodata} "
        f"-vrtnodata {settings.nodata} {mosaic_vrt.as_posix()} {sources}"
    )

    options = gdal.BuildVRTOptions(srcNodata=settings.nodata, VRTNodata=settings.nodata)
    vrt = gdal.BuildVRT(
        str(mosaic_vrt), [str(raster) for raster in rasters], options=options
    )
    vrt.FlushCache()
    vrt = None  # close the dataset so the .vrt is fully written to disk


def _build_coarse_encoded(
    *,
    resolution: int,
    roads_smooth: Path,
    country_coarse_clc: Path,
    output_dir: Path,
) -> Path:
    """Build a coarse encoded aloneness raster.

    Args:
        resolution: Output pixel size in metres.
        roads_smooth: Fine road-proximity heatmap raster.
        country_coarse_clc: Coarse one-hot CLC stack.
        output_dir: Directory the encoded raster is written into.

    Returns:
        Path to the written encoded raster.
    """
    res_pair = f"{resolution},{resolution}"
    out_raw = output_dir / "raw.tif"

    with tempfile.TemporaryDirectory(prefix="coarse_", dir=settings.temp_dir) as tmp:
        tmp_dir = Path(tmp)
        coarse_roads = tmp_dir / "roads.tif"
        coarse_clc_stack = tmp_dir / "clc_stack.tif"

        # Resample roads with average values and restretch to 1..10.
        print("Resampling roads_smooth to coarse grid (average + restretch)...")
        pipeline = make_pipeline(
            f"""
            ! read {roads_smooth.as_posix()}
            ! reproject --resolution {res_pair} -r average --target-aligned-pixels
            ! scale --dst-min 1 --dst-max 10 --ot {settings.data_type}
            ! write {settings.overwrite_arg} {settings.gdal_pipeline_creation_options} {coarse_roads.as_posix()}
            """
        )
        print(f"$ gdal raster pipeline {pipeline}")
        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()

        # Align the CLC stack to the coarse roads grid.
        print(f"Aligning CLC stack to {resolution}m road grid...")
        coarse_roads_bbox = raster_grid_bbox(coarse_roads)
        pipeline = make_pipeline(
            f"""
            ! read {country_coarse_clc.as_posix()}
            ! reproject -d {settings.target_epsg} --bbox={coarse_roads_bbox} --bbox-crs={settings.target_epsg} --resolution={res_pair} -r nearest
            ! edit --nodata={settings.nodata}
            ! write {settings.overwrite_arg} {settings.gdal_pipeline_creation_options} {coarse_clc_stack.as_posix()}
            """
        )
        print(f"$ gdal raster pipeline {pipeline}")
        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()

        print(f"Encoding heatmap raster -> {out_raw.name}...")
        encode_heatmap(roads=coarse_roads, clc_stack=coarse_clc_stack, out=out_raw)
    return out_raw


def _build_coarse_slope_mod(
    *,
    resolution: int,
    slope_classes: Path,
    raw: Path,
    output_dir: Path,
) -> Path:
    """Build a coarse slope-modified aloneness raster.

    Args:
        resolution: Output pixel size in metres.
        slope_classes: Source slope-class raster.
        raw: Coarse encoded aloneness raster.
        output_dir: Directory the slope-modified raster is written into.

    Returns:
        Path to the written slope-modified raster.
    """
    res_pair = f"{resolution},{resolution}"
    out_slope_mod = output_dir / "slope_mod.tif"
    with tempfile.TemporaryDirectory(
        prefix="coarse_slope_", dir=settings.temp_dir
    ) as tmp:
        coarse_slope = Path(tmp) / "slope_classes.tif"
        print("Resampling slope classes to coarse grid (mode)...")
        raw_bbox = raster_grid_bbox(raw)
        pipeline = make_pipeline(
            f"""
            ! read {slope_classes.as_posix()}
            ! reproject -d {settings.target_epsg} --bbox={raw_bbox} --bbox-crs={settings.target_epsg} --resolution={res_pair} -r mode
            ! edit --nodata={settings.nodata}
            ! write {settings.overwrite_arg} {settings.gdal_pipeline_creation_options} {coarse_slope.as_posix()}
            """
        )
        print(f"$ gdal raster pipeline {pipeline}")
        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()

        calculate_slope_mod_band(
            raw_calc=raw, slope_classes=coarse_slope, slope_mod=out_slope_mod
        )
    return out_slope_mod


def build_coarse_stacked_raster(
    *,
    resolution: int,
    roads_smooth: Path,
    clc_classified: Path,
    slope_classes: Path,
    output_dir: Path,
) -> Path:
    """Build a coarse 2-band stacked raster (raw aloneness + slope-modified).

    Args:
        resolution: Output pixel size in metres.
        roads_smooth: Fine road-proximity heatmap raster.
        clc_classified: Classified CLC raster / coarse CLC stack.
        slope_classes: Source slope-class raster.
        output_dir: Directory to write intermediate outputs.

    Returns:
        Path to the stacked 2-band raster.
    """
    raw = _build_coarse_encoded(
        resolution=resolution,
        roads_smooth=roads_smooth,
        country_coarse_clc=clc_classified,
        output_dir=output_dir,
    )
    slope_mod = _build_coarse_slope_mod(
        resolution=resolution,
        slope_classes=slope_classes,
        raw=raw,
        output_dir=output_dir,
    )
    return stack_raw_and_slope_bands(
        raw_calc=raw,
        slope_mod=slope_mod,
        output_dir=output_dir,
        resolution=f"{resolution},{resolution}",
    )
