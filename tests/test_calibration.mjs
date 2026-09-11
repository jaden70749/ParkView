import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../calibrate.js", import.meta.url), "utf8");
const detection = source.slice(source.indexOf("async function detectRegions()"), source.indexOf("function addCompletedSlot()"));
function harness({ slots = [], confirm = true, fail = false } = {}) {
  let requests = 0;
  const state = { slots, roi: null, image: { naturalWidth: 100, naturalHeight: 100 }, points: [] };
  const els = { detectButton: { disabled: false }, adminToken: { value: "test-token" },
    saveStatus: {}, sourceStatus: {} };
  const context = vm.createContext({ state, els, setupLotId: "test-lot", AbortSignal,
    window: { confirm: () => confirm }, render() {}, regionsUrl: () => "/api/regions/detect",
    authHeaders: headers => headers,
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: fn => fn({}) }) },
    fetch: async () => { requests++; if (fail) throw new Error("offline");
      return { ok: true, json: async () => ({ slots: [{ id: "detected" }] }) }; }
  });
  vm.runInContext(detection, context);
  return { state, els, run: () => context.detectRegions(), requests: () => requests };
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

test("new calibration opens in region selection mode", () => {
  assert.match(source, /mode: "region"/);
});
