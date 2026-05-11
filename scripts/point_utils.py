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
