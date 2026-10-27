import * as THREE from "three";
import { shapeGeometry, type Assets } from "./assets";
import { TUSK_X } from "./deform";
import { frontPoint, sculptBust, topPoint } from "./face";
import { buildFineHair } from "./fineHair";
import { buildHair } from "./hair";
import { LANDMARK } from "./headMesh";
import { derive, type Params } from "./params";
import { applySkinDetail } from "./skinShader";

// In Three.js a visible thing is a Mesh: a geometry (the shape) plus a material
// (how light hits it). Meshes are parented into Groups, so the whole bust can
// be rotated, scaled and exported as one object.
//
// The bust's origin is the middle of its plinth: y = 0 is the top of the base, and the sculpted head
// is shifted so the centre of its underside lands on the plinth's centre.

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// The eyeball's radius in each direction, so it fills its socket. The sculpt's lids were made for an eye
// with a bulging cornea, so a plain sphere leaves a gap behind the lids (a dark wedge in profile, and lids
// that look thick and detached). Behind the lids the eye grows to just short of the skin (and shrinks
// wherever skin comes closer), so the lids rest on it all round; in the open part of the eye it is a
// sphere with a corneal bulge, raised to meet the edge of the lids. It never reaches past the skin.
interface EyeFit {
  shape: (direction: THREE.Vector3) => number; // the radius the eye would like
  limit: (direction: THREE.Vector3) => number; // the most it may have without touching skin
}

export function socketFit(positions: Float32Array, centre: THREE.Vector3, radius: number): EyeFit {
  const near: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] - centre.x;
    const y = positions[i + 1] - centre.y;
    const z = positions[i + 2] - centre.z;
    const d = Math.sqrt(x * x + y * y + z * z);
    if (d < 1.8 * radius && d > 1e-6) near.push(x / d, y / d, z / d, d);
  }
  const cone = Math.cos(0.14);
  // The skin straight out in this direction, or the nearest skin anywhere around it (the edge of the lids)
  const skinAlong = (u: THREE.Vector3) => {
    let along = Infinity;
    let edge = Infinity;
    let closest = -1;
    for (let j = 0; j < near.length; j += 4) {
      const dot = near[j] * u.x + near[j + 1] * u.y + near[j + 2] * u.z;
      if (dot > cone) along = Math.min(along, near[j + 3]);
      if (dot > closest) {
        closest = dot;
        edge = near[j + 3];
      }
    }
    return { along, edge };
  };
  return {
    shape(u) {
      const cornea = radius * (1 + 0.24 * Math.max(0, u.z) ** 6);
      const { along, edge } = skinAlong(u);
      if (along === Infinity) return Math.max(cornea, Math.min(1.3 * radius, 0.96 * edge));
      return Math.max(0.8 * radius, Math.min(0.96 * along, Math.max(cornea, 1.4 * radius)));
    },
    limit(u) {
      const { along } = skinAlong(u);
      return along === Infinity ? Infinity : Math.max(0.8 * radius, 0.96 * along);
    },
  };
}

// Reshapes a sphere centred on the origin to the fitted radius: the wanted shape is evened out over the
// surface (so no single skin vertex dents it), then held inside the skin limit
export function fitSphere(geometry: THREE.BufferGeometry, fit: EyeFit, scale = 1): void {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const u = new THREE.Vector3();
  let r = new Float32Array(pos.count);
  const limit = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    u.fromBufferAttribute(pos, i).normalize();
    r[i] = fit.shape(u) * scale;
    limit[i] = fit.limit(u) * scale;
  }
  const index = geometry.index!;
  // A sphere repeats the vertices along its seam and at its poles; they are welded here so the smoothing
  // treats them as one point (smoothed apart, they opened a crease down the eye)
  const same = new Int32Array(pos.count);
  const first = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
    if (!first.has(key)) first.set(key, i);
    same[i] = first.get(key)!;
  }
  const average = (values: Float32Array) => {
    const sum = new Float32Array(pos.count);
    const n = new Float32Array(pos.count);
    for (let t = 0; t < index.count; t++) {
      const a = same[index.getX(t)];
      const b = same[index.getX(t % 3 === 2 ? t - 2 : t + 1)];
      if (a === b) continue;
      sum[a] += values[b];
      n[a]++;
      sum[b] += values[a];
      n[b]++;
    }
    const next = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const j = same[i];
      next[i] = n[j] ? (values[j] + sum[j] / n[j]) / 2 : values[j];
    }
    return next;
  };
  for (let pass = 0; pass < 8; pass++) r = average(r);
  // Held inside the skin, then evened out and held again a few times, so the eye curves smoothly under
  // the lids instead of folding where the limit starts to bite (a crease across the eyeball)
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < pos.count; i++) r[i] = Math.min(r[i], limit[i]);
    if (pass < 5) r = average(r);
  }
  for (let i = 0; i < pos.count; i++) {
    u.fromBufferAttribute(pos, i).normalize().multiplyScalar(r[i]);
    pos.setXYZ(i, u.x, u.y, u.z);
  }
  geometry.computeVertexNormals();
}

