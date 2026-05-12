from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from constants import DEFAULT_COUNTRY_CODE, INPOST_NAME_SUBSTRING
from google_places_client import GooglePlacesClient
from inpost_client import InpostClient
from point_repository import PointRepository
from point_utils import distance_m, inpost_point_id_from_item, map_eligible_for_document

logger = logging.getLogger(__name__)


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
        return abs(la) <= 1 and abs(ln) <= 1

    @staticmethod
    def _optional_trimmed_str(value: Any) -> Optional[str]:
        if value is None:
            return None
        s = str(value).strip()
        return s or None

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
    def _pick_closest_inpost_place(
        results: list[dict[str, Any]], center_lat: float, center_lng: float
    ) -> Optional[dict[str, Any]]:
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
            candidates.append((distance_m(center_lat, center_lng, rlat, rlng), r))
        if not candidates:
            return None
        candidates.sort(key=lambda x: x[0])
        return candidates[0][1]

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
            "updated_at": now,
        }
        return base, lat, lng

    def process_item(self, item: dict[str, Any]) -> dict[str, Any]:
        base, lat, lng = self._common_base(item)
        base["search_strategy"] = "nearby"
        base["nearby_radius_m"] = self.radius_meters
        base["nearby_keyword"] = self.keyword
        if self._bad_coordinates(lat, lng):
            base["validation_status"] = "SKIPPED_BAD_COORDINATES"
            base["map_eligible"] = map_eligible_for_document(base)
            return base
        composed_address = self._build_geocode_query(item)
        base["formatted_address"] = self._optional_trimmed_str(composed_address)
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
        chosen = self._pick_closest_inpost_place(raw_results, lat_f, lng_f)
        if chosen is None:
            base["validation_status"] = "NO_INPOST_IN_RADIUS"
            base["map_eligible"] = map_eligible_for_document(base)
            return base
        pname = (chosen.get("name") or "").strip()
        pid = chosen.get("place_id")
        base["google_place_name"] = pname or None
        base["candidate_place_id"] = pid
        if not pid:
            base["validation_status"] = "NEARBY_MISSING_PLACE_ID"
            base["map_eligible"] = map_eligible_for_document(base)
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
        base["map_eligible"] = map_eligible_for_document(base)
        return base

    def run(self, sample_size: int) -> None:
        items = self.inpost_client.fetch_items_missing_place(sample_size, self.repository)
        logger.info("Loaded %s InPost point(s) to upsert.", len(items))
        for i, item in enumerate(items, start=1):
            doc = self.process_item(item)
            pid = doc.get("inpost_point_id")
            self.repository.upsert_point(doc)
            logger.info(
                "[%s/%s] %s: validation=%s",
                i,
                len(items),
                pid,
                doc.get("validation_status")
            )
