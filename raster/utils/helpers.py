"""Tiny formatting helpers shared by the raster pipeline steps.

Pure print utilities with no GDAL dependency, kept out of ``gdal_controller`` so
they can be imported by the coordinators too.
"""

from __future__ import annotations

SEPARATOR = "=" * 55


def banner(title: str) -> None:
    """Print a section header in the same style as the shell pipeline."""
    print(SEPARATOR)
    print(title)
    print(SEPARATOR)
