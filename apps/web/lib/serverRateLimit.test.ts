import { describe, expect, it, beforeEach } from "vitest";

import {
  checkServerRateLimit,
  resetServerRateLimitStore,
} from "@/lib/serverRateLimit";

function requestWithIp(ip: string, path = "/api/map-points"): Request {
  return new Request(`https://app.example${path}`, {
    headers: { "x-forwarded-for": ip },
  });
}

describe("checkServerRateLimit", () => {
  beforeEach(() => {
    resetServerRateLimitStore();
  });

  it("allows requests within the window", () => {
    const req = requestWithIp("203.0.113.1");
    expect(checkServerRateLimit(req, "map-points").allowed).toBe(true);
    expect(checkServerRateLimit(req, "map-points").allowed).toBe(true);
  });

  it("blocks when the cap is exceeded", () => {
    const req = requestWithIp("203.0.113.2");
    for (let i = 0; i < 30; i++) {
      expect(checkServerRateLimit(req, "map-points").allowed).toBe(true);
    }
    const blocked = checkServerRateLimit(req, "map-points");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("tracks IPs independently", () => {
    const a = requestWithIp("203.0.113.10");
    const b = requestWithIp("203.0.113.11");
    const cap = 10;
    for (let i = 0; i < cap; i++) {
      expect(checkServerRateLimit(a, "inpost-point").allowed).toBe(true);
    }
    expect(checkServerRateLimit(a, "inpost-point").allowed).toBe(false);
    expect(checkServerRateLimit(b, "inpost-point").allowed).toBe(true);
  });
});