// A realistic eyeball: a white sclera with faint veins, an iris with radial fibres and a darker rim
// (the limbal ring), a black pupil, and a clear glossy cornea over the front. It is built facing +z.
function realisticEye(radius: number, irisHex: string, fit: EyeFit): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(radius, 48, 36);
  geometry.rotateX(Math.PI / 2); // spheres have their poles on y; turn one to face the front
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const iris = new THREE.Color(irisHex);
  const sclera = new THREE.Color(0xd9d0c0);
  const vein = new THREE.Color(0xb04a3e);
  const dark = new THREE.Color(0x060403);
  const collarette = new THREE.Color(0xd9b46a);
  const c = new THREE.Color();
  // The iris as an angle from the front: about 11.5 mm across on this 9.4 mm-radius eyeball, as on a real
  // eye. (A smaller iris leaves white showing all round it, and the eye stares.)
  const irisEdge = 0.66;
  const pupilEdge = 0.24;

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
    // The upper lid and lashes shade the top of the eye
    c.multiplyScalar(1 - 0.35 * smooth((y / radius + 0.1) / 0.8));
    colors[i * 3] = Math.min(1, c.r);
    colors[i * 3 + 1] = Math.min(1, c.g);
    colors[i * 3 + 2] = Math.min(1, c.b);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  fitSphere(geometry, fit);
  group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32 })));

  // The cornea: a thin transparent dome over the iris that catches the light
  const dome = new THREE.SphereGeometry(radius * 1.03, 32, 20, 0, Math.PI * 2, 0, 0.78);
  dome.rotateX(Math.PI / 2);
  fitSphere(dome, fit, 1.01);
  const cornea = new THREE.Mesh(
    dome,
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.14, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false }),
  );
  cornea.renderOrder = 2;
  group.add(cornea);
  return group;
}

const UP = new THREE.Vector3(0, 1, 0);

