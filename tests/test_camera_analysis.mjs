import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  createLetterboxTransform,
  decodeYoloOutput,
  imageDataToTensorData,
  intersectionOverUnion,
  matchCameraSlots,
  matchedCameraDetections,
  stabilizeCameraSlots
} from "../camera-analysis-core.js";

test("YOLO keeps every detected object class for parking occupancy", () => {
  const data = new Float32Array(84 * 2);
  for (let i = 0; i < 2; i++) {
    data[i] = 200 + i * 200; data[2 + i] = 300;
    data[4 + i] = 100; data[6 + i] = 120;
  }
  data[6 * 2] = 0.8; // car (class 2)
  data[4 * 2 + 1] = 0.99; // person (class 0)
  const result = decodeYoloOutput({ dims: [1, 84, 2], data }, createLetterboxTransform(640, 640), 0.25, 0.45);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((detection) => detection.classIndex).sort((a, b) => a - b), [0, 2]);
});

test("camera polygons map any YOLO object to the occupied bay without counting the adjacent empty bay", () => {
  const config = { coordinate_system: "normalized_camera_image", slots: [
    { id: "left", slot_index: 0, polygon: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] },
    { id: "right", slot_index: 1, polygon: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]] }
  ] };
  const detections = [
    { classIndex: 0, score: 0.99, bbox: [650, 100, 200, 300] },
    { classIndex: 56, score: 0.95, bbox: [1100, 100, 100, 100] }
  ];
  const results = matchCameraSlots(detections, config, 1000, 500);
  assert.deepEqual(results.map((slot) => slot.status), ["empty", "occupied"]);
  assert.equal(results[1].matched_detection, 0);
  assert.deepEqual(matchedCameraDetections(detections, results), [
    { ...detections[0], slotIndex: 1 }
  ]);
  assert.deepEqual(matchCameraSlots([], null, 1000, 500), []);
  assert.deepEqual(matchCameraSlots([], { ...config, coordinate_system: "normalized_plan" }, 1000, 500), []);
});

test("availability starts unknown and short missed detections do not clear an occupied bay", () => {
  const history = new Map();
  const empty = [{ id: "one", status: "empty" }];
  assert.equal(stabilizeCameraSlots(empty, history)[0].status, "unknown");
  assert.equal(stabilizeCameraSlots(empty, history)[0].status, "unknown");
  assert.equal(stabilizeCameraSlots(empty, history)[0].status, "empty");
  assert.equal(stabilizeCameraSlots([{ id: "one", status: "occupied" }], history)[0].status, "occupied");
  assert.equal(stabilizeCameraSlots(empty, history)[0].status, "occupied");
  assert.equal(stabilizeCameraSlots(empty, history)[0].status, "occupied");
  assert.equal(stabilizeCameraSlots(empty, history)[0].status, "empty");
});

test("letterbox preserves a 16:9 image without stretching", () => {
  const transform = createLetterboxTransform(1280, 720, 640);
  assert.equal(transform.resizedWidth, 640);
  assert.equal(transform.resizedHeight, 360);
  assert.equal(transform.padLeft, 0);
  assert.equal(transform.padTop, 140);
  assert.equal(transform.scaleX, 0.5);
  assert.equal(transform.scaleY, 0.5);
});

test("RGBA image data is converted to normalized RGB channels", () => {
  const tensor = imageDataToTensorData({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([255, 128, 0, 255])
  });
  assert.deepEqual(Array.from(tensor), [1, Math.fround(128 / 255), 0]);
});

test("YOLO channel-first output is mapped back to source coordinates and deduplicated", () => {
  const transform = createLetterboxTransform(640, 360, 640);
  const output = {
    dims: [1, 5, 2],
    data: new Float32Array([
      320, 322,
      320, 322,
      100, 100,
      100, 100,
      0.9, 0.8
    ])
  };
  const detections = decodeYoloOutput(output, transform, 0.25, 0.45);
  assert.equal(detections.length, 1);
  assert.ok(Math.abs(detections[0].bbox[0] - 270) < 0.001);
  assert.ok(Math.abs(detections[0].bbox[1] - 130) < 0.001);
});

