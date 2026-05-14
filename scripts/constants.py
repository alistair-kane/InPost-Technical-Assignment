from __future__ import annotations

INPOST_POINTS_URL = "https://api-global-points.easypack24.net/v1/points"
PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
NEARBY_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"

INPOST_NAME_SUBSTRING = "inpost"

DEFAULT_SAMPLE_SIZE = 25
DEFAULT_START_PAGE = 1
DEFAULT_PER_PAGE = 1000
DEFAULT_COUNTRY_CODE = "PL"
COUNTRY_BOUNDING_BOXES: dict[str, tuple[float, float, float, float]] = {
    # min_lat, min_lng, max_lat, max_lng
    "PL": (49.0, 14.0, 55.1, 24.2),
}

DEFAULT_DATABASE_NAME = "inpost_assignment"
DEFAULT_MONGO_COLLECTION = "inpost_point_google_places"
DEFAULT_REQUEST_DELAY = 0.15
DEFAULT_RADIUS_METERS = 50
DEFAULT_PAGINATION_DELAY = 2.0
