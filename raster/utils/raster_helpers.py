"""Tiny formatting helpers shared by the raster pipeline steps."""

from __future__ import annotations

from textwrap import dedent

SEPARATOR = "=" * 55


def banner(title: str) -> None:
    """Print a section header in the same style as the shell pipeline."""
    print(SEPARATOR)
    print(title)
    print(SEPARATOR)


def make_pipeline(body: str) -> str:
    """Collapse a multi-line ``gdal ... pipeline`` template into one line."""
    return dedent(body).strip().replace("\n", " ")
