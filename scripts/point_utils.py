from __future__ import annotations

from typing import Any

from constants import DEFAULT_COUNTRY_CODE
from haversine import Unit, haversine as haversine_distance_m


def inpost_point_id_from_item(item: dict[str, Any]) -> str:
    raw_c = (item.get("country") or "").strip()
    country = raw_c or (DEFAULT_COUNTRY_CODE or "").strip()
    code = item.get("name") or ""
    return f"{country}/{code}".strip("/")


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return float(haversine_distance_m((lat1, lon1), (lat2, lon2), unit=Unit.METERS))


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
