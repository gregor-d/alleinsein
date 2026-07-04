"""Unit tests for raster.utils.helpers."""

from __future__ import annotations

import pytest

from raster.utils.helpers import slugify_area, slugify_areas


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Czech Republic", "czech_republic"),
        ("Austria", "austria"),
    ],
)
def test_slugify_area(name, expected):
    assert slugify_area(name) == expected


@pytest.mark.parametrize(
    ("names", "expected"),
    [
        (("Czech Republic", "Austria"), ["czech_republic", "austria"]),
        ([], []),
    ],
)
def test_slugify_areas(names, expected):
    assert slugify_areas(names) == expected
