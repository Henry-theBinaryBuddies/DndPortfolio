import * as THREE from "three";
import type { HeadBase } from "./headMesh";
import { masculinity, type Params } from "./params";
import { MM } from "./print";

// Eyebrows, sculpted as a sculptor would carve them on a miniature: a low raised form in the shape of the
// brow, with V-grooves cut into it along the way the hair lies (rising at the head of the brow, sweeping
// outward along it, turning down at the tail). Strands read as bushy and unreal, and could not print.
//
// The shape of an eyebrow is measured in head-local units on the undeformed head (origin between the eyes,
// +y up, the face toward +z), outward from the middle of the face. A brow has a fuller head near the nose,
// an arch that peaks about two thirds of the way out, and a tail that thins and dips toward the temple. A
// masculine brow sits lower and flatter and is heavier; a feminine one is finer with a higher arch. (A plain
// band the same height all the way along read as a bar.)

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

const HEAD = 0.045; // where the brow starts, out from the middle of the face
const TAIL = 0.335; // where it ends, past the outer corner of the eye

export interface BrowShape {
  t: number; // 0 at the head of the brow, 1 at the tip of the tail
  centre: number; // the height of its centre line
  half: number; // half its height
  slope: number; // how steeply its centre line rises (+) or falls (-) going outward
}

// m: 1 masculine, 0 feminine. bushy: the Eyebrows slider.
export function browShape(ax: number, m: number, bushy: number): BrowShape {
  const t = (ax - HEAD) / (TAIL - HEAD);
  const arch = 0.026 + 0.022 * (1 - m);
  const lift = (u: number) => 0.088 - 0.008 * m + arch * Math.sin(Math.PI * Math.min(1, Math.max(0, u)) * 0.82) - 0.028 * smooth((u - 0.72) / 0.28);
  const centre = lift(t);
  const slope = (lift(t + 0.02) - lift(t - 0.02)) / (0.04 * (TAIL - HEAD));
  const half = 0.024 * (0.75 + 0.45 * m) * (0.75 + 0.5 * bushy) * (1 - 0.7 * smooth((t - 0.35) / 0.65)) * (1 - 0.15 * smooth((0.12 - t) / 0.12));
  return { t, centre, half, slope };
}

// How much a point lies inside the brow: 1 well inside, fading over a soft edge, 0 outside. Only the front
// of the face carries brows.
export function browWeight(x: number, y: number, z: number, m: number, bushy: number): number {
  const ax = Math.abs(x);
  const s = browShape(ax, m, bushy);
  if (s.t < -0.15 || s.t > 1.1 || z < -0.15) return 0;
  const along = smooth((s.t + 0.08) / 0.12) * (1 - smooth((s.t - 0.94) / 0.12));
  const across = 1 - smooth((Math.abs(y - s.centre) - s.half * 0.7) / (s.half * 0.6 + 0.004));
  return along * across * smooth((z + 0.15) / 0.2);
}

// The carving, in print millimetres (see print.ts): grooves every 0.75 mm, each a V about 0.45 mm wide and
// up to 0.28 mm deep, cut into a brow raised 0.35-0.85 mm and never less than 0.9 mm tall. The head mesh is
// too coarse for grooves this fine (its edges are about 0.3 mm here), so each brow is a dense grid of its
// own laid over the skin.
export const BROW_CARVING = {
  pitch: 0.75 * MM,
  grooveWidth: 0.6 * 0.75 * MM,
  depth: 0.28 * MM,
  minWidth: 0.9 * MM,
};

const ALONG = 120;
const ACROSS = 28;
const EDGE = 1.3; // the grid reaches this many half-heights either side of the brow's centre line
const SKIN_GAP = 0.0015;

