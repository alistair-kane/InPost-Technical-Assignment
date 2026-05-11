/** Slider low end (1 star). Default = no `min_rating` query param. */
export const RATING_SLIDER_MIN = 1;
/** Slider high end (5 stars). Default = no `max_rating` query param. */
export const RATING_SLIDER_MAX = 5;
export const RATING_SLIDER_STEP = 0.5;

export type MapFiltersForm = {
  minRating: number;
  maxRating: number;
  onlyWithoutGooglePlace: boolean;
};

export const emptyMapFiltersForm = (): MapFiltersForm => ({
  minRating: RATING_SLIDER_MIN,
  maxRating: RATING_SLIDER_MAX,
  onlyWithoutGooglePlace: false,
});

export function buildMapPointsQueryString(
  form: MapFiltersForm,
  partnerOptions: number[],
  selectedPartners: Set<number>
): string {
  const sp = new URLSearchParams();
  if (form.minRating > RATING_SLIDER_MIN) {
    sp.set("min_rating", String(form.minRating));
  }
  if (form.maxRating < RATING_SLIDER_MAX) {
    sp.set("max_rating", String(form.maxRating));
  }
  if (form.onlyWithoutGooglePlace) {
    sp.set("no_google_place_only", "true");
  }

  if (partnerOptions.length > 0) {
    const allPartners =
      selectedPartners.size === 0 ||
      selectedPartners.size === partnerOptions.length;
    if (!allPartners) {
      [...selectedPartners]
        .sort((a, b) => a - b)
        .forEach((id) => {
          sp.append("partner_id", String(id));
        });
    }
  }

  return sp.toString();
}

export function uniquePartnerIdsFromPoints(
  points: { partner_id?: number | string | null }[]
): number[] {
  const s = new Set<number>();
  for (const p of points) {
    const v = p.partner_id;
    if (v == null) {
      continue;
    }
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) {
      s.add(n);
    }
  }
  return [...s].sort((a, b) => a - b);
}
