import * as THREE from "three";
import type { BodySurface } from "./bodySurface";
import type { Params } from "./params";
import { MM } from "./print";

// Clothing and armour, fitted to the bare body of either family (see bodySurface.ts), never to the painted scene.
//
// Each garment is a piece of the body's own surface, grown outward: the body's triangles on one side of a line drawn
// on it (a neckline, the edge of a plate, the rim of a pauldron), cut exactly along that line, smoothed as much as
// the garment hides of the body under it (a tunic softens it, a breastplate hides it), lifted off it by a thickness
// that varies over the garment (a rolled collar, folds, a ridge, stepped plates), and closed into a solid: the lifted
// surface outside, the body's own surface a little inside it, and a wall round the edge. So it prints, joined to the
// body, and fits whatever the sliders made of the body; and what it covers is known per vertex of the body, so the
// hair and the beard are built over the clothes (`dressed`), and the next garment over the last.
//
// The tunic is thick and closed, with a low rolled collar and soft folds, and tucks in to nothing at the bust's flat
// cut, so the pedestal still meets the body there with no ledge to print over. Armour is a breastplate and two
// pauldrons over the tunic, smooth, with a raised edge, a ridge down the front of the breastplate and the pauldrons
// stepped into overlapping plates.

export interface Garment {
  name: string; // see parts.ts
  positions: Float32Array; // in the body's frame
  indices: Uint32Array;
}

export interface Dressed {
  garments: Garment[];
  dressed: Float32Array; // the fitting's positions (see bodySurface.ts) with the outside of each garment over what it covers
}

// How far each piece stands off what is under it at the least, and its relief (mm of the full-size print); how much it
// is stretched over the hollows under it (passes: a tunic a little, plate armour into one smooth curve); and how low
// the tunic's collar is cut (head units below the base of the neck, round the back, and more at the front: more again
// under a full beard, which would otherwise rest on it)
// (`ground`: passes of smoothing of what it is grown over before its clearance is kept from that: cloth lies over the
// broad forms under it, plate over none but the broadest, a Dragonborn's large chest scales included)
const TUNIC = { thickness: 2.2, fold: 0.5, roll: 1.2, smoothing: 30, ground: 40 };
const CUIRASS = { thickness: 2.4, ridge: 1.4, rim: 1.0, smoothing: 120, ground: 150 };
const PAULDRON = { thickness: 1.8, dome: 1.6, step: 0.9, rim: 0.9, radius: 0.38, smoothing: 120, ground: 150 };
const COLLAR = { back: 0.025, front: 0.06, frontUnderBeard: 0.11 };
const TUCK = 0.1; // head units above the flat cut over which the tunic thins to nothing
const TOUCH = 0.4 * MM; // the least any garment stands off the body itself

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// (each body's outfit is kept: an edit of the face, the colours or the hair fits nothing anew)
const known = new WeakMap<BodySurface, Map<string, Dressed>>();

