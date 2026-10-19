import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../onboarding.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const key = "parkview.onboarding.v1";

function harness({ seen = false, hash = "", reduced = false, denied = false } = {}) {
  const storage = new Map(seen ? [[key, "completed"]] : []);
  const session = new Map();
  const timers = new Map();
  const events = {};
  let timerId = 0;
  let prepared = 0;
  const nodes = new Map();
  const document = { activeElement: null, body: {}, addEventListener(type, handler) { events[type] = handler; } };
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      id, hidden: ["onboarding", "onboardingDemo", "onboardingTour", "onboardingStart", "onboardingReplay"].includes(id),
      inert: false, dataset: {}, events: {}, textContent: "", innerHTML: "", isConnected: true,
      style: { setProperty(name, value) { this[name] = value; } },
      classList: { add() {}, remove() {} }, offsetWidth: 330,
      addEventListener(type, handler) { this.events[type] = handler; },
      setAttribute(name, value) { this[name] = value; },
      focus() { document.activeElement = this; },
      getBoundingClientRect() { return { left: 0, top: 0, right: 390, bottom: 64, width: 390, height: id === "onboarding" ? 844 : 220 }; },
      getClientRects() { return this.hidden ? [] : [{}]; }, getContext() { return null; }
    });
    return nodes.get(id);
  }
  const root = node("onboarding");
  const purposes = ["search", "availability", "filters", "manage"].map((id) => Object.assign(node(id), { dataset: { onboardingPurpose: id } }));
  root.querySelector = (selector) => node(selector.slice(1));
  root.querySelectorAll = (selector) => selector.includes("data-onboarding-purpose") ? purposes : [node("onboardingSkip"), node("onboardingStart")];
  root.contains = (item) => item !== node("menuButton");
  document.querySelector = (selector) => selector === "#onboarding" ? root : node(selector.slice(1));
  document.querySelectorAll = () => [node("userScreen"), node("adminScreen")];
  const media = { matches: reduced, addEventListener(type, handler) { this.change = handler; } };
  const window = {
    location: { hash }, matchMedia: () => media,
    localStorage: { getItem: (k) => { if (denied) throw Error("denied"); return storage.get(k); }, setItem(k, v) { if (denied) throw Error("denied"); storage.set(k, v); } },
    sessionStorage: { getItem: (k) => session.get(k), setItem: (k, v) => session.set(k, v) },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); }, addEventListener() {}
  };
  vm.runInNewContext(source, { window, document });
  const api = window.initializeParkViewOnboarding({ prepareHome() { prepared += 1; }, refreshIcons() {} });
  const click = (id) => node(id).events.click({ preventDefault() {} });
  async function advance() {
    for (let i = 0; i < 20; i++) {
      const next = timers.entries().next().value;
      if (next) { timers.delete(next[0]); next[1](); }
      for (let j = 0; j < 6; j++) await Promise.resolve();
    }
  }
  return { api, node, click, storage, session, timers, media, events, advance, prepared: () => prepared };
}

test("a first visit blocks background interaction and permission initialization until finished", async () => {
  const h = harness();
  let finished = false;
  h.api.whenFinished.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(h.node("onboarding").hidden, false);
  assert.equal(h.node("userScreen").inert, true);
  assert.equal(finished, false);
  h.click("onboardingSkip");
  await h.api.whenFinished;
  assert.equal(h.node("userScreen").inert, false);
  assert.equal(h.node("onboarding").hidden, true);
  assert.equal(JSON.parse(h.storage.get(key)).skipped, true);
});

test("returning visitors and shared CCTV viewers bypass the tutorial", async () => {
  for (const options of [{ seen: true }, { hash: "#cctv=public-viewer" }]) {
    const h = harness(options);
    await h.api.whenFinished;
    assert.equal(h.node("onboarding").hidden, true);
    assert.equal(h.node("userScreen").inert, false);
  }
});

