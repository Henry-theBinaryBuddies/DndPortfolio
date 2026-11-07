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
  outside?: number; // how many of its vertices, the first, are its outside (a garment grown over the body: see grow)
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
const TUNIC = {
  thickness: 2.2,
  fold: 0.5,
  roll: 1.2,
  smoothing: 30,
  ground: 40,
};
const CUIRASS = {
  thickness: 2.4,
  ridge: 1.4,
  rim: 1.0,
  smoothing: 120,
  ground: 150,
};
const PAULDRON = {
  thickness: 1.8,
  dome: 1.6,
  step: 0.9,
  rim: 0.9,
  radius: 0.38,
  smoothing: 120,
  ground: 150,
};
// The jerkin: stiffer than the tunic, cut lower, with a V at the front, a raised seam inside its edge, and a baldric
// over the right shoulder (`vee`, how deep the V is and `veeWidth` how wide, head units; `baldric`, half its width)
const JERKIN = {
  thickness: 2.0,
  welt: 0.7,
  strap: 1.3,
  baldric: 0.05,
  vee: 0.13,
  veeWidth: 0.1,
  smoothing: 60,
  ground: 80,
};
// The gorget: a plate collar over the top of the breastplate and up round the base of the neck, in three lames
// (`rise`, how far above the base of the neck it comes; `drop`, how far below the tunic's collar)
const GORGET = {
  thickness: 1.6,
  lame: 0.7,
  rim: 0.8,
  rise: 0.035,
  drop: 0.075,
  smoothing: 120,
  ground: 150,
};
// The cloak: over everything else, down the back and over the shoulders, open at the front (`opening`, half the gap
// at the collar, widening by `spread` per head unit down, to `widest`), with a rolled hem, folds down the back, and a
// cowl, the hood thrown back and gathered round the back of the neck, if it has one. Its clasps: a domed disc at each
// side of the opening, below the collar
const CLOAK = {
  thickness: 1.6,
  hem: 1.0,
  fold: 2.2,
  cowl: 6.5,
  rise: 0.01,
  opening: 0.07,
  spread: 0.35,
  widest: 0.2,
  reach: 0.12,
  smoothing: 120,
  ground: 150,
};
const CLASP = {
  radius: 2.6 * MM,
  thickness: 0.6,
  dome: 1.0,
  rim: 0.5,
  below: 0.12,
};
const COLLAR = { back: 0.025, front: 0.06, frontUnderBeard: 0.11 };
const TUCK = 0.1; // head units above the flat cut over which the tunic thins to nothing
const TOUCH = 0.4 * MM; // the least any garment stands off the body itself
const RELIEF_PASSES = 4; // of evening out the relief (see grow)
const EDGE_PASSES = 20; // of smoothing a garment's edge along itself, in what it is grown over (see grow)

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// An outfit as it is kept: its garments, and the points of the body's fitting it moved, and where to (so it can be put on
// another body of the same shape where it is worn: see fitKey)
export interface Fitted {
  garments: Garment[];
  moved: Uint32Array;
  to: Float32Array;
}

// (each body's outfit is kept, and each fit by the shape it was fitted to, so a body sculpted anew with only its face
// changed is dressed in the outfit already fitted: see fitKey)
const known = new WeakMap<BodySurface, Map<string, Dressed>>();
const fits = new Map<string, Fitted>();

// Whether anything is worn
export const dressedAtAll = (p: Params) => p.outfit !== "none" || p.cloak !== "none";

