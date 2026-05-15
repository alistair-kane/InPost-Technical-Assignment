export class RateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("Too many requests — wait a moment");
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

type BucketState = {
  tokens: number;
  lastRefillMs: number;
};

const buckets = new Map<string, BucketState>();

export type ClientRateLimitConfig = {
  maxRequests: number;
  windowMs: number;
};

function refill(state: BucketState, maxRequests: number, windowMs: number, now: number): void {
  if (windowMs <= 0) {
    return;
  }
  const elapsed = now - state.lastRefillMs;
  if (elapsed < windowMs) {
    return;
  }
  const periods = Math.floor(elapsed / windowMs);
  if (periods < 1) {
    return;
  }
  state.tokens = Math.min(maxRequests, state.tokens + periods * maxRequests);
  state.lastRefillMs += periods * windowMs;
}

export function tryConsumeClientRateLimit(
  bucketKey: string,
  config: ClientRateLimitConfig
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const now = Date.now();
  let state = buckets.get(bucketKey);
  if (!state) {
    state = { tokens: config.maxRequests, lastRefillMs: now };
    buckets.set(bucketKey, state);
  }

  refill(state, config.maxRequests, config.windowMs, now);

  if (state.tokens > 0) {
    state.tokens -= 1;
    return { allowed: true };
  }

  const retryAfterMs = Math.max(
    1,
    config.windowMs - (now - state.lastRefillMs)
  );
  return { allowed: false, retryAfterMs };
}

export async function rateLimitedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  bucketKey: string,
  config: ClientRateLimitConfig
): Promise<Response> {
  const result = tryConsumeClientRateLimit(bucketKey, config);
  if (!result.allowed) {
    throw new RateLimitError(result.retryAfterMs);
  }
  return fetch(input, init);
}
