import * as THREE from "three";
import { eyeCentre, FACE_DROP, makeAnatomy } from "./anatomy";
import { meshField } from "./mesher";
import { raycastSurface, smoothstep, type Sdf } from "./sdf";
import { derive, type Params } from "./params";

// The bust is sculpted as a signed distance field (anatomy.ts), turned into a mesh (mesher.ts), and
// painted here. Painting is per-vertex colour: ambient occlusion sampled from the field darkens
// creases and sockets, then grime, scars, brows, lips, age lines, scales and a tunic go on top.

export interface Radii {
  rx: number;
  ry: number;
  rz: number;
}

// Rough size of the head, used to place horns and fit things around it.
export function headRadii(p: Params): Radii {
  const k = derive(p);
  return { rx: 0.5 * k.headWidth, ry: 0.62 * k.headHeight, rz: 0.55 };
}

type Vec3 = [number, number, number];

// Scars are line segments on the unit sphere around the head. More of them appear as the slider rises.
const SCARS: { from: Vec3; to: Vec3; starts: number }[] = [
  { from: [0.5, 0.55, 0.67], to: [0.26, -0.42, 0.87], starts: 0.03 }, // brow, across the right eye, down the cheek
  { from: [-0.76, 0.0, 0.65], to: [-0.3, -0.62, 0.73], starts: 0.25 }, // left cheek
  { from: [0.12, -0.4, 0.91], to: [0.22, -0.88, 0.44], starts: 0.5 }, // through the lip and chin
];
const SCAR_WIDTH = 0.07;
export const MAX_STITCHES_PER_SCAR = 8;

export type Quality = "draft" | "final";
// Grid cell size in head units: small is detailed but slow.
const CELL: Record<Quality, number> = { draft: 0.034, final: 0.012 };

// Repeatable pseudo-random value in [0, 1) for a lattice point, smoothed into 3D value noise below.
const hash3 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = smoothstep(x - xi);
  const v = smoothstep(y - yi);
  const w = smoothstep(z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const at = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v),
    lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v),
    w,
  );
}

// A 3D gaussian blob weight: 1 at the centre, fading to 0 by roughly one `s` away on each axis.
const gauss = (dx: number, sx: number, dy: number, sy: number, dz: number, sz: number) =>
  Math.exp(-((dx / sx) ** 2 + (dy / sy) ** 2 + (dz / sz) ** 2));

function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const t = Math.min(1, Math.max(0, (apx * abx + apy * aby + apz * abz) / (abx * abx + aby * aby + abz * abz)));
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  const dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const scarSegments = (p: Params) =>
  SCARS.map((s) => ({
    a: new THREE.Vector3(...s.from).normalize(),
    b: new THREE.Vector3(...s.to).normalize(),
    strength: smoothstep((p.scars - s.starts) * 3),
  }));

