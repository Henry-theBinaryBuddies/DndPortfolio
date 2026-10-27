import * as THREE from "three";
import type { HeadBase } from "./headMesh";
import type { Params } from "./params";

// The small hair of a face, as real strand geometry: eyebrows combed along the brow ridge, and the lashes
// along the edge of each eyelid. Painted brows have no depth and never catch the light; strands do.

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

// Collects strands (thin flattened tubes that taper to a point) into one mesh
class Strands {
  vertices: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  add(path: THREE.Vector3[], reference: THREE.Vector3, radius: number, flat: number, root: THREE.Color, tip: THREE.Color, sides = 4): void {
    const first = this.vertices.length / 3;
    const color = new THREE.Color();
    const last = path.length - 1;
    for (let r = 0; r <= last; r++) {
      const a = path[Math.max(0, r - 1)];
      const b = path[Math.min(last, r + 1)];
      const along = new THREE.Vector3().subVectors(b, a).normalize();
      const across = new THREE.Vector3().crossVectors(along, reference);
      if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
      across.normalize();
      const up = new THREE.Vector3().crossVectors(across, along).normalize();
      const t = r / last;
      const size = radius * (1 - 0.9 * Math.pow(t, 1.2));
      color.copy(root).lerp(tip, t);
      for (let j = 0; j < sides; j++) {
        const angle = (2 * Math.PI * j) / sides;
        const offset = across.clone().multiplyScalar(Math.cos(angle) * size * flat).addScaledVector(up, Math.sin(angle) * size);
        this.vertices.push(path[r].x + offset.x, path[r].y + offset.y, path[r].z + offset.z);
        this.colors.push(color.r, color.g, color.b);
      }
    }
    for (let r = 0; r < last; r++) {
      for (let j = 0; j < sides; j++) {
        const a = first + r * sides + j;
        const b = first + r * sides + ((j + 1) % sides);
        const c = first + (r + 1) * sides + j;
        const d = first + (r + 1) * sides + ((j + 1) % sides);
        this.indices.push(a, b, c, b, d, c);
      }
    }
  }

