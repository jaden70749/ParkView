import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../search-discovery.js", import.meta.url), "utf8");

function harness(initial = {}, { matches = [], defer = false } = {}) {
  const storage = new Map(Object.entries(initial));
  const nodes = new Map();
  function element() {
    return { children: [], events: {}, hidden: false, value: "", textContent: "",
      classList: { add() {}, remove() {} },
      addEventListener(type, fn) { this.events[type] = fn; },
      append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; }, setAttribute() {}, focus() {}, blur() {},
      getBoundingClientRect: () => ({ height: 250 }) };
  }
  const restaurant = Object.assign(element(), { textContent: "음식점", dataset: { nearbyCategory: "FD6" } });
  const cafe = Object.assign(element(), { textContent: "카페", dataset: { nearbyCategory: "CE7" } });
  const requests = [];
  const overlays = [];
  const document = { createElement: element, querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  }, querySelectorAll: () => [restaurant, cafe], addEventListener() {} };
  const els = { searchInput: element(), searchPanel: element() };
  const state = { lots: [], favoriteLotIds: new Set(), searchSuggestionToken: 0,
    mainMap: { getCenter: () => ({}), panTo() {}, setBounds() {} } };
  const window = { clearTimeout() {}, kakao: { maps: {
    LatLng: function(latitude, longitude) { Object.assign(this, { latitude, longitude }); },
    LatLngBounds: function() { this.extend = () => {}; },
    CustomOverlay: function(options) { this.options = options; this.setMap = map => { this.map = map; }; overlays.push(this); },
    services: { Status: { OK: "OK", ZERO_RESULT: "ZERO" }, SortBy: { DISTANCE: "distance" },
      Places: function() { this.categorySearch = (code, callback) => {
        requests.push({ code, callback });
        if (!defer) callback(matches, "OK");
      }; } }
  } } };
  const context = vm.createContext({ window, document, localStorage: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)
  } });
  vm.runInContext(source, context);
  window.initializeParkViewSearch({ state, els, escapeHtml: String, refreshIcons() {},
    hideSearchSuggestions() {}, resetMapSearch() { els.searchInput.value = ""; },
    selectSearchSuggestion() {}, selectLot() {}, loadKakaoMapSdk() {},
    renderSearchSuggestions() {}, showFavoriteLotsFromMenu() {} });
  return { api: window.ParkViewSearch, nodes, storage, state, els, restaurant, cafe, requests, overlays };
}

const place = { id: "place:1", name: "학교", address: "경기도 성남시", latitude: 37.39, longitude: 127.05 };

test("registering home intercepts destination selection and persists coordinates", () => {
  const h = harness();
  h.api.open();
  h.nodes.get("#discoveryPlaces").children[0].children[0].events.click();
  assert.equal(h.api.acceptPlace(place), true);
  const saved = JSON.parse(h.storage.get("parkview.savedPlaces.v1"));
  assert.equal(saved[0].key, "home");
  assert.equal(saved[0].latitude, place.latitude);
  assert.equal(h.api.acceptPlace(place), false);
});

test("recent destinations deduplicate, persist, and stay bounded", () => {
  const h = harness();
  for (let i = 0; i < 12; i++) h.api.selected({ ...place, name: `장소 ${i}` });
  h.api.selected({ ...place, name: "장소 11" });
  const recent = JSON.parse(h.storage.get("parkview.recentSearches.v1"));
  assert.equal(recent.length, 8);
  assert.equal(recent[0].name, "장소 11");
  h.api.open();
  h.nodes.get("#clearRecentSearches").events.click();
  assert.deepEqual(JSON.parse(h.storage.get("parkview.recentSearches.v1")), []);
});

test("closing cancels pending suggestions and invalid saved data does not break discovery", () => {
  const h = harness({ "parkview.savedPlaces.v1": "invalid", "parkview.recentSearches.v1": '[null,{"name":"bad"}]' });
  h.api.open();
  const token = h.state.searchSuggestionToken;
  h.api.close();
  assert.equal(h.nodes.get("#searchDiscovery").hidden, true);
  assert.ok(h.state.searchSuggestionToken > token);
  h.api.open();
  assert.equal(h.nodes.get("#discoveryPlaces").children.length, 2);
});

test("category exploration keeps the home panel and renders map pins instead of suggestions", async () => {
  const h = harness({}, { matches: [{ id: "1", place_name: "식당", y: "37.39", x: "127.05" }] });
  h.api.open();
  await h.restaurant.events.click();
  assert.equal(h.els.searchInput.value, "");
  assert.equal(h.nodes.get("#discoveryHome").hidden, false);
  assert.equal(h.api.hasCategory(), true);
  assert.equal(h.overlays.length, 1);
  assert.match(h.overlays[0].options.content.className, /category-fd6/);
  assert.equal(h.state.searchSuggestions.length, 0);
  assert.match(h.nodes.get("#nearbyMapCount").textContent, /음식점 1곳/);
  h.api.selected(place);
  assert.equal(h.api.hasCategory(), false);
  assert.equal(h.overlays[0].map, null);
});

test("a late restaurant response cannot overwrite the selected cafe category", async () => {
  const h = harness({}, { defer: true });
  h.api.open();
  const first = h.restaurant.events.click();
  await Promise.resolve();
  const second = h.cafe.events.click();
  await Promise.resolve();
  h.requests[1].callback([{ id: "2", place_name: "카페", y: "37.39", x: "127.05" }], "OK");
  await second;
  h.requests[0].callback([{ id: "1", place_name: "식당", y: "37.39", x: "127.05" }], "OK");
  await first;
  assert.equal(h.overlays.length, 1);
  assert.match(h.overlays[0].options.content.className, /category-ce7/);
});
