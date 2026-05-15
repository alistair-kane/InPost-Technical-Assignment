import type { MutableRefObject } from "react";

/** Call sites that intentionally clear the bbox snapshot before the next ``/api/map-points`` load. */
export type MapPointsRefreshReason =
  | "reset_map_view"
  | "reset_filters"
  | "spotlight";

/**
 * Abort the in-flight bbox request and drop any pending idle debounce so the next
 * ``runFetch`` uses the latest map bounds and filter query string.
 */
export function clearMapPointsFetchPipeline(
  abortInFlightRef: MutableRefObject<(() => void) | null>,
  debounceTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
): void {
  abortInFlightRef.current?.();
  if (debounceTimerRef.current != null) {
    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = null;
  }
}
