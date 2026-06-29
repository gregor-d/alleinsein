# pyright: reportMissingImports=false
"""Step 2 - extract roads, paths and railways into a single GeoPackage.

Python counterpart of utils/osm_create_gpkg.sh: reads the filtered OSM PBF, keeps
only the relevant highway/railway classes, drops every attribute except geometry,
and reprojects to TARGET_EPSG. No spatial index is written because the next step
rasterizes line-by-line.
"""

from __future__ import annotations

from osgeo import gdal  # ty: ignore[unresolved-import]
from raster import raster_settings as settings
from raster.utils.raster_helpers import banner, make_pipeline

OSM_WHERE = (
    "highway IN ('residential','secondary','primary','tertiary','service',"
    "'living_street','primary_link','secondary_link','tertiary_link',"
    "'unclassified','trunk','motorway_link','trunk_link','motorway',"
    "'road','ramp','pedestrian','cycleway','proposed','construction',"
    "'footway','path','track','bridleway','trail') OR "
    "railway IN ('rail','light_rail','tram','subway','narrow_gauge',"
    "'funicular','monorail','miniature','preserved','construction','proposed')"
)


def create_roads_gpkg() -> None:
    banner("Create roads GeoPackage")
    if not settings.dry_run and not settings.osm_filtered.is_file():
        raise FileNotFoundError(f"Missing filtered OSM PBF: {settings.osm_filtered}")

    where = f'"{OSM_WHERE}"'
    pipeline = make_pipeline(
        f"""
        ! read {settings.osm_filtered.as_posix()} --if OSM --layer lines
        ! filter --where {where}
        ! select --fields _ogr_geometry_
        ! reproject --dst-crs {settings.target_epsg}
        ! write {settings.roads_gpkg.as_posix()} --lco SPATIAL_INDEX=NO {settings.overwrite_arg}
        """
    )
    print(f"$ gdal vector pipeline {pipeline}")
    if settings.dry_run:
        return

    result = gdal.Run("vector pipeline", pipeline=pipeline)
    if hasattr(result, "Finalize"):
        result.Finalize()
