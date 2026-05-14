"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { mapFiltersMetaUrl } from "@/components/mapDashboard/mapApiUrls";
import { parsePartnerIdsFromFiltersMetaBody } from "@/components/mapDashboard/mapPointsBbox";
import {
  buildMapPointsQueryString,
  coalesceMapFiltersForm,
  emptyMapFiltersForm,
  mergePartnerIdsForUi,
  normalizeSelectedPartnersForUi,
  type MapFiltersForm,
} from "@/components/mapFiltersQuery";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const FILTER_DEBOUNCE_MS = 260;

export function useMapFiltersQuery(): {
  filterForm: MapFiltersForm;
  applyFilterPatch: (patch: Partial<MapFiltersForm>) => void;
  partnerOptions: number[];
  selectedPartners: Set<number>;
  mapPointsQueryString: string;
  onPartnerToggle: (id: number) => void;
  resetFiltersToEmpty: () => void;
} {
  const [filterForm, setFilterForm] = useState<MapFiltersForm>(() =>
    coalesceMapFiltersForm({})
  );
  const debouncedMinRating = useDebouncedValue(filterForm.minRating, FILTER_DEBOUNCE_MS);
  const debouncedMaxRating = useDebouncedValue(filterForm.maxRating, FILTER_DEBOUNCE_MS);
  const debouncedReviewTimeMinIdx = useDebouncedValue(
    filterForm.reviewTimeMinIdx,
    FILTER_DEBOUNCE_MS
  );
  const debouncedReviewTimeMaxIdx = useDebouncedValue(
    filterForm.reviewTimeMaxIdx,
    FILTER_DEBOUNCE_MS
  );
  const debouncedGoogleMapsProximityRadiusM = useDebouncedValue(
    filterForm.googleMapsProximityRadiusM,
    FILTER_DEBOUNCE_MS
  );
  const queryFilterForm = useMemo(
    (): MapFiltersForm => ({
      minRating: debouncedMinRating,
      maxRating: debouncedMaxRating,
      googleMapsProximityRadiusM: debouncedGoogleMapsProximityRadiusM,
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
      debouncedGoogleMapsProximityRadiusM,
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

  const mapPointsQueryString = useMemo(
    () =>
      buildMapPointsQueryString(
        queryFilterForm,
        partnerOptions,
        selectedPartners
      ),
    [queryFilterForm, partnerOptions, selectedPartners]
  );

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    void (async () => {
      try {
        const path = mapFiltersMetaUrl(mapPointsQueryString);
        const res = await fetch(path, { signal: ac.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) {
          return;
        }
        const ids = parsePartnerIdsFromFiltersMetaBody(data);
        if (ids !== null) {
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

  const applyFilterPatch = useCallback((patch: Partial<MapFiltersForm>) => {
    setFilterForm((f) => coalesceMapFiltersForm({ ...f, ...patch }));
  }, []);

  const onPartnerToggle = useCallback((id: number) => {
    setSelectedPartners((prev) => {
      const allIds = partnerOptions;
      if (allIds.length === 0) {
        return prev;
      }
      const effective = prev.size === 0 ? new Set(allIds) : new Set(prev);
      if (effective.has(id)) {
        effective.delete(id);
      } else {
        effective.add(id);
      }
      if (effective.size === 0 || effective.size === allIds.length) {
        return new Set<number>();
      }
      return effective;
    });
  }, [partnerOptions]);

  const resetFiltersToEmpty = useCallback(() => {
    setFilterForm(emptyMapFiltersForm());
    setSelectedPartners(new Set());
  }, []);

  return {
    filterForm,
    applyFilterPatch,
    partnerOptions,
    selectedPartners,
    mapPointsQueryString,
    onPartnerToggle,
    resetFiltersToEmpty,
  };
}
