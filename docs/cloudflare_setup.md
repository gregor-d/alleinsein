# Cloudflare Tunnel, Caching & Routing Configuration

This document describes how the `alleinsein` map tile backend is securely exposed and cached at the edge using Cloudflare.

---

## 1. Cloudflare Tunnel Setup (`tiles.alleinseinkarte.de`)

A **Cloudflare Tunnel** (`cloudflared`) establishes a secure, outbound-only connection between the Hetzner VPS and Cloudflare's global edge network. This design enhances security by:
- Eliminating the need to open public inbound ports (e.g., `80`, `443`, or `8000`) on the VPS.
- Automatically handles SSL/TLS certificate management at the edge.
- Preventing DDoS attacks and IP exposure.

### Docker Compose Configuration
The tunnel runs as a Docker container alongside the FastAPI tile server. Create the folder structure and configuration as follows:

```bash
mkdir -p ~/cloudflare-tunnel
cd ~/cloudflare-tunnel
```

#### Environment Variables (`.env`)
Store your unique tunnel token generated from the Cloudflare Zero Trust dashboard:
```ini
TUNNEL_TOKEN=eyJhIjoiM...[YOUR_TUNNEL_TOKEN]...
```
*Make sure to lock down permissions:* `chmod 600 .env`

#### Compose Configuration (`docker-compose.yml`)
```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared
    restart: unless-stopped
    env_file: .env
    command: tunnel --no-autoupdate run --token ${TUNNEL_TOKEN}
```

### Execution
Start the tunnel daemon:
```bash
docker compose up -d
docker compose ps
docker logs -f cloudflared
```

### Routing In Cloudflare Dashboard
1. Go to **Zero Trust** -> **Networks** -> **Tunnels**.
2. Select your active tunnel and add a public hostname:
   - **Public Hostname**: `tiles.alleinseinkarte.de` (or `tiles.alleinsein.de`)
   - **Service Type**: `HTTP`
   - **URL**: `http://tiler:8000` (or `http://localhost:8000` depending on your network setup)

---

## 2. Caching and Routing Rules

Because geospatial mapping clients perform heavy zooming and panning, a single user session can generate hundreds of tile requests in seconds. Caching tiles at Cloudflare's Edge CDN is crucial to minimize Hetzner VPS resource consumption.

### Goal
- **Cache Hits**: Cloudflare serves the pre-rendered map tile directly from the edge cache in milliseconds.
- **Cache Misses**: Cloudflare forwards the request to the VPS backend over the tunnel, which processes the tile from the GeoTIFF and caches the response on Cloudflare for subsequent users.

### Cloudflare Caching Rules Setup
Configure these rules in the Cloudflare Dashboard under **Caching** -> **Cache Rules** for your zone:

#### Rule 1: Cache Map Tiles (Cache Everything)
- **Expression**:
  ```sql
  (http.host eq "tiles.alleinseinkarte.de" and http.request.uri.path wildcard "/tiles/*") or 
  (http.host eq "tiles.alleinseinkarte.de" and http.request.uri.path wildcard "/WebMercatorQuad/*")
  ```
- **Settings**:
  - **Cache eligibility**: Eligible for cache
  - **Edge Cache TTL**: Use cache-control header if present, or override to **1 Month** (since the base raster data updates infrequently).
  - **Browser Cache TTL**: **7 Days** (enables fast local navigation during panning/zooming).
  - **Cache Key**: Include query string parameters (vital because `?raster=germany_raster_v2.tif` or colormap parameters determine the tile output).

#### Rule 2: Bypass Cache for API Health & Docs
- **Expression**:
  ```sql
  (http.host eq "tiles.alleinseinkarte.de" and http.request.uri.path eq "/healthz")
  ```
- **Settings**:
  - **Cache eligibility**: Bypass cache (ensures real-time status reporting).

---

## 3. Verification

Inspect the HTTP response headers in your browser's Developer Tools network panel or via `curl`:

```bash
curl -I "https://tiles.alleinseinkarte.de/tiles/WebMercatorQuad/6/34/21?raster=test_raster.tif"
```

Look for the `CF-Cache-Status` header:
- `CF-Cache-Status: MISS`: The request was sent to the Hetzner VPS (first request).
- `CF-Cache-Status: HIT`: The request was served directly by Cloudflare CDN without hitting your backend (subsequent requests).
