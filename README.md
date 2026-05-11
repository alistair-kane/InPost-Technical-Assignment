# InPost-Technical-Assignment

Connecting InPost's service point data with Google Places for their locations.

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
