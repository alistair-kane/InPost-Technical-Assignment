"use client";

import { forwardRef } from "react";

import { markerSvgSrc } from "@/lib/markerSvgSrc";
import { inpostDetailStatusDotClassName } from "@/components/inpostStatusDot";
import type { GoogleReviewSnippet, MapPoint } from "@/types/mapPoint";

export type InpostPointItem = Record<string, unknown> | null;

type LocationDetailPanelProps = {
  point: MapPoint;
  /** When true, Google reviews list shows a loading state (lazy fetch). */
  reviewsLoading?: boolean;
  inpostItem: InpostPointItem;
  inpostLoading: boolean;
  inpostError: string | null;
  onClose: () => void;
};

function str(v: unknown): string | null {
  if (v == null) {
    return null;
  }
  const s = String(v).trim();
  return s || null;
}

function formatList(v: unknown): string | null {
  if (Array.isArray(v)) {
    const parts = v.map((x) => str(x)).filter(Boolean) as string[];
    return parts.length ? parts.join(", ") : null;
  }
  return str(v);
}

function asGoogleReview(r: unknown): GoogleReviewSnippet | null {
  if (r && typeof r === "object") {
    return r as GoogleReviewSnippet;
  }
  return null;
}

function reviewBody(r: GoogleReviewSnippet): string | null {
  return str(r.text_original) ?? str(r.text);
}

function formatReviewRating(rating: unknown): string | null {
  if (typeof rating !== "number" || !Number.isFinite(rating) || rating <= 0) {
    return null;
  }
  return rating === Math.round(rating) ? String(Math.round(rating)) : rating.toFixed(1);
}

function reviewTimeUnix(rev: GoogleReviewSnippet): number | null {
  const t = rev.time_unix;
  if (typeof t === "number" && Number.isFinite(t)) {
    return t;
  }
  return null;
}

