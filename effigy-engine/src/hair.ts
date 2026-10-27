import * as THREE from "three";
import type { HairStyle, Params } from "./params";

// Hair as sculpted clumps, the way a bust is modelled: each clump is a flattened, tapering tube that
// starts on the scalp and follows a flow direction, bending under gravity. A few hundred overlapping
// clumps read as combed hair, and the strands stay stylised instead of pretending to be a hair simulation.
// Clumps start only where the hairline allows, and are kept outside an ellipsoid fitted to the skull.

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// A small repeatable random generator, so the same character always gets the same hair
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spec {
  count: number;
  length: number; // how long a clump is
  radius: number; // thickness at the root
  gravity: number; // how strongly it is pulled down
  lift: number; // how much it rises away from the scalp before falling
  flow: [number, number, number]; // the direction it is combed
  strip: boolean; // only a central strip of the scalp (a mohawk)
  hug: number; // the fraction of the clump's length that lies along the scalp before it lifts or falls free
}

const SPECS: Record<Exclude<HairStyle, "none">, Spec> = {
  cropped: { count: 2400, length: 0.1, radius: 0.021, gravity: 0, lift: 0.1, flow: [0, 0.1, -1], strip: false, hug: 1 },
  swept: { count: 1000, length: 0.7, radius: 0.036, gravity: 0.2, lift: 0.12, flow: [0, 0.3, -1], strip: false, hug: 0.85 },
  mohawk: { count: 1100, length: 0.78, radius: 0.058, gravity: 0.05, lift: 0.15, flow: [0, 0.3, -1], strip: true, hug: 0.55 },
  long: { count: 1200, length: 1.15, radius: 0.04, gravity: 0.9, lift: 0.15, flow: [0, -0.1, -1], strip: false, hug: 0.55 },
};

// Half the width of a mohawk's strip; everywhere else on the scalp is shaved
const STRIP_HALF_WIDTH = 0.15;

// How shaved the scalp is at a point: 1 on the sides of a mohawk, where the skin shows the shadow of
// stubble, and 0 everywhere else
export function shavedWeight(p: Params, x: number, y: number, z: number): number {
  if (p.hairStyle !== "mohawk") return 0;
  return scalp(x, y, z) * smooth((Math.abs(x) - STRIP_HALF_WIDTH + 0.02) / 0.05);
}

const SEGMENTS = 9;
const SIDES = 5;

// How much of a point on the head lies inside the hair-bearing scalp: nothing on the face below the
// hairline or on the ears, full above the brow, around the sides, and down the back of the head.
function scalp(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const front = 0.38 - 0.16 * smooth((ax - 0.14) / 0.22);
  const side = 0.12;
  const back = -0.42;
  const toSide = smooth((-z - 0.18) / 0.2);
  const toBack = smooth((-z - 0.55) / 0.15);
  const threshold = (front + (side - front) * toSide) * (1 - toBack) + back * toBack;
  return smooth((y - threshold) / 0.04);
}

