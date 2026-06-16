# Architecture and Sequence Diagrams

## System Architecture

This diagram illustrates the high-level architecture of the Alleinsein project, detailing the interaction between the frontend, Cloudflare, the Hetzner VPS backend, and the mapping data.

```mermaid
graph TD
    User([User / Browser])
    
    subgraph Cloudflare [Cloudflare Network]
        CF_DNS[DNS: alleinsein.de]
        CF_Cache[(Edge Cache)]
        CF_Tunnel[Cloudflare Tunnel Endpoint]
    end
    
    subgraph VPS [Hetzner VPS Backend]
        CFD[cloudflared daemon]
        App[Uvicorn / FastAPI / Titiler]
        Data[(Local COG Raster Tiles)]
    end
    
    User -- "HTTPS Request" --> CF_DNS
    CF_DNS -- "Check Cache" --> CF_Cache
    
    CF_Cache -- "Cache Miss" --> CF_Tunnel
    CF_Tunnel -- "Secure Tunnel" --> CFD
    CFD -- "Localhost:8000" --> App
    App -- "Read GeoTIFF" --> Data
    App -- "Return Tile" --> CFD
    CFD -- "Secure Tunnel" --> CF_Tunnel
    CF_Tunnel -- "Update Cache" --> CF_Cache
    
    CF_Cache -- "Cache Hit / Return Tile" --> CF_DNS
    CF_DNS -- "HTTPS Response" --> User
```

## Request Sequence Diagram

This sequence diagram details the step-by-step flow of a request originating from the user accessing the homepage and requesting a map tile. It highlights how the caching layer intercepts requests to prevent unnecessary load on the backend.

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant CF_Cache as Cloudflare Edge Cache
    participant VPS as Hetzner VPS (Titiler)

    User->>Browser: Enters alleinsein.de
    Browser->>CF_Cache: Request static assets (HTML/CSS/JS)
    CF_Cache-->>Browser: Return static assets
    
    Note over Browser: User pans/zooms map
    
    Browser->>CF_Cache: Request map tile (tiles.alleinsein.de/...)
    
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



# Architecture & Request Flow Diagrams

This document contains Mermaid.js diagrams illustrating the system architecture and request lifecycle of the `alleinsein` application.

---

## 1. System Architecture

The infrastructure uses Cloudflare to serve static content and cache dynamic map tiles, while a secure Cloudflare Tunnel routes cache misses to a containerized FastAPI backend running on a Hetzner VPS.

```mermaid
graph TD
    %% Define Nodes
    User["User Browser"]
    
    subgraph CloudflareEdge ["Cloudflare Edge Network"]
        CF_Pages["Cloudflare Pages (Static Frontend)"]
        CF_CDN["Cloudflare CDN (Edge Cache)"]
    end
    
    subgraph HetznerVPS ["Hetzner VPS"]
        CF_Tunnel["Cloudflare Tunnel (Docker)"]
        
        subgraph DockerNet ["Docker Internal Network"]
            FastAPI["FastAPI / TiTiler Backend"]
            COGs[("Raster Storage (COGs)")]
        end
    end

    %% Define Connections
    User -->|1. Request Homepage| CF_Pages
    User -->|2. Request Map Tiles| CF_CDN
    
    CF_CDN -->|3. Cache Miss| CF_Tunnel
    CF_Tunnel -->|4. Forward Request| FastAPI
    FastAPI -->|5. Read Byte-Ranges| COGs
```

---

## 2. Request Sequence Diagram

This sequence diagram displays what happens when a user accesses the site, showing both the static asset load path and the conditional cache/VPS path for tile queries.

```mermaid
sequenceDiagram
    autonumber
    actor User as User Browser
    participant CF_Pages as Cloudflare Pages
    participant CF_CDN as Cloudflare CDN (Edge Cache)
    participant CF_Tunnel as Cloudflare Tunnel
    participant Backend as FastAPI / TiTiler
    participant Disk as COG File (Local Disk)

    %% Step 1: Initial Page Load
    Note over User, CF_Pages: 1. Initial Page Load
    User->>CF_Pages: GET / (Request homepage)
    CF_Pages-->>User: Return index.html, index.css, JS assets

    %% Step 2: Map Rendering & Tile Request
    Note over User, CF_CDN: 2. Map Rendering and Tile Requests
    User->>CF_CDN: GET /tiles/WebMercatorQuad/Z/X/Y.png?raster=germany_raster_v2.tif
    activate CF_CDN
    
    %% Cache Check
    Note over CF_CDN: Check Edge Cache
    
    alt Cache HIT
        Note over CF_CDN: Tile found in CDN cache
        CF_CDN-->>User: HTTP 200 (PNG image)
    else Cache MISS
        Note over CF_CDN: Tile NOT in cache (forward to VPS)
        CF_CDN->>CF_Tunnel: Secure Forward Request
        activate CF_Tunnel
        CF_Tunnel->>Backend: Forward HTTP GET
        activate Backend
        
        %% Disk Read
        Backend->>Disk: Read specific byte ranges (via GDAL)
        Disk-->>Backend: Return pixel data
        
        %% Tile Generation
        Note over Backend: Process pixels, apply colormap, compress to PNG
        
        Backend-->>CF_Tunnel: HTTP 200 (PNG image)
        deactivate Backend
        CF_Tunnel-->>CF_CDN: Forward response
        deactivate CF_Tunnel
        
        %% Cache Response
        Note over CF_CDN: Save tile image in edge cache
        
        CF_CDN-->>User: HTTP 200 (PNG image)
        deactivate CF_CDN
    end
```
