#!/usr/bin/env python3
"""Print and timing helpers for raster workflow output."""

from __future__ import annotations

import time
from collections.abc import Iterable, Iterator
from contextlib import contextmanager

SEPARATOR = "=" * 100


def slugify_area(name: str) -> str:
    """Normalize a country/area name to its gpkg key."""
    return name.lower().replace(" ", "_")


def slugify_areas(names: Iterable[str]) -> list[str]:
    """Normalize a sequence of country/area names to their gpkg keys."""
    return [slugify_area(name) for name in names]


def banner(title: str) -> None:
    """Print a title centered between horizontal separators."""
    print()
    print(SEPARATOR)
    print(title)
    print(SEPARATOR)


def format_elapsed(seconds: float) -> str:
    """Format elapsed time in seconds to a human-readable string."""
    if seconds < 60:
        return f"{seconds:.2f}s"

    minutes, remaining_seconds = divmod(seconds, 60)
    if minutes < 60:
        return f"{int(minutes)}m {remaining_seconds:04.1f}s"

    hours, remaining_minutes = divmod(minutes, 60)
    return f"{int(hours)}h {int(remaining_minutes):02d}m {remaining_seconds:04.1f}s"


@contextmanager
def timed_step(label: str) -> Iterator[None]:
    """Context manager to measure and log execution time of a step."""
    start = time.perf_counter()
    try:
        yield
    except Exception:
        elapsed = time.perf_counter() - start
        print(f"[time] {label} failed after {format_elapsed(elapsed)}")
        raise
    else:
        elapsed = time.perf_counter() - start
        print(f"[time] {label}: {format_elapsed(elapsed)}")
