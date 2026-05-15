import {
  routeIdFromPathname,
  serverRateLimitRule,
  type RateLimitRouteId,
} from "@/lib/rateLimitConfig";

type WindowEntry = {
  count: number;
  windowStartMs: number;
};

const store = new Map<string, WindowEntry>();

export type ServerRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

function clientIpFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const xri = req.headers.get("x-real-ip")?.trim();
  if (xri) {
    return xri;
  }
  return "unknown";
}

export function checkServerRateLimit(
  req: Request,
  routeId: RateLimitRouteId
): ServerRateLimitResult {
  const rule = serverRateLimitRule(routeId);
  const ip = clientIpFromRequest(req);
  const key = `${routeId}:${ip}`;
  const now = Date.now();

  let entry = store.get(key);
  if (!entry || now - entry.windowStartMs >= rule.windowMs) {
    entry = { count: 0, windowStartMs: now };
    store.set(key, entry);
  }

  if (entry.count >= rule.maxRequests) {
    const retryAfterMs = rule.windowMs - (now - entry.windowStartMs);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  entry.count += 1;
  return { allowed: true };
}

export function checkServerRateLimitForPath(req: Request): ServerRateLimitResult | null {
  const url = new URL(req.url);
  const routeId = routeIdFromPathname(url.pathname);
  if (!routeId) {
    return null;
  }
  return checkServerRateLimit(req, routeId);
}

/** @internal test helper */
export function resetServerRateLimitStore(): void {
  store.clear();
}
