## [Inpostologia.pl](https://inpostologia.pl)

## Author

- **Name:** Alistair Kane
- **Email:** [alkane@student.42warsaw.pl](mailto:alkane@student.42warsaw.pl)

## Overview

**Inpostologia** joins InPost locker and service-point records with the Google Place that best matches each physical site.

The combination of this data enables
- Assessment of the location accuracy of InPost points as represented on Google Maps
- Analysis of review quality, recency, and frequency at InPost locations in Poland nationwide
- Discovery of the newest, oldest, and longest reviews for locations in any region or filter slice (+ other spotlights)

## Demo & Description

Live deployment: **[https://inpostologia.pl](https://inpostologia.pl)**.

**Architecture:** The **Next.js** app (`apps/web`) renders the Google Javascript map. **FastAPI** (`apps/api`) serves querys to MongoDB with `GET /points` (bbox + query filters), `GET /points/{id}` (detail including `google_reviews`), `GET /map-filters-meta`.

**Data pipeline:** `scripts/fetch_place_ids.py` walks the **InPost global points API**, skips rows that already have `google_place_id`, queries Places Nearby Search (legacy) around each locker for names containing inpost, picks the nearest candidate, then fetches Place Details to persist ratings, google_reviews, distance, and validation fields.

## Technologies

### Frontend & map

![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Google Maps](https://img.shields.io/badge/Google%20Maps%20Platform-4285F4?style=flat-square&logo=googlemaps&logoColor=white)

[![@react-google-maps/api](https://img.shields.io/badge/npm-@react--google--maps%2Fapi-CB3837?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@react-google-maps/api)
[![markerclusterer](https://img.shields.io/badge/npm-@googlemaps%2Fmarkerclusterer-CB3837?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@googlemaps/markerclusterer)

### Backend

![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![Uvicorn](https://img.shields.io/badge/Uvicorn-ASGI-green?style=flat-square)
![PyMongo](https://img.shields.io/badge/PyMongo-47A248?style=flat-square&logo=mongodb&logoColor=white)

### Ingest & data

![Python ingest](https://img.shields.io/badge/Python-3.12%20(API)%20%7C%203.10%2B%20(scripts)-3776AB?style=flat-square&logo=python&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=flat-square&logo=mongodb&logoColor=white)

### Ops

![Docker](https://img.shields.io/badge/Docker-compose-2496ED?style=flat-square&logo=docker&logoColor=white)
[![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-CI%2F_CD-2088FF?style=flat-square&logo=githubactions&logoColor=white)](https://github.com/alistair-kane/InPost-Technical-Assignment/actions/workflows/ci.yml)


## How to run (locally)

### Prerequisites

- **Docker** and **Docker Compose**.
- **Node.js 20** and **npm**.
- **Python 3.12** (recommended; matches CI) with `pip` and `venv`.
- **Google Cloud**: **Maps JavaScript API** key and a **Map ID** for the map UI. For optional locker→Place ingest, **Places API** (Nearby Search + Place Details).

You need data in MongoDB for the dashboard to show points, populate via `scripts/fetch_place_ids.py` using a repo-root `.env` with `GOOGLE_MAPS_API_KEY`.

This section focuses on running on a local machine. Hosting on a server behind a reverse proxy is out of scope (the production deploy attaches the **`inpost-web`** container to the host’s Caddy network after `docker compose up`).

### Path A — MongoDB in Docker, API and Next.js on your machine (hot reload)

#### 1. Clone and start MongoDB

```bash
git clone <your-repo-url>
cd InPost-Technical-Assignment

MONGO_PUBLISH=27017:27017 docker compose up -d mongo
```

Use `mongodb://localhost:27017/inpost_assignment` as `MONGODB_URI` unless you changed credentials or the compose file.

#### 2. API (`apps/api`)

Create `apps/api/.env` (Pydantic loads it when Uvicorn’s working directory is `apps/api`):

```env
MONGODB_URI=mongodb://localhost:27017/inpost_assignment
MAP_DASHBOARD_API_SECRET=choose-a-long-random-string
```

Optional: `MONGODB_DB`, `MONGODB_COLLECTION` (defaults are in `apps/api/app/config.py`).

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Health check: **http://127.0.0.1:8000/health**

#### 3. Web (`apps/web`)

Create `apps/web/.env.local`:

```env
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<your-maps-js-api-key>
NEXT_PUBLIC_GOOGLE_MAP_ID=<your-map-id>
FASTAPI_URL=http://127.0.0.1:8000
MAP_DASHBOARD_API_SECRET=<same value as apps/api/.env>
```

`MAP_DASHBOARD_API_SECRET` must match the API. Next.js server routes call FastAPI; the browser only talks to Next.

```bash
cd apps/web
npm ci
npm run dev
```

App: **http://localhost:3000**

### Path B — MongoDB, FastAPI, and Next.js all in Docker (no reverse proxy)

You do **not** need an external Docker network such as **Caddy** for local use. Compose only wires the stack’s internal network; expose ports on localhost when you want the browser to reach Next.js.

Put API keys so Compose can interpolate them (Compose reads **`docker-compose.yml` from the repo root** and merges a `.env` in the same folder when present):

```env
MAP_DASHBOARD_API_SECRET=<same-strong-secret-used-below-if-you-set-env-by-hand>
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<your-maps-js-key>
NEXT_PUBLIC_GOOGLE_MAP_ID=<your-map-id>
CORS_ORIGINS=http://localhost:3000
```

Then bring everything up:

```bash
cd InPost-Technical-Assignment

MONGO_PUBLISH=27017:27017 \
  API_PUBLISH=8000:8000 \
  WEB_PUBLISH=3000:3000 \
  docker compose up -d --build
```

- App: **http://localhost:3000**
- API (optional checks): **http://127.0.0.1:8000/health**
- Omit **`MONGO_PUBLISH`** when you access Mongo only from other containers (`api` connects as `mongodb://mongo:27017/...`).

## What I would do with more time

1. **Incremental sync** — Scheduled or queue-driven Place Details refreshes so ratings and review counts track reality without full re-ingestion.
2. **Alternative Google Review API** — Use of a 3rd party API can have the advantage of access to the full Google review history (Google API provides only the 5 most 'relevant' reviews). Additionally cost/fetch is reduced for scheduled refreshing.
3. **UX** — Shareable URLs encoding filters and viewport, exports (CSV / GeoJSON), and exposing an API of the merged database.
4. **Larger Geographical Coverage** — Expanding the data to include all countries that InPost is present in. 

## AI usage

I used Cursor (auto model) extensively in the development of this project. My typical pattern of use was first to stipulate a feature plan and refine it until I was satisfied with the implementation specification. I then check the output, test and refine further if necessary.

## Anything else?

My hope is that this is a useful tool for InPost employees, especially those involved with customer relations, point servicing and business development.