export function buildHair(p: Params, positions: Float32Array, normals: Float32Array, neckZ: number): THREE.BufferGeometry | null {
  if (p.hairStyle === "none") return null;
  const spec = SPECS[p.hairStyle];
  const count = positions.length / 3;
  const rand = random(1337);

  // An ellipsoid fitted to the skull, so strands that fall do not sink into the head
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const y = positions[i * 3 + 1];
    if (y < -0.3) continue;
    minX = Math.min(minX, positions[i * 3]);
    maxX = Math.max(maxX, positions[i * 3]);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, positions[i * 3 + 2]);
    maxZ = Math.max(maxZ, positions[i * 3 + 2]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2 + 0.05;
  const cz = (minZ + maxZ) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  const rz = (maxZ - minZ) / 2;

  // Candidate roots: every scalp vertex, weighted by the hairline, then a seeded pick
  const candidates: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    let weight = scalp(x, y, z);
    if (spec.strip) weight *= 1 - smooth((Math.abs(x) - STRIP_HALF_WIDTH) / 0.05);
    if (weight > 0.85 && normals[i * 3 + 1] > -0.2) candidates.push(i);
  }
  const picked: number[] = [];
  for (let n = 0; n < Math.min(spec.count, candidates.length); n++) {
    const index = Math.floor(rand() * candidates.length);
    picked.push(candidates[index]);
  }

  // The scalp as a grid of its own vertices, so a clump can find the surface under it and lie along it
  const cell = 0.08;
  const grid = new Map<string, number[]>();
  const cellOf = (v: number) => Math.floor(v / cell);
  for (let i = 0; i < count; i++) {
    const vx = Math.abs(positions[i * 3]);
    const vy = positions[i * 3 + 1];
    const vz = positions[i * 3 + 2];
    if (vy < -0.55) continue;
    // The ears are not scalp: a strand must not snap onto one and follow it outward
    if (vx > 0.4 && vy > -0.3 && vy < 0.2 && vz > -0.7 && vz < -0.2) continue;
    const key = `${cellOf(positions[i * 3])},${cellOf(positions[i * 3 + 1])},${cellOf(positions[i * 3 + 2])}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }
  const nearest = (x: number, y: number, z: number) => {
    let best = -1;
    let bestDistance = Infinity;
    const gx = cellOf(x);
    const gy = cellOf(y);
    const gz = cellOf(z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
          if (!bucket) continue;
          for (const i of bucket) {
            const d = (positions[i * 3] - x) ** 2 + (positions[i * 3 + 1] - y) ** 2 + (positions[i * 3 + 2] - z) ** 2;
            if (d < bestDistance) {
              bestDistance = d;
              best = i;
            }
          }
        }
      }
    }
    return best;
  };

  const vertices: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const base = new THREE.Color(p.hairColor);
  const tint = new THREE.Color();

  const root = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const flow = new THREE.Vector3(...spec.flow).normalize();
  const dir = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const point = new THREE.Vector3();
  const path: THREE.Vector3[] = [];
  const nudge = new THREE.Vector3();

  for (const i of picked) {
    root.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    normal.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]).normalize();

    // The comb direction, flattened onto the scalp, plus a lift away from it
    tangent.copy(flow).addScaledVector(normal, -flow.dot(normal));
    if (tangent.lengthSq() < 1e-4) tangent.set(0, -1, 0);
    tangent.normalize();
    dir.copy(normal).multiplyScalar(spec.lift).addScaledVector(tangent, 1).normalize();

    const length = spec.length * (0.75 + 0.5 * rand());
    const step = length / SEGMENTS;
    const curl = 0.09 + 0.06 * rand();
    point.copy(root).addScaledVector(normal, 0.006);
    path.length = 0;
    path.push(point.clone());
    for (let s = 0; s < SEGMENTS; s++) {
      nudge.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(curl);
      // A mohawk is combed in one direction, so it does not wander sideways
      if (spec.strip) nudge.x *= 0.15;
      dir.add(nudge);
      dir.y -= spec.gravity * (0.32 + 0.4 * (s / SEGMENTS));
      // Long hair is drawn in toward the middle as it falls, instead of flaring out
      if (spec.gravity > 0.5 && (s + 1) / SEGMENTS > spec.hug) dir.x -= point.x * 0.9;
      dir.normalize();
      point.addScaledVector(dir, step);
      const along = (s + 1) / SEGMENTS;
      if (along <= spec.hug) {
        // Lie along the scalp: find the surface under the clump and stay a hair's breadth above it
        const near = nearest(point.x, point.y, point.z);
        if (near >= 0) {
          const clearance = 0.014 + 0.014 * along;
          point.set(
            positions[near * 3] + normals[near * 3] * clearance,
            positions[near * 3 + 1] + normals[near * 3 + 1] * clearance,
            positions[near * 3 + 2] + normals[near * 3 + 2] * clearance,
          );
          const previous = path[path.length - 1];
          dir.subVectors(point, previous).normalize();
        }
      } else if (spec.lift > 0.25 && spec.gravity < 0.1) {
        // Past the scalp, a stiff style (a mohawk) rises
        dir.y += 0.14;
        dir.z -= 0.3;
        dir.normalize();
      }
      // A mohawk stays inside its strip
      if (spec.strip) point.x = Math.max(-STRIP_HALF_WIDTH - 0.05, Math.min(STRIP_HALF_WIDTH + 0.05, point.x));
      // Keep the strand outside the skull
      const f = ((point.x - cx) / rx) ** 2 + ((point.y - cy) / ry) ** 2 + ((point.z - cz) / rz) ** 2;
      if (f < 1.04) {
        const push = new THREE.Vector3((point.x - cx) / (rx * rx), (point.y - cy) / (ry * ry), (point.z - cz) / (rz * rz)).normalize();
        point.addScaledVector(push, 0.012 + 0.02 * (1.04 - f));
      }
      // Long hair falls close to the head and behind the shoulders instead of flaring into bunches
      if (spec.gravity > 0.5 && along > spec.hug) {
        // Once off the scalp, long hair falls: mostly straight down, leaning in toward the middle and a little back
        dir.set(-point.x * 0.7 + (rand() - 0.5) * 0.08, -1, -0.12 + (rand() - 0.5) * 0.08).normalize();
      }
      // Long hair hangs behind the neck and shoulders, not through them
      if (point.y < -0.6) point.z = Math.min(point.z, neckZ - 0.36);
      point.y = Math.max(point.y, -1.35);
      path.push(point.clone());
    }

    // The clump as a flattened tube that thins toward the tip
    const variation = 0.85 + 0.3 * rand();
    const thickness = spec.radius * (0.85 + 0.3 * rand());
    const first = vertices.length / 3;
    for (let r = 0; r <= SEGMENTS; r++) {
      const t = r / SEGMENTS;
      const a = path[Math.max(0, r - 1)];
      const b = path[Math.min(SEGMENTS, r + 1)];
      const along = new THREE.Vector3().subVectors(b, a).normalize();
      const across = new THREE.Vector3().crossVectors(along, normal);
      if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
      across.normalize();
      const up = new THREE.Vector3().crossVectors(across, along).normalize();
      const radius = thickness * (1 - 0.88 * Math.pow(t, 1.3));
      tint.copy(base).multiplyScalar((0.5 + 0.5 * t) * variation);
      for (let j = 0; j < SIDES; j++) {
        const angle = (2 * Math.PI * j) / SIDES;
        const offset = across.clone().multiplyScalar(Math.cos(angle) * radius * 1.7).addScaledVector(up, Math.sin(angle) * radius);
        vertices.push(path[r].x + offset.x, path[r].y + offset.y, path[r].z + offset.z);
        colors.push(tint.r, tint.g, tint.b);
      }
    }
    for (let r = 0; r < SEGMENTS; r++) {
      for (let j = 0; j < SIDES; j++) {
        const a = first + r * SIDES + j;
        const b = first + r * SIDES + ((j + 1) % SIDES);
        const c = first + (r + 1) * SIDES + j;
        const d = first + (r + 1) * SIDES + ((j + 1) % SIDES);
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  if (vertices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
