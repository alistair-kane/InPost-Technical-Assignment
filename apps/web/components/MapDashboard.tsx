"use client";

import Image from "next/image";
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import {
  MarkerClusterer,
  MarkerUtils,
  SuperClusterAlgorithm,
  type Marker as ClusterMarker,
} from "@googlemaps/markerclusterer";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { LocationDetailPanel, type InpostPointItem } from "./LocationDetailPanel";
import { MasMascot } from "./MasMascot";
import { MapFiltersPanel } from "./MapFiltersPanel";
import { MapSpotlightBar } from "./MapSpotlightBar";
import {
  pickSpotlightPoint,
  SPOTLIGHT_EMPTY_HINTS,
  type SpotlightPresetId,
} from "@/lib/mapSpotlightPresets";
import { parseInpostNameAndCountry } from "@/lib/inpostPointQuery";
import type {
  GoogleReviewSnippet,
  MapPoint,
  MapPointDetailOverlay,
} from "@/types/mapPoint";
import {
  buildMapPointsQueryString,
  coalesceMapFiltersForm,
  emptyMapFiltersForm,
  mergePartnerIdsForUi,
  normalizeSelectedPartnersForUi,
  type MapFiltersForm,
} from "./mapFiltersQuery";
import { attachGoogleStyleMapTypeBar } from "./mapDashboard/attachMapTypeBar";
import {
  defaultCenter,
  defaultZoom,
  MAP_BBOX_PADDING,
  MAP_FILTER_OVERLAY_RESERVE_X,
  MAP_FILTERS_HOST_TOP_REM,
  MAP_POINTS_IDLE_DEBOUNCE_MS,
  MAP_RESET_ZOOM_IN_THRESHOLD,
  SELECTED_MARKER_Z_INDEX,
  DEFAULT_MARKER_Z_INDEX,
  SPOTLIGHT_FOCUS_ZOOM,
  mapContainerStyle,
} from "./mapDashboard/mapDashboardConstants";
import { getMarkerContent, inPostClusterRenderer } from "./mapDashboard/markerClusterContent";
import {
  buildPaddedBboxSearchParams,
  isSameMapPoint,
  mapPointKey,
} from "./mapDashboard/mapPointGeo";
import {
  clearMapPointsFetchPipeline,
  type MapPointsRefreshReason,
} from "./mapDashboard/mapPointsRefresh";
import {
  cancelSpotlightZoomInterval,
  startSpotlightSmoothZoom,
} from "./mapDashboard/spotlightSmoothZoom";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export type { MapPoint } from "@/types/mapPoint";

