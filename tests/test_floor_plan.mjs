import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function loadAppContext() {
  const context = {
    AbortController,
    URL,
    clearTimeout,
    console,
    document: { addEventListener() {} },
    fetch,
    navigator: {},
    setTimeout,
    window: {
      PARKVIEW_CONFIG: {},
      location: { hostname: "localhost" }
    }
  };
  vm.createContext(context);
  vm.runInContext(appSource, context);
  return context;
}

test("floor plan keeps a 3-4-4 layout on both sides", () => {
  const context = loadAppContext();
  const segments = [[10, 22, 3], [35, 53, 4], [68, 86, 4]];
  const rows = [22, 78].flatMap((y) => segments.map(([startX, endX, count]) => ({
    startX,
    startY: y,
    endX,
    endY: y,
    count,
    w: 5,
    h: 12,
    rotation: 0,
    statuses: Array(count).fill("available"),
    kinds: Array(count).fill("normal")
  })));
  rows[1].kinds[2] = "disabled";
  rows[2].kinds[3] = "pregnant";

  context.fixture = {
    floors: [{
      name: "1F",
      aspectRatio: 2,
      outline: [{ x: 3, y: 5 }, { x: 97, y: 5 }, { x: 97, y: 95 }, { x: 3, y: 95 }],
      zones: [{ type: "outdoor", points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }] }],
      elements: [
        { type: "entrance", x: 94, y: 45, w: 4, h: 10, rotation: 0, confidence: 0.95 },
        { type: "stripe", x: 4, y: 30, w: 92, h: 5, rotation: 0, confidence: 1 }
      ],
      detectedSlotCount: 99,
      rows
    }]
  };

  const floor = vm.runInContext("validateGeneratedFloors(fixture)[0]", context);
  const rowCounts = Array.from({ length: 6 }, (_, rowIndex) => (
    floor.slots.filter((slot) => slot.rowIndex === rowIndex).length
  ));

  assert.equal(floor.aspectRatio, 2);
  assert.equal(floor.detectedSlotCount, 22);
  assert.equal(floor.slots.length, 22);
  assert.deepEqual(rowCounts, [3, 4, 4, 3, 4, 4]);
  assert.equal(floor.zones.length, 0);
  assert.deepEqual(Array.from(floor.elements, (element) => element.type), ["entrance"]);
  assert.deepEqual(
    Array.from(vm.runInContext("prepareDrawableFloorElements(fixture.floors[0].elements, [])", context), (element) => element.type),
    ["entrance"]
  );
});
