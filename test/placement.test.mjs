import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PLACEMENT,
  PLACEMENT_RAIL_ZONES,
  PLACEMENT_ZONES,
  createPlacementToolkit,
  sanitizePlacement,
} from "../src/core/placement.mjs";

test("placement configuration stays semantic and falls back only to the account row", () => {
  assert.deepEqual(PLACEMENT_ZONES, [
    "account-row",
    "title-center",
    "workspace-top-center",
    "composer-center",
  ]);
  assert.deepEqual(PLACEMENT_RAIL_ZONES, ["account-row", "composer-bottom"]);
  assert.deepEqual(sanitizePlacement({}), DEFAULT_PLACEMENT);
  assert.deepEqual(sanitizePlacement({ primary: "composer-center", fallback: "title-center", rail: "composer-bottom" }), {
    primary: "composer-center",
    fallback: "account-row",
    rail: "composer-bottom",
  });
  assert.deepEqual(sanitizePlacement({ primary: "screen-pixel", rail: "anywhere" }), DEFAULT_PLACEMENT);
  assert.deepEqual(sanitizePlacement({ primary: "workspace-bottom-start", rail: "account-row" }), DEFAULT_PLACEMENT);
});

test("placement geometry exposes only proven centered surfaces", () => {
  const placement = createPlacementToolkit();
  const geometry = placement.computePlacementGeometry({
    viewport: { width: 1360, height: 864 },
    sidebar: { left: 0, top: 36, width: 268, height: 828 },
    composer: { left: 446, top: 710, width: 736, height: 142 },
    titleOccupied: [
      { left: 0, top: 0, width: 360, height: 36 },
      { left: 1224, top: 0, width: 136, height: 36 },
    ],
    composerOccupied: [
      { left: 458, top: 812, width: 130, height: 32 },
      { left: 1002, top: 812, width: 168, height: 32 },
    ],
  });
  assert.equal(geometry.zones["title-center"].available, true);
  assert.equal(geometry.zones["workspace-top-center"].available, true);
  assert.equal(geometry.zones["composer-center"].available, true);
  assert.equal(Object.hasOwn(geometry.zones, "workspace-bottom-start"), false);
  assert.equal(Object.hasOwn(geometry.zones, "workspace-bottom-end"), false);
  assert.equal(geometry.rails["composer-bottom"].available, true);
  assert.ok(geometry.zones["workspace-top-center"].rect.top > geometry.zones["title-center"].rect.bottom);
  assert.equal(geometry.zones["workspace-top-center"].rect.top, 42);
  assert.ok(geometry.zones["composer-center"].rect.left >= 600, "composer modules need breathing room after the left native control");
  assert.ok(geometry.zones["composer-center"].rect.right <= 990, "composer modules need breathing room before the right native control");
  assert.equal(
    geometry.zones["composer-center"].rect.top + geometry.zones["composer-center"].rect.height / 2,
    828,
    "composer modules must share the native toolbar center line",
  );
  assert.equal(geometry.rails["composer-bottom"].rect.width, 716);
  assert.equal(geometry.rails["composer-bottom"].rect.top, 854);

  const narrow = placement.computePlacementGeometry({
    viewport: { width: 760, height: 700 },
    sidebar: { left: 0, top: 36, width: 260, height: 664 },
    composer: { left: 276, top: 560, width: 468, height: 128 },
    composerOccupied: [
      { left: 286, top: 654, width: 150, height: 30 },
      { left: 560, top: 654, width: 174, height: 30 },
    ],
  });
  assert.equal(Object.hasOwn(narrow.zones, "workspace-bottom-start"), false);
  assert.equal(Object.hasOwn(narrow.zones, "workspace-bottom-end"), false);
  assert.equal(placement.resolvePrimaryZone({ primary: "workspace-bottom-end" }, narrow), "account-row");
  assert.equal(placement.resolveRailZone({ rail: "composer-bottom" }, narrow), "composer-bottom");
});

test("missing composer geometry fails closed without losing the account row", () => {
  const placement = createPlacementToolkit();
  const geometry = placement.computePlacementGeometry({ viewport: { width: 900, height: 700 } });
  assert.equal(geometry.zones["composer-center"].available, false);
  assert.equal(geometry.rails["composer-bottom"].available, false);
  assert.equal(placement.resolvePrimaryZone({ primary: "composer-center" }, geometry), "account-row");
  assert.equal(placement.resolveRailZone({ rail: "composer-bottom" }, geometry), "account-row");
});
