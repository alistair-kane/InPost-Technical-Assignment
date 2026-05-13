/**
 * InPost live status indicator (detail header) and map filter buttons — keep in sync.
 * Lives under `components/` so Tailwind scans these utility strings (root `.gitignore` has `lib/`).
 */
export const INPOST_STATUS_DOT_CLASS = {
  neutral: "block h-3 w-3 shrink-0 rounded-full bg-neutral-500",
  operating:
    "block h-3 w-3 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(52,211,153,0.65)] animate-pulse",
  created:
    "block h-3 w-3 shrink-0 rounded-full bg-orange-500 shadow-[0_0_10px_rgba(251,146,60,0.7)]",
  disabled: "block h-3 w-3 shrink-0 rounded-full bg-red-500",
} as const;

export function inpostDetailStatusDotClassName(
  inpostLoading: boolean,
  liveStatus: string | null
): string {
  if (inpostLoading) {
    return INPOST_STATUS_DOT_CLASS.neutral;
  }
  if (!liveStatus) {
    return INPOST_STATUS_DOT_CLASS.neutral;
  }
  const n = liveStatus.trim().toLowerCase();
  if (n === "operating") {
    return INPOST_STATUS_DOT_CLASS.operating;
  }
  if (n === "created") {
    return INPOST_STATUS_DOT_CLASS.created;
  }
  return INPOST_STATUS_DOT_CLASS.disabled;
}
