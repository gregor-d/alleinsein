"""Step 1 - pre-filter the OSM PBF to highway/railway ways with osmium-tool.

Python counterpart of utils/osm_filter_pbf.sh: shrinks the raw OSM extract so the
later GDAL steps have far less to read.
"""

from __future__ import annotations

import shlex
import shutil
import subprocess

from raster import raster_settings as settings
from raster.utils.raster_helpers import banner


def filter_osm_pbf() -> None:
    banner("Filter OSM PBF")
    if not settings.dry_run and not settings.osm_latest.is_file():
        raise FileNotFoundError(f"Missing OSM PBF input: {settings.osm_latest}")

    osmium_cmd = [
        "osmium",
        "tags-filter",
        str(settings.osm_latest),
        "w/highway",
        "w/railway",
        "-o",
        str(settings.osm_filtered),
        "--overwrite",
    ]
    print("$ " + " ".join(shlex.quote(part) for part in osmium_cmd))
    if settings.dry_run:
        return

    if shutil.which("osmium") is None:
        raise RuntimeError("Missing required executable: osmium")
    subprocess.run(osmium_cmd, check=True)
