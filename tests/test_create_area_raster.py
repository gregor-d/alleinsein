"""Unit tests for raster.create_area_raster."""

from __future__ import annotations

import argparse

from raster import create_area_raster
from raster import raster_settings as settings
from raster.utils import bounds, gdal_controller, osm


def test_needs_prep_skips_when_all_targets_exist(tmp_path):
    first = tmp_path / "first.tif"
    first.touch()
    second = tmp_path / "second.tif"
    second.touch()
    args = argparse.Namespace(force_prep=False)

    assert not create_area_raster._needs_prep(args, first, second)


def test_needs_prep_runs_when_any_target_missing(tmp_path):
    existing = tmp_path / "exists.tif"
    existing.touch()
    args = argparse.Namespace(force_prep=False)

    assert create_area_raster._needs_prep(args, existing, tmp_path / "missing.tif")


def test_ensure_area_gpkg_reuses_existing_boundary(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "bounds_dir", tmp_path)
    (tmp_path / "austria.gpkg").touch()
    calls = []
    monkeypatch.setattr(bounds, "geocode_area_to_gpkg", lambda area: calls.append(area))

    create_area_raster._ensure_area_gpkg("austria")

    assert calls == []


def test_ensure_area_gpkg_geocodes_missing_boundary(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "bounds_dir", tmp_path)
    calls = []
    monkeypatch.setattr(bounds, "geocode_area_to_gpkg", lambda area: calls.append(area))

    create_area_raster._ensure_area_gpkg("austria")

    assert calls == ["austria"]


def test_ensure_source_roads_pbf_reuses_existing_filtered_pbf(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "osm_dir", tmp_path)
    monkeypatch.setattr(settings, "europe_pbf_name", "europe-123.osm.pbf")
    europe_roads = tmp_path / "europe-123-roads.osm.pbf"
    europe_roads.touch()
    calls = []
    monkeypatch.setattr(osm, "filter_osm_pbf", lambda **kwargs: calls.append(kwargs))

    create_area_raster._ensure_source_roads_pbf(argparse.Namespace(force_prep=False))

    assert calls == []


def test_ensure_source_roads_pbf_filters_when_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "osm_dir", tmp_path)
    monkeypatch.setattr(settings, "europe_pbf_name", "europe-123.osm.pbf")
    calls = []
    monkeypatch.setattr(osm, "filter_osm_pbf", lambda **kwargs: calls.append(kwargs))

    create_area_raster._ensure_source_roads_pbf(argparse.Namespace(force_prep=False))

    assert calls == [
        {
            "osm_latest": tmp_path / "europe-123.osm.pbf",
            "osm_filtered": tmp_path / "europe-123-roads.osm.pbf",
        }
    ]


def test_run_single_country_builds_cog(monkeypatch, tmp_path):
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    monkeypatch.setattr(settings, "output_dir", out_dir)
    monkeypatch.setattr(settings, "bounds_dir", tmp_path / "bounds")
    monkeypatch.setattr(settings, "raster_version", "v9")
    ensure_calls = []
    monkeypatch.setattr(
        create_area_raster,
        "_ensure_source_roads_pbf",
        lambda args: ensure_calls.append(args),
    )
    country_tif = tmp_path / "czech_republic_3035.tif"
    task_calls = []

    def fake_country_task(*, country, args):
        task_calls.append(country)
        return country_tif

    monkeypatch.setattr(create_area_raster, "_country_task", fake_country_task)
    cog_calls = []
    monkeypatch.setattr(
        gdal_controller,
        "create_web_cog_from_stacked",
        lambda **kwargs: cog_calls.append(kwargs),
    )

    args = argparse.Namespace(force_prep=False, country="Czech Republic", jobs=1)
    create_area_raster._run_single_country(args)

    assert ensure_calls == [args]
    assert task_calls == ["czech_republic"]
    assert cog_calls == [
        {
            "stacked_3035": country_tif,
            "output_cog": out_dir / "czech_republic_20m_v9.tif",
            "bounds_gpkg": tmp_path / "bounds" / "czech_republic.gpkg",
            "boundary_name": "czech_republic",
        }
    ]


def test_run_single_country_reuses_existing_cog(monkeypatch, tmp_path, capsys):
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    monkeypatch.setattr(settings, "output_dir", out_dir)
    monkeypatch.setattr(settings, "bounds_dir", tmp_path / "bounds")
    monkeypatch.setattr(settings, "raster_version", "v9")
    existing_cog = out_dir / "austria_20m_v9.tif"
    existing_cog.touch()
    monkeypatch.setattr(
        create_area_raster,
        "_ensure_source_roads_pbf",
        lambda args: None,
    )
    monkeypatch.setattr(
        create_area_raster,
        "_country_task",
        lambda **kwargs: tmp_path / "austria_3035.tif",
    )
    cog_calls = []
    monkeypatch.setattr(
        gdal_controller,
        "create_web_cog_from_stacked",
        lambda **kwargs: cog_calls.append(kwargs),
    )

    create_area_raster._run_single_country(
        argparse.Namespace(force_prep=False, country="Austria", jobs=1)
    )

    assert cog_calls == []
    assert f"reuse existing {existing_cog}" in capsys.readouterr().out
