"use client";

import { markerSvgSrc } from "@/lib/markerSvgSrc";
import { INPOST_STATUS_DOT_CLASS } from "@/components/inpostStatusDot";

import {
  areMapFiltersActive,
  formatReviewTimeFilterSummary,
  patchToggleInpostStatusFilter,
  partnerLocationTypeFilterLabel,
  RATING_SLIDER_MAX,
  RATING_SLIDER_MIN,
  RATING_SLIDER_STEP,
  REVIEW_TIME_KNOT_LABELS,
  REVIEW_TIME_MAX_KNOT_INDEX,
  type MapFiltersForm,
} from "./mapFiltersQuery";

type MapFiltersPanelProps = {
  form: MapFiltersForm;
  onFormChange: (patch: Partial<MapFiltersForm>) => void;
  onResetFilters: () => void;
  partnerOptions: number[];
  selectedPartners: Set<number>;
  onPartnerToggle: (id: number) => void;
};

function pctAlong(v: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }
  return ((v - min) / (max - min)) * 100;
}

function clampReviewKnotIdx(n: number): number {
  return Math.max(
    0,
    Math.min(REVIEW_TIME_MAX_KNOT_INDEX, Math.round(Number(n)))
  );
}

export function MapFiltersPanel({
  form,
  onFormChange,
  onResetFilters,
  partnerOptions,
  selectedPartners,
  onPartnerToggle,
}: MapFiltersPanelProps) {
  const minLabel = form.minRating.toFixed(1);
  const maxLabel = form.maxRating.toFixed(1);
  const leftPct = pctAlong(form.minRating, RATING_SLIDER_MIN, RATING_SLIDER_MAX);
  const rightPct = pctAlong(form.maxRating, RATING_SLIDER_MIN, RATING_SLIDER_MAX);
  const fillPct = Math.max(0, rightPct - leftPct);

  const ratingSummary =
    form.minRating === RATING_SLIDER_MIN &&
      form.maxRating === RATING_SLIDER_MAX
      ? "Any rating"
      : `${minLabel} – ${maxLabel} ★`;

  const reviewTimeVisualNewer = REVIEW_TIME_MAX_KNOT_INDEX - form.reviewTimeMaxIdx;
  const reviewTimeVisualOlder = REVIEW_TIME_MAX_KNOT_INDEX - form.reviewTimeMinIdx;
  const reviewTimeLeftPct = pctAlong(
    reviewTimeVisualNewer,
    0,
    REVIEW_TIME_MAX_KNOT_INDEX
  );
  const reviewTimeRightPct = pctAlong(
    reviewTimeVisualOlder,
    0,
    REVIEW_TIME_MAX_KNOT_INDEX
  );
  const reviewTimeFillPct = Math.max(0, reviewTimeRightPct - reviewTimeLeftPct);
  const reviewTimeSummary = formatReviewTimeFilterSummary(form);
  const reviewTimeKnotLabelsNewestFirst = [...REVIEW_TIME_KNOT_LABELS].reverse();
  const filtersActive = areMapFiltersActive(
    form,
    partnerOptions,
    selectedPartners
  );

  return (
    <div className="w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-white/15 bg-neutral-950/95 text-neutral-100 shadow-xl backdrop-blur">
      <details className="group/filtersDrawer">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-lg font-medium tracking-tight outline-none marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="inline-flex w-full items-center justify-between gap-2">
            <span>Filters</span>
            <span className="text-neutral-500 transition-transform group-open/filtersDrawer:rotate-180">▾</span>
          </span>
        </summary>
        <div className="border-t border-white/10 px-3 pb-3 pt-2 text-sm leading-snug">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              InPost status
            </legend>
            <ul className="flex flex-row flex-wrap justify-center gap-2">
              <li>
                <button
                  type="button"
                  aria-pressed={form.includeInpostStatusOperating}
                  title="Include Operating locations"
                  onClick={() => {
                    const p = patchToggleInpostStatusFilter(
                      form,
                      "includeInpostStatusOperating"
                    );
                    if (p) {
                      onFormChange(p);
                    }
                  }}
                  className={`flex items-center gap-2.5 overflow-visible rounded-md border px-2 py-2 text-left text-neutral-200 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${form.includeInpostStatusOperating
                    ? "border-amber-500/50 bg-neutral-800/90 shadow-sm ring-1 ring-amber-500/30"
                    : "border-white/10 bg-neutral-950/80 opacity-45 hover:border-white/20 hover:opacity-90"
                    }`}
                >
                  <span
                    className={INPOST_STATUS_DOT_CLASS.operating}
                    aria-hidden
                  />
                  <span className="leading-snug">Operating</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  aria-pressed={form.includeInpostStatusCreated}
                  title="Include Created locations"
                  onClick={() => {
                    const p = patchToggleInpostStatusFilter(
                      form,
                      "includeInpostStatusCreated"
                    );
                    if (p) {
                      onFormChange(p);
                    }
                  }}
                  className={`flex items-center gap-2.5 overflow-visible rounded-md border px-2 py-2 text-left text-neutral-200 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${form.includeInpostStatusCreated
                    ? "border-amber-500/50 bg-neutral-800/90 shadow-sm ring-1 ring-amber-500/30"
                    : "border-white/10 bg-neutral-950/80 opacity-45 hover:border-white/20 hover:opacity-90"
                    }`}
                >
                  <span
                    className={INPOST_STATUS_DOT_CLASS.created}
                    aria-hidden
                  />
                  <span className="leading-snug">Created</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  aria-pressed={form.includeInpostStatusDisabled}
                  onClick={() => {
                    const p = patchToggleInpostStatusFilter(
                      form,
                      "includeInpostStatusDisabled"
                    );
                    if (p) {
                      onFormChange(p);
                    }
                  }}
                  className={`group/disabledSt relative flex max-w-full items-center gap-2.5 overflow-visible rounded-md border px-2 py-2 text-left text-neutral-200 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${form.includeInpostStatusDisabled
                    ? "border-amber-500/50 bg-neutral-800/90 shadow-sm ring-1 ring-amber-500/30"
                    : "border-white/10 bg-neutral-950/80 opacity-45 hover:border-white/20 hover:opacity-90"
                    }`}
                >
                  <span
                    className={INPOST_STATUS_DOT_CLASS.disabled}
                    aria-hidden
                  />
                  <span className="leading-snug">Disabled / Non-operating</span>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 w-max max-w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 rounded border border-white/10 bg-neutral-900/98 px-2 py-1.5 text-xs font-normal leading-snug text-neutral-300 opacity-0 shadow-lg transition-opacity group-hover/disabledSt:opacity-100"
                  >
                    Includes unknown statuses, or missing on the point
                  </span>
                </button>
              </li>
            </ul>
          </fieldset>
          {partnerOptions.length > 0 && (
            <fieldset className="mt-4">
              <legend className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Location type
              </legend>
              <ul className="flex max-h-40 flex-wrap justify-center gap-2 overflow-y-auto rounded border border-white/10 bg-neutral-900/80 p-2">
                {partnerOptions.map((id) => {
                  const active =
                    selectedPartners.size === 0 || selectedPartners.has(id);
                  const label = partnerLocationTypeFilterLabel(id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        title={label}
                        onClick={() => onPartnerToggle(id)}
                        className={`rounded-lg border p-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${active
                          ? "border-amber-500/50 bg-neutral-800/90 shadow-sm ring-1 ring-amber-500/30"
                          : "border-white/10 bg-neutral-950/80 opacity-45 hover:border-white/20 hover:opacity-90"
                          }`}
                      >
                        <span className="sr-only">{label}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element -- public SVG marker */}
                        <img
                          src={markerSvgSrc(id)}
                          alt=""
                          width={36}
                          height={36}
                          draggable={false}
                          className="pointer-events-none block h-9 w-9 object-contain object-bottom"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}
          <fieldset>
            <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Google rating
            </legend>
            <p className="mb-3 text-neutral-400" aria-live="polite">
              <span className="tabular-nums text-neutral-200">{ratingSummary}</span>
            </p>
            <div className="dual-rating-range relative h-9 w-full pb-4">
              {/* Track */}
              <div
                className="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-neutral-700"
                aria-hidden
              />
              {/* Active span */}
              <div
                className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-amber-500/85"
                style={{
                  left: `${leftPct}%`,
                  width: `${fillPct}%`,
                }}
                aria-hidden
              />
              {/* Scale labels */}
              <div className="pointer-events-none absolute bottom-[-16px] left-0 right-0 flex justify-between px-px text-sm font-medium text-neutral-400">
                <span>1 Star</span>
                <span>5 Stars</span>
              </div>
              {/* Min thumb */}
              <input
                type="range"
                aria-label="Minimum Google rating"
                min={RATING_SLIDER_MIN}
                max={RATING_SLIDER_MAX}
                step={RATING_SLIDER_STEP}
                value={form.minRating}
                className="absolute left-0 right-0 top-0 z-[3] h-9 cursor-pointer"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onFormChange({
                    minRating: v,
                    maxRating: Math.max(v, form.maxRating),
                  });
                }}
              />
              {/* Max thumb */}
              <input
                type="range"
                aria-label="Maximum Google rating"
                min={RATING_SLIDER_MIN}
                max={RATING_SLIDER_MAX}
                step={RATING_SLIDER_STEP}
                value={form.maxRating}
                className="absolute left-0 right-0 top-0 z-[4] h-9 cursor-pointer"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onFormChange({
                    maxRating: v,
                    minRating: Math.min(v, form.minRating),
                  });
                }}
              />
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Review time
            </legend>
            <p className="mb-3 text-neutral-400" aria-live="polite">
              <span className="tabular-nums text-neutral-200">{reviewTimeSummary}</span>
            </p>
            <div className="dual-rating-range relative h-9 w-full pb-4">
              <div
                className="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-neutral-700"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-amber-500/85"
                style={{
                  left: `${reviewTimeLeftPct}%`,
                  width: `${reviewTimeFillPct}%`,
                }}
                aria-hidden
              />
              <div className="pointer-events-none absolute bottom-[-16px] left-0 right-0 flex justify-between px-px text-sm font-medium text-neutral-400">
                {reviewTimeKnotLabelsNewestFirst.map((label) => (
                  <span key={label} className="min-w-0 flex-1 text-center">
                    {label}
                  </span>
                ))}
              </div>
              <input
                type="range"
                aria-label="Newer review time bound"
                min={0}
                max={REVIEW_TIME_MAX_KNOT_INDEX}
                step={1}
                value={reviewTimeVisualNewer}
                className="absolute left-0 right-0 top-0 z-[3] h-9 cursor-pointer"
                onChange={(e) => {
                  const Lv = clampReviewKnotIdx(Number(e.target.value));
                  const newMaxIdx = REVIEW_TIME_MAX_KNOT_INDEX - Lv;
                  onFormChange({
                    reviewTimeMaxIdx: newMaxIdx,
                    reviewTimeMinIdx: Math.min(form.reviewTimeMinIdx, newMaxIdx),
                  });
                }}
              />
              <input
                type="range"
                aria-label="Older review time bound"
                min={0}
                max={REVIEW_TIME_MAX_KNOT_INDEX}
                step={1}
                value={reviewTimeVisualOlder}
                className="absolute left-0 right-0 top-0 z-[4] h-9 cursor-pointer"
                onChange={(e) => {
                  const Rv = clampReviewKnotIdx(Number(e.target.value));
                  const newMinIdx = REVIEW_TIME_MAX_KNOT_INDEX - Rv;
                  onFormChange({
                    reviewTimeMinIdx: newMinIdx,
                    reviewTimeMaxIdx: Math.max(form.reviewTimeMaxIdx, newMinIdx),
                  });
                }}
              />
            </div>
          </fieldset>

          <fieldset className="mt-4">
            <legend className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Google Maps Proximity
            </legend>
            <label className="flex cursor-pointer items-start gap-2.5 text-neutral-300">
              <input
                type="checkbox"
                checked={form.onlyWithoutGooglePlace}
                onChange={(e) =>
                  onFormChange({ onlyWithoutGooglePlace: e.target.checked })
                }
                className="mt-0.5 rounded border-white/30 bg-neutral-900 text-amber-500 focus:ring-amber-500/40"
              />
              <span className="leading-snug">
                Locations with no Google entry found within a 50m radius
              </span>
            </label>
          </fieldset>

          <div className="-mx-3 mt-4 border-t border-white/10 px-3 pb-3 pt-3">
            <button
              type="button"
              disabled={!filtersActive}
              onClick={onResetFilters}
              className="w-full rounded-md border border-white/15 bg-neutral-800/90 py-2.5 text-sm font-medium text-neutral-200 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 enabled:hover:border-amber-500/35 enabled:hover:bg-neutral-800 disabled:cursor-not-allowed disabled:border-white/10 disabled:opacity-40 disabled:hover:bg-neutral-800/90"
            >
              Reset
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
