# InPost-Technical-Assignment

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

From the repo root:

```bash
docker compose up --build
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

### Production-oriented Compose

[**docker-compose.prod.yml**](docker-compose.prod.yml) stops publishing **`mongo` port** `27017` to the host. Use it alongside the base file:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Before production, set **`CORS_ORIGINS`** to your HTTPS Next.js origin(s), terminate TLS at your reverse proxy, and rotate **`MAP_DASHBOARD_API_SECRET`**. Keep MongoDB reachable only inside the Compose network unless you deliberately use Atlas or another hosted database.

---

## InPost sample to Google Place ID (MongoDB)

The script walks the [InPost global points API](https://api-global-points.easypack24.net/v1/points) until it collects up to your target count of lockers that **do not yet** have a `google_place_id` stored in MongoDB (already-resolved lockers are skipped so Google APIs are not called again). It writes one upsert per processed locker.

It uses **Places Nearby Search (legacy)** centred on each InPost coordinate (see constants in `scripts/fetch_place_ids.py` for radius and optional keyword). It gathers all pages of nearby results, keeps places whose **name** contains `inpost` (case-insensitive), and selects the **closest** match by haversine distance. It then calls **Place Details** (twice for default + original-language reviews).

Other behaviour (Mongo collection name, delays, radius, optional Nearby keyword, pagination delay) is controlled by **`DEFAULT_*`** constants at the top of `scripts/fetch_place_ids.py`.

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
