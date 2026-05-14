"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { markerSvgSrc } from "@/lib/markerSvgSrc";
import { INPOST_STATUS_FILTER_DOT_CLASS } from "@/components/inpostStatusDot";
import {
  MAP_FILTERS_HOST_BOTTOM_REM,
  MAP_FILTERS_HOST_TOP_REM,
  MAP_FILTERS_SUMMARY_CHROME_REM,
} from "./mapDashboard/mapDashboardConstants";

import {
  areMapFiltersActive,
  formatReviewTimeFilterSummary,
  GOOGLE_MAPS_PROXIMITY_RADIUS_M_MAX,
  GOOGLE_MAPS_PROXIMITY_RADIUS_M_MIN,
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
  const proximityRadiusPct = pctAlong(
    form.googleMapsProximityRadiusM,
    GOOGLE_MAPS_PROXIMITY_RADIUS_M_MIN,
    GOOGLE_MAPS_PROXIMITY_RADIUS_M_MAX
  );
  const filtersActive = areMapFiltersActive(
    form,
    partnerOptions,
    selectedPartners
  );

  const [filtersOpen, setFiltersOpen] = useState(true);
  const [proximityHelpOpen, setProximityHelpOpen] = useState(false);
  const proximityHelpBtnRef = useRef<HTMLButtonElement>(null);
  const proximityHelpPopoverRef = useRef<HTMLDivElement>(null);
  const [proximityHelpPopoverStyle, setProximityHelpPopoverStyle] = useState<{
    top: number;
    left: number;
    width: number;
  }>({ top: 0, left: 0, width: 260 });

  useLayoutEffect(() => {
    if (!proximityHelpOpen || !proximityHelpBtnRef.current) {
      return;
    }
    const pad = 8;
    const width = 260;
    const r = proximityHelpBtnRef.current.getBoundingClientRect();
    let left = r.left;
    left = Math.max(
      pad,
      Math.min(left, window.innerWidth - width - pad)
    );
    setProximityHelpPopoverStyle({
      top: r.bottom + pad,
      left,
      width,
    });
  }, [proximityHelpOpen]);

  useEffect(() => {
    if (!proximityHelpOpen) {
      return;
    }
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (proximityHelpBtnRef.current?.contains(t)) {
        return;
      }
      if (proximityHelpPopoverRef.current?.contains(t)) {
        return;
      }
      setProximityHelpOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProximityHelpOpen(false);
      }
    };
    const onResize = () => {
      if (!proximityHelpBtnRef.current) {
        return;
      }
      const pad = 8;
      const width = 260;
      const r = proximityHelpBtnRef.current.getBoundingClientRect();
      let left = r.left;
      left = Math.max(
        pad,
        Math.min(left, window.innerWidth - width - pad)
      );
      setProximityHelpPopoverStyle({
        top: r.bottom + pad,
        left,
        width,
      });
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [proximityHelpOpen]);

  const proximityHelpPopover =
    proximityHelpOpen &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={proximityHelpPopoverRef}
        id="proximity-help-popover"
        role="dialog"
        aria-label="Google Maps Proximity help"
        className="rounded-md border border-white/15 bg-neutral-950/98 p-3 text-xs font-normal leading-snug text-neutral-300 shadow-2xl backdrop-blur-md"
        style={{
          position: "fixed",
          zIndex: 200,
          top: proximityHelpPopoverStyle.top,
          left: proximityHelpPopoverStyle.left,
          width: proximityHelpPopoverStyle.width,
        }}
      >
        The distance between the point (from Inpost API) and the nearest Google place pin 📍
      </div>,
      document.body
    );

  return (
    <>
    <div className="flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-white/15 bg-neutral-950/95 text-neutral-100 shadow-xl backdrop-blur">
      <details
        className="group/filtersDrawer flex min-h-0 flex-col overflow-hidden"
        open={filtersOpen}
        onToggle={(e) => setFiltersOpen(e.currentTarget.open)}
      >
        <summary className="shrink-0 cursor-pointer list-none px-3 py-2.5 text-lg font-medium tracking-tight outline-none marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="inline-flex w-full items-center justify-between gap-2">
            <span>Filters</span>
            <span className="text-neutral-500 transition-transform group-open/filtersDrawer:rotate-180">▾</span>
          </span>
        </summary>
        <div
          className="overflow-y-auto overflow-x-hidden overscroll-y-contain border-t border-white/10 px-3 pb-3 pt-2 text-sm leading-snug"
          style={{
            maxHeight: `calc(100vh - ${MAP_FILTERS_HOST_TOP_REM}rem - ${MAP_FILTERS_HOST_BOTTOM_REM}rem - ${MAP_FILTERS_SUMMARY_CHROME_REM}rem)`,
          }}
        >
          <fieldset>
            <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Status
            </legend>
            <ul className="flex flex-row flex-wrap justify-center gap-1.5">
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
                  className={`flex items-center gap-2 overflow-visible rounded-md border px-1.5 py-1.5 text-left text-xs text-neutral-200 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${form.includeInpostStatusOperating
                    ? "border-amber-500/50 bg-neutral-800/90 shadow-sm ring-1 ring-amber-500/30"
                    : "border-white/10 bg-neutral-950/80 opacity-45 hover:border-white/20 hover:opacity-90"
                    }`}
                >
                  <span
                    className={INPOST_STATUS_FILTER_DOT_CLASS.operating}
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
                  className={`flex items-center gap-2 overflow-visible rounded-md border px-1.5 py-1.5 text-left text-xs text-neutral-200 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${form.includeInpostStatusCreated
                    ? "border-amber-500/50 bg-neutral-800/90 shadow-sm ring-1 ring-amber-500/30"
                    : "border-white/10 bg-neutral-950/80 opacity-45 hover:border-white/20 hover:opacity-90"
                    }`}
                >
                  <span
                    className={INPOST_STATUS_FILTER_DOT_CLASS.created}
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
                  className={`group/disabledSt relative flex max-w-full items-center gap-2 overflow-visible rounded-md border px-1.5 py-1.5 text-left text-xs text-neutral-200 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${form.includeInpostStatusDisabled
                    ? "border-amber-500/50 bg-neutral-800/90 shadow-sm ring-1 ring-amber-500/30"
                    : "border-white/10 bg-neutral-950/80 opacity-45 hover:border-white/20 hover:opacity-90"
                    }`}
                >
                  <span
                    className={INPOST_STATUS_FILTER_DOT_CLASS.disabled}
                    aria-hidden
                  />
                  <span className="leading-snug">Disabled</span>
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
                        aria-label={label}
                        title={label}
                        onClick={() => onPartnerToggle(id)}
                        className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${active
                          ? "border-amber-500/50 bg-neutral-800/90 shadow-sm ring-1 ring-amber-500/30"
                          : "border-white/10 bg-neutral-950/80 opacity-45 hover:border-white/20 hover:opacity-90"
                          }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- public SVG marker */}
                        <img
                          src={markerSvgSrc(id)}
                          alt=""
                          width={36}
                          height={36}
                          draggable={false}
                          className="pointer-events-none block h-9 w-9 object-contain object-bottom"
                        />
                        <span className="max-w-[5.5rem] text-center text-[11px] font-medium leading-tight text-neutral-300">
                          {label}
                        </span>
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

          <fieldset className="mt-5">
            <legend className="mb-3 flex w-full min-w-0 items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              <span className="min-w-0">Google Maps Proximity</span>
              <button
                ref={proximityHelpBtnRef}
                type="button"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/20 bg-neutral-800/80 text-[11px] font-semibold leading-none text-neutral-400 transition hover:border-amber-500/40 hover:text-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 normal-case"
                aria-label="Google Maps Proximity help"
                aria-expanded={proximityHelpOpen}
                aria-controls="proximity-help-popover"
                onClick={() => setProximityHelpOpen((o) => !o)}
              >
                ?
              </button>
            </legend>
            <div
              className={`dual-rating-range relative h-9 w-full pb-4 ${form.onlyWithoutGooglePlace ? "opacity-45" : ""}`}
            >
              <div
                className="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-neutral-700"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-amber-500/85"
                style={{
                  left: 0,
                  width: `${proximityRadiusPct}%`,
                }}
                aria-hidden
              />
              <div className="pointer-events-none absolute bottom-[-16px] left-0 right-0 flex justify-between px-px text-sm font-medium text-neutral-400">
                <span>{GOOGLE_MAPS_PROXIMITY_RADIUS_M_MIN} m</span>
                <span>{GOOGLE_MAPS_PROXIMITY_RADIUS_M_MAX} m</span>
              </div>
              <input
                type="range"
                disabled={form.onlyWithoutGooglePlace}
                aria-label="Maximum distance to matched Google place in meters"
                min={GOOGLE_MAPS_PROXIMITY_RADIUS_M_MIN}
                max={GOOGLE_MAPS_PROXIMITY_RADIUS_M_MAX}
                step={1}
                value={form.googleMapsProximityRadiusM}
                className={`absolute left-0 right-0 top-0 z-[3] h-9 ${form.onlyWithoutGooglePlace ? "cursor-not-allowed" : "cursor-pointer"}`}
                onChange={(e) =>
                  onFormChange({
                    googleMapsProximityRadiusM: Number(e.target.value),
                  })
                }
              />
            </div>
            <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-neutral-300">
              <input
                type="checkbox"
                checked={form.onlyWithoutGooglePlace}
                onChange={(e) =>
                  onFormChange({ onlyWithoutGooglePlace: e.target.checked })
                }
                className="mt-0.5 rounded border-white/30 bg-neutral-900 text-amber-500 focus:ring-amber-500/40"
              />
              <span>
                Show only points with no Google entry found within a 50m radius
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
    {proximityHelpPopover}
    </>
  );
}
