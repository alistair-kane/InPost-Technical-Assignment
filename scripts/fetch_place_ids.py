#!/usr/bin/env python3
"""
Fetch a sample from the InPost global points API and resolve Google Place IDs.

Default: Places Nearby Search (legacy) around InPost coordinates with a tight radius,
scan result names for "inpost", pick the closest match.

Set DEFAULT_STRATEGY to "geocode" for address geocoding + Place Details name check.
CLI accepts only --sample-size, --start-page, --per-page; other behaviour uses module constants.
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

INPOST_POINTS_URL = "https://api-global-points.easypack24.net/v1/points"
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
NEARBY_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"


INPOST_NAME_SUBSTRING = "inpost"

# CLI defaults (first three argparse options)
DEFAULT_SAMPLE_SIZE = 25
DEFAULT_START_PAGE = 1
DEFAULT_PER_PAGE = 25

# Run / storage (no CLI; edit here to change behavior)
DEFAULT_MONGO_COLLECTION = "inpost_point_google_places"
DEFAULT_REQUEST_DELAY = 0.15
DEFAULT_STRATEGY = "nearby"
DEFAULT_RADIUS_METERS = 50
DEFAULT_NEARBY_KEYWORD: Optional[str] = None
DEFAULT_PAGINATION_DELAY = 2.0


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two WGS84 points."""
    return float(
        haversine_distance_m((lat1, lon1), (lat2, lon2), unit=Unit.METERS)
    )


@dataclass(frozen=True)
class RunConfig:
    strategy: str
    request_delay: float
    pagination_delay: float
    radius_meters: int
    keyword: Optional[str]


