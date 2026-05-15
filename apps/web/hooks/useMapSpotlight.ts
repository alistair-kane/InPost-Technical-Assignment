"use client";

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

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
  setSelected: Dispatch<SetStateAction<MapPoint | null>>;
  spotlightZoomIntervalRef: MutableRefObject<ReturnType<typeof setInterval> | null>;
  spotlightZoomAnimatingRef: MutableRefObject<boolean>;
};

export function useMapSpotlight({
  points,
  setSelected,
  spotlightZoomIntervalRef,
  spotlightZoomAnimatingRef,
}: UseMapSpotlightParams): {
  activeSpotlight: SpotlightPresetId | null;
  spotlightToast: string | null;
  handleSpotlightSelect: (id: SpotlightPresetId) => void;
  clearSpotlight: () => void;
  cancelSpotlightZoom: () => void;
} {
  const [activeSpotlight, setActiveSpotlight] = useState<SpotlightPresetId | null>(
    null
  );
  const [spotlightToast, setSpotlightToast] = useState<string | null>(null);
  const spotlightToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const cancelSpotlightZoom = useCallback(() => {
    cancelSpotlightZoomInterval(
      spotlightZoomIntervalRef,
      spotlightZoomAnimatingRef
    );
  }, [spotlightZoomIntervalRef, spotlightZoomAnimatingRef]);

  const clearSpotlight = useCallback(() => {
    cancelSpotlightZoom();
    setActiveSpotlight(null);
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

  const handleSpotlightSelect = useCallback(
    (id: SpotlightPresetId) => {
      const pool = points ?? [];
      if (activeSpotlight === id) {
        cancelSpotlightZoom();
        setActiveSpotlight(null);
        setSelected(null);
        return;
      }
      const picked = pickSpotlightPoint(pool, id);
      if (!picked) {
        cancelSpotlightZoom();
        setActiveSpotlight(null);
        showSpotlightToast(SPOTLIGHT_EMPTY_HINTS[id]);
        return;
      }
      cancelSpotlightZoom();
      setActiveSpotlight(id);
      setSelected(picked);
    },
    [
      points,
      activeSpotlight,
      cancelSpotlightZoom,
      setSelected,
      showSpotlightToast,
    ]
  );

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
    spotlightToast,
    handleSpotlightSelect,
    clearSpotlight,
    cancelSpotlightZoom,
  };
}
