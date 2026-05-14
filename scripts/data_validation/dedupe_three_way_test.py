#!/usr/bin/env python3
"""Assert winner/loser logic for N>2 duplicate ``google_place_id`` groups (no Mongo, no network)."""

from __future__ import annotations

import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(SCRIPT_DIR))

from bson import ObjectId

from locker_precedence import (
    compare_locker_precedence,
    newcomer_beats_all_holders,
    pick_winner_by_precedence,
)


def main() -> None:
    oid = (lambda i: ObjectId(bytes([0] * 11 + [i])))

    # Three docs share same place_id; A wins on distance (closest).
    a = {
        "inpost_point_id": "PL/A",
        "status": "operating",
        "distance_to_google_place_m": 10.0,
        "google_user_ratings_total": 5,
        "google_reviews": [],
        "_id": oid(1),
    }
    b = {
        "inpost_point_id": "PL/B",
        "status": "operating",
        "distance_to_google_place_m": 50.0,
        "google_user_ratings_total": 5,
        "google_reviews": [],
        "_id": oid(2),
    }
    c = {
        "inpost_point_id": "PL/C",
        "status": "operating",
        "distance_to_google_place_m": 90.0,
        "google_user_ratings_total": 5,
        "google_reviews": [],
        "_id": oid(3),
    }
    docs = [b, c, a]  # deliberate shuffle — winner must still be A
    w = pick_winner_by_precedence(docs)
    assert w["inpost_point_id"] == "PL/A", w

    losers = [d for d in docs if d["inpost_point_id"] != w["inpost_point_id"]]
    assert len(losers) == 2

    # When B tries to take the shared place_id, holders = {A, C} (exclude B); B must beat both.
    holders_bc = [a, c]
    newcomer_b = {
        "status": b["status"],
        "distance_to_google_place_m": b["distance_to_google_place_m"],
        "google_user_ratings_total": b["google_user_ratings_total"],
        "google_reviews": b["google_reviews"],
        "_id": b["_id"],
        "inpost_point_id": b["inpost_point_id"],
    }
    assert not newcomer_beats_all_holders(newcomer_b, holders_bc)
    assert compare_locker_precedence(newcomer_b, a) < 0

    # C loses to A as well
    newcomer_c = {**locker_snapshot(c), "_id": c["_id"], "inpost_point_id": c["inpost_point_id"]}
    assert not newcomer_beats_all_holders(newcomer_c, [a, b])

    # Four-way: operating beats non-operating regardless of distance
    d_far_op = {
        "inpost_point_id": "PL/op",
        "status": "operating",
        "distance_to_google_place_m": 999.0,
        "google_user_ratings_total": 0,
        "google_reviews": [],
        "_id": oid(10),
    }
    d_close_non = {
        "inpost_point_id": "PL/near",
        "status": "closed",
        "distance_to_google_place_m": 1.0,
        "google_user_ratings_total": 999,
        "google_reviews": [1] * 50,
        "_id": oid(11),
    }
    d_mid = {
        "inpost_point_id": "PL/mid",
        "status": "closed",
        "distance_to_google_place_m": 5.0,
        "google_user_ratings_total": 1,
        "google_reviews": [],
        "_id": oid(12),
    }
    d_other = {
        "inpost_point_id": "PL/other",
        "status": "closed",
        "distance_to_google_place_m": 6.0,
        "google_user_ratings_total": 1,
        "google_reviews": [],
        "_id": oid(13),
    }
    four = [d_close_non, d_mid, d_other, d_far_op]
    w4 = pick_winner_by_precedence(four)
    assert w4["inpost_point_id"] == "PL/op", w4

    print("dedupe_three_way_test: ok")


def locker_snapshot(doc: dict) -> dict:
    return {
        "status": doc.get("status"),
        "distance_to_google_place_m": doc.get("distance_to_google_place_m"),
        "google_user_ratings_total": doc.get("google_user_ratings_total"),
        "google_reviews": doc.get("google_reviews"),
    }


if __name__ == "__main__":
    main()
