"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { mapMapPointDetailUrl } from "@/components/mapDashboard/mapApiUrls";
import {
  areGoogleReviewFiltersActive,
  filterGoogleReviewsForMapFilters,
  type MapFiltersForm,
} from "@/components/mapFiltersQuery";
import { clientRateLimitRule } from "@/lib/rateLimitConfig";
import { RateLimitError, rateLimitedFetch } from "@/lib/clientRateLimit";
import type {
  GoogleReviewSnippet,
  MapPoint,
  MapPointDetailOverlay,
} from "@/types/mapPoint";

export type DetailGoogleReviewCounts = {
  filtersActive: boolean;
  total: number;
  visible: number;
};

export function useMapPointDetail(
  selected: MapPoint | null,
  queryFilterForm: MapFiltersForm
): {
  detailPoint: MapPoint | null;
  detailReviewsLoading: boolean;
  detailGoogleReviewCounts: DetailGoogleReviewCounts;
} {
  const [detailReviews, setDetailReviews] = useState<GoogleReviewSnippet[] | null>(
    null
  );
  const [detailReviewsLoading, setDetailReviewsLoading] = useState(false);
  const [detailOverlay, setDetailOverlay] = useState<MapPointDetailOverlay | null>(
    null
  );

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
        const res = await rateLimitedFetch(
          mapMapPointDetailUrl(id),
          { signal: ac.signal },
          "map-point",
          clientRateLimitRule("map-point")
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
        if ((e as Error).name === "AbortError" || ac.signal.aborted) {
          return;
        }
        if (e instanceof RateLimitError) {
          setDetailReviews([]);
          setDetailOverlay(null);
          return;
        }
        setDetailReviews([]);
        setDetailOverlay(null);
      } finally {
        if (!ac.signal.aborted) {
          setDetailReviewsLoading(false);
        }
      }
    })();
    return () => ac.abort();
  }, [selected]);

  const detailGoogleReviewCounts = useMemo((): DetailGoogleReviewCounts => {
    const filtersActive = areGoogleReviewFiltersActive(queryFilterForm);
    if (detailReviewsLoading || detailReviews === null) {
      return { filtersActive, total: 0, visible: 0 };
    }
    const total = detailReviews.length;
    const visible = filterGoogleReviewsForMapFilters(
      detailReviews,
      queryFilterForm
    ).length;
    return { filtersActive, total, visible };
  }, [detailReviews, detailReviewsLoading, queryFilterForm]);

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
    const raw = detailReviews ?? [];
    return {
      ...merged,
      google_reviews: filterGoogleReviewsForMapFilters(raw, queryFilterForm),
    };
  }, [
    selected,
    detailOverlay,
    detailReviews,
    detailReviewsLoading,
    queryFilterForm,
  ]);

  return { detailPoint, detailReviewsLoading, detailGoogleReviewCounts };
}
