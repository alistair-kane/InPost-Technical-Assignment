import { NextResponse } from "next/server";

const FORWARD_QUERY_KEYS = [
  "min_rating",
  "max_rating",
  "min_review_time",
  "max_review_time",
  "min_lat",
  "max_lat",
  "min_lng",
  "max_lng",
  "max_points",
  "max_distance_to_google_place_m",
] as const;

function truthyNoGooglePlaceOnly(v: string | null): boolean {
  if (v == null || v === "") {
    return false;
  }
  const s = v.toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

export async function GET(req: Request) {
  const base = process.env.FASTAPI_URL?.replace(/\/$/, "") ?? "";
  const secret = process.env.MAP_DASHBOARD_API_SECRET;
  if (!base) {
    return NextResponse.json(
      { error: "FASTAPI_URL is not configured" },
      { status: 500 }
    );
  }
  if (!secret) {
    return NextResponse.json(
      { error: "MAP_DASHBOARD_API_SECRET is not configured" },
      { status: 500 }
    );
  }

  const incoming = new URL(req.url).searchParams;
  const outbound = new URLSearchParams();
  for (const key of FORWARD_QUERY_KEYS) {
    const v = incoming.get(key);
    if (v != null && v !== "") {
      outbound.set(key, v);
    }
  }
  for (const v of incoming.getAll("partner_id")) {
    if (v !== "") {
      outbound.append("partner_id", v);
    }
  }
  for (const v of incoming.getAll("inpost_status")) {
    if (v !== "") {
      outbound.append("inpost_status", v);
    }
  }
  if (truthyNoGooglePlaceOnly(incoming.get("no_google_place_only"))) {
    outbound.set("no_google_place_only", "true");
  }
  const qs = outbound.toString();
  const upstreamUrl = qs ? `${base}/points?${qs}` : `${base}/points`;

  let res: Response;
  try {
    res = await fetch(upstreamUrl, {
      headers: { "X-Api-Key": secret },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Map API unreachable" },
      { status: 502 }
    );
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(body, { status: res.status });
  }

  return NextResponse.json(body);
}
