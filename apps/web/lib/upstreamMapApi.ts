import { upstreamProxyHeaders } from "@/lib/forwardedClientHeaders";

export async function fetchMapApiUpstream(
  req: Request,
  upstreamUrl: string
): Promise<Response> {
  const secret = process.env.MAP_DASHBOARD_API_SECRET;
  if (!secret) {
    throw new Error("MAP_DASHBOARD_API_SECRET is not configured");
  }
  return fetch(upstreamUrl, {
    headers: upstreamProxyHeaders(req, { "X-Api-Key": secret }),
    cache: "no-store",
  });
}

export async function proxyMapApiJson(
  req: Request,
  upstreamUrl: string
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchMapApiUpstream(req, upstreamUrl);
  } catch {
    return Response.json({ error: "Map API unreachable" }, { status: 502 });
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const headers: HeadersInit = {};
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      if (retryAfter) {
        headers["Retry-After"] = retryAfter;
      }
    }
    return Response.json(body, { status: res.status, headers });
  }

  return Response.json(body);
}
