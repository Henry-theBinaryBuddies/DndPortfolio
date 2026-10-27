import * as THREE from "three";
import type { HeadBase } from "./headMesh";
import { derive, type Params } from "./params";

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
  masks: HeadBase["masks"],
): THREE.BufferGeometry | null {
  const k = derive(p);
  const strands = new Strands();
  const rand = random(77);
  const count = positions.length / 3;
  const hair = new THREE.Color(p.hairColor);
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();

  // Eyebrows: short strands rooted in the brow mask, combed up and outward along the inner half of the brow
  // and down and outward along the tail
  if (p.eyebrows > 0.05) {
    const rootTone = hair.clone().multiplyScalar(0.6);
    const per = Math.round(340 * p.eyebrows);
    for (const sign of [-1, 1]) {
      const candidates: number[] = [];
      for (let i = 0; i < count; i++) {
        if (masks.brows[i] > 0.4 && positions[i * 3] * sign > 0 && normals[i * 3 + 2] > -0.1) candidates.push(i);
      }
      if (candidates.length === 0) continue;
      for (let n = 0; n < per; n++) {
        const i = candidates[Math.floor(rand() * candidates.length)];
        point.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        normal.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]).normalize();
        const flow = new THREE.Vector3(sign, Math.abs(point.x) < 0.2 ? 0.55 : -0.4, 0).normalize();
        const tangent = flow.clone().addScaledVector(normal, -flow.dot(normal)).normalize();
        const dir = tangent.clone().addScaledVector(normal, 0.18).normalize();
        const length = 0.06 * (0.75 + 0.5 * rand());
        const path = [point.clone().addScaledVector(normal, 0.003)];
        const p0 = path[0].clone();
        for (let s = 0; s < 4; s++) {
          dir.x += (rand() - 0.5) * 0.08;
          dir.y += (rand() - 0.5) * 0.08;
          dir.normalize();
          p0.addScaledVector(dir, length / 4);
          path.push(p0.clone());
        }
        strands.add(path, normal, 0.0042 * (0.8 + 0.4 * rand()), 1.4, rootTone, hair);
      }
    }
  }

  // Eyelashes: along the margin of each eyelid, curling up on the upper lid and gently down on the lower.
  // (Reptilian eyes have none.)
  if (!k.slitPupils) {
    const dark = hair.clone().lerp(new THREE.Color(0x050403), 0.8);
    for (const eye of [eyes.left, eyes.right]) {
      const centre = new THREE.Vector3(...eye);
      const radius = eyes.radius;
      for (let i = 0; i < count; i++) {
        point.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        const rel = point.clone().sub(centre);
        const distance = rel.length();
        // The lid margin: the skin that lies right against the eyeball
        if (distance < radius * 0.9 || distance > radius * 1.16 || rel.z < -0.01 || Math.abs(rel.y) < 0.012) continue;
        const upper = rel.y > 0;
        normal.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]).normalize();
        const outward = new THREE.Vector3(rel.x, rel.y, 0).normalize();
        const dir = outward.multiplyScalar(0.5).add(new THREE.Vector3(0, upper ? 0.35 : -0.05, 0.6)).normalize();
        const length = upper ? 0.06 : 0.03;
        const path = [point.clone()];
        const q = point.clone();
        for (let s = 0; s < 3; s++) {
          dir.y += upper ? 0.28 : -0.04;
          dir.normalize();
          q.addScaledVector(dir, length / 3);
          path.push(q.clone());
        }
        strands.add(path, normal, 0.0042, 1, dark, dark);
      }
    }
  }

  return strands.geometry();
}
