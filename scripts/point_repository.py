from __future__ import annotations

from typing import Any, Optional

# Matches map API `point_query_filter()` (map_eligible=True + sane coords). Partial index
# filters cannot use $ne, $nin (incl. $nin: [null]) — they lower to $not; use $type instead.
_NUMERIC_TYPES: list[str] = ["double", "int", "long", "decimal"]
_MAP_POINTS_PARTIAL_FILTER: dict[str, Any] = {
    "map_eligible": True,
    "latitude": {"$type": _NUMERIC_TYPES, "$gte": -90.0, "$lte": 90.0},
    "longitude": {"$type": _NUMERIC_TYPES, "$gte": -180.0, "$lte": 180.0},
}


class PointRepository:
    def __init__(self, coll: Any) -> None:
        self.coll = coll

    def ensure_index(self) -> None:
        self.coll.create_index("inpost_point_id", unique=True, name="inpost_point_id_unique")
        self.coll.create_index(
            [("partner_id", 1), ("google_rating", 1), ("distance_to_google_place_m", 1)],
            name="map_filters_partner_rating_distance",
        )
        self.coll.create_index(
            [("google_rating", 1), ("distance_to_google_place_m", 1)],
            name="map_filters_rating_distance_partial",
            partialFilterExpression=_MAP_POINTS_PARTIAL_FILTER,
        )
        self.coll.create_index([("location", "2dsphere")], name="map_location_2dsphere")

    def existing_point_ids(self, ids: list[str]) -> set[str]:
        if not ids:
            return set()
        existing: set[str] = set()
        cursor = self.coll.find(
            {"inpost_point_id": {"$in": ids}},
            {"inpost_point_id": 1},
        )
        for doc in cursor:
            pid = doc.get("inpost_point_id")
            if pid:
                existing.add(str(pid))
        return existing

    def upsert_point(self, doc: dict[str, Any]) -> None:
        pid = doc.get("inpost_point_id")
        self.coll.replace_one({"inpost_point_id": pid}, doc, upsert=True)

    def find_holders_of_place_id(
        self, place_id: str, exclude_inpost_point_id: str
    ) -> list[dict[str, Any]]:
        return list(
            self.coll.find(
                {
                    "google_place_id": place_id,
                    "inpost_point_id": {"$ne": exclude_inpost_point_id},
                },
                {
                    "inpost_point_id": 1,
                    "distance_to_google_place_m": 1,
                    "status": 1,
                    "google_user_ratings_total": 1,
                    "google_reviews": 1,
                    "_id": 1,
                },
            )
        )

    def get_by_inpost_point_id(self, inpost_point_id: str) -> Optional[dict[str, Any]]:
        return self.coll.find_one({"inpost_point_id": inpost_point_id})
