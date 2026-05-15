from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/inpost_assignment_test")
os.environ.setdefault("MAP_DASHBOARD_API_SECRET", "test-secret-for-rate-limit")

# Must match Settings (from env at import). CI sets MAP_DASHBOARD_API_SECRET separately.
TEST_API_KEY = os.environ["MAP_DASHBOARD_API_SECRET"]

from app.main import app  # noqa: E402


def _mock_collection() -> MagicMock:
    mock_coll = MagicMock()
    mock_coll.count_documents.return_value = 0
    mock_coll.find.return_value.sort.return_value = []
    mock_coll.distinct.return_value = []
    mock_coll.find_one.return_value = None
    return mock_coll


@pytest.fixture
def client() -> TestClient:
    mock_coll = _mock_collection()
    mock_db = MagicMock()
    mock_db.__getitem__.return_value = mock_coll
    mock_client = MagicMock()
    mock_client.__getitem__.return_value = mock_db

    with patch("app.main.MongoClient", return_value=mock_client):
        with TestClient(app) as test_client:
            yield test_client


def test_map_filters_meta_rate_limit_per_forwarded_ip(client: TestClient) -> None:
    headers = {
        "X-Api-Key": TEST_API_KEY,
        "X-Forwarded-For": "198.51.100.7",
    }
    for _ in range(20):
        res = client.get("/map-filters-meta", headers=headers)
        assert res.status_code == 200, res.text
    res = client.get("/map-filters-meta", headers=headers)
    assert res.status_code == 429


def test_map_filters_meta_rate_limit_buckets_differ_by_ip(client: TestClient) -> None:
    headers_a = {
        "X-Api-Key": TEST_API_KEY,
        "X-Forwarded-For": "198.51.100.8",
    }
    for _ in range(20):
        client.get("/map-filters-meta", headers=headers_a)
    assert client.get("/map-filters-meta", headers=headers_a).status_code == 429

    headers_b = {
        "X-Api-Key": TEST_API_KEY,
        "X-Forwarded-For": "198.51.100.9",
    }
    assert client.get("/map-filters-meta", headers=headers_b).status_code == 200
