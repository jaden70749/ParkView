import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../calibrate.js", import.meta.url), "utf8");
const matching = source.slice(source.indexOf("function pointInCameraPolygon("), source.indexOf("function renderMatchingPlan("));
test("plan linking swaps occupied target numbers without changing camera polygons", () => {
  const state = { selected: 0, slots: [
    { id: "1F-001", slot_index: 0, polygon: [[0,0],[1,0],[1,1],[0,1]] },
    { id: "1F-002", slot_index: 1, polygon: [[.1,.1],[.2,.1],[.2,.2],[.1,.2]] }
  ] };
  const original = JSON.stringify(state.slots.map(s => s.polygon));
  const context = vm.createContext({ state, els: { slotNumber: {}, saveStatus: {} },
    window: { confirm: () => true }, currentFloorId: () => "1F", render() {} });
  vm.runInContext(matching, context);
  context.connectPlanSlot(1, 2);
  assert.deepEqual(state.slots.map(s => s.slot_index), [1,0]);
  assert.deepEqual(state.slots.map(s => s.id), ["1F-002","1F-001"]);
  assert.equal(JSON.stringify(state.slots.map(s => s.polygon)), original);
  context.connectPlanSlot(20, 2);
  assert.deepEqual(state.slots.map(s => s.slot_index), [1,0]);
  assert.equal(context.pointInCameraPolygon([.5,.5], state.slots[0].polygon), true);
  assert.equal(context.pointInCameraPolygon([2,2], state.slots[0].polygon), false);
});

test("declined mapping swap preserves both existing links", () => {
  const state = { selected: 0, slots: [{ id: "1F-001", slot_index: 0 },{ id: "1F-002", slot_index: 1 }] };
  const context = vm.createContext({ state, window: { confirm: () => false } });
  vm.runInContext(matching, context);
  context.connectPlanSlot(1, 2);
  assert.deepEqual(state.slots.map(s => s.slot_index), [0,1]);
});
const detection = source.slice(source.indexOf("async function detectRegions()"), source.indexOf("function addCompletedSlot()"));
function harness({ slots = [], confirm = true, fail = false, cameraFrame = false } = {}) {
  let requests = 0;
  let lastRequest = null;
  const state = { slots, roi: null, image: { naturalWidth: 100, naturalHeight: 100 }, points: [], cameraFrame };
  const els = { detectButton: { disabled: false }, adminToken: { value: "test-token" },
    saveStatus: {}, sourceStatus: {} };
  const context = vm.createContext({ state, els, setupLotId: "test-lot", AbortSignal, URL,
    window: { confirm: () => confirm, location: { href: "https://parkview.example/calibrate.html" } }, render() {}, regionsUrl: () => "/api/regions/detect",
    authHeaders: (headers = {}) => headers,
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: fn => fn({}) }) },
    fetch: async (url, options) => { requests++; lastRequest = { url, options }; if (fail) throw new Error("offline");
      return { ok: true, json: async () => ({ slots: [{ id: "detected" }] }) }; }
  });
  vm.runInContext(detection, context);
  return { state, els, run: () => context.detectRegions(), requests: () => requests, lastRequest: () => lastRequest };
}

test("missing detection region is explained next to the detection button", async () => {
  const h = harness();
  await h.run();
  assert.match(h.els.sourceStatus.textContent, /감지 구역/);
  assert.equal(h.requests(), 0);
});

test("one large accidental parking bay can become the search region without deleting coordinates", async () => {
  const original = { polygon: [[0,0],[1,0],[1,1],[0,1]] };
  const h = harness({ slots: [original] });
  await h.run();
  assert.equal(h.requests(), 1);
  assert.equal(h.state.slots[0], original);
  assert.equal(h.state.candidates.length, 1);
  assert.match(h.els.sourceStatus.textContent, /1면 감지됨/);
  assert.equal(h.els.detectButton.disabled, false);
});

test("declining region conversion does not send or save anything", async () => {
  const h = harness({ slots: [{ polygon: [[0,0],[1,0],[1,1],[0,1]] }], confirm: false });
  await h.run();
  assert.equal(h.requests(), 0);
  assert.equal(h.state.roi, null);
});

test("network failure is visible and the button is enabled again", async () => {
  const h = harness({ fail: true });
  h.state.roi = [[0,0],[1,0],[1,1],[0,1]];
  await h.run();
  assert.match(h.els.sourceStatus.textContent, /offline/);
  assert.equal(h.els.detectButton.disabled, false);
});

test("CCTV region detection reuses the server frame instead of uploading the image", async () => {
  const h = harness({ cameraFrame: true });
  h.state.roi = [[0,0],[1,0],[1,1],[0,1]];
  await h.run();
  assert.match(h.lastRequest().url, /source=camera/);
  assert.equal(h.lastRequest().options.body, undefined);
});

test("new calibration opens in region selection mode", () => {
  assert.match(source, /mode: "region"/);
});

test("hosted calibration uses the configured camera API without a local redirect", () => {
  assert.match(source, /window\.PARKVIEW_CONFIG\?\.cameraApiBaseUrl/);
  assert.doesNotMatch(source, /127\.0\.0\.1:5180/);
  assert.doesNotMatch(source, /window\.location\.replace/);
});

test("management calibration link remains on the current deployment", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /new URL\("\.\/calibrate\.html", window\.location\.href\)/);
  assert.doesNotMatch(app, /isLocalCameraHost/);
});

const training = source.slice(source.indexOf("function defaultTrainingGroup()"), source.indexOf("function authHeaders("));
function trainingHarness({ group = "", error = "" } = {}) {
  const nodes = {
    "#trainingSampleButton": { disabled: false }, "#trainingGroup": { value: group },
    "#trainingSplit": { value: "train" }, "#trainingStatus": {}
  };
  const sent = [];
  const context = vm.createContext({
    state: { image: { naturalWidth: 100, naturalHeight: 100 }, slots: [{ id: "1F-001" }], points: [] },
    els: { adminToken: { value: "test-token" } }, setupLotId: "test-lot", cameraBase: "", AbortSignal,
    currentFloorId: () => "1F", authHeaders: h => h,
    document: { querySelector: id => nodes[id], createElement: () => ({
      getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,abc"
    }) },
    fetch: async (url, options) => {
      sent.push(JSON.parse(options.body));
      return { ok: !error, json: async () => error ? { error } : { count: 1 } };
    }
  });
  vm.runInContext(training, context);
  return { nodes, sent, run: () => context.saveTrainingSample() };
}

test("blank training group is automatically filled before sending", async () => {
  const h = trainingHarness();
  await h.run();
  assert.match(h.sent[0].group, /^test-lot-1F-\d{4}-\d{2}-\d{2}$/);
  assert.equal(h.nodes["#trainingGroup"].value, h.sent[0].group);
  assert.match(h.nodes["#trainingStatus"].textContent, /저장했습니다/);
  assert.equal(h.nodes["#trainingSampleButton"].disabled, false);
});

test("custom training group is preserved and server rejection is visible beside button", async () => {
  const h = trainingHarness({ group: "camera-A", error: "학습과 검증에 동시에 사용할 수 없습니다" });
  await h.run();
  assert.equal(h.sent[0].group, "camera-A");
  assert.match(h.nodes["#trainingStatus"].textContent, /학습과 검증/);
  assert.equal(h.nodes["#trainingSampleButton"].disabled, false);
});
