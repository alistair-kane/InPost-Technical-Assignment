from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pymongo.collection import Collection
from pydantic import BaseModel

from app.config import Settings

settings = Settings()

POINT_FIELDS = {
    "inpost_point_id": 1,
    "partner_id": 1,
    "latitude": 1,
    "longitude": 1,
    "name": 1,
    "validation_status": 1,
    "formatted_address": 1,
    "google_maps_uri": 1,
    "google_rating": 1,
    "google_user_ratings_total": 1,
    "google_reviews": 1,
    "distance_to_google_place_m": 1,
    "_id": 0,
}


def point_query_filter() -> dict[str, Any]:
    lat_lng = {
        "latitude": {
            "$exists": True,
            "$nin": [None],
            "$gte": -90.0,
            "$lte": 90.0,
        },
        "longitude": {
            "$exists": True,
            "$nin": [None],
            "$gte": -180.0,
            "$lte": 180.0,
        },
    }
    return {
        "$and": [
            {
                "$or": [
                    {"map_eligible": True},
                    {
                        "map_eligible": {"$exists": False},
                        "validation_status": {"$ne": "SKIPPED_BAD_COORDINATES"},
                    },
                ]
            },
            lat_lng,
        ]
    }


def _parse_partner_id_values(raw: list[str] | None) -> list[Any]:
    if not raw:
        return []
    out: list[Any] = []
    for s in raw:
        t = str(s).strip()
        if not t:
            continue
        try:
            out.append(int(t))
        except ValueError:
            out.append(t)
    return out


def _no_google_place_mongo_condition() -> dict[str, Any]:
    """Rows with no resolved Google Place id (see ingest `google_place_id`)."""
    return {
        "$or": [
            {"google_place_id": None},
            {"google_place_id": ""},
            {"google_place_id": {"$exists": False}},
        ]
    }


def build_points_mongo_filter(
    *,
    min_rating: float | None,
    max_rating: float | None,
    only_without_google_place: bool,
    partner_ids: list[Any] | None,
) -> dict[str, Any]:
    base = point_query_filter()
    rating_bounds = min_rating is not None or max_rating is not None
    partner_filter = bool(partner_ids)

    if not rating_bounds and not only_without_google_place and not partner_filter:
        return base

    parts: list[dict[str, Any]] = [base]

    if rating_bounds:
        rng: dict[str, Any] = {"$exists": True, "$nin": [None]}
        if min_rating is not None:
            rng["$gte"] = min_rating
        if max_rating is not None:
            rng["$lte"] = max_rating
        parts.append({"google_rating": rng})

    if only_without_google_place:
        parts.append(_no_google_place_mongo_condition())

    if partner_filter and partner_ids is not None:
        parts.append({"partner_id": {"$in": partner_ids}})

    if len(parts) == 1:
        return parts[0]
    return {"$and": parts}


class MapPoint(BaseModel):
    model_config = {"extra": "ignore"}

    inpost_point_id: str | None = None
    partner_id: str | int | None = None
    latitude: float
    longitude: float
    name: str | None = None
    validation_status: str | None = None
    formatted_address: str | None = None
    google_maps_uri: str | None = None
    google_rating: float | None = None
    google_user_ratings_total: int | None = None
    google_reviews: list[dict[str, Any]] | None = None
    distance_to_google_place_m: float | None = None


class PointsResponse(BaseModel):
    points: list[MapPoint]


mongo_client: MongoClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mongo_client
    mongo_client = MongoClient(settings.mongodb_uri)
    yield
    if mongo_client is not None:
        mongo_client.close()
        mongo_client = None


app = FastAPI(title="InPost map API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list(),
    allow_credentials=True,
    allow_methods=["GET", "HEAD", "OPTIONS"],
    allow_headers=["*"],
)


def get_collection(_request: Request) -> Collection[Any]:
    if mongo_client is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Database not initialized")
    return mongo_client[settings.mongodb_db][settings.mongodb_collection]


def verify_api_key(x_api_key: str | None = Header(default=None, alias="X-Api-Key")) -> None:
    if not x_api_key or x_api_key != settings.map_dashboard_api_secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing X-Api-Key")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def health_ready(coll: Annotated[Any, Depends(get_collection)]) -> dict[str, str]:
    coll.find_one({}, projection={"_id": 1})
    return {"status": "ready"}


@app.get("/points", response_model=PointsResponse)
def list_points(
    _: Annotated[None, Depends(verify_api_key)],
    coll: Annotated[Any, Depends(get_collection)],
    min_rating: float | None = Query(default=None),
    max_rating: float | None = Query(default=None),
    no_google_place_only: bool = Query(default=False),
    partner_id: list[str] | None = Query(default=None),
) -> PointsResponse:
    if min_rating is not None and max_rating is not None and min_rating > max_rating:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "min_rating must be less than or equal to max_rating",
        )

    partner_values = _parse_partner_id_values(partner_id)
    query_filter = build_points_mongo_filter(
        min_rating=min_rating,
        max_rating=max_rating,
        only_without_google_place=no_google_place_only,
        partner_ids=partner_values if partner_values else None,
    )

    cursor = coll.find(filter=query_filter, projection=POINT_FIELDS).sort(
        "inpost_point_id", 1
    )
    raw: list[dict[str, Any]] = list(cursor)
    points: list[MapPoint] = []
    for doc in raw:
        try:
            la = float(doc["latitude"])
            ln = float(doc["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        doc["latitude"] = la
        doc["longitude"] = ln
        try:
            points.append(MapPoint.model_validate(doc))
        except Exception:
            continue
    return PointsResponse(points=points)
