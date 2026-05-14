"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { mapMapPointDetailUrl } from "@/components/mapDashboard/mapApiUrls";
import type {
  GoogleReviewSnippet,
  MapPoint,
  MapPointDetailOverlay,
} from "@/types/mapPoint";

export function useMapPointDetail(selected: MapPoint | null): {
  detailPoint: MapPoint | null;
  detailReviewsLoading: boolean;
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
        const res = await fetch(mapMapPointDetailUrl(id), { signal: ac.signal });
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

  return { detailPoint, detailReviewsLoading };
}
