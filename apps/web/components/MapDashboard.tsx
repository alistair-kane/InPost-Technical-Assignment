"use client";

import Image from "next/image";
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { LocationDetailPanel } from "./LocationDetailPanel";
import { MasMascot } from "./MasMascot";
import { MapFiltersPanel } from "./MapFiltersPanel";
import { MapSpotlightBar } from "./MapSpotlightBar";
import type { MapPoint } from "@/types/mapPoint";
import { attachGoogleStyleMapTypeBar } from "./mapDashboard/attachMapTypeBar";
import {
  defaultCenter,
  defaultZoom,
  MAP_FILTERS_HOST_TOP_REM,
  MAP_RESET_ZOOM_IN_THRESHOLD,
  mapContainerStyle,
} from "./mapDashboard/mapDashboardConstants";
import { useInpostPointLookup } from "@/hooks/useInpostPointLookup";
import { useMapFiltersQuery } from "@/hooks/useMapFiltersQuery";
import { useMapMarkerCluster } from "@/hooks/useMapMarkerCluster";
import { useMapPointDetail } from "@/hooks/useMapPointDetail";
import { useMapPointsFetch } from "@/hooks/useMapPointsFetch";
import { useMapSelectionCamera } from "@/hooks/useMapSelectionCamera";
import { useMapSpotlight } from "@/hooks/useMapSpotlight";
import { useSpotlightZoomRefs } from "@/hooks/useSpotlightZoomRefs";

export type { MapPoint } from "@/types/mapPoint";

