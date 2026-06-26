# Interaction Logging (Anonymous Aggregate Telemetry)

> Status: **future / design note** — not yet implemented.

Goal: find out **which controls users actually use** — most-used color-ramp,
basemap, map engine (MapLibre vs Leaflet), layer toggles, etc. — without
collecting personal data.

## The approach: a stateless client-side beacon

When the user performs an interaction, the frontend fires a tiny
`navigator.sendBeacon` with the clean action name. The backend increments an
aggregate counter. No cookies, no session id, no IP retained.

## DSGVO / legal notes

Rules we follow to stay in the low-risk anonymous-aggregate zone:

1. **Store aggregates, not per-user streams.** Increment a counter per action;
   never persist individual event rows tied to a visitor.
2. **Strip the IP** at the `/event` endpoint — don't log or retain it.

---

## Implementation

### 1. Frontend — generic `track()` helper

```js
// frontend/static/  (e.g. in shared.js or a new telemetry.js)
function track(action, value) {
  try {
    navigator.sendBeacon(
      `${CONFIG.fqdn}/event`,
      JSON.stringify({ action, value }),
    );
  } catch {
    /* telemetry must never break the app */
  }
}

// Example call sites:
track("ramp", preset); // "magma", "viridis", ...
track("basemap", basemapId); // "satellite", "osm", ...
track("layer_toggle", "water"); // which data layer was toggled
track("bottombar", "open"); // "open" | "close"
```

### 2. Backend — `/event` (write) + `/stats` (read) in `backend/main.py`

Counters live in SQLite on a **host-mounted volume** so they survive
`docker compose up --force-recreate`. Python ships with `sqlite3`, so no new
dependency.

```python
import json
import sqlite3
from pathlib import Path

from fastapi import Request, Response

# Store on a mounted volume (see docker-compose), not inside the container.
DB_PATH = Path("/data/events.db")
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

_db = sqlite3.connect(DB_PATH, check_same_thread=False)
_db.execute(
    """
    CREATE TABLE IF NOT EXISTS events (
        action TEXT,
        value  TEXT,
        count  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (action, value)
    )
    """
)
_db.commit()


@app.post("/event", include_in_schema=False)
async def event(request: Request) -> Response:
    """Anonymous aggregate telemetry. Increments a per-(action,value) counter.
    Deliberately stores NO IP, session id, or timestamp — just counts."""
    try:
        body = await request.json()
        action = str(body["action"])[:64]
        value = str(body["value"])[:64]
    except Exception:
        # Never reveal anything; never error loudly on bad beacons.
        return Response(status_code=204)

    _db.execute(
        """
        INSERT INTO events (action, value, count) VALUES (?, ?, 1)
        ON CONFLICT(action, value) DO UPDATE SET count = count + 1
        """,
        (action, value),
    )
    _db.commit()
    return Response(status_code=204)


@app.get("/stats", include_in_schema=False)
def stats(request: Request):
    """Read-only aggregate counts. GATE THIS in production (secret header or
    Tailscale-only) and configure Cloudflare to never cache it."""
    # Example minimal guard — replace with Tailscale-only routing if preferred:
    # if request.headers.get("x-stats-token") != settings.stats_token:
    #     raise HTTPException(status_code=404)
    rows = _db.execute(
        "SELECT action, value, count FROM events ORDER BY action, count DESC"
    ).fetchall()
    return [{"action": a, "value": v, "count": c} for a, v, c in rows]
```

> Note: a single shared `sqlite3` connection with 2 uvicorn workers means two
> processes each open the same DB file — SQLite handles cross-process locking,
> but if write contention ever shows up, enable WAL mode (`_db.execute("PRAGMA journal_mode=WAL")`).

### 3. Compose — persist the DB on a host volume

In `docker-compose.yaml`, under the `tiler` service `volumes:`:

```yaml
volumes:
  - ./raster/out:/raster/out
  - ./data:/data # SQLite telemetry DB lives here, survives redeploys
```

---

## How to query / view the data

### A. Direct SQL on the VPS (ad-hoc, zero build)

```bash
ssh gregor@$IP_VPS
sqlite3 ./data/events.db "SELECT action, value, count FROM events ORDER BY count DESC;"
```

```
ramp|magma|1432
ramp|viridis|980
basemap|satellite|610
engine|leaflet|88
```

### B. Read-only `/stats` endpoint (view from anywhere)

```bash
curl https://tiles.alleinseinkarte.de/stats | jq 'group_by(.action)'
```
