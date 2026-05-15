import { NextResponse } from "next/server";

import { proxyMapApiJson } from "@/lib/upstreamMapApi";

export async function GET(req: Request) {
  const base = process.env.FASTAPI_URL?.replace(/\/$/, "") ?? "";
  if (!base) {
    return NextResponse.json(
      { error: "FASTAPI_URL is not configured" },
      { status: 500 }
    );
  }
  if (!process.env.MAP_DASHBOARD_API_SECRET) {
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
  return proxyMapApiJson(req, upstreamUrl);
}
