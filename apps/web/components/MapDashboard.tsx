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
  s.display = "flex";
  s.flexDirection = "column";
  s.alignItems = "center";
  s.justifyContent = "flex-end";
  s.pointerEvents = "auto";
  s.lineHeight = "0";
  if (selected) {
    s.borderRadius = "8px";
    s.backgroundColor = "rgba(255, 204, 4, 0.14)";
    s.boxShadow =
      "0 0 0 12px #FFCC04, 0 0 10px rgba(255, 204, 4, 0.55), 0 4px 20px rgba(0,0,0,0.35)";
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
    ? "drop-shadow(0 2px 3px rgba(0,0,0,0.45)) drop-shadow(0 0 8px rgba(255,204,4,0.65))"
    : "drop-shadow(0 2px 3px rgba(0,0,0,0.35))";
  wrapper.appendChild(img);
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
  const queryFilterForm = useMemo(
    (): MapFiltersForm => ({
      minRating: debouncedMinRating,
      maxRating: debouncedMaxRating,
      onlyWithoutGooglePlace: filterForm.onlyWithoutGooglePlace,
    }),
    [debouncedMinRating, debouncedMaxRating, filterForm.onlyWithoutGooglePlace]
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
            InPost 
          </h1>
          <p className="text-md text-neutral-400">{headerCountSubtitle}</p>
        </div>
      </header>
      <div className="absolute right-4 top-20 z-20 max-w-[calc(100vw-1rem)]">
        <MapFiltersPanel
          form={filterForm}
          onFormChange={(patch) =>
            setFilterForm((f) => ({ ...f, ...patch }))
          }
          partnerOptions={partnerOptions}
          selectedPartners={selectedPartners}
          onPartnerToggle={onPartnerToggle}
          spotlightActive={activeSpotlight}
          onSpotlightSelect={handleSpotlightSelect}
          spotlightPoolEmpty={points === null || points.length === 0}
        />
      </div>
      {spotlightToast && (
        <div
          className="absolute right-4 top-[19.5rem] z-[35] max-w-[min(18rem,calc(100vw-2rem))] rounded-md border border-amber-800/50 bg-amber-950/95 px-3 py-2 text-sm text-amber-100 shadow-lg backdrop-blur"
          role="status"
        >
          {spotlightToast}
        </div>
      )}
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
          mapContainerStyle={mapContainerStyle}
          center={defaultCenter}
          zoom={defaultZoom}
          onLoad={onMapLoad}
          onUnmount={onMapUnmount}
          options={{
            mapId,
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
    </div>
  );
}
