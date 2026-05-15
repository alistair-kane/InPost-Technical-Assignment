from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo import MongoClient
from pymongo.collection import Collection
from pydantic import BaseModel
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import Settings
from app.rate_limit import limiter

settings = Settings()

# Bbox list: omit long strings and status metadata (client merges ``GET /points/{id}`` for panel).
POINT_FIELDS_LEAN = {
    "inpost_point_id": 1,
    "partner_id": 1,
    "latitude": 1,
    "longitude": 1,
    "name": 1,
    "google_rating": 1,
    "google_user_ratings_total": 1,
    "distance_to_google_place_m": 1,
    "google_reviews_time_unix_min": 1,
    "google_reviews_time_unix_max": 1,
    "review_snippet_max_text_len": 1,
    "review_snippet_star_spread": 1,
    "review_snippet_star_variance": 1,
    "review_snippet_star_count": 1,
    "_id": 0,
}

POINT_FIELDS_DETAIL = {
    **POINT_FIELDS_LEAN,
    "status": 1,
    "validation_status": 1,
    "formatted_address": 1,
    "google_maps_uri": 1,
    "google_reviews": 1,
}


DEFAULT_MAX_POINTS = 100_000


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


_ALLOWED_INPOST_STATUS_BUCKETS = frozenset({"operating", "created", "disabled"})


def _parse_inpost_status_buckets(raw: list[str] | None) -> list[str] | None:
    """Subset of operating / created / disabled; all three or omitted => no filter."""
    if not raw:
        return None
    out: list[str] = []
    seen: set[str] = set()
    for s in raw:
        key = str(s).strip().lower()
        if key not in _ALLOWED_INPOST_STATUS_BUCKETS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "inpost_status must be operating, created, or disabled",
            )
        if key not in seen:
            seen.add(key)
            out.append(key)
    if len(out) == len(_ALLOWED_INPOST_STATUS_BUCKETS):
        return None
    return out


def _expr_norm_status_equals(value: str) -> dict[str, Any]:
    return {
        "$expr": {
            "$eq": [
                {
                    "$toLower": {
                        "$trim": {
                            "input": {"$ifNull": ["$status", ""]},
                        }
                    }
                },
                value,
            ]
        }
    }


def _inpost_status_mongo_filter(buckets: list[str]) -> dict[str, Any]:
    """`buckets` is a non-empty proper subset of operating / created / disabled."""
    parts: list[dict[str, Any]] = []
    for b in buckets:
        if b == "operating":
            parts.append(_expr_norm_status_equals("operating"))
        elif b == "created":
            parts.append(_expr_norm_status_equals("created"))
        elif b == "disabled":
            parts.append(
                {
                    "$nor": [
                        _expr_norm_status_equals("operating"),
                        _expr_norm_status_equals("created"),
                    ]
                }
            )
    if len(parts) == 1:
        return parts[0]
    return {"$or": parts}


def build_points_mongo_filter(
    *,
    min_rating: float | None,
    max_rating: float | None,
    only_without_google_place: bool,
    partner_ids: list[Any] | None,
    min_review_time: int | None,
    max_review_time: int | None,
    inpost_status_buckets: list[str] | None,
    max_distance_to_google_place_m: float | None = None,
) -> dict[str, Any]:
    base = point_query_filter()
    rating_bounds = min_rating is not None or max_rating is not None
    partner_filter = bool(partner_ids)
    review_time_bounds = (
        min_review_time is not None or max_review_time is not None
    )
    inpost_status_filter = bool(inpost_status_buckets)
    distance_cap = max_distance_to_google_place_m is not None

    if (
        not rating_bounds
        and not only_without_google_place
        and not partner_filter
        and not review_time_bounds
        and not inpost_status_filter
        and not distance_cap
    ):
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

    if review_time_bounds:
        if min_review_time is not None and max_review_time is not None:
            parts.append(
                {
                    "$and": [
                        {
                            "google_reviews_time_unix_max": {
                                "$gte": min_review_time
                            }
                        },
                        {
                            "google_reviews_time_unix_min": {
                                "$lte": max_review_time
                            }
                        },
                    ]
                }
            )
        elif min_review_time is not None:
            parts.append(
                {"google_reviews_time_unix_max": {"$gte": min_review_time}}
            )
        elif max_review_time is not None:
            parts.append(
                {"google_reviews_time_unix_min": {"$lte": max_review_time}}
            )

    if inpost_status_filter and inpost_status_buckets is not None:
        parts.append(_inpost_status_mongo_filter(inpost_status_buckets))

    if max_distance_to_google_place_m is not None:
        # Include unresolved Google rows (no place id) alongside in-cap matches so
        # the default map is not empty of those points when a distance cap applies.
        parts.append(
            {
                "$or": [
                    _no_google_place_mongo_condition(),
                    {
                        "distance_to_google_place_m": {
                            "$lte": max_distance_to_google_place_m,
                        }
                    },
                ]
            }
        )

    if len(parts) == 1:
        return parts[0]
    return {"$and": parts}


