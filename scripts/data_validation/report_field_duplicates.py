#!/usr/bin/env python3
"""Report how many documents share each duplicate value for a given field (MongoDB)."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from typing import Any

from dotenv import load_dotenv
from pymongo import MongoClient

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(SCRIPT_DIR))

from constants import DEFAULT_DATABASE_NAME, DEFAULT_MONGO_COLLECTION

# Allow dotted paths; disallow $ and operators in user-supplied field names.
_FIELD_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_.]*$")


def _format_value(value: Any, max_len: int = 96) -> str:
    if value is None:
        return "<null>"
    if isinstance(value, (dict, list)):
        s = json.dumps(value, ensure_ascii=False, default=str)
    else:
        s = str(value)
    if len(s) > max_len:
        return s[: max_len - 3] + "..."
    return s


def _parse_filter_value(raw: str) -> Any:
    """Use JSON for numbers/bools/null/objects; otherwise treat as plain string."""
    stripped = raw.strip()
    if not stripped:
        return stripped
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return raw


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "field",
        help="Field name (dot notation allowed, e.g. google_place_id or location.type).",
    )
    parser.add_argument(
        "--min-count",
        type=int,
        default=2,
        help="Treat values with at least this many documents as duplicates (default: 2).",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=10,
        help="Max duplicate groups to print (default: 10).",
    )
    parser.add_argument(
        "--exclude-missing",
        action="store_true",
        help="Ignore groups where the field is null or missing (often one large null bucket).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print full duplicate groups as JSON (no human summary table).",
    )
    parser.add_argument(
        "--filter-field",
        metavar="NAME",
        default=None,
        help="With --filter-value, only consider documents where this field equals that value.",
    )
    parser.add_argument(
        "--filter-value",
        metavar="VALUE",
        default=None,
        help="Match value for --filter-field (JSON accepted, e.g. true, 1, \"PL\", null).",
    )
    args = parser.parse_args()

    field = args.field.strip()
    if not field or not _FIELD_RE.match(field):
        print(
            "field must be a non-empty identifier or dotted path "
            "(letters, digits, underscore, dots; no $).",
            file=sys.stderr,
        )
        sys.exit(2)
    if args.min_count < 2:
        print("--min-count must be >= 2.", file=sys.stderr)
        sys.exit(2)

    ff_arg = args.filter_field
    fv_arg = args.filter_value
    if (ff_arg is None) ^ (fv_arg is None):
        print("--filter-field and --filter-value must be given together.", file=sys.stderr)
        sys.exit(2)
    filter_match: dict[str, Any] = {}
    if ff_arg is not None:
        ff = ff_arg.strip()
        if not ff or not _FIELD_RE.match(ff):
            print(
                "--filter-field must be a non-empty identifier or dotted path "
                "(letters, digits, underscore, dots; no $).",
                file=sys.stderr,
            )
            sys.exit(2)
        filter_match = {ff: _parse_filter_value(fv_arg)}

    load_dotenv()
    uri = (os.environ.get("MONGODB_URI") or "").strip()
    if not uri:
        print("MONGODB_URI is required.", file=sys.stderr)
        sys.exit(1)
    db_name = (os.environ.get("MONGODB_DB") or DEFAULT_DATABASE_NAME).strip()
    coll_name = (os.environ.get("MONGODB_COLLECTION") or DEFAULT_MONGO_COLLECTION).strip()

    client: MongoClient[Any] = MongoClient(uri, serverSelectionTimeoutMS=15_000)
    coll = client[db_name][coll_name]

    analysis_key = {field: {"$exists": True, "$ne": None}}
    if filter_match:
        matched_query: dict[str, Any] = {**filter_match, **analysis_key}
        total_docs = coll.count_documents(filter_match)
        present_nonempty = coll.count_documents(matched_query)
    else:
        total_docs = coll.estimated_document_count()
        present_nonempty = coll.count_documents(analysis_key)

    group_id = f"${field}"
    pipeline: list[dict[str, Any]] = []
    if filter_match:
        pipeline.append({"$match": filter_match})
    pipeline.extend(
        [
            {"$group": {"_id": group_id, "count": {"$sum": 1}}},
            {"$match": {"count": {"$gte": args.min_count}}},
        ]
    )
    if args.exclude_missing:
        pipeline.append({"$match": {"_id": {"$ne": None}}})
    pipeline.append({"$sort": {"count": -1}})

    try:
        dup_rows = list(coll.aggregate(pipeline, allowDiskUse=True))
    except Exception as exc:  # noqa: BLE001 — surface server errors clearly
        print(f"Aggregation failed: {exc}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        out = [
            {"value": row["_id"], "document_count": row["count"]}
            for row in dup_rows[: args.top]
        ]
        payload: dict[str, Any] = {"field": field, "duplicate_groups": out}
        if filter_match:
            payload["filter"] = filter_match
        print(json.dumps(payload, indent=2, default=str))
        return

    n_dup_groups = len(dup_rows)
    docs_in_dup_groups = sum(r["count"] for r in dup_rows)
    size_histogram = Counter(int(r["count"]) for r in dup_rows)

    print(f"Database: {db_name!r}  Collection: {coll_name!r}  Field: {field!r}")
    if filter_match:
        fk, fv = next(iter(filter_match.items()))
        print(f"Filter: {fk!r} == {_format_value(fv, max_len=200)}")
        print(f"Documents matching filter: {total_docs}")
    else:
        print(f"Estimated total documents: {total_docs}")
    print(f"Documents with analysis field present and not BSON-null: {present_nonempty}")
    print(f"Missing or null analysis field: {max(0, total_docs - present_nonempty)}")
    print()
    if n_dup_groups == 0:
        print("No duplicate values at this threshold.")
        return

    print(
        f"Duplicate values (count >= {args.min_count}): {n_dup_groups} distinct value(s), "
        f"{docs_in_dup_groups} document(s) total in those groups."
    )
    print()
    print("Histogram: how many distinct field values have each document count")
    for size in sorted(size_histogram.keys(), reverse=True):
        print(f"  {size} document(s) sharing one value: {size_histogram[size]} distinct value(s)")
    print()
    print(f"Top {min(args.top, n_dup_groups)} duplicate values by document count:")
    for row in dup_rows[: args.top]:
        val = _format_value(row["_id"])
        print(f"  {row['count']:6d}  {val}")


if __name__ == "__main__":
    main()
