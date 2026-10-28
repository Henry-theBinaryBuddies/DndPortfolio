import * as THREE from "three";
import { carveShell, hash, vee, type Pattern } from "./carve";
import { scalp } from "./hair";
import { HAIR_CARVING, locks } from "./hairCarve";
import type { HeadBase } from "./headMesh";
import type { Params } from "./params";
import { MM } from "./print";

// Dreadlocks and braids: hair as separate locks, each a closed tube. They are blocky on purpose, as a
// sculptor makes them on a miniature (and as a printer can print them): a dreadlock is a rope with a spiral
// groove, a braid is a thick plait with chevron grooves, where real hair would be strands far finer than a
// 0.2 mm nozzle. Each starts in the scalp, which a close crop (hairShell.ts) covers between the roots, falls
// under gravity, and rests on the head and shoulders rather than passing through them. Where they start
// comes from the undeformed head, so there are always the same locks however the face is shaped (and a
// rebuild is cheap); where they lie comes from the reshaped body.

export const LOCKS = {
  dreadRadius: 1.4 * MM, // each dreadlock is 2.8 mm thick
  dreadSpacing: 0.115, // between roots (head units): about 3.7 mm
  dreadGrooves: 3, // spiral grooves round a dreadlock
  braidPitch: 3.2 * MM, // one plait every 3.2 mm
  braidGroove: 0.6 * MM,
  braidDepth: 0.5 * MM,
  braidRadius: [2 * MM, 2.4 * MM] as const, // the two braids at the sides, and the one down the back
};

// The point of the tube's surface at the angle θ round it from the side turned away from the body, and how
// far along it, are stored as (cos θ, sin θ, length): carved as they are (see carve.ts), the angle then comes
// back right wherever the carving averages two points, even across the seam
export const dreadPattern: Pattern = (c, s, length) => {
  const angle = Math.atan2(s, c);
  const across = (angle / (2 * Math.PI)) * LOCKS.dreadGrooves * HAIR_CARVING.lockPitch + 0.9 * length;
  return locks(across, length, LOCKS.dreadGrooves);
};

// Chevrons down the front of a braid: grooves slanting back from the middle line, each side a mirror of the
// other, as the plaits of a braid lie
export const braidPattern: Pattern = (c, s, length) => {
  const angle = Math.abs(Math.atan2(s, c));
  const pitch = LOCKS.braidPitch;
  const phase = length / pitch + angle * 0.55;
  const plait = Math.floor(phase);
  const deep = LOCKS.braidDepth * vee(phase, LOCKS.braidGroove / pitch / 2) * (0.85 + 0.3 * hash(plait));
  const fine = 0.5 * LOCKS.braidDepth * vee(phase + 0.5, 0.8 * LOCKS.braidGroove / pitch / 2);
  return Math.max(deep, fine);
};

// The points of the reshaped body, to find what a lock must stay clear of
class Cloud {
  private cells = new Map<number, number[]>();
  constructor(
    private points: Float32Array,
    private cell = 0.09,
  ) {
    for (let i = 0; i < points.length / 3; i++) {
      const key = this.key(Math.floor(points[i * 3] / cell), Math.floor(points[i * 3 + 1] / cell), Math.floor(points[i * 3 + 2] / cell));
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    }
  }
  private key(x: number, y: number, z: number) {
    return (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
  }
  // The nearest point within a cell's width (or none)
  nearest(x: number, y: number, z: number): { i: number; d: number } | null {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = Infinity;
    let at = -1;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (let c = -1; c <= 1; c++) {
          const list = this.cells.get(this.key(cx + a, cy + b, cz + c));
          if (!list) continue;
          for (const i of list) {
            const d = Math.hypot(this.points[i * 3] - x, this.points[i * 3 + 1] - y, this.points[i * 3 + 2] - z);
            if (d < best) {
              best = d;
              at = i;
            }
          }
        }
      }
    }
    return at < 0 ? null : { i: at, d: best };
  }
  point(i: number, into: THREE.Vector3) {
    return into.set(this.points[i * 3], this.points[i * 3 + 1], this.points[i * 3 + 2]);
  }
}

interface Fall {
  start: THREE.Vector3;
  direction: THREE.Vector3;
  steps: number;
  step: number;
  radius: number;
  // Where it is drawn to, from where it is and how far along it is
  target: (p: THREE.Vector3, i: number) => THREE.Vector3;
  rate: number; // how quickly it turns toward that
}

