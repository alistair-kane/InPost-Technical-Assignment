import type { GoogleReviewSnippet, MapPoint } from "@/types/mapPoint";

export type SpotlightPresetId =
  | "longest_review"
  | "most_reviews"
  | "most_controversial"
  | "highest_rated"
  | "lowest_rated"
  | "newest_review"
  | "oldest_review";

export const SPOTLIGHT_PRESET_ORDER: SpotlightPresetId[] = [
  "longest_review",
  "most_reviews",
  "highest_rated",
  "lowest_rated",
  "most_controversial",
  "newest_review",
  "oldest_review",
];

export const SPOTLIGHT_PRESET_LABELS: Record<SpotlightPresetId, string> = {
  longest_review: "Longest review",
  most_reviews: "Most reviews",
  most_controversial: "Most controversial",
  highest_rated: "Highest rated",
  lowest_rated: "Lowest rated",
  newest_review: "Newest review",
  oldest_review: "Oldest review",
};

export const SPOTLIGHT_PRESET_TOOLTIPS: Record<SpotlightPresetId, string> = {
  longest_review: "Point with the longest rating text currently in view",
  most_reviews: "Point with the most ratings currently in view",
  most_controversial: "Point with the highest variance in ratings currently in view",
  highest_rated: "Point with the highest rating currently in view",
  lowest_rated: "Point with the lowest rating currently in view",
  newest_review: "Point with the most recent rating currently in view",
  oldest_review: "Point with the oldest rating currently in view",
};

/** Public URL paths for spotlight row icons (`apps/web/public/spotlight/*.svg`). */
export const SPOTLIGHT_ICON_SRC: Record<SpotlightPresetId, string> = {
  longest_review: "/spotlight/longest-review.svg",
  most_reviews: "/spotlight/most-reviews.svg",
  most_controversial: "/spotlight/most-controversial.svg",
  highest_rated: "/spotlight/highest-rated.svg",
  lowest_rated: "/spotlight/lowest-rated.svg",
  newest_review: "/spotlight/newest-review.svg",
  oldest_review: "/spotlight/oldest-review.svg",
};

/** Spotlights that highlight a single review in the location detail panel. */
export const SPOTLIGHT_REVIEW_FOCUS_PRESETS: ReadonlySet<SpotlightPresetId> =
  new Set(["longest_review", "newest_review", "oldest_review"]);

export function spotlightFocusesReview(preset: SpotlightPresetId): boolean {
  return SPOTLIGHT_REVIEW_FOCUS_PRESETS.has(preset);
}

export const SPOTLIGHT_EMPTY_HINTS: Record<SpotlightPresetId, string> = {
  longest_review: "No review text in the current results.",
  most_reviews: "No review counts in the current results.",
  most_controversial:
    "Need at least two star ratings in review snippets in the current results.",
  highest_rated: "No Google ratings in the current results.",
  lowest_rated: "No Google ratings in the current results.",
  newest_review: "No review timestamps in the current results.",
  oldest_review: "No review timestamps in the current results.",
};

function maxReviewTextLengthScalar(p: MapPoint): number {
  const n = p.review_snippet_max_text_len;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Stable ordering when scores tie (deterministic winner). */
function pointSortKey(p: MapPoint): string {
  const id = p.inpost_point_id ?? "";
  return `${id}\t${p.latitude}\t${p.longitude}`;
}

function betterKey(a: MapPoint, b: MapPoint, preferLower: boolean): MapPoint {
  const ka = pointSortKey(a);
  const kb = pointSortKey(b);
  if (preferLower) {
    return ka < kb ? a : b;
  }
  return ka < kb ? a : b;
}

function ratingNum(p: MapPoint): number | null {
  const r = p.google_rating;
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) {
    return null;
  }
  return r;
}

function reviewTotalNum(p: MapPoint): number {
  const t = p.google_user_ratings_total;
  if (typeof t !== "number" || !Number.isFinite(t)) {
    return 0;
  }
  return t;
}

/**
 * Precomputed from ingest (``scripts/point_utils.compute_review_spotlight_summaries``):
 * spread/variance/count over per-review stars in ``[1, 5]``; null metrics when ineligible.
 */
