import { NextResponse } from "next/server";

import { isValidInpostPointName } from "@/lib/inpostPointQuery";

const INPOST_POINTS_URL = "https://api-global-points.easypack24.net/v1/points";

function validCountry(cc: string): boolean {
  return /^[A-Z]{2}$/.test(cc);
}

export async function GET(req: Request) {
  const incoming = new URL(req.url);
  const name = (incoming.searchParams.get("name") ?? "").trim();
  const rawCountry = (
    incoming.searchParams.get("country") ??
    process.env.INPOST_POINTS_COUNTRY ??
    "PL"
  )
    .trim()
    .toUpperCase();

  if (!isValidInpostPointName(name)) {
    return NextResponse.json({ error: "Invalid or missing name" }, { status: 400 });
  }
  if (!validCountry(rawCountry)) {
    return NextResponse.json({ error: "Invalid country" }, { status: 400 });
  }

  const upstream = new URL(INPOST_POINTS_URL);
  upstream.searchParams.set("name", name);
  upstream.searchParams.set("country", rawCountry);
  upstream.searchParams.set("per_page", "1");

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "InPost API unreachable" },
      { status: 502 }
    );
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: "InPost API error", status: res.status },
      { status: 502 }
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON from InPost" },
      { status: 502 }
    );
  }

  if (!data || typeof data !== "object") {
    return NextResponse.json(
      { error: "Unexpected InPost response" },
      { status: 502 }
    );
  }

  const obj = data as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? obj.items : [];
  const item = (items[0] as Record<string, unknown> | undefined) ?? null;
  const count =
    typeof obj.count === "number"
      ? obj.count
      : Array.isArray(items)
        ? items.length
        : 0;

  return NextResponse.json({ item, count });
}
