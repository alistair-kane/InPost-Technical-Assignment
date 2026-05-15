export type RateLimitRouteId =
  | "map-points"
  | "map-point"
  | "map-filters-meta"
  | "inpost-point";

export type RateLimitRule = {
  maxRequests: number;
  windowMs: number;
};

const DEFAULT_RULES: Record<RateLimitRouteId, RateLimitRule> = {
  "map-points": { maxRequests: 30, windowMs: 60_000 },
  "map-point": { maxRequests: 60, windowMs: 60_000 },
  "map-filters-meta": { maxRequests: 20, windowMs: 60_000 },
  "inpost-point": { maxRequests: 10, windowMs: 60_000 },
};

const CLIENT_RULES: Record<RateLimitRouteId, RateLimitRule> = {
  "map-points": { maxRequests: 10, windowMs: 10_000 },
  "map-point": { maxRequests: 20, windowMs: 10_000 },
  "map-filters-meta": { maxRequests: 5, windowMs: 10_000 },
  "inpost-point": { maxRequests: 5, windowMs: 10_000 },
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function serverRateLimitRule(routeId: RateLimitRouteId): RateLimitRule {
  const base = DEFAULT_RULES[routeId];
  const prefix = `RATE_LIMIT_${routeId.toUpperCase().replace(/-/g, "_")}`;
  return {
    maxRequests: envInt(`${prefix}_MAX`, base.maxRequests),
    windowMs: envInt(`${prefix}_WINDOW_MS`, base.windowMs),
  };
}

export function clientRateLimitRule(routeId: RateLimitRouteId): RateLimitRule {
  return CLIENT_RULES[routeId];
}

export function routeIdFromPathname(pathname: string): RateLimitRouteId | null {
  if (pathname === "/api/map-points" || pathname.startsWith("/api/map-points/")) {
    return "map-points";
  }
  if (pathname === "/api/map-point" || pathname.startsWith("/api/map-point/")) {
    return "map-point";
  }
  if (
    pathname === "/api/map-filters-meta" ||
    pathname.startsWith("/api/map-filters-meta/")
  ) {
    return "map-filters-meta";
  }
  if (pathname === "/api/inpost-point" || pathname.startsWith("/api/inpost-point/")) {
    return "inpost-point";
  }
  return null;
}
