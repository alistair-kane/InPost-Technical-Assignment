# InPost-Technical-Assignment

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Frontend CI](https://img.shields.io/github/actions/workflow/status/alistair-kane/InPost-Technical-Assignment/ci.yml?branch=main&label=frontend&logo=next.js)](https://github.com/alistair-kane/InPost-Technical-Assignment/actions/workflows/ci.yml)
[![Backend CI](https://img.shields.io/github/actions/workflow/status/alistair-kane/InPost-Technical-Assignment/ci.yml?branch=main&label=backend&logo=fastapi&logoColor=white)](https://github.com/alistair-kane/InPost-Technical-Assignment/actions/workflows/ci.yml)
[![Scripts](https://img.shields.io/badge/scripts-Python%203.10+-3776AB?logo=python&logoColor=white)](scripts/)

Connecting InPost's service point data with Google Places for their locations.

## Map dashboard (Next.js + FastAPI)

The **`apps/web`** Next.js app shows locker locations from MongoDB on **Google Maps** (centered on Poland) with **`@googlemaps/markerclusterer`**. **`apps/api`** is a FastAPI service that exposes **`GET /points`** secured with **`X-Api-Key`**. The browser never sees that secret: the UI calls **`GET /api/map-points`**, which the Next.js server proxies to FastAPI using **`MAP_DASHBOARD_API_SECRET`**.

### Dashboard prerequisites

- Docker and Docker Compose
- Variables in `.env` (copy from [.env.example](.env.example)):
  - **`MAP_DASHBOARD_API_SECRET`** (long random string, shared between `api` and `web`)
  - **`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`** ([Maps JavaScript API](https://developers.google.com/maps/documentation/javascript/overview) enabled; restrict HTTP referrers to `http://localhost:3000` and your eventual HTTPS origins)
  - **`NEXT_PUBLIC_GOOGLE_MAP_ID`** (a [vector Map ID](https://developers.google.com/maps/documentation/javascript/advanced-markers/setup) from Cloud Console Map Management — required so the app uses **AdvancedMarkerElement**, not deprecated `google.maps.Marker`)
  - Optionally reuse **`GOOGLE_MAPS_API_KEY`** from ingest for the same GCP key if referrer rules permit

### Run the full stack locally

From the repo root (uses [`docker-compose.dev.yml`](docker-compose.dev.yml) for published ports):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Open **`http://localhost:3000`**. The API lives at **`http://localhost:8000`** (for example **`GET /health`** and **`GET /health/ready`**).

`GET /points` requires header **`X-Api-Key: <MAP_DASHBOARD_API_SECRET>`** and omits MongoDB rows with **`validation_status: SKIPPED_BAD_COORDINATES`**; coordinates must fall within sane lat/lng ranges.

### Local development without rebuilding `web`

With Mongo + API in Docker (or API run locally with `uvicorn`):

```bash
cd apps/web
export FASTAPI_URL=http://localhost:8000
export MAP_DASHBOARD_API_SECRET=…   # same value as the API service
export NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=…
export NEXT_PUBLIC_GOOGLE_MAP_ID=…  # vector map ID from Google Cloud Console
npm run dev
```

Before production, set **`CORS_ORIGINS`** to your HTTPS Next.js origin(s), terminate TLS at your reverse proxy, and rotate **`MAP_DASHBOARD_API_SECRET`**. The default [`docker-compose.yml`](docker-compose.yml) does not publish MongoDB or API ports to the host.

---

## Deployment (GitHub Actions + existing Caddy)

The [**CI**](.github/workflows/ci.yml) workflow runs on **pull requests** and **pushes to `main`**: lint + tests for `apps/web` and `apps/api`. On **push to `main`** (or **workflow_dispatch**), it then uploads the repo to your VPS and runs **`docker compose up -d --build`** (deploy is skipped on PRs). No container registry. TLS stays with your **existing Caddy container** (add a site block; do not install a second Caddy).

### Architecture

- **Caddy** (already on the server) terminates HTTPS and `reverse_proxy`s to **`inpost-web:3000`** on a shared Docker network.
- **`inpost-web`**, **`api`**, and **`mongo`** are defined in a single [`docker-compose.yml`](docker-compose.yml). Only `inpost-web` joins the Caddy network. MongoDB and FastAPI have **no host ports**.
- Secrets are injected from **GitHub Actions** into a server `.env` on each deploy (`chmod 600`), never committed to git.

### One-time server setup

1. **DNS:** `A` / `AAAA` for your public hostname → your VPS.
2. **Caddy network:** `docker network ls` and inspect your Caddy container (e.g. `reverse_proxy`).
3. **Caddy site block:** Merge [`deploy/caddy/inpost-map.caddy`](deploy/caddy/inpost-map.caddy) into your existing Caddyfile, then reload:
   ```bash
   docker exec <caddy_container> caddy reload --config /etc/caddy/Caddyfile
   ```
4. **Deploy path:** Create the directory named in the `DEPLOY_PATH` secret (e.g. `/opt/inpost-map`).
5. **Google Cloud:** Restrict the Maps API key HTTP referrers to `https://<your-domain>/*`.
6. **Firewall:** Allow 22, 80, 443; do not expose 27017 or 8000 publicly.

### GitHub Actions secrets

| Secret | Purpose |
|--------|---------|
| `DEPLOY_PATH` | Absolute path on the server (e.g. `/opt/inpost-map`) |
| `SSH_HOST` | VPS hostname or IP |
| `SSH_USER` | Deploy user (e.g. `deploy`) |
| `SSH_PRIVATE_KEY` | Ed25519 private key |
| `SSH_PORT` | Optional SSH port (default 22) |
| `CADDY_DOCKER_NETWORK` | External Docker network shared with Caddy |
| `MAP_DASHBOARD_API_SECRET` | Shared API key for web → api |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Baked into web image at build time |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | Baked into web image at build time |
| `CORS_ORIGINS` | e.g. `https://map.example.com` |

### Manual deploy on the server

```bash
cd /opt/inpost-map   # or your DEPLOY_PATH
docker compose up -d --build --force-recreate --remove-orphans
```

### Rate limiting (three layers)

| Layer | Where | Purpose |
|-------|--------|---------|
| Client | React hooks (`rateLimitedFetch`) | UX; reduces accidental spam |
| Next.js | `middleware.ts` on `/api/*` | Per-IP caps for public BFF routes (`429` + `Retry-After`) |
| FastAPI | `slowapi` on `/points`, `/map-filters-meta` | Per-IP caps on internal API; uses `X-Forwarded-For` from Next |

Client limits are **not** a security boundary. Server + FastAPI limits protect MongoDB and the InPost proxy. Optional tuning via `RATE_LIMIT_*` env vars (see [`.env.example`](.env.example)).

**429 handling:** Browser hooks show a short “wait a moment” message; respect `retryAfterSeconds` from JSON when present.

---

## InPost sample to Google Place ID (MongoDB)

The script walks the [InPost global points API](https://api-global-points.easypack24.net/v1/points) until it collects up to your target count of lockers that **do not yet** have a `google_place_id` stored in MongoDB (already-resolved lockers are skipped so Google APIs are not called again). It writes one upsert per processed locker.

It uses **Places Nearby Search (legacy)** centred on each InPost coordinate (see `scripts/constants.py` for radius, delays, and pagination). It gathers all pages of nearby results, keeps places whose **name** contains `inpost` (case-insensitive), and selects the **closest** match by haversine distance. It then calls **Place Details** (twice for default + original-language reviews).

Other behaviour (Mongo collection name, delays, radius, pagination delay) is controlled by **`DEFAULT_*`** constants in `scripts/constants.py` (used from `scripts/fetch_place_ids.py`).

### Prerequisites

- Docker (for MongoDB locally)
- Python 3.10+
- A Google Maps Platform API key with **Places API** enabled (**Nearby Search** and **Place Details**).

### 1. Start MongoDB

From the repo root:

```bash
docker compose up -d
```

Default URI: `mongodb://localhost:27017/inpost_assignment`.

### 2. Configure secrets

Copy `.env.example` to `.env` and set `GOOGLE_MAPS_API_KEY`. Adjust `MONGODB_URI` if you use authentication or another host.

### 3. Install Python dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Run the ingest script

Command-line options are only **`--sample-size`**, **`--start-page`**, and **`--per-page`**. Everything else uses defaults from constants in `scripts/fetch_place_ids.py`.

```bash
source .venv/bin/activate
python scripts/fetch_place_ids.py --sample-size 5
```

Documents are upserted into the collection named by **`DEFAULT_MONGO_COLLECTION`** (`google_place_id` is only set when validation status is `OK`). When Place Details succeeds, the document includes **`google_reviews`**: a list of normalized review objects from the [`reviews` field](https://developers.google.com/maps/documentation/places/web-service/details) (Atmosphere SKU billing). Each entry has **`text`** (response default, possibly translated for your language settings) and **`text_original`** from a second request with **`reviews_no_translations=true`**, merged by reviewer `time` and `author_url`. Other stored fields include `search_strategy`, `distance_to_google_place_m`, and status fields.
