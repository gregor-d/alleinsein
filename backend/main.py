from pathlib import Path

from fastapi import FastAPI
from pydantic_settings import BaseSettings, SettingsConfigDict

import morecantile
from morecantile.defaults import TileMatrixSets

from titiler.core.factory import TilerFactory

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent


class Settings(BaseSettings):
    env: str = "dev"
    enable_docs: bool = False
    enable_tilejson: bool = False
    allowed_tms: str = "WebMercatorQuad"
    raster_path: Path = PROJECT_DIR / "raster"

    model_config = SettingsConfigDict(
        env_prefix="APP_",
        env_file=".env",
    )


settings = Settings()


def build_supported_tms(names: str) -> TileMatrixSets:
    result = {}

    for name in [x.strip() for x in names.split(",") if x.strip()]:
        result[name] = morecantile.tms.get(name)

    if not result:
        raise RuntimeError("No TileMatrixSet configured")

    return TileMatrixSets(result)



app = FastAPI(
    title="TiTiler Backend",
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.enable_docs else None,
)

def get_raster_path(raster:str="test_raster.tif") -> Path:
    # only allow raster files in the specified raster path for security reasons
    if not (settings.raster_path / raster).is_file():
        raise FileNotFoundError(f"Raster file not found: {raster}")
    return settings.raster_path / raster

if settings.env == "prod":
    class ProdTilerFactory(TilerFactory):
        def register_routes(self):
            # Only:
            # /tiles/{tileMatrixSetId}/{z}/{x}/{y}
            self.tile()

    cog_prod = ProdTilerFactory(
        supported_tms=build_supported_tms(settings.allowed_tms),
        add_preview=False,
        add_part=False,
        add_viewer=False,
        add_ogc_maps=False,
    )
    app.include_router(cog_prod.router)

elif settings.env == "dev":
    # Full normal TiTiler core routes
    cog_pg = TilerFactory(
        # add default raster
        router_prefix="/api/raster",
        path_dependency=get_raster_path,
        supported_tms=build_supported_tms(settings.allowed_tms),
        add_preview=True,
        add_part=True,
        add_viewer=True,
        add_ogc_maps=True,
    )
    app.include_router(cog_pg.router)

else:
    raise RuntimeError(f"Invalid APP_ROUTE_MODE: {settings.env}")




@app.get("/healthz", include_in_schema=False)
def healthz():
    return {
        "ok": True,
        "env": settings.env,
    }
