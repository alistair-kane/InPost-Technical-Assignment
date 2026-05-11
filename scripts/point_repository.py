from __future__ import annotations

from typing import Any


class PointRepository:
    def __init__(self, coll: Any) -> None:
        self.coll = coll

    def ensure_index(self) -> None:
        self.coll.create_index("inpost_point_id", unique=True, name="inpost_point_id_unique")

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
