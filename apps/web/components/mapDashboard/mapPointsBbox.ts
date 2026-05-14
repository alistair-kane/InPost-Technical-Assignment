import type { MapPoint } from "@/types/mapPoint";

import { mapPointsUrl } from "./mapApiUrls";
import { buildPaddedBboxSearchParams } from "./mapPointGeo";

/**
 * Merge filter-only query params with bbox params (bbox keys overwrite / set).
 */
export function mergeFilterAndBboxSearchParams(
  filterQueryString: string,
  bboxParams: URLSearchParams
): URLSearchParams {
  const merged = new URLSearchParams(filterQueryString);
  for (const [k, v] of bboxParams.entries()) {
    merged.set(k, v);
  }
  return merged;
}

/**
 * Full `/api/map-points?…` URL for the current map bounds and filter string, or `null` if bounds are unusable.
 */
export function buildMapPointsFetchUrl(
  filterQueryString: string,
  bounds: google.maps.LatLngBounds,
  padFraction: number
): string | null {
  const bboxParams = buildPaddedBboxSearchParams(bounds, padFraction);
  if (!bboxParams) {
    return null;
  }
  const merged = mergeFilterAndBboxSearchParams(filterQueryString, bboxParams);
  return mapPointsUrl(merged);
}

export function parsePartnerIdsFromFiltersMetaBody(
  data: unknown
): number[] | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  if (!("partner_ids" in data)) {
    return null;
  }
  const raw = (data as { partner_ids: unknown }).partner_ids;
  if (!Array.isArray(raw)) {
    return null;
  }
  const ids: number[] = [];
  for (const x of raw) {
    const n = typeof x === "number" ? x : Number(x);
    if (Number.isFinite(n)) {
      ids.push(n);
    }
  }
  return ids;
}

export function mapPointsRequestErrorMessage(
  res: Response,
  data: { error?: unknown }
): string {
  if (typeof data.error === "string") {
    return data.error;
  }
  if (res.status === 413) {
    return "Too many locations in this view; zoom in or narrow filters.";
  }
  return "Failed to load points";
}

export function extractMapPointsArray(data: unknown): MapPoint[] {
  if (typeof data !== "object" || data === null) {
    return [];
  }
  const list = (data as { points?: unknown }).points;
  return Array.isArray(list) ? (list as MapPoint[]) : [];
}

export function readOptionalNumericField(
  data: unknown,
  key: "total_matching" | "in_bbox_matching"
): number | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const v = (data as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}
