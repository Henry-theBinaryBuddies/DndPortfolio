import * as THREE from "three";
import type { Params } from "./params";

// In Three.js a visible thing is a Mesh: a geometry (the shape) plus a material
// (how light hits it). Meshes are parented into Groups, so the whole figure can
// be rotated, scaled and exported as one object.

export function buildCharacter(p: Params): THREE.Group {
  const root = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: p.skin, roughness: 0.85 });
  const cloth = new THREE.MeshStandardMaterial({ color: p.cloth, roughness: 0.95, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 1 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a4a4e, roughness: 0.5, metalness: 0.6 });
  const glow = new THREE.MeshBasicMaterial({ color: p.eyes });

  const add = (
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number],
    scale?: [number, number, number],
    rotation?: Partial<Record<"x" | "y" | "z", number>>,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    if (rotation) Object.assign(mesh.rotation, rotation);
    parent.add(mesh);
    return mesh;
  };

  const b = p.bulk;
  const shoulderY = 1.55;

  // Torso and cloak. The cloak is an open cone (no caps) that flares toward the ground.
  add(root, new THREE.CapsuleGeometry(0.2 * b, 0.75, 6, 14), dark, [0, 1.25, 0]);
  const cloakLen = 0.4 + p.cloakLength * 1.2;
  add(
    root,
    new THREE.CylinderGeometry(0.28 * b, (0.3 + 0.35 * p.cloakLength) * b, cloakLen, 14, 1, true),
    cloth,
    [0, shoulderY + 0.05 - cloakLen / 2, 0],
  );

  for (const side of [-1, 1]) {
    // Legs
    add(root, new THREE.CapsuleGeometry(0.1 * b, 0.75, 6, 10), dark, [side * 0.13 * b, 0.4, 0]);
    // Arms hang from the shoulder, so the centre moves up as they get longer
    const armLen = 0.8 * p.armLength;
    add(
      root,
      new THREE.CapsuleGeometry(0.06 * b, armLen, 6, 10),
      cloth,
      [side * (0.3 * b + 0.02), shoulderY - (armLen + 0.12) / 2, 0.04],
      undefined,
      { z: side * 0.12, x: -0.2 },
    );
    // Pauldrons: a squashed metal sphere, with a spike once they are heavy enough
    if (p.pauldrons > 0.03) {
      const r = 0.1 + 0.12 * p.pauldrons;
      add(root, new THREE.SphereGeometry(r, 14, 10), metal, [side * 0.32 * b, shoulderY - 0.02, 0], [1, 0.65, 1]);
      if (p.pauldrons > 0.5) {
        add(
          root,
          new THREE.ConeGeometry(0.04, 0.1 + p.pauldrons * 0.3, 6),
          bone,
          [side * 0.34 * b, shoulderY + 0.1 + p.pauldrons * 0.1, 0],
          undefined,
          { z: -side * 0.3 },
        );
      }
    }
  }

  // The head sits in its own group so headSize scales skull, hood and horns together.
  const head = new THREE.Group();
  head.position.y = 1.95;
  head.scale.setScalar(p.headSize * 1.2);
  root.add(head);

  add(head, new THREE.SphereGeometry(0.2, 20, 16), skin, [0, 0, 0.02], [0.85, 1.1, 0.9]);
  add(head, new THREE.SphereGeometry(0.1, 12, 10), skin, [0, -0.15, 0.07], [0.9 * p.jaw, 1, 0.9]);
  add(head, new THREE.CircleGeometry(0.15, 16), dark, [0, -0.01, 0.17], [0.85, 1.15, 1]);
  add(head, new THREE.SphereGeometry(0.026, 8, 6), glow, [-0.06, 0.03, 0.2]);
  add(head, new THREE.SphereGeometry(0.026, 8, 6), glow, [0.06, 0.03, 0.2]);

  // Hood: a partial sphere. A deeper hood covers more of the skull and pulls forward.
  const hoodCover = Math.PI * (0.52 + 0.2 * p.hoodDepth);
  add(
    head,
    new THREE.SphereGeometry(0.25, 18, 12, 0, Math.PI * 2, 0, hoodCover),
    cloth,
    [0, 0.03, -0.05 + 0.02 * p.hoodDepth],
    [1, 1.12, 1.1],
    { x: -0.45 },
  );
  // A mantle over the shoulders joins the hood to the cloak so the head doesn't float
  add(root, new THREE.CapsuleGeometry(0.11, 0.5 * b, 6, 12), cloth, [0, shoulderY - 0.02, 0], [1, 1, 1.1], { z: Math.PI / 2 });

  if (p.horns > 0.03) {
    const scale = 0.5 + p.horns * 1.6;
    for (const side of [-1, 1]) {
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(side * 0.1 * scale, 0.12 * scale, 0),
        new THREE.Vector3(side * 0.1 * scale, 0.3 * scale, 0.06 * scale),
      );
      add(head, new THREE.TubeGeometry(curve, 12, 0.028, 8), bone, [side * 0.12, 0.17, 0]);
    }
  }

  root.scale.setScalar(p.height);
  return root;
}

// Geometry and materials live on the GPU, and JavaScript's garbage collector
// cannot free them. Whenever a figure is replaced we release them by hand.
export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}
