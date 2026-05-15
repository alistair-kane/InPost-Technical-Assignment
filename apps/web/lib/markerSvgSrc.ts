import {
  PACZKOPUNKT_PARTNER_IDS,
} from "@/lib/paczkopunktPartnerIds";

/** Public URLs — files live under `apps/web/public/markers/`. */
export const MARKER_SVG_PACZKOMAT = "/markers/marker-paczkomat.svg";
export const MARKER_SVG_PACZKOPUNKT = "/markers/marker-paczkopunkt.svg";

const paczkopunktIdSet = new Set<number>(PACZKOPUNKT_PARTNER_IDS);

export function markerSvgSrc(
  partnerId: number | string | null | undefined
): string {
  if (
    partnerId == null ||
    paczkopunktIdSet.has(Number(partnerId))
  ) {
    return MARKER_SVG_PACZKOPUNKT;
  }
  return MARKER_SVG_PACZKOMAT;
}
