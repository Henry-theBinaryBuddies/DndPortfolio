import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { Assets } from "./assets";
import { shapeDragonborn } from "./dragonborn";
import { sculptBust } from "./face";
import { LANDMARK } from "./headMesh";
import { NUMERIC_DEFS, type Family, type Params } from "./params";

// The bare body, as clothing and armour will be fitted to it (the fitting contract of audit 19): the sculpt's own
// surface for either family, without hair, beard, brows, eyes, teeth or anything else built on it, in one declared
// frame, with a key that changes exactly when its shape does, a spatial search over it, where it is cut flat, and
// named anchors a garment can be placed by. A garment is built from this, after the body and before the hair and
// beard (which then keep clear of the body and the garment together), never from the painted, positioned scene.
//
// The frame is the sculpt's: head units (one is 20 cm of the bust as sculpted), the origin between the human eyes,
// y up, the face toward +z. The bust's group stands it on its plinth by moving it by `stand` (see builder.ts and
// dragonborn.ts); add that to go from this frame to the bust's. Normals here are in this frame too.

export interface Anchor {
  position: THREE.Vector3;
  normal: THREE.Vector3; // outward
}

export interface BodySurface {
  family: Family;
  key: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  stand: THREE.Vector3; // this frame to the bust's: the bust's head group sits at this offset
  baseY: number; // the lowest point
  cut: number; // mm above the lowest point where the bust is cut flat (see underside.ts)
  anchors: {
    neckBase: number; // the height where the neck meets the shoulders
    sternum: Anchor; // the front of the body there (the notch between the collarbones)
    nape: Anchor; // the back of the body there
    shoulders: { right: Anchor; left: Anchor }; // the top of each shoulder (right is +x)
    collar: THREE.Vector3[]; // a ring round the neck at its base, COLLAR_POINTS of them, starting at the front and turning toward +x
  };
  // The nearest point of the surface to a point in this frame, with the outward normal there, and how far it is
  closest(point: THREE.Vector3): { point: THREE.Vector3; normal: THREE.Vector3; distance: number };
}

export const COLLAR_POINTS = 32;

// (each shape's surface is kept for its key: a garment fitted again with only its colour changed, or the tabletop
// fit trying the same body twice, searches nothing anew)
const known = new WeakMap<Assets, Map<string, BodySurface>>();

// The settings that shape the bare body: for a humanoid every slider and its race and build (not its hair, beard or
// horn styles), for a Dragonborn its own sliders and the torso
export function bodyKey(p: Params): string {
  const shaping = NUMERIC_DEFS.filter((d) => d.families.includes(p.family)).map((d) => p[d.key]);
  return JSON.stringify(p.family === "dragonborn" ? ["dragonborn", ...shaping] : ["humanoid", p.race, p.body, ...shaping]);
}

export function bodySurface(p: Params, assets: Assets): BodySurface {
  const key = bodyKey(p);
  let cache = known.get(assets);
  if (!cache) known.set(assets, (cache = new Map()));
  const found = cache.get(key);
  if (found) return found;
  let made: BodySurface;
  if (p.family === "dragonborn") {
    if (!assets.dragonborn) throw new Error("the Dragonborn model has not loaded");
    const shape = shapeDragonborn(assets.dragonborn, p);
    const u = shape.underside;
    made = surface("dragonborn", key, shape.positions, shape.normals, assets.dragonborn.indices, new THREE.Vector3(-u.footprint.x, -shape.baseY, -u.footprint.z), shape.baseY, u.cut, assets.dragonborn.manifest.chin);
  } else {
    const bust = sculptBust(p, assets.head);
    const u = bust.underside;
    made = surface("humanoid", key, bust.positions, bust.normals, assets.head.indices, new THREE.Vector3(-u.footprint.x, -bust.baseY, -u.footprint.z), bust.baseY, u.cut, LANDMARK.menton);
  }
  // (a few kept: the shapes most recently fitted to)
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(key, made);
  return made;
}