function controversyMetricsScalar(
  p: MapPoint
): { spread: number; variance: number; count: number } | null {
  const count = p.review_snippet_star_count ?? 0;
  if (count < 2) {
    return null;
  }
  const spread = p.review_snippet_star_spread;
  const variance = p.review_snippet_star_variance;
  if (typeof spread !== "number" || !Number.isFinite(spread)) {
    return null;
  }
  if (typeof variance !== "number" || !Number.isFinite(variance)) {
    return null;
  }
  return { spread, variance, count };
}

function newestReviewUnixScalar(p: MapPoint): number | null {
  const t = p.google_reviews_time_unix_max;
  if (typeof t !== "number" || !Number.isFinite(t)) {
    return null;
  }
  return t;
}

function oldestReviewUnixScalar(p: MapPoint): number | null {
  const t = p.google_reviews_time_unix_min;
  if (typeof t !== "number" || !Number.isFinite(t)) {
    return null;
  }
  return t;
}

function controversyCmp(
  m: { spread: number; variance: number; count: number },
  bestM: { spread: number; variance: number; count: number }
): number {
  if (m.spread !== bestM.spread) {
    return m.spread > bestM.spread ? 1 : -1;
  }
  if (m.variance !== bestM.variance) {
    return m.variance > bestM.variance ? 1 : -1;
  }
  if (m.count !== bestM.count) {
    return m.count > bestM.count ? 1 : -1;
  }
  return 0;
}

export function pickSpotlightPoint(
  points: MapPoint[],
  preset: SpotlightPresetId
): MapPoint | null {
  if (points.length === 0) {
    return null;
  }

  switch (preset) {
    case "longest_review": {
      let best: MapPoint | null = null;
      let bestLen = -1;
      for (const p of points) {
        const len = maxReviewTextLengthScalar(p);
        if (len <= 0) {
          continue;
        }
        if (len > bestLen) {
          bestLen = len;
          best = p;
        } else if (len === bestLen && best) {
          best = betterKey(p, best, true);
        }
      }
      return best;
    }
    case "most_reviews": {
      let best: MapPoint | null = null;
      let bestTotal = -1;
      for (const p of points) {
        const n = reviewTotalNum(p);
        if (n > bestTotal) {
          bestTotal = n;
          best = p;
        } else if (n === bestTotal && best) {
          best = betterKey(p, best, true);
        }
      }
      if (bestTotal <= 0) {
        return null;
      }
      return best;
    }
    case "most_controversial": {
      let best: MapPoint | null = null;
      let bestM: { spread: number; variance: number; count: number } | null =
        null;
      for (const p of points) {
        const m = controversyMetricsScalar(p);
        if (m == null) {
          continue;
        }
        if (bestM == null) {
          bestM = m;
          best = p;
          continue;
        }
        const cmp = controversyCmp(m, bestM);
        if (cmp > 0) {
          bestM = m;
          best = p;
        } else if (cmp === 0 && best) {
          best = betterKey(p, best, true);
        }
      }
      return best;
    }
    case "highest_rated": {
      let best: MapPoint | null = null;
      for (const p of points) {
        const r = ratingNum(p);
        if (r == null) {
          continue;
        }
        const c = reviewTotalNum(p);
        if (!best) {
          best = p;
          continue;
        }
        const br = ratingNum(best);
        const bc = reviewTotalNum(best);
        if (br == null) {
          best = p;
          continue;
        }
        if (
          r > br ||
          (r === br && c > bc) ||
          (r === br && c === bc && pointSortKey(p) < pointSortKey(best))
        ) {
          best = p;
        }
      }
      return best;
    }
    case "lowest_rated": {
      let best: MapPoint | null = null;
      for (const p of points) {
        const r = ratingNum(p);
        if (r == null) {
          continue;
        }
        const c = reviewTotalNum(p);
        if (!best) {
          best = p;
          continue;
        }
        const br = ratingNum(best);
        const bc = reviewTotalNum(best);
        if (br == null) {
          best = p;
          continue;
        }
        if (
          r < br ||
          (r === br && c > bc) ||
          (r === br && c === bc && pointSortKey(p) < pointSortKey(best))
        ) {
          best = p;
        }
      }
      return best;
    }
    case "newest_review": {
      let best: MapPoint | null = null;
      let bestT = -Infinity;
      for (const p of points) {
        const tu = newestReviewUnixScalar(p);
        if (tu == null) {
          continue;
        }
        if (tu > bestT) {
          bestT = tu;
          best = p;
        } else if (tu === bestT && best) {
          best = betterKey(p, best, true);
        }
      }
      return bestT > -Infinity ? best : null;
    }
    case "oldest_review": {
      let best: MapPoint | null = null;
      let bestT = Infinity;
      for (const p of points) {
        const tu = oldestReviewUnixScalar(p);
        if (tu == null) {
          continue;
        }
        if (tu < bestT) {
          bestT = tu;
          best = p;
        } else if (tu === bestT && best) {
          best = betterKey(p, best, true);
        }
      }
      return bestT < Infinity ? best : null;
    }
    default:
      return null;
  }
}

