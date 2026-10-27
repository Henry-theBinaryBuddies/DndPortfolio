import * as THREE from "three";
import { frontPoint, sculptBust, stitchPlacements, topPoint } from "./face";
import type { HeadBase } from "./headMesh";
import { applySkinDetail } from "./skinShader";
import { derive, type Params } from "./params";

// In Three.js a visible thing is a Mesh: a geometry (the shape) plus a material
// (how light hits it). Meshes are parented into Groups, so the whole bust can
// be rotated, scaled and exported as one object.
//
// The bust's origin is the top of its plinth: y = 0 is the base. The sculpted head lives in a group
// lifted so that the head's flat underside lands on y = 0.

type Vec3 = [number, number, number];
type Rot = Partial<Record<"x" | "y" | "z", number>>;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// A realistic eyeball: a white sclera with faint veins, an iris with radial fibres and a darker rim
// (the limbal ring), a black pupil, and a clear glossy cornea over the front. It is built facing +z.
function realisticEye(radius: number, irisHex: string): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(radius, 48, 36);
  geometry.rotateX(Math.PI / 2); // spheres have their poles on y; turn one to face the front
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const iris = new THREE.Color(irisHex);
  const sclera = new THREE.Color(0xe9e3d6);
  const vein = new THREE.Color(0xb04a3e);
  const dark = new THREE.Color(0x060403);
  const collarette = new THREE.Color(0xd9b46a);
  const c = new THREE.Color();
  const irisEdge = 0.52; // iris radius as an angle from the front
  const pupilEdge = 0.2;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const theta = Math.acos(Math.min(1, Math.max(-1, z / radius))); // angle away from the front
    const phi = Math.atan2(y, x);

    if (theta < pupilEdge) {
      c.copy(dark);
    } else if (theta < irisEdge) {
      const t = (theta - pupilEdge) / (irisEdge - pupilEdge);
      const fibre = 0.82 + 0.18 * Math.sin(phi * 28 + Math.sin(phi * 5) * 3) + 0.08 * Math.sin(phi * 61 + t * 9);
      c.copy(iris).multiplyScalar(1.35 - 0.7 * t).multiplyScalar(fibre);
      // a pale ring close to the pupil, and a dark limbal ring at the outer edge
      c.lerp(collarette, 0.35 * (1 - smooth(t * 4)));
      c.lerp(dark, 0.6 * smooth((t - 0.78) / 0.22));
      c.lerp(dark, 0.7 * (1 - smooth(theta / (pupilEdge + 0.04))));
    } else {
      const edge = smooth((theta - 1.1) / 0.7);
      const streak = Math.pow(Math.max(0, Math.sin(phi * 17 + Math.sin(theta * 11) * 4)), 14);
      c.copy(sclera).lerp(vein, streak * edge * 0.45).multiplyScalar(1 - 0.28 * edge);
      c.lerp(dark, 0.45 * (1 - smooth((theta - irisEdge) / 0.07)));
    }
    colors[i * 3] = Math.min(1, c.r);
    colors[i * 3 + 1] = Math.min(1, c.g);
    colors[i * 3 + 2] = Math.min(1, c.b);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32 })));

  // The cornea: a thin transparent dome over the iris that catches the light
  const dome = new THREE.SphereGeometry(radius * 1.03, 32, 20, 0, Math.PI * 2, 0, 0.62);
  dome.rotateX(Math.PI / 2);
  const cornea = new THREE.Mesh(
    dome,
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.14, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false }),
  );
  cornea.renderOrder = 2;
  group.add(cornea);
  return group;
}

