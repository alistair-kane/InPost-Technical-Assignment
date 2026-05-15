"use client";

import {
  SPOTLIGHT_ICON_SRC,
  SPOTLIGHT_PRESET_LABELS,
  SPOTLIGHT_PRESET_ORDER,
  SPOTLIGHT_PRESET_TOOLTIPS,
  type SpotlightPresetId,
} from "@/lib/mapSpotlightPresets";

type MapSpotlightBarProps = {
  active: SpotlightPresetId | null;
  navigating: boolean;
  onSelect: (id: SpotlightPresetId) => void;
  poolEmpty: boolean;
};

/**
 * Spotlight presets as a row of controls (positioning is provided by the parent).
 */
export function MapSpotlightBar({
  active,
  navigating,
  onSelect,
  poolEmpty,
}: MapSpotlightBarProps) {
  return (
    <div
      className="pointer-events-auto flex max-w-[min(100%,min(92vw,55rem))] flex-wrap items-center justify-center gap-2 sm:gap-2.5"
      role="toolbar"
      aria-label="Location spotlight"
      aria-busy={navigating}
    >
      {SPOTLIGHT_PRESET_ORDER.map((id) => {
        const pressed = active === id;
        const loading = navigating && pressed;
        return (
          <span key={id} className="group/spot relative inline-flex">
            <button
              type="button"
              disabled={poolEmpty}
              aria-pressed={pressed}
              aria-busy={loading}
              onClick={() => onSelect(id)}
              className={`peer relative flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-40 sm:gap-2.5 sm:px-3 sm:py-2.5 ${pressed
                  ? "border-black/20 bg-[#FFCC04] text-[#141414] shadow-sm ring-1 ring-black/10"
                  : "border-white/12 bg-neutral-900/90 text-neutral-200 hover:border-amber-500/25 hover:bg-neutral-800/90"
                }`}
            >
              {loading && (
                <span
                  className="absolute inset-0 flex items-center justify-center rounded-md bg-[#FFCC04]/90"
                  aria-hidden
                >
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#141414]/25 border-t-[#141414]" />
                </span>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element -- local /public SVG assets */}
              <img
                src={SPOTLIGHT_ICON_SRC[id]}
                alt=""
                width={29}
                height={29}
                draggable={false}
                className={`pointer-events-none block h-[29px] w-[29px] shrink-0 object-contain object-center sm:h-[31px] sm:w-[31px] ${loading ? "opacity-0" : ""}`}
              />
              <span
                className={`hidden max-w-[11.7rem] truncate font-mono text-[13px] font-medium uppercase leading-tight tracking-tight sm:inline sm:max-w-none sm:text-[15px] ${pressed ? "text-[#141414]" : "text-neutral-400"}`}
              >
                {SPOTLIGHT_PRESET_LABELS[id]}
              </span>
            </button>
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-[100] mb-2 w-max max-w-[min(92vw,22rem)] -translate-x-1/2 whitespace-normal rounded-lg border border-white/20 bg-neutral-950/98 px-3.5 py-2.5 text-left text-base font-normal normal-case leading-snug tracking-normal text-neutral-100 shadow-xl opacity-0 transition-opacity duration-200 group-hover/spot:opacity-100 peer-hover:opacity-100 peer-focus-visible:opacity-100 sm:max-w-[min(92vw,26rem)] sm:px-4 sm:py-3 sm:text-lg"
            >
              {SPOTLIGHT_PRESET_TOOLTIPS[id]}
            </span>
          </span>
        );
      })}
    </div>
  );
}
