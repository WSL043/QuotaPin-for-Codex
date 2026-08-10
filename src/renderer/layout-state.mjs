export function createLayoutStateToolkit() {
  const modules = ["avatar", "name", "value", "label", "dot", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens"];
  const layoutModes = ["auto", "free"];
  const snapTargets = ["edges", "center", "modules"];
  const defaultAnchors = Object.freeze({
    avatar: 0.04,
    name: 0.04,
    dot: 0.96,
    value: 0.96,
    todayTokens: 0.96,
    lifetimeTokens: 0.96,
    label: 0.96,
    countdown: 0.96,
    relative: 0.96,
    seconds: 0.96,
    date: 0.96,
    reset: 0.96,
  });

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function isAccountRowGeometry(rect = {}, viewport = {}) {
    const left = Number(rect.left);
    const right = Number(rect.right);
    const width = Number(rect.width);
    const height = Number(rect.height);
    const bottom = Number(rect.bottom);
    const viewportWidth = Number(viewport.width);
    const viewportHeight = Number(viewport.height);
    if (![left, right, width, height, bottom, viewportWidth, viewportHeight].every(Number.isFinite)) return false;
    // The Windows sidebar is resizable and recent Codex builds allow it to
    // occupy most of the window.  The old 720px / 65% ceiling made the one
    // genuine account row disappear as soon as a user widened the sidebar.
    // Left/bottom placement, menu semantics, and the identity image remain the
    // discriminators; width only needs to stay inside the viewport.
    const maximumAccountWidth = Math.max(140, viewportWidth - 8);
    return left >= 0
      && left < 72
      && width >= 140
      && width <= maximumAccountWidth
      && right > 150
      && right <= viewportWidth + 2
      && bottom > viewportHeight - 72
      && bottom <= viewportHeight + 2
      && height >= 28
      && height <= 68;
  }

  function cleanModuleOrder(order) {
    const requested = Array.isArray(order) ? order.map(String) : [];
    return requested.length === modules.length
      && new Set(requested).size === modules.length
      && modules.every((module) => requested.includes(module))
      ? requested
      : [...modules];
  }

  function cleanLayoutMode(value) {
    return layoutModes.includes(value) ? value : "auto";
  }

  function positionedModuleOverflow(module) {
    if (module === "avatar") return "hidden";
    return ["name", "label", "countdown", "relative", "seconds", "date", "reset", "value", "todayTokens", "lifetimeTokens"].includes(module)
      ? "hidden"
      : "visible";
  }

  function panelGeometry(viewportWidth, viewportHeight, anchorValue = null) {
    const widthLimit = Math.max(0, Math.floor(Number(viewportWidth) || 0));
    const heightLimit = Math.max(0, Math.floor(Number(viewportHeight) || 0));
    const width = Math.min(376, Math.max(0, widthLimit - 16));
    const defaultLeft = Math.min(8, Math.max(0, widthLimit - width));
    const defaultBottom = Math.min(56, Math.max(8, heightLimit - 160));
    const height = Math.min(480, Math.max(0, heightLimit - defaultBottom - 8));
    const anchor = anchorValue && typeof anchorValue === "object"
      ? {
          left: Number(anchorValue.left),
          right: Number(anchorValue.right),
          top: Number(anchorValue.top),
          bottom: Number(anchorValue.bottom),
        }
      : null;
    if (!anchor || ![anchor.left, anchor.right, anchor.top, anchor.bottom].every(Number.isFinite)
      || anchor.right <= anchor.left || anchor.bottom <= anchor.top || width <= 0 || height <= 0) {
      return { left: defaultLeft, bottom: defaultBottom, width, height };
    }
    const edge = 8;
    const gap = 10;
    const maximumLeft = Math.max(edge, widthLimit - width - edge);
    const left = Math.max(edge, Math.min(maximumLeft, (anchor.left + anchor.right - width) / 2));
    const maximumTop = Math.max(edge, heightLimit - height - edge);
    const roomAbove = anchor.top - gap - edge;
    const roomBelow = heightLimit - anchor.bottom - gap - edge;
    const requestedTop = roomBelow >= height || roomBelow >= roomAbove
      ? anchor.bottom + gap
      : anchor.top - gap - height;
    const top = Math.max(edge, Math.min(maximumTop, requestedTop));
    const bottom = Math.max(0, heightLimit - top - height);
    return { left, bottom, width, height };
  }

  function cleanModuleAnchors(value, fallback = defaultAnchors) {
    const source = value && typeof value === "object" ? value : {};
    const base = fallback && typeof fallback === "object" ? fallback : defaultAnchors;
    return Object.fromEntries(modules.map((module) => {
      const requested = Number(source[module]);
      const inherited = Number(base[module]);
      const anchor = Number.isFinite(requested)
        ? requested
        : Number.isFinite(inherited)
          ? inherited
          : defaultAnchors[module];
      return [module, Math.round(clamp(anchor, 0, 1) * 10_000) / 10_000];
    }));
  }

  function moveModule(order, module, insertion) {
    const current = cleanModuleOrder(order);
    if (!current.includes(module)) return current;
    const others = current.filter((candidate) => candidate !== module);
    const index = Math.max(0, Math.min(others.length, Number(insertion) || 0));
    others.splice(index, 0, module);
    return others;
  }

  function orderForPointer(order, module, center, rects = {}) {
    const current = cleanModuleOrder(order);
    const hasVisibleRect = (candidate) => {
      const rect = rects[candidate];
      return rect
        && Number.isFinite(Number(rect.left))
        && Number.isFinite(Number(rect.width))
        && Number(rect.width) > 0;
    };
    const visible = current.filter(hasVisibleRect);
    if (!visible.includes(module)) return current;
    const visibleSet = new Set(visible);
    const others = visible.filter((candidate) => candidate !== module);
    let insertion = 0;
    for (const candidate of others) {
      const rect = rects[candidate];
      if (Number(center) > Number(rect.left) + Number(rect.width) / 2) insertion += 1;
    }
    const reorderedVisible = [...others];
    reorderedVisible.splice(Math.max(0, Math.min(others.length, insertion)), 0, module);
    let visibleIndex = 0;
    return current.map((candidate) => visibleSet.has(candidate)
      ? reorderedVisible[visibleIndex++]
      : candidate);
  }

  function stableMagneticNeighbours(frozenRects = {}, resolvedRects = {}, excludedModule = "", tolerance = 1) {
    const maximumDrift = Math.max(0, Number(tolerance) || 0);
    const neighbours = [];
    for (const [id, frozen] of Object.entries(frozenRects && typeof frozenRects === "object" ? frozenRects : {})) {
      if (id === String(excludedModule ?? "")) continue;
      const frozenLeft = Number(frozen?.left);
      const frozenWidth = Number(frozen?.width);
      const frozenRight = Number(frozen?.right ?? (frozenLeft + frozenWidth));
      if (![frozenLeft, frozenWidth, frozenRight].every(Number.isFinite) || frozenWidth <= 0 || frozenRight <= frozenLeft) continue;
      const resolved = resolvedRects?.[id] ?? frozen;
      const resolvedLeft = Number(resolved?.left);
      const resolvedWidth = Number(resolved?.width);
      if (![resolvedLeft, resolvedWidth].every(Number.isFinite) || resolvedWidth <= 0) continue;
      const frozenCenter = frozenLeft + frozenWidth / 2;
      const resolvedCenter = resolvedLeft + resolvedWidth / 2;
      // A neighbour that the active module has already pushed away is no
      // longer a magnetic target for this gesture. It simply yields to the
      // available side, so the attraction point cannot run away from the
      // pointer or trap the dragged module between two insertion slots.
      if (Math.abs(resolvedCenter - frozenCenter) > maximumDrift) continue;
      neighbours.push({ id, left: frozenLeft, right: frozenRight, width: frozenWidth });
    }
    return neighbours;
  }

  function moveModuleByKey(order, module, direction) {
    const current = cleanModuleOrder(order);
    const index = current.indexOf(module);
    const delta = direction === "left" ? -1 : direction === "right" ? 1 : 0;
    const nextIndex = Math.max(0, Math.min(current.length - 1, index + delta));
    if (index < 0 || index === nextIndex) return current;
    const next = [...current];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    return next;
  }

  function moveModuleAnchor(anchors, module, direction, step = 0.02) {
    const current = cleanModuleAnchors(anchors);
    if (!modules.includes(module)) return current;
    const delta = direction === "left" ? -Math.abs(Number(step) || 0.02) : direction === "right" ? Math.abs(Number(step) || 0.02) : 0;
    current[module] = Math.round(clamp(current[module] + delta, 0, 1) * 10_000) / 10_000;
    return current;
  }

  function snapMagneticCenter(requestedCenter, moduleWidth, bounds = {}, neighbours = [], options = {}) {
    const left = Number(bounds.left);
    const right = Number(bounds.right);
    const width = Math.max(1, Number(moduleWidth) || 1);
    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
      return { center: Number(requestedCenter) || 0, snapped: false, target: null };
    }
    const minimum = left + width / 2;
    const maximum = right - width / 2;
    const requested = clamp(Number(requestedCenter) || minimum, minimum, maximum);
    const gap = Math.max(0, Number(options.gap) || 6);
    const thresholdInput = Number(options.threshold);
    const threshold = Number.isFinite(thresholdInput) ? clamp(thresholdInput, 0, 48) : 16;
    const requestedTargets = Array.isArray(options.targets)
      ? new Set(options.targets.map(String).filter((target) => snapTargets.includes(target)))
      : new Set(snapTargets);
    const candidates = [];
    if (requestedTargets.has("edges")) {
      candidates.push(
        { center: minimum, target: "left" },
        { center: maximum, target: "right" },
      );
    }
    if (requestedTargets.has("center")) candidates.push({ center: (left + right) / 2, target: "center" });
    for (const neighbour of requestedTargets.has("modules") && Array.isArray(neighbours) ? neighbours : []) {
      const neighbourLeft = Number(neighbour?.left);
      const neighbourRight = Number(neighbour?.right ?? (neighbourLeft + Number(neighbour?.width)));
      if (!Number.isFinite(neighbourLeft) || !Number.isFinite(neighbourRight) || neighbourRight <= neighbourLeft) continue;
      candidates.push(
        { center: neighbourLeft - gap - width / 2, target: "before:" + String(neighbour.id ?? "module") },
        { center: neighbourRight + gap + width / 2, target: "after:" + String(neighbour.id ?? "module") },
      );
    }
    const requestedEdge = Math.abs(requested - minimum) <= 1e-7
      ? "left"
      : Math.abs(requested - maximum) <= 1e-7
        ? "right"
        : null;
    const viable = candidates
      .map((candidate) => ({ ...candidate, center: clamp(candidate.center, minimum, maximum) }))
      .map((candidate) => ({ ...candidate, distance: Math.abs(candidate.center - requested) }))
      .sort((a, b) => {
        const distance = a.distance - b.distance;
        if (distance) return distance;
        if (requestedEdge) {
          const aIsRequestedEdge = a.target === requestedEdge;
          const bIsRequestedEdge = b.target === requestedEdge;
          if (aIsRequestedEdge !== bIsRequestedEdge) return aIsRequestedEdge ? -1 : 1;
        }
        return Number(!String(a.target).includes(":")) - Number(!String(b.target).includes(":"));
      });
    const nearest = viable[0];
    return nearest && nearest.distance <= threshold
      ? { center: nearest.center, snapped: true, target: nearest.target }
      : { center: requested, snapped: false, target: null };
  }

  function anchorsFromRects(rects = {}, bounds = {}, fallback = defaultAnchors) {
    const left = Number(bounds.left);
    const right = Number(bounds.right);
    const width = right - left;
    const next = cleanModuleAnchors({}, fallback);
    if (!Number.isFinite(left) || !Number.isFinite(right) || width <= 0) return next;
    for (const module of modules) {
      const rect = rects[module];
      if (!rect || !(Number(rect.width) > 0) || (rect.height !== undefined && !(Number(rect.height) > 0))) continue;
      const center = Number(rect?.left) + Number(rect?.width) / 2;
      if (Number.isFinite(center)) next[module] = Math.round(clamp((center - left) / width, 0, 1) * 10_000) / 10_000;
    }
    return next;
  }

  function dockModuleAnchors(anchors = {}, fallback = defaultAnchors) {
    const clean = cleanModuleAnchors(anchors, fallback);
    return Object.fromEntries(modules.map((module) => {
      const anchor = clean[module];
      // Smart layout stores a durable relationship to the row instead of an
      // arbitrary percentage. Narrow collision packing can hide a fractional
      // anchor, then expose it as a stranded midpoint when the sidebar grows.
      // Exact normalized coordinates remain available in free layout.
      // Center is an intentional magnetic target, so reserve only a narrow
      // band for it. Older arbitrary anchors such as 0.31/0.40 belong to the
      // same left group instead of being split across left and center.
      const dock = Math.abs(anchor - 0.5) <= 0.08 ? 0.5 : anchor < 0.5 ? 0 : 1;
      return [module, dock];
    }));
  }

  function fitWidths(items, available, requestedGap) {
    let gap = Math.max(0, Number(requestedGap) || 0);
    const fitted = items.map((item) => ({
      ...item,
      width: Math.max(1, Number(item.width) || 1),
      minWidth: Math.max(1, Math.min(Number(item.width) || 1, Number(item.minWidth) || Number(item.width) || 1)),
      shrinkPriority: Number.isFinite(Number(item.shrinkPriority)) ? Number(item.shrinkPriority) : 100,
    }));
    const total = () => fitted.reduce((sum, item) => sum + item.width, 0) + gap * Math.max(0, fitted.length - 1);
    let excess = total() - available;
    if (excess > 0) {
      for (const item of [...fitted].sort((a, b) => a.shrinkPriority - b.shrinkPriority)) {
        const reduction = Math.min(excess, item.width - item.minWidth);
        item.width -= reduction;
        excess -= reduction;
        if (excess <= 0) break;
      }
    }
    if (excess > 0 && fitted.length > 1) {
      const reduction = Math.min(gap, excess / (fitted.length - 1));
      gap -= reduction;
      excess = total() - available;
    }
    // At very narrow sidebar widths the sum of readable minima can itself be
    // wider than the row. Keep every module inside the account boundary by
    // degrading ellipsizable boxes below their preferred minima before the
    // renderer's overflow:hidden clips the whole tail of the composition.
    if (excess > 0) {
      for (const item of [...fitted].sort((a, b) => a.shrinkPriority - b.shrinkPriority)) {
        const reduction = Math.min(excess, item.width - 1);
        item.width -= reduction;
        excess -= reduction;
        if (excess <= 0) break;
      }
    }
    const compressedModules = fitted
      .filter((item) => item.width + 0.01 < item.minWidth)
      .map((item) => item.id);
    return { items: fitted, gap, overflow: Math.max(0, excess), compressedModules };
  }

  function isotonic(values) {
    const blocks = [];
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      blocks.push({ start: index, end: index, weight: value.weight, sum: value.target * value.weight });
      while (blocks.length > 1) {
        const right = blocks[blocks.length - 1];
        const left = blocks[blocks.length - 2];
        if (left.sum / left.weight <= right.sum / right.weight) break;
        blocks.splice(blocks.length - 2, 2, {
          start: left.start,
          end: right.end,
          weight: left.weight + right.weight,
          sum: left.sum + right.sum,
        });
      }
    }
    const result = new Array(values.length);
    for (const block of blocks) {
      const average = block.sum / block.weight;
      for (let index = block.start; index <= block.end; index += 1) result[index] = average;
    }
    return result;
  }

  function solveFreeLayout(inputItems = [], bounds = {}, options = {}) {
    const left = Number(bounds.left);
    const right = Number(bounds.right);
    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
      return { order: [], positions: {}, gap: 0, overflow: 0, compressedModules: [] };
    }
    const requested = inputItems
      .filter((item) => item && modules.includes(String(item.id)))
      .map((item, index) => ({
        ...item,
        id: String(item.id),
        desiredCenter: Number.isFinite(Number(item.desiredCenter)) ? Number(item.desiredCenter) : left,
        sourceIndex: index,
      }));
    if (options.preserveOrder !== true) {
      requested.sort((a, b) => a.desiredCenter - b.desiredCenter || a.sourceIndex - b.sourceIndex);
    }
    if (!requested.length) return { order: [], positions: {}, gap: 0, overflow: 0, compressedModules: [] };

    const fitted = fitWidths(requested, right - left, options.gap ?? 6);
    const offsets = [];
    let offset = 0;
    for (const item of fitted.items) {
      offsets.push(offset);
      offset += item.width + fitted.gap;
    }
    const packedWidth = offset - fitted.gap;
    const upper = Math.max(left, right - packedWidth);
    const pinnedId = String(options.pinnedId ?? "");
    const values = fitted.items.map((item, index) => ({
      target: item.desiredCenter - item.width / 2 - offsets[index],
      weight: item.id === pinnedId ? 1_000_000 : Math.max(0.001, Number(item.weight) || 1),
    }));
    const projected = isotonic(values).map((value) => clamp(value, left, upper));
    const positions = {};
    fitted.items.forEach((item, index) => {
      const itemLeft = projected[index] + offsets[index];
      positions[item.id] = {
        left: itemLeft,
        width: item.width,
        center: itemLeft + item.width / 2,
      };
    });
    return {
      order: fitted.items.map((item) => item.id),
      positions,
      gap: fitted.gap,
      overflow: fitted.overflow,
      compressedModules: [...fitted.compressedModules],
    };
  }

  return {
    modules: [...modules],
    layoutModes: [...layoutModes],
    snapTargets: [...snapTargets],
    defaultAnchors: { ...defaultAnchors },
    isAccountRowGeometry,
    cleanModuleOrder,
    cleanLayoutMode,
    positionedModuleOverflow,
    panelGeometry,
    cleanModuleAnchors,
    moveModule,
    orderForPointer,
    stableMagneticNeighbours,
    moveModuleByKey,
    moveModuleAnchor,
    snapMagneticCenter,
    anchorsFromRects,
    dockModuleAnchors,
    solveFreeLayout,
  };
}
