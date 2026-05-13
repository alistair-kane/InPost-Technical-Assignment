"use client";

import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import {
  MarkerClusterer,
  MarkerUtils,
  SuperClusterAlgorithm,
  type Marker as ClusterMarker,
  type Renderer,
  type ClusterStats,
} from "@googlemaps/markerclusterer";
import type { Cluster } from "@googlemaps/markerclusterer";
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
import { markerSvgSrc } from "@/lib/markerSvgSrc";
import {
  pickSpotlightPoint,
  SPOTLIGHT_EMPTY_HINTS,
  type SpotlightPresetId,
} from "@/lib/mapSpotlightPresets";
import { parseInpostNameAndCountry } from "@/lib/inpostPointQuery";
import type { GoogleReviewSnippet, MapPoint } from "@/types/mapPoint";
import {
  buildMapPointsQueryString,
  coalesceMapFiltersForm,
  emptyMapFiltersForm,
  mergePartnerIdsForUi,
  normalizeSelectedPartnersForUi,
  type MapFiltersForm,
} from "./mapFiltersQuery";

export type { MapPoint } from "@/types/mapPoint";

const mapContainerStyle = { width: "100%", height: "100%" };

const defaultCenter = { lat: 52.1, lng: 19.3 };
const defaultZoom = 6.5;

/** Min zoom levels above baseline before showing reset (Google Maps zoom increases when zooming in). */
const MAP_RESET_ZOOM_IN_THRESHOLD = 2;

const MARKER_SIZE_PX = 40;
const SELECTED_MARKER_Z_INDEX = 5_000_000;
const DEFAULT_MARKER_Z_INDEX = 0;

/** Padded viewport → API bbox (fraction of span added on each side). */
const MAP_BBOX_PADDING = 0.14;
/** After map `idle`, wait before calling `/api/map-points` (reduces spam while panning). */
const MAP_POINTS_IDLE_DEBOUNCE_MS = 1000;
/** Must match server default cap expectation for dashboard loads. */
const MAP_MAX_POINTS = 100_000;

/** Filters panel: `right-4` + `w-72` (288px) — horizontal space covered on the map. */
const MAP_FILTER_OVERLAY_RESERVE_X = 16 + 288;

/** Same map row as `selected` for highlight / pan logic (id match when both have ids). */
function isSameMapPoint(a: MapPoint, b: MapPoint | null): boolean {
  if (!b) {
    return false;
  }
  const idA =
    a.inpost_point_id != null && String(a.inpost_point_id).length > 0
      ? String(a.inpost_point_id)
      : null;
  const idB =
    b.inpost_point_id != null && String(b.inpost_point_id).length > 0
      ? String(b.inpost_point_id)
      : null;
  if (idA != null && idB != null) {
    return idA === idB;
  }
  return a.latitude === b.latitude && a.longitude === b.longitude;
}

function mapPointKey(p: MapPoint): string {
  const id =
    p.inpost_point_id != null && String(p.inpost_point_id).length > 0
      ? String(p.inpost_point_id)
      : null;
  return id ?? `${p.latitude}|${p.longitude}`;
}

function buildPaddedBboxSearchParams(
  bounds: google.maps.LatLngBounds,
  padFraction: number
): URLSearchParams | null {
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  let minLat = sw.lat();
  let maxLat = ne.lat();
  let minLng = sw.lng();
  let maxLng = ne.lng();
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  const latPad = (latSpan > 1e-9 ? latSpan : 0.01) * padFraction;
  const lngPad = (lngSpan > 1e-9 ? lngSpan : 0.01) * padFraction;
  minLat = Math.max(-90, minLat - latPad);
  maxLat = Math.min(90, maxLat + latPad);
  minLng = Math.max(-180, minLng - lngPad);
  maxLng = Math.min(180, maxLng + lngPad);
  if (minLat > maxLat || minLng > maxLng) {
    return null;
  }
  const sp = new URLSearchParams();
  sp.set("min_lat", String(minLat));
  sp.set("max_lat", String(maxLat));
  sp.set("min_lng", String(minLng));
  sp.set("max_lng", String(maxLng));
  sp.set("max_points", String(MAP_MAX_POINTS));
  return sp;
}

