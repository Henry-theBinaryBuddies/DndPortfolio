import { MM, PEDESTAL_SIDES, PRINT } from "./print";

// Where the bust is cut flat, and what it stands on. The body's underside is not a flat face: the mesh tucks in
// under the shoulders, so just above its lowest point the outline can jump outward by several millimetres,
// leaving a thin wedge that slopes only a few degrees from horizontal. Printed, that wedge is a feather edge
// hanging in the air. So the body is sliced at fine heights, and the cut goes at the lowest plane above which
// nothing in the outline grows outward faster than PRINT.overhang (45 degrees), so everything above the cut
// is supported by the pedestal's flare, and the pedestal's top is made to match the section at the cut exactly.

const STEP = 0.25; // mm between slices
const LEVELS = 41; // slices, from the lowest point up to 10 mm
const REACH_UP = 24; // slices (6 mm) above a candidate cut over which the outline is checked
const NOISE = 0.15; // mm: growth beyond the allowed slope that is ignored
const INSET = 0.2; // mm: the pedestal's top stays this far inside the section, so it never sticks out as a ledge

export interface Underside {
  cut: number; // mm above the lowest point
  footprint: { x: number; z: number }; // the middle of the section at the cut, in the head's own space
  reach: Float32Array; // how far the pedestal's top reaches from that middle, in PEDESTAL_SIDES directions, head units
}

// How far points reach from (cx, cz) in each direction (the farthest in each direction's sector), with empty
// sectors filled in from their neighbours
function reachOf(points: number[], cx: number, cz: number): Float64Array {
  const reach = new Float64Array(PEDESTAL_SIDES);
  const seen = new Uint8Array(PEDESTAL_SIDES);
  for (let i = 0; i < points.length; i += 2) {
    const dx = points[i] - cx;
    const dz = points[i + 1] - cz;
    const bin = Math.floor(((Math.atan2(dz, dx) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / PEDESTAL_SIDES)) % PEDESTAL_SIDES;
    reach[bin] = Math.max(reach[bin], Math.hypot(dx, dz));
    seen[bin] = 1;
  }
  for (let pass = 0; pass < PEDESTAL_SIDES; pass++) {
    let empty = false;
    for (let b = 0; b < PEDESTAL_SIDES; b++) {
      if (seen[b]) continue;
      const left = (b + PEDESTAL_SIDES - 1) % PEDESTAL_SIDES;
      const right = (b + 1) % PEDESTAL_SIDES;
      if (seen[left] && seen[right]) {
        reach[b] = (reach[left] + reach[right]) / 2;
        seen[b] = 1;
      } else if (seen[left]) {
        reach[b] = reach[left];
        seen[b] = 1;
      } else if (seen[right]) {
        reach[b] = reach[right];
        seen[b] = 1;
      } else empty = true;
    }
    if (!empty) break;
  }
  return reach;
}

// `centre` is a first guess at the middle of the underside (used to compare slices with one another)
export function findUnderside(positions: ArrayLike<number>, indices: ArrayLike<number>, baseY: number, centre: { x: number; z: number }): Underside {
  const levels: number[][] = Array.from({ length: LEVELS }, () => []);
  const top = baseY + (LEVELS - 1) * STEP * MM;
  const at = (v: number, k: number) => positions[v * 3 + k];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const lowY = Math.min(at(a, 1), at(b, 1), at(c, 1));
    const highY = Math.max(at(a, 1), at(b, 1), at(c, 1));
    if (highY < baseY || lowY > top) continue;
    const first = Math.max(0, Math.ceil((lowY - baseY) / (STEP * MM)));
    const last = Math.min(LEVELS - 1, Math.floor((highY - baseY) / (STEP * MM)));
    for (let i = first; i <= last; i++) {
      const y = baseY + i * STEP * MM;
      // Where the plane at height y meets the triangle's edges
      const hits: number[] = [];
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const [yp, yq] = [at(p, 1), at(q, 1)];
        if ((yp - y) * (yq - y) > 0 || yp === yq) continue;
        const s = (y - yp) / (yq - yp);
        hits.push(at(p, 0) + (at(q, 0) - at(p, 0)) * s, at(p, 2) + (at(q, 2) - at(p, 2)) * s);
      }
      if (hits.length >= 4) levels[i].push(hits[0], hits[1], hits[2], hits[3], (hits[0] + hits[2]) / 2, (hits[1] + hits[3]) / 2);
    }
  }
  const reaches = levels.map((points) => (points.length ? reachOf(points, centre.x, centre.z) : null));
  // The lowest slice from which the outline above does not hang out
  const slope = PRINT.overhang * STEP * MM; // the growth one slice allows
  const first = Math.ceil(PRINT.flatCut / STEP);
  let cutLevel = -1;
  for (let i = first; i < LEVELS - 1 && cutLevel < 0; i++) {
    const here = reaches[i];
    if (!here) continue;
    let ok = true;
    for (let j = i + 1; j <= Math.min(LEVELS - 1, i + REACH_UP) && ok; j++) {
      const there = reaches[j];
      if (!there) continue;
      for (let b = 0; b < PEDESTAL_SIDES; b++) {
        if (there[b] - here[b] > slope * (j - i) + NOISE * MM) {
          ok = false;
          break;
        }
      }
    }
    if (ok) cutLevel = i;
  }
  if (cutLevel < 0) cutLevel = LEVELS - REACH_UP - 1; // (no clean plane found: the highest one tried)
  while (cutLevel > 0 && !levels[cutLevel].length) cutLevel--;
  // The middle of the section at the cut, and how far its outline reaches from there
  const points = levels[cutLevel];
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    x0 = Math.min(x0, points[i]);
    x1 = Math.max(x1, points[i]);
    z0 = Math.min(z0, points[i + 1]);
    z1 = Math.max(z1, points[i + 1]);
  }
  const footprint = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
  // The pedestal reaches up inside the bust by PRINT.baseOverlap, so its top must fit within the section at every
  // height up to there (where the body curves inward above the cut, the wider section would stick out as a ledge)
  const reach = reachOf(points, footprint.x, footprint.z);
  for (let i = cutLevel + 1; i <= Math.min(LEVELS - 1, cutLevel + Math.ceil(PRINT.baseOverlap / STEP)); i++) {
    if (!levels[i].length) continue;
    const above = reachOf(levels[i], footprint.x, footprint.z);
    for (let b = 0; b < PEDESTAL_SIDES; b++) reach[b] = Math.min(reach[b], above[b]);
  }
  // (each direction's sector holds the farthest point of the outline, which overstates a ragged outline between
  // the points: a direction may reach no farther than its neighbours do, so the top stays inside the section)
  const eroded = reach.map((r, b) => Math.min(r, reach[(b + PEDESTAL_SIDES - 1) % PEDESTAL_SIDES], reach[(b + 1) % PEDESTAL_SIDES]));
  return { cut: cutLevel * STEP, footprint, reach: Float32Array.from(eroded, (r) => Math.max(r - INSET * MM, 0.5 * r)) };
}
