"use client";

import {
  MarkerClusterer,
  MarkerUtils,
  SuperClusterAlgorithm,
  type Marker as ClusterMarker,
} from "@googlemaps/markerclusterer";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";

import {
  DEFAULT_MARKER_Z_INDEX,
  SELECTED_MARKER_Z_INDEX,
} from "@/components/mapDashboard/mapDashboardConstants";
import {
  getMarkerContent,
  inPostClusterRenderer,
} from "@/components/mapDashboard/markerClusterContent";
import { isSameMapPoint } from "@/components/mapDashboard/mapPointGeo";
import type { SpotlightPresetId } from "@/lib/mapSpotlightPresets";
import type { MapPoint } from "@/types/mapPoint";

type UseMapMarkerClusterParams = {
  map: google.maps.Map | null;
  isLoaded: boolean;
  markerLibReady: boolean;
  scriptError: unknown;
  markersData: MapPoint[];
  selected: MapPoint | null;
  setSelected: Dispatch<SetStateAction<MapPoint | null>>;
  setActiveSpotlight: Dispatch<SetStateAction<SpotlightPresetId | null>>;
};

/**
 * Builds AdvancedMarker instances, attaches a MarkerClusterer, and keeps
 * the selected pin as a standalone marker (not clustered) so it stays visible
 * at moderate zoom. All other points use the default clustering behaviour.
 */
export function useMapMarkerCluster({
  map,
  isLoaded,
  markerLibReady,
  scriptError,
  markersData,
  selected,
  setSelected,
  setActiveSpotlight,
}: UseMapMarkerClusterParams): void {
  const clustererRef = useRef<MarkerClusterer | null>(null);

  useEffect(() => {
    let promotedEntry: {
      marker: google.maps.marker.AdvancedMarkerElement;
      onGmpClick: EventListener;
    } | null = null;

    if (
      !map ||
      !isLoaded ||
      !markerLibReady ||
      scriptError ||
      typeof google === "undefined"
    ) {
      return;
    }

    clustererRef.current?.clearMarkers();
    clustererRef.current = null;

    const markerLib = google.maps.marker;
    if (!markerLib?.AdvancedMarkerElement) {
      return;
    }

    const clusterPoints = markersData.filter(
      (p) => !selected || !isSameMapPoint(p, selected)
    );

    if (clusterPoints.length === 0 && !selected) {
      return;
    }

    const markerEntries: Array<{
      marker: google.maps.marker.AdvancedMarkerElement;
      onGmpClick: EventListener;
    }> = [];

    const markers: ClusterMarker[] = clusterPoints.map((p) => {
      const content = getMarkerContent(p.partner_id, false);
      const marker = new markerLib.AdvancedMarkerElement({
        position: { lat: p.latitude, lng: p.longitude },
        content,
        title: p.name ?? p.inpost_point_id ?? "Point",
        gmpClickable: true,
        collisionBehavior: google.maps.CollisionBehavior.REQUIRED,
        zIndex: DEFAULT_MARKER_Z_INDEX,
      });
      const onGmpClick: EventListener = () => {
        setActiveSpotlight(null);
        setSelected(p);
      };
      marker.addEventListener("gmp-click", onGmpClick);
      markerEntries.push({ marker, onGmpClick });
      return marker;
    });

    if (markers.length > 0) {
      clustererRef.current = new MarkerClusterer({
        markers,
        map,
        algorithm: new SuperClusterAlgorithm({
          radius: 240,
          maxZoom: 16,
        }),
        renderer: inPostClusterRenderer,
      });
    }

    if (selected) {
      const pin = selected;
      const content = getMarkerContent(pin.partner_id, true);
      const marker = new markerLib.AdvancedMarkerElement({
        position: { lat: pin.latitude, lng: pin.longitude },
        content,
        title: pin.name ?? pin.inpost_point_id ?? "Point",
        gmpClickable: true,
        collisionBehavior: google.maps.CollisionBehavior.REQUIRED,
        zIndex: SELECTED_MARKER_Z_INDEX,
      });
      const onGmpClick: EventListener = () => {
        setActiveSpotlight(null);
        setSelected(pin);
      };
      marker.addEventListener("gmp-click", onGmpClick);
      MarkerUtils.setMap(marker, map);
      promotedEntry = { marker, onGmpClick };
    }

    return () => {
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      markerEntries.forEach(({ marker: m, onGmpClick }) => {
        m.removeEventListener("gmp-click", onGmpClick);
        MarkerUtils.setMap(m, null);
      });
      if (promotedEntry) {
        promotedEntry.marker.removeEventListener(
          "gmp-click",
          promotedEntry.onGmpClick
        );
        MarkerUtils.setMap(promotedEntry.marker, null);
      }
    };
  }, [
    map,
    isLoaded,
    markerLibReady,
    scriptError,
    markersData,
    selected,
    setSelected,
    setActiveSpotlight,
  ]);
}