function surface(family: Family, key: string, positions: Float32Array, normals: Float32Array, indices: Uint32Array, stand: THREE.Vector3, baseY: number, cut: number, chin: number): BodySurface {
  // (the search is over its own copy of the triangles: building one reorders them, and the mesh's order must stay)
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indices), 1));
  const bvh = new MeshBVH(geometry);
  const index = geometry.index!;
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const closest = (point: THREE.Vector3) => {
    bvh.closestPointToPoint(point, hit);
    const t = hit.faceIndex * 3;
    a.fromArray(positions, index.getX(t) * 3);
    b.fromArray(positions, index.getX(t + 1) * 3);
    c.fromArray(positions, index.getX(t + 2) * 3);
    const normal = new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).normalize();
    return { point: hit.point.clone(), normal, distance: hit.distance };
  };

  // How wide the body is at each height below the chin (the farthest any of it reaches to either side)
  const STEP = 0.02;
  const top = chin - 0.05;
  const rows = Math.ceil((top - baseY) / STEP);
  const half = new Float32Array(rows);
  for (let i = 0; i < positions.length; i += 3) {
    const row = Math.floor((top - positions[i + 1]) / STEP);
    if (row >= 0 && row < rows) half[row] = Math.max(half[row], Math.abs(positions[i]));
  }
  // The neck is the narrowest band under the chin; its base, the first height below it where the body has widened by
  // half again into the shoulders
  // (bands with no vertex in them are passed over, not read as no width at all; and the neck is looked for only in the
  // first 0.4 head units under the chin, so the narrowing chest low on the bust is never taken for it)
  const cutY = baseY + cut / 32;
  let narrow = -1;
  for (let r = 0; r < rows && r * STEP < 0.4 && top - r * STEP > cutY; r++) if (half[r] > 0 && (narrow < 0 || half[r] < half[narrow])) narrow = r;
  narrow = Math.max(0, narrow);
  let base = narrow;
  while (base + 1 < rows && !(half[base] >= 1.5 * half[narrow])) base++;
  const neckBase = top - (base + 0.5) * STEP;

  // The front and back of the body at the neck's base, near the middle
  const near = (what: string, pick: (x: number, y: number, z: number, up: number) => number) => {
    let best = -Infinity;
    let at = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const score = pick(positions[i], positions[i + 1], positions[i + 2], normals[i + 1]);
      if (score > best) [best, at] = [score, i];
    }
    if (best === -Infinity) throw new Error(`no point of the ${family}'s body is ${what}`);
    return { position: new THREE.Vector3().fromArray(positions, at), normal: new THREE.Vector3().fromArray(normals, at).normalize() };
  };
  const band = (x: number, y: number) => Math.abs(x) < 0.06 && Math.abs(y - neckBase) < 0.04;
  const sternum = near("at the front of the neck's base", (x, y, z) => (band(x, y) ? z : -Infinity));
  const nape = near("at the back of the neck's base", (x, y, z) => (band(x, y) ? -z : -Infinity));
  // A ring round the neck at its base: outward from its axis in each direction, to where the ray leaves the body
  const axis = new THREE.Vector3(0, neckBase, (sternum.position.z + nape.position.z) / 2);
  const ray = new THREE.Ray();
  const collar: THREE.Vector3[] = [];
  for (let k = 0; k < COLLAR_POINTS; k++) {
    const angle = (k / COLLAR_POINTS) * 2 * Math.PI;
    ray.set(axis, new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)));
    const hits = bvh.raycast(ray, THREE.DoubleSide);
    // (the nearest crossing outward from the axis: the neck's own surface, not a shoulder or horn beyond it)
    const first = hits.reduce<THREE.Intersection | null>((m, h) => (!m || h.distance < m.distance ? h : m), null);
    if (!first) throw new Error(`the ${family}'s neck has no surface round its base at ${Math.round((angle * 180) / Math.PI)} degrees`);
    collar.push(first.point.clone());
  }

  // The top of each shoulder: the highest point that faces up, between the collar and the widest of the body (half to
  // three quarters of the way out from the one to the other), below the neck's base, over the middle of the body's depth
  // (the top of a shoulder is nearly level, and taken as the highest point of all, a slope behind it, or a little relief,
  // could win). Measured from the collar, not from the middle, so a garment's shoulder is always outside its collar: on a
  // slim body, three quarters of its width was inside the ring round the neck (audit 20)
  let widest = 0;
  for (let r = base; r < rows && top - r * STEP > cutY; r++) widest = Math.max(widest, half[r]);
  const collarHalf = Math.max(...collar.map((point) => Math.abs(point.x)));
  if (widest <= collarHalf) throw new Error(`the ${family}'s body is no wider than its neck`);
  const [inner, outer] = [collarHalf + 0.5 * (widest - collarHalf), collarHalf + 0.75 * (widest - collarHalf)];
  const middle = (sternum.position.z + nape.position.z) / 2;
  const depth = (sternum.position.z - nape.position.z) / 2;
  const shoulder = (side: number) =>
    near(`the top of its ${side > 0 ? "right" : "left"} shoulder`, (x, y, z, up) => (side * x > inner && side * x < outer && y < neckBase + 0.1 && Math.abs(z - middle) < 0.6 * depth && up > 0.5 ? y : -Infinity));

  return { family, key, positions, normals, indices, stand, baseY, cut, anchors: { neckBase, sternum, nape, shoulders: { right: shoulder(1), left: shoulder(-1) }, collar }, closest };
}
