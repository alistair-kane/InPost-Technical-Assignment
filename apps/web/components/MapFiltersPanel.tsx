"use client";

import {
  SPOTLIGHT_ICON_SRC,
  SPOTLIGHT_PRESET_LABELS,
  SPOTLIGHT_PRESET_ORDER,
  type SpotlightPresetId,
} from "@/lib/mapSpotlightPresets";
import { markerSvgSrc } from "@/lib/markerSvgSrc";

import {
  RATING_SLIDER_MAX,
  RATING_SLIDER_MIN,
  RATING_SLIDER_STEP,
  type MapFiltersForm,
} from "./mapFiltersQuery";

type MapFiltersPanelProps = {
  form: MapFiltersForm;
  onFormChange: (patch: Partial<MapFiltersForm>) => void;
  partnerOptions: number[];
  selectedPartners: Set<number>;
  onPartnerToggle: (id: number) => void;
  spotlightActive: SpotlightPresetId | null;
  onSpotlightSelect: (id: SpotlightPresetId) => void;
  spotlightPoolEmpty: boolean;
};

function pctAlong(v: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }
  return ((v - min) / (max - min)) * 100;
}

export function MapFiltersPanel({
  form,
  onFormChange,
  partnerOptions,
  selectedPartners,
  onPartnerToggle,
  spotlightActive,
  onSpotlightSelect,
  spotlightPoolEmpty,
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

  return (
    <div className="w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-white/15 bg-neutral-950/95 text-neutral-100 shadow-xl backdrop-blur">
      <details className="group">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-lg font-medium tracking-tight outline-none marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="inline-flex w-full items-center justify-between gap-2">
            <span>Filters</span>
            <span className="text-neutral-500 group-open:rotate-180 transition-transform">▾</span>
          </span>
        </summary>
        <div className="border-t border-white/10 px-3 pb-3 pt-2 text-sm leading-snug">
          {partnerOptions.length > 0 && (
            <fieldset className="mt-4">
              <legend className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Location type
              </legend>
              <ul className="flex max-h-40 flex-wrap justify-center gap-2 overflow-y-auto rounded border border-white/10 bg-neutral-900/80 p-2">
                {partnerOptions.map((id) => {
                  const active =
                    selectedPartners.size === 0 || selectedPartners.has(id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        title={`Partner ${id}`}
                        onClick={() => onPartnerToggle(id)}
                        className={`rounded-lg border p-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${active
                            ? "border-amber-500/50 bg-neutral-800/90 shadow-sm ring-1 ring-amber-500/30"
                            : "border-white/10 bg-neutral-950/80 opacity-45 hover:border-white/20 hover:opacity-90"
                          }`}
                      >
                        <span className="sr-only">Partner {id}</span>
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

          <fieldset className="mt-4 border-t border-white/10 pt-3">
            <legend className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Location spotlight
            </legend>
            <div className="flex flex-col gap-[9px]">
              {SPOTLIGHT_PRESET_ORDER.map((id) => {
                const pressed = spotlightActive === id;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={spotlightPoolEmpty}
                    aria-pressed={pressed}
                    title={SPOTLIGHT_PRESET_LABELS[id]}
                    onClick={() => onSpotlightSelect(id)}
                    className={`flex w-full items-center gap-[9px] rounded-md border px-[9px] py-[9px] text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-40 ${pressed
                        ? "border-amber-500/60 bg-amber-950/50 text-amber-100 ring-1 ring-amber-500/35"
                        : "border-white/12 bg-neutral-900/90 text-neutral-200 hover:border-amber-500/25 hover:bg-neutral-800/90"
                      }`}
                  >
                    <span
                      className={`shrink-0 ${pressed ? "opacity-100" : "opacity-90"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- local /public SVG assets */}
                      <img
                        src={SPOTLIGHT_ICON_SRC[id]}
                        alt=""
                        width={24}
                        height={24}
                        draggable={false}
                        className="pointer-events-none block h-6 w-6 object-contain object-center"
                      />
                    </span>
                    <span className="min-w-0 font-mono text-sm font-medium uppercase leading-snug tracking-tight text-neutral-400">
                      {SPOTLIGHT_PRESET_LABELS[id]}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      </details>
    </div>
  );
}