export function buildBodyGeometry(p: Params, quality: Quality = "final"): THREE.BufferGeometry {
  const { sdf, outer, inner, bounds } = makeAnatomy(p);
  const mesh = meshField(sdf, bounds, { cell: CELL[quality], outer, inner });
  const count = mesh.positions.length / 3;
  const colors = new Float32Array(count * 3);
  const { rx, ry, rz } = headRadii(p);

  const base = new THREE.Color(p.skin);
  const clothTone = new THREE.Color(p.cloth);
  const trimTone = clothTone.clone().multiplyScalar(0.35);
  const scarTone = base.clone().lerp(new THREE.Color(0x6a1f1c), 0.85);
  const grimeTone = new THREE.Color(0x15110c);
  const rimTone = base.clone().lerp(new THREE.Color(0xe6d2c4), 0.55);
  const browTone = new THREE.Color(p.hairColor);
  const lipTone = base.clone().lerp(new THREE.Color(0x6a2326), 0.45).multiplyScalar(0.85);
  const blushTone = base.clone().lerp(new THREE.Color(0xa0473c), 0.35);
  const scars = scarSegments(p);
  const k = derive(p);
  const eyeX = 0.3 * k.eyeSpacing;

  // Ambient occlusion: how much of the field near each point is solid. Samples at a few distances along
  // the normal; if the field is closer than expected, something is blocking the light. The raw values
  // are noisy (the field is only approximately a distance), so they are smoothed across neighbouring
  // vertices, which is what removes the orange-peel look from the skin.
  const aoValues = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = mesh.positions[i * 3];
    const y = mesh.positions[i * 3 + 1];
    const z = mesh.positions[i * 3 + 2];
    const nx = mesh.normals[i * 3];
    const ny = mesh.normals[i * 3 + 1];
    const nz = mesh.normals[i * 3 + 2];
    let occ = 0;
    let weight = 1;
    for (const dist of [0.03, 0.07, 0.14]) {
      occ += (dist - Math.max(-0.5, sdf(x + nx * dist, y + ny * dist, z + nz * dist))) * weight;
      weight *= 0.55;
    }
    aoValues[i] = Math.min(1, Math.max(0, occ * 3.2));
  }
  const smoothAo = new Float32Array(count);
  const touches = new Float32Array(count);
  for (let pass = 0; pass < 3; pass++) {
    smoothAo.set(aoValues);
    touches.fill(1);
    for (let t3 = 0; t3 < mesh.indices.length; t3 += 3) {
      const a = mesh.indices[t3];
      const b = mesh.indices[t3 + 1];
      const c = mesh.indices[t3 + 2];
      smoothAo[a] += aoValues[b] + aoValues[c];
      smoothAo[b] += aoValues[a] + aoValues[c];
      smoothAo[c] += aoValues[a] + aoValues[b];
      touches[a] += 2;
      touches[b] += 2;
      touches[c] += 2;
    }
    for (let i = 0; i < count; i++) aoValues[i] = smoothAo[i] / touches[i];
  }

  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const nasoA = new THREE.Vector3();
  const nasoB = new THREE.Vector3();
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const x = mesh.positions[i * 3];
    const y = mesh.positions[i * 3 + 1];
    const z = mesh.positions[i * 3 + 2];

    const ao = aoValues[i];
    color.copy(base).multiplyScalar(1 - 0.72 * ao);

    // Head-region painting uses the unit sphere around the skull; fade it out down the neck.
    u.set(x / rx, (y + FACE_DROP) / ry, z / rz).normalize();
    const head = smoothstep((y + 0.78) / 0.12);

    // Light flush on the cheeks and nose, a little less when the skin is filthy
    const blush = Math.max(gauss(Math.abs(x) / rx - 0.62, 0.2, u.y + 0.1, 0.16, u.z - 0.7, 0.4), gauss(x / rx, 0.1, u.y + 0.2, 0.12, u.z - 1, 0.3)) * head;
    color.lerp(blushTone, blush * 0.35 * (1 - p.grime * 0.6));

    // Eyebrows, eye bags, and the creases from nose to mouth
    let brow = 0;
    let bags = 0;
    let lines = 0;
    for (const sign of [-1, 1]) {
      brow = Math.max(brow, gauss(u.x - sign * (eyeX + 0.06), 0.2, u.y - 0.37, 0.03 + 0.035 * p.eyebrows, u.z - 0.82, 0.3));
      bags = Math.max(bags, gauss(u.x - sign * eyeX, 0.15, u.y, 0.05, u.z - 0.95, 0.2));
      nasoA.set(sign * 0.17, -0.22, 0.96).normalize();
      nasoB.set(sign * 0.36, -0.56, 0.82).normalize();
      lines = Math.max(lines, Math.exp(-((distanceToSegment(u, nasoA, nasoB) / 0.035) ** 2)));
    }
    color.lerp(browTone, brow * Math.min(1, p.eyebrows * 1.4) * head);
    color.multiplyScalar(1 - 0.35 * bags * (0.3 + p.age) * head);
    color.multiplyScalar(1 - 0.4 * lines * p.age * head);
    for (const band of [0.58, 0.5, 0.42]) {
      const crease = Math.exp(-(((u.y - band) / 0.022) ** 2)) * smoothstep((u.z - 0.5) / 0.2) * (1 - smoothstep((Math.abs(u.x) - 0.5) / 0.15));
      color.multiplyScalar(1 - 0.4 * crease * p.age * head * (0.5 + noise3(u.x * 6 + band * 10, 0, 1)));
    }

    // Lips and the mouth line
    const lipWeight = gauss(u.x, 0.2 * k.mouthWidth, u.y + 0.5, 0.05, u.z - 0.88, 0.3) * head;
    color.lerp(lipTone, lipWeight * 0.75);
    const mouthLine = gauss(u.x, 0.2 * k.mouthWidth, u.y + 0.515, 0.012, u.z - 0.86, 0.3) * head;
    color.lerp(grimeTone, mouthLine * 0.9);

    // Dragonborn scales: diamond cells with dark seams
    if (k.scales > 0.02) {
      const g1 = Math.sin((u.x + u.y * 0.5) * 46);
      const g2 = Math.sin((u.x - u.y * 0.5) * 46);
      const seam = 1 - smoothstep(Math.abs(g1 * g2) / 0.22);
      color.multiplyScalar(1 - 0.5 * seam * k.scales * head);
      color.multiplyScalar(1 + 0.12 * k.scales * head * (noise3(u.x * 30, u.y * 30, u.z * 30) - 0.5));
    }

    // Grime blotches, heavier in recesses
    const n = noise3(u.x * 3 + 5, u.y * 3, u.z * 3) * 0.6 + noise3(u.x * 9, u.y * 9 + 3, u.z * 9) * 0.4;
    const grime = smoothstep((n - 0.38) / 0.28) * p.grime * 0.8 + ao * p.grime * 0.35;
    color.lerp(grimeTone, Math.min(0.9, grime) * (0.4 + 0.6 * head));

    // Scars: a dark-red core with paler raised edges
    let scarMix = 0;
    let scarRim = 0;
    for (const s of scars) {
      if (s.strength <= 0) continue;
      const d = distanceToSegment(u, s.a, s.b);
      scarMix = Math.max(scarMix, Math.exp(-((d / SCAR_WIDTH) ** 2)) * s.strength);
      scarRim = Math.max(scarRim, Math.exp(-(((d - SCAR_WIDTH * 1.15) / (SCAR_WIDTH * 0.6)) ** 2)) * s.strength);
    }
    color.lerp(rimTone, scarRim * 0.85 * head);
    color.lerp(scarTone, scarMix * head);

    // Tunic: everything below a V-shaped neckline is cloth, with a dark trim along the edge
    v.set(Math.abs(x), y, z);
    const neckline = -0.8 - 0.3 * (1 - smoothstep(v.x / 0.22)) * smoothstep((z + 0.02) / 0.1);
    const cloth = smoothstep((neckline - y) / 0.012);
    if (cloth > 0) {
      const weave = 0.9 + 0.2 * noise3(x * 60, y * 60, z * 60);
      const tunic = clothTone.clone().multiplyScalar(weave * (1 - 0.6 * ao));
      color.lerp(tunic, cloth);
      const trim = Math.exp(-(((y - neckline) / 0.018) ** 2));
      color.lerp(trimTone, trim * 0.8 * cloth);
    }

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  // Do not recompute normals: the field's gradient is smoother than anything we could derive from the faces.
  return geometry;
}

