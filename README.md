# InPost-Technical-Assignment

Connecting InPost's service point data with Google Places for their locations.

## InPost sample to Google Place ID (MongoDB)

The script pulls a configurable sample from the [InPost global points API](https://api-global-points.easypack24.net/v1/points) and writes one document per locker to MongoDB.

**By default (see module constants in `scripts/fetch_place_ids.py`)** it uses **Places Nearby Search (legacy)** centred on the InPost coordinates with a tight search radius. It gathers all pages of nearby results, keeps places whose **name** contains `inpost` (case-insensitive), and selects the **closest** match to the InPost point by haversine distance to the result’s coordinates.

Set **`DEFAULT_STRATEGY = "geocode"`** in that script to forward-geocode the structured address instead, then use **Place Details** to require the same `inpost` substring in the returned name.

Other behaviour (Mongo collection name, delays, radius, optional Nearby keyword, pagination delay) is controlled by **`DEFAULT_*`** constants at the top of `scripts/fetch_place_ids.py`.

### Prerequisites

- Docker (for MongoDB locally)
- Python 3.10+
- A Google Maps Platform API key with **Places API** enabled (**Nearby Search** is used by default). For geocode strategy, also enable **Geocoding API** and **Place Details**.

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

Documents are upserted into the collection named by **`DEFAULT_MONGO_COLLECTION`** (`google_place_id` is only set when validation status is `OK`). Stored fields include `search_strategy`, `distance_to_google_place_m` (for nearby), and Nearby or Geocode status fields.
