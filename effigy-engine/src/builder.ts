import * as THREE from "three";
import { buildHeadGeometry, eyePosition, headRadii } from "./face";
import type { Params } from "./params";

// In Three.js a visible thing is a Mesh: a geometry (the shape) plus a material
// (how light hits it). Meshes are parented into Groups, so the whole bust can
// be rotated, scaled and exported as one object.
//
// The bust's origin is the top of its plinth: y = 0 is the base, the head floats above it.

type Vec3 = [number, number, number];
type Rot = Partial<Record<"x" | "y" | "z", number>>;

export function buildBust(p: Params): THREE.Group {
  const root = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: p.skin, roughness: 0.85 });
  const cloth = new THREE.MeshStandardMaterial({ color: p.cloth, roughness: 1, side: THREE.DoubleSide, flatShading: true });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3b3b42, roughness: 0.45, metalness: 0.75, flatShading: true });
  const bone = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.6, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 1 });
  const glow = new THREE.MeshBasicMaterial({ color: p.eyes });

  const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: Vec3, scale?: Vec3, rotation?: Rot) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    if (rotation) Object.assign(mesh.rotation, rotation);
    parent.add(mesh);
    return mesh;
  };

  const b = p.bulk;
  const { rx, ry, rz } = headRadii(p);

  // Shoulders: the upper half of a squashed sphere, so it sits flat on the plinth.
  add(root, new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), iron, [0, 0, 0], [0.82 * b, 0.62, 0.46]);
  add(root, new THREE.CylinderGeometry(0.3, 0.42, 0.24, 12, 1, true), cloth, [0, 0.6, 0]);
  add(root, new THREE.CylinderGeometry(0.13, 0.16, 0.45, 10), skin, [0, 0.74, -0.01]);

  for (const side of [-1, 1]) {
    if (p.pauldrons > 0.03) {
      const r = 0.12 + 0.14 * p.pauldrons;
      add(root, new THREE.CylinderGeometry(r * 0.7, r, 0.08, 8), iron, [side * 0.6 * b, 0.34, 0], undefined, { z: -side * 0.45 });
      add(root, new THREE.CylinderGeometry(r * 0.5, r * 0.85, 0.07, 8), iron, [side * 0.64 * b, 0.42, 0], undefined, { z: -side * 0.55 });
      if (p.pauldrons > 0.5) {
        add(root, new THREE.ConeGeometry(0.04, 0.1 + p.pauldrons * 0.3, 5), bone, [side * (0.68 * b + 0.04), 0.5 + p.pauldrons * 0.08, 0], undefined, { z: -side * 0.7 });
      }
    }
  }

  // The head gets its own group so the whole face can be positioned over the neck as one piece.
  const head = new THREE.Group();
  head.position.set(0, 0.78 + ry * 0.95, 0.02);
  root.add(head);

  add(head, buildHeadGeometry(p), skin, [0, 0, 0]);

  // Eyes: glowing orbs partly hidden inside the sockets
  const eyeRadius = 0.04 * p.eyeSize;
  for (const side of [-1, 1] as const) {
    const at = eyePosition(p, side);
    add(head, new THREE.SphereGeometry(eyeRadius, 12, 10), glow, [at.x, at.y, at.z]);
  }
  const eyeLight = new THREE.PointLight(p.eyes, 0.12 * Math.PI, 0.9);
  eyeLight.position.set(0, 0.1 * ry, rz + 0.2);
  head.add(eyeLight);

  // Mouth: a dark slit set into the indent, with tusks rising from the jaw
  const mouthY = -0.5 * ry;
  const mouthZ = rz * Math.sqrt(1 - 0.25) * 0.98;
  add(head, new THREE.BoxGeometry(0.2 * p.mouthWidth, 0.018, 0.02), dark, [0, mouthY, mouthZ - 0.005]);
  if (p.tusks > 0.03) {
    for (const side of [-1, 1]) {
      add(
        head,
        new THREE.ConeGeometry(0.022, 0.06 + p.tusks * 0.14, 6),
        bone,
        [side * 0.11 * p.mouthWidth * p.jawWidth, mouthY + 0.02 + p.tusks * 0.03, mouthZ - 0.015],
        undefined,
        { z: side * 0.12 },
      );
    }
  }

  // Ears: a stubby ellipsoid when small, a swept-back spike when large
  for (const side of [-1, 1]) {
    const length = 0.08 + p.earSize * 0.3;
    add(head, new THREE.ConeGeometry(0.05, length, 6), skin, [side * (rx * 0.97 + length * 0.35), 0.02 * ry, -0.04], [1, 1, 0.5], { z: -side * (Math.PI / 2 - 0.5) });
  }

  // Hood: a lathe (a profile spun around the vertical axis) with a wedge cut from the front.
  // Deeper hood means a narrower opening and a taller peak.
  const gap = Math.PI * (0.85 - 0.6 * p.hoodDepth);
  const profile: [number, number][] = [
    [0.7, -0.95],
    [1.05, -0.6],
    [1.2, -0.1],
    [1.12, 0.45],
    [0.8, 0.95],
    [0.4, 1.28],
    [0.0, 1.35 + p.hoodDepth * 0.4],
  ];
  const hoodGeo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r * rx * 1.2, y * ry)), 14, gap / 2, Math.PI * 2 - gap);
  add(head, hoodGeo, cloth, [0, 0, -0.06], [1, 1, 1.05]);

  if (p.horns > 0.03) {
    const scale = 0.5 + p.horns * 1.6;
    for (const side of [-1, 1]) {
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(side * 0.12 * scale, 0.08 * scale, 0),
        new THREE.Vector3(side * 0.16 * scale, 0.3 * scale, 0.05 * scale),
      );
      add(head, new THREE.TubeGeometry(curve, 14, 0.03, 6), bone, [side * rx * 0.55, ry * 0.7, 0.0]);
    }
  }

  return root;
}

// Geometry and materials live on the GPU, and JavaScript's garbage collector
// cannot free them. Whenever a bust is replaced we release them by hand.
export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}