test("intersection over union handles separate and identical boxes", () => {
  assert.equal(intersectionOverUnion([0, 0, 10, 10], [20, 20, 5, 5]), 0);
  assert.equal(intersectionOverUnion([3, 4, 10, 12], [3, 4, 10, 12]), 1);
});

test("device camera analysis is integrated into parking management", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="deviceCameraToggle"/);
  assert.match(html, /id="deviceCameraPanel"/);
  assert.match(html, /id="deviceStartCameraButton"/);
  assert.match(html, /id="deviceStartCameraButton"[\s\S]*?바로 분석하기/);
  assert.doesNotMatch(html, />\s*전환\s*</);
  assert.doesNotMatch(html, />\s*사진·영상\s*</);
  assert.doesNotMatch(html, />\s*중지\s*</);
  assert.match(html, /camera-analysis\.js\?v=\d+/);
  assert.doesNotMatch(html, /href="\.\/camera-analysis\.html"/);
});

test("deployed camera analysis uses the self-hosted WASM runtime", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const buildScript = await readFile(new URL("../scripts/prepare-mobile-web.mjs", import.meta.url), "utf8");
  assert.match(html, /vendor\/onnxruntime\/ort\.wasm\.bundle\.js/);
  assert.match(buildScript, /ort\.wasm\.bundle\.min\.mjs/);
  assert.match(buildScript, /ort-wasm-simd-threaded\.wasm/);
  assert.doesNotMatch(html, /vendor\/onnxruntime\/ort\.min\.js/);
});

test("iPhone CCTV bridge converts RTSP input to snapshot analysis", async () => {
  const bridge = await readFile(new URL("../native-bridge-source.js", import.meta.url), "utf8");
  const camera = await readFile(new URL("../camera-analysis.js", import.meta.url), "utf8");
  const plugin = await readFile(new URL("../ios/App/App/ParkViewCctvPlugin.swift", import.meta.url), "utf8");
  assert.match(bridge, /registerPlugin\("ParkViewCctv"\)/);
  assert.match(bridge, /parkview:cctv-frame/);
  assert.match(camera, /sourceType = "cctv"/);
  assert.match(plugin, /ISAPI\/Streaming\/channels\/\\\(channel\)\/picture/);
  assert.match(plugin, /URLSessionConfiguration\.ephemeral/);
});

async function cameraButtonHarness({ relay = true, enteredToken = "", savedToken = "saved-test-token", status = 200 } = {}) {
  const source = await readFile(new URL("../camera-analysis.js", import.meta.url), "utf8");
  const elements = new Map();
  const requests = [];
  const timers = [];
  let permissionRequests = 0;
  function element() {
    return {
      handlers: {}, hidden: true, disabled: false, textContent: "", value: "",
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(name, handler) { this.handlers[name] = handler; },
      setAttribute() {}, removeAttribute() {}, pause() {}, load() {}, play: async () => {},
      getContext: () => ({ drawImage() {} }),
      complete: true, naturalWidth: 1920, naturalHeight: 1080,
      readyState: 1, videoWidth: 1280
    };
  }
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    createElement: element
  };
  document.querySelector("#cameraAdminToken").value = enteredToken;
  const context = vm.createContext({
    document, DEFAULT_CONFIDENCE: 0.25, MODEL_INPUT_SIZE: 640,
    matchCameraSlots, matchedCameraDetections, stabilizeCameraSlots,
    window: {
      location: { hostname: "jaden70749.github.io", href: "https://jaden70749.github.io/ParkView/" },
      PARKVIEW_CONFIG: { cameraApiBaseUrl: relay ? "https://odd-areas-move.loca.lt" : "" },
      addEventListener() {}, clearTimeout() {}, setTimeout(callback) { timers.push(callback); return timers.length; }
    },
    sessionStorage: { getItem: () => savedToken },
    navigator: { mediaDevices: { getUserMedia: async () => { permissionRequests++; return { getTracks: () => [] }; } } },
    fetch: async (url, options) => {
      if (url.endsWith("/api/regions")) return { ok: true, json: async () => ({ slots: [] }) };
      requests.push({ url, options });
      return { ok: status === 200, status, blob: async () => ({}), json: async () => ({}) };
    },
    URL: { createObjectURL: () => "blob:test-frame", revokeObjectURL() {} },
    HTMLVideoElement: class {}, HTMLMediaElement: { HAVE_METADATA: 1 },
    cancelAnimationFrame() {}, requestAnimationFrame: () => 1
  });
  vm.runInContext(source.replace(/^import\s*\{[\s\S]*?\}\s*from\s*"\.\/camera-analysis-core\.js(?:\?v=\d+)?";\s*/, ""), context);
  // Exercise the real click, source selection, authentication and frame flow;
  // ONNX execution is covered separately by the model tests.
  vm.runInContext("loadModel = async () => ({}); analyzeCurrentFrame = async () => {}; runContinuousAnalysis = async () => {};", context);
  return { context, elements, requests, timers, permissionRequests: () => permissionRequests,
    click: () => elements.get("#deviceStartCameraButton").handlers.click() };
}

