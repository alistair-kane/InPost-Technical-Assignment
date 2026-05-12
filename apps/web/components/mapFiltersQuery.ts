/** Slider low end (1 star). Default = no `min_rating` query param. */
export const RATING_SLIDER_MIN = 1;
/** Slider high end (5 stars). Default = no `max_rating` query param. */
export const RATING_SLIDER_MAX = 5;
export const RATING_SLIDER_STEP = 0.5;

export const DAY_SEC = 86_400;
/** Mean Gregorian year in seconds (for 12y / 3y / 1y knots). */
export const YEAR_SEC = 365.25 * DAY_SEC;

/** Piecewise review-time knots: index 0 = oldest (12y), 6 = 1d (newest labeled). */
export const REVIEW_TIME_MAX_KNOT_INDEX = 6;

/** Short labels under the stepped slider (oldest → newest). */
export const REVIEW_TIME_KNOT_LABELS: readonly string[] = [
  "12y",
  "3y",
  "1y",
  "90d",
  "30d",
  "7d",
  "1d",
];

/** Seconds before `nowSec` for each knot index (same order as labels). */
export function reviewTimeKnotOffsetSec(knotIdx: number): number {
  const offsets = [
    12 * YEAR_SEC,
    3 * YEAR_SEC,
    1 * YEAR_SEC,
    90 * DAY_SEC,
    30 * DAY_SEC,
    7 * DAY_SEC,
    1 * DAY_SEC,
  ];
  return offsets[knotIdx] ?? 0;
}

/** Boundary Unix time at knot `i`: `nowSec - ageOffset`. */
export function reviewTimeKnotUnix(nowSec: number, knotIdx: number): number {
  return Math.floor(nowSec - reviewTimeKnotOffsetSec(knotIdx));
}

/**
 * Inclusive `[minUnix, maxUnix]` for Mongo `google_reviews.time_unix`.
 * When `maxIdx === REVIEW_TIME_MAX_KNOT_INDEX`, `maxUnix` is `nowSec` (include up to present).
 */
export function knotIndicesToUnixBounds(
  nowSec: number,
  minIdx: number,
  maxIdx: number
): { minUnix: number; maxUnix: number } {
  const minUnix = reviewTimeKnotUnix(nowSec, minIdx);
  const maxUnix =
    maxIdx === REVIEW_TIME_MAX_KNOT_INDEX
      ? nowSec
      : reviewTimeKnotUnix(nowSec, maxIdx);
  return { minUnix, maxUnix };
}

export function isDefaultReviewTimeRange(
  minIdx: number,
  maxIdx: number
): boolean {
  return minIdx === 0 && maxIdx === REVIEW_TIME_MAX_KNOT_INDEX;
}

/** True when any map query filter differs from defaults (rating, time, proximity, partner subset). */
export function areMapFiltersActive(
  form: MapFiltersForm,
  partnerOptions: number[],
  selectedPartners: Set<number>
): boolean {
  if (
    form.minRating > RATING_SLIDER_MIN ||
    form.maxRating < RATING_SLIDER_MAX
  ) {
    return true;
  }
  if (form.onlyWithoutGooglePlace) {
    return true;
  }
  if (!isDefaultReviewTimeRange(form.reviewTimeMinIdx, form.reviewTimeMaxIdx)) {
    return true;
  }
  if (partnerOptions.length > 0) {
    const allPartners =
      selectedPartners.size === 0 ||
      selectedPartners.size === partnerOptions.length;
    if (!allPartners) {
      return true;
    }
  }
  return false;
}

function isSameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Date only; uses "Today" when the instant falls on the current local calendar day. */
function formatReviewSummaryDate(d: Date, now: Date): string {
  if (isSameLocalCalendarDay(d, now)) {
    return "Today";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(d);
}

/** Human-readable range for the filter summary line. */
export function formatReviewTimeFilterSummary(form: MapFiltersForm): string {
  if (isDefaultReviewTimeRange(form.reviewTimeMinIdx, form.reviewTimeMaxIdx)) {
    return "Any review time";
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const now = new Date(nowSec * 1000);
  const { minUnix, maxUnix } = knotIndicesToUnixBounds(
    nowSec,
    form.reviewTimeMinIdx,
    form.reviewTimeMaxIdx
  );
  const minLabel = formatReviewSummaryDate(new Date(minUnix * 1000), now);
  const maxLabel = formatReviewSummaryDate(new Date(maxUnix * 1000), now);
  return `${minLabel} – ${maxLabel}`;
}

export type MapFiltersForm = {
  minRating: number;
  maxRating: number;
  onlyWithoutGooglePlace: boolean;
  reviewTimeMinIdx: number;
  reviewTimeMaxIdx: number;
};

export const emptyMapFiltersForm = (): MapFiltersForm => ({
  minRating: RATING_SLIDER_MIN,
  maxRating: RATING_SLIDER_MAX,
  onlyWithoutGooglePlace: false,
  reviewTimeMinIdx: 0,
  reviewTimeMaxIdx: REVIEW_TIME_MAX_KNOT_INDEX,
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

  const nowSec = Math.floor(Date.now() / 1000);
  if (
    !isDefaultReviewTimeRange(form.reviewTimeMinIdx, form.reviewTimeMaxIdx)
  ) {
    const { minUnix, maxUnix } = knotIndicesToUnixBounds(
      nowSec,
      form.reviewTimeMinIdx,
      form.reviewTimeMaxIdx
    );
    sp.set("min_review_time", String(minUnix));
    sp.set("max_review_time", String(maxUnix));
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