def _location_geo_within_polygon(
    min_lat: float, max_lat: float, min_lng: float, max_lng: float
) -> dict[str, Any]:
    return {
        "location": {
            "$geoWithin": {
                "$geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [min_lng, min_lat],
                            [max_lng, min_lat],
                            [max_lng, max_lat],
                            [min_lng, max_lat],
                            [min_lng, min_lat],
                        ]
                    ],
                }
            }
        }
    }


def _combined_bbox_filter(
    query_filter: dict[str, Any],
    min_lat: float,
    max_lat: float,
    min_lng: float,
    max_lng: float,
) -> dict[str, Any]:
    geo = _location_geo_within_polygon(min_lat, max_lat, min_lng, max_lng)
    loc_ok = {
        "location": {"$exists": True, "$ne": None},
    }
    return {"$and": [query_filter, loc_ok, geo]}


def _validate_bbox(
    min_lat: float | None,
    max_lat: float | None,
    min_lng: float | None,
    max_lng: float | None,
) -> tuple[float, float, float, float]:
    if min_lat is None or max_lat is None or min_lng is None or max_lng is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "min_lat, max_lat, min_lng, and max_lng are required",
        )
    try:
        a, b, c, d = float(min_lat), float(max_lat), float(min_lng), float(max_lng)
    except (TypeError, ValueError) as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "bbox parameters must be numbers"
        ) from e
    if not (-90.0 <= a <= 90.0 and -90.0 <= b <= 90.0):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "latitude out of range")
    if not (-180.0 <= c <= 180.0 and -180.0 <= d <= 180.0):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "longitude out of range")
    if a > b or c > d:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "invalid bbox: require min_lat <= max_lat and min_lng <= max_lng",
        )
    return a, b, c, d


def _normalize_partner_ids_for_meta(raw: list[Any]) -> list[int]:
    out: list[int] = []
    for x in raw:
        if x is None:
            continue
        try:
            n = int(x)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        out.append(n)
    return sorted(set(out))


class MapPointListItem(BaseModel):
    """Bbox list row: no ``google_reviews``; no address/URI/status (see ``GET /points/{id}``)."""

    model_config = {"extra": "ignore"}

    inpost_point_id: str | None = None
    partner_id: str | int | None = None
    latitude: float
    longitude: float
    name: str | None = None
    google_rating: float | None = None
    google_user_ratings_total: int | None = None
    distance_to_google_place_m: float | None = None
    google_reviews_time_unix_min: int | None = None
    google_reviews_time_unix_max: int | None = None
    review_snippet_max_text_len: int = 0
    review_snippet_star_spread: float | None = None
    review_snippet_star_variance: float | None = None
    review_snippet_star_count: int = 0


class MapPoint(MapPointListItem):
    status: str | None = None
    validation_status: str | None = None
    formatted_address: str | None = None
    google_maps_uri: str | None = None
    google_reviews: list[dict[str, Any]] | None = None


class PointsListResponse(BaseModel):
    points: list[MapPointListItem]
    total_matching: int
    in_bbox_matching: int


def _coerce_map_point_lean_defaults(doc: dict[str, Any]) -> None:
    """BSON-safe ints/floats for spotlight summary fields (pre-/post-backfill)."""
    for k in ("review_snippet_max_text_len", "review_snippet_star_count"):
        v = doc.get(k)
        if v is None:
            doc[k] = 0
        else:
            try:
                doc[k] = int(v)
            except (TypeError, ValueError):
                doc[k] = 0
    for k in ("google_reviews_time_unix_min", "google_reviews_time_unix_max"):
        v = doc.get(k)
        if v is None or isinstance(v, bool):
            doc[k] = None
        else:
            try:
                doc[k] = int(v)
            except (TypeError, ValueError):
                doc[k] = None
    for k in ("review_snippet_star_spread", "review_snippet_star_variance"):
        v = doc.get(k)
        if v is None:
            continue
        try:
            doc[k] = float(v)
        except (TypeError, ValueError):
            doc[k] = None


mongo_client: MongoClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mongo_client
    mongo_client = MongoClient(settings.mongodb_uri)
    coll = mongo_client[settings.mongodb_db][settings.mongodb_collection]
    coll.create_index([("location", "2dsphere")], name="map_location_2dsphere")
    yield
    if mongo_client is not None:
        mongo_client.close()
        mongo_client = None


