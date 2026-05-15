export function forwardedClientHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = {};
  const xff = req.headers.get("x-forwarded-for");
  const xri = req.headers.get("x-real-ip");
  if (xff) {
    h["X-Forwarded-For"] = xff;
  } else if (xri) {
    h["X-Real-IP"] = xri;
  }
  return h;
}

export function upstreamProxyHeaders(
  req: Request,
  extra: Record<string, string>
): Record<string, string> {
  return { ...forwardedClientHeaders(req), ...extra };
}
