# Architecture and Sequence Diagrams

## System Architecture

This diagram illustrates the high-level architecture of the Alleinseinkarte project, detailing the interaction between the frontend, Cloudflare, the Hetzner VPS backend, and the mapping data.

```mermaid
graph TD
    User([User / Browser])

    subgraph Cloudflare [Cloudflare Network]
        CF_DNS[DNS: alleinseinkarte.de]
        CF_Cache[(Edge Cache)]
        CF_Tunnel[Cloudflare Tunnel Endpoint]
    end

    subgraph VPS [Hetzner VPS Backend]
        CFD[cloudflared daemon]
        DockerApp[Uvicorn / FastAPI / Titiler]
        Data[("Local COG Rasters<br/>20m + coarse overviews")]
    end

    User -- "HTTPS Request" --> CF_DNS
    CF_DNS -- "Check Cache" --> CF_Cache

    CF_Cache -- "Cache Miss" --> CF_Tunnel
    CF_Tunnel -- "Secure Tunnel" --> CFD
    CFD -- "Localhost:8000" --> DockerApp
    DockerApp -- "Read GeoTIFF<br/>(per-zoom tier)" --> Data
    DockerApp -- "Return Tile" --> CFD
    CFD -- "Secure Tunnel" --> CF_Tunnel
    CF_Tunnel -- "Update Cache" --> CF_Cache

    CF_Cache -- "Cache Hit / Return Tile" --> CF_DNS
    CF_DNS -- "HTTPS Response" --> User
```

### Per-zoom raster tiering

The backend does not serve a single raster. `backend/main.py` maps each incoming tile zoom to a resolution-appropriate COG (`Settings.raster_tiers`, coarsest-first). See the zoom→file mapping in the [Raster Creation Pipeline](raster_creation.md#coarse-overview-rasters-create_coarse_rastersh).

## Request Sequence Diagram

This sequence diagram details the step-by-step flow of a request originating from the user accessing the homepage and requesting a map tile. It highlights how the caching layer intercepts requests to prevent unnecessary load on the backend.

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant CF_Cache as Cloudflare Edge Cache
    participant VPS as Hetzner VPS (Titiler)

    User->>Browser: Enters alleinseinkarte.de
    Browser->>CF_Cache: Request static assets (HTML/CSS/JS)
    CF_Cache-->>Browser: Return static assets

    Note over Browser: User pans/zooms map

    Browser->>CF_Cache: Request map tile (tiles.alleinseinkarte.de/...)

    alt Tile is in Cache (Cache Hit)
        CF_Cache-->>Browser: Return cached tile
        Note over CF_Cache, VPS: VPS is not hit
    else Tile is NOT in Cache (Cache Miss)
        CF_Cache->>VPS: Forward request via Cloudflare Tunnel
        Note over VPS: Titiler reads COG & generates tile
        VPS-->>CF_Cache: Return generated tile
        Note over CF_Cache: Store tile in Edge Cache
        CF_Cache-->>Browser: Return tile to user
    end
```