  geometry(): THREE.BufferGeometry | null {
    if (this.vertices.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.vertices, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    return geometry;
  }
}

export function buildFineHair(
  p: Params,
  positions: Float32Array,
  normals: Float32Array,
  eyes: { left: [number, number, number]; right: [number, number, number]; radius: number },
  base: HeadBase,
): THREE.BufferGeometry | null {
  const masks = base.masks;
  const strands = new Strands();
  const rand = random(77);
  const count = positions.length / 3;
  const hair = new THREE.Color(p.hairColor);
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();

  // Eyebrows: short strands rooted in the brow mask, combed up and outward along the inner half of the brow
  // and down and outward along the tail
  if (p.eyebrows > 0.05) {
    const rootTone = hair.clone().multiplyScalar(0.75);
    const per = Math.round(650 * p.eyebrows);
    for (const sign of [-1, 1]) {
      const candidates: number[] = [];
      for (let i = 0; i < count; i++) {
        if (masks.brows[i] > 0.4 && positions[i * 3] * sign > 0 && normals[i * 3 + 2] > -0.1) candidates.push(i);
      }
      if (candidates.length === 0) continue;
      // Densest along the middle of the brow and thinning toward its edges and its tail, so it reads as
      // hair rather than a solid bar
      for (let n = 0, tries = 0; n < per && tries < per * 6; tries++) {
        const i = candidates[Math.floor(rand() * candidates.length)];
        const tail = 1 - 0.6 * Math.max(0, Math.min(1, (Math.abs(positions[i * 3]) - 0.22) / 0.12));
        if (rand() > masks.brows[i] ** 2 * tail) continue;
        n++;
        point.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        normal.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]).normalize();
        const flow = new THREE.Vector3(sign, Math.abs(point.x) < 0.2 ? 0.55 : -0.4, 0).normalize();
        const tangent = flow.clone().addScaledVector(normal, -flow.dot(normal)).normalize();
        // Brow hairs leave the skin at a shallow angle and bend back down along it, so they lie flat
        const dir = tangent.clone().addScaledVector(normal, 0.08).normalize();
        const length = 0.04 * (0.7 + 0.5 * rand());
        const path = [point.clone().addScaledVector(normal, 0.001)];
        const p0 = path[0].clone();
        for (let s = 0; s < 4; s++) {
          dir.x += (rand() - 0.5) * 0.08;
          dir.y += (rand() - 0.5) * 0.08;
          dir.addScaledVector(normal, -0.07).normalize();
          p0.addScaledVector(dir, length / 4);
          path.push(p0.clone());
        }
        strands.add(path, normal, 0.0011 * (0.8 + 0.4 * rand()), 1.3, rootTone, hair);
      }
    }
  }

  // Eyelashes: rooted along the edge of each eyelid. The edge is found by angle around the eye: in each
  // slice, the skin vertex just in front of the eyeball that is closest to the eye's front axis (the rim
  // of the opening). The sculpt's lids were made for an eye with a bulging cornea, so the upper lid's edge
  // sits up to about 1.4 eyeball radii from the centre. The edge is found on the undeformed head and the
  // lashes grow from where those same vertices end up, so they follow the lid as it is lowered. Upper
  // lashes are longer and curl up, lower ones are short and point down and out; both grow longer toward
  // the outer corner.
  {
    const dark = hair.clone().lerp(new THREE.Color(0x050403), 0.8);
    const BINS = 72;
    const at = (i: number) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    for (const [eye, baseEye] of [
      [eyes.left, base.eyes.left],
      [eyes.right, base.eyes.right],
    ] as const) {
      const centre = new THREE.Vector3(...eye);
      const outward = Math.sign(centre.x) || 1;
      const rim: (THREE.Vector3 | null)[] = new Array(BINS).fill(null);
      const best = new Array(BINS).fill(Infinity);
      const rel = new THREE.Vector3();
      const radius = base.eyes.radius;
      const bp = base.positions;
      for (let i = 0; i < count; i++) {
        rel.set(bp[i * 3] - baseEye[0], bp[i * 3 + 1] - baseEye[1], bp[i * 3 + 2] - baseEye[2]);
        const distance = rel.length();
        if (distance < radius * 0.85 || distance > radius * 1.45 || rel.z < radius * 0.3) continue;
        const angle = Math.atan2(rel.y, rel.x * outward);
        const bin = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
        const fromAxis = Math.hypot(rel.x, rel.y);
        if (fromAxis < best[bin]) {
          best[bin] = fromAxis;
          rim[bin] = at(i);
        }
      }
      for (let bin = 0; bin < BINS; bin++) {
        const root = rim[bin];
        const next = rim[(bin + 1) % BINS];
        if (!root || !next) continue;
        const angle = ((bin + 0.5) / BINS) * 2 * Math.PI - Math.PI;
        const upper = angle > 0.25 && angle < Math.PI - 0.3;
        const lower = angle < -0.35 && angle > -Math.PI + 0.4;
        if (!upper && !lower) continue;
        const outer = Math.cos(angle); // 1 at the outer corner, -1 at the inner
        for (let n = 0; n < (upper ? 2 : 1); n++) {
          const start = root.clone().lerp(next, rand());
          rel.subVectors(start, centre);
          const out2d = new THREE.Vector3(rel.x, rel.y, 0).normalize();
          const dir = out2d.multiplyScalar(upper ? 0.25 : 0.45).add(new THREE.Vector3(0, upper ? 0.05 : -0.2, 0.95)).normalize();
          const length = (upper ? 0.03 : 0.016) * (0.85 + 0.35 * outer) * (0.85 + 0.3 * rand());
          const path = [start.clone()];
          const q = start.clone();
          for (let s = 0; s < 4; s++) {
            dir.y += upper ? 0.12 : -0.03;
            dir.normalize();
            q.addScaledVector(dir, length / 4);
            path.push(q.clone());
          }
          strands.add(path, new THREE.Vector3(0, 0, 1), 0.0009, 1, dark, dark, 3);
        }
      }
    }
  }

  return strands.geometry();
}
