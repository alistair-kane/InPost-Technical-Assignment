from __future__ import annotations

from typing import Optional

INPOST_POINTS_URL = "https://api-global-points.easypack24.net/v1/points"
PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
NEARBY_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"

INPOST_NAME_SUBSTRING = "inpost"

DEFAULT_SAMPLE_SIZE = 25
DEFAULT_START_PAGE = 1
DEFAULT_PER_PAGE = 1000
DEFAULT_COUNTRY_CODE = "PL"

DEFAULT_DATABASE_NAME = "inpost_assignment"
DEFAULT_MONGO_COLLECTION = "inpost_point_google_places"
DEFAULT_REQUEST_DELAY = 0.15
DEFAULT_RADIUS_METERS = 50
DEFAULT_NEARBY_KEYWORD: Optional[str] = None
DEFAULT_PAGINATION_DELAY = 2.0
