#!/usr/bin/env python3
"""Resolve duplicate ``google_place_id`` values using locker precedence + Nearby re-resolve."""

from __future__ import annotations

import argparse
import logging
import os
import sys
from typing import Any

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(SCRIPT_DIR))

from constants import (
    DEFAULT_DATABASE_NAME,
    DEFAULT_MONGO_COLLECTION,
    DEFAULT_NEARBY_KEYWORD,
    DEFAULT_PAGINATION_DELAY,
    DEFAULT_PER_PAGE,
    DEFAULT_RADIUS_METERS,
    DEFAULT_REQUEST_DELAY,
    DEFAULT_START_PAGE,
)
from google_places_client import GooglePlacesClient
from inpost_client import InpostClient
from locker_precedence import pick_winner_by_precedence
from point_repository import PointRepository
from point_resolution_service import PointResolutionService
from point_utils import apply_location_and_review_time_bounds, synthetic_inpost_item_from_stored

logger = logging.getLogger(__name__)


def _duplicate_groups(coll: Any) -> list[dict[str, Any]]:
    return list(
        coll.aggregate(
            [
                {
                    "$match": {
                        "google_place_id": {"$exists": True, "$nin": [None, ""]},
                    }
                },
                {
                    "$group": {
                        "_id": "$google_place_id",
                        "docs": {"$push": "$$ROOT"},
                        "n": {"$sum": 1},
                    }
                },
                {"$match": {"n": {"$gt": 1}}},
                {"$sort": {"_id": 1}},
            ],
            allowDiskUse=True,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log actions without writing to MongoDB.",
    )
    parser.add_argument(
        "--limit-groups",
        type=int,
        default=0,
        help="Max duplicate place_id groups to process (0 = no limit).",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")

    load_dotenv()
    uri = (os.environ.get("MONGODB_URI") or "").strip()
    api_key = (os.environ.get("GOOGLE_MAPS_API_KEY") or "").strip()
    if not uri:
        logger.error("MONGODB_URI is required.")
        sys.exit(1)
    if not api_key:
        logger.error("GOOGLE_MAPS_API_KEY is required.")
        sys.exit(1)

    db_name = (os.environ.get("MONGODB_DB") or DEFAULT_DATABASE_NAME).strip()
    coll_name = (os.environ.get("MONGODB_COLLECTION") or DEFAULT_MONGO_COLLECTION).strip()

    client: MongoClient[Any] = MongoClient(uri, serverSelectionTimeoutMS=15_000)
    coll = client[db_name][coll_name]
    repository = PointRepository(coll)

    groups = _duplicate_groups(coll)
    if args.limit_groups and args.limit_groups > 0:
        groups = groups[: args.limit_groups]

    logger.info("Found %s duplicate google_place_id group(s) to process.", len(groups))

    kw = (DEFAULT_NEARBY_KEYWORD or "").strip() or None

    with requests.Session() as session:
        session.headers.setdefault("Accept", "application/json")
        inpost_client = InpostClient(session, DEFAULT_START_PAGE, min(DEFAULT_PER_PAGE, 100))
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
            keyword=kw,
        )

        for g in groups:
            place_id = g["_id"]
            docs: list[dict[str, Any]] = g["docs"]
            # One global winner for the whole N-way duplicate (N>=2); all other members
            # are losers and are re-resolved in stable order (DB updates after each).
            winner = pick_winner_by_precedence(docs)
            win_id = str(winner.get("inpost_point_id") or "")
            losers = [d for d in docs if str(d.get("inpost_point_id") or "") != win_id]
            losers.sort(key=lambda d: str(d.get("inpost_point_id") or ""))
            logger.info(
                "Group %s: %s doc(s), winner=%s (status=%s dist=%s)",
                place_id,
                len(docs),
                win_id,
                winner.get("status"),
                winner.get("distance_to_google_place_m"),
            )
            for loser in losers:
                lid = str(loser.get("inpost_point_id") or "")
                full = repository.get_by_inpost_point_id(lid)
                if not full:
                    logger.warning("Missing document for loser %s; skip.", lid)
                    continue
                if args.dry_run:
                    logger.info("DRY-RUN would re-resolve loser %s", lid)
                    continue
                item = synthetic_inpost_item_from_stored(full)
                new_doc = service.process_item(item)
                apply_location_and_review_time_bounds(new_doc)
                repository.upsert_point(new_doc)
                logger.info(
                    "Re-resolved %s -> validation=%s google_place_id=%s",
                    lid,
                    new_doc.get("validation_status"),
                    new_doc.get("google_place_id"),
                )

    client.close()


if __name__ == "__main__":
    main()