test("search animation types, shows related searches, then results before offering confirmation", async () => {
  const h = harness();
  h.click("search");
  assert.equal(h.node("onboardingStart").hidden, true);
  await h.advance();
  assert.equal(h.node("demoTypedSearch").textContent, "판교역");
  assert.equal(h.node("onboardingDemoStage").dataset.phase, "results");
  assert.equal(h.node("onboardingStart").hidden, false);
  assert.equal(h.node("onboardingReplay").hidden, false);
  assert.equal(h.storage.has(key), false);
});

test("all four purposes lead through real anchored controls and completion is saved", async () => {
  for (const purpose of ["search", "availability", "filters", "manage"]) {
    const h = harness({ reduced: true });
    h.click(purpose);
    h.click("onboardingStart");
    for (let step = 1; step <= 4; step++) {
      assert.equal(h.node("tourStepCount").textContent, `${step} / 4`);
      h.click("tourNext");
    }
    await h.api.whenFinished;
    const saved = JSON.parse(h.storage.get(key));
    assert.equal(saved.purpose, purpose);
    assert.equal(saved.skipped, false);
    assert.equal(h.node("userScreen").inert, false);
  }
});

test("going back or skipping cancels animation and cannot reveal stale confirmation", async () => {
  const h = harness();
  h.click("search");
  h.click("onboardingBack");
  await h.advance();
  assert.equal(h.node("onboardingChoice").hidden, false);
  assert.equal(h.node("onboardingStart").hidden, true);
  h.click("filters");
  h.click("onboardingSkip");
  await h.advance();
  assert.equal(h.timers.size, 0);
  assert.equal(h.node("onboardingStart").hidden, true);
});

test("reduced motion is immediate and changing the preference cancels active motion", () => {
  const h = harness();
  h.click("availability");
  h.media.matches = true;
  h.media.change();
  assert.equal(h.node("onboardingDemoStage").dataset.phase, "results");
  assert.equal(h.timers.size, 0);
  const reduced = harness({ reduced: true });
  reduced.click("search");
  assert.equal(reduced.node("onboardingStart").hidden, false);
  assert.equal(reduced.timers.size, 0);
});

test("private storage fallback, replay, and Escape leave the app accessible", async () => {
  const h = harness({ denied: true });
  h.click("onboardingSkip");
  assert.equal(h.session.has(key), true);
  h.api.ready();
  h.api.replay();
  assert.equal(h.prepared(), 1);
  assert.equal(h.node("onboarding").hidden, false);
  const prevented = [];
  h.events.keydown({ key: "Escape", preventDefault() { prevented.push(true); }, stopImmediatePropagation() { prevented.push(true); } });
  assert.equal(h.node("onboarding").hidden, true);
  assert.equal(h.node("userScreen").inert, false);
  assert.equal(prevented.length, 2);
  await h.api.whenFinished;
});

test("replaying the animation hides confirmation until the new run completes", async () => {
  const h = harness();
  h.click("search");
  await h.advance();
  h.click("onboardingReplay");
  assert.equal(h.node("onboardingStart").hidden, true);
  assert.equal(h.storage.has(key), false);
  await h.advance();
  assert.equal(h.node("onboardingStart").hidden, false);
});

test("Tab navigation is contained within the tutorial", () => {
  const h = harness();
  let prevented = false;
  h.events.keydown({ key: "Tab", shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  prevented = false;
  h.events.keydown({ key: "Tab", shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test("onboarding assets are included in build, offline cache, and local static allowlist", async () => {
  const build = await readFile(new URL("../scripts/prepare-mobile-web.mjs", import.meta.url), "utf8");
  const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.py", import.meta.url), "utf8");
  for (const filename of ["onboarding.js", "onboarding.css"]) {
    for (const content of [html, build, sw, server]) assert.ok(content.includes(filename));
  }
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /onboarding\.whenFinished\.then\(\(\) => initializeLocationAccess\(\)\)/);
});
