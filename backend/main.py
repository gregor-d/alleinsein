from pathlib import Path
from typing import cast

import morecantile
from fastapi import FastAPI, status
from morecantile.defaults import TileMatrixSets
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.middleware.cors import CORSMiddleware
from titiler.core.errors import DEFAULT_STATUS_CODES, add_exception_handlers
from titiler.core.factory import TilerFactory

from backend._version import __version__

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent


class RasterTier(BaseModel):
    """One zoom band of the data product. `raster` is served for every tile
    whose WebMercatorQuad zoom is <= `max_zoom`. Note this z is the tile-matrix
    zoom titiler receives, which equals the frontend's slippy zoom minus 1"""

    raster: str
    max_zoom: int


class Settings(BaseSettings):
    env: str = "prod"
    cors_origins: list[str] = [
        "https://alleinseinkarte.de",
        "https://www.alleinseinkarte.de",
    ]
    allowed_tms: str = "WebMercatorQuad"
    raster_path: str = "raster/out"
    area: str = "germany"
    raster_version: str = "v3"
    # Per-tier file name overrides; when unset, the name is derived from
    # `area` and `raster_version` in `raster_tiers`.
    raster_file_z6: str | None = None
    raster_file_z7: str | None = None
    raster_file_z8: str | None = None
    raster_file_z99: str | None = None

    def _tier_file(self, resolution: str, override: str | None) -> str:
        return override or f"{self.area}_{resolution}_{self.raster_version}.tif"

    @property
    def raster_tiers(self) -> list[RasterTier]:
        """Combine the per-tier raster files with their fixed zoom breaks,
        coarsest first / ascending max_zoom."""
        return [
            RasterTier(
                raster=self._tier_file("1280m", self.raster_file_z6), max_zoom=6
            ),
            RasterTier(raster=self._tier_file("640m", self.raster_file_z7), max_zoom=7),
            RasterTier(raster=self._tier_file("320m", self.raster_file_z8), max_zoom=8),
            RasterTier(
                raster=self._tier_file("20m", self.raster_file_z99), max_zoom=99
            ),
        ]

    enable_docs: bool = False
    add_preview: bool = False
    add_part: bool = False
    add_viewer: bool = False
    add_ogc_maps: bool = False

    # If present, load .env; real environment variables override .env values (e.g. docker or export)
    model_config = SettingsConfigDict(
        env_prefix="APP_",
        env_file=APP_DIR / ".env",
        extra="ignore",
        dotenv_filtering="only_existing",
    )


settings = Settings()


def build_supported_tms(name: str) -> TileMatrixSets:
    result = {}
    result[name] = morecantile.tms.get(name)

    if not result:
        raise RuntimeError("No TileMatrixSet configured")

    return TileMatrixSets(result)


def select_tier_raster(z: int | None) -> str:
    """Pick the raster for a tile zoom from the configured tiers. `z is None`
    (the tilejson endpoint, which has no z) returns the finest tier so its
    metadata advertises full detail and the complete data footprint."""
    tiers = settings.raster_tiers
    if z is None:
        return tiers[-1].raster
    for tier in tiers:
        if z <= tier.max_zoom:
            return tier.raster
    return tiers[-1].raster


def get_raster_path(
    z: int | None = None,
    raster: str | None = None,
    fine_detail: bool = False,
) -> Path:
    if raster:
        name = raster
    elif fine_detail:
        # Pin the finest tier (20m) for every tile, bypassing per-zoom tiering.
        name = settings.raster_tiers[-1].raster
    else:
        name = select_tier_raster(z)

    # prevent directory traversal or access to subdirectories
    if not name or "/" in name or "\\" in name or name.startswith("."):
        # should raise 404 to prevent information disclosure about the existence of files
        raise FileNotFoundError(f"Rasters file not found: {name}")

    target_path = PROJECT_DIR / settings.raster_path / name
    if not target_path.is_file():
        raise FileNotFoundError(f"Raster file not found: {target_path}")
    return target_path


app = FastAPI(
    title="TiTiler Backend",
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.enable_docs else None,
)

add_exception_handlers(
    app,
    cast(
        dict[type[Exception], int],
        {**DEFAULT_STATUS_CODES, FileNotFoundError: status.HTTP_404_NOT_FOUND},
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.env == "dev" else settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


if settings.env == "prod":

    class CustomTiler(TilerFactory):
        def register_routes(self):
            self.tile()
            self.tilejson()
            self.point()
elif settings.env == "dev":

    class CustomTiler(TilerFactory):
        def register_routes(self):
            super().register_routes()
else:
    raise RuntimeError(f"Unknown environment: {settings.env}")

custom_tiler = CustomTiler(
    path_dependency=get_raster_path,
    supported_tms=build_supported_tms(settings.allowed_tms),
    add_preview=settings.add_preview,
    add_part=settings.add_part,
    add_viewer=settings.add_viewer,
    add_ogc_maps=settings.add_ogc_maps,
)

app.include_router(
    custom_tiler.router,
)


if settings.env == "dev":

    @app.get("/rasters", include_in_schema=False)
    def list_rasters() -> list[str]:
        """Dev-only: list the raster files available in `raster_path`."""
        out_dir = PROJECT_DIR / settings.raster_path
        return sorted(p.name for p in out_dir.glob("*.tif"))


@app.get("/healthz", include_in_schema=False)
def healthz():
    return {
        "ok": True,
        "env": settings.env,
        "version": __version__,
    }
