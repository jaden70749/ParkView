import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const context = vm.createContext({ window: {} });
vm.runInContext(readFileSync(new URL("../slot-mapping.js", import.meta.url), "utf8"), context);
const { match } = context.window.ParkViewSlotMapping;
const plan = [11, 8, 8, 11].flatMap((n, row) => Array.from({ length: n }, (_, i) => ({
  x: [0, .35, .55, .9][row], y: i*.075, w: .08, h: .06, kind: i < 2 && [0, 2].includes(row) ? "disabled" : "normal"
})));
plan.push(...Array.from({ length: 8 }, (_, i) => ({ x: .15+i*.09, y: .88, w: .065, h: .1, kind: "normal" })));
function camera(slots, turn = 0, perspective = false) {
  return slots.map((s, i) => ({ id: `old-${i}`, slot_index: i, kind: "normal",
    polygon: [[s.x, s.y], [s.x+s.w, s.y], [s.x+s.w, s.y+s.h], [s.x, s.y+s.h]].map(([x, y]) => {
      [x, y] = [[x, y], [1-y, x], [1-x, 1-y], [y, 1-x]][turn];
      return perspective ? [(.18+.62*x+.1*y)/(1+.2*y), (.1+.04*x+.7*y)/(1+.2*y)] : [x, y];
    })
  }));
}

for (let turn = 0; turn < 4; turn++) test(`camera rotation ${turn*90} preserves every physical bay identity`, () => {
  const slots = camera(plan, turn, true).reverse();
  const original = JSON.stringify(slots);
  const result = match(slots, plan, "1F");
  assert.ok(result);
  assert.deepEqual(Array.from(result.slots, s => s.slot_index), plan.map((_, i) => i).reverse());
  assert.equal(result.slots.find(s => s.slot_index === 0).kind, "disabled");
  assert.equal(result.slots.find(s => s.slot_index === 0).id, "1F-001");
  assert.equal(JSON.stringify(slots), original);
  assert.equal(JSON.stringify(result.slots.map(s => s.polygon)), JSON.stringify(slots.map(s => s.polygon)));
});

test("symmetric layouts are not assigned an arbitrary orientation", () => {
  const symmetric = [0, .8].flatMap(y => [0, .4, .8].map(x => ({x, y, w:.1, h:.1})));
  assert.equal(match(camera(symmetric), symmetric, "1F"), null);
});

test("missing, duplicate, invalid or unequal bay measurements cannot produce a mapping", () => {
  assert.equal(match(camera(plan).slice(1), plan, "1F"), null);
  assert.equal(match(camera(plan).map(s => ({...s, polygon:[[0,0],[0,0],[0,0],[0,0]]})), plan, "1F"), null);
  assert.equal(match(camera(plan), plan.map(s => ({...s,x:NaN})), "1F"), null);
  assert.equal(match(camera(plan), plan.map(() => plan[0]), "1F"), null);
});

const cameraSource = readFileSync(new URL("../camera-analysis.js", import.meta.url), "utf8");
const loadSource = cameraSource.slice(cameraSource.indexOf("async function loadCameraRegions("), cameraSource.indexOf("function activeFloorContext("));
function loadingHarness({ confirmed = false, manual = false, conflict = false } = {}) {
  const original = { lot_id: "lot-A", floor_id: "1F", revision: "before", reference_id: "keep-empty-reference",
    occupancy_strategy: "empty_reference_difference", slots: camera(plan, 2).map((s, i) => ({...s,slot_index:manual ? plan.length-i-1 : i})),
    ...(confirmed ? {plan_mapping:{source:"manual"}} : {}) };
  const state = {runId:1,regions:null,slotHistory:new Map()};
  const writes = [];
  let current = original;
  const context = vm.createContext({ state, window:{ParkViewSlotMapping:{match}}, AbortSignal, els:{occupancyStatus:{}},
    activeFloorContext:()=>({lotId:"lot-A",floorId:"1F",layoutSource:"photo_lines",slots:plan}),
    cameraRequestHeaders:(_url, headers)=>headers,
    fetch:async (_url, options)=> {
      if (options.method === "POST") {
        const body=JSON.parse(options.body);writes.push(body);
        if (!conflict) current={...body,revision:"after"};
        return {ok:!conflict,status:409};
      }
      return {ok:true,json:async()=>current};
    }
  });
  vm.runInContext(loadSource,context);
  return {state,writes,run:()=>context.loadCameraRegions("https://camera.example/api/camera/preview","test-token")};
}

test("automatic repair persists canonical numbers once and preserves the empty reference", async () => {
  const h=loadingHarness();await h.run();await h.run();
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0].expected_revision,"before");
  assert.equal(h.writes[0].reference_id,"keep-empty-reference");
  assert.equal(h.writes[0].plan_mapping.rotation,180);
  assert.equal(h.state.regions.revision,"after");
});

test("existing manual links and confirmed mappings are not automatically overwritten", async () => {
  for (const options of [{confirmed:true},{manual:true}]) {
    const h=loadingHarness(options);await h.run();assert.equal(h.writes.length,0);
  }
});

test("concurrent coordinate edits reject repair without applying an uncommitted mapping", async () => {
  const h=loadingHarness({conflict:true});await h.run();
  assert.equal(h.writes.length,1);assert.equal(h.state.regions,null);
});
