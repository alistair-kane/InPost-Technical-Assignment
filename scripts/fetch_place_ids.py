#!/usr/bin/env python3
"""
Fetch a sample from the InPost global points API and resolve Google Place IDs.

Uses Places Nearby Search (legacy) around InPost coordinates with a tight radius,
scans place names for "inpost", picks the closest match, then Place Details (+ reviews).

``DEFAULT_COUNTRY_CODE`` filters the InPost list request, filters batch items, fills missing
item country for stored address text, and sets Places ``language`` (see ``_language_tag_for_places``).

Pagination uses module constants; country is solely ``DEFAULT_COUNTRY_CODE``.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from haversine import Unit, haversine as haversine_distance_m
from pymongo import MongoClient

logger = logging.getLogger(__name__)

INPOST_POINTS_URL = "https://api-global-points.easypack24.net/v1/points"
PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
NEARBY_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"


INPOST_NAME_SUBSTRING = "inpost"

# CLI default
DEFAULT_SAMPLE_SIZE = 25
DEFAULT_START_PAGE = 1
DEFAULT_PER_PAGE = 1000
DEFAULT_COUNTRY_CODE = "PL"

# Run / storage (no CLI; edit here to change behavior)
DEFAULT_MONGO_COLLECTION = "inpost_point_google_places"
DEFAULT_REQUEST_DELAY = 0.15
DEFAULT_RADIUS_METERS = 50
DEFAULT_NEARBY_KEYWORD: Optional[str] = None
DEFAULT_PAGINATION_DELAY = 2.0


def _language_tag_for_places(country_code: str) -> str:
    """BCP-47 tag for Google Places ``language`` from ISO 3166-1 alpha-2."""
    cc = (country_code or "").strip().upper()
    if not cc:
        return "en"
    # Country code is not always a language tag (e.g. GB -> en).
    if cc in ("GB", "UK"):
        return "en"
    if cc == "US":
        return "en"
    return cc.lower()


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two WGS84 points."""
    return float(
        haversine_distance_m((lat1, lon1), (lat2, lon2), unit=Unit.METERS)
    )


@dataclass(frozen=True)
class RunConfig:
    request_delay: float
    pagination_delay: float
    radius_meters: int
    keyword: Optional[str]


def load_settings() -> tuple[str, str]:
    load_dotenv()
    key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    uri = os.environ.get("MONGODB_URI", "").strip()
    if not key:
        logger.error("GOOGLE_MAPS_API_KEY is not set.")
        sys.exit(1)
    if not uri:
        logger.error("MONGODB_URI is not set.")
        sys.exit(1)
    return key, uri


def database_name_from_uri(mongo_uri: str, fallback: str = "inpost_assignment") -> str:
    parsed = urlparse(mongo_uri)
    segment = parsed.path.strip("/").split("/", 1)[0] if parsed.path.strip("/") else ""
    return segment or fallback


def build_geocode_query(item: dict[str, Any]) -> str:
    details = item.get("address_details") or {}
    addr = item.get("address") or {}
    street = details.get("street")
    building = details.get("building_number")
    line1_parts: list[str] = []
    if street:
        line1_parts.append(str(street).strip())
        if building:
            line1_parts[-1] = f"{line1_parts[-1]} {building}".strip()
    elif addr.get("line1"):
        line1_parts.append(str(addr["line1"]).strip())

    city = details.get("city")
    postcode = details.get("post_code")
    raw_c = (item.get("country") or "").strip()
    country = raw_c or (DEFAULT_COUNTRY_CODE or "").strip()

    pieces: list[str] = []
    if line1_parts:
        pieces.append(line1_parts[0])
    city_line_parts: list[str] = []
    if postcode:
        city_line_parts.append(str(postcode).strip())
    if city:
        city_line_parts.append(str(city).strip())
    if city_line_parts:
        pieces.append(" ".join(city_line_parts))
    if country:
        pieces.append(str(country).strip())

    return ", ".join(p for p in pieces if p)


def inpost_point_id_from_item(item: dict[str, Any]) -> str:
    """Stable id: ``{country}/{name}`` (same as persisted ``inpost_point_id``)."""
    raw_c = (item.get("country") or "").strip()
    country = raw_c or (DEFAULT_COUNTRY_CODE or "").strip()
    code = item.get("name") or ""
    return f"{country}/{code}".strip("/")


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


