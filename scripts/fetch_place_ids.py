#!/usr/bin/env python3
"""Fetch InPost points and enrich with Google Place IDs."""

from __future__ import annotations

import argparse
import logging
import os
import sys

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

from constants import (
    DEFAULT_DATABASE_NAME,
    DEFAULT_MONGO_COLLECTION,
    DEFAULT_PAGINATION_DELAY,
    DEFAULT_PER_PAGE,
    DEFAULT_RADIUS_METERS,
    DEFAULT_REQUEST_DELAY,
    DEFAULT_SAMPLE_SIZE,
    DEFAULT_START_PAGE,
)
from google_places_client import GooglePlacesClient
from inpost_client import InpostClient
from point_repository import PointRepository
from point_resolution_service import PointResolutionService

logger = logging.getLogger(__name__)


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

    effective_per_page = min(DEFAULT_PER_PAGE, args.sample_size)

    api_key, mongo_uri = load_settings()

    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=8000)
    client.admin.command("ping")
    db = client[DEFAULT_DATABASE_NAME]
    coll = db[DEFAULT_MONGO_COLLECTION]
    repository = PointRepository(coll)
    repository.ensure_index()

    with requests.Session() as session:
        session.headers.setdefault("Accept", "application/json")
        inpost_client = InpostClient(session, DEFAULT_START_PAGE, effective_per_page)
        places_client = GooglePlacesClient(
            session,
            api_key,
            request_delay=DEFAULT_REQUEST_DELAY,
            pagination_delay=DEFAULT_PAGINATION_DELAY,
        )
        service = PointResolutionService(
            inpost_client=inpost_client,
            places_client=places_client,
            repository=repository,
            radius_meters=DEFAULT_RADIUS_METERS,
        )
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
