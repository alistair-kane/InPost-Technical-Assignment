import {
  MAP_TYPE_ACTIVE_BG,
  MAP_TYPE_ACTIVE_FG,
  MAP_TYPE_BAR_BG,
  MAP_TYPE_BAR_BORDER,
  MAP_TYPE_DIVIDER,
  MAP_TYPE_INACTIVE_BG,
  MAP_TYPE_INACTIVE_FG,
  MAP_TYPE_RIGHT_OFFSET_PX,
  MAP_TYPE_SEGMENTS,
} from "./mapDashboardConstants";

/**
 * Map / satellite toggle (no hybrid), InPost black + yellow styling.
 * Absolutely positioned on the map div so it sits on the same row as the
 * fullscreen control (to its left), not stacked above it in the control slot.
 */
export function attachGoogleStyleMapTypeBar(map: google.maps.Map): () => void {
  const cur = (map.getMapTypeId() ?? "").toLowerCase();
  if (cur === "hybrid") {
    map.setMapTypeId("roadmap");
  }

  const mapDiv = map.getDiv();
  if (!(mapDiv instanceof HTMLElement)) {
    return () => {};
  }

  const outer = document.createElement("div");
  outer.style.position = "absolute";
  outer.style.bottom = "10px";
  outer.style.right = `${MAP_TYPE_RIGHT_OFFSET_PX}px`;
  outer.style.zIndex = "10";
  outer.style.display = "flex";
  outer.style.justifyContent = "flex-end";
  outer.style.pointerEvents = "auto";

  const bar = document.createElement("div");
  bar.style.display = "inline-flex";
  bar.style.borderRadius = "8px";
  bar.style.overflow = "hidden";
  bar.style.boxShadow =
    "0 2px 8px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.35)";
  bar.style.background = MAP_TYPE_BAR_BG;
  bar.style.border = MAP_TYPE_BAR_BORDER;
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Map type");

  const buttons: HTMLButtonElement[] = [];

  const applyInactive = (btn: HTMLButtonElement) => {
    btn.style.background = MAP_TYPE_INACTIVE_BG;
    btn.style.color = MAP_TYPE_INACTIVE_FG;
    btn.style.fontWeight = "500";
  };

  const sync = () => {
    let current = (map.getMapTypeId() ?? "").toLowerCase();
    if (current === "hybrid") {
      map.setMapTypeId("roadmap");
      current = "roadmap";
    }
    MAP_TYPE_SEGMENTS.forEach((seg, i) => {
      const btn = buttons[i];
      const active = current === seg.mapTypeId.toLowerCase();
      if (active) {
        btn.style.background = MAP_TYPE_ACTIVE_BG;
        btn.style.color = MAP_TYPE_ACTIVE_FG;
        btn.style.fontWeight = "600";
      } else {
        applyInactive(btn);
      }
    });
  };

  MAP_TYPE_SEGMENTS.forEach((seg, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = seg.label;
    btn.style.fontFamily = "system-ui, -apple-system, sans-serif";
    btn.style.fontSize = "16.44px";
    btn.style.lineHeight = "22.68px";
    btn.style.padding = "11.4px 17.64px";
    btn.style.border = "none";
    btn.style.borderLeft = i === 0 ? "none" : MAP_TYPE_DIVIDER;
    btn.style.cursor = "pointer";
    btn.style.margin = "0";
    btn.style.transition = "background 0.12s ease, color 0.12s ease";
    applyInactive(btn);
    btn.addEventListener("mouseenter", () => {
      const current = (map.getMapTypeId() ?? "").toLowerCase();
      const active = current === seg.mapTypeId.toLowerCase();
      if (!active) {
        btn.style.background = "#2a2a2a";
        btn.style.color = "#FFCC04";
      }
    });
    btn.addEventListener("mouseleave", () => {
      sync();
    });
    btn.addEventListener("click", () => {
      map.setMapTypeId(seg.mapTypeId);
      sync();
    });
    buttons.push(btn);
    bar.appendChild(btn);
  });

  outer.appendChild(bar);
  mapDiv.appendChild(outer);
  sync();

  const listener = map.addListener("maptypeid_changed", sync);

  return () => {
    google.maps.event.removeListener(listener);
    if (outer.parentNode === mapDiv) {
      mapDiv.removeChild(outer);
    }
  };
}
