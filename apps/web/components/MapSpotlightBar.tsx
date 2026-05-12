"use client";

import {
  SPOTLIGHT_ICON_SRC,
  SPOTLIGHT_PRESET_LABELS,
  SPOTLIGHT_PRESET_ORDER,
  type SpotlightPresetId,
} from "@/lib/mapSpotlightPresets";

type MapSpotlightBarProps = {
  active: SpotlightPresetId | null;
  onSelect: (id: SpotlightPresetId) => void;
  poolEmpty: boolean;
};

/**
 * Spotlight presets as a row of controls just above the bottom of the map view.
 */
export function MapSpotlightBar({
  active,
  onSelect,
  poolEmpty,
}: MapSpotlightBarProps) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-4 z-[21] flex justify-center px-3 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]"
      role="toolbar"
      aria-label="Location spotlight"
    >
      <div className="pointer-events-auto flex max-w-[min(100%,min(92vw,55rem))] flex-wrap items-center justify-center gap-2 sm:gap-2.5">
        {SPOTLIGHT_PRESET_ORDER.map((id) => {
          const pressed = active === id;
          return (
            <button
              key={id}
              type="button"
              disabled={poolEmpty}
              aria-pressed={pressed}
              title={SPOTLIGHT_PRESET_LABELS[id]}
              onClick={() => onSelect(id)}
              className={`flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-40 sm:gap-2.5 sm:px-3 sm:py-2.5 ${pressed
                  ? "border-black/20 bg-[#FFCC04] text-[#141414] shadow-sm ring-1 ring-black/10"
                  : "border-white/12 bg-neutral-900/90 text-neutral-200 hover:border-amber-500/25 hover:bg-neutral-800/90"
                }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local /public SVG assets */}
              <img
                src={SPOTLIGHT_ICON_SRC[id]}
                alt=""
                width={29}
                height={29}
                draggable={false}
                className="pointer-events-none block h-[29px] w-[29px] shrink-0 object-contain object-center sm:h-[31px] sm:w-[31px]"
              />
              <span
                className={`hidden max-w-[11.7rem] truncate font-mono text-[13px] font-medium uppercase leading-tight tracking-tight sm:inline sm:max-w-none sm:text-[15px] ${pressed ? "text-[#141414]" : "text-neutral-400"}`}
              >
                {SPOTLIGHT_PRESET_LABELS[id]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
