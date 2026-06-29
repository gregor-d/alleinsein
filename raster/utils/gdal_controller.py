# pyright: reportMissingImports=false
"""All GDAL/osmium operations for the raster pipeline, consolidated in one file.

Previously each stage lived in its own module under ``utils/`` (osm_filter_pbf,
osm_create_gpkg, osm_rasterize_roads, clc_raster_create), and the final heatmap +
web-COG steps were inline in ``create_raster.py``. They are now all gathered here so
``create_raster.py`` is purely a workflow coordinator. Pure formatting helpers live
in ``helpers.py``; ``raster_settings.py`` holds the config and derived paths.

Each function takes its input and output files as explicit ``Path`` arguments
(threaded in by the coordinators from ``raster_settings``), while configuration
knobs (bbox, resolution, EPSG, creation options, …) and ``settings.dry_run`` are
still read from ``raster_settings``. A dry run prints the command it would run
without touching GDAL/osmium.
"""

from __future__ import annotations

import shlex
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from textwrap import dedent

from osgeo import gdal  # ty: ignore[unresolved-import]
from osgeo_utils.gdal_calc import Calc  # ty: ignore[unresolved-import]
from raster import raster_settings as settings
from raster.utils.helpers import banner


def make_pipeline(body: str) -> str:
    """Collapse a multi-line ``gdal ... pipeline`` template into one line."""
    return dedent(body).strip().replace("\n", " ")


def configure_gdal() -> None:
    """Apply the GDAL/OSM tuning options as GDAL config options."""
    gdal.SetConfigOption("GDAL_CACHEMAX", settings.gdal_cachemax)
    gdal.SetConfigOption("OSM_MAX_TMPFILE_SIZE", settings.osm_max_tmpfile_size)
    gdal.SetConfigOption("CPL_TMPDIR", settings.cpl_tmpdir)


# ---------------------------------------------------------------------------
# Step 0 - cut one country out of the Europe-wide PBF with osmium-tool
# (from eu/extract_countries.sh)
#
# Only used by the multi-country pipeline: extracts a per-country PBF on a buffered
# WGS84 bbox so the downstream road-smoothing kernel sees cross-border roads. The
# buffer ring is later discarded by the clip to the dissolved boundary.
# ---------------------------------------------------------------------------


def extract_country_pbf(europe_pbf: Path, out_pbf: Path, bbox_4326: str) -> None:
    banner(f"Extract OSM PBF: {out_pbf.name}")
    if not settings.dry_run and not europe_pbf.is_file():
        raise FileNotFoundError(
            f"Missing Europe PBF: {europe_pbf}\n"
            "Download it once: https://download.geofabrik.de/europe-latest.osm.pbf"
        )

    # complete_ways + set-bounds keep cross-border ways whole so the smoothing kernel
    # sees the neighbours' roads.
    osmium_cmd = [
        "osmium",
        "extract",
        "--bbox",
        bbox_4326,
        "--set-bounds",
        "--strategy=complete_ways",
        "-o",
        str(out_pbf),
        "--overwrite",
        str(europe_pbf),
    ]
    print("$ " + " ".join(shlex.quote(part) for part in osmium_cmd))
    if settings.dry_run:
        return

    if shutil.which("osmium") is None:
        raise RuntimeError("Missing required executable: osmium")
    subprocess.run(osmium_cmd, check=True)


# ---------------------------------------------------------------------------
# Step 1 - pre-filter the OSM PBF to highway/railway ways with osmium-tool
# (from utils/osm_filter_pbf.py)
#
# Python counterpart of utils/osm_filter_pbf.sh: shrinks the raw OSM extract so the
# later GDAL steps have far less to read.
# ---------------------------------------------------------------------------


def filter_osm_pbf(osm_latest: Path, osm_filtered: Path) -> None:
    banner("Filter OSM PBF")
    if not settings.dry_run and not osm_latest.is_file():
        raise FileNotFoundError(f"Missing OSM PBF input: {osm_latest}")

    osmium_cmd = [
        "osmium",
        "tags-filter",
        str(osm_latest),
        "w/highway",
        "w/railway",
        "-o",
        str(osm_filtered),
        "--overwrite",
    ]
    print("$ " + " ".join(shlex.quote(part) for part in osmium_cmd))
    if settings.dry_run:
        return

    if shutil.which("osmium") is None:
        raise RuntimeError("Missing required executable: osmium")
    subprocess.run(osmium_cmd, check=True)


# ---------------------------------------------------------------------------
# Step 2 - extract roads, paths and railways into a single GeoPackage
# (from utils/osm_create_gpkg.py)
#
# Python counterpart of utils/osm_create_gpkg.sh: reads the filtered OSM PBF, keeps
# only the relevant highway/railway classes, drops every attribute except geometry,
# and reprojects to TARGET_EPSG. No spatial index is written because the next step
# rasterizes line-by-line.
# ---------------------------------------------------------------------------

