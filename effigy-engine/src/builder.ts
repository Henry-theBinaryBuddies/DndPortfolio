import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { shapeGeometry, type Assets } from "./assets";
import { bodySurface } from "./bodySurface";
import { buildBrows } from "./brows";
import { buildDragonborn } from "./dragonborn";
import { JAW, turnWithJaw } from "./jaw";
import { frontPoint, sculptBust, topPoint, type Bust } from "./face";
import { buildOutfit, dressedAtAll, type Dressed } from "./garments";
import { buildBeard, buildBeardShell, buildHair, buildHairShell, buildHanging, buildHangingHair } from "./hairShell";
import { LANDMARK } from "./headMesh";
import { buildLockShell, buildLocks } from "./locks";
import { buildThroatGusset } from "./gusset";
import { buildMouthFill, pocketWalls } from "./mouthFill";
import { buildTeeth, lowerCanine } from "./teeth";
import { tuskGeometry } from "./tusk";
import { derive, type Params } from "./params";
import { MM, PEDESTAL_SIDES, pedestalRings } from "./print";

// In Three.js a visible thing is a Mesh: a geometry (the shape) plus a material
// (how light hits it). Meshes are parented into Groups, so the whole bust can
// be rotated, scaled and exported as one object.
//
// The bust's origin is the middle of its plinth: y = 0 is the top of the base, and the sculpted head
// is shifted so the centre of its underside lands on the plinth's centre.
//
// Everything is one plain clay material, the form that prints; the viewer paints it afterwards, part by part
// (see paint.ts), so each mesh is named for what it is.

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
// (`sculpted`: a humanoid's bust already sculpted from these settings, as the page has one to see whether its clothes are
// fitted yet, not sculpted again; a fresh one, as the bust's geometry is its own)
export function buildBust(p: Params, assets: Assets, detail = true, gusset = false, sculpted?: Bust): THREE.Group {
  // (a Dragonborn is a sculpt of its own, with nothing to deform: see dragonborn.ts)
  if (p.family === "dragonborn") {
    if (!assets.dragonborn) throw new Error("the Dragonborn model has not loaded");
    const root = buildDragonborn(assets.dragonborn, p, gusset);
    const outfit = !dressedAtAll(p) ? null : buildOutfit(p, bodySurface(p, assets));
    if (outfit) addGarments(root.children[0] as THREE.Group, outfit, root.userData.flatCut as number);
    return root;
  }
  const root = new THREE.Group();
  const k = derive(p);
  const base = assets.head;

  const head = new THREE.Group();
  root.add(head);

  const bust = sculpted ?? sculptBust(p, base);
  // Clothing, fitted to the body (see garments.ts); the hair and the beard are then built over it
  const outfit = !dressedAtAll(p) ? null : buildOutfit(p, bodySurface(p, assets, bust));
  const worn = outfit?.dressed ?? bust.positions;
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

  // Tusks: only half-orcs have them. Each is a tooth of the lower jaw standing in place of the lower canine: from
  // its root in the gum it runs forward through the parting of the lips, which part around it (see deform.ts),
  // and curves up in front of the upper lip and a little outward (see tusk.ts).
  // It belongs to the lower jaw, so it is placed with the mouth shut (as above) and then turned with the jaw
  // as far as the mouth is open: the tusk rises out of the open mouth instead of staying where the lips were.
  const jawAngle = p.jawOpen * JAW.max;
  if (k.tusks > 0.03) {
    let shut = probe;
    if (jawAngle > 0) {
      shut = new THREE.Mesh(sculptBust({ ...p, jawOpen: 0 }, base).geometry);
      shut.updateMatrixWorld(true);
    }
    const canine = lowerCanine(p);
    // Thicker as the slider rises, and longer above the lip
    const thick = 0.028 + 0.018 * k.tusks;
    const rise = 0.05 + 0.07 * k.tusks;
    for (const side of [-1, 1]) {
      const x = side * canine.x;
      const parting = frontPoint(shut, x, LANDMARK.stomion);
      const upperLip = frontPoint(shut, x, LANDMARK.stomion + 0.035);
      if (!parting || !upperLip) continue;
      // It turns forward inside the lips, out of sight, and leaves the parting at the front of the lips; it passes
      // just in front of the upper lip (drawn back there) and rises from there: up, a little forward and outward
      const exit = parting.position.clone().add(new THREE.Vector3(0, 0.002, -0.012));
      const clear = upperLip.position.clone().add(new THREE.Vector3(side * 0.006, 0, thick * 1.1));
      const up = new THREE.Vector3(side * 0.25, 1, 0.3).normalize();
      const path = [
        // the root, in the gum below the row of teeth, and where it leaves the gum
        new THREE.Vector3(x, canine.gum - 0.04, canine.z - 0.005),
        new THREE.Vector3(x, canine.gum + 0.01, canine.z + 0.005),
        // forward through the parting, below the line of the lips
        new THREE.Vector3(x, LANDMARK.stomion - 0.012, (canine.z + exit.z) / 2 + 0.01),
        exit,
        clear,
        // the tip
        clear.clone().addScaledVector(up, rise),
      ];
      const geometry = tuskGeometry(path, thick, thick * 0.3);
      if (jawAngle > 0) {
        const position = geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
          const [y, z] = turnWithJaw(position.getY(i), position.getZ(i), jawAngle);
          position.setY(i, y);
          position.setZ(i, z);
        }
        geometry.computeVertexNormals();
      }
      const tusk = new THREE.Mesh(geometry, clay);
      tusk.name = "tusk";
      head.add(tusk);
    }
  }

  // Hair: a sculpted shell over the scalp, and, for long hair, a draped curtain for the lengths that hang
  // free; and a beard, sculpted like the hair
  // (over the clothes, if any: `worn` is the body with each garment's outside over what it covers)
  const beard = (detail ? buildBeard : buildBeardShell)(p, worn, bust.normals, base);
  const forms: [string, THREE.BufferGeometry | null][] = [
    ["hair", (detail ? buildHair : buildHairShell)(p, worn, bust.normals, base)],
    ["curtain", detail ? buildHanging(p, worn, base) : buildHangingHair(p, worn, base)],
    ["beard", beard],
    ["locks", (detail ? buildLocks : buildLockShell)(p, worn, bust.normals, base)],
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
  // The hollow behind the lips is filled solid: all of it with the jaw shut, and with it open, all but a shallow
  // recess behind the front teeth (see mouthFill.ts)
  let teethFront: number | undefined;
  if (teeth) {
    const position = teeth.attributes.position;
    for (let i = 0; i < position.count; i++) if (Math.abs(position.getX(i)) < 0.05) teethFront = Math.max(teethFront ?? -Infinity, position.getZ(i));
  }
  const fill = buildMouthFill(bust.positions, bust.normals, p.jawOpen, teethFront, base, frontOutside(bust.positions, base.indices, pocketWalls(base)));
  if (fill) {
    const mesh = new THREE.Mesh(fill, clay);
    mesh.name = "mouthFill";
    head.add(mesh);
    // (if it could not be kept inside the face everywhere, the print says so: see mouthFill.ts)
    if (fill.userData.outside) root.userData.warnings = [`The filling of the mouth could not be kept inside the face everywhere (${fill.userData.outside} places): look under the nose and at the lips before printing.`];
  }
  // Optionally, a wedge under the chin so it needs no supports (see gusset.ts)
  const wedge = gusset ? buildThroatGusset(bust.geometry, bust.positions, bust.normals) : null;
  if (wedge) {
    const mesh = new THREE.Mesh(wedge, clay);
    mesh.name = "gusset";
    head.add(mesh);
  }

  if (outfit) addGarments(head, outfit, cut);

  // Eyebrows, sculpted with carved hair (see brows.ts)
  const brows = buildBrows(p, bust.positions, bust.normals, base);
  if (brows) {
    const mesh = new THREE.Mesh(brows, clay);
    mesh.name = "brows";
    head.add(mesh);
  }

  return root;
}

