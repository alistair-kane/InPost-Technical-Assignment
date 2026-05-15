"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { MapPointsRefreshReason } from "@/components/mapDashboard/mapPointsRefresh";
import { cancelSpotlightZoomInterval } from "@/components/mapDashboard/spotlightSmoothZoom";
import {
  pickSpotlightPoint,
  SPOTLIGHT_EMPTY_HINTS,
  type SpotlightPresetId,
} from "@/lib/mapSpotlightPresets";
import type { MapPoint } from "@/types/mapPoint";

const SPOTLIGHT_TOAST_MS = 3800;

type UseMapSpotlightParams = {
  points: MapPoint[] | null;
  /** Debounced query used by bbox fetch (must match baseline before spotlight pick). */
  mapPointsQueryString: string;
  baselineMapPointsQueryString: string;
  resetFiltersToEmpty: () => void;
  beginMapPointsRefresh: (reason: MapPointsRefreshReason) => void;
  /** Run bbox fetch after refresh (needed when the filter query string does not change). */
  requestMapPointsFetch: () => void;
  setSelected: Dispatch<SetStateAction<MapPoint | null>>;
  spotlightZoomIntervalRef: RefObject<ReturnType<typeof setInterval> | null>;
  spotlightZoomAnimatingRef: RefObject<boolean>;
};

export function useMapSpotlight({
  points,
  mapPointsQueryString,
  baselineMapPointsQueryString,
  resetFiltersToEmpty,
  beginMapPointsRefresh,
  requestMapPointsFetch,
  setSelected,
  spotlightZoomIntervalRef,
  spotlightZoomAnimatingRef,
}: UseMapSpotlightParams): {
  activeSpotlight: SpotlightPresetId | null;
  spotlightNavigating: boolean;
  spotlightToast: string | null;
  handleSpotlightSelect: (id: SpotlightPresetId) => void;
  clearSpotlight: () => void;
  cancelSpotlightZoom: () => void;
  onSpotlightNavigationEnd: () => void;
} {
  const [activeSpotlight, setActiveSpotlight] = useState<SpotlightPresetId | null>(
    null
  );
  const [spotlightToast, setSpotlightToast] = useState<string | null>(null);
  const [spotlightNavigating, setSpotlightNavigating] = useState(false);
  const spotlightToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const pendingSpotlightRef = useRef<SpotlightPresetId | null>(null);

  const onSpotlightNavigationEnd = useCallback(() => {
    setSpotlightNavigating(false);
  }, []);

  const cancelSpotlightZoom = useCallback(() => {
    cancelSpotlightZoomInterval(
      spotlightZoomIntervalRef,
      spotlightZoomAnimatingRef
    );
  }, [spotlightZoomIntervalRef, spotlightZoomAnimatingRef]);

  const clearSpotlight = useCallback(() => {
    pendingSpotlightRef.current = null;
    cancelSpotlightZoom();
    setActiveSpotlight(null);
    setSpotlightNavigating(false);
  }, [cancelSpotlightZoom]);

  const showSpotlightToast = useCallback((message: string) => {
    setSpotlightToast(message);
    if (spotlightToastTimerRef.current != null) {
      clearTimeout(spotlightToastTimerRef.current);
    }
    spotlightToastTimerRef.current = setTimeout(() => {
      setSpotlightToast(null);
      spotlightToastTimerRef.current = null;
    }, SPOTLIGHT_TOAST_MS);
  }, []);

  const completePendingSpotlight = useCallback(
    (id: SpotlightPresetId, pool: MapPoint[]) => {
      const picked = pickSpotlightPoint(pool, id);
      if (!picked) {
        cancelSpotlightZoom();
        setActiveSpotlight(null);
        setSpotlightNavigating(false);
        showSpotlightToast(SPOTLIGHT_EMPTY_HINTS[id]);
        return;
      }
      cancelSpotlightZoom();
      setSpotlightNavigating(true);
      setActiveSpotlight(id);
      setSelected(picked);
    },
    [cancelSpotlightZoom, setSelected, showSpotlightToast]
  );

  const handleSpotlightSelect = useCallback(
    (id: SpotlightPresetId) => {
      if (activeSpotlight === id) {
        pendingSpotlightRef.current = null;
        cancelSpotlightZoom();
        setActiveSpotlight(null);
        setSpotlightNavigating(false);
        setSelected(null);
        return;
      }

      resetFiltersToEmpty();
      beginMapPointsRefresh("spotlight");
      requestMapPointsFetch();
      pendingSpotlightRef.current = id;
      setActiveSpotlight(id);
      setSpotlightNavigating(true);
      cancelSpotlightZoom();
      setSelected(null);
    },
    [
      activeSpotlight,
      beginMapPointsRefresh,
      cancelSpotlightZoom,
      requestMapPointsFetch,
      resetFiltersToEmpty,
      setSelected,
    ]
  );

  useEffect(() => {
    const id = pendingSpotlightRef.current;
    if (id == null) {
      return;
    }
    if (mapPointsQueryString !== baselineMapPointsQueryString) {
      return;
    }
    if (points == null) {
      return;
    }
    pendingSpotlightRef.current = null;
    completePendingSpotlight(id, points);
  }, [
    points,
    mapPointsQueryString,
    baselineMapPointsQueryString,
    completePendingSpotlight,
  ]);

  useEffect(() => {
    return () => {
      if (spotlightToastTimerRef.current != null) {
        clearTimeout(spotlightToastTimerRef.current);
      }
      cancelSpotlightZoom();
    };
  }, [cancelSpotlightZoom]);

  return {
    activeSpotlight,
    spotlightNavigating,
    spotlightToast,
    handleSpotlightSelect,
    clearSpotlight,
    cancelSpotlightZoom,
    onSpotlightNavigationEnd,
  };
}
