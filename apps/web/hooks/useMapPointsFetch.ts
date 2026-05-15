"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { MapPoint } from "@/types/mapPoint";
import {
  MAP_BBOX_PADDING,
  MAP_POINTS_IDLE_DEBOUNCE_MS,
} from "@/components/mapDashboard/mapDashboardConstants";
import {
  buildMapPointsFetchUrl,
  extractMapPointsArray,
  mapPointsRequestErrorMessage,
  readOptionalNumericField,
} from "@/components/mapDashboard/mapPointsBbox";
import {
  clearMapPointsFetchPipeline,
  type MapPointsRefreshReason,
} from "@/components/mapDashboard/mapPointsRefresh";
import { clientRateLimitRule } from "@/lib/rateLimitConfig";
import { RateLimitError, rateLimitedFetch } from "@/lib/clientRateLimit";

export function useMapPointsFetch(
  map: google.maps.Map | null,
  mapPointsQueryString: string,
  spotlightZoomAnimatingRef: RefObject<boolean>
): {
  points: MapPoint[] | null;
  loadError: string | null;
  totalMatching: number | null;
  locationsInView: number;
  beginMapPointsRefresh: (reason: MapPointsRefreshReason) => void;
  flushMapPointsAfterSpotlightZoom: () => void;
} {
  const [points, setPoints] = useState<MapPoint[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totalMatching, setTotalMatching] = useState<number | null>(null);
  const [locationsInView, setLocationsInView] = useState(0);

  const mapPointsQueryStringRef = useRef(mapPointsQueryString);
  mapPointsQueryStringRef.current = mapPointsQueryString;

  const runMapPointsFetchRef = useRef<(() => void) | null>(null);
  const mapPointsDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const abortInFlightMapPointsFetchRef = useRef<(() => void) | null>(null);

  const beginMapPointsRefresh = useCallback((reason: MapPointsRefreshReason) => {
    void reason;
    clearMapPointsFetchPipeline(
      abortInFlightMapPointsFetchRef,
      mapPointsDebounceTimerRef
    );
    setLoadError(null);
    setPoints(null);
  }, []);

  const flushMapPointsAfterSpotlightZoom = useCallback(() => {
    clearMapPointsFetchPipeline(
      abortInFlightMapPointsFetchRef,
      mapPointsDebounceTimerRef
    );
    runMapPointsFetchRef.current?.();
  }, []);

  // spotlightZoomAnimatingRef is stable; schedule() reads .current on each idle.
  useEffect(() => {
    if (!map) {
      return;
    }
    let cancelled = false;
    const fetchAbortRef = { current: null as AbortController | null };
    abortInFlightMapPointsFetchRef.current = () => {
      fetchAbortRef.current?.abort();
    };

    const runFetch = () => {
      const bounds = map.getBounds();
      if (!bounds) {
        return;
      }
      const path = buildMapPointsFetchUrl(
        mapPointsQueryStringRef.current,
        bounds,
        MAP_BBOX_PADDING
      );
      if (!path) {
        return;
      }
      fetchAbortRef.current?.abort();
      const ac = new AbortController();
      fetchAbortRef.current = ac;

      void (async () => {
        try {
          const res = await rateLimitedFetch(
            path,
            { signal: ac.signal },
            "map-points",
            clientRateLimitRule("map-points")
          );
          const data = await res.json().catch(() => ({}));
          if (ac.signal.aborted || cancelled) {
            return;
          }
          if (!res.ok) {
            const msg = mapPointsRequestErrorMessage(res, data);
            setLoadError(msg);
            if (res.status === 413) {
              setPoints([]);
              const inBox = readOptionalNumericField(data, "in_bbox_matching");
              setLocationsInView(typeof inBox === "number" ? inBox : 0);
            }
            return;
          }
          setPoints(extractMapPointsArray(data));
          setLoadError(null);
          const total = readOptionalNumericField(data, "total_matching");
          if (typeof total === "number") {
            setTotalMatching(total);
          }
          const inBox = readOptionalNumericField(data, "in_bbox_matching");
          if (typeof inBox === "number") {
            setLocationsInView(inBox);
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") {
            return;
          }
          if (e instanceof RateLimitError) {
            if (!cancelled) {
              setLoadError(e.message);
            }
            return;
          }
          if (!cancelled) {
            setLoadError("Failed to load points");
          }
        }
      })();
    };

    runMapPointsFetchRef.current = runFetch;

    const schedule = () => {
      if (spotlightZoomAnimatingRef.current) {
        if (mapPointsDebounceTimerRef.current != null) {
          clearTimeout(mapPointsDebounceTimerRef.current);
          mapPointsDebounceTimerRef.current = null;
        }
        return;
      }
      if (mapPointsDebounceTimerRef.current != null) {
        clearTimeout(mapPointsDebounceTimerRef.current);
      }
      mapPointsDebounceTimerRef.current = setTimeout(() => {
        mapPointsDebounceTimerRef.current = null;
        runFetch();
      }, MAP_POINTS_IDLE_DEBOUNCE_MS);
    };

    const idleListener = map.addListener("idle", schedule);
    schedule();

    return () => {
      cancelled = true;
      clearMapPointsFetchPipeline(
        abortInFlightMapPointsFetchRef,
        mapPointsDebounceTimerRef
      );
      abortInFlightMapPointsFetchRef.current = null;
      google.maps.event.removeListener(idleListener);
      runMapPointsFetchRef.current = null;
    };
  }, [map, mapPointsQueryString, spotlightZoomAnimatingRef]);

  return {
    points,
    loadError,
    totalMatching,
    locationsInView,
    beginMapPointsRefresh,
    flushMapPointsAfterSpotlightZoom,
  };
}