export function buildOutfit(p: Params, body: BodySurface): Dressed | null {
  if (p.outfit === "none") return null;
  const key = `${p.outfit} ${p.family === "humanoid" ? p.beardStyle : ""}`;
  let cache = known.get(body);
  if (!cache) known.set(body, (cache = new Map()));
  const found = cache.get(key);
  if (found) return found;

  const { neckBase, sternum, nape, shoulders } = body.anchors;
  const axisZ = (sternum.position.z + nape.position.z) / 2;
  // How much a point is at the front of the body, round the neck's axis (1 straight ahead, 0 behind)
  const front = (x: number, z: number) => ((1 + Math.cos(Math.atan2(x, z - axisZ))) / 2) ** 3;
  const cutY = body.baseY + body.cut * MM;
  const tuck = (y: number) => smooth((y - cutY) / TUCK);
  const garments: Garment[] = [];
  let dressed = body.fitting.positions;

  // The tunic: everything below the collar
  const drop = p.family === "humanoid" && p.beardStyle === "full" ? COLLAR.frontUnderBeard : COLLAR.front;
  const neckline = (x: number, z: number) => neckBase - COLLAR.back - drop * front(x, z);
  const tunic = grow(body, dressed, {
    name: "tunic",
    edge: (x, y, z) => y - neckline(x, z),
    smoothing: TUNIC.smoothing,
    ground: TUNIC.ground,
    inset: 0.5 * TUNIC.thickness * MM,
    clearance: (_x, y) => TUNIC.thickness * MM * tuck(y),
    // (a rolled collar, and soft folds hanging from the chest and shoulders)
    relief: (x, y, z, depth) => (TUNIC.roll * Math.exp(-(((depth - 0.05) / 0.025) ** 2)) + TUNIC.fold * Math.sin(9 * Math.atan2(x, z - axisZ)) * smooth((depth - 0.1) / 0.15)) * MM * tuck(y),
  });
  garments.push(tunic.garment);
  dressed = tunic.dressed;
  // (the armour is grown from the tunic, each piece far enough off it to clear the others: grown from the breastplate,
  // a pauldron's edge ran along the breastplate's and stepped up and down with it)
  const overTunic = tunic.dressed;

  if (p.outfit === "armour") {
    // The breastplate: the chest and back, lower than the collar, with a round opening for each arm (the pauldrons
    // cover the top of it)
    // (round where the arm leaves the body: out past the top of the shoulder and below it, as deep as the body's middle)
    const arms = [shoulders.right, shoulders.left].map((s) => [s.position.x * 1.35, s.position.y - 0.25, (s.position.z + axisZ) / 2]);
    const armhole = (x: number, y: number, z: number) => Math.min(...arms.map(([ax, ay, az]) => Math.hypot(x - ax, y - ay, z - az))) - 0.3;
    const plate = grow(body, overTunic, {
      name: "cuirass",
      edge: (x, y, z) => Math.max(y - (neckline(x, z) - 0.045 - 0.03 * front(x, z)), -armhole(x, y, z)),
      smoothing: CUIRASS.smoothing,
      ground: CUIRASS.ground,
      inset: 0.5 * TUNIC.thickness * MM,
      clearance: (_x, y) => CUIRASS.thickness * MM * tuck(y),
      // (a ridge down the middle of the front, and a rolled edge all round)
      relief: (x, y, z, depth) => (CUIRASS.ridge * Math.exp(-((x / 0.05) ** 2)) * smooth((z - axisZ) / 0.05) * smooth((depth - 0.02) / 0.04) + CUIRASS.rim * Math.exp(-(((depth - 0.045) / 0.025) ** 2))) * MM * tuck(y),
    });
    garments.push(plate.garment);
    dressed = over(dressed, plate.dressed, overTunic);
    // A pauldron over each shoulder: a dome, highest over the top of the shoulder, in three overlapping plates
    for (const shoulder of [shoulders.right, shoulders.left]) {
      const side = Math.sign(shoulder.position.x);
      // (over the round of the shoulder, a little out from the top of it, and down over the arm)
      const [cx, cy, cz] = [shoulder.position.x * 1.15, shoulder.position.y - 0.03, (shoulder.position.z + axisZ) / 2];
      const from = (x: number, y: number, z: number) => Math.hypot(x - cx, y - cy, z - cz) / PAULDRON.radius;
      const piece = grow(body, overTunic, {
        name: "pauldron",
        // (in head units, as every garment's edge is, so its rolled rim is as wide as the others')
        edge: (x, y, z) => (side * x > 0 ? (from(x, y, z) - 1) * PAULDRON.radius : 1),
        smoothing: PAULDRON.smoothing,
        ground: PAULDRON.ground,
        inset: 0.5 * TUNIC.thickness * MM,
        // (over the breastplate's thickness and its rolled edge too)
        clearance: (x, y, z) => (CUIRASS.thickness + CUIRASS.rim + PAULDRON.thickness + PAULDRON.dome * (1 - from(x, y, z) ** 2)) * MM,
        relief: (x, y, z, depth) => {
          const d = from(x, y, z);
          // (each plate's lower edge standing proud of the one below it, which it overlaps)
          const steps = smooth((d - 0.45) / 0.08) + smooth((d - 0.72) / 0.08);
          return (PAULDRON.step * (2 - steps) + PAULDRON.rim * Math.exp(-(((depth - 0.04) / 0.02) ** 2))) * MM;
        },
      });
      garments.push(piece.garment);
      dressed = over(dressed, piece.dressed, overTunic);
    }
  }
  const made = { garments, dressed };
  // (a few kept: the outfits most recently worn)
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(key, made);
  return made;
}