export function buildBust(p: Params, base: HeadBase, full = true): THREE.Group {
  const root = new THREE.Group();
  const k = derive(p);

  // The sculpted head reads its colour from per-vertex paint (shading, grime, scars, tunic), so its material is white.
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62 });
  applySkinDetail(skinMaterial, p);
  const iron = new THREE.MeshStandardMaterial({ color: 0x3b3b42, roughness: 0.45, metalness: 0.75, flatShading: true });
  const bone = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.6, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ color: p.eyes });

  const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: Vec3, scale?: Vec3, rotation?: Rot) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    if (rotation) Object.assign(mesh.rotation, rotation);
    parent.add(mesh);
    return mesh;
  };

  const head = new THREE.Group();
  head.position.y = -base.baseY;
  root.add(head);

  const bust = sculptBust(p, base, full);
  const skin = new THREE.Mesh(bust.geometry, skinMaterial);
  head.add(skin);
  skin.updateMatrixWorld(true);

  // Eyes. The base head's eyelids are modelled around an eyeball of this size, so both styles sit
  // snugly in the sockets.
  const pupilTone = new THREE.MeshBasicMaterial({ color: 0x050303, side: THREE.DoubleSide });
  const eyeR = bust.eyes.radius;
  for (const side of [bust.eyes.left, bust.eyes.right]) {
    const eye = new THREE.Group();
    eye.position.set(...side);
    head.add(eye);
    if (p.eyeStyle === "realistic") {
      eye.add(realisticEye(eyeR, p.eyes));
    } else {
      add(eye, new THREE.SphereGeometry(eyeR, 24, 16), glow, [0, 0, 0]);
      add(eye, new THREE.CircleGeometry(eyeR * 0.55, 10), pupilTone, [0, 0, eyeR * 0.98], [0.28, 1, 1]);
    }
  }
  if (p.eyeStyle === "glow") {
    const eyeLight = new THREE.PointLight(p.eyes, 0.04 * Math.PI, 0.9);
    eyeLight.position.set(0, 0, 0.7);
    head.add(eyeLight);
  }

  // Stitches: a dark thread across each scar, with a small knot at either end
  const thread = new THREE.MeshStandardMaterial({ color: 0x0e0b09, roughness: 1 });
  const up = new THREE.Vector3(0, 1, 0);
  for (const stitch of stitchPlacements(p, skin)) {
    const bar = add(head, new THREE.CylinderGeometry(0.006, 0.006, 0.085, 5), thread, [stitch.position.x, stitch.position.y, stitch.position.z]);
    bar.quaternion.setFromUnitVectors(up, stitch.across);
    for (const end of [-1, 1]) {
      const knot = stitch.position.clone().addScaledVector(stitch.across, end * 0.042);
      add(head, new THREE.SphereGeometry(0.013, 6, 5), thread, [knot.x, knot.y, knot.z]);
    }
  }

  // Tusks rise from the lower lip
  if (p.tusks > 0.03) {
    const length = 0.05 + p.tusks * 0.1;
    for (const side of [-1, 1]) {
      const lip = frontPoint(skin, side * 0.1 * k.mouthWidth, -0.4);
      if (!lip) continue;
      const { x, y, z } = lip.position;
      add(head, new THREE.ConeGeometry(0.04, length, 7), bone, [x, y - 0.025 + length / 2, z + 0.01], undefined, { z: side * 0.08 });
    }
  }

  // Horns curve up and outward from the top of the skull
  if (p.horns > 0.03) {
    const scale = 0.5 + p.horns * 1.6;
    for (const side of [-1, 1]) {
      const root3 = topPoint(skin, side * 0.3, -0.3);
      if (!root3) continue;
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(side * 0.12 * scale, 0.08 * scale, 0),
        new THREE.Vector3(side * 0.16 * scale, 0.3 * scale, 0.05 * scale),
      );
      add(head, new THREE.TubeGeometry(curve, 14, 0.03, 6), bone, [root3.position.x, root3.position.y - 0.03, root3.position.z]);
    }
  }

  // Pauldrons: stacked iron plates resting on the shoulders, with a bone spike once they are heavy enough
  if (p.pauldrons > 0.03) {
    for (const side of [-1, 1]) {
      const shoulder = topPoint(skin, side * 0.62, base.neck.z);
      if (!shoulder) continue;
      const { x, y, z } = shoulder.position;
      const r = 0.12 + 0.14 * p.pauldrons;
      add(head, new THREE.CylinderGeometry(r * 0.7, r, 0.08, 8), iron, [x, y + 0.01, z], undefined, { z: -side * 0.35 });
      add(head, new THREE.CylinderGeometry(r * 0.5, r * 0.85, 0.07, 8), iron, [x + side * 0.03, y + 0.08, z], undefined, { z: -side * 0.4 });
      if (p.pauldrons > 0.5) {
        add(head, new THREE.ConeGeometry(0.04, 0.1 + p.pauldrons * 0.3, 5), bone, [x + side * 0.08, y + 0.14 + p.pauldrons * 0.08, z], undefined, { z: -side * 0.6 });
      }
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