export default function MapDashboard() {
  const [points, setPoints] = useState<MapPoint[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totalMatching, setTotalMatching] = useState<number | null>(null);
  const [locationsInView, setLocationsInView] = useState(0);
  const [detailReviews, setDetailReviews] = useState<GoogleReviewSnippet[] | null>(
    null
  );
  const [detailReviewsLoading, setDetailReviewsLoading] = useState(false);
  const [detailOverlay, setDetailOverlay] = useState<MapPointDetailOverlay | null>(
    null
  );
  const [filterForm, setFilterForm] = useState<MapFiltersForm>(() =>
    coalesceMapFiltersForm({})
  );
  const debouncedMinRating = useDebouncedValue(filterForm.minRating, 260);
  const debouncedMaxRating = useDebouncedValue(filterForm.maxRating, 260);
  const debouncedReviewTimeMinIdx = useDebouncedValue(
    filterForm.reviewTimeMinIdx,
    260
  );
  const debouncedReviewTimeMaxIdx = useDebouncedValue(
    filterForm.reviewTimeMaxIdx,
    260
  );
  const debouncedGoogleMapsProximityRadiusM = useDebouncedValue(
    filterForm.googleMapsProximityRadiusM,
    260
  );
  const queryFilterForm = useMemo(
    (): MapFiltersForm => ({
      minRating: debouncedMinRating,
      maxRating: debouncedMaxRating,
      googleMapsProximityRadiusM: debouncedGoogleMapsProximityRadiusM,
      onlyWithoutGooglePlace: filterForm.onlyWithoutGooglePlace,
      reviewTimeMinIdx: debouncedReviewTimeMinIdx,
      reviewTimeMaxIdx: debouncedReviewTimeMaxIdx,
      includeInpostStatusOperating: filterForm.includeInpostStatusOperating,
      includeInpostStatusCreated: filterForm.includeInpostStatusCreated,
      includeInpostStatusDisabled: filterForm.includeInpostStatusDisabled,
    }),
    [
      debouncedMinRating,
      debouncedMaxRating,
      debouncedReviewTimeMinIdx,
      debouncedReviewTimeMaxIdx,
      debouncedGoogleMapsProximityRadiusM,
      filterForm.onlyWithoutGooglePlace,
      filterForm.includeInpostStatusOperating,
      filterForm.includeInpostStatusCreated,
      filterForm.includeInpostStatusDisabled,
    ]
  );
  const [partnerOptions, setPartnerOptions] = useState<number[]>([]);
  const [selectedPartners, setSelectedPartners] = useState<Set<number>>(
    () => new Set()
  );
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [inpostItem, setInpostItem] = useState<InpostPointItem>(null);
  const [inpostLoading, setInpostLoading] = useState(false);
  const [inpostError, setInpostError] = useState<string | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const spotlightZoomIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  /** When true, map ``idle`` must not schedule bbox ``/api/map-points`` fetches (stepped spotlight zoom). */
  const spotlightZoomAnimatingRef = useRef(false);
  /** Latest bbox fetch from the map-idle effect (one shot after spotlight zoom completes). */
  const runMapPointsFetchRef = useRef<(() => void) | null>(null);
  /** Pending ``idle`` debounce for ``/api/map-points`` (cleared after spotlight zoom fetch). */
  const mapPointsDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  /** Abort the bbox ``/api/map-points`` request (e.g. before resetting camera so stale rows are not applied). */
  const abortInFlightMapPointsFetchRef = useRef<(() => void) | null>(null);
  const [mapDarkMode, setMapDarkMode] = useState(false);
  /** Camera passed into `GoogleMap` when basemap remounts (colorScheme only applies at init). */
  const [mapBootCenter, setMapBootCenter] = useState(defaultCenter);
  const [mapBootZoom, setMapBootZoom] = useState(defaultZoom);
  const [markerLibReady, setMarkerLibReady] = useState(false);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const mapTypeBarCleanupRef = useRef<(() => void) | null>(null);
  const locationPanelRef = useRef<HTMLDivElement | null>(null);
  const mapPanDxRef = useRef(0);
  const prevSelectedRef = useRef<MapPoint | null>(null);
  const prevSelectedMarkerRef = useRef<MapPoint | null>(null);
  const markersByKeyRef = useRef<
    Map<string, google.maps.marker.AdvancedMarkerElement>
  >(new Map());
  const [activeSpotlight, setActiveSpotlight] = useState<SpotlightPresetId | null>(
    null
  );
  const [spotlightToast, setSpotlightToast] = useState<string | null>(null);
  const spotlightToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
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
    return () => {
      if (spotlightToastTimerRef.current != null) {
        clearTimeout(spotlightToastTimerRef.current);
      }
      cancelSpotlightZoomInterval(
        spotlightZoomIntervalRef,
        spotlightZoomAnimatingRef
      );
    };
  }, []);

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

  const mapPointsQueryString = useMemo(
    () =>
      buildMapPointsQueryString(
        queryFilterForm,
        partnerOptions,
        selectedPartners
      ),
    [queryFilterForm, partnerOptions, selectedPartners]
  );

  const mapPointsQueryStringRef = useRef(mapPointsQueryString);
  mapPointsQueryStringRef.current = mapPointsQueryString;

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      try {
        const path =
          mapPointsQueryString === ""
            ? "/api/map-filters-meta"
            : `/api/map-filters-meta?${mapPointsQueryString}`;
        const res = await fetch(path, { signal: ac.signal });
        const data = (await res.json().catch(() => ({}))) as {
          partner_ids?: unknown;
        };
        if (!res.ok || cancelled) {
          return;
        }
        const raw = data.partner_ids;
        if (Array.isArray(raw)) {
          const ids: number[] = [];
          for (const x of raw) {
            const n = typeof x === "number" ? x : Number(x);
            if (Number.isFinite(n)) {
              ids.push(n);
            }
          }
          setPartnerOptions(mergePartnerIdsForUi(ids));
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [mapPointsQueryString]);

  useEffect(() => {
    setSelectedPartners((prev) =>
      normalizeSelectedPartnersForUi(prev, partnerOptions)
    );
  }, [partnerOptions]);

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
      const bboxParams = buildPaddedBboxSearchParams(bounds, MAP_BBOX_PADDING);
      if (!bboxParams) {
        return;
      }
      fetchAbortRef.current?.abort();
      const ac = new AbortController();
      fetchAbortRef.current = ac;

      const filterQs = mapPointsQueryStringRef.current;
      const merged = new URLSearchParams(filterQs);
      for (const [k, v] of bboxParams.entries()) {
        merged.set(k, v);
      }
      const path = `/api/map-points?${merged.toString()}`;

      void (async () => {
        try {
          const res = await fetch(path, { signal: ac.signal });
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            points?: unknown;
            total_matching?: unknown;
            in_bbox_matching?: unknown;
          };
          if (ac.signal.aborted || cancelled) {
            return;
          }
          if (!res.ok) {
            const msg =
              typeof data.error === "string"
                ? data.error
                : res.status === 413
                  ? "Too many locations in this view; zoom in or narrow filters."
                  : "Failed to load points";
            setLoadError(msg);
            if (res.status === 413) {
              setPoints([]);
              if (typeof data.in_bbox_matching === "number") {
                setLocationsInView(data.in_bbox_matching);
              } else {
                setLocationsInView(0);
              }
            }
            return;
          }
          const list = Array.isArray(data.points) ? data.points : [];
          setPoints(list as MapPoint[]);
          setLoadError(null);
          if (typeof data.total_matching === "number") {
            setTotalMatching(data.total_matching);
          }
          if (typeof data.in_bbox_matching === "number") {
            setLocationsInView(data.in_bbox_matching);
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") {
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
  }, [map, mapPointsQueryString]);

  useLayoutEffect(() => {
    if (!selected?.inpost_point_id || String(selected.inpost_point_id).length === 0) {
      setDetailReviews(null);
      setDetailReviewsLoading(false);
      setDetailOverlay(null);
      return;
    }
    setDetailReviewsLoading(true);
    setDetailReviews(null);
    setDetailOverlay(null);
  }, [selected?.inpost_point_id]);

  useEffect(() => {
    const id = selected?.inpost_point_id;
    if (id == null || String(id).length === 0) {
      return;
    }
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(
          `/api/map-point?inpost_point_id=${encodeURIComponent(String(id))}`,
          { signal: ac.signal }
        );
        const data = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (ac.signal.aborted) {
          return;
        }
        if (!res.ok) {
          setDetailReviews([]);
          setDetailOverlay(null);
          return;
        }
        const raw = data.google_reviews;
        setDetailReviews(
          Array.isArray(raw) ? (raw as GoogleReviewSnippet[]) : []
        );
        const strOrNull = (v: unknown): string | null => {
          if (v == null) {
            return null;
          }
          if (typeof v !== "string") {
            return null;
          }
          const s = v.trim();
          return s.length > 0 ? s : null;
        };
        setDetailOverlay({
          formatted_address: strOrNull(data.formatted_address),
          google_maps_uri: strOrNull(data.google_maps_uri),
          status: strOrNull(data.status),
          validation_status: strOrNull(data.validation_status),
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError" && !ac.signal.aborted) {
          setDetailReviews([]);
          setDetailOverlay(null);
        }
      } finally {
        if (!ac.signal.aborted) {
          setDetailReviewsLoading(false);
        }
      }
    })();
    return () => ac.abort();
  }, [selected]);

  const detailPoint = useMemo((): MapPoint | null => {
    if (!selected) {
      return null;
    }
    const merged: MapPoint = {
      ...selected,
      ...(detailOverlay ?? {}),
    };
    if (detailReviewsLoading) {
      return { ...merged, google_reviews: undefined };
    }
    return { ...merged, google_reviews: detailReviews ?? [] };
  }, [selected, detailOverlay, detailReviews, detailReviewsLoading]);

  const onPartnerToggle = useCallback((id: number) => {
    setSelectedPartners((prev) => {
      const allIds = partnerOptions;
      if (allIds.length === 0) {
        return prev;
      }
      const effective =
        prev.size === 0 ? new Set(allIds) : new Set(prev);
      if (effective.has(id)) {
        effective.delete(id);
      } else {
        effective.add(id);
      }
      if (
        effective.size === 0 ||
        effective.size === allIds.length
      ) {
        return new Set<number>();
      }
      return effective;
    });
  }, [partnerOptions]);

  const showSpotlightToast = useCallback((message: string) => {
    setSpotlightToast(message);
    if (spotlightToastTimerRef.current != null) {
      clearTimeout(spotlightToastTimerRef.current);
    }
    spotlightToastTimerRef.current = setTimeout(() => {
      setSpotlightToast(null);
      spotlightToastTimerRef.current = null;
    }, 3800);
  }, []);

  const handleSpotlightSelect = useCallback(
    (id: SpotlightPresetId) => {
      const pool = points ?? [];
      if (activeSpotlight === id) {
        cancelSpotlightZoomInterval(
          spotlightZoomIntervalRef,
          spotlightZoomAnimatingRef
        );
        setActiveSpotlight(null);
        setSelected(null);
        return;
      }
      const picked = pickSpotlightPoint(pool, id);
      if (!picked) {
        cancelSpotlightZoomInterval(
          spotlightZoomIntervalRef,
          spotlightZoomAnimatingRef
        );
        setActiveSpotlight(null);
        showSpotlightToast(SPOTLIGHT_EMPTY_HINTS[id]);
        return;
      }
      cancelSpotlightZoomInterval(
        spotlightZoomIntervalRef,
        spotlightZoomAnimatingRef
      );
      setActiveSpotlight(id);
      setSelected(picked);
    },
    [points, activeSpotlight, showSpotlightToast]
  );

  useEffect(() => {
    if (!selected) {
      setInpostItem(null);
      setInpostLoading(false);
      setInpostError(null);
      return;
    }
    const { name, country } = parseInpostNameAndCountry(selected);
    if (!name) {
      setInpostItem(null);
      setInpostLoading(false);
      setInpostError(null);
      return;
    }
    const ac = new AbortController();
    setInpostLoading(true);
    setInpostError(null);
    setInpostItem(null);
    const qs = new URLSearchParams({
      name,
      country,
    });
    void (async () => {
      try {
        const res = await fetch(`/api/inpost-point?${qs.toString()}`, {
          signal: ac.signal,
        });
        const data = (await res.json().catch(() => ({}))) as {
          item?: InpostPointItem;
          error?: string;
        };
        if (ac.signal.aborted) {
          return;
        }
        if (!res.ok) {
          setInpostError(
            typeof data.error === "string" ? data.error : "InPost lookup failed"
          );
          setInpostItem(null);
          return;
        }
        setInpostError(null);
        setInpostItem(data.item ?? null);
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          return;
        }
        setInpostError("InPost lookup failed");
        setInpostItem(null);
      } finally {
        if (!ac.signal.aborted) {
          setInpostLoading(false);
        }
      }
    })();
    return () => ac.abort();
  }, [selected]);

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
        const panelW = panelEl?.getBoundingClientRect().width ?? panelEl?.offsetWidth ?? 448;
        const mapW = mapDiv.clientWidth ?? 0;
        if (mapW <= 0 || panelW >= mapW * 0.88) {
          mapPanDxRef.current = 0;
          return;
        }
        const rightReserve = Math.min(
          MAP_FILTER_OVERLAY_RESERVE_X,
          Math.max(0, mapW - panelW - 32)
        );
        const visibleW = mapW - panelW - rightReserve;
        if (visibleW < 48) {
          mapPanDxRef.current = 0;
          return;
        }
        const dx = Math.round((panelW - rightReserve) / 2);
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
            clearMapPointsFetchPipeline(
              abortInFlightMapPointsFetchRef,
              mapPointsDebounceTimerRef
            );
            runMapPointsFetchRef.current?.();
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
  }, [map, isLoaded, selected, activeSpotlight]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setActiveSpotlight(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const onMapLoad = useCallback((m: google.maps.Map) => {
    mapTypeBarCleanupRef.current?.();
    mapTypeBarCleanupRef.current = null;
    mapRef.current = m;
    setMap(m);
    mapTypeBarCleanupRef.current = attachGoogleStyleMapTypeBar(m);
  }, []);

  const onMapUnmount = useCallback((m: google.maps.Map) => {
    void m;
    cancelSpotlightZoomInterval(
      spotlightZoomIntervalRef,
      spotlightZoomAnimatingRef
    );
    mapRef.current = null;
    mapTypeBarCleanupRef.current?.();
    mapTypeBarCleanupRef.current = null;
    setMap(null);
  }, []);

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

  const beginMapPointsRefresh = useCallback((reason: MapPointsRefreshReason) => {
    void reason;
    clearMapPointsFetchPipeline(
      abortInFlightMapPointsFetchRef,
      mapPointsDebounceTimerRef
    );
    setLoadError(null);
    setPoints(null);
  }, []);

  const handleResetMapView = useCallback(() => {
    if (!map) {
      return;
    }
    const b = mapCameraBaselineRef.current;
    if (!b) {
      return;
    }
    beginMapPointsRefresh("reset_map_view");
    map.panTo({ lat: b.lat, lng: b.lng });
    map.setZoom(b.zoom);
    setActiveSpotlight(null);
    setSelected(null);
  }, [map, beginMapPointsRefresh]);

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

  useEffect(() => {
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
    const markerLookup = markersByKeyRef.current;
    markerLookup.clear();

    if (markersData.length === 0) {
      return;
    }

    const markerLib = google.maps.marker;
    if (!markerLib?.AdvancedMarkerElement) {
      return;
    }

    const markerEntries: Array<{
      marker: google.maps.marker.AdvancedMarkerElement;
      onGmpClick: EventListener;
    }> = [];

    const markers: ClusterMarker[] = markersData.map((p) => {
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
      markerLookup.set(mapPointKey(p), marker);
      return marker;
    });

    clustererRef.current = new MarkerClusterer({
      markers,
      map,
      algorithm: new SuperClusterAlgorithm({
        radius: 240, maxZoom: 16,
      }),
      renderer: inPostClusterRenderer,
    });

    return () => {
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      markerEntries.forEach(({ marker: m, onGmpClick }) => {
        m.removeEventListener("gmp-click", onGmpClick);
        MarkerUtils.setMap(m, null);
      });
      markerLookup.clear();
    };
  }, [map, isLoaded, markerLibReady, scriptError, markersData]);

  useEffect(() => {
    const lookup = markersByKeyRef.current;
    const prev = prevSelectedMarkerRef.current;
    if (prev && (!selected || !isSameMapPoint(prev, selected))) {
      const marker = lookup.get(mapPointKey(prev));
      if (marker) {
        marker.content = getMarkerContent(prev.partner_id, false);
        marker.zIndex = DEFAULT_MARKER_Z_INDEX;
      }
    }
    if (selected) {
      const marker = lookup.get(mapPointKey(selected));
      if (marker) {
        marker.content = getMarkerContent(selected.partner_id, true);
        marker.zIndex = SELECTED_MARKER_Z_INDEX;
      }
    }
    prevSelectedMarkerRef.current = selected;
  }, [markersData, selected]);

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
          onFormChange={(patch) =>
            setFilterForm((f) => coalesceMapFiltersForm({ ...f, ...patch }))
          }
          onResetFilters={() => {
            setFilterForm(emptyMapFiltersForm());
            setSelectedPartners(new Set());
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
            onClick={() => {
              setSelected(null);
              setActiveSpotlight(null);
            }}
          />
          <LocationDetailPanel
            ref={locationPanelRef}
            point={detailPoint}
            reviewsLoading={detailReviewsLoading}
            inpostItem={inpostItem}
            inpostLoading={inpostLoading}
            inpostError={inpostError}
            onClose={() => {
              setSelected(null);
              setActiveSpotlight(null);
            }}
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
          onSelect={(id) => {
            handleSpotlightSelect(id);
          }}
          poolEmpty={points === null || points.length === 0}
        />
      </div>
    </div>
  );
}
