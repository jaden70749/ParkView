import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("async function loadRuntimeConfig("), app.indexOf("const MAP_MARKER_MIN_ZOOM"));

function harness({ key = "parkview-public-key", backend = async () => ({ kakaoJavaScriptKey: "other-app-key", geminiConfigured: true }) } = {}) {
  const timers = new Map(), scripts = [];
  let sequence = 0, calls = 0;
  const state = {};
  const window = { PARKVIEW_CONFIG: { kakaoJavaScriptKey: key }, location: { hostname: "jaden70749.github.io" },
    setTimeout(fn) { timers.set(++sequence, fn); return sequence; }, clearTimeout(id) { timers.delete(id); } };
  const context = vm.createContext({ state, window, EDGE_API_BASE_URL: "https://ai.example", RUNTIME_CONFIG_TIMEOUT_MS:20000, AbortController,
    edgeApiUrl: path => `https://ai.example${path}`, console: { warn() {} },
    fetch: async () => { calls++; return {ok:true,json:backend}; },
    document: {
      createElement: () => ({ events:{}, addEventListener(name, fn) { this.events[name]=fn; }, remove() { this.removed=true; } }),
      head: {appendChild(script) { scripts.push(script); }}
    }
  });
  vm.runInContext(source, context);
  return { state, window, timers, scripts, calls:()=>calls,
    config: options => context.loadRuntimeConfig(options), sdk:()=>context.loadKakaoMapSdk() };
}

test("the deployed ParkView map key takes precedence over another Render app key", async () => {
  const h = harness();
  const result = await h.config();
  assert.equal(result.kakaoJavaScriptKey,"parkview-public-key");
  assert.equal(result.geminiConfigured,true);
  assert.equal(result.backendConnected,true);
});

test("a sleeping AI server cannot delay map initialization when the app has its own key", async () => {
  const h = harness({backend:()=>new Promise(()=>{})});
  const result = await h.config({waitForBackend:false});
  assert.equal(result.kakaoJavaScriptKey,"parkview-public-key");
  assert.equal(result.backendConnected,false);
  assert.equal(h.calls(),1);
  assert.match(app,/await loadRuntimeConfig\(\{ waitForBackend: false \}\);/);
});

test("a server-provided key still supports installations without a static key", async () => {
  const h = harness({key:""});
  assert.equal((await h.config()).kakaoJavaScriptKey,"other-app-key");
});

test("an offline AI server does not remove the deployed map key", async () => {
  const h = harness({backend:async()=>{throw Error("offline");}});
  assert.equal((await h.config()).kakaoJavaScriptKey,"parkview-public-key");
});

test("SDK rejection is retryable after domain registration is corrected", async () => {
  const h = harness();await h.config();
  const pending = h.sdk();
  assert.equal(h.sdk(),pending);
  h.scripts[0].events.error();
  await assert.rejects(pending,/could not be loaded/);
  assert.equal(h.state.kakaoSdkPromise,null);
  assert.equal(h.scripts[0].removed,true);
  const retry = h.sdk();
  h.window.kakao={maps:{load(fn){fn();},Map:class {}}};
  h.scripts[1].events.load();
  assert.equal(await retry,h.window.kakao.maps);
  assert.equal(h.timers.size,0);
});

test("an unresponsive SDK times out instead of blocking the whole app", async () => {
  const h = harness();await h.config();
  const pending=h.sdk();
  [...h.timers.values()][0]();
  await assert.rejects(pending,/timed out/);
  assert.equal(h.state.kakaoSdkPromise,null);
  assert.equal(h.scripts[0].removed,true);
});
