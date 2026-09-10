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
    this.classes = new Set();
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, String(value))
    };
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, force) => {
        if (force === true || (force === undefined && !this.classes.has(name))) {
          this.classes.add(name);
          return true;
        }
        this.classes.delete(name);
        return false;
      },
      contains: (name) => this.classes.has(name)
    };
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
  const sessionValues = new Map();
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
    sessionStorage: {
      getItem(key) {
        return sessionValues.get(key) || null;
      },
      setItem(key, value) {
        sessionValues.set(key, String(value));
      }
    },
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

test("direct camera links are validated without exposing an admin token", () => {
  const context = loadAppContext();
  context.window.location.hostname = "jaden70749.github.io";
  context.cameraLink = "rtsp://camera-user:camera-password@192.168.0.26:554/stream";

  const normalized = vm.runInContext("normalizeCameraLink(cameraLink)", context);
  vm.runInContext("saveDirectCameraLink(normalizeCameraLink(cameraLink))", context);

  assert.equal(normalized, context.cameraLink);
  assert.equal(vm.runInContext("isDirectCameraMode()", context), true);
  assert.equal(vm.runInContext("loadDirectCameraLink()", context), context.cameraLink);
  assert.throws(
    () => vm.runInContext('normalizeCameraLink("javascript:alert(1)")', context),
    /rtsp.*https/
  );
});

test("an iPhone RTSP link launches through VLC without changing the stream to HTTPS", () => {
  const context = loadAppContext();
  context.navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
  context.cameraLink = "rtsp://camera-user:camera-password@192.168.0.26:554/stream";

  const launchUrl = vm.runInContext("directCameraLaunchUrl(cameraLink)", context);
  const encodedStream = launchUrl.split("url=")[1];

  assert.match(launchUrl, /^vlc-x-callback:\/\/x-callback-url\/stream\?url=/);
  assert.equal(decodeURIComponent(encodedStream), context.cameraLink);
  assert.doesNotMatch(launchUrl, /https%3A/i);
});

test("a direct camera link is shown as linked without claiming automatic analysis", () => {
  const context = loadAppContext();
  const elements = {
    cameraConnectionChip: new FakeElement("span"),
    cameraStatus: new FakeElement("strong"),
    cameraIntervalStatus: new FakeElement("strong"),
    analysisStatus: new FakeElement("strong"),
    objectStatus: new FakeElement("p"),
    cameraOpenButton: new FakeElement("button")
  };
  elements.cameraOpenButton.hidden = true;
  context.statusElements = elements;
  vm.runInContext(`
    Object.assign(els, statusElements);
    state.directCameraUrl = "https://camera.example/live.m3u8";
    renderDirectCameraStatus();
  `, context);

  assert.equal(elements.cameraConnectionChip.textContent, "카메라 링크됨");
  assert.equal(elements.cameraStatus.textContent, "직접 연결");
  assert.equal(elements.analysisStatus.textContent, "수동");
  assert.match(elements.objectStatus.textContent, /수동 관리/);
  assert.equal(elements.cameraOpenButton.hidden, false);
});

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
  const slotPositions = [10, 18, 26, 38, 46, 54, 62, 74, 82, 90, 91];
  const statuses = slotPositions.map((_, index) => (index === 4 ? "occupied" : "available"));
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
      { kind: "normal", status, x: slotPositions[index], y: 37, w: 5, h: 10, rotation: 0, rowIndex: index, rowPosition: 0 },
      { kind: "normal", status: "available", x: slotPositions[index], y: 53, w: 5, h: 10, rotation: 0, rowIndex: index + 4, rowPosition: 0 }
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
  assert.equal(slotGroups.length, 22);
  assert.equal(slotGroups.filter((element) => element.attributes.get("class").includes("floor-slot-occupied")).length, 1);
  const footprintPoints = footprint.attributes.get("points").split(" ").map((pair) => pair.split(",").map(Number));
  assert.ok(Math.abs(Math.min(...footprintPoints.map(([x]) => x)) - 9.4) < 0.001);
  assert.ok(Math.abs(Math.max(...footprintPoints.map(([x]) => x)) - 225.6) < 0.001);
  assert.equal(Math.min(...footprintPoints.map(([, y]) => y)), 4);
  assert.equal(Math.max(...footprintPoints.map(([, y]) => y)), 96);
  assert.equal(accessLabels.length, 0);

  const slotBodies = slotGroups
    .map((group) => group.children.find((child) => child.attributes.get("class") === "floor-slot-body"))
    .sort((a, b) => (
      Number(a.attributes.get("y")) + Number(a.attributes.get("height")) / 2
      - Number(b.attributes.get("y")) - Number(b.attributes.get("height")) / 2
    ));
  const topSlotBodies = slotBodies
    .slice(0, slotBodies.length / 2)
    .sort((a, b) => Number(a.attributes.get("x")) - Number(b.attributes.get("x")));
  const slotWidth = Number(topSlotBodies[0].attributes.get("width"));
  const centers = topSlotBodies.map((slot) => Number(slot.attributes.get("x")) + slotWidth / 2);
  const spacings = centers.slice(1).map((center, index) => center - centers[index]);
  const regularSpacings = spacings.filter((_, index) => ![2, 6].includes(index));
  const groupSpacings = spacings.filter((_, index) => [2, 6].includes(index));
  assert.ok(slotWidth / regularSpacings[0] >= 0.88);
  assert.ok(
    Math.max(...regularSpacings) - Math.min(...regularSpacings) < 0.001,
    `regular spacings: ${regularSpacings.join(", ")}`
  );
  assert.ok(groupSpacings.every((spacing) => spacing > regularSpacings[0] * 1.35));
  assert.ok(Number(topSlotBodies[0].attributes.get("height")) / slotWidth >= 1.89);
});
