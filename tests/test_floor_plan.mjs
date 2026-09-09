import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, String(value))
    };
    this.classList = { toggle() {} };
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }
}

function loadAppContext() {
  const context = {
    AbortController,
    URL,
    clearTimeout,
    console,
    document: {
      addEventListener() {},
      createElementNS(_namespace, tagName) {
        return new FakeElement(tagName);
      }
    },
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
    Array.from(vm.runInContext("prepareDrawableFloorElements(fixture.floors[0].elements, [], fixture.floors[0].outline)", context), (element) => element.type),
    ["entrance"]
  );
});

test("compressed AI coordinates are fitted to the full drawing area", () => {
  const context = loadAppContext();
  context.compressedFloor = {
    aspectRatio: 2.35,
    outline: [{ x: 4, y: 34 }, { x: 96, y: 34 }, { x: 96, y: 66 }, { x: 4, y: 66 }],
    zones: [],
    elements: [],
    slots: [
      { x: 8, y: 37, w: 5, h: 12, rowIndex: 0, rowPosition: 0 },
      { x: 8, y: 51, w: 5, h: 12, rowIndex: 1, rowPosition: 0 }
    ]
  };

  const fitted = vm.runInContext("fitFloorToDrawingBounds(compressedFloor)", context);
  const xs = Array.from(fitted.outline, (point) => point.x);
  const ys = Array.from(fitted.outline, (point) => point.y);

  assert.equal(Math.min(...xs), 4);
  assert.equal(Math.max(...xs), 96);
  assert.equal(Math.min(...ys), 4);
  assert.equal(Math.max(...ys), 96);
  assert.ok(fitted.slots[1].y - fitted.slots[0].y > 35);
});

test("access labels inside the parking rows are rejected", () => {
  const context = loadAppContext();
  context.falseAccess = [
    { type: "entrance", x: 45, y: 45, w: 5, h: 5, confidence: 0.99 },
    { type: "exit", x: 52, y: 48, w: 5, h: 5, confidence: 0.99 }
  ];
  context.fullOutline = [{ x: 4, y: 4 }, { x: 96, y: 4 }, { x: 96, y: 96 }, { x: 4, y: 96 }];

  const accepted = vm.runInContext(
    "prepareDrawableFloorElements(falseAccess, [], fullOutline)",
    context
  );

  assert.equal(accepted.length, 0);
});

test("rendering a saved compressed floor fills the plan and preserves statuses", () => {
  const context = loadAppContext();
  const container = new FakeElement("div");
  const statuses = ["available", "available", "occupied", "available"];
  context.renderContainer = container;
  context.savedFloor = {
    name: "1F",
    aspectRatio: 2.35,
    outline: [{ x: 4, y: 34 }, { x: 96, y: 34 }, { x: 96, y: 66 }, { x: 4, y: 66 }],
    zones: [],
    elements: [
      { type: "entrance", x: 46, y: 47, w: 5, h: 5, rotation: 0, confidence: 0.99 }
    ],
    slots: statuses.flatMap((status, index) => [
      { kind: "normal", status, x: 10 + index * 12, y: 37, w: 5, h: 10, rotation: 0, rowIndex: 0, rowPosition: index },
      { kind: "normal", status: "available", x: 10 + index * 12, y: 53, w: 5, h: 10, rotation: 0, rowIndex: 1, rowPosition: index }
    ])
  };

  vm.runInContext("renderFloorPlan(renderContainer, savedFloor, false)", context);
  const svg = container.children[0];
  const descendants = [];
  const visit = (element) => {
    descendants.push(element);
    element.children.forEach(visit);
  };
  visit(svg);
  const slotGroups = descendants.filter((element) => (
    element.attributes.get("class")?.includes("floor-slot ")
  ));
  const footprint = descendants.find((element) => element.attributes.get("class") === "floor-footprint");
  const accessLabels = descendants.filter((element) => (
    element.attributes.get("class")?.includes("floor-element-")
  ));

  assert.equal(container.style.values.get("--floor-plan-aspect"), "2.35");
  assert.equal(slotGroups.length, 8);
  assert.equal(slotGroups.filter((element) => element.attributes.get("class").includes("floor-slot-occupied")).length, 1);
  const footprintPoints = footprint.attributes.get("points").split(" ").map((pair) => pair.split(",").map(Number));
  assert.ok(Math.abs(Math.min(...footprintPoints.map(([x]) => x)) - 9.4) < 0.001);
  assert.ok(Math.abs(Math.max(...footprintPoints.map(([x]) => x)) - 225.6) < 0.001);
  assert.equal(Math.min(...footprintPoints.map(([, y]) => y)), 4);
  assert.equal(Math.max(...footprintPoints.map(([, y]) => y)), 96);
  assert.equal(accessLabels.length, 0);
});
