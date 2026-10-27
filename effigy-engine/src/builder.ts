import * as THREE from "three";
import { BASE_Y, makeAnatomy, shoulderSpan } from "./anatomy";
import { buildBodyGeometry, eyePosition, headRadii, stitchPlacements, surfacePoint, type Quality } from "./face";
import type { Params } from "./params";

// In Three.js a visible thing is a Mesh: a geometry (the shape) plus a material
// (how light hits it). Meshes are parented into Groups, so the whole bust can
// be rotated, scaled and exported as one object.
//
// The bust's origin is the top of its plinth: y = 0 is the base. Everything sculpted lives in a
// group lifted so that the sculpt's flat underside (BASE_Y) lands on y = 0.

type Vec3 = [number, number, number];
type Rot = Partial<Record<"x" | "y" | "z", number>>;

interface Drape {
  base: number; // fold depth at the top
  hang: number; // extra depth toward the bottom
  fine: number; // small high-frequency ripples
}

// A shell is a lathe (a profile spun around the vertical axis) with a wedge cut from the front,
// then rippled so it hangs like cloth or strands of hair. Hood, hair and beard share it.
function shellGeometry(controls: [number, number][], rx: number, ry: number, radiusScale: number, gap: number, drape: Drape): THREE.BufferGeometry {
  // A spline through the control points gives a smooth silhouette instead of straight segments.
  const spline = new THREE.CatmullRomCurve3(controls.map(([r, y]) => new THREE.Vector3(r * rx * radiusScale, y * ry, 0)));
  const profile = spline.getPoints(28).map((v) => new THREE.Vector2(Math.max(0.001, v.x), v.y));
  const geometry = new THREE.LatheGeometry(profile, 44, gap / 2, Math.PI * 2 - gap);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const angle = Math.atan2(x, z);
    const hang = Math.min(1, Math.max(0, (0.6 * ry - y) / (1.5 * ry)));
    const fold = 1 + (drape.base + drape.hang * hang) * Math.sin(angle * 7 + y * 3.5) + drape.fine * Math.sin(angle * 13 - y * 5);
    pos.setXYZ(i, x * fold, y, z * fold);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function buildBust(p: Params, quality: Quality = "final"): THREE.Group {
  const root = new THREE.Group();

  // The sculpted body reads its colour from per-vertex paint (shadow, grime, scars, tunic), so its material is white.
  const body = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.72 });
  const cloth = new THREE.MeshStandardMaterial({ color: p.cloth, roughness: 1, side: THREE.DoubleSide });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3b3b42, roughness: 0.45, metalness: 0.75, flatShading: true });
  const bone = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.6, flatShading: true });
  const hairMat = new THREE.MeshStandardMaterial({ color: p.hairColor, roughness: 0.95, side: THREE.DoubleSide });
  const beardMat = new THREE.MeshStandardMaterial({ color: p.hairColor, roughness: 1, flatShading: true, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ color: p.eyes });

  const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: Vec3, scale?: Vec3, rotation?: Rot) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    if (rotation) Object.assign(mesh.rotation, rotation);
    parent.add(mesh);
    return mesh;
  };

  const { rx, ry, rz } = headRadii(p);
  const { sdf } = makeAnatomy(p);
  const span = shoulderSpan(p);

  const head = new THREE.Group();
  head.position.y = -BASE_Y;
  root.add(head);

  head.add(new THREE.Mesh(buildBodyGeometry(p, quality), body));

  // Pauldrons: stacked iron plates over the deltoids, with a bone spike once they are heavy enough
  for (const side of [-1, 1]) {
    if (p.pauldrons > 0.03) {
      const r = 0.12 + 0.14 * p.pauldrons;
      add(head, new THREE.CylinderGeometry(r * 0.7, r, 0.08, 8), iron, [side * 0.6 * span, -0.91, 0], undefined, { z: -side * 0.45 });
      add(head, new THREE.CylinderGeometry(r * 0.5, r * 0.85, 0.07, 8), iron, [side * 0.64 * span, -0.84, 0], undefined, { z: -side * 0.55 });
      if (p.pauldrons > 0.5) {
        add(head, new THREE.ConeGeometry(0.04, 0.1 + p.pauldrons * 0.3, 5), bone, [side * (0.68 * span + 0.04), -0.76 + p.pauldrons * 0.08, 0], undefined, { z: -side * 0.7 });
      }
    }
  }

  // Eyes: a glowing iris with a dark slit pupil, nestled in the sculpted socket. The lids are part of the sculpt.
  const eyeRadius = 0.05 * p.eyeSize;
  const pupilTone = new THREE.MeshBasicMaterial({ color: 0x050303, side: THREE.DoubleSide });
  for (const side of [-1, 1] as const) {
    const eye = new THREE.Group();
    eye.position.copy(eyePosition(p, side));
    eye.rotation.y = side * 0.25;
    head.add(eye);
    add(eye, new THREE.SphereGeometry(eyeRadius, 16, 12), glow, [0, 0, 0]);
    add(eye, new THREE.CircleGeometry(eyeRadius * 0.55, 10), pupilTone, [0, 0, eyeRadius * 0.98], [0.28, 1, 1]);
  }
  const eyeLight = new THREE.PointLight(p.eyes, 0.04 * Math.PI, 0.7);
  eyeLight.position.set(0, 0.1 * ry, rz + 0.2);
  head.add(eyeLight);

  // Stitches: a dark thread across each scar, with a small knot at either end
  const thread = new THREE.MeshStandardMaterial({ color: 0x0e0b09, roughness: 1 });
  const up = new THREE.Vector3(0, 1, 0);
  for (const stitch of stitchPlacements(p)) {
    const bar = add(head, new THREE.CylinderGeometry(0.006, 0.006, 0.085, 5), thread, [stitch.position.x, stitch.position.y, stitch.position.z]);
    bar.quaternion.setFromUnitVectors(up, stitch.across);
    for (const end of [-1, 1]) {
      const knot = stitch.position.clone().addScaledVector(stitch.across, end * 0.042);
      add(head, new THREE.SphereGeometry(0.013, 6, 5), thread, [knot.x, knot.y, knot.z]);
    }
  }

  // Tusks rise from the lower lip
  if (p.tusks > 0.03) {
    const length = 0.07 + p.tusks * 0.16;
    for (const side of [-1, 1]) {
      const lip = surfacePoint(p, (side * 0.12 * p.mouthWidth * p.jawWidth) / rx, -0.5, sdf).position;
      add(head, new THREE.ConeGeometry(0.03, length, 6), bone, [lip.x, lip.y - 0.02 + length / 2, lip.z + 0.005], undefined, { z: side * 0.1 });
    }
  }

  // Moustache and beard share the hair colour. The beard is one rippled mass wrapping the jaw.
  if (p.beard > 0.1) {
    const nose = surfacePoint(p, 0, -0.32, sdf).position;
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.012, nose.y - 0.03, nose.z - 0.005),
        new THREE.Vector3(side * 0.07, nose.y - 0.045, nose.z + 0.005),
        new THREE.Vector3(side * 0.13, nose.y - 0.12 - 0.05 * p.beard, nose.z - 0.025),
      ]);
      add(head, new THREE.TubeGeometry(curve, 10, 0.02 + 0.012 * p.beard, 6), beardMat, [0, 0, 0]);
    }
  }
  if (p.beard > 0.3) {
    const bottom = -0.68 - (0.1 + 0.6 * p.beard) / ry;
    const controls: [number, number][] = [[0.8, -0.56], [0.92, -0.7], [0.74, (-0.7 + bottom) / 2], [0.42, bottom + 0.15], [0.14, bottom]];
    const beardGeo = shellGeometry(controls, rx, ry, 1, Math.PI * 0.45, { base: 0.03, hang: 0.05, fine: 0.03 });
    const bp = beardGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      if (bp.getY(i) < bottom * ry + 0.003) bp.setY(i, bp.getY(i) - (Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.1);
    }
    beardGeo.computeVertexNormals();
    // The shell's cut-out faces the front by default, so it is turned half way round to open at the back.
    add(head, beardGeo, beardMat, [0, 0, -0.01], [1, 1, 0.92], { y: Math.PI });
  }

  if (p.hood) {
    // Deeper hood means a narrower opening and a taller peak.
    const peak = 1.33 + p.hoodDepth * 0.4;
    const controls: [number, number][] = [[0.62, -0.95], [0.98, -0.6], [1.12, -0.1], [1.04, 0.45], [0.74, 0.95], [0.36, 1.25], [0.05, peak]];
    const gap = Math.PI * (0.85 - 0.6 * p.hoodDepth);
    add(head, shellGeometry(controls, rx, ry, 1.12, gap, { base: 0.025, hang: 0.05, fine: 0.02 }), cloth, [0, 0, -0.05], [1, 1, 1.05]);
  } else if (p.hair > 0.03) {
    // Hair hugs the skull. Past a third of the slider it grows down past the neck.
    const long = Math.min(1, Math.max(0, (p.hair - 0.35) / 0.65));
    const y0 = Math.max(-0.95, -0.15 - long * 0.8);
    const controls: [number, number][] = [[1.02 - 0.25 * long, y0], [1.06 - 0.06 * long, (y0 + 0.2) / 2], [1.08, 0.2], [0.89, 0.6], [0.37, 0.95], [0.03, 1.07]];
    add(head, shellGeometry(controls, rx, ry, 1, Math.PI * 0.7, { base: 0.012, hang: 0.04, fine: 0.03 }), hairMat, [0, 0.005, -0.02], [1.02, 1.0, 1.04]);
  }

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
