import type { MapPoint } from "@/types/mapPoint";

import { MAP_MAX_POINTS } from "./mapDashboardConstants";

/** Same map row as `selected` for highlight / pan logic (id match when both have ids). */
export function isSameMapPoint(a: MapPoint, b: MapPoint | null): boolean {
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

export function mapPointKey(p: MapPoint): string {
  const id =
    p.inpost_point_id != null && String(p.inpost_point_id).length > 0
      ? String(p.inpost_point_id)
      : null;
  return id ?? `${p.latitude}|${p.longitude}`;
}

export function buildPaddedBboxSearchParams(
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