OSM_WHERE = (
    "highway IN ('residential','secondary','primary','tertiary','service',"
    "'living_street','primary_link','secondary_link','tertiary_link',"
    "'unclassified','trunk','motorway_link','trunk_link','motorway',"
    "'road','ramp','pedestrian','cycleway','proposed','construction',"
    "'footway','path','track','bridleway','trail') OR "
    "railway IN ('rail','light_rail','tram','subway','narrow_gauge',"
    "'funicular','monorail','miniature','preserved','construction','proposed')"
)


def create_roads_gpkg(osm_filtered: Path, roads_gpkg: Path) -> None:
    banner("Create roads GeoPackage")
    if not settings.dry_run and not osm_filtered.is_file():
        raise FileNotFoundError(f"Missing filtered OSM PBF: {osm_filtered}")

    where = f'"{OSM_WHERE}"'
    pipeline = make_pipeline(
        f"""
        ! read {osm_filtered.as_posix()} --if OSM --layer lines
        ! filter --where {where}
        ! select --fields _ogr_geometry_
        ! reproject --dst-crs {settings.target_epsg}
        ! write {roads_gpkg.as_posix()} --lco SPATIAL_INDEX=NO {settings.overwrite_arg}
        """
    )
    print(f"$ gdal vector pipeline {pipeline}")
    if settings.dry_run:
        return

    result = gdal.Run("vector pipeline", pipeline=pipeline)
    if hasattr(result, "Finalize"):
        result.Finalize()


# ---------------------------------------------------------------------------
# Step 3 - rasterize the roads and smooth them into a proximity heatmap
# (from utils/osm_rasterize_roads.py)
#
# Python counterpart of utils/osm_rasterize_roads.sh: burn the road network onto the
# shared grid, then smooth it into a 1..10 road-proximity heatmap. (Slope is applied
# separately/optionally by raster/create_slope_mod_band.sh, not here.)
# ---------------------------------------------------------------------------


