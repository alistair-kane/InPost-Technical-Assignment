import {
  PACZKOPUNKT_PARTNER_IDS,
  PACZKOPUNKT_UI_PARTNER_ID,
} from "@/lib/paczkopunktPartnerIds";
import type { GoogleReviewSnippet } from "@/types/mapPoint";

export { PACZKOPUNKT_PARTNER_IDS, PACZKOPUNKT_UI_PARTNER_ID };

/** Slider low end (1 star). Default = no `min_rating` query param. */
export const RATING_SLIDER_MIN = 1;
/** Slider high end (5 stars). Default = no `max_rating` query param. */
export const RATING_SLIDER_MAX = 5;
export const RATING_SLIDER_STEP = 0.5;

/**
 * Checkbox copy + map cap on `distance_to_google_place_m` (1–50 m).
 * Omitted from the query only when 'show only no Google place' is enabled
 * (slider disabled).
 */
export const GOOGLE_MAPS_PROXIMITY_RADIUS_M_MIN = 1;
export const GOOGLE_MAPS_PROXIMITY_RADIUS_M_MAX = 50;

export const DAY_SEC = 86_400;
/** Mean Gregorian year in seconds (for 12y / 3y / 1y knots). */
export const YEAR_SEC = 365.25 * DAY_SEC;

/** Oldest knot index: no `min_review_time` (include reviews 12y+ / unbounded past). */
export const REVIEW_TIME_OLDEST_KNOT_INDEX = 0;

/** Piecewise review-time knots: index 0 = oldest (12y+), 6 = 1d (newest labeled). */
export const REVIEW_TIME_MAX_KNOT_INDEX = 6;

/** Label for the oldest knot (unbounded lookback on the past side). */
export const REVIEW_TIME_OLDEST_KNOT_LABEL = "12y+";

/** Short labels under the stepped slider (oldest → newest). */
export const REVIEW_TIME_KNOT_LABELS: readonly string[] = [
  REVIEW_TIME_OLDEST_KNOT_LABEL,
  "3y",
  "1y",
  "90d",
  "30d",
  "7d",
  "1d",
];

const _paczkopunktSet = new Set<number>(PACZKOPUNKT_PARTNER_IDS);

/** Collapse paczkopunkt partner ids into a single option for the filters panel. */
export function mergePartnerIdsForUi(partnerIds: number[]): number[] {
  const unique = [...new Set(partnerIds)].filter((n) => Number.isFinite(n));
  let hasPaczkopunkt = false;
  const rest: number[] = [];
  for (const id of unique.sort((a, b) => a - b)) {
    if (_paczkopunktSet.has(id)) {
      hasPaczkopunkt = true;
    } else {
      rest.push(id);
    }
  }
  if (!hasPaczkopunkt) {
    return rest;
  }
  return [...rest, PACZKOPUNKT_UI_PARTNER_ID].sort((a, b) => a - b);
}

/** Maps a UI filter partner id to API `partner_id` query values. */
export function partnerQueryIdsForUiId(uiPartnerId: number): readonly number[] {
  if (uiPartnerId === PACZKOPUNKT_UI_PARTNER_ID) {
    return PACZKOPUNKT_PARTNER_IDS;
  }
  return [uiPartnerId];
}

export function partnerLocationTypeFilterLabel(uiPartnerId: number): string {
  if (uiPartnerId === PACZKOPUNKT_UI_PARTNER_ID) {
    return "Paczkopunkt";
  }
  return "Paczkomat";
}

/**
 * After `partnerOptions` is merged for UI, remap legacy `selectedPartners` entries
 * (e.g. `33` alone) onto the canonical chip id and drop selections no longer listed.
 */
export function normalizeSelectedPartnersForUi(
  selected: Set<number>,
  partnerOptions: number[]
): Set<number> {
  if (selected.size === 0) {
    return selected;
  }
  const allowed = new Set(partnerOptions);
  const next = new Set<number>();
  for (const id of selected) {
    const ui =
      _paczkopunktSet.has(id) && allowed.has(PACZKOPUNKT_UI_PARTNER_ID)
        ? PACZKOPUNKT_UI_PARTNER_ID
        : id;
    if (allowed.has(ui)) {
      next.add(ui);
    }
  }
  const sig = (s: Set<number>) =>
    [...s].sort((a, b) => a - b).join(",");
  if (sig(next) === sig(selected)) {
    return selected;
  }
  return next;
}

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

export type ReviewTimeUnixBounds = {
  /** Omitted from API when null (`12y+` / oldest knot — no floor on review age). */
  minUnix: number | null;
  /** When `maxIdx === REVIEW_TIME_MAX_KNOT_INDEX`, `maxUnix` is `nowSec` (include up to present). */
  maxUnix: number;
};

/**
 * Inclusive `[minUnix, maxUnix]` for review-time filtering.
 * `minIdx === REVIEW_TIME_OLDEST_KNOT_INDEX` → `minUnix: null` (12y+).
 */