// The path of a lock: out of the scalp, then drawn toward its target, kept clear of the body all the way
function fall(cloud: Cloud, spec: Fall): THREE.Vector3[] {
  const p = spec.start.clone();
  const d = spec.direction.clone().normalize();
  const path = [p.clone()];
  const q = new THREE.Vector3();
  const away = new THREE.Vector3();
  for (let i = 1; i <= spec.steps; i++) {
    d.lerp(spec.target(p, i).normalize(), spec.rate).normalize();
    const before = p.clone();
    p.addScaledVector(d, spec.step);
    // (the clearance builds up over the first steps: it starts in the scalp)
    const clearance = spec.radius * (0.2 + 0.9 * Math.min(1, i / 4));
    for (let k = 0; k < 3; k++) {
      const near = cloud.nearest(p.x, p.y, p.z);
      if (!near || near.d >= clearance) break;
      cloud.point(near.i, q);
      away.copy(p).sub(q);
      if (away.lengthSq() < 1e-12) away.set(0, 1, 0);
      p.copy(q).addScaledVector(away.normalize(), clearance);
    }
    d.lerp(p.clone().sub(before).normalize(), 0.5).normalize();
    path.push(p.clone());
  }
  return path;
}

// Tubes: each a closed solid (a ring of vertices at each point of its path, joined along its length, with a
// cap at each end), and for carving, how far round and along it each vertex is, and how thick it is
class Tubes {
  positions: number[] = [];
  carveAt: number[] = [];
  thick: number[] = [];
  index: number[] = [];

  add(path: THREE.Vector3[], radius: (t: number) => number, sides: number, outward: (i: number, tangent: THREE.Vector3) => THREE.Vector3 | null) {
    const rings = path.length;
    const first = this.positions.length / 3;
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3(0, 0, 1);
    const side = new THREE.Vector3();
    let length = 0;
    for (let i = 0; i < rings; i++) {
      tangent.copy(path[Math.min(rings - 1, i + 1)]).sub(path[Math.max(0, i - 1)]).normalize();
      // The side turned away from the body where it is known, else carried along from the last ring
      const wanted = outward(i, tangent);
      const reference = wanted ?? normal;
      normal.copy(reference).addScaledVector(tangent, -reference.dot(tangent));
      if (normal.lengthSq() < 1e-8) normal.set(tangent.y, -tangent.x, 0);
      normal.normalize();
      side.crossVectors(tangent, normal);
      if (i > 0) length += path[i].distanceTo(path[i - 1]);
      const r = radius(i / (rings - 1));
      for (let j = 0; j < sides; j++) {
        const a = (2 * Math.PI * j) / sides;
        const c = Math.cos(a);
        const s = Math.sin(a);
        this.positions.push(path[i].x + r * (normal.x * c + side.x * s), path[i].y + r * (normal.y * c + side.y * s), path[i].z + r * (normal.z * c + side.z * s));
        this.carveAt.push(c, s, length);
        this.thick.push(2 * r);
      }
    }
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const a = first + i * sides + j;
        const b = first + i * sides + ((j + 1) % sides);
        const c = a + sides;
        const d = b + sides;
        this.index.push(a, b, c, b, d, c);
      }
    }
    // The caps: a point at the middle of each end
    for (const [ring, end] of [
      [0, 0],
      [rings - 1, 1],
    ]) {
      const middle = this.positions.length / 3;
      this.positions.push(path[ring].x, path[ring].y, path[ring].z);
      this.carveAt.push(1, 0, ring === 0 ? 0 : length);
      this.thick.push(0);
      for (let j = 0; j < sides; j++) {
        const a = first + ring * sides + j;
        const b = first + ring * sides + ((j + 1) % sides);
        if (end === 0) this.index.push(middle, b, a);
        else this.index.push(middle, a, b);
      }
    }
  }

  geometry(): THREE.BufferGeometry {
    const count = this.positions.length / 3;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("hairAmount", new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
    geometry.setAttribute("headPos", new THREE.Float32BufferAttribute(this.carveAt, 3));
    geometry.setAttribute("thick", new THREE.Float32BufferAttribute(this.thick, 1));
    geometry.setAttribute("carve", new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
    geometry.setIndex(this.index);
    geometry.computeVertexNormals();
    return geometry;
  }
}

const down = new THREE.Vector3(0, -1, -0.15);
const back = new THREE.Vector3(0, 0.25, -1);

// Where dreadlocks start: spread over the scalp at a fixed spacing (always the same ones, chosen on the
// undeformed head)
export function dreadRoots(base: HeadBase): number[] {
  const bp = base.positions;
  const chosen: number[] = [];
  let seed = 977;
  const order: number[] = [];
  for (let v = 0; v < bp.length / 3; v++) {
    const x = bp[v * 3];
    const y = bp[v * 3 + 1];
    const z = bp[v * 3 + 2];
    if (y < -0.05 || scalp(x, y, z) < 0.9) continue;
    if (Math.abs(x) > 0.4 && y > -0.3 && y < 0.2 && z > -0.7 && z < -0.2) continue; // (the ears)
    order.push(v);
  }
  // A repeatable shuffle
  for (let i = order.length - 1; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const spacing2 = LOCKS.dreadSpacing * LOCKS.dreadSpacing;
  for (const v of order) {
    let clear = true;
    for (const u of chosen) {
      const dx = bp[v * 3] - bp[u * 3];
      const dy = bp[v * 3 + 1] - bp[u * 3 + 1];
      const dz = bp[v * 3 + 2] - bp[u * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < spacing2) {
        clear = false;
        break;
      }
    }
    if (clear) chosen.push(v);
  }
  return chosen;
}

function dreadShell(positions: Float32Array, normals: Float32Array, base: HeadBase): THREE.BufferGeometry {
  const cloud = new Cloud(positions);
  const tubes = new Tubes();
  const bp = base.positions;
  for (const v of dreadRoots(base)) {
    const h = hash(v);
    const front = bp[v * 3 + 2] > -0.1 && bp[v * 3 + 1] > 0.1;
    // Each a different length; those at the front are swept back over the head first, so they are longer
    const length = (0.55 + 0.45 * h + (front ? 0.55 : 0)) * 1;
    const step = 0.045;
    const radius = LOCKS.dreadRadius * (0.85 + 0.3 * hash(v + 17));
    const n = new THREE.Vector3(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
    const start = new THREE.Vector3(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]).addScaledVector(n, -0.012);
    const path = fall(cloud, {
      start,
      direction: front ? n.clone().multiplyScalar(0.4).add(back) : n,
      steps: Math.round(length / step),
      step,
      radius,
      target: (p) => (front && p.z > -0.3 ? back : down),
      rate: 0.35,
    });
    const phase = h * 6.28;
    // A rope: thick all the way, a little knobbly, closing in a rounded end
    tubes.add(
      path,
      (t) => radius * (1 + 0.07 * Math.sin(t * 40 + phase)) * (t > 0.9 ? Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2)) : 1),
      10,
      () => null,
    );
  }
  return tubes.geometry();
}

