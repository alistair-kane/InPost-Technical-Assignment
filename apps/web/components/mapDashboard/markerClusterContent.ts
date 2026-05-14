import type {
  Marker as ClusterMarker,
  Renderer,
  ClusterStats,
} from "@googlemaps/markerclusterer";
import type { Cluster } from "@googlemaps/markerclusterer";

import { markerSvgSrc } from "@/lib/markerSvgSrc";

import {
  CLUSTER_BG_HEX,
  CLUSTER_ICON_PX,
  CLUSTER_TEXT_HEX,
  MARKER_SIZE_PX,
  SUN_RAY_COUNT,
} from "./mapDashboardConstants";

function clusterBubbleDataUrl(count: number): string {
  const label = String(Math.min(99999, Math.max(1, count)));
  const fontSize = label.length > 3 ? 12 : label.length > 2 ? 14 : 16;
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

export const inPostClusterRenderer: Renderer = {
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

export function getMarkerContent(
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