export function knotIndicesToUnixBounds(
  nowSec: number,
  minIdx: number,
  maxIdx: number
): ReviewTimeUnixBounds {
  const minUnix =
    minIdx === REVIEW_TIME_OLDEST_KNOT_INDEX
      ? null
      : reviewTimeKnotUnix(nowSec, minIdx);
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

export function isDefaultRatingRange(
  minRating: number,
  maxRating: number
): boolean {
  return minRating <= RATING_SLIDER_MIN && maxRating >= RATING_SLIDER_MAX;
}

/** Rating and review-time filters that apply per review in the detail panel. */
export function areGoogleReviewFiltersActive(form: MapFiltersForm): boolean {
  return (
    !isDefaultRatingRange(form.minRating, form.maxRating) ||
    !isDefaultReviewTimeRange(form.reviewTimeMinIdx, form.reviewTimeMaxIdx)
  );
}

function reviewMatchesGoogleFilters(
  review: GoogleReviewSnippet,
  form: MapFiltersForm,
  nowSec: number
): boolean {
  if (!isDefaultRatingRange(form.minRating, form.maxRating)) {
    const r = review.rating;
    if (typeof r !== "number" || !Number.isFinite(r)) {
      return false;
    }
    if (form.minRating > RATING_SLIDER_MIN && r < form.minRating) {
      return false;
    }
    if (form.maxRating < RATING_SLIDER_MAX && r > form.maxRating) {
      return false;
    }
  }
  if (!isDefaultReviewTimeRange(form.reviewTimeMinIdx, form.reviewTimeMaxIdx)) {
    const t = review.time_unix;
    if (typeof t !== "number" || !Number.isFinite(t)) {
      return false;
    }
    const { minUnix, maxUnix } = knotIndicesToUnixBounds(
      nowSec,
      form.reviewTimeMinIdx,
      form.reviewTimeMaxIdx
    );
    if (minUnix != null && t < minUnix) {
      return false;
    }
    if (t > maxUnix) {
      return false;
    }
  }
  return true;
}

/** Client-side filter for detail-panel review list (matches map query rating/time bounds). */
export function filterGoogleReviewsForMapFilters(
  reviews: GoogleReviewSnippet[],
  form: MapFiltersForm,
  nowSec = Math.floor(Date.now() / 1000)
): GoogleReviewSnippet[] {
  if (!areGoogleReviewFiltersActive(form)) {
    return reviews;
  }
  return reviews.filter((r) => reviewMatchesGoogleFilters(r, form, nowSec));
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

/** Label for the newer (left / maxIdx) end of the review-time window. */
function formatReviewTimeNewerBoundLabel(
  maxUnix: number,
  now: Date
): string {
  return formatReviewSummaryDate(new Date(maxUnix * 1000), now);
}

/** Label for the older (right / minIdx) end of the review-time window. */
function formatReviewTimeOlderBoundLabel(
  minUnix: number | null,
  now: Date
): string {
  if (minUnix == null) {
    return REVIEW_TIME_OLDEST_KNOT_LABEL;
  }
  return formatReviewSummaryDate(new Date(minUnix * 1000), now);
}

/**
 * Human-readable range for the filter summary (newer → older, same order as the
 * slider labels: 1d … 12y+ left to right).
 */
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
  const newerLabel = formatReviewTimeNewerBoundLabel(maxUnix, now);
  const olderLabel = formatReviewTimeOlderBoundLabel(minUnix, now);
  return `${newerLabel} – ${olderLabel}`;
}

function clampGoogleMapsProximityRadiusM(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) {
    return GOOGLE_MAPS_PROXIMITY_RADIUS_M_MAX;
  }
  return Math.max(
    GOOGLE_MAPS_PROXIMITY_RADIUS_M_MIN,
    Math.min(GOOGLE_MAPS_PROXIMITY_RADIUS_M_MAX, v)
  );
}

export type MapFiltersForm = {
  minRating: number;
  maxRating: number;
  /**
   * Sent as `max_distance_to_google_place_m` unless 'show only no Google place'
   * is checked (slider disabled). Backend includes unresolved Google rows as well
   * as rows with `distance_to_google_place_m` ≤ this value.
   */
  googleMapsProximityRadiusM: number;
  /**
   * When true, map shows only points with no resolved Google place (checkbox copy
   * refers to a 50 m radius; API uses missing `google_place_id`).
   */
  onlyWithoutGooglePlace: boolean;
  reviewTimeMinIdx: number;
  reviewTimeMaxIdx: number;
  /** Default first-load / Reset: Operating only (Created + Disabled off). */
  includeInpostStatusOperating: boolean;
  includeInpostStatusCreated: boolean;
  includeInpostStatusDisabled: boolean;
};

/** InPost `status` on the Mongo document (normalized for API query params). */
export type InpostStatusFilterBucket = "operating" | "created" | "disabled";

export const ALL_INPOST_STATUS_BUCKETS: readonly InpostStatusFilterBucket[] = [
  "operating",
  "created",
  "disabled",
];

