# pyright: reportMissingImports=false
"""Step 4 - remap and stack CLC land-cover classes into a 5-band one-hot raster.

Python counterpart of utils/clc_raster_create.sh: clip + reclassify the CLC source
into the five custom classes, then build a one-hot band per class (nature, farm,
park, urban, water) and stack them at the raster resolution.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from raster import raster_settings as settings
from raster.utils.raster_helpers import banner, make_pipeline

CLASS_CODES = (1, 2, 3, 4, 5)


def create_clc_stack() -> None:
    banner("Create CLC raster stack")
    if not settings.dry_run:
        if not settings.clc_source.is_file():
            raise FileNotFoundError(f"Missing CLC input raster: {settings.clc_source}")
        if not settings.clc_mapping.is_file():
            raise FileNotFoundError(f"Missing CLC mapping file: {settings.clc_mapping}")

    pipeline = make_pipeline(
        f"""
        ! read {settings.clc_source.as_posix()}
        ! clip --bbox={settings.bbox} --bbox-crs={settings.target_epsg} --allow-bbox-outside-source
        ! reclassify --mapping=@{settings.clc_mapping.as_posix()} --ot={settings.data_type}
        ! edit --nodata={settings.nodata}
        ! write {settings.gtiff} {settings.overwrite_arg} {settings.clc_classified.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    if not settings.dry_run:
        from osgeo import gdal  # ty: ignore[unresolved-import]

        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()

    with tempfile.TemporaryDirectory(prefix="clc_", dir=settings.temp_dir) as tmp:
        band_files = []
        for class_code in CLASS_CODES:
            class_dataset = Path(tmp) / f"clc_{class_code}.gdalg.json"
            band_files.append(class_dataset)
            mapping = f'"{class_code}=1;DEFAULT=0;NO_DATA=NO_DATA"'
            pipeline = make_pipeline(
                f"""
                ! read {settings.clc_classified.as_posix()}
                ! reclassify --mapping {mapping} --ot={settings.data_type}
                ! write --of=GDALG {settings.overwrite_arg} {class_dataset.as_posix()}
                """
            )
            print(f"$ gdal raster pipeline {pipeline}")
            if not settings.dry_run:
                from osgeo import gdal  # ty: ignore[unresolved-import]

                result = gdal.Run("raster pipeline", pipeline=pipeline)
                if hasattr(result, "Finalize"):
                    result.Finalize()

        band_inputs = " ".join(path.as_posix() for path in band_files)
        pipeline = make_pipeline(
            f"""
            ! stack {band_inputs} --dst-nodata {settings.nodata} --resolution {settings.resolution}
            ! write {settings.gtiff} {settings.overwrite_arg} {settings.clc_stack.as_posix()}
            """
        )
        print(f"$ gdal raster pipeline {pipeline}")
        if not settings.dry_run:
            from osgeo import gdal  # ty: ignore[unresolved-import]

            result = gdal.Run("raster pipeline", pipeline=pipeline)
            if hasattr(result, "Finalize"):
                result.Finalize()
