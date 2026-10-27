import * as THREE from "three";
import type { Params } from "./params";

// The head starts as a smooth ellipsoid. Each facial feature is then a "bump":
// a soft 3D blob centred somewhere on the unit sphere that pushes the surface
// outward (brow, cheekbone, nose) or inward (eye socket, hollow cheek).
// Sliders just change the bump sizes, so every face stays one continuous mesh.
//
// The same push value also paints the skin: recesses darken (a cheap stand-in for
// ambient occlusion), then grime and scars are blended on top as vertex colours.

export interface Radii {
  rx: number;
  ry: number;
  rz: number;
}

export function headRadii(p: Params): Radii {
  return { rx: 0.5 * p.headWidth, ry: 0.62 * p.headHeight, rz: 0.55 };
}

type Vec3 = [number, number, number];

interface Bump {
  centre: Vec3; // where on the unit sphere (x is the right-hand side; mirrored when `mirror` is set)
  size: Vec3; // gaussian spread along x, y, z
  amount: number; // world units; negative digs in
  mirror: boolean;
}

function bumps(p: Params): Bump[] {
  const eyeX = 0.3 * p.eyeSpacing;
  return [
    { centre: [0.38, 0.3, 0.85], size: [0.3, 0.1, 0.35], amount: 0.04 + 0.2 * p.brow, mirror: true },
    { centre: [0, 0.34, 0.9], size: [0.12, 0.1, 0.3], amount: 0.07 * p.brow, mirror: false },
    { centre: [eyeX, 0.13, 0.92], size: [0.15 * p.eyeSize, 0.1 * p.eyeSize, 0.28], amount: -0.04 - 0.16 * p.socketDepth, mirror: true },
    { centre: [0.62, -0.08, 0.7], size: [0.2, 0.14, 0.4], amount: 0.02 + 0.14 * p.cheekbones, mirror: true },
    { centre: [0.45, -0.42, 0.78], size: [0.18, 0.2, 0.35], amount: -0.15 * p.gaunt, mirror: true },
    { centre: [0, -0.1, 0.98], size: [0.09 * p.noseWidth, 0.3, 0.22], amount: 0.03 + 0.2 * p.noseLength, mirror: false },
    { centre: [0, -0.24, 1], size: [0.12 * p.noseWidth, 0.07, 0.18], amount: 0.08 * p.noseLength, mirror: false },
    { centre: [0, -0.5, 0.86], size: [0.22 * p.mouthWidth, 0.03, 0.3], amount: -0.06, mirror: false },
    { centre: [0, -0.88, 0.55], size: [0.22, 0.14, 0.5], amount: 0.04 + 0.14 * p.chin, mirror: false },
  ];
}

// Scars are line segments on the unit sphere. More of them appear as the slider rises.
const SCARS: { from: Vec3; to: Vec3; starts: number }[] = [
  { from: [0.46, 0.5, 0.74], to: [0.22, -0.34, 0.91], starts: 0.05 }, // brow, across the right eye, down the cheek
  { from: [-0.74, -0.04, 0.67], to: [-0.34, -0.58, 0.74], starts: 0.35 }, // left cheek
  { from: [0.13, -0.4, 0.91], to: [0.2, -0.86, 0.46], starts: 0.65 }, // through the lip and chin
];
const SCAR_WIDTH = 0.06;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Repeatable pseudo-random value in [0, 1) for a lattice point, smoothed into 3D value noise below.
const hash3 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const w = smooth(z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const at = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v),
    lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v),
    w,
  );
}

function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

export function buildHeadGeometry(p: Params): THREE.BufferGeometry {
  const { rx, ry, rz } = headRadii(p);
  const geometry = new THREE.SphereGeometry(1, 120, 90);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const list = bumps(p);

  const base = new THREE.Color(p.skin);
  const scarTone = base.clone().lerp(new THREE.Color(0xe8d0c4), 0.8);
  const grimeTone = new THREE.Color(0x15110c);
  const rimTone = base.clone().multiplyScalar(0.3);

  const scars = SCARS.map((s) => ({
    a: new THREE.Vector3(...s.from).normalize(),
    b: new THREE.Vector3(...s.to).normalize(),
    strength: smooth((p.scars - s.starts) * 3),
  }));

  const u = new THREE.Vector3();
  const color = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    u.set(pos.getX(i), pos.getY(i), pos.getZ(i));

    let push = 0;
    for (const b of list) {
      for (const sign of b.mirror ? [-1, 1] : [1]) {
        const dx = (u.x - sign * b.centre[0]) / b.size[0];
        const dy = (u.y - b.centre[1]) / b.size[1];
        const dz = (u.z - b.centre[2]) / b.size[2];
        push += Math.exp(-(dx * dx + dy * dy + dz * dz)) * b.amount;
      }
    }

    // Scars: a faint raised ridge plus a pale stripe. Mirror the x of the first two so both sides can be scarred.
    let scarMix = 0;
    let scarRim = 0;
    let relief = 0;
    for (const s of scars) {
      if (s.strength <= 0) continue;
      const d = distanceToSegment(u, s.a, s.b);
      const core = Math.exp(-((d / SCAR_WIDTH) ** 2));
      const rim = Math.exp(-(((d - SCAR_WIDTH * 1.2) / (SCAR_WIDTH * 0.7)) ** 2));
      scarMix = Math.max(scarMix, core * s.strength);
      scarRim = Math.max(scarRim, rim * s.strength);
      relief += core * s.strength * 0.014;
    }
    push += relief;

    // Jaw width scales the lower half sideways; chin also lengthens it.
    const low = smooth((-u.y - 0.15) / 0.7);
    pos.setXYZ(
      i,
      (u.x * rx + u.x * push) * (1 + (p.jawWidth - 1) * low),
      u.y * ry + u.y * push - 0.08 * p.chin * smooth((-u.y - 0.4) / 0.6),
      u.z * rz + u.z * push,
    );

    // Skin colour: recesses go dark, ridges catch a little extra, then grime blotches and scars on top.
    const occlusion = Math.min(1, Math.max(0, -push * 6));
    const ridge = Math.min(0.4, Math.max(0, push * 3));
    color.copy(base).multiplyScalar(1 - 0.7 * occlusion + 0.22 * ridge);

    const n = noise3(u.x * 3 + 5, u.y * 3, u.z * 3) * 0.6 + noise3(u.x * 9, u.y * 9 + 3, u.z * 9) * 0.4;
    const grime = smooth((n - 0.38) / 0.28) * p.grime * 0.8 + occlusion * p.grime * 0.35;
    color.lerp(grimeTone, Math.min(0.9, grime));

    color.lerp(rimTone, scarRim * 0.8);
    color.lerp(scarTone, scarMix);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Where an eyeball sits: on the surface at the socket centre, sunk in slightly.
export function eyePosition(p: Params, side: -1 | 1): THREE.Vector3 {
  const { rx, ry, rz } = headRadii(p);
  const ux = 0.3 * p.eyeSpacing;
  const uy = 0.15;
  const uz = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
  const inset = 0.02 + 0.1 * p.socketDepth;
  const pos = new THREE.Vector3(ux * rx, uy * ry, uz * rz);
  pos.addScaledVector(new THREE.Vector3(ux, uy, uz).normalize(), -inset * 0.85);
  pos.x *= side;
  return pos;
}
