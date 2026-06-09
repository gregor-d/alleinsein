import morecantile
from morecantile.defaults import TileMatrixSets
from fastapi import FastAPI
from titiler.core.factory import TilerFactory


class TilesOnlyTilerFactory(TilerFactory):
    def register_routes(self):
        # Only register the real tile endpoint:
        # /tiles/{tileMatrixSetId}/{z}/{x}/{y}[.{format}]
        self.tile()
        self.tilejson()


webmercator_only = TileMatrixSets(
    {
        "WebMercatorQuad": morecantile.tms.get("WebMercatorQuad"),
    }
)

app = FastAPI(
    title="TiTiler Backend",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# app = FastAPI(
#     title="TiTiler Backend",
#     docs_url="/docs",
#     redoc_url=None,
#     openapi_url="/openapi.json",
# )

cog = TilesOnlyTilerFactory(
    supported_tms=webmercator_only,
    add_preview=False,
    add_part=False,
    add_viewer=False,
    add_ogc_maps=False,
)

app.include_router(cog.router)


@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"ok": True}