/** Marker cluster bubble — InPost greys / yellow (matches paczkomat SVG accents). */
const CLUSTER_ICON_PX = 48;
const CLUSTER_BG_HEX = "#404041";
const CLUSTER_TEXT_HEX = "#FFCC04";
const SUN_RAY_COUNT = 12;

function clusterBubbleDataUrl(count: number): string {
  const label = String(Math.min(99999, Math.max(1, count)));
  const fontSize = label.length > 3 ? 10 : label.length > 2 ? 12 : 14;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CLUSTER_ICON_PX}" height="${CLUSTER_ICON_PX}" viewBox="0 0 48 48">` +
    `<circle cx="24" cy="24" r="20" fill="${CLUSTER_BG_HEX}" stroke="#ffffff" stroke-width="2"/>` +
    `<text x="24" y="24" dominant-baseline="central" text-anchor="middle" fill="${CLUSTER_TEXT_HEX}" ` +
    `font-family="system-ui,-apple-system,sans-serif" font-size="${fontSize}" font-weight="700">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildClusterBubbleContent(count: number): HTMLElement {
  const wrapper = document.createElement("div");
  const s = wrapper.style;
  s.width = `${CLUSTER_ICON_PX}px`;
  s.height = `${CLUSTER_ICON_PX}px`;
  s.display = "flex";
  s.alignItems = "center";
  s.justifyContent = "center";
  s.pointerEvents = "auto";
  s.lineHeight = "0";

  const img = document.createElement("img");
  img.src = clusterBubbleDataUrl(count);
  img.width = CLUSTER_ICON_PX;
  img.height = CLUSTER_ICON_PX;
  img.alt = "";
  img.draggable = false;
  const is = img.style;
  is.display = "block";
  is.width = `${CLUSTER_ICON_PX}px`;
  is.height = `${CLUSTER_ICON_PX}px`;
  is.objectFit = "contain";
  wrapper.appendChild(img);
  return wrapper;
}

function sunMarkerDataUrl(): string {
  const centerX = MARKER_SIZE_PX / 2;
  // Keep the sun lower so AdvancedMarker bottom-center anchoring
  // aligns the visible sun center with the selected point.
  const centerY = MARKER_SIZE_PX - 24;
  const innerR = 6;
  const rayInnerR = 9;
  const rayOuterR = 13;
  const rays = Array.from({ length: SUN_RAY_COUNT }, (_, i) => {
    const theta = (Math.PI * 2 * i) / SUN_RAY_COUNT;
    const x1 = centerX + rayInnerR * Math.cos(theta);
    const y1 = centerY + rayInnerR * Math.sin(theta);
    const x2 = centerX + rayOuterR * Math.cos(theta);
    const y2 = centerY + rayOuterR * Math.sin(theta);
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MARKER_SIZE_PX}" height="${MARKER_SIZE_PX}" viewBox="0 0 ${MARKER_SIZE_PX} ${MARKER_SIZE_PX}">` +
    `<g stroke="#FFCC04" stroke-width="2.4" stroke-linecap="round">${rays}</g>` +
    `<circle cx="${centerX}" cy="${centerY}" r="${innerR}" fill="#FFCC04" stroke="#2D2D2D" stroke-width="2"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const inPostClusterRenderer: Renderer = {
  render(
    cluster: Cluster,
    _stats: ClusterStats,
    map: google.maps.Map
  ): ClusterMarker {
    void _stats;
    const markerLib = google.maps.marker;
    const AdvancedMarkerElement = markerLib.AdvancedMarkerElement;
    if (!AdvancedMarkerElement) {
      throw new Error("google.maps.marker.AdvancedMarkerElement is not available");
    }
    const count = cluster.count;
    const content = buildClusterBubbleContent(count);
    return new AdvancedMarkerElement({
      map,
      position: cluster.position,
      content,
      title: `${count} locations`,
      gmpClickable: true,
      collisionBehavior: google.maps.CollisionBehavior.REQUIRED,
      zIndex: 1_000_000 + count,
    });
  },
};

/**
 * Root element for AdvancedMarkerElement: the map pins the **bottom center**
 * of this node to `position`. Do not use `transform` for anchoring — it fights
 * the Maps projection math and drifts at some zoom levels.
 */
function buildSvgMarkerContent(
  partnerId: number | string | null | undefined,
  options?: { selected?: boolean }
): HTMLElement {
  const selected = options?.selected ?? false;
  const wrapper = document.createElement("div");
  const s = wrapper.style;
  s.width = `${MARKER_SIZE_PX}px`;
  s.height = `${MARKER_SIZE_PX}px`;
  s.position = "relative";
  s.display = "flex";
  s.flexDirection = "column";
  s.alignItems = "center";
  s.justifyContent = "flex-end";
  s.pointerEvents = "auto";
  s.lineHeight = "0";
  if (selected) {
    s.borderRadius = "999px";
    s.backgroundColor = "rgba(255, 204, 4, 0.08)";
  }

  const img = document.createElement("img");
  img.src = markerSvgSrc(partnerId);
  img.width = MARKER_SIZE_PX;
  img.height = MARKER_SIZE_PX;
  img.alt = "";
  img.draggable = false;
  const is = img.style;
  is.display = "block";
  is.width = `${MARKER_SIZE_PX}px`;
  is.height = `${MARKER_SIZE_PX}px`;
  is.objectFit = "contain";
  is.objectPosition = "bottom center";
  is.filter = selected
    ? "drop-shadow(0 2px 4px rgba(0,0,0,0.35)) drop-shadow(0 0 9px rgba(255,204,4,0.72))"
    : "drop-shadow(0 2px 3px rgba(0,0,0,0.35))";
  wrapper.appendChild(img);
  if (selected) {
    const sun = document.createElement("img");
    sun.src = sunMarkerDataUrl();
    sun.width = MARKER_SIZE_PX;
    sun.height = MARKER_SIZE_PX;
    sun.alt = "";
    sun.draggable = false;
    const ss = sun.style;
    ss.position = "absolute";
    ss.left = "0";
    ss.top = "0";
    ss.width = `${MARKER_SIZE_PX}px`;
    ss.height = `${MARKER_SIZE_PX}px`;
    ss.objectFit = "contain";
    ss.objectPosition = "bottom center";
    ss.pointerEvents = "none";
    ss.zIndex = "2";
    ss.filter = "drop-shadow(0 0 9px rgba(255,204,4,0.72))";
    wrapper.appendChild(sun);
  }
  return wrapper;
}

const markerTemplateCache = new Map<string, HTMLElement>();

function getMarkerContent(
  partnerId: number | string | null | undefined,
  selected: boolean
): HTMLElement {
  const key = `${partnerId ?? "_"}|${selected ? "s" : "n"}`;
  let template = markerTemplateCache.get(key);
  if (!template) {
    template = buildSvgMarkerContent(partnerId, { selected });
    markerTemplateCache.set(key, template);
  }
  return template.cloneNode(true) as HTMLElement;
}

const MAP_TYPE_SEGMENTS: { mapTypeId: string; label: string }[] = [
  { mapTypeId: "roadmap", label: "Map" },
  { mapTypeId: "satellite", label: "Satellite" },
];

const MAP_TYPE_BAR_BG = "#141414";
const MAP_TYPE_BAR_BORDER = "1px solid rgba(255, 204, 4, 0.22)";
const MAP_TYPE_INACTIVE_BG = "#1f1f1f";
const MAP_TYPE_INACTIVE_FG = "#d4d4d4";
const MAP_TYPE_ACTIVE_BG = "#FFCC04";
const MAP_TYPE_ACTIVE_FG = "#141414";
const MAP_TYPE_DIVIDER = "1px solid rgba(255, 255, 255, 0.08)";

/** Space from map right edge for Google default fullscreen (~40px) + gap. */
const MAP_TYPE_RIGHT_OFFSET_PX = 64;

/**
 * Map / satellite toggle (no hybrid), InPost black + yellow styling.
 * Absolutely positioned on the map div so it sits on the same row as the
 * fullscreen control (to its left), not stacked above it in the control slot.
 */
function attachGoogleStyleMapTypeBar(map: google.maps.Map): () => void {
  const cur = (map.getMapTypeId() ?? "").toLowerCase();
  if (cur === "hybrid") {
    map.setMapTypeId("roadmap");
  }

  const mapDiv = map.getDiv();
  if (!(mapDiv instanceof HTMLElement)) {
    return () => {};
  }

  const outer = document.createElement("div");
  outer.style.position = "absolute";
  outer.style.bottom = "10px";
  outer.style.right = `${MAP_TYPE_RIGHT_OFFSET_PX}px`;
  outer.style.zIndex = "10";
  outer.style.display = "flex";
  outer.style.justifyContent = "flex-end";
  outer.style.pointerEvents = "auto";

  const bar = document.createElement("div");
  bar.style.display = "inline-flex";
  bar.style.borderRadius = "8px";
  bar.style.overflow = "hidden";
  bar.style.boxShadow =
    "0 2px 8px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.35)";
  bar.style.background = MAP_TYPE_BAR_BG;
  bar.style.border = MAP_TYPE_BAR_BORDER;
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Map type");

  const buttons: HTMLButtonElement[] = [];

  const applyInactive = (btn: HTMLButtonElement) => {
    btn.style.background = MAP_TYPE_INACTIVE_BG;
    btn.style.color = MAP_TYPE_INACTIVE_FG;
    btn.style.fontWeight = "500";
  };

  const sync = () => {
    let current = (map.getMapTypeId() ?? "").toLowerCase();
    if (current === "hybrid") {
      map.setMapTypeId("roadmap");
      current = "roadmap";
    }
    MAP_TYPE_SEGMENTS.forEach((seg, i) => {
      const btn = buttons[i];
      const active = current === seg.mapTypeId.toLowerCase();
      if (active) {
        btn.style.background = MAP_TYPE_ACTIVE_BG;
        btn.style.color = MAP_TYPE_ACTIVE_FG;
        btn.style.fontWeight = "600";
      } else {
        applyInactive(btn);
      }
    });
  };

  MAP_TYPE_SEGMENTS.forEach((seg, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = seg.label;
    btn.style.fontFamily = "system-ui, -apple-system, sans-serif";
    btn.style.fontSize = "16.44px";
    btn.style.lineHeight = "22.68px";
    btn.style.padding = "11.4px 17.64px";
    btn.style.border = "none";
    btn.style.borderLeft = i === 0 ? "none" : MAP_TYPE_DIVIDER;
    btn.style.cursor = "pointer";
    btn.style.margin = "0";
    btn.style.transition = "background 0.12s ease, color 0.12s ease";
    applyInactive(btn);
    btn.addEventListener("mouseenter", () => {
      const current = (map.getMapTypeId() ?? "").toLowerCase();
      const active = current === seg.mapTypeId.toLowerCase();
      if (!active) {
        btn.style.background = "#2a2a2a";
        btn.style.color = "#FFCC04";
      }
    });
    btn.addEventListener("mouseleave", () => {
      sync();
    });
    btn.addEventListener("click", () => {
      map.setMapTypeId(seg.mapTypeId);
      sync();
    });
    buttons.push(btn);
    bar.appendChild(btn);
  });

  outer.appendChild(bar);
  mapDiv.appendChild(outer);
  sync();

  const listener = map.addListener("maptypeid_changed", sync);

  return () => {
    google.maps.event.removeListener(listener);
    if (outer.parentNode === mapDiv) {
      mapDiv.removeChild(outer);
    }
  };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function MapDashboard() {
  const [points, setPoints] = useState<MapPoint[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totalMatching, setTotalMatching] = useState<number | null>(null);
  const [locationsInView, setLocationsInView] = useState(0);
  const [detailReviews, setDetailReviews] = useState<GoogleReviewSnippet[] | null>(
    null
  );
  const [detailReviewsLoading, setDetailReviewsLoading] = useState(false);
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
  const queryFilterForm = useMemo(
    (): MapFiltersForm => ({
      minRating: debouncedMinRating,
      maxRating: debouncedMaxRating,
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
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const fetchAbortRef = { current: null as AbortController | null };

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

    const schedule = () => {
      if (debounceTimer != null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        runFetch();
      }, MAP_POINTS_IDLE_DEBOUNCE_MS);
    };

    const idleListener = map.addListener("idle", schedule);
    schedule();

    return () => {
      cancelled = true;
      fetchAbortRef.current?.abort();
      google.maps.event.removeListener(idleListener);
      if (debounceTimer != null) {
        clearTimeout(debounceTimer);
      }
    };
  }, [map, mapPointsQueryString]);

  useLayoutEffect(() => {
    if (!selected?.inpost_point_id || String(selected.inpost_point_id).length === 0) {
      setDetailReviews(null);
      setDetailReviewsLoading(false);
      return;
    }
    setDetailReviewsLoading(true);
    setDetailReviews(null);
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
        const data = (await res.json().catch(() => ({}))) as {
          google_reviews?: unknown;
        };
        if (ac.signal.aborted) {
          return;
        }
        if (!res.ok) {
          setDetailReviews([]);
          return;
        }
        const raw = data.google_reviews;
        setDetailReviews(
          Array.isArray(raw) ? (raw as GoogleReviewSnippet[]) : []
        );
      } catch (e) {
        if ((e as Error).name !== "AbortError" && !ac.signal.aborted) {
          setDetailReviews([]);
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
    if (detailReviewsLoading) {
      return { ...selected, google_reviews: undefined };
    }
    return { ...selected, google_reviews: detailReviews ?? [] };
  }, [selected, detailReviews, detailReviewsLoading]);

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
        setActiveSpotlight(null);
        setSelected(null);
        return;
      }
      const picked = pickSpotlightPoint(pool, id);
      if (!picked) {
        setActiveSpotlight(null);
        showSpotlightToast(SPOTLIGHT_EMPTY_HINTS[id]);
        return;
      }
      setActiveSpotlight(id);
      setSelected(picked);
      if (map) {
        requestAnimationFrame(() => {
          const z = map.getZoom() ?? 8;
          if (z < 18) {
            map.setZoom(18);
          }
        });
      }
    },
    [points, map, activeSpotlight, showSpotlightToast]
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
      return;
    }
    const prev = prevSelectedRef.current;
    const cur = selected;

    if (cur) {
      map.panTo({ lat: cur.latitude, lng: cur.longitude });
      const z = map.getZoom() ?? 0;
      const pinChanged = !prev || !isSameMapPoint(prev, cur);
      if (pinChanged && z < 14) {
        map.setZoom(14);
      }
      const applyPanelAwareCenter = () => {
        if (!map) {
          return;
        }
        const panelEl = locationPanelRef.current;
        const mapDiv = map.getDiv();
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
        map.panBy(dx, 0);
        mapPanDxRef.current = dx;
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(applyPanelAwareCenter);
      });
    }

    if (!cur && prev && mapPanDxRef.current !== 0) {
      map.panBy(-mapPanDxRef.current, 0);
      mapPanDxRef.current = 0;
    }

    prevSelectedRef.current = cur;

    return () => {
      if (map && mapPanDxRef.current !== 0) {
        map.panBy(-mapPanDxRef.current, 0);
        mapPanDxRef.current = 0;
      }
    };
  }, [map, isLoaded, selected]);

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
    setMap(m);
    mapTypeBarCleanupRef.current = attachGoogleStyleMapTypeBar(m);
  }, []);

  const onMapUnmount = useCallback((m: google.maps.Map) => {
    void m;
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

  const handleResetMapView = useCallback(() => {
    if (!map) {
      return;
    }
    const b = mapCameraBaselineRef.current;
    if (!b) {
      return;
    }
    map.panTo({ lat: b.lat, lng: b.lng });
    map.setZoom(b.zoom);
    setActiveSpotlight(null);
    setSelected(null);
  }, [map]);

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
            InPost Poland - Google Maps Data Explorer
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
              <img
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
              <img
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
      <div className="absolute right-4 top-20 z-20 max-w-[calc(100vw-1rem)]">
        <MapFiltersPanel
          form={filterForm}
          onFormChange={(patch) =>
            setFilterForm((f) => coalesceMapFiltersForm({ ...f, ...patch }))
          }
          onResetFilters={() => {
            setFilterForm(emptyMapFiltersForm());
            setSelectedPartners(new Set());
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
            <p className="text-sm text-neutral-300">Loading points…</p>
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
            className="pointer-events-auto flex items-center gap-2 rounded-md border border-white/15 bg-neutral-950/90 px-3 py-2 text-sm font-medium text-neutral-100 shadow-lg backdrop-blur transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 hover:border-amber-500/35 hover:bg-neutral-900/95"
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
            Reset map
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
