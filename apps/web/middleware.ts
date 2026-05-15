import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { checkServerRateLimitForPath } from "@/lib/serverRateLimit";

export function middleware(req: NextRequest) {
  const result = checkServerRateLimitForPath(req);
  if (result && !result.allowed) {
    return NextResponse.json(
      {
        error: "Too many requests",
        retryAfterSeconds: result.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfterSeconds),
        },
      }
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
