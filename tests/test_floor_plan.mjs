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

  addEventListener(type, handler) {
    this.events ||= {};
    this.events[type] = handler;
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

function descendantsOf(root) {
  return [root, ...root.children.flatMap(descendantsOf)];
}

test("AI generation explains gateway timeouts and always clears its timer", async () => {
  const context = loadAppContext();
  vm.runInContext(`
    timerCleared = false;
    window.setTimeout = () => 123;
    window.clearTimeout = id => { timerCleared = id === 123; };
    fetch = async () => ({ok:false,status:502,json:async()=>({error:"The read operation timed out"})});
  `, context);
  await assert.rejects(vm.runInContext("requestGeminiGeneration({contents:[]})", context), /사진은 유지/);
  assert.equal(context.timerCleared, true);
});

test("AI generation aborts a stalled fetch and offers a retry without dropping photos", async () => {
  const context = loadAppContext();
  vm.runInContext(`
    state.planImages = [{base64:"saved-photo"}];
    timerCleared = false;
    window.setTimeout = callback => { abortRequest = callback; return 123; };
    window.clearTimeout = () => { timerCleared = true; };
    fetch = (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    pendingGeneration = requestGeminiGeneration({contents:[]});
    abortRequest();
  `, context);
  await assert.rejects(context.pendingGeneration, /대기 시간이 초과/);
  assert.equal(vm.runInContext("state.planImages[0].base64", context), "saved-photo");
  assert.equal(context.timerCleared, true);
});

test("AI generation keeps successful JSON and explains non-JSON gateway responses", async () => {
  const context = loadAppContext();
  vm.runInContext(`window.setTimeout = () => 1; window.clearTimeout = () => {};`, context);
  context.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }) });
  const result = await vm.runInContext("requestGeminiGeneration({contents:[]})", context);
  assert.equal(result.candidates[0].content.parts[0].text, "{}");
  context.fetch = async () => ({ ok: false, status: 504, json: async () => { throw Error("HTML gateway response"); } });
  await assert.rejects(vm.runInContext("requestGeminiGeneration({contents:[]})", context), /AI 서버 응답이 늦어/);
});

test("soft floor graphics preserve every bay, source geometry, and all three occupancy states", () => {
  const context = loadAppContext();
  const floor = {
    name: "1F", aspectRatio: 1.6,
    outline: [{ x: 4, y: 4 }, { x: 96, y: 4 }, { x: 96, y: 96 }, { x: 4, y: 96 }],
    elements: [], zones: [],
    slots: Array.from({ length: 12 }, (_, index) => ({
      x: 9 + index % 6 * 14, y: index < 6 ? 10 : 65, w: 8, h: 20, rotation: 0,
      status: ["occupied", "available", "unknown"][index % 3],
      kind: index === 1 ? "disabled" : index === 3 ? "pregnant" : "normal"
    }))
  };
  const original = JSON.stringify(floor);
  context.fixtureFloor = floor;
  context.fixtureContainer = new FakeElement("div");
  vm.runInContext("renderFloorPlan(fixtureContainer, fixtureFloor, false)", context);
  const nodes = descendantsOf(context.fixtureContainer);
  const byClass = name => nodes.filter(node => node.attributes.get("class") === name);
  assert.equal(JSON.stringify(floor), original);
  assert.equal(byClass("floor-slot-body").length, 12);
  assert.deepEqual(byClass("floor-slot-number").map(node => node.textContent), Array.from({ length: 12 }, (_, index) => String(index + 1)));
  assert.equal(byClass("floor-vehicle-mark").length, 4);
  assert.equal(byClass("floor-vehicle-window").length, 8);
  assert.equal(byClass("floor-slot-kind floor-slot-kind-disabled")[0].textContent, "장애인");
  assert.equal(byClass("floor-slot-kind floor-slot-kind-pregnant")[0].textContent, "임산부");
  assert.ok(byClass("floor-slot-body").every(node => Number(node.attributes.get("rx")) > 0));
  const unknown = nodes.filter(node => node.attributes.get("class")?.includes("floor-slot-unknown"));
  assert.equal(unknown.length, 4);
  assert.ok(unknown.every(node => node.attributes.get("aria-label").includes("미확인")));
});

