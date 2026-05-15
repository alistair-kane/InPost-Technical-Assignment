import { describe, expect, it } from "vitest";

import {
  RateLimitError,
  rateLimitedFetch,
  tryConsumeClientRateLimit,
} from "@/lib/clientRateLimit";

describe("tryConsumeClientRateLimit", () => {
  it("allows requests up to the token cap", () => {
    const config = { maxRequests: 2, windowMs: 10_000 };
    expect(tryConsumeClientRateLimit("test-a", config).allowed).toBe(true);
    expect(tryConsumeClientRateLimit("test-a", config).allowed).toBe(true);
    const third = tryConsumeClientRateLimit("test-a", config);
    expect(third.allowed).toBe(false);
    if (!third.allowed) {
      expect(third.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("uses independent buckets per key", () => {
    const config = { maxRequests: 1, windowMs: 10_000 };
    expect(tryConsumeClientRateLimit("bucket-1", config).allowed).toBe(true);
    expect(tryConsumeClientRateLimit("bucket-2", config).allowed).toBe(true);
  });
});

describe("rateLimitedFetch", () => {
  it("throws RateLimitError when the bucket is empty", async () => {
    const config = { maxTokens: 1, windowMs: 60_000 };
    const key = "fetch-test-throw";
    tryConsumeClientRateLimit(key, config);
    await expect(
      rateLimitedFetch("http://example.invalid", undefined, key, config)
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});
