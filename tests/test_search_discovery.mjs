import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../search-discovery.js", import.meta.url), "utf8");

function harness(initial = {}) {
  const storage = new Map(Object.entries(initial));
  const nodes = new Map();
  function element() {
    return { children: [], events: {}, hidden: false, value: "", textContent: "",
      classList: { add() {}, remove() {} },
      addEventListener(type, fn) { this.events[type] = fn; },
      append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; }, setAttribute() {}, focus() {}, blur() {} };
  }
  const document = { createElement: element, querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  }, querySelectorAll: () => [], addEventListener() {} };
  const els = { searchInput: element(), searchPanel: element() };
  const state = { lots: [], favoriteLotIds: new Set(), searchSuggestionToken: 0 };
  const window = { clearTimeout() {} };
  const context = vm.createContext({ window, document, localStorage: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)
  } });
  vm.runInContext(source, context);
  window.initializeParkViewSearch({ state, els, escapeHtml: String, refreshIcons() {},
    hideSearchSuggestions() {}, resetMapSearch() { els.searchInput.value = ""; },
    selectSearchSuggestion() {}, selectLot() {}, loadKakaoMapSdk() {},
    renderSearchSuggestions() {}, showFavoriteLotsFromMenu() {} });
  return { api: window.ParkViewSearch, nodes, storage, state, els };
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
