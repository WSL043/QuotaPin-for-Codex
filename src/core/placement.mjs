export function createPlacementToolkit() {
  const primaryZones = Object.freeze([
    "account-row",
    "title-center",
    "workspace-top-center",
    "workspace-bottom-start",
    "composer-center",
    "workspace-bottom-end",
  ]);
  const railZones = Object.freeze(["account-row", "composer-bottom"]);
  const defaultPlacement = Object.freeze({
    primary: "account-row",
    fallback: "account-row",
    rail: "account-row",
  });

  const finite = (value) => Number.isFinite(Number(value));
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function cleanPlacement(value = {}, fallback = defaultPlacement) {
    const source = value && typeof value === "object" ? value : {};
    const base = fallback && typeof fallback === "object" ? fallback : defaultPlacement;
    const primary = primaryZones.includes(source.primary)
      ? source.primary
      : primaryZones.includes(base.primary)
        ? base.primary
        : defaultPlacement.primary;
    const requestedFallback = primaryZones.includes(source.fallback)
      ? source.fallback
      : primaryZones.includes(base.fallback)
        ? base.fallback
        : defaultPlacement.fallback;
    const rail = railZones.includes(source.rail)
      ? source.rail
      : railZones.includes(base.rail)
        ? base.rail
        : defaultPlacement.rail;
    // The account row is the only host contract available in every supported
    // Codex layout. A future schema may add another proven fallback, but v2
    // never silently falls from one experimental surface into another.
    return { primary, fallback: requestedFallback === "account-row" ? requestedFallback : "account-row", rail };
  }

  function cleanRect(value) {
    if (!value || typeof value !== "object") return null;
    const left = Number(value.left);
    const top = Number(value.top);
    const width = Number(value.width ?? (Number(value.right) - left));
    const height = Number(value.height ?? (Number(value.bottom) - top));
    if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
    };
  }

  function overlapsBand(rect, top, bottom) {
    return rect && rect.bottom > top && rect.top < bottom;
  }

  function occupiedIntervals(rects, bounds, top, bottom) {
    const intervals = [];
    for (const raw of Array.isArray(rects) ? rects : []) {
      const rect = cleanRect(raw);
      if (!rect || !overlapsBand(rect, top, bottom)) continue;
      const left = clamp(rect.left, bounds.left, bounds.right);
      const right = clamp(rect.right, bounds.left, bounds.right);
      if (right - left > 0.5) intervals.push({ left, right });
    }
    intervals.sort((left, right) => left.left - right.left || left.right - right.right);
    const merged = [];
    for (const interval of intervals) {
      const previous = merged.at(-1);
      if (!previous || interval.left > previous.right + 1) merged.push({ ...interval });
      else previous.right = Math.max(previous.right, interval.right);
    }
    return merged;
  }

  function horizontalGaps(boundsValue, occupied = [], minimumWidth = 1) {
    const bounds = cleanRect(boundsValue);
    if (!bounds) return [];
    const intervals = occupiedIntervals(occupied, bounds, bounds.top, bounds.bottom);
    const gaps = [];
    let cursor = bounds.left;
    for (const interval of intervals) {
      if (interval.left - cursor >= minimumWidth) gaps.push({ left: cursor, right: interval.left });
      cursor = Math.max(cursor, interval.right);
    }
    if (bounds.right - cursor >= minimumWidth) gaps.push({ left: cursor, right: bounds.right });
    return gaps.map((gap) => ({ ...gap, width: gap.right - gap.left, center: (gap.left + gap.right) / 2 }));
  }

  function preferredGap(boundsValue, occupied = [], options = {}) {
    const bounds = cleanRect(boundsValue);
    if (!bounds) return null;
    const minimumWidth = Math.max(1, Number(options.minimumWidth) || 1);
    const preferredCenter = finite(options.preferredCenter)
      ? clamp(Number(options.preferredCenter), bounds.left, bounds.right)
      : (bounds.left + bounds.right) / 2;
    const gaps = horizontalGaps(bounds, occupied, minimumWidth);
    if (!gaps.length) return null;
    return gaps.sort((left, right) => {
      const leftContains = left.left <= preferredCenter && left.right >= preferredCenter;
      const rightContains = right.left <= preferredCenter && right.right >= preferredCenter;
      if (leftContains !== rightContains) return leftContains ? -1 : 1;
      const width = right.width - left.width;
      if (Math.abs(width) > 0.5) return width;
      return Math.abs(left.center - preferredCenter) - Math.abs(right.center - preferredCenter);
    })[0];
  }

  function centeredRect(gap, top, height, maximumWidth = Infinity) {
    if (!gap || !finite(top) || !finite(height)) return null;
    const width = Math.min(gap.width, Math.max(1, Number(maximumWidth) || gap.width));
    return cleanRect({ left: gap.center - width / 2, top, width, height });
  }

  function computePlacementGeometry(input = {}) {
    const viewportWidth = Number(input.viewport?.width);
    const viewportHeight = Number(input.viewport?.height);
    if (![viewportWidth, viewportHeight].every(Number.isFinite) || viewportWidth <= 0 || viewportHeight <= 0) {
      return { zones: {}, rails: {} };
    }
    const viewport = cleanRect({ left: 0, top: 0, width: viewportWidth, height: viewportHeight });
    const sidebar = cleanRect(input.sidebar);
    const composer = cleanRect(input.composer);
    const zones = { "account-row": { available: true, inline: true, rect: null } };
    const rails = { "account-row": { available: true, inline: true, rect: null } };

    const titleHeight = clamp(Number(input.titleHeight) || 36, 28, 56);
    const titleLeft = Math.max(8, Number(input.titleLeft) || 8);
    const titleBounds = cleanRect({
      left: titleLeft,
      top: 2,
      width: Math.max(1, viewport.width - titleLeft - 8),
      height: Math.max(1, titleHeight - 4),
    });
    const titleGap = preferredGap(titleBounds, input.titleOccupied, {
      minimumWidth: 120,
      preferredCenter: viewport.width / 2,
    });
    const titleRect = centeredRect(titleGap, titleBounds.top + 2, Math.min(28, titleBounds.height - 4), 260);
    zones["title-center"] = { available: Boolean(titleRect), passive: true, rect: titleRect };

    const workspaceLeft = Math.max(8, (sidebar?.right ?? 0) + 8);
    const workspaceTopBounds = cleanRect({
      left: workspaceLeft,
      top: titleHeight + 6,
      width: Math.max(1, viewport.right - workspaceLeft - 8),
      height: 30,
    });
    const workspaceTopGap = preferredGap(workspaceTopBounds, input.workspaceTopOccupied, {
      minimumWidth: 120,
      preferredCenter: (workspaceLeft + viewport.right) / 2,
    });
    const workspaceTopRect = centeredRect(
      workspaceTopGap,
      workspaceTopBounds.top,
      workspaceTopBounds.height,
      300,
    );
    zones["workspace-top-center"] = {
      available: Boolean(workspaceTopRect),
      passive: true,
      rect: workspaceTopRect,
    };

    if (composer) {
      const toolbarHeight = clamp(Number(input.composerToolbarHeight) || 34, 26, Math.min(48, composer.height));
      const toolbarTop = composer.bottom - toolbarHeight;
      const slotTop = toolbarTop + 2;
      const slotHeight = Math.max(20, toolbarHeight - 6);
      const sidebarRight = sidebar?.right ?? 0;
      const startLeft = Math.max(sidebarRight + 8, 8);
      const startRight = composer.left - 8;
      const endLeft = composer.right + 8;
      const endRight = viewport.right - 8;
      const startRect = startRight - startLeft >= 88
        ? cleanRect({ left: startLeft, top: slotTop, width: startRight - startLeft, height: slotHeight })
        : null;
      const endRect = endRight - endLeft >= 88
        ? cleanRect({ left: endLeft, top: slotTop, width: endRight - endLeft, height: slotHeight })
        : null;
      zones["workspace-bottom-start"] = { available: Boolean(startRect), rect: startRect };
      zones["workspace-bottom-end"] = { available: Boolean(endRect), rect: endRect };

      const composerBounds = cleanRect({
        left: composer.left + 10,
        top: slotTop,
        width: Math.max(1, composer.width - 20),
        height: slotHeight,
      });
      const composerGap = preferredGap(composerBounds, input.composerOccupied, {
        minimumWidth: 96,
        preferredCenter: composer.left + composer.width / 2,
      });
      const composerRect = centeredRect(composerGap, slotTop, slotHeight, 360);
      zones["composer-center"] = { available: Boolean(composerRect), passive: true, rect: composerRect };

      const railTop = composer.bottom + 2;
      const railRect = railTop + 2 <= viewport.bottom - 1
        ? cleanRect({
            left: composer.left + 10,
            top: railTop,
            width: Math.max(1, composer.width - 20),
            height: 2,
          })
        : null;
      rails["composer-bottom"] = { available: Boolean(railRect), passive: true, rect: railRect };
    } else {
      for (const zone of ["workspace-bottom-start", "composer-center", "workspace-bottom-end"]) {
        zones[zone] = { available: false, rect: null };
      }
      rails["composer-bottom"] = { available: false, rect: null };
    }
    return { zones, rails };
  }

  function resolvePrimaryZone(placementValue, geometry = {}) {
    const placement = cleanPlacement(placementValue);
    const requested = geometry?.zones?.[placement.primary];
    if (placement.primary === "account-row" || requested?.available) return placement.primary;
    return geometry?.zones?.[placement.fallback]?.available === false ? null : placement.fallback;
  }

  function resolveRailZone(placementValue, geometry = {}) {
    const placement = cleanPlacement(placementValue);
    const requested = geometry?.rails?.[placement.rail];
    return placement.rail === "account-row" || requested?.available ? placement.rail : "account-row";
  }

  return {
    primaryZones: [...primaryZones],
    railZones: [...railZones],
    defaultPlacement: { ...defaultPlacement },
    cleanPlacement,
    cleanRect,
    horizontalGaps,
    preferredGap,
    computePlacementGeometry,
    resolvePrimaryZone,
    resolveRailZone,
  };
}

const toolkit = createPlacementToolkit();

export const PLACEMENT_ZONES = Object.freeze([...toolkit.primaryZones]);
export const PLACEMENT_RAIL_ZONES = Object.freeze([...toolkit.railZones]);
export const DEFAULT_PLACEMENT = Object.freeze({ ...toolkit.defaultPlacement });
export const sanitizePlacement = toolkit.cleanPlacement;
