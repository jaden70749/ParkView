import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const cardSource = app.slice(app.indexOf("function lotCard(lot)"), app.indexOf("function selectLot(lot,"));
const detailSource = app.slice(app.indexOf("function renderLotDetail(lot)"), app.indexOf("function formatWon(value)"));

function lot(overrides = {}) {
  return {
    id: "lot-1", name: "테스트 주차장", parkingType: "공영", isOpen: true,
    address: "서울", phone: "", weekdayStart: "09:00", weekdayEnd: "18:00",
    hasRealtime: true, availableSpaces: 64, totalSpaces: 73,
    hourlyPrice: 5000, floors: [{ name: "1F", slots: [{}] }], ...overrides
  };
}

function helpers() {
  return {
    escapeHtml: value => String(value),
    hasLiveAvailability: item => item.hasRealtime === true && Number.isFinite(item.availableSpaces) && Number.isFinite(item.totalSpaces),
    availabilityLabel: item => item.hasRealtime ? `${item.availableSpaces}/${item.totalSpaces}면` : "면수 정보 없음",
    priceLabel: (item, compact = false) => item.hourlyPrice === null
      ? compact ? "요금 미확인" : "요금 정보 없음"
      : `1시간 ₩${item.hourlyPrice.toLocaleString("ko-KR")}`,
    formatLotDistance: () => "30m",
    destinationDistanceMeters: () => 30,
    formatDistance: () => "30m",
    clamp: (value, min, max) => Math.min(max, Math.max(min, value))
  };
}

test("nearby row distinguishes live availability from missing data", () => {
  const context = vm.createContext({
    ...helpers(),
    state: { recommendationRanks: new Map(), searchDestination: null },
    document: { createElement: () => ({ setAttribute() {}, addEventListener() {} }) },
    selectLot() {}
  });
  vm.runInContext(cardSource, context);
  const live = context.lotCard(lot());
  const unknown = context.lotCard(lot({ hasRealtime: false, availableSpaces: null, totalSpaces: null, hourlyPrice: null }));
  assert.match(live.innerHTML, /class="lot-availability is-live">잔여 64\/73면/);
  assert.match(live.className, /has-live-availability/);
  assert.match(live.innerHTML, /1시간 ₩5,000/);
  assert.match(unknown.innerHTML, /class="lot-availability">잔여 미확인/);
  assert.match(unknown.innerHTML, /요금 미확인/);
  assert.doesNotMatch(unknown.className, /has-live-availability/);
  assert.match(live.innerHTML, /data-lucide="chevron-right"/);
});

test("detail shows a bounded vacancy gauge and keeps floor navigation", () => {
  let planCalls = 0;
  const detail = {
    innerHTML: "",
    querySelector: () => ({ addEventListener() {} })
  };
  const context = vm.createContext({
    ...helpers(),
    state: { favoriteLotIds: new Set(), floorIndex: 0 },
    els: { lotDetail: detail },
    renderFloorPlan() { planCalls++; },
    refreshIcons() {},
    shareLot() {}, toggleFavoriteLot() {}, navigateToLot() {}, expandBottomSheetToFull() {},
    window: { setTimeout() {} }
  });
  vm.runInContext(detailSource, context);
  context.renderLotDetail(lot());
  assert.match(detail.innerHTML, /class="detail-live-badge"/);
  assert.match(detail.innerHTML, /width: 88%/);
  assert.match(detail.innerHTML, /id="detailPrev"/);
  assert.match(detail.innerHTML, /id="detailNext"/);
  assert.match(detail.innerHTML, /id="detailFloorPlan"/);
  assert.match(detail.innerHTML, /주차면 상태 범례/);
  assert.equal(planCalls, 1);
});

test("detail does not label unreported availability as live", () => {
  const detail = {
    innerHTML: "",
    querySelector: () => ({ addEventListener() {} })
  };
  const context = vm.createContext({
    ...helpers(),
    state: { favoriteLotIds: new Set(), floorIndex: 0 },
    els: { lotDetail: detail },
    renderFloorPlan() {}, refreshIcons() {},
    shareLot() {}, toggleFavoriteLot() {}, navigateToLot() {}, expandBottomSheetToFull() {},
    window: { setTimeout() {} }
  });
  vm.runInContext(detailSource, context);
  context.renderLotDetail(lot({ hasRealtime: false, availableSpaces: null, totalSpaces: null }));
  assert.doesNotMatch(detail.innerHTML, /class="detail-live-badge"|class="vacancy-gauge"/);
  assert.match(detail.innerHTML, /면수 정보 없음/);
});