test("slot labels stay upright and their vehicles remain inside rotated or horizontal bays", () => {
  const context = loadAppContext();
  for (const [width, height, rotation] of [[8, 16, 0], [8, 16, 90], [8, 16, -90], [8, 16, 35], [16, 8, 0]]) {
    context.fixtureGroup = new FakeElement("g");
    context.fixtureBox = { x: 10, y: 20, width, height, rotation };
    vm.runInContext('appendFloorSlotGraphics(fixtureGroup, fixtureBox, {status:"occupied",kind:"normal"}, 239)', context);
    const nodes = descendantsOf(context.fixtureGroup);
    const number = nodes.find(node => node.attributes.get("class") === "floor-slot-number");
    const content = nodes.find(node => node.attributes.get("class") === "floor-slot-content");
    const body = nodes.find(node => node.attributes.get("class") === "floor-slot-body");
    const car = nodes.find(node => node.attributes.get("class") === "floor-vehicle-mark");
    assert.equal(number.textContent, "240");
    const contentRotation = content.attributes.get("transform") ? 90 : 0;
    const counterRotation = Number(number.attributes.get("transform").match(/^rotate\(([-\d.]+)/)[1]);
    assert.equal(rotation + contentRotation + counterRotation, 0);
    const cx = Number(body.attributes.get("x")) + Number(body.attributes.get("width")) / 2;
    const cy = Number(body.attributes.get("y")) + Number(body.attributes.get("height")) / 2;
    const carCorners = context.rotatedSlotCorners(
      Number(car.attributes.get("x")) + Number(car.attributes.get("width")) / 2,
      Number(car.attributes.get("y")) + Number(car.attributes.get("height")) / 2,
      Number(car.attributes.get("width")), Number(car.attributes.get("height")), 0
    );
    for (const point of carCorners) {
      const radians = contentRotation * Math.PI / 180;
      const x = cx + (point.x - cx) * Math.cos(radians) - (point.y - cy) * Math.sin(radians);
      const y = cy + (point.x - cx) * Math.sin(radians) + (point.y - cy) * Math.cos(radians);
      assert.ok(x >= Number(body.attributes.get("x")) && x <= Number(body.attributes.get("x")) + Number(body.attributes.get("width")));
      assert.ok(y >= Number(body.attributes.get("y")) && y <= Number(body.attributes.get("y")) + Number(body.attributes.get("height")));
    }
  }
});

test("legacy camera plans use the same numbered graphics without changing camera IDs or polygons", () => {
  const context = loadAppContext();
  const floor = { name: "1F", layoutSource: "camera_polygons", slots: Array.from({ length: 9 }, (_, index) => ({
    cameraSlotId: `bay-${index + 1}`, kind: "normal", status: index === 4 ? "occupied" : "unknown",
    cameraPolygon: [[.1 + index % 3 * .25, .1 + Math.floor(index / 3) * .2], [.2 + index % 3 * .25, .1 + Math.floor(index / 3) * .2],
      [.2 + index % 3 * .25, .2 + Math.floor(index / 3) * .2], [.1 + index % 3 * .25, .2 + Math.floor(index / 3) * .2]]
  })) };
  const original = JSON.stringify(floor);
  context.fixtureFloor = floor;
  context.fixtureContainer = new FakeElement("div");
  vm.runInContext("renderFloorPlan(fixtureContainer, fixtureFloor, false)", context);
  const nodes = descendantsOf(context.fixtureContainer);
  assert.equal(JSON.stringify(floor), original);
  assert.equal(nodes.filter(node => node.attributes.get("class") === "floor-slot-body").length, 9);
  assert.equal(nodes.filter(node => node.attributes.get("class") === "floor-vehicle-mark").length, 1);
  assert.deepEqual(nodes.filter(node => node.attributes.has("data-camera-slot-id")).map(node => node.attributes.get("data-camera-slot-id")), floor.slots.map(slot => slot.cameraSlotId));
});

test("editable floor bays keep mouse and keyboard status changes after restyling", () => {
  const context = loadAppContext();
  const floor = { name: "1F", aspectRatio: 1.6, outline: [], zones: [], elements: [],
    slots: [{ x: 20, y: 20, w: 10, h: 20, rotation: 0, status: "occupied", kind: "normal" }] };
  context.fixtureFloor = floor;
  context.fixtureContainer = new FakeElement("div");
  vm.runInContext(`state.adminView = "registration";
    syncSelectedLotFromAdmin = () => {};
    renderAdminFloor = () => renderFloorPlan(fixtureContainer, fixtureFloor, true);
    renderList = () => {};
    renderMapMarkers = () => {};
    renderAdminFloor();`, context);
  const slot = () => descendantsOf(context.fixtureContainer).find(node => node.attributes.get("class")?.startsWith("floor-slot "));
  const vehicles = () => descendantsOf(context.fixtureContainer).filter(node => node.attributes.get("class") === "floor-vehicle-mark");
  const geometry = JSON.stringify({ ...floor.slots[0], status: null });
  assert.equal(vehicles().length, 1);
  slot().events.click();
  assert.equal(floor.slots[0].status, "available");
  assert.equal(vehicles().length, 0);
  let prevented = false;
  slot().events.keydown({ key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(floor.slots[0].status, "occupied");
  assert.equal(vehicles().length, 1);
  assert.equal(JSON.stringify({ ...floor.slots[0], status: null }), geometry);
});

test("hosted page enables RTSP input and requires the administrator token", async () => {
  const context = loadAppContext();
  context.window.location.hostname = "parkview.example";
  context.window.setTimeout = () => 0;
  const cameraOpenButton = Object.assign(new FakeElement("button"), {
    hidden: true,
    querySelector: () => ({ textContent: "" })
  });
  context.statusElements = {
    cameraConnectionForm: { hidden: true },
    cameraSetupToggle: new FakeElement("button"),
    cameraRtspUrl: Object.assign(new FakeElement("input"), {
      disabled: true,
      value: "rtsp://camera.example/stream",
      focus() {}
    }),
    cameraConnectButton: Object.assign(new FakeElement("button"), {
      disabled: true,
      querySelector: () => ({ textContent: "" })
    }),
    cameraAdminTokenField: { hidden: false },
    cameraAdminToken: { value: "", focus() {} },
    cameraOpenButton,
    cameraConnectFeedback: new FakeElement("p"),
    cameraConnectionChip: new FakeElement("span"),
    cameraStatus: new FakeElement("strong"),
    cameraIntervalStatus: new FakeElement("strong"),
    analysisStatus: new FakeElement("strong"),
    objectStatus: new FakeElement("p")
  };
  vm.runInContext("Object.assign(els, statusElements); toggleCameraConnectionForm()", context);
  context.statusElements.cameraRtspUrl.value = "rtsp://camera.example/stream";

  assert.equal(context.statusElements.cameraRtspUrl.disabled, false);
  assert.equal(context.statusElements.cameraConnectButton.disabled, false);
  await vm.runInContext("connectCameraFromAdmin({preventDefault() {}})", context);
  assert.equal(vm.runInContext("state.directCameraUrl", context), "");
  assert.match(context.statusElements.cameraConnectFeedback.textContent, /관리자 토큰/);
});

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

test("camera results preserve the original floor plan and restore a previously replaced plan", () => {
  const context = loadAppContext();
  const backups = new Map();
  context.localStorage = {
    getItem: key => backups.get(key) || null,
    setItem: (key, value) => backups.set(key, value)
  };
  vm.runInContext(`state.floors = [{name: "1F", layoutSource: "camera_polygons", slots: Array.from({length:73}, (_, i) => ({
      cameraSlotId: "bay-"+i, cameraPolygon: [[.1,.1],[.2,.1],[.2,.2],[.1,.2]],
      x: i, y: 0, w: 2, h: 1, rotation: 0, status: "available"
    }))}];
    state.floorIndex = 0; state.selectedLot = {id:"lot"};
    refreshParkingStateViews = () => {};`, context);
  const original = {
    name: "1F", layoutSource: null, aspectRatio: 1.4, outline: [], zones: [], elements: [],
    slots: Array.from({length:60}, (_, i) => ({
      x: 10+(i%10)*7, y: 10+Math.floor(i/10)*12, w: 5, h: 10,
      rotation: 90, kind: "normal", status: "available"
    }))
  };
  backups.set("parkview-plan-backup:lot:1F", JSON.stringify(original));
  const results = Array.from({length:73}, (_, i) => ({
    id: `bay-${i}`, slot_index: i, status: i === 40 ? "occupied" : "empty", kind: "normal",
    polygon: [[.1,.1],[.2,.1],[.2,.2],[.1,.2]]
  }));
  context.applyServerSlotResults(results);
  const restored = vm.runInContext("state.floors[0]", context);
  assert.equal(restored.slots.length,60);
  assert.equal(restored.layoutSource,null);
  assert.equal(restored.slots[0].x,10);
  assert.equal(restored.slots[0].rotation,90);
  assert.equal(restored.slots[40].status,"occupied");
  assert.equal(restored.slots[41].status,"available");
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

test("console occupancy is numbered, distinguishes unknown, and deduplicates repeated frames", () => {
  const context = loadAppContext();
  const lines = [];
  context.console = { log: message => lines.push(message) };
  const slots = [{slot_index:2,status:"occupied"},{slot_index:0,status:"empty"},{slot_index:1,status:"unknown"}];
  context.logParkingOccupancy(slots,"lot","1F","frame1");
  context.logParkingOccupancy(slots,"lot","1F","frame1");
  assert.equal(lines.length,1);
  assert.match(lines[0], /1: 0, 2: \?, 3: 1$/);
  context.logParkingOccupancy(slots,"lot","1F","frame2");
  assert.equal(lines.length,2);
  assert.equal(slots[0].slot_index,2);
});

test("deployed camera links use the protected camera API", () => {
  const context = loadAppContext();
  context.window.location.hostname = "jaden70749.github.io";
  context.cameraLink = "rtsp://camera-user:camera-password@192.168.0.26:554/stream";

  const normalized = vm.runInContext("normalizeCameraLink(cameraLink)", context);
  vm.runInContext("saveDirectCameraLink(normalizeCameraLink(cameraLink))", context);

  assert.equal(normalized, context.cameraLink);
  assert.equal(vm.runInContext("isDirectCameraMode()", context), false);
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

test("a wide photo does not override the measured parking aspect or lose bays", () => {
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
  assert.equal(floor.aspectRatio, 1.1);
  assert.equal(floor.slots.length, 9);
  assert.equal(floor.slots[8].rowPosition, 8);
});

test("a portrait photo does not force a portrait floor and preserves all row counts", () => {
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
  assert.equal(floor.aspectRatio, 1.2);
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

function countedRowsFixture() {
  const counts = [12, 8, 8, 12, 8];
  const inventory = { total: 48, rows: counts.map((count, index) => ({
    id: `row-${index}`, count,
    boundaryPositions: Array.from({ length: count + 1 }, (_, i) => i * 100 / count),
    kinds: Array.from({ length: count }, (_, i) => index === 0 && i < 2 ? "disabled" : index === 0 && [4, 5].includes(i) ? "pregnant" : "normal"),
    statuses: Array(count).fill("available")
  })) };
  const rows = inventory.rows.map((row, index) => ({ rowId: row.id, count: row.count,
    startX: index === 4 ? 20 : 12 + index * 24, startY: index === 4 ? 90 : 8,
    endX: index === 4 ? 80 : 12 + index * 24, endY: index === 4 ? 90 : index % 3 ? 63 : 78,
    w: 3.5, h: 7, rotation: index === 4 ? 0 : 90, kinds: [...row.kinds], statuses: [...row.statuses] }));
  return { inventory, plan: { floors: [{ name: "1F", aspectRatio: 0.75,
    detectedSlotCount: 48, outline: [{x:2,y:2},{x:98,y:2},{x:98,y:98},{x:2,y:98}], rows }] } };
}

test("a manual count is enforced per floor, even while the form is disabled for generation", () => {
  const context = loadAppContext();
  vm.runInContext(`
    els.registerTotalSpaces = {value:"46",disabled:true};
    document.querySelector = () => ({checked:false});
  `, context);
  assert.equal(vm.runInContext("requestedPlanCount()", context), 46);
  assert.throws(() => vm.runInContext('validateRequestedPlanCounts([{name:"1F",slots:Array(31)}])', context), /46면.*31면/);
  assert.throws(() => vm.runInContext('validateRequestedPlanCounts([{name:"1F",slots:Array(46)},{name:"2F",slots:Array(45)}])', context), /2F/);
  vm.runInContext('validateRequestedPlanCounts([{name:"1F",slots:Array(46)}]); document.querySelector = () => ({checked:true});', context);
  assert.equal(vm.runInContext("requestedPlanCount()", context), null);
});

test("an older 31-bay preview cannot be saved when 46 bays were entered", () => {
  const context = loadAppContext();
  vm.runInContext(`
    els.registerTotalSpaces = {value:"46"}; els.geminiStatus = {};
    state.floors = [{name:"1F",slots:Array(31)}]; state.planGenerated = true;
    setRegistrationStep = step => { state.registrationStep = step; };
    saveRegisteredLot();
  `,context);
  assert.equal(vm.runInContext("state.planGenerated",context),false);
  assert.equal(vm.runInContext("state.registrationStep",context),2);
  assert.match(vm.runInContext("els.geminiStatus.textContent",context),/46면.*31면/);
});

function inventoryWithCounts(counts) {
  return {total:counts.reduce((a,b)=>a+b,0),rows:counts.map((count,index)=>({
    id:`r${index}`,count,boundaryPositions:Array.from({length:count+1},(_,i)=>i*100/count),
    kinds:Array(count).fill("normal"),statuses:Array(count).fill("available")
  }))};
}

test("46 entered versus 31 detected triggers one recount and never completes an undercounted plan", async () => {
  const context = loadAppContext();
  context.inventory = inventoryWithCounts([8,6,6,8,3]);
  vm.runInContext(`
    els.registerTotalSpaces = {value:"46",disabled:true};
    els.geminiStatus = {};
    state.planImages = [{floor:"1F",base64:"photo",mimeType:"image/jpeg",width:1800,height:2400}];
    planDetailImageParts = async () => [];
    requests = [];
    requestGeminiGeneration = async payload => {
      requests.push(payload);
      return {candidates:[{content:{parts:[{text:JSON.stringify(inventory)}]}}]};
    };
  `, context);
  await assert.rejects(vm.runInContext('generatePlanWithGemini("1F",0,1)', context), /46면.*31면/);
  assert.equal(context.requests.length, 2);
  assert.match(context.requests[0].contents[0].parts[0].text, /46면/);
  assert.equal(vm.runInContext("state.planImages.length", context), 1);
});

test("a corrected census produces exactly 46 bays without padding or redistributing the rows", async () => {
  const context = loadAppContext();
  const inventory = inventoryWithCounts([12,8,8,12,6]);
  const plan = countedRowsFixture().plan;
  plan.floors[0].detectedSlotCount = 46;
  plan.floors[0].rows.forEach((row,index)=>{
    row.rowId=inventory.rows[index].id;
    row.count=inventory.rows[index].count;
    row.kinds=inventory.rows[index].kinds;
    row.statuses=inventory.rows[index].statuses;
  });
  context.responses = [inventoryWithCounts([8,6,6,8,3]),inventory,plan];
  vm.runInContext(`
    els.registerTotalSpaces = {value:"46",disabled:true};
    els.registerDisabledSpaces = {value:"0"}; els.registerPregnantSpaces = {value:"0"};
    els.planPrompt = {value:""}; els.geminiStatus = {};
    state.planImages = [{floor:"1F",base64:"photo",mimeType:"image/jpeg",width:1800,height:2400}];
    planDetailImageParts = async () => [];
    requestGeminiGeneration = async () => ({candidates:[{content:{parts:[{text:JSON.stringify(responses.shift())}]}}]});
  `, context);
  const floors = await vm.runInContext('generatePlanWithGemini("1F",0,1)',context);
  assert.equal(floors[0].slots.length,46);
  assert.deepEqual([0,1,2,3,4].map(index=>floors[0].slots.filter(slot=>slot.rowIndex===index).length),[12,8,8,12,6]);
});

test("different floor shapes keep their own aspect without a fixed photo-shaped range", () => {
  const context = loadAppContext();
  for(const ratio of [0.25,0.75,1,2.4,4.5]) {
    assert.equal(vm.runInContext(`reconcileFloorAspectRatio(${ratio},1.6)`,context),ratio);
  }
  assert.doesNotMatch(appSource,/최종 aspectRatio도 이 값에서 15%/);
});

test("independent boundary inventory preserves unequal row counts and special bay positions", () => {
  const context = loadAppContext();
  Object.assign(context, countedRowsFixture());
  const floor = vm.runInContext("validateGeneratedFloors(plan, 0.75, validatePlanInventory(inventory))[0]", context);
  assert.equal(floor.slots.length, 48);
  assert.deepEqual(Array.from({ length: 5 }, (_, index) => floor.slots.filter(s => s.rowIndex === index).length), [12, 8, 8, 12, 8]);
  assert.deepEqual(Array.from(floor.slots.slice(0, 6), s => s.kind), ["disabled", "disabled", "normal", "normal", "pregnant", "pregnant"]);
});

test("missing rows, shortened rows and changed special-bay order cannot become a successful plan", () => {
  for (const mutate of [
    fixture => fixture.plan.floors[0].rows.pop(),
    fixture => fixture.plan.floors[0].rows[0].count--,
    fixture => fixture.plan.floors[0].rows[0].kinds[2] = "pregnant",
    fixture => fixture.plan.floors[0].detectedSlotCount--
  ]) {
    const context = loadAppContext();
    const fixture = countedRowsFixture();
    mutate(fixture);
    Object.assign(context, fixture);
    assert.throws(() => vm.runInContext("validateGeneratedFloors(plan, 0.75, inventory)", context));
  }
});

test("an incomplete boundary inventory and truncated AI responses are rejected", () => {
  const context = loadAppContext();
  const { inventory } = countedRowsFixture();
  inventory.rows[0].boundaryPositions.pop();
  context.inventory = inventory;
  assert.throws(() => vm.runInContext("validatePlanInventory(inventory)", context), /구획선/);
  assert.throws(() => vm.runInContext('parseGeminiPlanResponse({candidates:[{finishReason:"MAX_TOKENS"}]})', context), /중간에 끊겼습니다/);
});

test("distinct bay IDs are not silently discarded when normalized coordinates coincide", () => {
  const context = loadAppContext();
  context.slots = [0, 1].map(rowPosition => ({ x: 10, y: 10, w: 5, h: 10, rowIndex: 0, rowPosition }));
  assert.throws(() => vm.runInContext("preserveGeneratedLayout(slots)", context), /같은 좌표/);
});

test("overlapping detail crops cover the entire photo including its outermost corners", () => {
  const context = loadAppContext();
  const regions = vm.runInContext("planDetailRegions()", context);
  assert.equal(regions.length, 4);
  for (let y = 0; y <= 1; y += 0.05) for (let x = 0; x <= 1; x += 0.05) {
    assert.ok(regions.some(r => x >= r.x - 0.0001 && x <= r.x + r.w + 0.0001 && y >= r.y - 0.0001 && y <= r.y + r.h + 0.0001));
  }
});

test("generation uses a separate census and does not fall back to an undercounted draft", async () => {
  const context = loadAppContext();
  const fixture = countedRowsFixture();
  fixture.plan.floors[0].rows[0].count = 8;
  context.responses = [fixture.inventory, fixture.plan];
  vm.runInContext(`
    state.planImages = [{floor:"B1",width:1800,height:2400,base64:"test",mimeType:"image/jpeg"}];
    els.planPrompt = {value:""}; els.geminiStatus = {};
    planDetailImageParts = async () => [];
    callCount = 0;
    requestGeminiGeneration = async payload => {
      callCount++;
      if (callCount === 1 && !payload.generationConfig.responseSchema.properties.total) throw Error("missing census");
      if (callCount === 3) throw Error("review service offline");
      return {candidates:[{content:{parts:[{text:JSON.stringify(responses.shift())}]}}]};
    };
  `, context);
  await assert.rejects(vm.runInContext('generatePlanWithGemini("B1",0,1)', context), /review service offline/);
  assert.equal(context.callCount, 3);
});

test("a complete counted plan finishes in two requests with every bay preserved", async () => {
  const context = loadAppContext();
  const fixture = countedRowsFixture();
  context.responses = [fixture.inventory, fixture.plan];
  vm.runInContext(`
    state.planImages = [{floor:"B1",width:1800,height:2400,base64:"test",mimeType:"image/jpeg"}];
    els.planPrompt = {value:""}; els.geminiStatus = {};
    planDetailImageParts = async () => [];
    callCount = 0;
    requestGeminiGeneration = async () => {
      callCount++;
      return {candidates:[{content:{parts:[{text:JSON.stringify(responses.shift())}]}}]};
    };
  `, context);
  const floors = await vm.runInContext('generatePlanWithGemini("B1",0,1)', context);
  assert.equal(context.callCount, 2);
  assert.equal(floors[0].slots.length, 48);
});

test("fitting uses a uniform scale rather than stretching compressed coordinates", () => {
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
  assert.equal(Math.min(...ys), 34);
  assert.equal(Math.max(...ys), 66);
  assert.equal(fitted.slots[1].y - fitted.slots[0].y, 14);
  assert.equal(fitted.slots[0].w / fitted.slots[0].h, 5 / 12);
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

test("rendering a saved compressed floor preserves its geometry and statuses", () => {
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
  assert.equal(Math.min(...footprintPoints.map(([, y]) => y)), 34);
  assert.equal(Math.max(...footprintPoints.map(([, y]) => y)), 66);
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
