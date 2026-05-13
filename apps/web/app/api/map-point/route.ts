import { NextResponse } from "next/server";

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

  const id = new URL(req.url).searchParams.get("inpost_point_id");
  if (id == null || id === "") {
    return NextResponse.json(
      { error: "inpost_point_id is required" },
      { status: 400 }
    );
  }

  const upstreamUrl = `${base}/points/${encodeURIComponent(id)}`;

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
