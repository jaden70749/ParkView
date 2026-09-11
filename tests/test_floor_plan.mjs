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

test("adjacent rotated parking rows keep equal sizes without overlapping", () => {
  const context = loadAppContext();
  vm.runInContext("activeFloorPlanXScale = 1", context);
  const slots = [20, 44, 53, 80].flatMap((cx, row) => Array.from({ length: 15 }, (_, i) => ({
    id: `${row}-${i}`, x: cx - 3, y: 10 + i * 6 - 6,
    w: 6, h: 12, rotation: 90, status: i === 5 ? "occupied" : "available"
  })));
  const before = JSON.stringify(slots);
  const result = context.fitDisplaySlotSizes(slots);
  assert.equal(JSON.stringify(slots), before);
  result.forEach((slot, i) => {
    assert.equal(slot.id, slots[i].id);
    assert.equal(slot.status, slots[i].status);
    assert.ok(Math.abs(slot.x + slot.w/2 - (slots[i].x + slots[i].w/2)) < 1e-9);
    assert.ok(Math.abs(slot.y + slot.h/2 - (slots[i].y + slots[i].h/2)) < 1e-9);
    assert.equal(slot.w, result[0].w);
    assert.equal(slot.h, result[0].h);
    result.slice(i + 1).forEach(other => {
      const dx = Math.abs(slot.x + slot.w/2 - other.x - other.w/2);
      const dy = Math.abs(slot.y + slot.h/2 - other.y - other.h/2);
      assert.ok(dx >= (slot.h+other.h)/2 || dy >= (slot.w+other.w)/2);
    });
  });
});

test("camera plan replaces guessed counts and maps shuffled results only by ID", () => {
  const context = loadAppContext();
  const backups = new Map();
  context.localStorage = { setItem: (key, value) => backups.set(key, value) };
  vm.runInContext(`state.floors = [{name: "1F", slots: Array.from({length:60}, () => ({status:"available"}))}];
    state.floorIndex = 0; state.selectedLot = {id:"lot"};
    refreshParkingStateViews = () => {};`, context);
  const results = Array.from({length:73}, (_, i) => ({
    id: `bay-${i}`, slot_index: 999, status: i === 40 ? "occupied" : "empty", kind: "normal",
    polygon: [[.1,.1],[.2,.1],[.2,.2],[.1,.2]]
  }));
  context.applyServerSlotResults(results);
  let floor = vm.runInContext("state.floors[0]", context);
  assert.equal(floor.slots.length,73);
  assert.equal(floor.layoutSource,"camera_polygons");
  assert.equal(backups.size,1);
  assert.equal(JSON.parse([...backups.values()][0]).slots.length,60);
  const shuffled = results.map(r => ({...r, status:r.id === "bay-3" ? "occupied" : "empty"})).reverse();
  context.applyServerSlotResults(shuffled);
  assert.equal(floor.slots.find(s => s.cameraSlotId === "bay-3").status,"occupied");
  assert.equal(floor.slots.find(s => s.cameraSlotId === "bay-40").status,"available");
  assert.equal(floor.slots[0].cameraSlotId,"bay-0");
  const restored = context.normalizeStoredFloor(JSON.parse(JSON.stringify(floor)));
  assert.equal(restored.layoutSource,"camera_polygons");
  assert.equal(restored.slots[3].cameraSlotId,"bay-3");
  const container = new FakeElement("div");
  context.renderFloorPlan(container, restored, false);
  const groups = container.children[0].children;
  assert.equal(groups.length,73);
  assert.equal(groups[3].attributes.get("data-camera-slot-id"),"bay-3");
  assert.ok(groups[3].attributes.get("class").includes("occupied"));
  assert.equal(context.cameraFloorSlots([results[0],results[0]]),null);
  assert.equal(context.cameraFloorSlots([{...results[0],polygon:[[NaN,0],[1,0],[1,1]]}]),null);
});

