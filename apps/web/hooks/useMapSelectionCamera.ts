"use client";

import type { RefObject } from "react";
import { useLayoutEffect } from "react";

import {
  MAP_FILTER_OVERLAY_RESERVE_X,
  SPOTLIGHT_FOCUS_ZOOM,
} from "@/components/mapDashboard/mapDashboardConstants";
import { computeLocationPanelPanOffsetPx } from "@/components/mapDashboard/mapPanelPan";
import { isSameMapPoint } from "@/components/mapDashboard/mapPointGeo";
import {
  cancelSpotlightZoomInterval,
  startSpotlightSmoothZoom,
} from "@/components/mapDashboard/spotlightSmoothZoom";
import type { SpotlightPresetId } from "@/lib/mapSpotlightPresets";
import type { MapPoint } from "@/types/mapPoint";

type UseMapSelectionCameraParams = {
  map: google.maps.Map | null;
  mapRef: RefObject<google.maps.Map | null>;
  isLoaded: boolean;
  selected: MapPoint | null;
  activeSpotlight: SpotlightPresetId | null;
  locationPanelRef: RefObject<HTMLDivElement | null>;
  mapPanDxRef: RefObject<number>;
  prevSelectedRef: RefObject<MapPoint | null>;
  spotlightZoomIntervalRef: RefObject<ReturnType<typeof setInterval> | null>;
  spotlightZoomAnimatingRef: RefObject<boolean>;
  flushMapPointsAfterSpotlightZoom: () => void;
};

/**
 * Pans/zooms the map when the selected pin changes, including stepped spotlight zoom
 * and panel-aware horizontal offset for the location detail panel.
 */
export function useMapSelectionCamera({
  map,
  mapRef,
  isLoaded,
  selected,
  activeSpotlight,
  locationPanelRef,
  mapPanDxRef,
  prevSelectedRef,
  spotlightZoomIntervalRef,
  spotlightZoomAnimatingRef,
  flushMapPointsAfterSpotlightZoom,
}: UseMapSelectionCameraParams): void {
  useLayoutEffect(() => {
    if (!map || !isLoaded || typeof google === "undefined") {
      cancelSpotlightZoomInterval(
        spotlightZoomIntervalRef,
        spotlightZoomAnimatingRef
      );
      return;
    }
    mapRef.current = map;
    const prev = prevSelectedRef.current;
    const cur = selected;

    if (!cur) {
      cancelSpotlightZoomInterval(
        spotlightZoomIntervalRef,
        spotlightZoomAnimatingRef
      );
    }

    if (cur) {
      const pinChanged = !prev || !isSameMapPoint(prev, cur);
      map.panTo({ lat: cur.latitude, lng: cur.longitude });
      const applyPanelAwareCenter = () => {
        const m = mapRef.current;
        if (!m) {
          return;
        }
        const panelEl = locationPanelRef.current;
        const mapDiv = m.getDiv();
        const panelW =
          panelEl?.getBoundingClientRect().width ??
          panelEl?.offsetWidth ??
          448;
        const mapW = mapDiv.clientWidth ?? 0;
        const dx = computeLocationPanelPanOffsetPx({
          mapWidthPx: mapW,
          panelWidthPx: panelW,
          filterOverlayReserveX: MAP_FILTER_OVERLAY_RESERVE_X,
        });
        if (dx === 0) {
          mapPanDxRef.current = 0;
          return;
        }
        m.panBy(dx, 0);
        mapPanDxRef.current = dx;
      };

      const z = map.getZoom() ?? 0;
      const willSmoothSpotlightZoom =
        pinChanged &&
        z < SPOTLIGHT_FOCUS_ZOOM &&
        activeSpotlight != null;

      if (willSmoothSpotlightZoom) {
        startSpotlightSmoothZoom(
          mapRef,
          spotlightZoomIntervalRef,
          SPOTLIGHT_FOCUS_ZOOM,
          spotlightZoomAnimatingRef,
          () => {
            flushMapPointsAfterSpotlightZoom();
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                applyPanelAwareCenter();
              });
            });
          }
        );
      } else if (
        pinChanged &&
        z < SPOTLIGHT_FOCUS_ZOOM &&
        activeSpotlight == null &&
        z < 14
      ) {
        map.setZoom(14);
      }

      if (!willSmoothSpotlightZoom) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            applyPanelAwareCenter();
          });
        });
      }
    }

    if (!cur && prev && mapPanDxRef.current !== 0) {
      map.panBy(-mapPanDxRef.current, 0);
      mapPanDxRef.current = 0;
    }

    prevSelectedRef.current = cur;

    return () => {
      cancelSpotlightZoomInterval(
        spotlightZoomIntervalRef,
        spotlightZoomAnimatingRef
      );
      if (map && mapPanDxRef.current !== 0) {
        map.panBy(-mapPanDxRef.current, 0);
        mapPanDxRef.current = 0;
      }
    };
  }, [
    map,
    mapRef,
    isLoaded,
    selected,
    activeSpotlight,
    locationPanelRef,
    mapPanDxRef,
    prevSelectedRef,
    spotlightZoomIntervalRef,
    spotlightZoomAnimatingRef,
    flushMapPointsAfterSpotlightZoom,
  ]);
}
