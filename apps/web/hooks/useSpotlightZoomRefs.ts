"use client";

import { useRef } from "react";

/** Refs shared by bbox fetch (skip idle while stepping) and spotlight smooth zoom. */
export function useSpotlightZoomRefs() {
  const spotlightZoomIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  /** When true, map ``idle`` must not schedule bbox ``/api/map-points`` fetches. */
  const spotlightZoomAnimatingRef = useRef(false);
  return { spotlightZoomIntervalRef, spotlightZoomAnimatingRef };
}
