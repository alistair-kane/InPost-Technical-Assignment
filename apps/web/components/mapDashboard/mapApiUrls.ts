/**
 * Central place for Next.js BFF paths used by the map dashboard (no React, no Maps types).
 */

export function mapFiltersMetaUrl(filterQueryString: string): string {
  return filterQueryString === ""
    ? "/api/map-filters-meta"
    : `/api/map-filters-meta?${filterQueryString}`;
}

export function mapPointsUrl(mergedSearchParams: URLSearchParams): string {
  return `/api/map-points?${mergedSearchParams.toString()}`;
}

export function mapMapPointDetailUrl(inpostPointId: string | number): string {
  return `/api/map-point?inpost_point_id=${encodeURIComponent(String(inpostPointId))}`;
}

export function mapInpostPointLookupUrl(search: URLSearchParams): string {
  return `/api/inpost-point?${search.toString()}`;
}
