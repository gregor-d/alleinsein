# pyright: reportMissingImports=false
"""Shared low-level GDAL helpers used by the per-domain stage modules (``osm``,
``clc``, ``dem``) and the assembly module (``gdal_controller``).

Kept free of any dependency on those modules so they can all import it without
creating import cycles. Configuration knobs come from ``raster_settings``.
"""

from __future__ import annotations

from textwrap import dedent

from osgeo import gdal  # ty: ignore[unresolved-import]
from raster import raster_settings as settings


def make_pipeline(body: str) -> str:
    """Collapse a multi-line ``gdal ... pipeline`` template into one line."""
    return dedent(body).strip().replace("\n", " ")


def configure_gdal() -> None:
    """Apply the GDAL/OSM tuning options as GDAL config options."""
    gdal.SetConfigOption("GDAL_CACHEMAX", settings.gdal_cachemax)
    gdal.SetConfigOption("OSM_MAX_TMPFILE_SIZE", settings.osm_max_tmpfile_size)
    gdal.SetConfigOption("CPL_TMPDIR", settings.cpl_tmpdir)