test("camera button on GitHub Pages receives a relay frame and schedules the next frame", async () => {
  const h = await cameraButtonHarness();
  await h.click();
  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].url, /^https:\/\/odd-areas-move\.loca\.lt\/api\/camera\/preview\?t=/);
  assert.equal(h.requests[0].options.headers.Authorization, "Bearer saved-test-token");
  assert.equal(h.requests[0].options.headers["bypass-tunnel-reminder"], "true");
  assert.equal(h.elements.get("#deviceViewportPlaceholder").hidden, true);
  assert.equal(h.elements.get("#deviceSourceBadge").textContent, "고정 CCTV");
  assert.equal(h.permissionRequests(), 0);
  assert.equal(h.timers.length, 1);
  await h.timers[0]();
  assert.equal(h.requests.length, 2);
});

test("camera button uses the newly entered token even before it is saved", async () => {
  const h = await cameraButtonHarness({ enteredToken: "new-test-token" });
  await h.click();
  assert.equal(h.requests[0].options.headers.Authorization, "Bearer new-test-token");
});

test("loading a floor reads only its coordinates and never automatically overwrites them", async () => {
  const h = await cameraButtonHarness();
  h.context.window.PARKVIEW_ACTIVE_FLOOR_CONTEXT = {
    lotId: "lot-1",
    floorId: "1F",
    slots: [
      { kind: "normal", x: 10, y: 20, w: 8, h: 16, rotation: 0 },
      { kind: "disabled", x: 30, y: 20, w: 8, h: 16, rotation: 0 }
    ]
  };

  await vm.runInContext(
    'loadCameraRegions("https://odd-areas-move.loca.lt/api/camera/preview", "saved-test-token")',
    h.context
  );

  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "https://odd-areas-move.loca.lt/api/regions?lot_id=lot-1&floor_id=1F");
  assert.equal(h.requests[0].options.method, undefined);
  assert.equal(h.requests[0].options.headers.Authorization, "Bearer saved-test-token");
});

test("unauthorized CCTV displays the token setup instruction without starting polling", async () => {
  const h = await cameraButtonHarness({ savedToken: "", status: 401 });
  await h.click();
  assert.match(h.elements.get("#deviceAnalysisStatus").textContent, /고정 CCTV 설정.*관리자 토큰/);
  assert.equal(h.requests[0].options.headers.Authorization, undefined);
  assert.equal(h.timers.length, 0);
  assert.equal(h.elements.get("#deviceStartCameraButton").disabled, false);
});

test("GitHub Pages without a CCTV relay can request the device camera", async () => {
  const h = await cameraButtonHarness({ relay: false });
  await h.click();
  assert.equal(h.permissionRequests(), 1);
  assert.equal(h.requests.length, 0);
  assert.equal(vm.runInContext("state.sourceType", h.context), "camera");
});