// The three braids: one behind each ear, falling over the shoulder to the chest, and one down the back
function braidShell(positions: Float32Array, normals: Float32Array, base: HeadBase): THREE.BufferGeometry {
  const cloud = new Cloud(positions);
  const tubes = new Tubes();
  const bp = base.positions;
  const where: { x: number; y: number; z: number; side: number; radius: number }[] = [
    { x: 0.36, y: 0.12, z: -0.38, side: 1, radius: LOCKS.braidRadius[0] },
    { x: -0.36, y: 0.12, z: -0.38, side: -1, radius: LOCKS.braidRadius[0] },
    { x: 0, y: 0.1, z: -0.55, side: 0, radius: LOCKS.braidRadius[1] },
  ];
  for (const w of where) {
    // The scalp vertex nearest the wanted place
    let v = 0;
    let best = Infinity;
    for (let i = 0; i < bp.length / 3; i++) {
      if (scalp(bp[i * 3], bp[i * 3 + 1], bp[i * 3 + 2]) < 0.7) continue;
      const d = Math.hypot(bp[i * 3] - w.x, bp[i * 3 + 1] - w.y, bp[i * 3 + 2] - w.z);
      if (d < best) {
        best = d;
        v = i;
      }
    }
    const n = new THREE.Vector3(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
    const start = new THREE.Vector3(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]).addScaledVector(n, -0.02);
    const step = 0.05;
    // Down the side of the neck, then forward over the shoulder onto the chest; the back one hangs straight
    const aim = new THREE.Vector3(-w.side * 0.35, -1, w.side === 0 ? -0.1 : 0.4);
    const path = fall(cloud, { start, direction: n, steps: 30, step, radius: w.radius, target: () => aim, rate: 0.3 });
    const q = new THREE.Vector3();
    const toward = new THREE.Vector3();
    const smoothOut = new THREE.Vector3(0, 0, 1);
    tubes.add(
      path,
      (t) => w.radius * (1 - 0.4 * t ** 1.5) * (1 + 0.05 * Math.cos((t * 30 * Math.PI) / 2)) * (t > 0.93 ? Math.sqrt(Math.max(0, 1 - ((t - 0.93) / 0.07) ** 2)) : 1),
      12,
      (i) => {
        // Away from the nearest part of the body, so the chevrons lie on the side that shows
        const near = cloud.nearest(path[i].x, path[i].y, path[i].z);
        if (!near) return smoothOut;
        cloud.point(near.i, q);
        toward.copy(path[i]).sub(q);
        if (toward.lengthSq() > 1e-10) smoothOut.lerp(toward.normalize(), 0.5).normalize();
        return smoothOut;
      },
    );
  }
  return tubes.geometry();
}

// The locks of a dreadlocks or braids style, as a closed solid made of tubes; null for any other style
export function buildLockShell(p: Params, positions: Float32Array, normals: Float32Array, base: HeadBase): THREE.BufferGeometry | null {
  if (p.hairStyle === "dreadlocks") return dreadShell(positions, normals, base);
  if (p.hairStyle === "braids") return braidShell(positions, normals, base);
  return null;
}

// ...and as they print: subdivided, with their grooves carved in
export function buildLocks(p: Params, positions: Float32Array, normals: Float32Array, base: HeadBase): THREE.BufferGeometry | null {
  const shell = buildLockShell(p, positions, normals, base);
  return shell ? carveShell(shell, base, p.hairStyle, p.hairStyle === "braids" ? braidPattern : dreadPattern) : null;
}
