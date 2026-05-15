from __future__ import annotations

from unittest.mock import MagicMock

from app.rate_limit import _client_ip


def test_client_ip_prefers_x_forwarded_for_first_hop() -> None:
    request = MagicMock()
    request.headers.get.return_value = "203.0.113.5, 10.0.0.1"
    assert _client_ip(request) == "203.0.113.5"


def test_client_ip_falls_back_to_slowapi_remote_address() -> None:
    request = MagicMock()
    request.headers.get.return_value = None
    request.client.host = "172.18.0.4"
    assert _client_ip(request) == "172.18.0.4"
