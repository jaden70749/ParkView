(function () {
  "use strict";

  function normalize(points) {
    const lo = [0, 1].map(axis => Math.min(...points.map(p => p[axis])));
    const span = [0, 1].map(axis => Math.max(...points.map(p => p[axis])) - lo[axis]);
    if (span.some(n => n < 1e-6)) return null;
    return points.map(p => p.map((n, axis) => (n - lo[axis]) / span[axis]));
  }

  // Rectify the camera plane before comparing it with a top-down drawing.
  function cameraCenters(slots, useExtremes = false) {
    if (!slots.every(s => s && Array.isArray(s.polygon) && s.polygon.length >= 3)) return null;
    const vertices = slots.flatMap(s => s.polygon || []);
    if (vertices.length < 12 || vertices.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) return null;
    const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const sorted = [...vertices].sort((a, b) => a[0]-b[0] || a[1]-b[1]);
    const half = points => {
      const hull = [];
      for (const p of points) {
        while (hull.length > 1 && cross(hull.at(-2), hull.at(-1), p) <= 1e-10) hull.pop();
        hull.push(p);
      }
      return hull.slice(0, -1);
    };
    const hull = [...half(sorted), ...half([...sorted].reverse())];
    const edges = hull.map((p, i) => [p, hull[(i+1)%hull.length]])
      .sort((a, b) => Math.hypot(...b[0].map((v, i) => v-b[1][i]))-Math.hypot(...a[0].map((v, i) => v-a[1][i])));
    const horizontal = edges.filter(([a, b]) => Math.abs(a[0]-b[0]) > Math.abs(a[1]-b[1])).slice(0, 2)
      .sort((a, b) => a[0][1]+a[1][1]-b[0][1]-b[1][1]);
    const vertical = edges.filter(([a, b]) => Math.abs(a[0]-b[0]) <= Math.abs(a[1]-b[1])).slice(0, 2)
      .sort((a, b) => a[0][0]+a[1][0]-b[0][0]-b[1][0]);
    if (horizontal.length !== 2 || vertical.length !== 2) return null;
    const intersect = ([a, b], [c, d]) => {
      const denominator = (a[0]-b[0])*(c[1]-d[1])-(a[1]-b[1])*(c[0]-d[0]);
      if (Math.abs(denominator) < 1e-10) return null;
      const ab = a[0]*b[1]-a[1]*b[0], cd = c[0]*d[1]-c[1]*d[0];
      return [(ab*(c[0]-d[0])-(a[0]-b[0])*cd)/denominator,
        (ab*(c[1]-d[1])-(a[1]-b[1])*cd)/denominator];
    };
    let quad = [intersect(horizontal[0], vertical[0]), intersect(horizontal[0], vertical[1]),
      intersect(horizontal[1], vertical[1]), intersect(horizontal[1], vertical[0])];
    if (useExtremes) {
      const scores = [p => p[0]+p[1], p => -p[0]+p[1], p => -p[0]-p[1], p => p[0]-p[1]];
      quad = scores.map(score => vertices.reduce((a, b) => score(a) < score(b) ? a : b));
      if (new Set(quad).size !== 4) return null;
    }
    if (quad.some(p => !p)) return null;
    const target = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const rows = quad.flatMap(([x, y], i) => {
      const [u, v] = target[i];
      return [[x, y, 1, 0, 0, 0, -u*x, -u*y, u], [0, 0, 0, x, y, 1, -v*x, -v*y, v]];
    });
    for (let k = 0; k < 8; k++) {
      let pivot = k;
      for (let i = k+1; i < 8; i++) if (Math.abs(rows[i][k]) > Math.abs(rows[pivot][k])) pivot = i;
      [rows[k], rows[pivot]] = [rows[pivot], rows[k]];
      const scale = rows[k][k];
      if (Math.abs(scale) < 1e-10) return null;
      rows[k] = rows[k].map(n => n / scale);
      for (let i = 0; i < 8; i++) if (i !== k) {
        const factor = rows[i][k];
        rows[i] = rows[i].map((n, j) => n - factor*rows[k][j]);
      }
    }
    const h = rows.map(row => row[8]);
    const project = ([x, y]) => {
      const d = h[6]*x + h[7]*y + 1;
      return [(h[0]*x + h[1]*y + h[2])/d, (h[3]*x + h[4]*y + h[5])/d];
    };
    return normalize(slots.map(slot => {
      const points = slot.polygon.map(project);
      return [0, 1].map(axis => points.reduce((n, p) => n+p[axis], 0)/points.length);
    }));
  }

  function match(slots, plan, floorId) {
    if (!Array.isArray(slots) || !Array.isArray(plan) || slots.length !== plan.length || slots.length < 3 || slots.length > 500) return null;
    if (!plan.every(s => [s.x, s.y, s.w, s.h].every(Number.isFinite) && s.w > 0 && s.h > 0)) return null;
    const cameras = [cameraCenters(slots), cameraCenters(slots, true)].filter(Boolean);
    const drawing = normalize(plan.map(s => [s.x+s.w/2, s.y+s.h/2]));
    if (!cameras.length || !drawing) return null;
    const distance = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
    const pitches = drawing.map((a, i) => Math.min(...drawing.filter((_, j) => i !== j).map(b => distance(a, b))));
    if (pitches.some(p => p < 1e-6)) return null;
    const alternatives = [];
    for (const camera of cameras) for (let turn = 0; turn < 4; turn++) {
      const rotated = camera.map(([x, y]) => [[x, y], [1-y, x], [1-x, 1-y], [y, 1-x]][turn]);
      const indices = rotated.map(p => drawing.reduce((best, q, i) => distance(p, q) < distance(p, drawing[best]) ? i : best, 0));
      if (new Set(indices).size !== slots.length) continue;
      const errors = rotated.map((p, i) => distance(p, drawing[indices[i]])/pitches[indices[i]]);
      if (Math.max(...errors) > .48) continue;
      alternatives.push({ turn, indices, score: errors.reduce((n, e) => n+e*e, 0)/errors.length });
    }
    alternatives.sort((a, b) => a.score-b.score);
    const best = alternatives[0];
    const competitor = alternatives.find(candidate => candidate.indices.some((n, i) => n !== best.indices[i]));
    // A symmetric layout has no reliable orientation; retain explicit manual links.
    if (!best || (competitor && competitor.score-best.score < .035)) return null;
    return { rotation: best.turn*90, slots: slots.map((slot, i) => ({ ...slot,
      slot_index: best.indices[i], id: `${floorId}-${String(best.indices[i]+1).padStart(3, "0")}`,
      kind: plan[best.indices[i]].kind || "normal"
    })) };
  }

  window.ParkViewSlotMapping = { match };
})();
