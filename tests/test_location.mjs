import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("function nativeBridge()"), app.indexOf("function showPermissionPanel("));

function harness(getCurrentPosition) {
  const state = { lastLocationError: null };
  const context = vm.createContext({
    state,
    navigator: { geolocation: { getCurrentPosition } },
    window: {}
  });
  vm.runInContext(source, context);
  return { state, getCurrentCoordinates: () => context.getCurrentCoordinates() };
}

test("location retries with fresh high-accuracy coordinates after position unavailable", async () => {
  const options = [];
  const h = harness((success, failure, requestOptions) => {
    options.push(requestOptions);
    if (options.length === 1) failure({ code: 2 });
    else success({ coords: { latitude: 37.5, longitude: 127.0 } });
  });
  const location = await h.getCurrentCoordinates();
  assert.equal(location.latitude, 37.5);
  assert.equal(location.longitude, 127.0);
  assert.equal(options.length, 2);
  assert.equal(options[0].enableHighAccuracy, false);
  assert.equal(options[1].enableHighAccuracy, true);
  assert.equal(options[1].maximumAge, 0);
  assert.equal(h.state.lastLocationError, null);
});

test("location permission denial does not retry", async () => {
  let calls = 0;
  const h = harness((_success, failure) => {
    calls++;
    failure({ code: 1 });
  });
  assert.equal(await h.getCurrentCoordinates(), null);
  assert.equal(calls, 1);
  assert.equal(h.state.lastLocationError.code, 1);
});

test("location reports the final error when both positioning methods fail", async () => {
  let calls = 0;
  const h = harness((_success, failure) => {
    calls++;
    failure({ code: calls === 1 ? 2 : 3 });
  });
  assert.equal(await h.getCurrentCoordinates(), null);
  assert.equal(calls, 2);
  assert.equal(h.state.lastLocationError.code, 3);
});
