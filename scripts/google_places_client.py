from __future__ import annotations

import time
from typing import Any, Optional

import requests

from constants import DEFAULT_COUNTRY_CODE, NEARBY_SEARCH_URL, PLACE_DETAILS_URL


class GooglePlacesClient:
    def __init__(
        self,
        session: requests.Session,
        api_key: str,
        request_delay: float,
        pagination_delay: float,
    ) -> None:
        self.session = session
        self.api_key = api_key
        self.request_delay = request_delay
        self.pagination_delay = pagination_delay
        self.language = self._language_tag_for_places(DEFAULT_COUNTRY_CODE)

    @staticmethod
    def _language_tag_for_places(country_code: str) -> str:
        cc = (country_code or "").strip().upper()
        if not cc:
            return "en"
        if cc in ("GB", "UK", "US"):
            return "en"
        return cc.lower()

    _PLACE_DETAILS_FULL_FIELDS = "name,place_id,url,reviews,rating,user_ratings_total"

    def place_details(
        self,
        place_id: str,
        *,
        fields: Optional[str] = None,
        reviews_no_translations: Optional[bool] = None,
    ) -> dict[str, Any]:
        params: dict[str, str] = {
            "place_id": place_id,
            "fields": fields or self._PLACE_DETAILS_FULL_FIELDS,
            "key": self.api_key,
            "language": self.language,
        }
        if reviews_no_translations is True:
            params["reviews_no_translations"] = "true"
        elif reviews_no_translations is False:
            params["reviews_no_translations"] = "false"
        resp = self.session.get(PLACE_DETAILS_URL, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def nearby_search_all_pages(
        self,
        lat: float,
        lng: float,
        radius_m: int,
        keyword: Optional[str],
    ) -> tuple[str, list[dict[str, Any]]]:
        accumulated: list[dict[str, Any]] = []
        page_token: Optional[str] = None
        while True:
            if page_token is not None:
                time.sleep(max(0.0, self.pagination_delay))
            params: dict[str, str] = {
                "location": f"{lat},{lng}",
                "radius": str(radius_m),
                "key": self.api_key,
                "language": self.language,
            }
            if keyword:
                params["keyword"] = keyword
            if page_token is not None:
                params["pagetoken"] = page_token
            else:
                time.sleep(max(0.0, self.request_delay))
            data: dict[str, Any] = {}
            status = "UNKNOWN"
            for _attempt in range(6):
                resp = self.session.get(NEARBY_SEARCH_URL, params=params, timeout=30)
                resp.raise_for_status()
                data = resp.json()
                status = data.get("status") or "UNKNOWN"
                if status == "INVALID_REQUEST" and page_token is not None:
                    time.sleep(max(0.0, self.pagination_delay))
                    continue
                break
            else:
                return "NEARBY_PAGE_TOKEN_FAILED", accumulated
            if status not in ("OK", "ZERO_RESULTS"):
                return status, accumulated
            accumulated.extend(data.get("results") or [])
            nxt = data.get("next_page_token")
            if not nxt:
                return "OK", accumulated
            page_token = nxt

    def enrich_place_details(self, place_id: str, base: dict[str, Any]) -> None:
        resp_primary = self.place_details(place_id)
        time.sleep(max(0.0, self.request_delay))
        if resp_primary.get("status") != "OK":
            return
        place_main = resp_primary.get("result") or {}
        resp_original = self.place_details(place_id, reviews_no_translations=True)
        time.sleep(max(0.0, self.request_delay))
        reviews_original: Optional[list[Any]] = None
        if resp_original.get("status") == "OK":
            reviews_original = (resp_original.get("result") or {}).get("reviews")
        self._apply_place_details_to_doc(
            base,
            place_main,
            reviews_original_language=reviews_original if isinstance(reviews_original, list) else None,
        )

    @staticmethod
    def _extract_google_maps_uri(place_result: dict[str, Any]) -> Optional[str]:
        raw = place_result.get("url")
        if raw is None:
            return None
        s = str(raw).strip()
        return s or None

    @staticmethod
    def _extract_place_aggregate_rating(
        place_result: dict[str, Any],
    ) -> tuple[Optional[float], Optional[int]]:
        rating_raw = place_result.get("rating")
        total_raw = place_result.get("user_ratings_total")
        rating: Optional[float] = None
        total: Optional[int] = None
        if rating_raw is not None:
            try:
                rating = float(rating_raw)
            except (TypeError, ValueError):
                rating = None
        if total_raw is not None:
            try:
                total = int(total_raw)
            except (TypeError, ValueError):
                total = None
        return rating, total

    @staticmethod
    def _review_merge_key(rev: dict[str, Any]) -> tuple[Any, Any]:
        return (rev.get("time"), rev.get("author_url"))

    @classmethod
    def _normalize_google_reviews(
        cls,
        place_result: dict[str, Any],
        *,
        reviews_original_language: Optional[list[Any]] = None,
    ) -> list[dict[str, Any]]:
        raw = place_result.get("reviews")
        if not isinstance(raw, list):
            return []
        originals_by_key: dict[tuple[Any, Any], str] = {}
        if isinstance(reviews_original_language, list):
            for orv in reviews_original_language:
                if isinstance(orv, dict) and orv.get("text") is not None:
                    originals_by_key[cls._review_merge_key(orv)] = str(orv["text"])
        out: list[dict[str, Any]] = []
        for rev in raw:
            if not isinstance(rev, dict):
                continue
            entry: dict[str, Any] = {}
            if rev.get("author_name") is not None:
                entry["author_name"] = rev.get("author_name")
            if rev.get("author_url") is not None:
                entry["author_url"] = rev.get("author_url")
            if rev.get("language") is not None:
                entry["language"] = rev.get("language")
            if rev.get("original_language") is not None:
                entry["original_language"] = rev.get("original_language")
            if rev.get("profile_photo_url") is not None:
                entry["profile_photo_url"] = rev.get("profile_photo_url")
            if rev.get("rating") is not None:
                entry["rating"] = rev.get("rating")
            if rev.get("relative_time_description") is not None:
                entry["relative_time_description"] = rev.get("relative_time_description")
            if rev.get("text") is not None:
                entry["text"] = rev.get("text")
            if rev.get("time") is not None:
                entry["time_unix"] = rev.get("time")
            if rev.get("translated") is not None:
                entry["translated"] = rev.get("translated")
            orig_text = originals_by_key.get(cls._review_merge_key(rev))
            if orig_text is not None:
                entry["text_original"] = orig_text
            elif not rev.get("translated") and rev.get("text") is not None:
                entry["text_original"] = rev.get("text")
            if entry:
                out.append(entry)
        return out

    @classmethod
    def _apply_place_details_to_doc(
        cls,
        base: dict[str, Any],
        place_result: dict[str, Any],
        *,
        reviews_original_language: Optional[list[Any]] = None,
    ) -> None:
        base["google_maps_uri"] = cls._extract_google_maps_uri(place_result)
        gr, gut = cls._extract_place_aggregate_rating(place_result)
        base["google_rating"] = gr
        base["google_user_ratings_total"] = gut
        base["google_reviews"] = cls._normalize_google_reviews(
            place_result,
            reviews_original_language=reviews_original_language,
        )
