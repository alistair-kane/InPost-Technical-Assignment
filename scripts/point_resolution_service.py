from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from constants import COUNTRY_BOUNDING_BOXES, DEFAULT_COUNTRY_CODE
from google_places_client import GooglePlacesClient
from inpost_client import InpostClient
from locker_precedence import apply_preview_to_locker_fields, newcomer_beats_all_holders
from point_repository import PointRepository
from point_utils import (
    apply_location_and_review_time_bounds,
    distance_m,
    inpost_point_id_from_item,
    map_eligible_for_document,
    optional_trimmed_str,
    ranked_inpost_named_nearby_results,
    synthetic_inpost_item_from_stored,
)

logger = logging.getLogger(__name__)

MAX_RESOLVE_DEPTH = 3


class PointResolutionService:
    def __init__(
        self,
        inpost_client: InpostClient,
        places_client: GooglePlacesClient,
        repository: PointRepository,
        radius_meters: int,
        keyword: Optional[str],
    ) -> None:
        self.inpost_client = inpost_client
        self.places_client = places_client
        self.repository = repository
        self.radius_meters = radius_meters
        self.keyword = keyword

    @staticmethod
    def _bad_coordinates(lat: Optional[Any], lng: Optional[Any]) -> bool:
        try:
            la = float(lat)  # type: ignore[arg-type]
            ln = float(lng)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return True
        if abs(la) <= 1 and abs(ln) <= 1:
            return True
        bbox = COUNTRY_BOUNDING_BOXES.get((DEFAULT_COUNTRY_CODE or "").strip().upper())
        if bbox is None:
            return False
        min_lat, min_lng, max_lat, max_lng = bbox
        return not (min_lat <= la <= max_lat and min_lng <= ln <= max_lng)

    @staticmethod
    def _build_geocode_query(item: dict[str, Any]) -> str:
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

    @staticmethod
    def _common_base(item: dict[str, Any]) -> tuple[dict[str, Any], Any, Any]:
        loc = item.get("location") or {}
        lat, lng = loc.get("latitude"), loc.get("longitude")
        raw_c = (item.get("country") or "").strip()
        country = raw_c or (DEFAULT_COUNTRY_CODE or "").strip()
        code = item.get("name") or ""
        inpost_point_id = inpost_point_id_from_item(item)
        partner_id = item.get("partner_id")
        now = datetime.now(timezone.utc)
        base: dict[str, Any] = {
            "inpost_point_id": inpost_point_id,
            "partner_id": partner_id,
            "country": country,
            "name": code,
            "latitude": lat,
            "longitude": lng,
            "places_nearby_status": None,
            "nearby_radius_m": None,
            "nearby_keyword": None,
            "nearby_results_total": None,
            "google_place_id": None,
            "google_place_name": None,
            "google_maps_uri": None,
            "google_rating": None,
            "google_user_ratings_total": None,
            "google_reviews": None,
            "formatted_address": None,
            "distance_to_google_place_m": None,
            "candidate_place_id": None,
            "inpost_name_match": False,
            "validation_status": None,
            "search_strategy": None,
            "status": optional_trimmed_str(item.get("status")),
            "updated_at": now,
        }
        return base, lat, lng

    def process_item(self, item: dict[str, Any]) -> dict[str, Any]:
        return self._process_item_impl(item, 0)

    def _process_item_impl(self, item: dict[str, Any], depth: int) -> dict[str, Any]:
        base, lat, lng = self._common_base(item)
        base["search_strategy"] = "nearby"
        base["nearby_radius_m"] = self.radius_meters
        base["nearby_keyword"] = self.keyword
        if depth > MAX_RESOLVE_DEPTH:
            base["validation_status"] = "RESOLVE_DEPTH_EXCEEDED"
            base["map_eligible"] = map_eligible_for_document(base)
            return base
        if self._bad_coordinates(lat, lng):
            base["validation_status"] = "SKIPPED_BAD_COORDINATES"
            base["map_eligible"] = map_eligible_for_document(base)
            return base
        composed_address = self._build_geocode_query(item)
        base["formatted_address"] = optional_trimmed_str(composed_address)
        lat_f = float(lat)  # type: ignore[arg-type]
        lng_f = float(lng)  # type: ignore[arg-type]
        status, raw_results = self.places_client.nearby_search_all_pages(
            lat_f,
            lng_f,
            self.radius_meters,
            self.keyword,
        )
        base["places_nearby_status"] = status
        base["nearby_results_total"] = len(raw_results)
        if status not in ("OK", "ZERO_RESULTS"):
            base["validation_status"] = "NEARBY_FAILED"
            base["map_eligible"] = map_eligible_for_document(base)
            return base
        ranked = ranked_inpost_named_nearby_results(raw_results, lat_f, lng_f)
        if not ranked:
            base["validation_status"] = "NO_INPOST_IN_RADIUS"
            base["map_eligible"] = map_eligible_for_document(base)
            return base

        my_pid = str(base.get("inpost_point_id") or "")
        picked: Optional[dict[str, Any]] = None
        picked_dist: Optional[float] = None
        for dist_m, chosen in ranked:
            pid_raw = chosen.get("place_id")
            pid = str(pid_raw).strip() if pid_raw else ""
            if not pid:
                continue
            holders = self.repository.find_holders_of_place_id(pid, my_pid)
            if not holders:
                picked = chosen
                picked_dist = dist_m
                break
            preview = self.places_client.place_details_preview_for_conflict(pid)
            newcomer: dict[str, Any] = {
                "status": base.get("status"),
                "distance_to_google_place_m": round(float(dist_m), 2),
                "_id": None,
                "inpost_point_id": base.get("inpost_point_id"),
            }
            if preview:
                apply_preview_to_locker_fields(newcomer, preview)
            else:
                newcomer["google_rating"] = None
                newcomer["google_user_ratings_total"] = None
                newcomer["google_reviews"] = None
            if newcomer_beats_all_holders(newcomer, holders):
                for h in sorted(holders, key=lambda x: str(x.get("inpost_point_id") or "")):
                    hid = str(h.get("inpost_point_id") or "")
                    if not hid:
                        continue
                    full = self.repository.get_by_inpost_point_id(hid)
                    if not full:
                        continue
                    sub_item = synthetic_inpost_item_from_stored(full)
                    sub_doc = self._process_item_impl(sub_item, depth + 1)
                    apply_location_and_review_time_bounds(sub_doc)
                    self.repository.upsert_point(sub_doc)
                picked = chosen
                picked_dist = dist_m
                break

        if picked is None or picked_dist is None:
            base["validation_status"] = "NO_FREE_PLACE_IN_RADIUS"
            base["map_eligible"] = map_eligible_for_document(base)
            return base

        chosen = picked
        dist_m = picked_dist
        pname = (chosen.get("name") or "").strip()
        pid = str(chosen.get("place_id") or "").strip()
        base["google_place_name"] = pname or None
        base["candidate_place_id"] = pid
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
        base["map_eligible"] = map_eligible_for_document(base)
        return base

    def run(self, sample_size: int) -> None:
        items = self.inpost_client.fetch_items_missing_place(sample_size, self.repository)
        logger.info("Loaded %s InPost point(s) to upsert.", len(items))
        for i, item in enumerate(items, start=1):
            doc = self.process_item(item)
            apply_location_and_review_time_bounds(doc)
            pid = doc.get("inpost_point_id")
            self.repository.upsert_point(doc)
            logger.info(
                "[%s/%s] %s: validation=%s",
                i,
                len(items),
                pid,
                doc.get("validation_status"),
            )