// What is worn so far, with a piece grown over `from` added: wherever the piece moved a point off `from`, it is there
function over(worn: Float32Array, piece: Float32Array, from: Float32Array): Float32Array {
  const out = Float32Array.from(worn);
  for (let i = 0; i < out.length; i += 3) if (piece[i] !== from[i] || piece[i + 1] !== from[i + 1] || piece[i + 2] !== from[i + 2]) out.set(piece.subarray(i, i + 3), i);
  return out;
}

interface Piece {
  name: string;
  // Where the garment ends: it covers the body where this is below zero (head units, so about how far inside its edge)
  edge: (x: number, y: number, z: number) => number;
  // How far it stands off the surface under it at a point, `depth` inside its edge (head units) at the least; and the
  // relief raised off its smoothed outside there (head units)
  clearance: (x: number, y: number, z: number, depth: number) => number;
  relief: (x: number, y: number, z: number, depth: number) => number;
  smoothing: number; // passes of stretching its outside over what is under it (see grow)
  ground: number; // passes of smoothing of what is under it, before its clearance is kept from that
  inset: number; // how far inside that surface its own inner side lies (head units), so it joins what is under it
}

// One garment, grown from `under` (the body, or the body dressed in what is already worn) over the body's skin as it is
// fitted to (see bodySurface.ts)
function grow(body: BodySurface, under: Float32Array, piece: Piece): { garment: Garment; dressed: Float32Array } {
  const fit = body.fitting;
  const n = under.length / 3;
  const edge = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = piece.edge(fit.positions[i * 3], fit.positions[i * 3 + 1], fit.positions[i * 3 + 2]);
    // (never exactly on the line: a corner there would make a triangle of no size)
    edge[i] = e === 0 ? 1e-9 : e;
  }

  // The body's triangles on the garment's side of its edge, the ones that cross it cut along it
  const from: number[] = []; // the body's vertex each of the garment's comes from (-1: on its edge)
  const base: number[] = [];
  const bare: number[] = []; // the body itself there, without the clothes already on it
  const depth: number[] = [];
  const own = new Map<number, number>();
  const take = (v: number) => {
    let at = own.get(v);
    if (at === undefined) {
      at = from.length;
      own.set(v, at);
      from.push(v);
      base.push(under[v * 3], under[v * 3 + 1], under[v * 3 + 2]);
      bare.push(fit.positions[v * 3], fit.positions[v * 3 + 1], fit.positions[v * 3 + 2]);
      depth.push(-edge[v]);
    }
    return at;
  };
  const crossing = new Map<number, number>();
  const cross = (u: number, v: number) => {
    const key = Math.min(u, v) * n + Math.max(u, v);
    let at = crossing.get(key);
    if (at === undefined) {
      at = from.length;
      crossing.set(key, at);
      const t = edge[u] / (edge[u] - edge[v]);
      from.push(-1);
      for (let k = 0; k < 3; k++) base.push(under[u * 3 + k] + (under[v * 3 + k] - under[u * 3 + k]) * t);
      for (let k = 0; k < 3; k++) bare.push(fit.positions[u * 3 + k] + (fit.positions[v * 3 + k] - fit.positions[u * 3 + k]) * t);
      depth.push(0);
    }
    return at;
  };
  const triangles: number[] = [];
  const skin = fit.indices;
  for (let t = 0; t < skin.length; t += 3) {
    const corners = [skin[t], skin[t + 1], skin[t + 2]];
    const inside = corners.filter((v) => edge[v] < 0).length;
    if (inside === 0) continue;
    if (inside === 3) {
      triangles.push(take(corners[0]), take(corners[1]), take(corners[2]));
      continue;
    }
    // (the part inside, in the triangle's own order: a triangle or a quadrilateral, made into triangles from its first corner)
    const polygon: number[] = [];
    for (let k = 0; k < 3; k++) {
      const [u, v] = [corners[k], corners[(k + 1) % 3]];
      if (edge[u] < 0) polygon.push(take(u));
      if (edge[u] < 0 !== edge[v] < 0) polygon.push(cross(u, v));
    }
    for (let k = 1; k + 1 < polygon.length; k++) triangles.push(polygon[0], polygon[k], polygon[k + 1]);
  }
  const count = from.length;
  if (triangles.length === 0) throw new Error(`${piece.name}: the body has no surface where it goes`);

  // Its edge: the sides of its triangles that no other of them shares (where it was cut, and any edge of the body's own)
  const sides = new Set<number>();
  for (let t = 0; t < triangles.length; t += 3) for (let k = 0; k < 3; k++) sides.add(triangles[t + k] * count + triangles[t + ((k + 1) % 3)]);
  const rim: [number, number][] = [];
  const fixed = new Uint8Array(count);
  for (let t = 0; t < triangles.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const [a, b] = [triangles[t + k], triangles[t + ((k + 1) % 3)]];
      if (!sides.has(b * count + a)) {
        rim.push([a, b]);
        fixed[a] = fixed[b] = 1;
      }
    }

  // (its edge first run smoothly along itself where it was cut: cut across the triangles, it zigzagged from one to the
  // next, and the wall round the edge showed it)
  const rimNeighbours: number[][] = Array.from({ length: count }, () => []);
  for (const [a, b] of rim) {
    rimNeighbours[a].push(b);
    rimNeighbours[b].push(a);
  }
  for (const points of [base, bare])
    for (let pass = 0; pass < 20; pass++) {
      const next = points.slice();
      for (let i = 0; i < count; i++) {
        if (!fixed[i] || rimNeighbours[i].length === 0) continue;
        for (let k = 0; k < 3; k++) {
          let mean = 0;
          for (const j of rimNeighbours[i]) mean += points[j * 3 + k];
          next[i * 3 + k] += 0.5 * (mean / rimNeighbours[i].length - points[i * 3 + k]);
        }
      }
      for (let i = 0; i < next.length; i++) points[i] = next[i];
    }

  // Its outside, stretched over what is under it: each pass draws every point toward the middle of its neighbours (along
  // its edge, toward its neighbours there, so the edge runs smoothly), then pushes it back out to its clearance where
  // that drew it in. So it spans the hollows of the body under it, and rests on the rest at its clearance: a garment
  // over the body, not the body painted on it.
  const neighbours: number[][] = Array.from({ length: count }, () => []);
  for (const [a, b] of triangleSides(triangles)) {
    if (!neighbours[a].includes(b)) neighbours[a].push(b);
    if (!neighbours[b].includes(a)) neighbours[b].push(a);
  }
  // (which way is out: the bare body's normals, evened out, so the lumps of the scales or of a muscle, or the edge of a
  // garment already worn, do not each turn the garment their own way)
  let out = vertexNormals(Float32Array.from(bare), triangles, count);
  for (let pass = 0; pass < 30; pass++) {
    const next = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const [nx, ny, nz] = [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]];
      let [sx, sy, sz] = [nx, ny, nz];
      for (const j of neighbours[i]) [sx, sy, sz] = [sx + out[j * 3], sy + out[j * 3 + 1], sz + out[j * 3 + 2]];
      const length = Math.hypot(sx, sy, sz) || 1;
      next.set([sx / length, sy / length, sz / length], i * 3);
    }
    out = next;
  }
  const clearance = new Float32Array(count);
  for (let i = 0; i < count; i++) clearance[i] = piece.clearance(base[i * 3], base[i * 3 + 1], base[i * 3 + 2], depth[i]);
  // (the clearance is kept from what is under it smoothed, its edge held: from the surface itself, the garment rose over
  // every scale of a Dragonborn, and they all showed through it. Smoothed by averaging, which reaches across the broad
  // scales of its chest as smoothing that keeps the volume did not, then set back out by how far that sank it on
  // average round each point: so it lies through the middle of the scales, not under them)
  const average = (values: Float32Array, width: number, passes: number) => {
    let v = values;
    for (let pass = 0; pass < passes; pass++) {
      const next = v.slice();
      for (let i = 0; i < count; i++) {
        if (fixed[i] || neighbours[i].length === 0) continue;
        for (let k = 0; k < width; k++) {
          let mean = 0;
          for (const j of neighbours[i]) mean += v[j * width + k];
          next[i * width + k] += 0.5 * (mean / neighbours[i].length - v[i * width + k]);
        }
      }
      v = next;
    }
    return v;
  };
  const ground = average(Float32Array.from(base), 3, piece.ground);
  const sank = new Float32Array(count);
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) sank[i] += (base[i * 3 + k] - ground[i * 3 + k]) * out[i * 3 + k];
  const lift = average(sank, 1, piece.ground);
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) ground[i * 3 + k] += out[i * 3 + k] * lift[i];
  let outer = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) outer[i] = ground[i] + out[i] * clearance[Math.floor(i / 3)];
  for (let pass = 0; pass < piece.smoothing; pass++) {
    const next = outer.slice();
    for (let i = 0; i < count; i++) {
      const toward = fixed[i] ? rimNeighbours[i] : neighbours[i];
      if (toward.length === 0) continue;
      const step = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        let mean = 0;
        for (const j of toward) mean += outer[j * 3 + k];
        step[k] = 0.5 * (mean / toward.length - outer[i * 3 + k]);
      }
      // (inside, only outward or inward, so nothing slides across the body and off what it measures its clearance from;
      // its edge also along itself, which evens out where it was cut across the triangles)
      const normal = fixed[i] ? 1 : 0;
      const across = step[0] * out[i * 3] + step[1] * out[i * 3 + 1] + step[2] * out[i * 3 + 2];
      for (let k = 0; k < 3; k++) next[i * 3 + k] += normal * step[k] + (1 - normal) * across * out[i * 3 + k];
      let off = 0;
      for (let k = 0; k < 3; k++) off += (next[i * 3 + k] - ground[i * 3 + k]) * out[i * 3 + k];
      if (off < clearance[i]) for (let k = 0; k < 3; k++) next[i * 3 + k] += out[i * 3 + k] * (clearance[i] - off);
    }
    outer = next;
  }
  // ...and checked against the body itself, not the smoothed copy of it the garment was fitted to: wherever it would
  // touch it (a Dragonborn's scales stand up through the smoothing here and there), it is pushed back out
  const point = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    if (clearance[i] <= 0) continue;
    point.fromArray(outer, i * 3);
    const near = body.closest(point);
    const off = near.normal.dot(point.sub(near.point));
    if (off < TOUCH) for (let k = 0; k < 3; k++) outer[i * 3 + k] += near.normal.getComponent(k) * (TOUCH - off);
  }

  // Then its relief (a rolled collar, a ridge, the steps between plates) raised off that smooth outside
  const smoothOut = vertexNormals(outer, triangles, count);
  const inner = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const relief = piece.relief(base[i * 3], base[i * 3 + 1], base[i * 3 + 2], depth[i]);
    for (let k = 0; k < 3; k++) {
      outer[i * 3 + k] += smoothOut[i * 3 + k] * relief;
      inner[i * 3 + k] = base[i * 3 + k] - out[i * 3 + k] * piece.inset;
    }
  }

  // Closed: the outside as the body's triangles run, the inside turned the other way, and a wall round the edge
  const positions = new Float32Array(count * 6);
  positions.set(outer);
  positions.set(inner, count * 3);
  const indices: number[] = [...triangles];
  for (let t = 0; t < triangles.length; t += 3) indices.push(triangles[t] + count, triangles[t + 2] + count, triangles[t + 1] + count);
  for (const [a, b] of rim) indices.push(b, a, a + count, b, a + count, b + count);

  const dressed = Float32Array.from(under);
  for (let i = 0; i < count; i++) if (from[i] >= 0) dressed.set(outer.subarray(i * 3, i * 3 + 3), from[i] * 3);
  return { garment: { name: piece.name, positions, indices: Uint32Array.from(indices) }, dressed };
}

function* triangleSides(triangles: number[]): Generator<[number, number]> {
  for (let t = 0; t < triangles.length; t += 3) for (let k = 0; k < 3; k++) yield [triangles[t + k], triangles[t + ((k + 1) % 3)]];
}

// Each vertex's normal: the sum of its triangles' (so weighted by their size), made unit length
function vertexNormals(positions: Float32Array, triangles: number[], count: number): Float32Array {
  const normals = new Float32Array(count * 3);
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t] * 3, triangles[t + 1] * 3, triangles[t + 2] * 3];
    const [ux, uy, uz] = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const [vx, vy, vz] = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  for (let i = 0; i < count * 3; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return normals;
}