// What an outfit's fit depends on, as a key: what is worn (and the beard, which lowers the collar), and the shape of the
// body wherever any garment can reach, with a margin, and the anchors it is placed by. Not the settings: every slider
// moves some of the body, and most move none of it under the clothes (a cheekbone, the nose, the brow), so the shape
// itself is read, and a slider that does move the neck or the shoulders (the jaw, the weight) still fits it anew.
// (The margin: a garment's edge falls between the body's points, the cloak is grown over its neighbours two rings out,
// and it is kept off the nearest of the body, which with the cowl may be a little way off)
const REGION = { above: 0.15, margin: 0.15 };
const shapes = new WeakMap<BodySurface, string>();
export function fitKey(p: Params, body: BodySurface): string {
  return `${p.outfit} ${p.cloak} ${p.family === "humanoid" ? p.beardStyle : ""} ${shapeKey(body)}`;
}
function shapeKey(body: BodySurface): string {
  const found = shapes.get(body);
  if (found) return found;
  const { neckBase, sternum, nape, shoulders } = body.anchors;
  const axisZ = (sternum.position.z + nape.position.z) / 2;
  const centres = [shoulders.right, shoulders.left].map((s) => [s.position.x * 1.15, s.position.y - 0.03, (s.position.z + axisZ) / 2]);
  const reached = (x: number, y: number, z: number) => y < neckBase + REGION.above || centres.some(([cx, cy, cz]) => Math.hypot(x - cx, y - cy, z - cz) < PAULDRON.radius + REGION.margin);
  // (two 32-bit hashes of the exact bits, as one 64-bit key)
  let [a, b] = [0x811c9dc5, 0x9e3779b9];
  const word = new Float32Array(1);
  const bits = new Uint32Array(word.buffer);
  const mix = (n: number) => {
    a = Math.imul(a ^ n, 0x01000193);
    b = Math.imul(b ^ n, 0x85ebca6b) ^ (b >>> 13);
  };
  const number = (v: number) => {
    word[0] = v;
    mix(bits[0]);
  };
  for (const v of [body.baseY, body.cut, neckBase, ...[sternum, nape, shoulders.right, shoulders.left].flatMap((anchor) => [...anchor.position.toArray(), ...anchor.normal.toArray()])]) number(v);
  // (the fitting's points, and the body's own where it is not the fitting, as a Dragonborn's is not: kept off that)
  for (const points of body.positions === body.fitting.positions ? [body.positions] : [body.fitting.positions, body.positions]) {
    mix(points.length);
    for (let i = 0; i < points.length; i += 3)
      if (reached(points[i], points[i + 1], points[i + 2])) {
        mix(i);
        number(points[i]);
        number(points[i + 1]);
        number(points[i + 2]);
      }
  }
  const key = `${body.family} ${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
  shapes.set(body, key);
  return key;
}

// Whether this outfit has been fitted to a body of this shape already (so buildOutfit takes no time)
export const fittedAlready = (p: Params, body: BodySurface) => !dressedAtAll(p) || fits.has(fitKey(p, body));

// An outfit fitted elsewhere (in a worker: see fitWorker.ts), to a body of this shape, kept as if fitted here
export function keepFit(p: Params, body: BodySurface, fitted: Fitted): void {
  remember(fitKey(p, body), fitted);
}
function remember(key: string, fitted: Fitted) {
  // (a few kept: the outfits and shapes most recently worn)
  fits.delete(key);
  if (fits.size >= 6) fits.delete(fits.keys().next().value!);
  fits.set(key, fitted);
}

export function buildOutfit(p: Params, body: BodySurface): Dressed | null {
  if (!dressedAtAll(p)) return null;
  const key = fitKey(p, body);
  let cache = known.get(body);
  if (!cache) known.set(body, (cache = new Map()));
  const found = cache.get(key);
  if (found) return found;
  const fitted = fits.get(key) ?? fit(p, body);
  remember(key, fitted);
  // (on this body: its own points, moved where the outfit moved them)
  const dressed = Float32Array.from(body.fitting.positions);
  for (let m = 0; m < fitted.moved.length; m++) dressed.set(fitted.to.subarray(m * 3, m * 3 + 3), fitted.moved[m] * 3);
  const made = { garments: fitted.garments, dressed };
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(key, made);
  return made;
}

// The outfit fitted to the body (see buildOutfit, which keeps it)
export function fit(p: Params, body: BodySurface): Fitted {
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
  // (round where the arm leaves the body: out past the top of the shoulder and below it, as deep as the body's middle)
  const arms = [shoulders.right, shoulders.left].map((s) => [s.position.x * 1.35, s.position.y - 0.25, (s.position.z + axisZ) / 2]);
  const armhole = (x: number, y: number, z: number) => Math.min(...arms.map(([ax, ay, az]) => Math.hypot(x - ax, y - ay, z - az))) - 0.3;

  if (p.outfit !== "none") {
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
  }
  // (what goes over the tunic is grown from it, each piece far enough off it to clear the others: grown from the
  // breastplate, a pauldron's edge ran along the breastplate's and stepped up and down with it)
  const overTunic = dressed;

  if (p.outfit === "leather") {
    // The jerkin: sleeveless, lower than the tunic's collar, with a V at the front
    const jerkinTop = (x: number, z: number) => neckline(x, z) - 0.02 - JERKIN.vee * smooth(1 - Math.abs(x) / JERKIN.veeWidth) * smooth((z - axisZ) / 0.05);
    // (the baldric: from over the right shoulder, between its top and the neck, across the chest and the back to the
    // left hip, as it hangs from the shoulder both ways)
    const right = shoulders.right.position;
    const [ax, ay] = [right.x * 0.6, right.y + 0.05];
    const [dx, dy] = [-right.x * 0.75 - ax, cutY - ay];
    const length = Math.hypot(dx, dy);
    const strap = (x: number, y: number) => smooth((JERKIN.baldric - Math.abs(((x - ax) * dy - (y - ay) * dx) / length)) / 0.02);
    const jerkin = grow(body, overTunic, {
      name: "jerkin",
      edge: (x, y, z) => Math.max(y - jerkinTop(x, z), -(armhole(x, y, z) + 0.03)),
      smoothing: JERKIN.smoothing,
      ground: JERKIN.ground,
      inset: 0.5 * TUNIC.thickness * MM,
      clearance: (_x, y) => JERKIN.thickness * MM * tuck(y),
      // (a seam standing up a little inside its edge all round, and the baldric over it)
      relief: (x, y, _z, depth) => (JERKIN.welt * Math.exp(-(((depth - 0.045) / 0.02) ** 2)) + JERKIN.strap * strap(x, y) * smooth(depth / 0.03)) * MM * tuck(y),
    });
    garments.push(jerkin.garment);
    dressed = jerkin.dressed;
  }

  if (p.outfit === "armour") {
    // The breastplate: the chest and back, lower than the collar, with a round opening for each arm (the pauldrons
    // cover the top of it)
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
    // The gorget: from over the top of the breastplate to a little up the neck, standing off it as far as the
    // breastplate's edge does, in three lames, each lower one standing proud of the one above it
    const [low, high] = [(x: number, z: number) => neckline(x, z) - GORGET.drop - 0.03 * front(x, z), neckBase + GORGET.rise];
    // (grown over the breastplate as it is, rising over its ridge and rolled edge in a soft swell: kept off the tunic by
    // the breastplate's thickness and its edge, it came down onto the ridge either side of the middle, and its edge was
    // notched there; its inside still on the tunic, under the breastplate's edge)
    const underGorget = spread(body, dressed, 2);
    const gorget = grow(body, underGorget, {
      inside: overTunic,
      name: "gorget",
      edge: (x, y, z) => Math.max(y - high, low(x, z) - y),
      smoothing: GORGET.smoothing,
      ground: GORGET.ground,
      inset: 0.5 * TUNIC.thickness * MM,
      clear: 25,
      clearance: () => GORGET.thickness * MM,
      relief: (x, y, z, depth) => {
        const up = (y - low(x, z)) / (high - low(x, z));
        const lames = smooth((up - 0.33) / 0.15) + smooth((up - 0.66) / 0.15);
        return (GORGET.lame * (2 - lames) + GORGET.rim * Math.exp(-(((depth - 0.035) / 0.025) ** 2))) * MM;
      },
    });
    garments.push(gorget.garment);
    dressed = over(dressed, gorget.dressed, underGorget);
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

  if (p.cloak !== "none") {
    // The cloak, grown over all that is worn (its clearance kept from that as it is, nearly unsmoothed, so it clears
    // the pauldrons' edges, and stretched over the hollows between them)
    const top = (x: number, z: number) => neckBase + CLOAK.rise - 0.04 * front(x, z);
    // (half the opening at the front at a height, and how much of a point is at the front, where the opening is)
    const opening = (y: number) => Math.min(CLOAK.widest, CLOAK.opening + CLOAK.spread * Math.max(0, neckBase - y));
    const ahead = (z: number) => smooth((z - axisZ) / 0.05);
    const behind = (x: number, z: number) => 1 - front(x, z) ** 0.3;
    const cloak = grow(body, spread(body, dressed, 2), {
      // (its inside on what is worn as it is: on that taken out to its neighbours, over a Dragonborn's uneven body, it
      // folded through itself)
      inside: dressed,
      name: "cloak",
      edge: (x, y, z) => Math.max(y - top(x, z), ahead(z) > 0.5 ? opening(y) - Math.abs(x) : -1),
      smoothing: CLOAK.smoothing,
      ground: CLOAK.ground,
      inset: 0.5 * TUNIC.thickness * MM,
      clearance: (_x, y) => CLOAK.thickness * MM * tuck(y),
      hang: { axisZ, reach: CLOAK.reach },
      clear: 25,
      // (a rolled hem; folds hanging down the back, deeper lower down; and the cowl, highest at the back of the neck)
      relief: (x, y, z, depth) => {
        const hem = CLOAK.hem * Math.exp(-(((depth - 0.03) / 0.02) ** 2));
        const folds = CLOAK.fold * (0.5 + 0.5 * Math.sin(14 * Math.atan2(x, z - axisZ))) * behind(x, z) * smooth((neckBase - 0.12 - y) / 0.3);
        const cowl = p.cloak === "cowl" ? CLOAK.cowl * Math.exp(-(((depth - 0.08) / 0.055) ** 2)) * Math.sqrt(behind(x, z)) : 0;
        return (hem + folds + cowl) * MM * tuck(y);
      },
    });
    garments.push(cloak.garment);
    dressed = cloak.dressed;
    // Its clasps: a domed disc with a raised rim each side of the opening, below the collar, set into the cloak's
    // outside where it is nearest (smaller than the body's triangles would draw them, so turned as solids of their own)
    // (square to the cloak round it: at one point its surface may turn over its hem, a Dragonborn's body over a scale)
    const outside = cloak.garment.positions.subarray(0, cloak.garment.outside! * 3);
    // (of its outside's triangles alone: the wall round its edge faces sideways along the opening)
    const half = outside.length / 3;
    const faces = Array.from(cloak.garment.indices).filter((_, i, list) => {
      const t = i - (i % 3);
      return list[t] < half && list[t + 1] < half && list[t + 2] < half;
    });
    const normals = vertexNormals(outside, faces, half);
    for (const side of [-1, 1]) {
      const [cx, cy] = [side * (opening(neckBase - CLASP.below) + CLASP.radius + 0.035), neckBase - CLASP.below];
      let [best, at] = [Infinity, -1];
      for (let i = 0; i < outside.length; i += 3) {
        if (outside[i + 2] < axisZ) continue;
        const d = Math.hypot(outside[i] - cx, outside[i + 1] - cy);
        if (d < best) [best, at] = [d, i];
      }
      const point = new THREE.Vector3().fromArray(outside, at);
      const normal = new THREE.Vector3();
      for (let i = 0; i < outside.length; i += 3) if (Math.hypot(outside[i] - point.x, outside[i + 1] - point.y, outside[i + 2] - point.z) < 3 * CLASP.radius) normal.add(new THREE.Vector3().fromArray(normals, i));
      garments.push(clasp(point, normal.normalize()));
    }
  }
  const bare = body.fitting.positions;
  const moved: number[] = [];
  for (let i = 0; i < bare.length; i += 3) if (dressed[i] !== bare[i] || dressed[i + 1] !== bare[i + 1] || dressed[i + 2] !== bare[i + 2]) moved.push(i / 3);
  return { garments, moved: Uint32Array.from(moved), to: Float32Array.from(moved.flatMap((v) => [dressed[v * 3], dressed[v * 3 + 1], dressed[v * 3 + 2]])) };
}

// What is worn, each point taken out as far as the furthest of its neighbours `rings` away stands off the bare body,
// along the body's normal there: so what is grown over it clears the edges of what is worn, which run partway between
// the body's points
function spread(body: BodySurface, worn: Float32Array, rings: number): Float32Array {
  const bare = body.fitting.positions;
  const n = bare.length / 3;
  const normals = vertexNormals(bare, Array.from(body.fitting.indices), n);
  let off = new Float32Array(n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) off[i] += (worn[i * 3 + k] - bare[i * 3 + k]) * normals[i * 3 + k];
  const own = off;
  const triangles = body.fitting.indices;
  for (let ring = 0; ring < rings; ring++) {
    const next = Float32Array.from(off);
    for (let t = 0; t < triangles.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const [a, b] = [triangles[t + k], triangles[t + ((k + 1) % 3)]];
        next[a] = Math.max(next[a], off[b]);
        next[b] = Math.max(next[b], off[a]);
      }
    off = next;
  }
  const out = Float32Array.from(worn);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] += normals[i * 3 + k] * (off[i] - own[i]);
  return out;
}

// What is worn so far, with a piece grown over `from` added: wherever the piece moved a point off `from`, it is there
function over(worn: Float32Array, piece: Float32Array, from: Float32Array): Float32Array {
  const out = Float32Array.from(worn);
  for (let i = 0; i < out.length; i += 3) if (piece[i] !== from[i] || piece[i + 1] !== from[i + 1] || piece[i + 2] !== from[i + 2]) out.set(piece.subarray(i, i + 3), i);
  return out;
}

interface Piece {
  inside?: Float32Array; // what its inner side lies just inside, if not what it is grown over (the body's points)
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
  // Whether it hangs: below the widest it comes out from the body's upright axis (at `axisZ`), it falls straight down,
  // as far as `reach` (head units) out from what it is over, rather than following the body back in under it
  hang?: { axisZ: number; reach: number };
  // Whether its clearance is kept from what is under it smoothed only this much too (passes), not only from that
  // smoothed as much as `ground` says (over other garments, whose edges and rounded tops that sinks below)
  clear?: number;
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
  const inside = piece.inside ?? under;
  const within: number[] = []; // what its inner side lies just inside
  const depth: number[] = [];
  const own = new Map<number, number>();
  const take = (v: number) => {
    let at = own.get(v);
    if (at === undefined) {
      at = from.length;
      own.set(v, at);
      from.push(v);
      base.push(under[v * 3], under[v * 3 + 1], under[v * 3 + 2]);
      within.push(inside[v * 3], inside[v * 3 + 1], inside[v * 3 + 2]);
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
      for (let k = 0; k < 3; k++) within.push(inside[u * 3 + k] + (inside[v * 3 + k] - inside[u * 3 + k]) * t);
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
  const rimLists: number[][] = Array.from({ length: count }, () => []);
  for (const [a, b] of rim) {
    rimLists[a].push(b);
    rimLists[b].push(a);
  }
  const rimNeighbours = packed(rimLists);
  // (and its inner side's edge with it: left as it was cut, the wall from the smoothed outside down to it twisted from
  // one triangle to the next, and showed as streaks down the edge of a plate)
  for (const points of [base, bare, within])
    for (let pass = 0; pass < 20; pass++) {
      const next = points.slice();
      for (let i = 0; i < count; i++) {
        const [start, end] = [rimNeighbours.start[i], rimNeighbours.start[i + 1]];
        if (!fixed[i] || start === end) continue;
        for (let k = 0; k < 3; k++) {
          let mean = 0;
          for (let n = start; n < end; n++) mean += points[rimNeighbours.list[n] * 3 + k];
          next[i * 3 + k] += 0.5 * (mean / (end - start) - points[i * 3 + k]);
        }
      }
      for (let i = 0; i < next.length; i++) points[i] = next[i];
    }

  // Its outside, stretched over what is under it: each pass draws every point toward the middle of its neighbours (along
  // its edge, toward its neighbours there, so the edge runs smoothly), then pushes it back out to its clearance where
  // that drew it in. So it spans the hollows of the body under it, and rests on the rest at its clearance: a garment
  // over the body, not the body painted on it.
  const lists: number[][] = Array.from({ length: count }, () => []);
  for (const [a, b] of triangleSides(triangles)) {
    if (!lists[a].includes(b)) lists[a].push(b);
    if (!lists[b].includes(a)) lists[b].push(a);
  }
  // (packed into one array, each point's run of it from start[i] to start[i + 1]: the passes below read them hundreds of times)
  const neighbours = packed(lists);
  const { start, list } = neighbours;
  // (which way is out: the bare body's normals, evened out, so the lumps of the scales or of a muscle, or the edge of a
  // garment already worn, do not each turn the garment their own way)
  let out = vertexNormals(Float32Array.from(bare), triangles, count);
  for (let pass = 0; pass < 30; pass++) {
    const next = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      let [sx, sy, sz] = [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]];
      for (let n = start[i]; n < start[i + 1]; n++) {
        const j = list[n] * 3;
        sx += out[j];
        sy += out[j + 1];
        sz += out[j + 2];
      }
      const length = Math.hypot(sx, sy, sz) || 1;
      next[i * 3] = sx / length;
      next[i * 3 + 1] = sy / length;
      next[i * 3 + 2] = sz / length;
    }
    out = next;
  }
  const clearance = new Float32Array(count);
  for (let i = 0; i < count; i++) clearance[i] = piece.clearance(base[i * 3], base[i * 3 + 1], base[i * 3 + 2], depth[i]);
  // (the clearance is kept from what is under it smoothed: from the surface itself, the garment rose over every scale of
  // a Dragonborn, and they all showed through it. Smoothed by averaging, which reaches across the broad scales of its
  // chest as smoothing that keeps the volume did not, then set back out by how far that sank it on average round each
  // point: so it lies through the middle of the scales, not under them. Its edge is smoothed only along itself, and only
  // a little, so it keeps its place: held as it was, the edge of a plate over the tunic rose and fell with each of the
  // tunic's folds, a wavy edge on a smooth plate)
  const average = (values: Float32Array, width: number, passes: number) => {
    let v = values;
    for (let pass = 0; pass < passes; pass++) {
      const next = v.slice();
      for (let i = 0; i < count; i++) {
        const along = fixed[i] ? rimNeighbours : neighbours;
        const [first, end] = [along.start[i], along.start[i + 1]];
        if (first === end || (fixed[i] && pass >= EDGE_PASSES)) continue;
        for (let k = 0; k < width; k++) {
          let mean = 0;
          for (let n = first; n < end; n++) mean += v[along.list[n] * width + k];
          next[i * width + k] += 0.5 * (mean / (end - first) - v[i * width + k]);
        }
      }
      v = next;
    }
    return v;
  };
  const smoothed = (passes: number) => {
    const ground = average(Float32Array.from(base), 3, passes);
    const sank = new Float32Array(count);
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) sank[i] += (base[i * 3 + k] - ground[i * 3 + k]) * out[i * 3 + k];
    const lift = average(sank, 1, passes);
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) ground[i * 3 + k] += out[i * 3 + k] * lift[i];
    return ground;
  };
  const ground = smoothed(piece.ground);
  if (piece.hang) {
    // (how far each point is moved, evened out over its neighbours: read in steps round the axis, it was ragged)
    const hung = Float32Array.from(ground);
    hang(hung, piece.hang);
    const moved = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) moved[i] = hung[i] - ground[i];
    const even = average(moved, 3, 40);
    for (let i = 0; i < count * 3; i++) ground[i] += even[i];
  }
  let outer = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) outer[i] = ground[i] + out[i] * clearance[Math.floor(i / 3)];
  // (`from`: what it keeps its clearance from)
  const stretch = (passes: number, from: Float32Array[]) => {
    for (let pass = 0; pass < passes; pass++) {
      const next = outer.slice();
      const step = [0, 0, 0];
      for (let i = 0; i < count; i++) {
        const toward = fixed[i] ? rimNeighbours : neighbours;
        const [first, end] = [toward.start[i], toward.start[i + 1]];
        if (first === end) continue;
        for (let k = 0; k < 3; k++) {
          let mean = 0;
          for (let n = first; n < end; n++) mean += outer[toward.list[n] * 3 + k];
          step[k] = 0.5 * (mean / (end - first) - outer[i * 3 + k]);
        }
        // (inside, only outward or inward, so nothing slides across the body and off what it measures its clearance from;
        // its edge also along itself, which evens out where it was cut across the triangles)
        const normal = fixed[i] ? 1 : 0;
        const across = step[0] * out[i * 3] + step[1] * out[i * 3 + 1] + step[2] * out[i * 3 + 2];
        for (let k = 0; k < 3; k++) next[i * 3 + k] += normal * step[k] + (1 - normal) * across * out[i * 3 + k];
        for (const under of from) {
          let off = 0;
          for (let k = 0; k < 3; k++) off += (next[i * 3 + k] - under[i * 3 + k]) * out[i * 3 + k];
          if (off < clearance[i]) for (let k = 0; k < 3; k++) next[i * 3 + k] += out[i * 3 + k] * (clearance[i] - off);
        }
      }
      outer = next;
    }
  };
  stretch(piece.smoothing, [ground]);
  // (kept clear of what is under it as it is, if asked: how far each point must rise for that, spread over the points
  // round it, so it rises over what is under it in a soft swell rather than taking the shape of every edge there)
  if (piece.clear !== undefined) {
    const near = smoothed(piece.clear);
    let rise = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let above = 0;
      for (let k = 0; k < 3; k++) above += (outer[i * 3 + k] - near[i * 3 + k]) * out[i * 3 + k];
      rise[i] = Math.max(0, clearance[i] - above);
    }
    for (let pass = 0; pass < 12; pass++) {
      const next = rise.slice();
      for (let i = 0; i < count; i++) {
        if (start[i] === start[i + 1]) continue;
        let mean = 0;
        for (let n = start[i]; n < start[i + 1]; n++) mean += rise[list[n]];
        next[i] = Math.max(rise[i], 0.85 * (mean / (start[i + 1] - start[i])));
      }
      rise = next;
    }
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) outer[i * 3 + k] += out[i * 3 + k] * rise[i];
    // (and stretched again, kept clear of both, which evens out the points the swell left in hollows)
    stretch(20, [ground, near]);
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
  // (evened out a little over the points round each: a rolled rim or the step between plates is no wider than a few of
  // the body's triangles, and read at each point alone, it rose and fell from one to the next, a scalloped edge)
  let relief = new Float32Array(count);
  for (let i = 0; i < count; i++) relief[i] = piece.relief(base[i * 3], base[i * 3 + 1], base[i * 3 + 2], depth[i]);
  for (let pass = 0; pass < RELIEF_PASSES; pass++) {
    const next = relief.slice();
    for (let i = 0; i < count; i++) {
      const toward = fixed[i] ? rimNeighbours : neighbours;
      const [first, end] = [toward.start[i], toward.start[i + 1]];
      if (first === end) continue;
      let mean = 0;
      for (let n = first; n < end; n++) mean += relief[toward.list[n]];
      next[i] += 0.5 * (mean / (end - first) - relief[i]);
    }
    relief = next;
  }
  const inner = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      outer[i * 3 + k] += smoothOut[i * 3 + k] * relief[i];
      inner[i * 3 + k] = within[i * 3 + k] - out[i * 3 + k] * piece.inset;
    }
    // (its outside never below half way to its inside: where its clearance thins to nothing at the flat cut, smoothed
    // outside could sink below it there, and the solid folded through itself)
    let off = 0;
    for (let k = 0; k < 3; k++) off += (outer[i * 3 + k] - inner[i * 3 + k]) * out[i * 3 + k];
    if (off < 0.5 * piece.inset) for (let k = 0; k < 3; k++) outer[i * 3 + k] += out[i * 3 + k] * (0.5 * piece.inset - off);
  }

  // Closed: the outside as the body's triangles run, the inside turned the other way, and a wall round the edge. (The
  // wall has its own copies of the points along the edge, at the same places, so it is shaded apart from the outside: as
  // one, the normals along the edge were turned every way by the wall's thin triangles, and the edge of a plate showed
  // streaks. The print welds them together again: see printable.ts)
  const edgePoints = [...new Set(rim.flat())];
  const wall = new Map(edgePoints.map((v, k) => [v, 2 * count + 2 * k]));
  const positions = new Float32Array((2 * count + 2 * edgePoints.length) * 3);
  positions.set(outer);
  positions.set(inner, count * 3);
  for (const [v, at] of wall) {
    positions.set(outer.subarray(v * 3, v * 3 + 3), at * 3);
    positions.set(inner.subarray(v * 3, v * 3 + 3), (at + 1) * 3);
  }
  const indices: number[] = [...triangles];
  for (let t = 0; t < triangles.length; t += 3) indices.push(triangles[t] + count, triangles[t + 2] + count, triangles[t + 1] + count);
  for (const [a, b] of rim) {
    const [wa, wb] = [wall.get(a)!, wall.get(b)!];
    indices.push(wb, wa, wa + 1, wb, wa + 1, wb + 1);
  }

  const dressed = Float32Array.from(under);
  for (let i = 0; i < count; i++) if (from[i] >= 0) dressed.set(outer.subarray(i * 3, i * 3 + 3), from[i] * 3);
  return {
    garment: {
      name: piece.name,
      positions,
      indices: Uint32Array.from(indices),
      outside: count,
    },
    dressed,
  };
}

// A clasp: a disc turned about `normal`, its back sunk into the cloak at `at`, domed, with a raised rim. (One closed
// solid: a single vertex at the middle of its back and of its front, and rings between)
function clasp(at: THREE.Vector3, normal: THREE.Vector3): Garment {
  const r = CLASP.radius;
  // (the profile, from the middle of the back out to the rim and in over the dome: out from the axis, and along it)
  const profile: [number, number][] = [
    [r * 0.95, -CLOAK.thickness * 0.6 * MM],
    [r, 0],
    [r, (CLASP.thickness + CLASP.rim) * MM],
    [r * 0.82, (CLASP.thickness + CLASP.rim) * MM],
    [r * 0.72, CLASP.thickness * MM],
  ];
  for (let k = 1; k < 6; k++) {
    const t = k / 6;
    profile.push([r * 0.72 * (1 - t), (CLASP.thickness + CLASP.dome * Math.sin((t * Math.PI) / 2)) * MM]);
  }
  const segments = 32;
  const [u, v] = [new THREE.Vector3(), new THREE.Vector3()];
  u.crossVectors(normal, Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  v.crossVectors(normal, u);
  const positions: number[] = [];
  const put = (radius: number, height: number, angle: number) => {
    const point = at
      .clone()
      .addScaledVector(normal, height)
      .addScaledVector(u, radius * Math.cos(angle))
      .addScaledVector(v, radius * Math.sin(angle));
    positions.push(point.x, point.y, point.z);
  };
  put(0, -CLOAK.thickness * 0.6 * MM, 0); // the middle of its back
  for (const [radius, height] of profile) for (let s = 0; s < segments; s++) put(radius, height, (2 * Math.PI * s) / segments);
  put(0, (CLASP.thickness + CLASP.dome) * MM, 0); // the top of its dome
  const top = positions.length / 3 - 1;
  const ring = (k: number, s: number) => 1 + k * segments + (s % segments);
  const indices: number[] = [];
  for (let s = 0; s < segments; s++) {
    indices.push(0, ring(0, s + 1), ring(0, s));
    for (let k = 0; k + 1 < profile.length; k++) indices.push(ring(k, s), ring(k, s + 1), ring(k + 1, s + 1), ring(k, s), ring(k + 1, s + 1), ring(k + 1, s));
    indices.push(ring(profile.length - 1, s), ring(profile.length - 1, s + 1), top);
  }
  return {
    name: "clasp",
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
  };
}

// Hanging (see Piece): each point taken out, away from the upright axis, as far as the furthest point above it round
// the axis in about the same direction, but no further than `reach` beyond where it was
function hang(points: Float32Array, { axisZ, reach }: { axisZ: number; reach: number }): void {
  const count = points.length / 3;
  const bins = 90;
  const angle = (i: number) => Math.atan2(points[i * 3], points[i * 3 + 2] - axisZ);
  const bin = (a: number) => ((Math.round(((a + Math.PI) / (2 * Math.PI)) * bins) % bins) + bins) % bins;
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => points[b * 3 + 1] - points[a * 3 + 1]);
  // (the furthest out so far, from the top down, in each direction; each point reads its own and the next either side)
  const furthest = new Float32Array(bins);
  for (const i of order) {
    const [x, z] = [points[i * 3], points[i * 3 + 2] - axisZ];
    const r = Math.hypot(x, z);
    const b = bin(angle(i));
    const above = Math.max(furthest[b], 0.5 * (furthest[(b + 1) % bins] + furthest[(b + bins - 1) % bins]));
    furthest[b] = Math.max(furthest[b], r);
    const to = Math.min(above, r + reach);
    if (to > r && r > 0) {
      points[i * 3] = (x * to) / r;
      points[i * 3 + 2] = axisZ + (z * to) / r;
    }
  }
}

// Lists of neighbours packed into one array: point i's are list[start[i]] to list[start[i + 1] - 1], in their order
function packed(lists: number[][]): { start: Int32Array; list: Int32Array } {
  const start = new Int32Array(lists.length + 1);
  for (let i = 0; i < lists.length; i++) start[i + 1] = start[i] + lists[i].length;
  const list = new Int32Array(start[lists.length]);
  for (let i = 0; i < lists.length; i++) list.set(lists[i], start[i]);
  return { start, list };
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
