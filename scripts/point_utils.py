from __future__ import annotations

from typing import Any, Optional

from constants import DEFAULT_COUNTRY_CODE, INPOST_NAME_SUBSTRING
from haversine import Unit, haversine as haversine_distance_m


def optional_trimmed_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def inpost_point_id_from_item(item: dict[str, Any]) -> str:
    raw_c = (item.get("country") or "").strip()
    country = raw_c or (DEFAULT_COUNTRY_CODE or "").strip()
    code = item.get("name") or ""
    return f"{country}/{code}".strip("/")


def synthetic_inpost_item_from_stored(doc: dict[str, Any]) -> dict[str, Any]:
    """Rebuild minimal InPost API-shaped dict from a Mongo point document (re-resolution)."""
    return {
        "country": doc.get("country") or DEFAULT_COUNTRY_CODE,
        "name": doc.get("name"),
        "location": {
            "latitude": doc.get("latitude"),
            "longitude": doc.get("longitude"),
        },
        "address": {},
        "address_details": {},
        "partner_id": doc.get("partner_id"),
        "status": doc.get("status"),
    }


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return float(haversine_distance_m((lat1, lon1), (lat2, lon2), unit=Unit.METERS))


def ranked_inpost_named_nearby_results(
    raw_results: list[dict[str, Any]],
    center_lat: float,
    center_lng: float,
) -> list[tuple[float, dict[str, Any]]]:
    """InPost-name-filtered Nearby results sorted by distance then ``place_id``."""
    candidates: list[tuple[float, dict[str, Any]]] = []
    for r in raw_results:
        name = (r.get("name") or "")
        if INPOST_NAME_SUBSTRING not in name.lower():
            continue
        geom = r.get("geometry") or {}
        loc = geom.get("location") or {}
        try:
            rlat = float(loc.get("lat"))
            rlng = float(loc.get("lng"))
        except (TypeError, ValueError):
            continue
        d = distance_m(center_lat, center_lng, rlat, rlng)
        candidates.append((d, r))
    candidates.sort(key=lambda t: (t[0], str((t[1].get("place_id") or ""))))
    return candidates


def review_time_unix_min_max_from_reviews(
    reviews: list[dict[str, Any]] | None,
) -> tuple[Any, Any]:
    """Min/max `time_unix` across review dicts; (None, None) if none present."""
    if not reviews:
        return None, None
    vals: list[int] = []
    for r in reviews:
        if not isinstance(r, dict):
            continue
        t = r.get("time_unix")
        if isinstance(t, bool):
            continue
        if isinstance(t, int):
            vals.append(t)
        elif isinstance(t, float) and t == t:  # not NaN
            vals.append(int(t))
    if not vals:
        return None, None
    return min(vals), max(vals)


def _review_body_len(review: dict[str, Any]) -> int:
    """Match ``mapSpotlightPresets.ts`` ``reviewBodyLen``: longer of trimmed originals vs text."""
    a = str(review.get("text_original") or "").strip()
    b = str(review.get("text") or "").strip()
    t = a if len(a) >= len(b) else b
    return len(t)


def _per_review_star_ratings(reviews: list[dict[str, Any]]) -> list[float]:
    """Finite per-review stars in ``[1, 5]`` — same filter as TS ``perReviewStarRatings``."""
    out: list[float] = []
    for r in reviews:
        if not isinstance(r, dict):
            continue
        x = r.get("rating")
        if isinstance(x, bool):
            continue
        if isinstance(x, int):
            xf = float(x)
        elif isinstance(x, float) and x == x:
            xf = float(x)
        else:
            continue
        if 1.0 <= xf <= 5.0:
            out.append(xf)
    return out


def compute_review_spotlight_summaries(
    reviews: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """
    Scalar denormalization for lean map list + spotlights (must match TS spotlight logic).

    Keys: ``review_snippet_max_text_len``, ``review_snippet_star_spread``,
    ``review_snippet_star_variance``, ``review_snippet_star_count``.
    When ``star_count < 2``, spread and variance are None (not eligible for controversy).
    """
    if not reviews:
        return {
            "review_snippet_max_text_len": 0,
            "review_snippet_star_spread": None,
            "review_snippet_star_variance": None,
            "review_snippet_star_count": 0,
        }
    max_len = 0
    for r in reviews:
        if isinstance(r, dict):
            max_len = max(max_len, _review_body_len(r))
    ratings = _per_review_star_ratings([r for r in reviews if isinstance(r, dict)])
    n = len(ratings)
    if n < 2:
        return {
            "review_snippet_max_text_len": max_len,
            "review_snippet_star_spread": None,
            "review_snippet_star_variance": None,
            "review_snippet_star_count": n,
        }
    lo = min(ratings)
    hi = max(ratings)
    spread = hi - lo
    mean = sum(ratings) / n
    variance = sum((v - mean) * (v - mean) for v in ratings) / n
    return {
        "review_snippet_max_text_len": max_len,
        "review_snippet_star_spread": float(spread),
        "review_snippet_star_variance": float(variance),
        "review_snippet_star_count": n,
    }


def apply_review_spotlight_summaries(doc: dict[str, Any]) -> None:
    """Write ``review_snippet_*`` fields from ``doc[''google_reviews'']`` (mutates doc)."""
    raw = doc.get("google_reviews")
    reviews = raw if isinstance(raw, list) else None
    clean = [r for r in (reviews or []) if isinstance(r, dict)]
    out = compute_review_spotlight_summaries(clean)
    doc["review_snippet_max_text_len"] = int(out["review_snippet_max_text_len"])
    doc["review_snippet_star_spread"] = out["review_snippet_star_spread"]
    doc["review_snippet_star_variance"] = out["review_snippet_star_variance"]
    doc["review_snippet_star_count"] = int(out["review_snippet_star_count"])


def apply_location_and_review_time_bounds(doc: dict[str, Any]) -> None:
    """Set GeoJSON `location` and denormalized review time bounds for map queries."""
    lat, lng = doc.get("latitude"), doc.get("longitude")
    try:
        la = float(lat)  # type: ignore[arg-type]
        ln = float(lng)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        doc.pop("location", None)
    else:
        if -90.0 <= la <= 90.0 and -180.0 <= ln <= 180.0:
            doc["location"] = {"type": "Point", "coordinates": [ln, la]}
        else:
            doc.pop("location", None)
    raw = doc.get("google_reviews")
    reviews = raw if isinstance(raw, list) else None
    tmin, tmax = review_time_unix_min_max_from_reviews(reviews)
    doc["google_reviews_time_unix_min"] = tmin
    doc["google_reviews_time_unix_max"] = tmax
    apply_review_spotlight_summaries(doc)


def map_eligible_for_document(doc: dict[str, Any]) -> bool:
    """Same inclusion rule as the map API: not skipped for bad coordinates, sane lat/lng."""
    if doc.get("validation_status") == "SKIPPED_BAD_COORDINATES":
        return False
    lat, lng = doc.get("latitude"), doc.get("longitude")
    if lat is None or lng is None:
        return False
    try:
        la = float(lat)
        ln = float(lng)
    except (TypeError, ValueError):
        return False
    return -90.0 <= la <= 90.0 and -180.0 <= ln <= 180.0