test("perspective strips render as four straight top-down columns without losing IDs", () => {
  const context = loadAppContext();
  const slots = [18,19,19,17].flatMap((count,column) => Array.from({length:count},(_,row) => {
    const y = .15+row*.03;
    const cx = [.22,.44,.54,.77][column] + (column-1.5)*row*.001;
    const width = .05+row*.001;
    return { cameraSlotId:`${column}-${row}`,cameraPolygon:[[cx-width/2,y],[cx+width/2,y],
      [cx+width/2,y+.02],[cx-width/2,y+.02]] };
  }));
  const original = JSON.stringify(slots);
  const layout = context.cameraTopDownLayout(slots);
  const reversed = context.cameraTopDownLayout([...slots].reverse());
  assert.equal(layout.placements.size,73);
  assert.equal(new Set([...layout.placements.values()].map(p => p.x)).size,4);
  slots.forEach(slot => {
    const p = layout.placements.get(slot.cameraSlotId);
    assert.equal(p.w,2); assert.equal(p.h,1);
    assert.equal(JSON.stringify(p),JSON.stringify(reversed.placements.get(slot.cameraSlotId)));
  });
  assert.equal(JSON.stringify(slots),original);
});

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

test("CCTV relay headers preserve authentication and bypass the tunnel reminder only on localtunnel", () => {
  const context = loadAppContext();
  context.window.location.href = "https://jaden70749.github.io/ParkView/";
  const relayHeaders = vm.runInContext(
    'cameraApiHeaders("https://odd-areas-move.loca.lt/api/camera/configure", {Authorization: "Bearer test-token", Accept: "application/json"})',
    context
  );
  assert.equal(relayHeaders["bypass-tunnel-reminder"], "true");
  assert.equal(relayHeaders.Authorization, "Bearer test-token");
  assert.equal(relayHeaders.Accept, "application/json");
  for (const url of ["/api/health", "https://camera.example/api/health", "https://loca.lt.evil.example/api/health"]) {
    context.requestUrl = url;
    const headers = vm.runInContext("cameraApiHeaders(requestUrl)", context);
    assert.equal(headers["bypass-tunnel-reminder"], undefined);
  }
});

