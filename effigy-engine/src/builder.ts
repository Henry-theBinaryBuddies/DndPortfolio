import * as THREE from "three";
import { shapeGeometry, type Assets } from "./assets";
import { buildBrows } from "./brows";
import { JAW, turnWithJaw } from "./jaw";
import { TUSK_X } from "./deform";
import { frontPoint, sculptBust, topPoint } from "./face";
import { buildBeard, buildBeardShell, buildHair, buildHairShell, buildHanging, buildHangingHair } from "./hairShell";
import { LANDMARK } from "./headMesh";
import { buildLockShell, buildLocks } from "./locks";
import { buildMouthFill } from "./mouthFill";
import { buildTeeth } from "./teeth";
import { derive, type Params } from "./params";
import { MM, PEDESTAL_SIDES, pedestalRings } from "./print";

// In Three.js a visible thing is a Mesh: a geometry (the shape) plus a material
// (how light hits it). Meshes are parented into Groups, so the whole bust can
// be rotated, scaled and exported as one object.
//
// The bust's origin is the middle of its plinth: y = 0 is the top of the base, and the sculpted head
// is shifted so the centre of its underside lands on the plinth's centre.
//
// Everything is one plain clay material: for now the bust is the sculpt alone, the form that prints.

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
  const index = geometry.index!;
  // A sphere repeats the vertices along its seam and at its poles; they are welded here so the smoothing
  // treats them as one point (smoothed apart, they opened a crease down the eye)
  const same = new Int32Array(pos.count);
  const first = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    // (as whole numbers: along the seam a coordinate is about +-1e-16, which as text is "-0.00000" for one copy
    // and "0.00000" for the other, and the two copies were never grouped)
    const key = `${Math.round(pos.getX(i) * 1e5) + 0},${Math.round(pos.getY(i) * 1e5) + 0},${Math.round(pos.getZ(i) * 1e5) + 0}`;
    if (!first.has(key)) first.set(key, i);
    same[i] = first.get(key)!;
  }
  // (what it wants and what it may have are worked out once for each shared point: worked out for each copy,
  // a rounding error could tip two copies of one seam vertex across a threshold, and the seam came apart)
  for (let i = 0; i < pos.count; i++) {
    if (same[i] !== i) continue;
    u.fromBufferAttribute(pos, i).normalize();
    r[i] = fit.shape(u) * scale;
    limit[i] = fit.limit(u) * scale;
  }
  for (let i = 0; i < pos.count; i++) {
    r[i] = r[same[i]];
    limit[i] = limit[same[i]];
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

const UP = new THREE.Vector3(0, 1, 0);

// With detail off the beard is its plain shell, without the carving (about 750,000 triangles, which takes
// a moment to build): that is the quick draft shown while a slider moves.
export function buildBust(p: Params, assets: Assets, detail = true): THREE.Group {
  const root = new THREE.Group();
  const k = derive(p);
  const base = assets.head;

  const head = new THREE.Group();
  root.add(head);

  const bust = sculptBust(p, base);
  // The bust is cut flat a little above its lowest point (see underside.ts): everything below this plane is
  // trimmed off, which leaves a clean flat underside for the pedestal. (The viewer clips it away; the export
  // cuts the solid.)
  const cut = bust.underside.cut;
  const clay = new THREE.MeshStandardMaterial({ color: 0x9c9a96, roughness: 0.75, clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), -cut * MM)] });
  const skin = new THREE.Mesh(bust.geometry, clay);
  skin.name = "head";
  head.add(skin);
  // Surface lookups (horns, tusks) happen in the head's own space, so they use a probe mesh that is not moved
  const probe = new THREE.Mesh(bust.geometry);
  probe.updateMatrixWorld(true);
  // Stand the bust on the plinth, with the middle of its underside over the middle of the base
  head.position.set(-bust.footprint.x, -bust.baseY, -bust.footprint.z);
  head.updateMatrixWorld(true);

  // Eyes, each a ball fitted to its socket (see socketFit), so the lids rest on it
  const eyeR = bust.eyes.radius;
  for (const side of [bust.eyes.left, bust.eyes.right]) {
    const centre = new THREE.Vector3(...side);
    const ball = new THREE.SphereGeometry(eyeR, 48, 36);
    ball.rotateX(Math.PI / 2); // spheres have their poles on y; turn one to face the front
    fitSphere(ball, socketFit(bust.positions, centre, eyeR));
    const eye = new THREE.Mesh(ball, clay);
    eye.name = "eye";
    eye.position.copy(centre);
    head.add(eye);
  }

  // Horns: a sculpted shape for the chosen style, grown from each side of the top of the skull and
  // mirrored for the left. The Horn size slider scales the whole horn.
  if (p.hornStyle !== "none") {
    const geometry = shapeGeometry(assets.shapes[p.hornStyle]);
    const size = 0.3 + 0.9 * p.horns;
    for (const side of [-1, 1]) {
      const rootPoint = topPoint(probe, side * 0.3, -0.3);
      if (!rootPoint) continue;
      const horn = new THREE.Mesh(side === 1 ? geometry : geometry.clone(), clay);
      horn.name = "horn";
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
  // It belongs to the lower jaw, so it is placed with the mouth shut (as above) and then turned with the jaw
  // as far as the mouth is open: the tusk rises out of the open mouth instead of staying where the lips were.
  const jawAngle = p.jawOpen * JAW.max;
  if (k.tusks > 0.03) {
    let shut = probe;
    if (jawAngle > 0) {
      shut = new THREE.Mesh(sculptBust({ ...p, jawOpen: 0 }, base).geometry);
      shut.updateMatrixWorld(true);
    }
    const geometry = shapeGeometry(assets.shapes.tusk);
    // The tusk asset is one unit long. The largest stays small enough for its hidden root to fit behind the
    // lower lip (any bigger and the root shows in front of the chin).
    const size = 0.09 + 0.09 * k.tusks;
    const rootX = TUSK_X * (1 + 0.8 * (k.mouthWidth - 1));
    for (const side of [-1, 1]) {
      const mouth = frontPoint(shut, side * rootX, LANDMARK.stomion);
      const upperLip = frontPoint(shut, side * rootX, LANDMARK.stomion + 0.035);
      if (!mouth || !upperLip) continue;
      // Where it leaves the mouth: on the mouth line, just inside the lips
      const exit = mouth.position.clone().add(new THREE.Vector3(0, 0, -0.015));
      // Aimed to pass just in front of the upper lip, so even a small tusk's tip clears it instead of
      // seeming to pierce it, however full the lips or heavy the jaw
      const clear = upperLip.position.clone().add(new THREE.Vector3(0, 0, 0.008)).sub(exit);
      const lean = Math.min(0.85, Math.max(0.35, clear.z / Math.max(clear.y, 1e-3)));
      const along = new THREE.Vector3(side * 0.12, 1, lean).normalize();
      const tusk = new THREE.Mesh(side === 1 ? geometry : geometry.clone(), clay);
      tusk.name = "tusk";
      tusk.scale.set(side * size, size, size);
      tusk.quaternion.setFromUnitVectors(UP, along);
      tusk.position.copy(exit).addScaledVector(along, -0.33 * size);
      if (jawAngle > 0) {
        const [y, z] = turnWithJaw(tusk.position.y, tusk.position.z, jawAngle);
        tusk.position.set(tusk.position.x, y, z);
        tusk.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), jawAngle));
      }
      head.add(tusk);
    }
  }

  // Hair: a sculpted shell over the scalp, and, for long hair, a draped curtain for the lengths that hang
  // free; and a beard, sculpted like the hair
  const beard = (detail ? buildBeard : buildBeardShell)(p, bust.positions, bust.normals, base);
  const forms: [string, THREE.BufferGeometry | null][] = [
    ["hair", (detail ? buildHair : buildHairShell)(p, bust.positions, bust.normals, base)],
    ["curtain", detail ? buildHanging(p, bust.positions, base) : buildHangingHair(p, bust.positions, base)],
    ["beard", beard],
    ["locks", (detail ? buildLocks : buildLockShell)(p, bust.positions, bust.normals, base)],
  ];
  for (const [name, form] of forms) {
    if (!form) continue;
    const mesh = new THREE.Mesh(form, clay);
    mesh.name = name;
    head.add(mesh);
  }

  // Where the bust stands, and how far down its face reaches, for the base and for framing the face: the
  // outline of the cut (relative to the middle of the plinth), and the lowest point of the chin or the
  // beard (in the plinth's coordinates: y = 0 is the top of the base)
  root.userData.reach = bust.underside.reach;
  root.userData.flatCut = cut;
  let faceBottom = Infinity;
  for (let i = 0; i < bust.positions.length; i += 3) {
    if (bust.positions[i + 1] > -0.8 && bust.positions[i + 2] > -0.05) faceBottom = Math.min(faceBottom, bust.positions[i + 1]);
  }
  if (beard) for (let i = 0; i < beard.attributes.position.count; i++) faceBottom = Math.min(faceBottom, beard.attributes.position.getY(i));
  root.userData.faceBottom = faceBottom - bust.baseY;
  // Teeth, once the mouth is open enough to show them (see teeth.ts)
  const teeth = buildTeeth(p);
  if (teeth) {
    const mesh = new THREE.Mesh(teeth, clay);
    mesh.name = "teeth";
    head.add(mesh);
  }
  // With the jaw shut, the hollow behind the lips is filled solid (see mouthFill.ts)
  const fill = buildMouthFill(bust.positions, bust.normals, p.jawOpen);
  if (fill) {
    const mesh = new THREE.Mesh(fill, clay);
    mesh.name = "mouthFill";
    head.add(mesh);
  }

  // Eyebrows, sculpted with carved hair (see brows.ts)
  const brows = buildBrows(p, bust.positions, bust.normals, base);
  if (brows) {
    const mesh = new THREE.Mesh(brows, clay);
    mesh.name = "brows";
    head.add(mesh);
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

// The base as a closed prism: the outline (convex, counter-clockwise, as (x, z)) from `bottom` up to `top`
export function basePrism(outline: [number, number][], bottom: number, top: number): THREE.BufferGeometry {
  const n = outline.length;
  const positions: number[] = [];
  for (const y of [bottom, top]) for (const [x, z] of outline) positions.push(x, y, z);
  const index: number[] = [];
  // The sides: counter-clockwise seen from above (x to the right, z toward the viewer), so outward is to the
  // right of the direction of travel
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    index.push(i, n + j, n + i, i, j, n + j);
  }
  // The caps, as fans (the outline is convex), each winding the opposite way along the rim from the side
  // that meets it, as a closed surface needs
  for (let i = 1; i < n - 1; i++) {
    index.push(n, n + i, n + i + 1);
    index.push(0, i + 1, i);
  }
  // (wound outward whichever way round the outline runs)
  let volume = 0;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
    volume += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  if (volume < 0) for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

// The pedestal as a closed solid (see pedestalRings), from `bottom` up to `top`: a round disc and a waisted stem
// flaring out to the outline of the bust at its cut
export function pedestalGeometry(reach: ArrayLike<number>, bottom: number, top: number): THREE.BufferGeometry {
  const rings = pedestalRings(reach, bottom, top);
  const n = PEDESTAL_SIDES;
  const positions: number[] = rings.flat();
  const index: number[] = [];
  for (let r = 0; r + 1 < rings.length; r++) {
    const low = r * n;
    const high = (r + 1) * n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      index.push(low + i, high + j, high + i, low + i, low + j, high + j);
    }
  }
  const lastRing = (rings.length - 1) * n;
  const foot = positions.length / 3;
  positions.push(0, bottom, 0, 0, top, 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    index.push(foot, j, i); // the underside
    index.push(foot + 1, lastRing + i, lastRing + j); // the top
  }
  // (wound outward whichever way round the rings run)
  let volume = 0;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
    volume += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  if (volume < 0) for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