export function inpostStatusBucketsForQuery(
  form: MapFiltersForm
): InpostStatusFilterBucket[] | null {
  const on: InpostStatusFilterBucket[] = [];
  if (form.includeInpostStatusOperating) {
    on.push("operating");
  }
  if (form.includeInpostStatusCreated) {
    on.push("created");
  }
  if (form.includeInpostStatusDisabled) {
    on.push("disabled");
  }
  /* All three on => omit param (no status restriction). */
  if (on.length === ALL_INPOST_STATUS_BUCKETS.length) {
    return null;
  }
  return on;
}

export function patchToggleInpostStatusFilter(
  form: MapFiltersForm,
  key:
    | "includeInpostStatusOperating"
    | "includeInpostStatusCreated"
    | "includeInpostStatusDisabled"
): Partial<MapFiltersForm> | null {
  const keys = [
    "includeInpostStatusOperating",
    "includeInpostStatusCreated",
    "includeInpostStatusDisabled",
  ] as const;
  const countTrue = keys.filter((k) => form[k]).length;
  if (form[key] && countTrue <= 1) {
    return null;
  }
  return { [key]: !form[key] };
}

export const emptyMapFiltersForm = (): MapFiltersForm => ({
  minRating: RATING_SLIDER_MIN,
  maxRating: RATING_SLIDER_MAX,
  googleMapsProximityRadiusM: GOOGLE_MAPS_PROXIMITY_RADIUS_M_MAX,
  onlyWithoutGooglePlace: false,
  reviewTimeMinIdx: 0,
  reviewTimeMaxIdx: REVIEW_TIME_MAX_KNOT_INDEX,
  includeInpostStatusOperating: true,
  includeInpostStatusCreated: false,
  includeInpostStatusDisabled: false,
});

/** Ensures every `MapFiltersForm` field is defined (fixes HMR / partial state). */
export function coalesceMapFiltersForm(
  partial: Partial<MapFiltersForm> | MapFiltersForm
): MapFiltersForm {
  const d = emptyMapFiltersForm();
  return {
    minRating: partial.minRating ?? d.minRating,
    maxRating: partial.maxRating ?? d.maxRating,
    googleMapsProximityRadiusM: clampGoogleMapsProximityRadiusM(
      partial.googleMapsProximityRadiusM ?? d.googleMapsProximityRadiusM
    ),
    onlyWithoutGooglePlace:
      partial.onlyWithoutGooglePlace ?? d.onlyWithoutGooglePlace,
    reviewTimeMinIdx: partial.reviewTimeMinIdx ?? d.reviewTimeMinIdx,
    reviewTimeMaxIdx: partial.reviewTimeMaxIdx ?? d.reviewTimeMaxIdx,
    includeInpostStatusOperating:
      partial.includeInpostStatusOperating ?? d.includeInpostStatusOperating,
    includeInpostStatusCreated:
      partial.includeInpostStatusCreated ?? d.includeInpostStatusCreated,
    includeInpostStatusDisabled:
      partial.includeInpostStatusDisabled ?? d.includeInpostStatusDisabled,
  };
}

/** First-load / Reset baseline: show Operating points only. */
export function isDefaultInpostStatusSelection(form: MapFiltersForm): boolean {
  return (
    form.includeInpostStatusOperating === true &&
    form.includeInpostStatusCreated === false &&
    form.includeInpostStatusDisabled === false
  );
}

/** True when any map query filter differs from defaults (rating, time, proximity, partner subset, InPost status). */
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
  if (form.googleMapsProximityRadiusM < GOOGLE_MAPS_PROXIMITY_RADIUS_M_MAX) {
    return true;
  }
  if (!isDefaultReviewTimeRange(form.reviewTimeMinIdx, form.reviewTimeMaxIdx)) {
    return true;
  }
  if (partnerOptions.length > 0) {
    if (selectedPartners.size > 0) {
      return true;
    }
  }
  if (!isDefaultInpostStatusSelection(form)) {
    return true;
  }
  return false;
}

/** Query string for default filters with no partner subset (spotlight baseline). */
export function baselineMapPointsQueryString(partnerOptions: number[]): string {
  return buildMapPointsQueryString(
    emptyMapFiltersForm(),
    partnerOptions,
    new Set()
  );
}

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
  } else {
    sp.set(
      "max_distance_to_google_place_m",
      String(form.googleMapsProximityRadiusM)
    );
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
    if (minUnix != null) {
      sp.set("min_review_time", String(minUnix));
    }
    sp.set("max_review_time", String(maxUnix));
  }

  if (partnerOptions.length > 0 && selectedPartners.size > 0) {
    const seen = new Set<string>();
    for (const id of [...selectedPartners].sort((a, b) => a - b)) {
      for (const qid of partnerQueryIdsForUiId(id)) {
        const key = String(qid);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        sp.append("partner_id", key);
      }
    }
  }

  const statusBuckets = inpostStatusBucketsForQuery(form);
  if (statusBuckets && statusBuckets.length > 0) {
    for (const b of statusBuckets) {
      sp.append("inpost_status", b);
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
  return mergePartnerIdsForUi([...s]);
}
