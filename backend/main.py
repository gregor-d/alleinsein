from pathlib import Path

from fastapi import FastAPI
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.middleware.cors import CORSMiddleware
import morecantile
from morecantile.defaults import TileMatrixSets

from titiler.core.factory import TilerFactory
from titiler.core.errors import DEFAULT_STATUS_CODES, add_exception_handlers

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent


class Settings(BaseSettings):
    env: str = "prod"
    enable_docs: bool = False
    cors_origins: list[str] = ["https://alleinseinkarte.de", "https://www.alleinseinkarte.de"]
    allowed_tms: str = "WebMercatorQuad"
    raster_path: str = "raster/out"
    add_preview: bool = False
    add_part: bool = False
    add_viewer: bool = False
    add_ogc_maps: bool = False

    model_config = SettingsConfigDict(
        env_prefix="APP_",
        env_file=[APP_DIR / "prod.env", APP_DIR / "dev.env"],
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

def get_raster_path(raster: str = "test_raster.tif") -> Path:
    # prevent directory traversal or access to subdirectories
    if not raster or "/" in raster or "\\" in raster or raster.startswith("."):
        # should raise 404 to prevent information disclosure about the existence of files
        raise FileNotFoundError(f"Rasters file not found: {raster}")

    target_path = PROJECT_DIR / settings.raster_path / raster 
    if not target_path.is_file():
        raise FileNotFoundError(f"Raster file not found: {target_path}")
    return target_path


app = FastAPI(
    title="TiTiler Backend",
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.enable_docs else None,
)

add_exception_handlers(app, DEFAULT_STATUS_CODES)

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



@app.get("/healthz", include_in_schema=False)
def healthz():
    return {
        "ok": True,
        "env": settings.env,
    }