// Finds where the surface is along a direction out from the middle of the head. (ux, uy) is a point
// on the unit sphere's front, as before, used to seat the moustache, tusks and stitches on the face.
export function surfacePoint(p: Params, ux: number, uy: number, sdf?: Sdf): { position: THREE.Vector3; normal: THREE.Vector3 } {
  const field = sdf ?? makeAnatomy(p).sdf;
  const uz = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
  const dir = new THREE.Vector3(ux, uy, uz).normalize();
  const { rx, ry, rz } = headRadii(p);
  const far: Vec3 = [dir.x * rx * 2.2, dir.y * ry * 2.2 - FACE_DROP, dir.z * rz * 2.2];
  const hit = raycastSurface(field, far, [0, -FACE_DROP, 0]) ?? [dir.x * rx, dir.y * ry - FACE_DROP, dir.z * rz];
  const e = 0.003;
  const normal = new THREE.Vector3(
    field(hit[0] + e, hit[1], hit[2]) - field(hit[0] - e, hit[1], hit[2]),
    field(hit[0], hit[1] + e, hit[2]) - field(hit[0], hit[1] - e, hit[2]),
    field(hit[0], hit[1], hit[2] + e) - field(hit[0], hit[1], hit[2] - e),
  ).normalize();
  return { position: new THREE.Vector3(...hit), normal };
}

export interface Stitch {
  position: THREE.Vector3;
  across: THREE.Vector3; // unit vector pointing across the scar, along the thread
}

// Cross-stitches spaced along every visible scar. The stitches slider sets how many per scar.
export function stitchPlacements(p: Params): Stitch[] {
  const count = Math.round(p.stitches * MAX_STITCHES_PER_SCAR);
  if (count === 0) return [];
  const { sdf } = makeAnatomy(p);
  const out: Stitch[] = [];

  for (const scar of scarSegments(p)) {
    if (scar.strength < 0.3) continue;
    for (let k = 0; k < count; k++) {
      const t = 0.07 + 0.86 * ((k + 0.5) / count);
      const unit = scar.a.clone().lerp(scar.b, t).normalize();
      const { position, normal } = surfacePoint(p, unit.x, unit.y, sdf);
      const along = scar.b.clone().sub(scar.a);
      along.addScaledVector(normal, -along.dot(normal)).normalize();
      const across = new THREE.Vector3().crossVectors(normal, along).normalize();
      out.push({ position: position.addScaledVector(normal, 0.006), across });
    }
  }
  return out;
}

// Where an eyeball sits: nestled in the socket, its front just below the face surface.
export function eyePosition(p: Params, side: -1 | 1): THREE.Vector3 {
  return new THREE.Vector3(...eyeCentre(p, side));
}
