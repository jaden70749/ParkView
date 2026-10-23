import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
const base = "https://jaden70749.github.io/ParkView/";

function harness({ offline = false } = {}) {
  const events = {};
  const requests = [];
  const deleted = [];
  const stored = new Map();
  const navigations = [];
  const precached = [];
  let skipped = false;
  let claimed = false;
  const cache = {
    addAll(items) { precached.push(...items); return Promise.resolve(); },
    put(request, response) { stored.set(request.url, response); return Promise.resolve(); }
  };
  const context = {
    URL, Request, Response,
    self: {
      location: new URL("sw.js?v=158", base),
      addEventListener(type, handler) { events[type] = handler; },
      skipWaiting() { skipped = true; return Promise.resolve(); },
      clients: {
        claim() { claimed = true; return Promise.resolve(); },
        matchAll() { return Promise.resolve([{ url: base, navigate(url) { navigations.push(url); return Promise.resolve(); } }]); }
      }
    },
    caches: {
      open() { return Promise.resolve(cache); },
      keys() { return Promise.resolve(["parkview-v151", "parkview-v177", "another-app-cache"]); },
      delete(name) { deleted.push(name); return Promise.resolve(true); },
      match(request) { return Promise.resolve(stored.get(typeof request === "string" ? request : request.url)); }
    },
    fetch(request, options) {
      requests.push({ request, options });
      return offline ? Promise.reject(Error("offline")) : Promise.resolve(new Response("fresh assets"));
    }
  };
  vm.runInNewContext(source, context);
  async function lifecycle(name) {
    let done;
    events[name]({ waitUntil(promise) { done = promise; } });
    await done;
  }
  async function fetchAsset(path, destination) {
    let response;
    const request = { method: "GET", url: new URL(path, base).href, destination };
    events.fetch({ request, respondWith(promise) { response = promise; } });
    return response && await response;
  }
  return { lifecycle, fetchAsset, requests, deleted, stored, navigations, precached, skipped: () => skipped, claimed: () => claimed };
}

test("worker upgrades bypass cached HTML and CSS when precaching the new release", async () => {
  const h = harness();
  await h.lifecycle("install");
  assert.equal(h.skipped(), true);
  assert.ok(h.precached.length > 10);
  assert.ok(h.precached.every(request => request.cache === "reload"));
  assert.ok(h.precached.some(request => request.url === `${base}index.html`));
});

test("documents, scripts and styles always bypass the browser HTTP cache", async () => {
  const h = harness();
  for (const [path, destination] of [["", "document"], ["app.js?v=159", "script"], ["styles.css?v=121", "style"]]) {
    const response = await h.fetchAsset(path, destination);
    assert.equal(await response.text(), "fresh assets");
    assert.equal(h.requests.at(-1).options.cache, "no-store");
  }
});

test("activation refreshes open app tabs without removing unrelated caches", async () => {
  const h = harness();
  await h.lifecycle("activate");
  assert.deepEqual(h.deleted, ["parkview-v151"]);
  assert.equal(h.claimed(), true);
  assert.deepEqual(h.navigations, [base]);
});

test("offline navigation can still use the installed HTML", async () => {
  const h = harness({ offline: true });
  h.stored.set("./index.html", new Response("offline app"));
  const response = await h.fetchAsset("?saved-lot=one", "document");
  assert.equal(await response.text(), "offline app");
});

test("camera APIs stay outside the worker and cached model files are retained", async () => {
  const h = harness();
  assert.equal(await h.fetchAsset("api/camera/preview", "image"), undefined);
  assert.equal(h.requests.length, 0);
  h.stored.set(`${base}models/yolov5su.onnx`, new Response("model"));
  assert.equal(await (await h.fetchAsset("models/yolov5su.onnx", "")).text(), "model");
  assert.equal(h.requests.length, 0);
});
