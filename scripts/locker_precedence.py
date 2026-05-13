"""Shared rules for which locker keeps a contested ``google_place_id`` (ingest + migration)."""

from __future__ import annotations

import math
from typing import Any, Mapping, MutableMapping, Optional, Sequence


def is_operating_status(status: Any) -> bool:
    if status is None:
        return False
    s = str(status).strip().casefold()
    return s == "operating"


def _finite_distance_m(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x):
        return None
    return x


def _ratings_total_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _review_list_len(google_reviews: Any) -> int:
    if isinstance(google_reviews, list):
        return len(google_reviews)
    return 0


def _oid_fcfs_int(oid: Any) -> Optional[int]:
    if oid is None:
        return None
    raw = getattr(oid, "binary", None)
    if not isinstance(raw, (bytes, bytearray)) or len(raw) != 12:
        return None
    return int.from_bytes(bytes(raw), byteorder="big", signed=False)


def compare_locker_precedence(a: Mapping[str, Any], b: Mapping[str, Any]) -> int:
    """Return >0 if *a* should beat *b*, <0 if *b* beats *a*, 0 if indistinguishable.

    Order: operating > non-operating; then lower ``distance_to_google_place_m``; then
    higher ``google_user_ratings_total`` (numeric); then higher ``len(google_reviews)``;
    then smaller ``_id`` (FCFS). Pass ``_id=None`` on the newcomer so they lose FCFS
    ties against stored documents.
    """
    op_a = 1 if is_operating_status(a.get("status")) else 0
    op_b = 1 if is_operating_status(b.get("status")) else 0
    if op_a != op_b:
        return op_a - op_b

    da = _finite_distance_m(a.get("distance_to_google_place_m"))
    db = _finite_distance_m(b.get("distance_to_google_place_m"))
    if da is not None and db is not None:
        if da != db:
            return 1 if da < db else -1
    elif da is not None and db is None:
        return 1
    elif da is None and db is not None:
        return -1

    ra = _ratings_total_int(a.get("google_user_ratings_total"))
    rb = _ratings_total_int(b.get("google_user_ratings_total"))
    if ra is not None and rb is not None and ra != rb:
        return 1 if ra > rb else -1
    if ra is not None and rb is None:
        return 1
    if ra is None and rb is not None:
        return -1

    la = _review_list_len(a.get("google_reviews"))
    lb = _review_list_len(b.get("google_reviews"))
    if la != lb:
        return 1 if la > lb else -1

    ida = a.get("_id")
    idb = b.get("_id")
    if ida is None and idb is None:
        sa = str(a.get("inpost_point_id") or "")
        sb = str(b.get("inpost_point_id") or "")
        if sa != sb:
            return 1 if sa < sb else -1
        return 0
    if ida is None:
        return -1
    if idb is None:
        return 1
    oa = _oid_fcfs_int(ida)
    ob = _oid_fcfs_int(idb)
    if oa is not None and ob is not None and oa != ob:
        # Smaller ObjectId (earlier insert) wins.
        return 1 if oa < ob else -1
    return 0


def pick_winner_by_precedence(docs: Sequence[Mapping[str, Any]]) -> Mapping[str, Any]:
    """Return the single best document under ``compare_locker_precedence`` (any group size ``>= 1``).

    One-pass maximum: ``compare_locker_precedence`` defines a total order among distinct
    snapshots, so this is equivalent to scanning all docs for the global winner (works
    for 2-way, 3-way, or larger duplicate ``google_place_id`` groups).
    """
    if not docs:
        raise ValueError("docs must be non-empty")
    best = docs[0]
    for d in docs[1:]:
        if compare_locker_precedence(d, best) > 0:
            best = d
    return best


def newcomer_beats_all_holders(
    newcomer: Mapping[str, Any],
    holders: Sequence[Mapping[str, Any]],
) -> bool:
    if not holders:
        return True
    for h in holders:
        if compare_locker_precedence(newcomer, h) <= 0:
            return False
    return True


def locker_snapshot_from_doc(doc: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "status": doc.get("status"),
        "distance_to_google_place_m": doc.get("distance_to_google_place_m"),
        "google_user_ratings_total": doc.get("google_user_ratings_total"),
        "google_reviews": doc.get("google_reviews"),
        "_id": doc.get("_id"),
        "inpost_point_id": doc.get("inpost_point_id"),
    }


def apply_preview_to_locker_fields(
    target: MutableMapping[str, Any],
    preview_result: Mapping[str, Any],
) -> None:
    """Set rating / totals / raw reviews list from Place Details preview (for conflict compare)."""
    from google_places_client import GooglePlacesClient

    gr, gut = GooglePlacesClient._extract_place_aggregate_rating(preview_result)
    target["google_rating"] = gr
    target["google_user_ratings_total"] = gut
    raw = preview_result.get("reviews")
    target["google_reviews"] = raw if isinstance(raw, list) else None
