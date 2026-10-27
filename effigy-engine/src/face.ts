import * as THREE from "three";
import type { Params } from "./params";

// The head starts as a smooth ellipsoid. Each facial feature is then a "bump":
// a soft 3D blob centred somewhere on the unit sphere that pushes the surface
// outward (brow, cheekbone, nose) or inward (eye socket, hollow cheek).
// Sliders just change the bump sizes, so every face stays one continuous mesh.

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

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export function buildHeadGeometry(p: Params): THREE.BufferGeometry {
  const { rx, ry, rz } = headRadii(p);
  const geometry = new THREE.SphereGeometry(1, 72, 56);
  const pos = geometry.attributes.position;
  const list = bumps(p);

  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i);
    const uy = pos.getY(i);
    const uz = pos.getZ(i);

    let push = 0;
    for (const b of list) {
      for (const sign of b.mirror ? [-1, 1] : [1]) {
        const dx = (ux - sign * b.centre[0]) / b.size[0];
        const dy = (uy - b.centre[1]) / b.size[1];
        const dz = (uz - b.centre[2]) / b.size[2];
        push += Math.exp(-(dx * dx + dy * dy + dz * dz)) * b.amount;
      }
    }

    // Jaw width scales the lower half sideways; chin also lengthens it.
    const low = smooth((-uy - 0.15) / 0.7);
    const x = (ux * rx + ux * push) * (1 + (p.jawWidth - 1) * low);
    const y = uy * ry + uy * push - 0.08 * p.chin * smooth((-uy - 0.4) / 0.6);
    const z = uz * rz + uz * push;
    pos.setXYZ(i, x, y, z);
  }
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
