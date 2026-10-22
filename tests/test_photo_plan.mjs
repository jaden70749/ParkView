import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const context = { window: {} };
vm.createContext(context);
vm.runInContext(readFileSync(new URL("../photo-plan.js", import.meta.url), "utf8"), context);
const { measuredFloor, measuredRows } = context.window.ParkViewPhotoPlan;

function referenceBoxes() {
  const boxes = [11, 8, 8, 11].flatMap((count, row) => Array.from({ length: count }, (_, i) => ({
    x: [50, 430, 620, 980][row], y: 270 + i * 88, w: 125, h: 80
  })));
  boxes.push(...Array.from({ length: 8 }, (_, i) => ({ x: 240 + i * 88, y: 1240, w: 80, h: 125 })));
  return boxes;
}

test("closed-line photo measurements preserve 11, 8, 8, 11, 8 instead of redistributing 46 bays", () => {
  const floor = measuredFloor(referenceBoxes(), "1F", 46);
  assert.deepEqual(Array.from(floor.rowCounts), [11, 8, 8, 11, 8]);
  assert.equal(floor.slots.length, 46);
  assert.equal(floor.layoutSource, "photo_lines");
  assert.equal(floor.elements.length, 0);
  assert.ok(floor.slots.every(slot => slot.status === "unknown"));
});

test("a tape-broken interior bay can be recovered from repeated measured spacing", () => {
  const boxes = referenceBoxes().filter((_, i) => ![14, 31].includes(i));
  const floor = measuredFloor(boxes, "1F", 46);
  assert.equal(floor.slots.length, 46);
  assert.equal(floor.slots.filter(slot => slot.inferredBoundary).length, 2);
  assert.deepEqual(Array.from(floor.rowCounts), [11, 8, 8, 11, 8]);
});

test("a requested total cannot create an extra end bay or pad another row", () => {
  assert.equal(measuredFloor(referenceBoxes(), "1F", 47), null);
  assert.equal(measuredFloor(referenceBoxes(), "1F", null), null);
  assert.equal(measuredFloor(referenceBoxes().slice(1), "1F", 46), null);
});

test("large unmarked corner areas and isolated rectangles are not bays", () => {
  const boxes = [...referenceBoxes(), {x:40,y:1240,w:210,h:160}, {x:220,y:100,w:120,h:80}];
  assert.deepEqual(Array.from(measuredRows(boxes), row => row.boxes.length), [11, 8, 8, 11, 8]);
});

test("measured aspect and bay widths follow the image geometry, not a fixed car ratio", () => {
  const floor = measuredFloor(referenceBoxes(), "1F", 46);
  const wide = measuredFloor(referenceBoxes().map(box => ({...box,x:box.x*2})), "1F", 46);
  assert.ok(wide.aspectRatio > floor.aspectRatio * 1.8);
  const slot = floor.slots[0];
  assert.ok(Math.abs(slot.w * floor.aspectRatio / slot.h - 125 / 80) < 1e-10);
});
