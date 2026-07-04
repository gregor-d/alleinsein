"""Unit tests for raster.utils.bounds."""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest

from raster.utils import bounds


@pytest.fixture
def bounds_dir(monkeypatch, tmp_path):
    """Redirect BOUNDS_DIR into the test tmp dir."""
    directory = tmp_path / "bounds"
    directory.mkdir()
    monkeypatch.setattr(bounds, "BOUNDS_DIR", directory)
    return directory


@pytest.fixture
def make_area_gpkg(bounds_dir):
    """Write a rectangular EPSG:3035 boundary gpkg for ``area`` into BOUNDS_DIR."""
    import geopandas as gpd
    from shapely.geometry import box

    def _make(area: str, *, minx, miny, maxx, maxy):
        path = bounds_dir / f"{area}.gpkg"
        gpd.GeoDataFrame(
            {"name": [area]},
            geometry=[box(minx, miny, maxx, maxy)],
            crs="EPSG:3035",
        ).to_file(path, layer=area, driver="GPKG")
        return path

    return _make


def test_warn_if_over_envelope_reports_exceeded_edges(capsys):
    from shapely.geometry import box

    bounds._warn_if_over_envelope(
        area="atlantis", geom_4326=box(-20.0, 30.0, 10.0, 50.0)
    )

    out = capsys.readouterr().out
    assert "WARNING: 'atlantis'" in out
    assert "west lon" in out
    assert "south lat" in out
    assert "east lon" not in out


def test_get_bbox_buffers_and_snaps(make_area_gpkg):
    # Mid-interval coordinates so the CRS round trip (<1 m wobble) cannot flip the
    # floor/ceil snapping.
    make_area_gpkg(
        "testland",
        minx=4_300_050,
        miny=2_700_050,
        maxx=4_310_050,
        maxy=2_710_050,
    )

    bbox = bounds.get_bbox(area="testland", buffer_m=1000, snap_m=100)

    assert bbox == "4299000,2699000,4311100,2711100"


def test_get_bbox_without_buffer_returns_bounds(make_area_gpkg):
    make_area_gpkg(
        "testland", minx=4_300_000, miny=2_700_000, maxx=4_310_000, maxy=2_710_000
    )

    bbox = bounds.get_bbox(area="testland")

    minx, miny, maxx, maxy = (float(value) for value in bbox.split(","))
    assert minx == pytest.approx(4_300_000, abs=1)
    assert miny == pytest.approx(2_700_000, abs=1)
    assert maxx == pytest.approx(4_310_000, abs=1)
    assert maxy == pytest.approx(2_710_000, abs=1)


def test_get_bbox_4326_covers_source_rectangle(make_area_gpkg):
    import geopandas as gpd
    from shapely.geometry import box

    bbox_3035 = "4300000,2700000,4310000,2710000"

    bbox_4326 = bounds.get_bbox_4326(bbox_3035)

    w, s, e, n = (float(value) for value in bbox_4326.split(","))
    assert w < e
    assert s < n
    # The returned WGS84 box must fully cover the reprojected source rectangle.
    source_4326 = (
        gpd.GeoSeries(
            [box(4_300_000, 2_700_000, 4_310_000, 2_710_000)], crs="EPSG:3035"
        )
        .to_crs("EPSG:4326")
        .iloc[0]
    )
    assert box(w, s, e, n).buffer(1e-6).covers(source_4326)


def test_create_dissolved_bounds_missing_area_raises(bounds_dir):
    with pytest.raises(FileNotFoundError, match=r"run 'bounds\.py area'"):
        bounds.create_dissolved_bounds(output_area="combined", areas=["nowhere"])


def test_create_dissolved_bounds_unions_areas(bounds_dir, make_area_gpkg):
    import geopandas as gpd

    make_area_gpkg(
        "west", minx=4_300_000, miny=2_700_000, maxx=4_310_000, maxy=2_710_000
    )
    make_area_gpkg(
        "east", minx=4_305_000, miny=2_700_000, maxx=4_315_000, maxy=2_710_000
    )

    out = bounds.create_dissolved_bounds(output_area="combined", areas=["west", "east"])

    assert out == bounds_dir / "combined.gpkg"
    dissolved = gpd.read_file(out, layer="combined")
    assert len(dissolved) == 1
    # 15 km x 10 km union (5 km overlap); CRS round trip costs well under 1%.
    assert dissolved.geometry.iloc[0].area == pytest.approx(1.5e8, rel=1e-2)


def test_create_geojson_mask_inverts_area(tmp_path, make_area_gpkg):
    import geopandas as gpd
    from shapely.geometry import Point

    make_area_gpkg(
        "testland", minx=4_300_000, miny=2_700_000, maxx=4_310_000, maxy=2_710_000
    )
    output = tmp_path / "mask.geojson"

    result = bounds._create_geojson_mask(area="testland", output=output)

    assert result == output
    mask = gpd.read_file(output)
    assert len(mask) == 1
    mask_geom = mask.geometry.iloc[0]
    inside = (
        gpd.GeoSeries([Point(4_305_000, 2_705_000)], crs="EPSG:3035")
        .to_crs("EPSG:4326")
        .iloc[0]
    )
    assert not mask_geom.contains(inside)  # the area itself is cut out
    assert mask_geom.contains(Point(20.0, 60.0))  # rest of the world is masked


@pytest.fixture
def fake_osmnx(monkeypatch):
    """Inject a fake ``osmnx`` module; returns a dict to configure the geocoder."""
    state: dict[str, Any] = {"queries": [], "result": None, "error": None}

    def geocode_to_gdf(query):
        state["queries"].append(query)
        if state["error"] is not None:
            raise state["error"]
        return state["result"]

    fake = types.SimpleNamespace(
        geocoder=types.SimpleNamespace(geocode_to_gdf=geocode_to_gdf)
    )
    monkeypatch.setitem(sys.modules, "osmnx", fake)
    return state


def test_geocode_area_writes_boundary_gpkg(bounds_dir, fake_osmnx):
    import geopandas as gpd
    from shapely.geometry import box

    fake_osmnx["result"] = gpd.GeoDataFrame(
        {"name": ["testland"]}, geometry=[box(9.0, 47.0, 10.0, 48.0)], crs="EPSG:4326"
    )

    out = bounds.geocode_area_to_gpkg("testland")

    assert out == bounds_dir / "testland.gpkg"
    written = gpd.read_file(out, layer="testland")
    assert written.crs.to_epsg() == 3035
    assert len(written) == 1