test("live parking results update only their calibrated lot and floor, preserving unknown slots", () => {
  const context = loadAppContext();
  vm.runInContext(`
    state.selectedLot = { id: "lot-a" };
    state.floorIndex = 0;
    state.floors = [{ name: "B1", slots: [{status:"available"}, {status:"occupied"}] }];
    refreshParkingStateViews = () => {};
  `, context);
  context.detail = {
    lotId: "lot-other", floorId: "B1", analyzedAt: new Date().toISOString(),
    slots: [{ slot_index: 0, status: "occupied" }, { slot_index: 1, status: "unknown" }]
  };
  vm.runInContext("handleCameraSlotResults({detail})", context);
  assert.equal(vm.runInContext("state.floors[0].slots[0].status", context), "available");
  context.detail.lotId = "lot-a";
  context.detail.floorId = "B2";
  vm.runInContext("handleCameraSlotResults({detail})", context);
  assert.equal(vm.runInContext("state.floors[0].slots[0].status", context), "available");
  context.detail.floorId = "B1";
  vm.runInContext("handleCameraSlotResults({detail})", context);
  assert.equal(vm.runInContext("state.floors[0].slots[0].status", context), "occupied");
  assert.equal(vm.runInContext("state.floors[0].slots[1].status", context), "occupied");
  context.detail.slots[0].status = "empty";
  context.detail.analyzedAt = new Date(Date.now() - 60000).toISOString();
  vm.runInContext("handleCameraSlotResults({detail})", context);
  assert.equal(vm.runInContext("state.floors[0].slots[0].status", context), "occupied");
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

test("a wide reference photo prevents a compressed plan and preserves a nine-slot row", () => {
  const context = loadAppContext();
  vm.runInContext(`
    state.planImages = [{ floor: "1F", width: 1600, height: 1000 }];
    wideReferencePlan = {
      floors: [{
        name: "1F",
        aspectRatio: 1.1,
        outline: [{x:4,y:4},{x:96,y:4},{x:96,y:96},{x:4,y:96}],
        zones: [],
        elements: [],
        detectedSlotCount: 9,
        rows: [{
          startX: 18, startY: 18, endX: 82, endY: 18,
          count: 9, w: 6, h: 12, rotation: 0,
          statuses: Array(9).fill("available"),
          kinds: Array(9).fill("normal")
        }]
      }]
    };
  `, context);

  assert.equal(vm.runInContext('floorPlanReferenceAspect("1F")', context), 1.6);
  const floor = vm.runInContext(
    'validateGeneratedFloors(wideReferencePlan, floorPlanReferenceAspect("1F"))[0]',
    context
  );
  assert.equal(floor.aspectRatio, 1.6);
  assert.equal(floor.slots.length, 9);
  assert.equal(floor.slots[8].rowPosition, 8);
});

test("a portrait reference preserves all nineteen spaces in each long row", () => {
  const context = loadAppContext();
  vm.runInContext(`
    state.planImages = [{ floor: "1F", width: 1200, height: 1600 }];
    portraitReferencePlan = {
      floors: [{
        name: "1F",
        aspectRatio: 1.2,
        outline: [{x:4,y:4},{x:96,y:4},{x:96,y:96},{x:4,y:96}],
        zones: [],
        elements: [],
        detectedSlotCount: 76,
        rows: [15, 38, 62, 85].map((x) => ({
          startX: x, startY: 6, endX: x, endY: 94,
          count: 19, w: 4, h: 9, rotation: 90,
          statuses: Array(19).fill("available"),
          kinds: Array(19).fill("normal")
        }))
      }]
    };
  `, context);

  assert.equal(vm.runInContext('floorPlanReferenceAspect("1F")', context), 0.75);
  const floor = vm.runInContext(
    'validateGeneratedFloors(portraitReferencePlan, floorPlanReferenceAspect("1F"))[0]',
    context
  );
  assert.equal(floor.aspectRatio, 0.75);
  assert.equal(floor.slots.length, 76);
  assert.deepEqual(
    Array.from({ length: 4 }, (_, rowIndex) => floor.slots.filter((slot) => slot.rowIndex === rowIndex).length),
    [19, 19, 19, 19]
  );
});

test("floor plan prompts preserve a central driving aisle as empty space", () => {
  assert.match(appSource, /화살표가 놓인 넓은 빈 영역은 명백한 중앙 차로/);
  assert.match(appSource, /두 열의 안쪽 경계 사이 간격을 최소 주차칸 깊이만큼/);
  assert.match(appSource, /차로는 주차열 사이의 빈 공간으로만 표현한다/);
});

test("floor plan prompts count every interval in long parking rows", () => {
  assert.match(appSource, /경계선이 20개면 count는 19/);
  assert.match(appSource, /19칸을 15칸으로 둥글리거나/);
  assert.match(appSource, /세로로 긴 배치는 1보다 작은 비율/);
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
  // Dense opposing rows may constrain the size more than the within-row spacing.
  assert.ok(slotWidth > 0 && slotWidth <= regularSpacings[0]);
  slotBodies.forEach((a, i) => slotBodies.slice(i + 1).forEach(b => {
    const x = Number(a.attributes.get("x")), y = Number(a.attributes.get("y"));
    const bx = Number(b.attributes.get("x")), by = Number(b.attributes.get("y"));
    assert.ok(x + Number(a.attributes.get("width")) <= bx
      || bx + Number(b.attributes.get("width")) <= x
      || y + Number(a.attributes.get("height")) <= by
      || by + Number(b.attributes.get("height")) <= y);
  }));
  assert.ok(
    Math.max(...regularSpacings) - Math.min(...regularSpacings) < 0.001,
    `regular spacings: ${regularSpacings.join(", ")}`
  );
  assert.ok(groupSpacings.every((spacing) => spacing > regularSpacings[0] * 1.35));
  assert.ok(Number(topSlotBodies[0].attributes.get("height")) / slotWidth >= 1.89);
});