def rasterize_and_smooth_roads(roads_gpkg: Path, roads_smooth: Path) -> None:
    banner("Rasterize and smooth roads")
    if not settings.dry_run and not roads_gpkg.is_file():
        raise FileNotFoundError(f"Missing roads GeoPackage: {roads_gpkg}")

    # 1. Burn the road network onto the shared grid (roads = 4, elsewhere = 0).
    start = time.monotonic()
    pipeline = make_pipeline(
        f"""
        ! read {roads_gpkg.as_posix()}
        ! rasterize --resolution {settings.resolution} --extent {settings.bbox} --burn 4 --target-aligned-pixels --init 0 --nodata {settings.nodata} --datatype {settings.data_type} --all-touched
        ! write {settings.overwrite_arg} {settings.gtiff} {settings.roads_rasterized.as_posix()}
        """
    )
    print(f"$ gdal pipeline {pipeline}")
    if not settings.dry_run:
        result = gdal.Run("pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()
    duration = int(time.monotonic() - start)
    print(f"{duration // 60} minutes and {duration % 60} seconds elapsed.")

    # 2. Smooth the burned roads into the 1..10 proximity heatmap.
    start = time.monotonic()
    pipeline = make_pipeline(
        f"""
        ! read {settings.roads_rasterized.as_posix()}
        ! neighbours --method mean --size 5 --kernel gaussian
        ! reproject --resolution 100,100 -r sum
        ! resize --resolution {settings.resolution} -r bilinear
        ! neighbours --method mean --size 5 --kernel gaussian --nodata {settings.nodata}
        ! scale --src-min 0 --src-max 10 --dst-min 1 --dst-max 10 --ot {settings.data_type} --exponent 0.25
        ! write {settings.overwrite_arg} {settings.gtiff} {roads_smooth.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    if not settings.dry_run:
        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()
    duration = int(time.monotonic() - start)
    print(f"{duration // 60} minutes and {duration % 60} seconds elapsed.")


# ---------------------------------------------------------------------------
# Step 4 - remap and stack CLC land-cover classes into a 5-band one-hot raster
# (from utils/clc_raster_create.py)
#
# Python counterpart of utils/clc_raster_create.sh: clip + reclassify the CLC source
# into the five custom classes, then build a one-hot band per class (nature, farm,
# park, urban, water) and stack them at the raster resolution.
# ---------------------------------------------------------------------------

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
        ! write {settings.gtiff} {settings.overwrite_arg} {clc_classified.as_posix()}
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
            ! write {settings.gtiff} {settings.overwrite_arg} {out.as_posix()}
            """
        )
        print(f"$ gdal raster pipeline {pipeline}")
        if not settings.dry_run:
            result = gdal.Run("raster pipeline", pipeline=pipeline)
            if hasattr(result, "Finalize"):
                result.Finalize()


# ---------------------------------------------------------------------------
# Step 5a - encode the masked road heatmap into a single band
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
# Step 5b - clip, reproject and write the Web Mercator COG
# (previously inline in create_raster.py)
# ---------------------------------------------------------------------------


def finalize_web_cog(
    src: Path,
    out_cog: Path,
    reprojected: Path,
    bounds_gpkg: Path,
    layer: str | None = None,
) -> None:
    """Turn a raster on the TARGET_EPSG grid into the final web product: clip it
    to the AREA bounds, reproject to WEB_EPSG, then write a Web Mercator
    tile-matrix aligned COG with overviews. Shared tail of the heatmap pipeline
    and the slope-mod band (mirrors finalize_web_cog in utils/sh/raster_lib.sh).
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
    """Write a web-optimized COG from SRC via rio-cogeo: ``web_optimized`` reprojects
    to WEB_EPSG and aligns to the tiling scheme. nearest everywhere preserves the
    exact categorical encoding (no averaging of the composite codes); 512 blocks
    match the frontend tile size. Shared tail of the fine, slope-mod and coarse COGs.
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
    # band (2, from calculate_slope_mod_band) into a single 2-band raster on the
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

    finalize_web_cog(
        settings.raster_stack, output_cog, settings.reprojected, bounds_gpkg
    )
    print(f"Successfully created 2-band masked COG raster: {output_cog}")


# ---------------------------------------------------------------------------
# Step 5c - mosaic per-country rasters onto the shared grid (multi-country)
# (used by eu/create_eu_raster.py)
#
# Merge the per-country encoded heatmaps (each already on the shared TARGET_EPSG
# grid, on its own buffered extent) into a single virtual raster. A VRT references
# the sources in place, so no pixels are copied; the buffer rings are discarded by
# the single clip to the dissolved boundary in the finalize_web_cog tail.
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
    vrt = gdal.BuildVRT(str(mosaic_vrt), [str(raster) for raster in rasters], options=options)
    vrt.FlushCache()
    vrt = None  # close the dataset so the .vrt is fully written to disk


# ---------------------------------------------------------------------------
# Step 6 - clip + reclassify the EU DEM slope into slope classes
# (from utils/dem_create_raster.sh)
#
# Clip + resample the EPSG:3035 slope onto the shared BBOX/20m grid (matching
# roads/CLC by construction: same origin and size), then reclassify into the slope
# classes (1..4, flat..steep). Slope is in odd units, so slope_classes.txt maps it
# back to degree-based classes; nearest keeps the original values intact through the
# resample, so reclassifying afterwards gives the same result.
# ---------------------------------------------------------------------------


def create_slope_classes(
    dem_slope_source: Path, slope_mapping: Path, slope_classes: Path
) -> None:
    banner("Create slope classes raster")
    if not settings.dry_run:
        if not dem_slope_source.is_file():
            raise FileNotFoundError(
                f"Missing DEM slope input raster: {dem_slope_source}"
            )
        if not slope_mapping.is_file():
            raise FileNotFoundError(f"Missing slope mapping file: {slope_mapping}")

    pipeline = make_pipeline(
        f"""
        ! read {dem_slope_source.as_posix()}
        ! reproject -d {settings.target_epsg} --bbox={settings.bbox} --bbox-crs={settings.target_epsg} --resolution={settings.resolution} -r nearest
        ! reclassify --mapping=@{slope_mapping.as_posix()} --ot={settings.data_type}
        ! edit --nodata={settings.nodata}
        ! write {settings.gtiff} {settings.overwrite_arg} {slope_classes.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    if not settings.dry_run:
        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()


# ---------------------------------------------------------------------------
# Step 7 - rewrite the aloneness band with a per-class slope penalty (band 2)
# (from create_slope_mod_band.sh)
#
# Rewrites the WHOLE aloneness band: each category pixel's within-class road score
# (1..10) has the slope penalty for its slope class subtracted and is re-clamped to
# >=1, so steeper terrain reads as more secluded across the full ramp. The worst
# within-category score (10) is never modified. The result stays in the exact same
# per-land-cover encoding (nature 1..10, farm 11..20, park 21..30, urban 31..40,
# water 200); water/nodata/unclassified pass through unchanged. muparser is buggy,
# so this stays in gdal_calc.
# ---------------------------------------------------------------------------

# Points subtracted from a category pixel's road score for its slope class
# (1=flat .. 4=steep); slope outside 1..4 (incl. nodata) subtracts nothing.
SLOPE_PENALTY = {1: 0, 2: 2, 3: 3, 4: 4}


def calculate_slope_mod_band(
    raw_calc: Path, slope_classes: Path, slope_mod_modified: Path
) -> None:
    banner("Calculate slope-modified band")
    if not settings.dry_run:
        if not raw_calc.is_file():
            raise FileNotFoundError(
                f"Missing raw heatmap raster: {raw_calc} (run the heatmap step first)"
            )
        if not slope_classes.is_file():
            raise FileNotFoundError(
                f"Missing slope classes raster: {slope_classes} "
                "(run create_slope_classes first)"
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
    print(f"gdal_calc.Calc -> {slope_mod_modified}")
    if not settings.dry_run:
        Calc(
            calc=calc,
            outfile=str(slope_mod_modified),
            type=settings.data_type,
            NoDataValue=settings.nodata,
            creation_options=list(settings.gtiff_creation_options),
            overwrite=settings.overwrite,
            quiet=False,
            P=str(raw_calc),
            P_band=1,
            G=str(slope_classes),
            G_band=1,
        )


# ---------------------------------------------------------------------------
# Step 8 - downsample the fine inputs into a coarse-resolution COG
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
