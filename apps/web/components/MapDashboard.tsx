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
import type { MapPoint } from "@/types/mapPoint";
import {
  buildMapPointsQueryString,
  emptyMapFiltersForm,
  type MapFiltersForm,
  uniquePartnerIdsFromPoints,
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

function countMapPointsInBounds(
  pointList: MapPoint[],
  bounds: google.maps.LatLngBounds | null | undefined
): number {
  if (bounds == null) {
    return pointList.length;
  }
  let n = 0;
  for (const p of pointList) {
    if (bounds.contains({ lat: p.latitude, lng: p.longitude })) {
      n++;
    }
  }
  return n;
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
  const [filterForm, setFilterForm] = useState<MapFiltersForm>(emptyMapFiltersForm);
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
    }),
    [
      debouncedMinRating,
      debouncedMaxRating,
      debouncedReviewTimeMinIdx,
      debouncedReviewTimeMaxIdx,
      filterForm.onlyWithoutGooglePlace,
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

  const [locationsInView, setLocationsInView] = useState(0);

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
          if (z < 13) {
            map.setZoom(13);
          }
        });
      }
    },
    [points, map, activeSpotlight, showSpotlightToast]
  );

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      try {
        const path =
          mapPointsQueryString === ""
            ? "/api/map-points"
            : `/api/map-points?${mapPointsQueryString}`;
        const res = await fetch(path, { signal: ac.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg =
            typeof data.error === "string" ? data.error : "Failed to load points";
          if (!cancelled) setLoadError(msg);
          return;
        }
        const list = Array.isArray(data.points) ? data.points : [];
        if (!cancelled) {
          setPartnerOptions((prev) => {
            const fromList = uniquePartnerIdsFromPoints(list);
            const merged = new Set([...prev, ...fromList]);
            return [...merged].sort((a, b) => a - b);
          });
          setPoints(list);
          setLoadError(null);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          return;
        }
        if (!cancelled) setLoadError("Failed to load points");
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [mapPointsQueryString]);

  useLayoutEffect(() => {
    if (!map || points === null) {
      return;
    }
    const sync = () => {
      setLocationsInView(countMapPointsInBounds(points, map.getBounds()));
    };
    sync();
    const idleListener = map.addListener("idle", sync);
    const boundsListener = map.addListener("bounds_changed", sync);
    return () => {
      google.maps.event.removeListener(idleListener);
      google.maps.event.removeListener(boundsListener);
    };
  }, [map, points]);

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
      const pinSelected = isSameMapPoint(p, selected);
      const content = buildSvgMarkerContent(p.partner_id, {
        selected: pinSelected,
      });
      const marker = new markerLib.AdvancedMarkerElement({
        map,
        position: { lat: p.latitude, lng: p.longitude },
        content,
        title: p.name ?? p.inpost_point_id ?? "Point",
        gmpClickable: true,
        collisionBehavior: google.maps.CollisionBehavior.REQUIRED,
        zIndex: pinSelected ? SELECTED_MARKER_Z_INDEX : DEFAULT_MARKER_Z_INDEX,
      });
      const onGmpClick: EventListener = () => {
        setActiveSpotlight(null);
        setSelected(p);
      };
      marker.addEventListener("gmp-click", onGmpClick);
      markerEntries.push({ marker, onGmpClick });
      return marker;
    });

    clustererRef.current = new MarkerClusterer({
      markers,
      map,
      algorithm: new SuperClusterAlgorithm({
        radius: 300, maxZoom: 12,
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
    };
  }, [map, isLoaded, markerLibReady, scriptError, markersData, selected]);

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

  const headerCountSubtitle =
    points === null && !loadError
      ? "Loading points…"
      : points === null
        ? ""
        : (() => {
            const total = points.length;
            const inView = map != null ? locationsInView : total;
            const inLabel = inView === 1 ? "location" : "locations";
            return `Viewing ${inView} ${inLabel} out of ${total}`;
          })();

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
      {showResetMapView && (
        <div className="pointer-events-none absolute left-1/2 top-[5.25rem] z-[21] flex -translate-x-1/2 justify-center px-3">
          <button
            type="button"
            onClick={handleResetMapView}
            aria-label="Reset map zoom and position to initial view"
            className="pointer-events-auto rounded-md border border-white/15 bg-neutral-950/90 px-3 py-2 text-sm font-medium text-neutral-100 shadow-lg backdrop-blur transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 hover:border-amber-500/35 hover:bg-neutral-900/95"
          >
            Reset view
          </button>
        </div>
      )}
      <div className="absolute right-4 top-20 z-20 max-w-[calc(100vw-1rem)]">
        <MapFiltersPanel
          form={filterForm}
          onFormChange={(patch) =>
            setFilterForm((f) => ({ ...f, ...patch }))
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
      {selected && (
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
            point={selected}
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
      {spotlightToast && (
        <div
          className="absolute bottom-32 left-1/2 z-[35] max-w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-amber-800/50 bg-amber-950/95 px-3 py-2 text-sm text-amber-100 shadow-lg backdrop-blur"
          role="status"
        >
          {spotlightToast}
        </div>
      )}
      <MapSpotlightBar
        active={activeSpotlight}
        onSelect={handleSpotlightSelect}
        poolEmpty={points === null || points.length === 0}
      />
    </div>
  );
}