/** Newest first; reviews without `time_unix` follow (original order among those). */
function sortReviewsNewestFirst(a: GoogleReviewSnippet, b: GoogleReviewSnippet): number {
  const ta = reviewTimeUnix(a);
  const tb = reviewTimeUnix(b);
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

export const LocationDetailPanel = forwardRef<
  HTMLDivElement,
  LocationDetailPanelProps
>(function LocationDetailPanel(
  { point, reviewsLoading = false, inpostItem, inpostLoading, inpostError, onClose },
  ref
) {
  const title = point.name ?? point.inpost_point_id ?? "Location";
  const imageUrl = inpostItem ? str(inpostItem.image_url) : null;
  const gr = Number(point.google_rating);
  const reviewTotal = point.google_user_ratings_total;
  const reviewCount =
    typeof reviewTotal === "number" && Number.isFinite(reviewTotal)
      ? reviewTotal
      : null;
  const hasReviews = reviewCount != null && reviewCount > 0;
  const showGoogleNumericRating =
    Number.isFinite(gr) && (gr > 0 || hasReviews);
  const liveStatus = inpostItem ? str(inpostItem.status) : null;
  const statusLabel = inpostLoading
    ? "Loading…"
    : liveStatus ?? (inpostItem ? "Unknown" : "—");

  const googleReviews = (point.google_reviews ?? [])
    .map(asGoogleReview)
    .filter((x): x is GoogleReviewSnippet => x !== null)
    .sort(sortReviewsNewestFirst);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-detail-title"
      className="fixed bottom-0 left-0 top-[72px] z-30 flex w-full max-w-full flex-col border-r border-white/10 bg-neutral-950/98 text-neutral-100 shadow-2xl backdrop-blur-md md:max-w-md"
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto absolute right-2 top-2 z-40 flex h-8 w-8 items-center justify-center rounded-md bg-black/55 text-base leading-none text-neutral-100 shadow-md ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-black/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
          aria-label="Close location details"
        >
          ✕
        </button>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="relative h-[200px] max-h-[200px] w-full shrink-0 overflow-hidden bg-neutral-800">
          {inpostLoading && (
            <div className="absolute inset-0 animate-pulse bg-neutral-700/80" />
          )}
          {!inpostLoading && imageUrl && (
            /* eslint-disable-next-line @next/next/no-img-element -- remote InPost CDN */
            <img
              src={imageUrl}
              alt=""
              className="max-h-[200px] h-full w-full object-cover object-center"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          )}
          {!inpostLoading && !imageUrl && (
            <div className="flex h-[200px] max-h-[200px] items-center justify-center bg-neutral-800/90 text-sm text-neutral-500">
              No image
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2.5 border-b border-white/10 px-3 pb-3 pt-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG from /public */}
          <img
            src={markerSvgSrc(point.partner_id)}
            alt=""
            width={28}
            height={28}
            draggable={false}
            className="pointer-events-none block h-7 w-7 shrink-0 object-contain object-bottom opacity-90"
          />
          <h2
            id="location-detail-title"
            className="min-w-0 flex-1 text-base font-semibold leading-tight tracking-tight"
          >
            {title}
          </h2>
          <div
            className="flex min-w-0 max-w-[46%] shrink-0 items-center gap-1.5"
            role="status"
            aria-label={
              inpostLoading
                ? "Loading status"
                : liveStatus
                  ? `InPost status: ${liveStatus}`
                  : "InPost status unknown"
            }
            title={liveStatus ?? (inpostLoading ? "Loading…" : undefined)}
          >
            <span className="min-w-0 truncate text-right text-sm font-medium text-neutral-400">
              {statusLabel}
            </span>
            <span
              className={inpostDetailStatusDotClassName(
                inpostLoading,
                liveStatus
              )}
            />
          </div>
        </div>

        <div className="space-y-6 px-3 py-4">
          <section>
            <dl className="space-y-2 text-sm text-neutral-300">
              {point.formatted_address && (
                <div>
                  <dd className="mt-0.5 leading-snug">{point.formatted_address}</dd>
                </div>
              )}
              {inpostItem && str(inpostItem.location_description) && (
                <div>
                  <dd className="mt-0.5 leading-snug">
                    {str(inpostItem.location_description)}
                  </dd>
                </div>
              )}
              {inpostItem && str(inpostItem.opening_hours) && (
                <div>
                  <dt className="text-xs text-neutral-500">Opening hours</dt>
                  <dd className="mt-0.5">{str(inpostItem.opening_hours)}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-neutral-500">Google rating</dt>
                <dd className="mt-0.5">
                  {showGoogleNumericRating ? (
                    <>
                      {gr.toFixed(1)}
                      {reviewCount != null
                        ? ` (${reviewCount} reviews)`
                        : ""}
                    </>
                  ) : (
                    <span className="text-neutral-500">No Google ratings</span>
                  )}
                </dd>
              </div>
              {point.distance_to_google_place_m != null && (
                <div>
                  <dt className="text-xs text-neutral-500">Google place Δ</dt>
                  <dd className="mt-0.5">
                    {Math.round(point.distance_to_google_place_m)} m
                  </dd>
                </div>
              )}
              {point.google_maps_uri && (
                <div>
                  <a
                    className="font-medium text-amber-400 underline hover:text-amber-300"
                    href={point.google_maps_uri}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in Google Maps
                  </a>
                </div>
              )}
            </dl>

            <div className="mt-5 border-t border-white/10 pt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Google reviews
              </h3>
              {reviewsLoading ? (
                <p className="mt-2 text-sm text-neutral-500">Loading reviews…</p>
              ) : googleReviews.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-500">
                  No review text stored for this point.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {googleReviews.map((rev, i) => {
                    const author = str(rev.author_name) ?? "Anonymous";
                    const when = str(rev.relative_time_description);
                    const stars = formatReviewRating(rev.rating);
                    const body = reviewBody(rev);
                    return (
                      <li
                        key={`${author}-${when}-${i}`}
                        className="rounded-md border border-white/10 bg-neutral-900/50 p-3"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                          <span className="font-medium text-neutral-200">{author}</span>
                          {when && (
                            <span className="text-neutral-500">{when}</span>
                          )}
                          {stars && (
                            <span className="text-amber-400/95" title="Rating">
                              {stars}
                              <span aria-hidden="true"> ★</span>
                            </span>
                          )}
                        </div>
                        {body ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">
                            {body}
                          </p>
                        ) : (
                          <p className="mt-2 text-sm italic text-neutral-500">
                            No review text
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section>
            {inpostError && (
              <p className="text-sm text-red-400/90">{inpostError}</p>
            )}
            {!inpostError && inpostLoading && (
              <p className="text-sm text-neutral-500">Loading…</p>
            )}
            {!inpostError && !inpostLoading && !inpostItem && (
              <p className="text-sm text-neutral-500">No matching point in InPost directory.</p>
            )}
            {!inpostError && !inpostLoading && inpostItem && (
              <dl className="space-y-2 text-sm text-neutral-300">
                {formatList(inpostItem.type) && (
                  <div>
                    <dt className="text-xs text-neutral-500">Tags</dt>
                    <dd className="mt-0.5">{formatList(inpostItem.type)}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>
        </div>
      </div>
      </div>
    </div>
  );
});

