import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("async function refreshEdgeStatus()"), app.indexOf("function showScreen(screen)"));

function harness(fetch) {
  let now = 1000;
  const timers = new Map();
  let id = 0;
  const state = { edgeStatusRequest: null, edgeStatusRetryAt: 0, edgeStatusFailures: 0,
    edgeStatusTimer: null, floors: [{ name: "1F" }], floorIndex: 0 };
  const els = Object.fromEntries(["cameraConnectionChip", "cameraStatus", "cameraIntervalStatus", "analysisStatus", "objectStatus"]
    .map(name => [name, { textContent: "", classList: { add() {}, remove() {}, toggle() {} } }]));
  const context = vm.createContext({ state, els, fetch, AbortController,
    Date: { now: () => now },
    renderDeviceCameraStatus: () => false, renderNativeCctvStatus: () => false,
    isDirectCameraMode: () => false, cameraApiUrl: path => `https://relay.example${path}`,
    cameraApiHeaders: () => ({}),
    window: {
      setTimeout(fn) { timers.set(++id, fn); return id; },
      clearTimeout(id) { timers.delete(id); },
      setInterval() { return 100; }, clearInterval() {}
    }
  });
  vm.runInContext(source, context);
  return { state, els, timers, refresh: () => context.refreshEdgeStatus(), stop: () => context.stopEdgeStatusPolling(),
    advance: ms => { now += ms; } };
}

test("offline health backs off without fetching results or piling up requests", async () => {
  let calls = 0;
  const h = harness(async () => { calls++; throw new TypeError("Failed to fetch"); });
  await h.refresh();
  assert.equal(calls, 1);
  assert.equal(h.els.cameraConnectionChip.textContent, "서버 연결 끊김");
  await h.refresh();
  assert.equal(calls, 1);
  h.advance(10000);
  await h.refresh();
  assert.equal(calls, 2);
  assert.equal(h.state.edgeStatusRetryAt, 31000);
  assert.equal(h.timers.size, 0);
});

test("an unauthorized result reports authentication failure", async () => {
  const h = harness(async url => url.endsWith("health")
    ? { ok: true, json: async () => ({ camera: {} }) }
    : { ok: false, status: 401 });
  await h.refresh();
  assert.equal(h.els.cameraStatus.textContent, "인증 실패");
});

test("slow requests cannot overlap and leaving management aborts without stale UI", async () => {
  let calls = 0;
  const h = harness((_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  });
  const pending = h.refresh();
  await h.refresh();
  assert.equal(calls, 1);
  h.stop();
  await pending;
  assert.equal(h.state.edgeStatusRequest, null);
  assert.equal(h.els.cameraConnectionChip.textContent, "");
  assert.equal(h.timers.size, 0);
});

test("request timeout frees the pending request and schedules retry", async () => {
  const h = harness((_url, { signal }) => new Promise((_resolve, reject) =>
    signal.addEventListener("abort", () => reject(new Error("timeout")))));
  const pending = h.refresh();
  [...h.timers.values()][0]();
  await pending;
  assert.equal(h.state.edgeStatusRequest, null);
  assert.equal(h.state.edgeStatusFailures, 1);
});

test("successful reconnect clears failure backoff", async () => {
  let fail = true;
  const h = harness(async () => {
    if (fail) throw new TypeError("Failed to fetch");
    return { ok: true, json: async () => ({ camera: { connected: false } }) };
  });
  await h.refresh();
  h.advance(10000);
  fail = false;
  await h.refresh();
  assert.equal(h.state.edgeStatusFailures, 0);
  assert.equal(h.state.edgeStatusRetryAt, 0);
  assert.equal(h.els.cameraConnectionChip.textContent, "수동 관리");
});