export default function MapDashboard() {
  const {
    filterForm,
    applyFilterPatch,
    partnerOptions,
    selectedPartners,
    mapPointsQueryString,
    onPartnerToggle,
    resetFiltersToEmpty,
  } = useMapFiltersQuery();
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const { detailPoint, detailReviewsLoading } = useMapPointDetail(selected);
  const { inpostItem, inpostLoading, inpostError } = useInpostPointLookup(selected);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const { spotlightZoomIntervalRef, spotlightZoomAnimatingRef } =
    useSpotlightZoomRefs();
  const [mapDarkMode, setMapDarkMode] = useState(false);
  /** Camera passed into `GoogleMap` when basemap remounts (colorScheme only applies at init). */
  const [mapBootCenter, setMapBootCenter] = useState(defaultCenter);
  const [mapBootZoom, setMapBootZoom] = useState(defaultZoom);
  const [markerLibReady, setMarkerLibReady] = useState(false);
  const mapTypeBarCleanupRef = useRef<(() => void) | null>(null);
  const locationPanelRef = useRef<HTMLDivElement | null>(null);
  const mapPanDxRef = useRef(0);
  const prevSelectedRef = useRef<MapPoint | null>(null);
  /** First stable camera after each map mount (initial view for that instance). */
  const mapCameraBaselineRef = useRef<{
    lat: number;
    lng: number;
    zoom: number;
  } | null>(null);
  const [showResetMapView, setShowResetMapView] = useState(false);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ?? "";
  /**
   * Do not pass `libraries: ['marker']` here: `useJsApiLoader` warns when that
   * array’s identity changes (common with Fast Refresh). Use the hook’s stable
   * default, then `importLibrary('marker')` below.
   */
  const { isLoaded, loadError: scriptError } = useJsApiLoader({
    id: "inpost-map-script",
    googleMapsApiKey: apiKey,
    version: "weekly",
  });

  useEffect(() => {
    if (!isLoaded || scriptError || typeof google === "undefined") {
      setMarkerLibReady(false);
      return;
    }
    let cancelled = false;
    void google.maps.importLibrary("marker").then(
      () => {
        if (!cancelled) setMarkerLibReady(true);
      },
      () => {
        if (!cancelled) setMarkerLibReady(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [isLoaded, scriptError]);

  const {
    points,
    loadError,
    totalMatching,
    locationsInView,
    beginMapPointsRefresh,
    flushMapPointsAfterSpotlightZoom,
  } = useMapPointsFetch(map, mapPointsQueryString, spotlightZoomAnimatingRef);

  const {
    activeSpotlight,
    spotlightToast,
    handleSpotlightSelect,
    clearSpotlight,
    cancelSpotlightZoom,
  } = useMapSpotlight({
    points,
    setSelected,
    spotlightZoomIntervalRef,
    spotlightZoomAnimatingRef,
  });

  useMapSelectionCamera({
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
  });

  const dismissSelection = useCallback(() => {
    setSelected(null);
    clearSpotlight();
  }, [clearSpotlight]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dismissSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, dismissSelection]);

  const onMapLoad = useCallback((m: google.maps.Map) => {
    mapTypeBarCleanupRef.current?.();
    mapTypeBarCleanupRef.current = null;
    mapRef.current = m;
    setMap(m);
    mapTypeBarCleanupRef.current = attachGoogleStyleMapTypeBar(m);
  }, []);

  const onMapUnmount = useCallback((m: google.maps.Map) => {
    void m;
    cancelSpotlightZoom();
    mapRef.current = null;
    mapTypeBarCleanupRef.current?.();
    mapTypeBarCleanupRef.current = null;
    setMap(null);
  }, [cancelSpotlightZoom]);

  const snapshotMapCameraForRemount = useCallback(() => {
    if (!map) {
      return;
    }
    const c = map.getCenter();
    const z = map.getZoom();
    if (c) {
      const lat = c.lat();
      const lng = c.lng();
      const zoom = z ?? defaultZoom;
      setMapBootCenter({ lat, lng });
      setMapBootZoom(zoom);
    }
  }, [map]);

  const handleResetMapView = useCallback(() => {
    if (!map) {
      return;
    }
    const b = mapCameraBaselineRef.current;
    if (!b) {
      return;
    }
    cancelSpotlightZoom();
    // Baseline restore sets center directly; do not run panel-undo panBy on deselect.
    mapPanDxRef.current = 0;
    beginMapPointsRefresh("reset_map_view");
    map.panTo({ lat: b.lat, lng: b.lng });
    map.setZoom(b.zoom);
    dismissSelection();
  }, [map, beginMapPointsRefresh, dismissSelection, cancelSpotlightZoom]);

  useEffect(() => {
    if (!map) {
      mapCameraBaselineRef.current = null;
      setShowResetMapView(false);
      return;
    }
    mapCameraBaselineRef.current = null;

    const onIdle = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      if (!c || z == null) {
        return;
      }
      if (mapCameraBaselineRef.current === null) {
        mapCameraBaselineRef.current = {
          lat: c.lat(),
          lng: c.lng(),
          zoom: z,
        };
        setShowResetMapView(false);
        return;
      }
      const base = mapCameraBaselineRef.current;
      setShowResetMapView(
        z >= base.zoom + MAP_RESET_ZOOM_IN_THRESHOLD - 1e-6
      );
    };

    const idleListener = map.addListener("idle", onIdle);
    return () => {
      google.maps.event.removeListener(idleListener);
    };
  }, [map]);

  const markersData = useMemo(() => points ?? [], [points]);

  useMapMarkerCluster({
    map,
    isLoaded,
    markerLibReady,
    scriptError,
    markersData,
    selected,
    setSelected,
    setActiveSpotlight: clearSpotlight,
  });

  if (!apiKey) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-950 p-8 text-neutral-50">
        <p className="max-w-lg text-center text-sm">
          Set <code className="text-amber-200">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{" "}
          to enable the map.
        </p>
      </div>
    );
  }

  if (!mapId) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-950 p-8 text-neutral-50">
        <p className="max-w-lg text-center text-sm">
          Advanced markers require a vector{" "}
          <code className="text-amber-200">NEXT_PUBLIC_GOOGLE_MAP_ID</code> from Google
          Cloud Console (Map Management). Add it alongside your Maps JS API key.
        </p>
      </div>
    );
  }

  if (scriptError) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-950 p-8 text-neutral-50">
        <p className="text-sm">Failed to load Google Maps script.</p>
      </div>
    );
  }

  /** Same predicate as map overlay while bbox points are in flight (header: "Loading points…"). */
  const loadingMapPoints = points === null && !loadError;

  const headerCountSubtitle = loadingMapPoints
    ? "Loading points…"
    : points === null
      ? ""
      : (() => {
          const globalTotal = totalMatching ?? points.length;
          const inView = locationsInView;
          const inLabel = inView === 1 ? "location" : "locations";
          return `Viewing ${inView} ${inLabel} out of ${globalTotal}`;
        })();

  const showMapPointsLoadingOverlay = isLoaded && loadingMapPoints;

  return (
    <div className="relative h-screen w-screen bg-neutral-900">
      {loadError && (
        <div className="absolute left-4 top-16 z-10 rounded-md bg-amber-950/95 px-3 py-2 text-sm text-amber-100 shadow-lg ring-1 ring-amber-800">
          {loadError}
        </div>
      )}
      {!isLoaded && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-950/80 text-neutral-200">
          Loading map…
        </div>
      )}
      <header className="absolute left-0 right-0 top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-neutral-950/90 px-4 py-3 text-neutral-100 backdrop-blur">
        <MasMascot size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight">
            InPostologia - Google Maps data explorer of Poland
          </h1>
          <p className="text-md text-neutral-400">{headerCountSubtitle}</p>
        </div>
        <div className="ml-auto shrink-0 origin-top-right scale-[1.3]">
          <div
            className="flex items-center gap-0.5 rounded-lg border border-white/15 bg-neutral-900/85 p-0.5 shadow-sm"
            role="group"
            aria-label="Map appearance"
          >
            <button
              type="button"
              aria-label="Light map"
              aria-pressed={!mapDarkMode}
              onClick={() => {
                snapshotMapCameraForRemount();
                setMapDarkMode(false);
              }}
              className={`rounded-md px-2 py-1.5 transition-colors ${
                !mapDarkMode
                  ? "bg-white ring-2 ring-amber-400 shadow-sm"
                  : "bg-white/90 ring-1 ring-black/10 hover:bg-white"
              }`}
            >
              <Image
                src="/map-theme-light.svg"
                width={22}
                height={22}
                alt=""
                draggable={false}
              />
            </button>
            <button
              type="button"
              aria-label="Dark map"
              aria-pressed={mapDarkMode}
              onClick={() => {
                snapshotMapCameraForRemount();
                setMapDarkMode(true);
              }}
              className={`rounded-md px-2 py-1.5 transition-colors ${
                mapDarkMode
                  ? "bg-amber-400/20 ring-1 ring-amber-400/45"
                  : "hover:bg-white/5"
              }`}
            >
              <Image
                src="/map-theme-dark.svg"
                width={22}
                height={22}
                alt=""
                draggable={false}
              />
            </button>
          </div>
        </div>
      </header>
      <div
        className="absolute right-4 z-20 max-w-[calc(100vw-1rem)]"
        style={{ top: `${MAP_FILTERS_HOST_TOP_REM}rem` }}
      >
        <MapFiltersPanel
          form={filterForm}
          onFormChange={applyFilterPatch}
          onResetFilters={() => {
            resetFiltersToEmpty();
            beginMapPointsRefresh("reset_filters");
          }}
          partnerOptions={partnerOptions}
          selectedPartners={selectedPartners}
          onPartnerToggle={onPartnerToggle}
        />
      </div>
      {selected && detailPoint && (
        <>
          <button
            type="button"
            aria-label="Close location details"
            className="fixed inset-0 z-[25] bg-black/45 md:hidden"
            onClick={dismissSelection}
          />
          <LocationDetailPanel
            ref={locationPanelRef}
            point={detailPoint}
            reviewsLoading={detailReviewsLoading}
            inpostItem={inpostItem}
            inpostLoading={inpostLoading}
            inpostError={inpostError}
            onClose={dismissSelection}
          />
        </>
      )}
      {isLoaded ? (
        <GoogleMap
          key={mapDarkMode ? "basemap-dark" : "basemap-light"}
          mapContainerStyle={mapContainerStyle}
          center={mapBootCenter}
          zoom={mapBootZoom}
          onLoad={onMapLoad}
          onUnmount={onMapUnmount}
          options={{
            mapId,
            colorScheme: mapDarkMode ? "DARK" : "LIGHT",
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            fullscreenControlOptions: {
              position: google.maps.ControlPosition.RIGHT_BOTTOM,
            },
          }}
        />
      ) : (
        <div aria-hidden style={mapContainerStyle} />
      )}
      {showMapPointsLoadingOverlay && (
        <div className="pointer-events-none absolute left-0 right-0 top-16 bottom-0 z-[15] flex items-center justify-center bg-neutral-950/35">
          <div
            className="motion-safe:animate-pulse flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-neutral-950/80 px-5 py-4 shadow-lg backdrop-blur"
            role="status"
            aria-live="polite"
          >
            <MasMascot size={60} />
            <p className="text-sm text-neutral-300">Loading locations…</p>
          </div>
        </div>
      )}
      {spotlightToast && (
        <div
          className="absolute bottom-44 left-1/2 z-[35] max-w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-amber-800/50 bg-amber-950/95 px-3 py-2 text-sm text-amber-100 shadow-lg backdrop-blur"
          role="status"
        >
          {spotlightToast}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[21] flex flex-col items-center gap-2 px-3 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
        {showResetMapView && (
          <button
            type="button"
            onClick={handleResetMapView}
            aria-label="Reset map zoom and position to initial view"
            className="pointer-events-auto flex items-center gap-2 rounded-md border border-white/15 bg-neutral-950/90 px-3 py-2 text-md font-medium text-neutral-100 shadow-lg backdrop-blur transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 hover:border-amber-500/35 hover:bg-neutral-900/95"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local /public SVG asset */}
            <img
              src="/reset-zoom.svg"
              alt=""
              width={29}
              height={29}
              draggable={false}
              className="pointer-events-none block h-[29px] w-[29px] shrink-0 object-contain object-center invert"
            />
            Reset Map View
          </button>
        )}
        <MapSpotlightBar
          active={activeSpotlight}
          onSelect={handleSpotlightSelect}
          poolEmpty={points === null || points.length === 0}
        />
      </div>
    </div>
  );
}