export function buildBust(p: Params, assets: Assets, full = true): THREE.Group {
  const root = new THREE.Group();
  const k = derive(p);
  const base = assets.head;

  // The sculpted head reads its colour from per-vertex paint (shading, grime, tunic), so its material is white.
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62 });
  applySkinDetail(skinMaterial, p);
  const glow = new THREE.MeshBasicMaterial({ color: p.eyes });

  const head = new THREE.Group();
  root.add(head);

  const bust = sculptBust(p, base, full);
  const skin = new THREE.Mesh(bust.geometry, skinMaterial);
  head.add(skin);
  // Surface lookups (horns, tusks) happen in the head's own space, so they use a probe mesh that is not moved
  const probe = new THREE.Mesh(bust.geometry);
  probe.updateMatrixWorld(true);
  // Stand the bust on the plinth, with the middle of its underside over the middle of the base
  head.position.set(-bust.footprint.x, -bust.baseY, -bust.footprint.z);
  head.updateMatrixWorld(true);

  // Eyes, each fitted to its socket (see socketFit), so both styles sit snugly against the lids.
  const pupilTone = new THREE.MeshBasicMaterial({ color: 0x050303, side: THREE.DoubleSide });
  const eyeR = bust.eyes.radius;
  for (const side of [bust.eyes.left, bust.eyes.right]) {
    const eye = new THREE.Group();
    eye.position.set(...side);
    head.add(eye);
    const fit = socketFit(bust.positions, eye.position, eyeR);
    if (p.eyeStyle === "realistic") {
      eye.add(realisticEye(eyeR, p.eyes, fit));
    } else {
      const ball = new THREE.SphereGeometry(eyeR, 24, 16);
      fitSphere(ball, fit);
      eye.add(new THREE.Mesh(ball, glow));
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(eyeR * 0.55, 10), pupilTone);
      pupil.position.z = fit.shape(new THREE.Vector3(0, 0, 1)) * 0.99;
      pupil.scale.set(0.28, 1, 1);
      eye.add(pupil);
    }
  }
  if (p.eyeStyle === "glow") {
    const eyeLight = new THREE.PointLight(p.eyes, 0.04 * Math.PI, 0.9);
    eyeLight.position.set(0, 0, 0.7);
    head.add(eyeLight);
  }

  // Horns: a sculpted shape for the chosen style, grown from each side of the top of the skull and
  // mirrored for the left. The Horn size slider scales the whole horn.
  if (p.hornStyle !== "none") {
    const asset = assets.shapes[p.hornStyle];
    const geometry = shapeGeometry(asset, new THREE.Color(0x4a3a2c), new THREE.Color(0xc9bda0), new THREE.Color(0x2a211a));
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    const size = 0.3 + 0.9 * p.horns;
    for (const side of [-1, 1]) {
      const rootPoint = topPoint(probe, side * 0.3, -0.3);
      if (!rootPoint) continue;
      const horn = new THREE.Mesh(side === 1 ? geometry : geometry.clone(), material);
      horn.scale.set(side * size, size, size);
      // Point it along the surface normal, leaned up and outward, with its base buried in the skull
      const direction = rootPoint.normal.clone().multiplyScalar(0.55).add(new THREE.Vector3(side * 0.3, 0.85, -0.1)).normalize();
      horn.quaternion.setFromUnitVectors(UP, direction);
      horn.position.copy(rootPoint.position).addScaledVector(rootPoint.normal, -0.05 * size);
      head.add(horn);
    }
  }

  // Tusks: only half-orcs have them. Each grows from the lower jaw inside the mouth and comes out
  // between the lips beside the middle of the mouth, leaning forward so it rises in front of the upper lip
  // and a little outward. A third of it (the root and its flared base) stays hidden inside the mouth; the lips are shaped around it in deform.ts (the lower lip swells over it, the upper lip lifts).
  if (k.tusks > 0.03) {
    const geometry = shapeGeometry(assets.shapes.tusk, new THREE.Color(0x6a5230), new THREE.Color(0xe6dcc0), new THREE.Color(0xf4eedc));
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38 });
    // The tusk asset is one unit long. The largest stays small enough for its hidden root to fit behind the
    // lower lip (any bigger and the root shows in front of the chin).
    const size = 0.09 + 0.09 * k.tusks;
    const rootX = TUSK_X * (1 + 0.8 * (k.mouthWidth - 1));
    for (const side of [-1, 1]) {
      const mouth = frontPoint(probe, side * rootX, LANDMARK.stomion);
      const upperLip = frontPoint(probe, side * rootX, LANDMARK.stomion + 0.035);
      if (!mouth || !upperLip) continue;
      // Where it leaves the mouth: on the mouth line, just inside the lips
      const exit = mouth.position.clone().add(new THREE.Vector3(0, 0, -0.015));
      // Aimed to pass just in front of the upper lip, so even a small tusk's tip clears it instead of
      // seeming to pierce it, however full the lips or heavy the jaw
      const clear = upperLip.position.clone().add(new THREE.Vector3(0, 0, 0.008)).sub(exit);
      const lean = Math.min(0.85, Math.max(0.35, clear.z / Math.max(clear.y, 1e-3)));
      const along = new THREE.Vector3(side * 0.12, 1, lean).normalize();
      const tusk = new THREE.Mesh(side === 1 ? geometry : geometry.clone(), material);
      tusk.scale.set(side * size, size, size);
      tusk.quaternion.setFromUnitVectors(UP, along);
      tusk.position.copy(exit).addScaledVector(along, -0.33 * size);
      head.add(tusk);
    }
  }

  // Hair: sculpted clumps combed along the style's flow
  const hairGeometry = buildHair(p, bust.positions, bust.normals, base.neck.z);
  if (hairGeometry) {
    const hair = new THREE.Mesh(hairGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
    hair.userData.strands = true; // the clay view leaves hair out
    head.add(hair);
  }

  // Eyebrows and eyelashes as real strands
  const fineHair = buildFineHair(p, bust.positions, bust.normals, bust.eyes, base);
  if (fineHair) {
    const strands = new THREE.Mesh(fineHair, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
    strands.userData.strands = true;
    head.add(strands);
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
