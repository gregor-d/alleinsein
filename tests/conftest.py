"""Shared fixtures for the raster pipeline unit tests."""

from __future__ import annotations

import pytest


@pytest.fixture
def gdal_run_calls(monkeypatch):
    """Replace gdal.Run with a stub recording ``(command, pipeline)`` calls.

    Every raster module imports the same ``osgeo.gdal`` module object, so one
    patch covers gdal_common, osm, clc, dem and gdal_controller alike.
    """
    from osgeo import gdal

    calls: list[tuple[str, str]] = []

    def fake_run(command, pipeline):
        calls.append((command, pipeline))
        return object()  # no Finalize attribute -> skipped by callers

    monkeypatch.setattr(gdal, "Run", fake_run)
    return calls


@pytest.fixture
def settings_temp_dir(monkeypatch, tmp_path):
    """Point settings.temp_dir at the test tmp dir (TemporaryDirectory parents)."""
    from raster import raster_settings as settings

    temp_dir = tmp_path / "gdal_tmp"
    temp_dir.mkdir()
    monkeypatch.setattr(settings, "temp_dir", temp_dir)
    return temp_dir


@pytest.fixture
def make_raster(tmp_path):
    """Factory writing a small Byte GeoTIFF on a known EPSG:3035 grid.

    ``fill`` sets a constant per band (scalar or one value per band); ``data``
    takes one 2D array per band and overrides ``fill``.
    """
    from osgeo import gdal, osr

    def _make(
        name: str = "raster.tif",
        *,
        width: int = 4,
        height: int = 4,
        bands: int = 1,
        origin: tuple[float, float] = (4_000_000.0, 3_000_000.0),
        pixel_size: float = 20.0,
        fill=None,
        data=None,
        nodata: int | None = None,
        epsg: int = 3035,
    ):
        path = tmp_path / name
        driver = gdal.GetDriverByName("GTiff")
        dataset = driver.Create(str(path), width, height, bands, gdal.GDT_Byte)
        dataset.SetGeoTransform(
            (origin[0], pixel_size, 0.0, origin[1], 0.0, -pixel_size)
        )
        srs = osr.SpatialReference()
        srs.ImportFromEPSG(epsg)
        dataset.SetProjection(srs.ExportToWkt())
        for band_index in range(1, bands + 1):
            band = dataset.GetRasterBand(band_index)
            if nodata is not None:
                band.SetNoDataValue(nodata)
            if data is not None:
                band.WriteArray(data[band_index - 1])
            elif fill is not None:
                value = (
                    fill[band_index - 1] if isinstance(fill, (list, tuple)) else fill
                )
                band.Fill(value)
        dataset.FlushCache()
        dataset = None
        return path

    return _make