// The garments as meshes of the head's group, which is the body's frame (see bodySurface.ts), each named for what it
// is, so the paint and the print know it (see parts.ts). (Each its own geometry over the outfit's kept arrays: a
// bust's geometry is let go when the bust is replaced, the outfit is kept for the next.)
function addGarments(head: THREE.Group, outfit: Dressed, cut: number): void {
  const clay = new THREE.MeshStandardMaterial({ color: 0x9c9a96, roughness: 0.75, clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), -cut * MM)] });
  for (const garment of outfit.garments) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(garment.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(garment.indices, 1));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, clay);
    mesh.name = garment.name;
    head.add(mesh);
  }
}

// Whether a point around the mouth is outside the face: on the outer side of the skin nearest it. (Not of the walls of
// the hollow of the mouth, whose outer side is the hollow the filling is to fill: `pocket` marks their vertices.)
// Tested by rays before, a point in the crease between the wing of the nose and the lip read as inside, with the
// pout of the lip in front of it, the nose above and the cheeks either side, and the filling showed there. The
// whole head is searched, as a bounding volume hierarchy built once for its triangles and refitted to each bust's
// shape, which is far quicker than building it again.
const headSearch = new WeakMap<ArrayLike<number>, { geometry: THREE.BufferGeometry; bvh: MeshBVH }>();
function frontOutside(positions: Float32Array, indices: ArrayLike<number>, pocket: Uint8Array): (v: THREE.Vector3) => boolean {
  let search = headSearch.get(indices);
  if (!search) {
    // (over a copy of the triangles: building one reorders them, and the head's own order must stay as it is)
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(positions), 3));
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indices), 1));
    search = { geometry, bvh: new MeshBVH(geometry) };
    headSearch.set(indices, search);
  } else {
    (search.geometry.attributes.position.array as Float32Array).set(positions);
    search.bvh.refit();
  }
  const { bvh, geometry } = search;
  const index = geometry.index!;
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const [a, b, c, normal] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  return (v) => {
    if (!bvh.closestPointToPoint(v, hit)) return false;
    const [i, j, k] = [index.getX(hit.faceIndex * 3), index.getX(hit.faceIndex * 3 + 1), index.getX(hit.faceIndex * 3 + 2)];
    if (pocket[i] && pocket[j] && pocket[k]) return false;
    a.fromArray(positions, i * 3);
    b.fromArray(positions, j * 3);
    c.fromArray(positions, k * 3);
    normal.crossVectors(b.sub(a), c.sub(a));
    return normal.dot(v.clone().sub(hit.point)) > 0;
  };
}

// Geometry and materials live on the GPU, and JavaScript's garbage collector
// cannot free them. Whenever a bust is replaced we release them by hand. (The paint's materials are
// shared by every bust in turn, so they are kept: see paint.ts.)
export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) if (!material.userData.shared) material.dispose();
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
export function pedestalGeometry(reach: ArrayLike<number>, bottom: number, top: number, fixedDisc?: number, unit?: number): THREE.BufferGeometry {
  const rings = pedestalRings(reach, bottom, top, fixedDisc, unit);
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
