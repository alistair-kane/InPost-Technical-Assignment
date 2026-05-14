from __future__ import annotations

from typing import Any

import requests

from constants import DEFAULT_COUNTRY_CODE, INPOST_POINTS_URL
from point_repository import PointRepository
from point_utils import inpost_point_id_from_item


class InpostClient:
    def __init__(self, session: requests.Session, start_page: int, per_page: int) -> None:
        self.session = session
        self.start_page = max(1, start_page)
        self.per_page = per_page
        self.country_code = (DEFAULT_COUNTRY_CODE or "").strip().upper()

    def _fetch_page(self, page: int) -> tuple[list[dict[str, Any]], int]:
        params: dict[str, Any] = {"page": page, "per_page": self.per_page}
        if self.country_code:
            params["country"] = self.country_code
        resp = self.session.get(INPOST_POINTS_URL, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("items") or []
        total_pages = max(1, int(data.get("total_pages") or page))
        return list(batch), total_pages

    def item_country_matches(self, item: dict[str, Any]) -> bool:
        if not self.country_code:
            return True
        item_country = (item.get("country") or self.country_code).strip().upper()
        return item_country == self.country_code

    def fetch_items_missing_place(self, sample_size: int, repo: PointRepository) -> list[dict[str, Any]]:
        pending: list[dict[str, Any]] = []
        page = self.start_page
        while len(pending) < sample_size:
            batch, total_pages = self._fetch_page(page)
            if not batch:
                break
            ids_in_batch = [inpost_point_id_from_item(i) for i in batch]
            already = repo.existing_point_ids(ids_in_batch)
            for item in batch:
                if not self.item_country_matches(item):
                    continue
                pid = inpost_point_id_from_item(item)
                if pid in already:
                    continue
                pending.append(item)
                if len(pending) >= sample_size:
                    break
            if page >= total_pages:
                break
            page += 1
        return pending[:sample_size]