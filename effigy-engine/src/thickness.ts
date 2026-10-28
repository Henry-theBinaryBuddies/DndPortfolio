import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

// How thick the walls of a printed bust are. A wall thinner than about two nozzle widths cannot be printed as
// a wall: the slicer either leaves it out or fills it with a single scrap of plastic. For a sample of points
// spread evenly over the surface, a ray goes in from each one and the distance to the far side is the wall's
// thickness there. (Along a taper it falls to nothing at the tip, which is the shape of a tip: what counts is
// how much of the surface is thin, and where.) The ray goes along the surface's normal averaged over a small
// neighbourhood, not the normal of the one facet it starts on: carved texture (braids, locks, beards) is made of
// ridges about half a millimetre wide, and a ray along a ridge flank's own normal leaves through the next ridge,
// which would call every textured solid thin. Averaged, the ray goes into the core, and measures the wall
// that the texture sits on.

export interface WallSamples {
  points: Float32Array; // x, y, z of each measured point, mm
  thickness: Float32Array; // mm; Infinity when the ray found no far side
}

// A small linear congruential generator, so a measurement can be repeated exactly
function random(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Measures the walls at `count` points spread over the surface by area (only triangles above `above`: the base is
// solid and thick by design). `triangles` indexes `positions`, or is null when `positions` is a triangle soup.
export function measureWalls(positions: Float32Array, triangles: ArrayLike<number> | null, count: number, above = 1, seed = 1, smooth = 0.8, below = Infinity): WallSamples {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (triangles) geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(triangles as ArrayLike<number>), 1));
  const bvh = new MeshBVH(geometry);
  const n = triangles ? triangles.length / 3 : positions.length / 9;
  const corner = (t: number, k: number) => (triangles ? triangles[t * 3 + k] : t * 3 + k) * 3;
  const area = new Float64Array(n);
  const normal = new Float32Array(n * 3);
  let total = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    a.fromArray(positions, corner(t, 0));
    b.fromArray(positions, corner(t, 1));
    c.fromArray(positions, corner(t, 2));
    const middle = (a.z + b.z + c.z) / 3;
    if (middle < above || middle >= below) continue;
    b.sub(a);
    c.sub(a);
    b.cross(c);
    const twice = b.length();
    if (twice === 0) continue;
    total += twice / 2;
    area[t] = total;
    normal.set([b.x / twice, b.y / twice, b.z / twice], t * 3);
  }
  const next = random(seed);
  const points = new Float32Array(count * 3);
  const faceNormal = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // The triangle at a random place along the running total of area, and a random point within it
    const target = next() * total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (area[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    a.fromArray(positions, corner(lo, 0));
    b.fromArray(positions, corner(lo, 1));
    c.fromArray(positions, corner(lo, 2));
    let u = next();
    let v = next();
    if (u + v > 1) [u, v] = [1 - u, 1 - v];
    points.set([a.x + (b.x - a.x) * u + (c.x - a.x) * v, a.y + (b.y - a.y) * u + (c.y - a.y) * v, a.z + (b.z - a.z) * u + (c.z - a.z) * v], i * 3);
    faceNormal.set(normal.subarray(lo * 3, lo * 3 + 3), i * 3);
  }
  // Each point's direction: the normals of the sampled points within `smooth` mm, averaged (the samples are
  // spread evenly over the area, so a plain average is an area-weighted one). Where they cancel (a thin edge or
  // a tip, where the normals fan out), its own normal is kept.
  const cell = Math.max(smooth, 1e-3);
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (let i = 0; i < count; i++) {
    const k = key(Math.floor(points[i * 3] / cell), Math.floor(points[i * 3 + 1] / cell), Math.floor(points[i * 3 + 2] / cell));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  }
  const thickness = new Float32Array(count);
  const ray = new THREE.Ray();
  const direction = new THREE.Vector3();
  const BACK = 2e-2; // mm: the ray starts this far inside, so it does not hit the surface it started on
  for (let i = 0; i < count; i++) {
    const [x, y, z] = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let found = 0;
    const [cx, cy, cz] = [Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
            if (Math.hypot(points[j * 3] - x, points[j * 3 + 1] - y, points[j * 3 + 2] - z) > smooth) continue;
            // (only the facets that face about the same way: the far side of a thin plate must not cancel this one)
            const dot = faceNormal[j * 3] * faceNormal[i * 3] + faceNormal[j * 3 + 1] * faceNormal[i * 3 + 1] + faceNormal[j * 3 + 2] * faceNormal[i * 3 + 2];
            if (dot < 0.2) continue;
            sx += faceNormal[j * 3];
            sy += faceNormal[j * 3 + 1];
            sz += faceNormal[j * 3 + 2];
            found++;
          }
        }
      }
    }
    const length = Math.hypot(sx, sy, sz);
    if (found > 0 && length / found > 0.5) direction.set(-sx / length, -sy / length, -sz / length);
    else direction.set(-faceNormal[i * 3], -faceNormal[i * 3 + 1], -faceNormal[i * 3 + 2]);
    ray.origin.set(x, y, z).addScaledVector(direction, BACK);
    ray.direction.copy(direction);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
    thickness[i] = hit ? hit.distance + BACK : Infinity;
  }
  geometry.dispose();
  return { points, thickness };
}

export interface WallReport {
  samples: number;
  thinner: { limit: number; share: number }[]; // the share (0..1) of the surface thinner than each limit, mm
  worst: { at: [number, number, number]; samples: number; thinnest: number }[]; // where the thin surface is, most first
}

export const WALL_LIMITS = [0.4, 0.6]; // mm: two nozzle widths, and the thinnest feature meant to print (see print.ts)

// Summarises a measurement: the share of the surface under each limit, and the places where thin wall gathers
// (cells of `cell` mm holding the most points thinner than the first limit)
export function summariseWalls({ points, thickness }: WallSamples, limits = WALL_LIMITS, cell = 2, top = 5): WallReport {
  const samples = thickness.length;
  const thinner = limits.map((limit) => ({ limit, share: thickness.filter((t) => t < limit).length / samples }));
  const cells = new Map<string, { sum: [number, number, number]; samples: number; thinnest: number }>();
  for (let i = 0; i < samples; i++) {
    if (!(thickness[i] < limits[0])) continue;
    const key = [0, 1, 2].map((k) => Math.floor(points[i * 3 + k] / cell)).join(",");
    const entry = cells.get(key) ?? { sum: [0, 0, 0] as [number, number, number], samples: 0, thinnest: Infinity };
    for (let k = 0; k < 3; k++) entry.sum[k] += points[i * 3 + k];
    entry.samples++;
    entry.thinnest = Math.min(entry.thinnest, thickness[i]);
    cells.set(key, entry);
  }
  const worst = [...cells.values()]
    .sort((p, q) => q.samples - p.samples)
    .slice(0, top)
    .map((e) => ({ at: e.sum.map((s) => Math.round((s / e.samples) * 10) / 10) as [number, number, number], samples: e.samples, thinnest: Math.round(e.thinnest * 1000) / 1000 }));
  return { samples, thinner, worst };
}