// The front of the undeformed face, binned by x and y, so a point drawn on the brow can be found on the
// head and followed through any deformation: the same triangle with the same weights, on the reshaped head.
interface Spot {
  a: number;
  b: number;
  c: number;
  wa: number;
  wb: number;
  wc: number;
}
const BIN = 0.02;
const lookups = new WeakMap<HeadBase, (x: number, y: number) => Spot | null>();
function frontLookup(base: HeadBase): (x: number, y: number) => Spot | null {
  const cached = lookups.get(base);
  if (cached) return cached;
  const p = base.positions;
  const bins = new Map<string, number[]>();
  for (let t = 0; t < base.indices.length; t += 3) {
    const a = base.indices[t];
    const b = base.indices[t + 1];
    const c = base.indices[t + 2];
    const xs = [p[a * 3], p[b * 3], p[c * 3]];
    const ys = [p[a * 3 + 1], p[b * 3 + 1], p[c * 3 + 1]];
    const zs = [p[a * 3 + 2], p[b * 3 + 2], p[c * 3 + 2]];
    // (only the face near the brows, round to the temples where the tail reaches; where a point lies over
    // several, the frontmost wins)
    if (Math.min(...zs) < -0.35 || Math.max(...ys) < -0.08 || Math.min(...ys) > 0.3 || Math.min(...xs.map(Math.abs)) > 0.45) continue;
    for (let i = Math.floor(Math.min(...xs) / BIN); i <= Math.floor(Math.max(...xs) / BIN); i++) {
      for (let j = Math.floor(Math.min(...ys) / BIN); j <= Math.floor(Math.max(...ys) / BIN); j++) {
        const key = `${i},${j}`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key)!.push(a, b, c);
      }
    }
  }
  const lookup = (x: number, y: number): Spot | null => {
    const tris = bins.get(`${Math.floor(x / BIN)},${Math.floor(y / BIN)}`);
    if (!tris) return null;
    let best: Spot | null = null;
    let bestZ = -Infinity;
    for (let k = 0; k < tris.length; k += 3) {
      const a = tris[k];
      const b = tris[k + 1];
      const c = tris[k + 2];
      const x0 = p[a * 3];
      const y0 = p[a * 3 + 1];
      const x1 = p[b * 3] - x0;
      const y1 = p[b * 3 + 1] - y0;
      const x2 = p[c * 3] - x0;
      const y2 = p[c * 3 + 1] - y0;
      const det = x1 * y2 - x2 * y1;
      const wb = ((x - x0) * y2 - x2 * (y - y0)) / det;
      const wc = (x1 * (y - y0) - (x - x0) * y1) / det;
      const wa = 1 - wb - wc;
      if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
      const z = wa * p[a * 3 + 2] + wb * p[b * 3 + 2] + wc * p[c * 3 + 2];
      if (z > bestZ) {
        bestZ = z;
        best = { a, b, c, wa, wb, wc };
      }
    }
    return best;
  };
  lookups.set(base, lookup);
  return lookup;
}