def load_settings() -> tuple[str, str]:
    load_dotenv()
    key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    uri = os.environ.get("MONGODB_URI", "").strip()
    if not key:
        print("GOOGLE_MAPS_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)
    if not uri:
        print("MONGODB_URI is not set.", file=sys.stderr)
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
    country = item.get("country") or ""

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


def bad_coordinates(lat: Optional[Any], lng: Optional[Any]) -> bool:
    try:
        la = float(lat)  # type: ignore[arg-type]
        ln = float(lng)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return True
    if abs(la) < 1e-9 and abs(ln) < 1e-9:
        return True
    return False


def fetch_inpost_items(
    session: requests.Session,
    sample_size: int,
    start_page: int,
    per_page: int,
) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    page = max(1, start_page)
    while len(collected) < sample_size:
        resp = session.get(
            INPOST_POINTS_URL,
            params={"page": page, "per_page": per_page},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("items") or []
        if not batch:
            break
        collected.extend(batch)
        total_pages = int(data.get("total_pages") or page)
        if page >= total_pages:
            break
        page += 1
    return collected[:sample_size]


def google_geocode(
    session: requests.Session, api_key: str, address: str, region: Optional[str]
) -> dict[str, Any]:
    params: dict[str, str] = {"address": address, "key": api_key}
    if region:
        params["region"] = region.lower()
    resp = session.get(GEOCODE_URL, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def google_place_details(session: requests.Session, api_key: str, place_id: str) -> dict[str, Any]:
    resp = session.get(
        PLACE_DETAILS_URL,
        params={
            "place_id": place_id,
            "fields": "name,place_id,url",
            "key": api_key,
        },
        timeout=30,
    )
    resp.raise_for_status()
    logging.info(f"Google place details: {resp.json()}")
    return resp.json()


def fetch_nearby_search_all_pages(
    session: requests.Session,
    api_key: str,
    lat: float,
    lng: float,
    radius_m: int,
    keyword: Optional[str],
    request_delay: float,
    pagination_delay: float,
) -> tuple[str, list[dict[str, Any]]]:
    """
    Paginate Nearby Search until exhausted. Sleeps before using next_page_token (Google requirement).
    """
    accumulated: list[dict[str, Any]] = []
    page_token: Optional[str] = None

    while True:
        if page_token is not None:
            time.sleep(max(0.0, pagination_delay))

        params: dict[str, str] = {
            "location": f"{lat},{lng}",
            "radius": str(radius_m),
            "key": api_key,
        }
        if keyword:
            params["keyword"] = keyword
        if page_token is not None:
            params["pagetoken"] = page_token
        else:
            time.sleep(max(0.0, request_delay))

        data: dict[str, Any] = {}
        status = "UNKNOWN"
        for _attempt in range(6):
            resp = session.get(NEARBY_SEARCH_URL, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            status = data.get("status") or "UNKNOWN"
            if status == "INVALID_REQUEST" and page_token is not None:
                time.sleep(max(0.0, pagination_delay))
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


def ensure_index(coll: Any) -> None:
    coll.create_index("inpost_point_id", unique=True, name="inpost_point_id_unique")


def _common_base(item: dict[str, Any]) -> tuple[dict[str, Any], Any, Any, str, str]:
    loc = item.get("location") or {}
    lat, lng = loc.get("latitude"), loc.get("longitude")
    country = item.get("country") or ""
    code = item.get("name") or ""
    inpost_point_id = f"{country}/{code}".strip("/")
    now = datetime.now(timezone.utc)
    base: dict[str, Any] = {
        "inpost_point_id": inpost_point_id,
        "country": country,
        "name": code,
        "latitude": lat,
        "longitude": lng,
        "geocode_query": "",
        "geocode_status": None,
        "places_nearby_status": None,
        "nearby_radius_m": None,
        "nearby_keyword": None,
        "nearby_results_total": None,
        "google_place_id": None,
        "google_place_name": None,
        "google_maps_uri": None,
        "formatted_address": None,
        "distance_to_google_place_m": None,
        "candidate_place_id": None,
        "inpost_name_match": False,
        "validation_status": None,
        "search_strategy": None,
        "updated_at": now,
    }
    return base, lat, lng, country, code


def process_item_nearby(
    session: requests.Session,
    api_key: str,
    item: dict[str, Any],
    cfg: RunConfig,
) -> dict[str, Any]:
    base, lat, lng, _country, _code = _common_base(item)
    base["search_strategy"] = "nearby"
    base["nearby_radius_m"] = cfg.radius_meters
    base["nearby_keyword"] = cfg.keyword

    if bad_coordinates(lat, lng):
        base["validation_status"] = "SKIPPED_BAD_COORDINATES"
        return base

    composed_address = build_geocode_query(item)
    base["geocode_query"] = composed_address
    base["formatted_address"] = _optional_trimmed_str(composed_address)

    lat_f = float(lat)  # type: ignore[arg-type]
    lng_f = float(lng)  # type: ignore[arg-type]

    status, raw_results = fetch_nearby_search_all_pages(
        session,
        api_key,
        lat_f,
        lng_f,
        cfg.radius_meters,
        cfg.keyword,
        cfg.request_delay,
        cfg.pagination_delay,
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

    details = google_place_details(session, api_key, pid)
    time.sleep(max(0.0, cfg.request_delay))
    if details.get("status") == "OK":
        res = details.get("result") or {}
        base["google_maps_uri"] = _extract_google_maps_uri(res)
    return base


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


def process_item_geocode(
    session: requests.Session,
    api_key: str,
    item: dict[str, Any],
    cfg: RunConfig,
) -> dict[str, Any]:
    base, lat, lng, country, _code = _common_base(item)
    base["search_strategy"] = "geocode"

    if bad_coordinates(lat, lng):
        base["validation_status"] = "SKIPPED_BAD_COORDINATES"
        return base

    query_address = build_geocode_query(item)
    base["geocode_query"] = query_address
    base["formatted_address"] = _optional_trimmed_str(query_address)
    if not query_address.strip():
        base["geocode_status"] = "INVALID_QUERY"
        base["validation_status"] = "GEOCODE_FAILED"
        return base

    gc = google_geocode(session, api_key, query_address, region=country if country else None)
    base["geocode_status"] = gc.get("status")
    time.sleep(max(0.0, cfg.request_delay))

    if gc.get("status") != "OK" or not gc.get("results"):
        base["validation_status"] = "GEOCODE_FAILED"
        return base

    gr0 = gc["results"][0]
    candidate_place_id = gr0.get("place_id")
    if not candidate_place_id:
        base["validation_status"] = "GEOCODE_FAILED"
        return base

    base["candidate_place_id"] = candidate_place_id

    details = google_place_details(session, api_key, candidate_place_id)
    time.sleep(max(0.0, cfg.request_delay))

    d_status = details.get("status")
    result = details.get("result") or {}
    pname = result.get("name") or ""

    base["google_place_name"] = pname or None
    if d_status == "OK":
        base["google_maps_uri"] = _extract_google_maps_uri(result)

    if d_status != "OK":
        base["validation_status"] = "PLACE_DETAILS_FAILED"
        base["google_place_id"] = None
        return base

    if INPOST_NAME_SUBSTRING not in pname.lower():
        base["validation_status"] = "NAME_MISSING_INPOST"
        base["google_place_id"] = None
        base["inpost_name_match"] = False
        return base

    base["google_place_id"] = candidate_place_id
    base["inpost_name_match"] = True
    base["validation_status"] = "OK"
    return base


def process_item(
    session: requests.Session,
    api_key: str,
    item: dict[str, Any],
    cfg: RunConfig,
) -> dict[str, Any]:
    if cfg.strategy == "nearby":
        return process_item_nearby(session, api_key, item, cfg)
    if cfg.strategy == "geocode":
        return process_item_geocode(session, api_key, item, cfg)
    raise ValueError(f"Unknown strategy: {cfg.strategy!r}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sample-size",
        type=int,
        default=DEFAULT_SAMPLE_SIZE,
        help=f"Maximum number of InPost points to process (default: {DEFAULT_SAMPLE_SIZE}).",
    )
    parser.add_argument(
        "--start-page",
        type=int,
        default=DEFAULT_START_PAGE,
        help=f"First InPost API page to fetch (1-based, default: {DEFAULT_START_PAGE}).",
    )
    parser.add_argument(
        "--per-page",
        type=int,
        default=DEFAULT_PER_PAGE,
        help=f"InPost API items per page (default: {DEFAULT_PER_PAGE}).",
    )

    args = parser.parse_args()
    if not (1 <= DEFAULT_RADIUS_METERS <= 50000):
        print("DEFAULT_RADIUS_METERS must be between 1 and 50000.", file=sys.stderr)
        sys.exit(2)

    kw = (DEFAULT_NEARBY_KEYWORD or "").strip() or None

    cfg = RunConfig(
        strategy=DEFAULT_STRATEGY,
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
    ensure_index(coll)

    with requests.Session() as session:
        session.headers.setdefault("Accept", "application/json")
        items = fetch_inpost_items(
            session, args.sample_size, args.start_page, args.per_page
        )
        print(f"Loaded {len(items)} InPost point(s); upserting to '{db.name}.{coll.name}'.")
        for i, item in enumerate(items, start=1):
            doc = process_item(session, api_key, item, cfg)
            pid = doc.get("inpost_point_id")
            coll.replace_one({"inpost_point_id": pid}, doc, upsert=True)
            print(
                f"[{i}/{len(items)}] {pid}: "
                f"validation={doc.get('validation_status')} "
                f"place_id={(doc.get('google_place_id') or '-')}"
            )

    client.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