function reviewSnippetTextLen(r: GoogleReviewSnippet): number {
  const raw = r.text_original ?? r.text;
  if (typeof raw !== "string") {
    return 0;
  }
  return raw.trim().length;
}

function reviewSnippetTimeUnix(r: GoogleReviewSnippet): number | null {
  const t = r.time_unix;
  if (typeof t === "number" && Number.isFinite(t)) {
    return t;
  }
  return null;
}

/** Same ordering as ``LocationDetailPanel`` (newest first). */
export function sortReviewsNewestFirst(
  a: GoogleReviewSnippet,
  b: GoogleReviewSnippet
): number {
  const ta = reviewSnippetTimeUnix(a);
  const tb = reviewSnippetTimeUnix(b);
  if (ta != null && tb != null) {
    return tb - ta;
  }
  if (ta != null) {
    return -1;
  }
  if (tb != null) {
    return 1;
  }
  return 0;
}

/**
 * Index into a newest-first review list for review-focused spotlights, or null when
 * no matching review is visible.
 */
export function findSpotlightReviewIndex(
  reviews: GoogleReviewSnippet[],
  preset: SpotlightPresetId
): number | null {
  if (!spotlightFocusesReview(preset) || reviews.length === 0) {
    return null;
  }

  const sorted = [...reviews].sort(sortReviewsNewestFirst);

  switch (preset) {
    case "longest_review": {
      let bestIdx = -1;
      let bestLen = -1;
      for (let i = 0; i < sorted.length; i++) {
        const len = reviewSnippetTextLen(sorted[i]);
        if (len <= 0) {
          continue;
        }
        if (len > bestLen) {
          bestLen = len;
          bestIdx = i;
        }
      }
      return bestIdx >= 0 ? bestIdx : null;
    }
    case "newest_review": {
      let bestIdx = -1;
      let bestT = -Infinity;
      for (let i = 0; i < sorted.length; i++) {
        const t = reviewSnippetTimeUnix(sorted[i]);
        if (t == null) {
          continue;
        }
        if (t > bestT) {
          bestT = t;
          bestIdx = i;
        }
      }
      return bestIdx >= 0 ? bestIdx : null;
    }
    case "oldest_review": {
      let bestIdx = -1;
      let bestT = Infinity;
      for (let i = 0; i < sorted.length; i++) {
        const t = reviewSnippetTimeUnix(sorted[i]);
        if (t == null) {
          continue;
        }
        if (t < bestT) {
          bestT = t;
          bestIdx = i;
        }
      }
      return bestIdx >= 0 ? bestIdx : null;
    }
    default:
      return null;
  }
}

/** Precompute all spotlight winners for the current pool (used for instant UI on preset click). */
export function buildSpotlightTargetsByPreset(
  points: MapPoint[]
): Record<SpotlightPresetId, MapPoint | null> {
  const out = {} as Record<SpotlightPresetId, MapPoint | null>;
  for (const id of SPOTLIGHT_PRESET_ORDER) {
    out[id] = pickSpotlightPoint(points, id);
  }
  return out;
}
