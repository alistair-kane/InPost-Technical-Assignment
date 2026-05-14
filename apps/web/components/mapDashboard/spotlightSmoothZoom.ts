import type { MutableRefObject } from "react";

import { SPOTLIGHT_ZOOM_STEP_MS } from "./mapDashboardConstants";

export function cancelSpotlightZoomInterval(
  intervalRef: MutableRefObject<ReturnType<typeof setInterval> | null>,
  animRef?: MutableRefObject<boolean>
) {
  if (intervalRef.current != null) {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
  }
  if (animRef) {
    animRef.current = false;
  }
}

/**
 * Step zoom in by one level at a time until ``targetZoom`` (perceived smooth zoom on vector map).
 * While stepping, ``animRef`` is true so map ``idle`` handlers can skip scheduling bbox refetches.
 */
export function startSpotlightSmoothZoom(
  mapRef: MutableRefObject<google.maps.Map | null>,
  intervalRef: MutableRefObject<ReturnType<typeof setInterval> | null>,
  targetZoom: number,
  animRef: MutableRefObject<boolean>,
  onZoomComplete?: () => void
) {
  cancelSpotlightZoomInterval(intervalRef, animRef);
  const m0 = mapRef.current;
  if (!m0) {
    return;
  }
  const z0 = m0.getZoom() ?? targetZoom;
  if (z0 >= targetZoom) {
    return;
  }
  animRef.current = true;
  m0.setZoom(Math.min(z0 + 1, targetZoom));
  const z1 = m0.getZoom() ?? targetZoom;
  if (z1 >= targetZoom) {
    animRef.current = false;
    onZoomComplete?.();
    return;
  }
  intervalRef.current = setInterval(() => {
    const m = mapRef.current;
    if (!m) {
      cancelSpotlightZoomInterval(intervalRef, animRef);
      return;
    }
    const cur = m.getZoom() ?? targetZoom;
    if (cur >= targetZoom) {
      cancelSpotlightZoomInterval(intervalRef, animRef);
      onZoomComplete?.();
      return;
    }
    m.setZoom(Math.min(cur + 1, targetZoom));
  }, SPOTLIGHT_ZOOM_STEP_MS);
}