def bad_coordinates(lat: Optional[Any], lng: Optional[Any]) -> bool:
    try:
        la = float(lat)  # type: ignore[arg-type]
        ln = float(lng)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return True
    if abs(la) < 1e-9 and abs(ln) < 1e-9:
        return True
    return False


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

    def _item_country_matches(self, item: dict[str, Any]) -> bool:
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
                if not self._item_country_matches(item):
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
        self.language = _language_tag_for_places(DEFAULT_COUNTRY_CODE)

    def place_details(
        self,
        place_id: str,
        *,
        reviews_no_translations: Optional[bool] = None,
    ) -> dict[str, Any]:
        params: dict[str, str] = {
            "place_id": place_id,
            "fields": "name,place_id,url,reviews",
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

        _apply_place_details_to_doc(
            base,
            place_main,
            reviews_original_language=reviews_original if isinstance(reviews_original, list) else None,
        )


def pick_closest_inpost_place(
    results: list[dict[str, Any]], center_lat: float, center_lng: float
) -> Optional[dict[str, Any]]:
    """Places whose name contains INPOST_NAME_SUBSTRING; closest to center wins."""
    candidates: list[tuple[float, dict[str, Any]]] = []
    for r in results:
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
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


def _common_base(item: dict[str, Any]) -> tuple[dict[str, Any], Any, Any]:
    loc = item.get("location") or {}
    lat, lng = loc.get("latitude"), loc.get("longitude")
    raw_c = (item.get("country") or "").strip()
    country = raw_c or (DEFAULT_COUNTRY_CODE or "").strip()
    code = item.get("name") or ""
    inpost_point_id = inpost_point_id_from_item(item)
    now = datetime.now(timezone.utc)
    base: dict[str, Any] = {
        "inpost_point_id": inpost_point_id,
        "country": country,
        "name": code,
        "latitude": lat,
        "longitude": lng,
        "geocode_query": "",
        "places_nearby_status": None,
        "nearby_radius_m": None,
        "nearby_keyword": None,
        "nearby_results_total": None,
        "google_place_id": None,
        "google_place_name": None,
        "google_maps_uri": None,
        "google_reviews": None,
        "formatted_address": None,
        "distance_to_google_place_m": None,
        "candidate_place_id": None,
        "inpost_name_match": False,
        "validation_status": None,
        "search_strategy": None,
        "updated_at": now,
    }
    return base, lat, lng


class PointResolutionService:
    def __init__(
        self,
        inpost_client: InpostClient,
        places_client: GooglePlacesClient,
        repository: PointRepository,
        cfg: RunConfig,
    ) -> None:
        self.inpost_client = inpost_client
        self.places_client = places_client
        self.repository = repository
        self.cfg = cfg

    def process_item(self, item: dict[str, Any]) -> dict[str, Any]:
        base, lat, lng = _common_base(item)
        base["search_strategy"] = "nearby"
        base["nearby_radius_m"] = self.cfg.radius_meters
        base["nearby_keyword"] = self.cfg.keyword

        if bad_coordinates(lat, lng):
            base["validation_status"] = "SKIPPED_BAD_COORDINATES"
            return base

        composed_address = build_geocode_query(item)
        base["geocode_query"] = composed_address
        base["formatted_address"] = _optional_trimmed_str(composed_address)

        lat_f = float(lat)  # type: ignore[arg-type]
        lng_f = float(lng)  # type: ignore[arg-type]
        status, raw_results = self.places_client.nearby_search_all_pages(
            lat_f,
            lng_f,
            self.cfg.radius_meters,
            self.cfg.keyword,
        )
        base["places_nearby_status"] = status
        base["nearby_results_total"] = len(raw_results)

        if status not in ("OK", "ZERO_RESULTS"):
            base["validation_status"] = "NEARBY_FAILED"
            return base

        chosen = pick_closest_inpost_place(raw_results, lat_f, lng_f)
        if chosen is None:
            base["validation_status"] = "NO_INPOST_IN_RADIUS"
            return base

        pname = (chosen.get("name") or "").strip()
        pid = chosen.get("place_id")
        base["google_place_name"] = pname or None
        base["candidate_place_id"] = pid

        if not pid:
            base["validation_status"] = "NEARBY_MISSING_PLACE_ID"
            return base

        geom = chosen.get("geometry") or {}
        loc = geom.get("location") or {}
        try:
            glat = float(loc.get("lat"))
            glng = float(loc.get("lng"))
            base["distance_to_google_place_m"] = round(distance_m(lat_f, lng_f, glat, glng), 2)
        except (TypeError, ValueError):
            base["distance_to_google_place_m"] = None

        base["google_place_id"] = pid
        base["inpost_name_match"] = True
        base["validation_status"] = "OK"
        self.places_client.enrich_place_details(pid, base)
        return base

    def run(self, sample_size: int) -> None:
        items = self.inpost_client.fetch_items_missing_place(sample_size, self.repository)
        logger.info("Loaded %s InPost point(s) to upsert.", len(items))
        for i, item in enumerate(items, start=1):
            doc = self.process_item(item)
            pid = doc.get("inpost_point_id")
            self.repository.upsert_point(doc)
            logger.info(
                "[%s/%s] %s: validation=%s place_id=%s",
                i,
                len(items),
                pid,
                doc.get("validation_status"),
                doc.get("google_place_id") or "-",
            )


def _optional_trimmed_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _extract_google_maps_uri(place_result: dict[str, Any]) -> Optional[str]:
    raw = place_result.get("url")
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def _review_merge_key(rev: dict[str, Any]) -> tuple[Any, Any]:
    """Match default + original-language review rows from two Place Details calls."""
    return (rev.get("time"), rev.get("author_url"))


def _normalize_google_reviews(
    place_result: dict[str, Any],
    *,
    reviews_original_language: Optional[list[Any]] = None,
) -> list[dict[str, Any]]:
    """
    Map Place Details `reviews` to BSON-friendly dicts (Places Web Service reviews field).

    `text` follows the preferred-language / translated response where applicable.
    `text_original` is filled from a second Details request (`reviews_no_translations=true`).
    """
    raw = place_result.get("reviews")
    if not isinstance(raw, list):
        return []

    originals_by_key: dict[tuple[Any, Any], str] = {}
    if isinstance(reviews_original_language, list):
        for orv in reviews_original_language:
            if isinstance(orv, dict) and orv.get("text") is not None:
                originals_by_key[_review_merge_key(orv)] = str(orv["text"])

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

        orig_text = originals_by_key.get(_review_merge_key(rev))
        if orig_text is not None:
            entry["text_original"] = orig_text
        elif not rev.get("translated") and rev.get("text") is not None:
            entry["text_original"] = rev.get("text")

        if entry:
            out.append(entry)
    return out


def _apply_place_details_to_doc(
    base: dict[str, Any],
    place_result: dict[str, Any],
    *,
    reviews_original_language: Optional[list[Any]] = None,
) -> None:
    base["google_maps_uri"] = _extract_google_maps_uri(place_result)
    base["google_reviews"] = _normalize_google_reviews(
        place_result,
        reviews_original_language=reviews_original_language,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sample-size",
        type=int,
        default=DEFAULT_SAMPLE_SIZE,
        help=(
            "Target count of InPost points that still need a Google Place id "
            f"(paginates API until reached or exhausted; default: {DEFAULT_SAMPLE_SIZE})."
        ),
    )
    args = parser.parse_args()
    if args.sample_size < 1:
        logger.error("--sample-size must be >= 1.")
        sys.exit(2)

    kw = (DEFAULT_NEARBY_KEYWORD or "").strip() or None
    effective_per_page = min(DEFAULT_PER_PAGE, args.sample_size)

    cfg = RunConfig(
        request_delay=DEFAULT_REQUEST_DELAY,
        pagination_delay=DEFAULT_PAGINATION_DELAY,
        radius_meters=DEFAULT_RADIUS_METERS,
        keyword=kw,
    )

    api_key, mongo_uri = load_settings()

    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=8000)
    client.admin.command("ping")
    db = client[database_name_from_uri(mongo_uri)]
    coll = db[DEFAULT_MONGO_COLLECTION]
    repository = PointRepository(coll)
    repository.ensure_index()

    with requests.Session() as session:
        session.headers.setdefault("Accept", "application/json")
        inpost_client = InpostClient(session, DEFAULT_START_PAGE, effective_per_page)
        places_client = GooglePlacesClient(
            session,
            api_key,
            request_delay=cfg.request_delay,
            pagination_delay=cfg.pagination_delay,
        )
        service = PointResolutionService(inpost_client, places_client, repository, cfg)
        logger.info(
            "Processing up to %s InPost point(s) into '%s.%s'.",
            args.sample_size,
            db.name,
            coll.name,
        )
        service.run(args.sample_size)

    client.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s %(message)s",
    )
    main()