app = FastAPI(title="InPost map API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

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


def _rating_review_partner_validation(
    min_rating: float | None,
    max_rating: float | None,
    min_review_time: int | None,
    max_review_time: int | None,
) -> None:
    if min_rating is not None and max_rating is not None and min_rating > max_rating:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "min_rating must be less than or equal to max_rating",
        )

    if (
        min_review_time is not None
        and max_review_time is not None
        and min_review_time > max_review_time
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "min_review_time must be less than or equal to max_review_time",
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def health_ready(coll: Annotated[Any, Depends(get_collection)]) -> dict[str, str]:
    coll.find_one({}, projection={"_id": 1})
    return {"status": "ready"}


@app.get("/map-filters-meta")
@limiter.limit("20/minute")
def map_filters_meta(
    request: Request,
    _: Annotated[None, Depends(verify_api_key)],
    coll: Annotated[Any, Depends(get_collection)],
    min_rating: float | None = Query(default=None),
    max_rating: float | None = Query(default=None),
    no_google_place_only: bool = Query(default=False),
    _partner_id: list[str] | None = Query(default=None, alias="partner_id"),
    _inpost_status: list[str] | None = Query(default=None, alias="inpost_status"),
    min_review_time: int | None = Query(default=None),
    max_review_time: int | None = Query(default=None),
    max_distance_to_google_place_m: float | None = Query(
        default=None, ge=1, le=50
    ),
) -> dict[str, Any]:
    _rating_review_partner_validation(min_rating, max_rating, min_review_time, max_review_time)
    # `partner_id` is accepted for proxy symmetry with `/points` but must not affect
    # this distinct: excluding a type would remove it from the list and its chip would
    # disappear while selection state still references it.
    query_filter = build_points_mongo_filter(
        min_rating=min_rating,
        max_rating=max_rating,
        only_without_google_place=no_google_place_only,
        partner_ids=None,
        min_review_time=min_review_time,
        max_review_time=max_review_time,
        inpost_status_buckets=None,
        max_distance_to_google_place_m=max_distance_to_google_place_m,
    )
    raw_ids = coll.distinct("partner_id", filter=query_filter)
    return {"partner_ids": _normalize_partner_ids_for_meta(raw_ids)}


@app.get("/points", response_model=None)
@limiter.limit("30/minute")
def list_points(
    request: Request,
    _: Annotated[None, Depends(verify_api_key)],
    coll: Annotated[Any, Depends(get_collection)],
    min_lat: float | None = Query(default=None),
    max_lat: float | None = Query(default=None),
    min_lng: float | None = Query(default=None),
    max_lng: float | None = Query(default=None),
    max_points: int = Query(default=DEFAULT_MAX_POINTS, ge=1, le=500_000),
    min_rating: float | None = Query(default=None),
    max_rating: float | None = Query(default=None),
    no_google_place_only: bool = Query(default=False),
    partner_id: list[str] | None = Query(default=None),
    inpost_status: list[str] | None = Query(default=None),
    min_review_time: int | None = Query(default=None),
    max_review_time: int | None = Query(default=None),
    max_distance_to_google_place_m: float | None = Query(
        default=None, ge=1, le=50
    ),
) -> PointsListResponse | JSONResponse:
    _rating_review_partner_validation(min_rating, max_rating, min_review_time, max_review_time)
    a, b, c, d = _validate_bbox(min_lat, max_lat, min_lng, max_lng)

    partner_values = _parse_partner_id_values(partner_id)
    status_buckets = _parse_inpost_status_buckets(inpost_status)
    query_filter = build_points_mongo_filter(
        min_rating=min_rating,
        max_rating=max_rating,
        only_without_google_place=no_google_place_only,
        partner_ids=partner_values if partner_values else None,
        min_review_time=min_review_time,
        max_review_time=max_review_time,
        inpost_status_buckets=status_buckets,
        max_distance_to_google_place_m=max_distance_to_google_place_m,
    )
    combined = _combined_bbox_filter(query_filter, a, b, c, d)

    total_matching = int(coll.count_documents(query_filter))
    in_bbox_matching = int(coll.count_documents(combined))

    if in_bbox_matching > max_points:
        return JSONResponse(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            content={
                "error": "Too many points in the requested area; zoom in or narrow filters.",
                "in_bbox_matching": in_bbox_matching,
                "max_points": max_points,
            },
        )

    cursor = coll.find(filter=combined, projection=POINT_FIELDS_LEAN).sort(
        "inpost_point_id", 1
    )
    raw = list(cursor)
    points: list[MapPoint] = []
    for doc in raw:
        try:
            la = float(doc["latitude"])
            ln = float(doc["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        doc["latitude"] = la
        doc["longitude"] = ln
        doc.pop("google_reviews", None)
        _coerce_map_point_lean_defaults(doc)
        try:
            points.append(MapPointListItem.model_validate(doc))
        except Exception:
            continue

    return PointsListResponse(
        points=points,
        total_matching=total_matching,
        in_bbox_matching=in_bbox_matching,
    )


@app.get("/points/{inpost_point_id:path}", response_model=MapPoint)
@limiter.limit("60/minute")
def get_point_by_id(
    request: Request,
    _: Annotated[None, Depends(verify_api_key)],
    coll: Annotated[Any, Depends(get_collection)],
    inpost_point_id: str,
) -> MapPoint:
    doc = coll.find_one(
        {"inpost_point_id": inpost_point_id},
        projection=POINT_FIELDS_DETAIL,
    )
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Point not found")
    try:
        la = float(doc["latitude"])
        ln = float(doc["longitude"])
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Point not found") from e
    doc["latitude"] = la
    doc["longitude"] = ln
    _coerce_map_point_lean_defaults(doc)
    try:
        return MapPoint.model_validate(doc)
    except Exception as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Invalid point document") from e