const hash = (k: number, side: number) => {
  const s = Math.sin(k * 127.1 + side * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// Both brows as one geometry of two closed solids: a carved top, a base just under the skin, and a wall
// round the edge (where the top has come down to the skin). Null when the Eyebrows slider is off.
export function buildBrows(p: Params, positions: Float32Array, normals: Float32Array, base: HeadBase): THREE.BufferGeometry | null {
  const bushy = p.eyebrows;
  if (bushy < 0.03) return null;
  const m = masculinity(p);
  const lookup = frontLookup(base);
  const peak = (0.35 + 0.5 * bushy) * MM;
  const { pitch, grooveWidth, depth, minWidth } = BROW_CARVING;
  const rows = ACROSS + 1;
  const per = (ALONG + 1) * rows;
  const vertices: number[] = [];
  const index: number[] = [];

  for (const side of [1, -1]) {
    const skin = new Float32Array(per * 3);
    let dirs = new Float32Array(per * 3);
    const lift = new Float32Array(per);
    for (let i = 0; i <= ALONG; i++) {
      const t = i / ALONG;
      const ax = HEAD + t * (TAIL - HEAD);
      const shape = browShape(ax, m, bushy);
      const half = Math.max(shape.half, minWidth / 2);
      // The way the hair lies, as an angle above the line of the brow: up at its head, outward along it,
      // turning down at the tail
      const angle = 1.25 - 0.9 * smooth(t / 0.35) - 0.5 * smooth((t - 0.6) / 0.4);
      // Rounded at the head, lower toward the tail, closing at its tip (raised to full height within a few
      // millimetres of the head, it ended in a square cliff and read as a block)
      const along = smooth(t / 0.18) * (1 - 0.5 * smooth((t - 0.45) / 0.45)) * (1 - smooth((t - 0.88) / 0.12));
      // ...and narrower there seen from the front, so the head of the brow is rounded, not square
      const span = EDGE * (0.45 + 0.55 * Math.sqrt(smooth(t / 0.2)));
      for (let j = 0; j < rows; j++) {
        const s = -EDGE + (2 * EDGE * j) / ACROSS;
        const k = i * rows + j;
        const spot = lookup(side * ax, shape.centre + s * half);
        if (!spot) throw new Error(`A brow point is off the face: ${side * ax} ${shape.centre + s * half}`);
        for (let d = 0; d < 3; d++) {
          skin[k * 3 + d] = spot.wa * positions[spot.a * 3 + d] + spot.wb * positions[spot.b * 3 + d] + spot.wc * positions[spot.c * 3 + d];
          dirs[k * 3 + d] = spot.wa * normals[spot.a * 3 + d] + spot.wb * normals[spot.b * 3 + d] + spot.wc * normals[spot.c * 3 + d];
        }
        // A domed section across the brow, coming down to the skin at its edge (flat-topped with steep sides
        // it read as a caterpillar)
        const height = peak * along * Math.max(0, 1 - (s / span) ** 2) ** 1.2;
        // The grooves: lines leaning at the hair's angle, a fixed pitch apart, each a little deeper or
        // shallower than the next, and never more than half the brow's height
        const u = t * (TAIL - HEAD);
        const v = s * half;
        const phase = (u * Math.sin(angle) - v * Math.cos(angle)) / pitch;
        const n = Math.floor(phase);
        const vee = Math.max(0, 1 - Math.abs(phase - n - 0.5) / (grooveWidth / pitch / 2));
        const cut = Math.min(depth * (0.75 + 0.5 * hash(n, side)), 0.5 * height) * vee;
        // (at its very edge it dips just under the skin, so the two never fight over the same depth)
        lift[k] = height - cut - SKIN_GAP * (1 - smooth(height / (0.2 * MM)));
      }
    }
    // Raised along the skin's normals, evened out over the grid so a crease under it cannot fold the top
    for (let pass = 0; pass < 4; pass++) {
      const next = new Float32Array(dirs.length);
      for (let i = 0; i <= ALONG; i++) {
        for (let j = 0; j < rows; j++) {
          const k = i * rows + j;
          for (let d = 0; d < 3; d++) {
            let sum = dirs[k * 3 + d] * 2;
            let count = 2;
            if (i > 0) (sum += dirs[(k - rows) * 3 + d]), count++;
            if (i < ALONG) (sum += dirs[(k + rows) * 3 + d]), count++;
            if (j > 0) (sum += dirs[(k - 1) * 3 + d]), count++;
            if (j < ACROSS) (sum += dirs[(k + 1) * 3 + d]), count++;
            next[k * 3 + d] = sum / count;
          }
        }
      }
      dirs = next;
    }
    const first = vertices.length / 3;
    const n = new THREE.Vector3();
    const top: number[] = [];
    const under: number[] = [];
    for (let k = 0; k < per; k++) {
      n.set(dirs[k * 3], dirs[k * 3 + 1], dirs[k * 3 + 2]).normalize();
      top.push(skin[k * 3] + n.x * lift[k], skin[k * 3 + 1] + n.y * lift[k], skin[k * 3 + 2] + n.z * lift[k]);
      under.push(skin[k * 3] - n.x * 2 * SKIN_GAP, skin[k * 3 + 1] - n.y * 2 * SKIN_GAP, skin[k * 3 + 2] - n.z * 2 * SKIN_GAP);
    }
    vertices.push(...top, ...under);
    // Outward along the brow is +x on the right brow and -x on the left, so the left one winds the other way
    const at = (i: number, j: number, below = 0) => first + below * per + i * rows + j;
    const quad = (q0: number, q1: number, q2: number, q3: number) => {
      if (side > 0) index.push(q0, q1, q2, q1, q3, q2);
      else index.push(q0, q2, q1, q1, q2, q3);
    };
    for (let i = 0; i < ALONG; i++) {
      for (let j = 0; j < ACROSS; j++) {
        quad(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
        quad(at(i, j, 1), at(i, j + 1, 1), at(i + 1, j, 1), at(i + 1, j + 1, 1));
      }
    }
    // The wall round the edge, joining the top to the base
    for (let i = 0; i < ALONG; i++) {
      quad(at(i, 0, 1), at(i + 1, 0, 1), at(i, 0), at(i + 1, 0));
      quad(at(i, ACROSS), at(i + 1, ACROSS), at(i, ACROSS, 1), at(i + 1, ACROSS, 1));
    }
    for (let j = 0; j < ACROSS; j++) {
      quad(at(0, j), at(0, j + 1), at(0, j, 1), at(0, j + 1, 1));
      quad(at(ALONG, j, 1), at(ALONG, j + 1, 1), at(ALONG, j), at(ALONG, j + 1));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
