/**
 * Horizontal pan offset when a side detail panel covers part of the map (pure geometry).
 * Mirrors the layout rules previously inlined in MapDashboard.
 */

/** If the panel is at least this wide relative to the map, skip panning. */
const PANEL_WIDTH_ABORT_MAP_FRAC = 0.88;

/** Minimum gap (px) used when computing the reserved strip on the right. */
const MAP_PANEL_EDGE_GAP_PX = 32;

/** Minimum visible map strip (px) after subtracting panel and reserves. */
const MIN_VISIBLE_STRIP_PX = 48;

export function computeLocationPanelPanOffsetPx(args: {
  mapWidthPx: number;
  panelWidthPx: number;
  filterOverlayReserveX: number;
}): number {
  const { mapWidthPx: mapW, panelWidthPx: panelW, filterOverlayReserveX } = args;
  if (mapW <= 0 || panelW >= mapW * PANEL_WIDTH_ABORT_MAP_FRAC) {
    return 0;
  }
  const rightReserve = Math.min(
    filterOverlayReserveX,
    Math.max(0, mapW - panelW - MAP_PANEL_EDGE_GAP_PX)
  );
  const visibleW = mapW - panelW - rightReserve;
  if (visibleW < MIN_VISIBLE_STRIP_PX) {
    return 0;
  }
  return Math.round((panelW - rightReserve) / 2);
}
