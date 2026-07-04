# Seamless zoom tiers — removing the coarse→fine color seam

## Problem

When the map crosses the tier boundary from a coarse-raster tier to the fine 20 m
source (titiler zoom **z8 → z9**, i.e. `eu_320m` handing off to `eu_20m`), the colors
visibly jump. The displayed color is `colormap(pixel value)`, and both the coarse tiers
and the fine COG carry the _same_ 2-band encoding, so a color switch means the **pixel
value at the same ground resolution differs between the two files** at the boundary.

### Why the values differ

The encoding is **class-partitioned** (see [`encode_heatmap`](../../raster/utils/gdal_controller.py)):

```
where(F==1, 200, A*B + (A+10)*C + (A+20)*D + (A+30)*E)
```

where `A` = road-proximity heatmap (1–10) and `B–F` are one-hot land-cover flags:

| class  | value range    |
| ------ | -------------- |
| nature | 1–10 (`A`)     |
| farm   | 11–20 (`A+10`) |
| park   | 21–30 (`A+20`) |
| urban  | 31–40 (`A+30`) |
| water  | 200            |

The two sides of the boundary are built by different methods:

| side                        | class               | `A` value             | how                                                                                                              |
| --------------------------- | ------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **coarse tier** (z8)        | mode of window      | **average of window** | resamples the _inputs_ before encoding: `-r average` on roads, `-r mode` on CLC/slope, then encode               |
| **fine 20 m overview** (z9) | arbitrary sub-pixel | arbitrary sub-pixel   | `overview_resampling="nearest"` decimates the _already-encoded_ value — one 20 m pixel wins the whole 160 m cell |

So at z8→z9 both the land-cover class shown and the `A` value change → color pop.

### Why we cannot just "fix the resampler"

-   **`average` on the fine overviews is invalid.** Averaging encoded values crosses the
    class bands (e.g. nature-8 `8` + urban-2 `32` → `20` = "park, aloneness 0", a color
    belonging to neither) and destroys water=`200`. Only value-preserving resamplers
    (`nearest`, `mode`) are valid on the encoded band.
-   **`mode` on the fine overviews only half-fixes it.** Mode picks the dominant encoded
    value, so it fixes the _class_ flicker but still shows one pixel's `A` instead of the
    averaged `A` the coarse tier computes. The `A` jump remains.

The only place that can average `A` _and_ mode the class is the **coarse builder**,
because it resamples the separate input layers _before_ they are fused by the encoding.
Once encoded, `A` and class can no longer be separated, so no single GDAL overview
resampler can reproduce "average-`A` + mode-class".

## Fix

Two changes, with a clear division of labor.

### 1. (Primary) Extend the coarse tiers — Option B

Add finer coarse tiers built through the existing average-`A` + mode-class pipeline so
the mismatched mid-zooms (z9–z11) are served by tiles that are built the _same way_ as
the tiers below them. Raise the fine 20 m file's `max_zoom` so it only serves near its
native resolution (~z12+), where you see its _base_ data, not the mismatched overviews.

-   **`raster/raster_settings.py`** — extend `coarse_resolutions`:
    ```python
    # currently: (320, 640, 1280)
    coarse_resolutions: tuple[int, ...] = (40, 80, 160, 320, 640, 1280)
    ```
-   **`backend/main.py`** — add the new tier files + zoom breaks in `Settings` /
    `raster_tiers`, keeping them coarsest-first / ascending `max_zoom`:

    | titiler z | ideal res (equator / @50°N) | raster         |
    | --------- | --------------------------- | -------------- |
    | ≤6        | 2445 / 1570 m               | `1280m`        |
    | 7         | 1222 / 790 m                | `640m`         |
    | 8         | 611 / 390 m                 | `320m`         |
    | 9         | 305 / 196 m                 | `160m` ← new   |
    | 10        | 152 / 98 m                  | `80m` ← new    |
    | 11        | 76 / 49 m                   | `40m` ← new    |
    | 12+       | 38 / 24 m                   | `20m` (native) |

    So the 20 m file's `max_zoom` moves from covering z9+ to covering z12+ (`99`/finest
    tier unchanged as the catch-all, but now only reached at ≥ z12).

This eliminates the seam: every boundary is now between two tiers built by the _same_
average-`A` + mode-class recipe.

### 2. (Insurance) Use `mode` on the fine COG overviews

Change the fine 20 m COG's overview resampling from `nearest` to `mode`
([`write_web_cog`](../../raster/utils/gdal_controller.py), the `overview_resampling`
argument). This is **shared by the coarse build too**, so it must be parameterized —
fine COG uses `mode`, and the coarse builder keeps its input-resampling untouched
(`average` for roads, `mode` for CLC/slope). Do **not** switch it globally to `average`.

`mode` is strictly better than `nearest` for this encoding regardless of Option B:
valid values, preserves the dominant class, keeps water clean. After Option B it only
affects the single residual boundary (finest coarse tier ↔ 20 m file) and only when that
tile is served from an overview rather than the base — hence "insurance", not a second
independent fix.

## Division of labor / expectations

-   **Option B removes the seam.** Both sides of every boundary use average-`A` + mode-class.
-   **`mode` on the fine COG is the trim** for the one residual coarse→fine boundary.
-   The two do **not** stack into "seam gone twice". If forced to pick one, keep the coarse
    tiers, not the `mode` change.
-   `average` must **never** be used on the fine COG's encoded overviews.

## Notes / follow-ups

-   Do **not** change the coarse builder's road resampling to `mode` — `average` is correct
    for the continuous `A` gradient; `mode` would make it blocky.
-   Once the 20 m file only serves ~z12+, most of its 9-level overview pyramid (down to
    ~10 km) becomes dead weight superseded by the coarse tiers. Keeping it is harmless
    (tiny, fast to build), so trimming is optional.
-   Building three extra tiers (40/80/160 m) adds build time and three more files to ship
    to the tile host — weigh against the visual gain if bandwidth/storage is tight.
-   Verify the actual titiler overview-selection at the z11→z12 boundary (base vs L1/40 m
    overview) to confirm whether the `mode` insurance is exercised there.
