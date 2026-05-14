export const mapContainerStyle = { width: "100%", height: "100%" };

export const defaultCenter = { lat: 52.1, lng: 19.3 };
export const defaultZoom = 6.5;

/** Min zoom levels above baseline before showing reset (Google Maps zoom increases when zooming in). */
export const MAP_RESET_ZOOM_IN_THRESHOLD = 2;

export const MARKER_SIZE_PX = 40;
export const SELECTED_MARKER_Z_INDEX = 5_000_000;
export const DEFAULT_MARKER_Z_INDEX = 0;

/** Padded viewport → API bbox (fraction of span added on each side). */
export const MAP_BBOX_PADDING = 0.14;
/** After map `idle`, wait before calling `/api/map-points` (reduces spam while panning). */
export const MAP_POINTS_IDLE_DEBOUNCE_MS = 1000;
/** Must match server default cap expectation for dashboard loads. */
export const MAP_MAX_POINTS = 100_000;

/** Target zoom when a spotlight preset selects a point (full-map → street context). */
export const SPOTLIGHT_FOCUS_ZOOM = 13;
/** Delay between integer zoom steps for spotlight smooth zoom (Maps API has no fractional zoom). */
export const SPOTLIGHT_ZOOM_STEP_MS = 120;

/** Filters panel: `right-4` + `w-72` (288px) — horizontal space covered on the map. */
export const MAP_FILTER_OVERLAY_RESERVE_X = 16 + 288;

/**
 * Floating filters host: Tailwind `top-*` rem value (keep in sync with MapDashboard
 * wrapper class). Clears the app header including light/dark map theme controls.
 */
export const MAP_FILTERS_HOST_TOP_REM = 7;

/**
 * Vertical space reserved above the viewport bottom for the custom Map / Satellite
 * bar, default fullscreen control, and padding (see attachMapTypeBar).
 */
export const MAP_FILTERS_HOST_BOTTOM_REM = 6;

/**
 * Approximate height from viewport top to the filters body (summary row +
 * padding + border). Keep in sync with `summary` + `details` padding in
 * MapFiltersPanel.
 */
export const MAP_FILTERS_SUMMARY_CHROME_REM = 4.5;

/** Marker cluster bubble — InPost greys / yellow (matches paczkomat SVG accents). */
export const CLUSTER_ICON_PX = 48;
export const CLUSTER_BG_HEX = "#404041";
export const CLUSTER_TEXT_HEX = "#FFCC04";
export const SUN_RAY_COUNT = 12;

export const MAP_TYPE_SEGMENTS: { mapTypeId: string; label: string }[] = [
  { mapTypeId: "roadmap", label: "Map" },
  { mapTypeId: "satellite", label: "Satellite" },
];

export const MAP_TYPE_BAR_BG = "#141414";
export const MAP_TYPE_BAR_BORDER = "1px solid rgba(255, 204, 4, 0.22)";
export const MAP_TYPE_INACTIVE_BG = "#1f1f1f";
export const MAP_TYPE_INACTIVE_FG = "#d4d4d4";
export const MAP_TYPE_ACTIVE_BG = "#FFCC04";
export const MAP_TYPE_ACTIVE_FG = "#141414";
export const MAP_TYPE_DIVIDER = "1px solid rgba(255, 255, 255, 0.08)";

/** Space from map right edge for Google default fullscreen (~40px) + gap. */
export const MAP_TYPE_RIGHT_OFFSET_PX = 64;
