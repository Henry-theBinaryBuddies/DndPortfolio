import * as THREE from "three";
import type { Vec3 } from "./headMesh";
import type { Params } from "./params";
import { MM } from "./print";
import { findUnderside, type Underside } from "./underside";
import { siteUrl } from "./site";

// The Dragonborn: not a race of the humanoid head (which cannot be pushed that far) but a family of its own, with its
// own sculpt: a closed-mouthed bust made by tools/sculpt_dragonborn.py (see assets/dragonborn/README.md), loaded only
// when it is first chosen. The humanoid's sliders, hair, beard and horns do not apply to it; its own shape controls
// (the Dragonborn and Horns and spines sliders, and the Torso size it shares) reshape that sculpt as smooth regional
// warps, as the humanoid's sliders warp the human head (see deform.ts). The scales were cut into the sculpt, so they
// move with its surface and stretch a little with it, never cut anew.
//
// The model is in the same head units, origin and axes as the human head (see headMesh.ts), so the camera, the
// pedestal, the tabletop fit, the print and the token all treat it as they treat any bust. Its file says which
// triangles are horn (and spine and crest) and which are eye, so the paint can colour them; which part each vertex
// belongs to, so a control can move one part; and for the paint (see the scales' material in paint.ts), how far each
// vertex lies in a hollow (the grooves between the scales), each scale's own tone, and how pale the underside is.

export const DRAGONBORN_VERSION = 5;

export interface DragonbornManifest {
  name: string;
  version: number;
  vertices: number;
  triangles: number;
  eyes: { centre: Vec3; look: Vec3; radius: number }[];
  chin: number; // the lowest point of the lower jaw, for framing the face
  frame: { headAt: Vec3; headScale: number; units: number }; // head frame = (point - headAt) / (units * headScale)
  jaw: { hinge: Vec3; max: number }; // where the lower jaw turns (head units), and how far it may (radians)
  outgrowths: { part: number; root: Vec3; tip: Vec3 }[]; // each horn, cheek spine and crest spine (see PART)
}

export interface DragonbornAsset {
  manifest: DragonbornManifest;
  positions: Float32Array;
  along: Float32Array; // 0 at the root of a horn or spine, 1 at its tip
  part: Uint8Array; // per vertex: see PART
  jaw: Float32Array; // per vertex: how far it turns with the lower jaw (0..1: the lower jaw, its teeth and the tongue are 1)
  // Which horn or spine (of manifest.outgrowths) each of their vertices belongs to (-1 for the rest), and how far from
  // its root its nearest vertex is (its root is buried in the skin, so its vertices begin some way out)
  outgrowth: Int16Array;
  neighbour: Int16Array; // ...and the next nearest of its kind (where two spines' bases run together, both count)
  starts: Float32Array;
  indices: Uint32Array;
  // The parts, each the triangles of one region: the scales as the head (with its paint per vertex), the horns, spines
  // and crest as horn, and each eye's
  skin: { index: Uint32Array; shade: Float32Array; tone: Float32Array; belly: Float32Array };
  horn: { index: Uint32Array };
  teeth: { index: Uint32Array };
  mouth: { index: Uint32Array }; // the inside of the mouth: palate, floor, gums and tongue
  eyes: { centre: THREE.Vector3; look: THREE.Vector3; vertices: Uint32Array; index: Uint32Array }[];
  // A coarser copy of the skin for clothing to be fitted to (see garments.ts): which of the vertices each of its own is,
  // and its triangles over those
  cover: { vertex: Uint32Array; index: Uint32Array };
  shaped: Map<string, Shaped>; // the last few shapes built (each is a fraction of a second to work out)
}

// The bust in one shape: its vertices, their normals, where it stands, and each eye in a frame of its own facing +z
// (as the eye's paint expects: see paint.ts)
interface Shaped {
  positions: Float32Array;
  normals: Float32Array;
  baseY: number;
  underside: Underside;
  eyes: { centre: THREE.Vector3; positions: Float32Array }[];
}

const REGION = { scales: 0, horn: 1, eye: 2, teeth: 3, mouth: 4 } as const;
export const PART = { scales: 0, horn: 1, spine: 2, crest: 3, eye: 4 } as const;
const FORWARD = new THREE.Vector3(0, 0, 1);
const HORN_AXIS = new THREE.Vector3(1, 0, 0);

export function parseDragonborn(buffer: ArrayBuffer, manifest: DragonbornManifest): DragonbornAsset {
  if (manifest.version !== DRAGONBORN_VERSION) throw new Error(`the Dragonborn model is version ${manifest.version}, not the ${DRAGONBORN_VERSION} this app reads`);
  const [vertices, triangles] = new Uint32Array(buffer, 0, 2);
  if (vertices !== manifest.vertices || triangles !== manifest.triangles) throw new Error("the Dragonborn model does not match its description");
  const coverAt = 8 + vertices * 24 + triangles * 13;
  const [coverVertices, coverTriangles] = buffer.byteLength >= coverAt + 8 ? new Uint32Array(buffer.slice(coverAt, coverAt + 8)) : [0, 0];
  if (buffer.byteLength !== coverAt + 8 + coverVertices * 4 + coverTriangles * 12) throw new Error("the Dragonborn model file is the wrong length");
  let at = 8;
  const take = (bytes: number) => buffer.slice(at, (at += bytes));
  const positions = new Float32Array(take(vertices * 12));
  const shade = new Float32Array(take(vertices * 4));
  const along = new Float32Array(take(vertices * 4));
  const part = new Uint8Array(take(vertices));
  const tone = Float32Array.from(new Uint8Array(take(vertices)), (v) => v / 255);
  const belly = Float32Array.from(new Uint8Array(take(vertices)), (v) => v / 255);
  const jaw = Float32Array.from(new Uint8Array(take(vertices)), (v) => v / 255);
  const indices = new Uint32Array(take(triangles * 12));
  const region = new Uint8Array(take(triangles));
  take(8);
  const cover = { vertex: new Uint32Array(take(coverVertices * 4)), index: new Uint32Array(take(coverTriangles * 12)) };

  const skin: number[] = [];
  const horn: number[] = [];
  const teeth: number[] = [];
  const mouth: number[] = [];
  const eyeTriangles: number[][] = manifest.eyes.map(() => []);
  for (let t = 0; t < triangles; t++) {
    const corners = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
    if (region[t] === REGION.horn) horn.push(...corners);
    else if (region[t] === REGION.teeth) teeth.push(...corners);
    else if (region[t] === REGION.mouth) mouth.push(...corners);
    else if (region[t] === REGION.eye) {
      // (the eye whose centre is nearer)
      const x = positions[corners[0] * 3];
      const nearest = manifest.eyes.reduce((best, eye, e) => (Math.abs(eye.centre[0] - x) < Math.abs(manifest.eyes[best].centre[0] - x) ? e : best), 0);
      eyeTriangles[nearest].push(...corners);
    } else skin.push(...corners);
  }
  const eyes = manifest.eyes.map((eye, e) => {
    // (each eye's own vertices, numbered afresh for its own mesh)
    const remap = new Map<number, number>();
    const index = eyeTriangles[e].map((v) => {
      if (!remap.has(v)) remap.set(v, remap.size);
      return remap.get(v)!;
    });
    return { centre: new THREE.Vector3(...eye.centre), look: new THREE.Vector3(...eye.look).normalize(), vertices: Uint32Array.from(remap.keys()), index: Uint32Array.from(index) };
  });
  // (each horn or spine's vertices are those of its part nearest its root)
  const outgrowth = new Int16Array(vertices).fill(-1);
  const neighbour = new Int16Array(vertices).fill(-1);
  const starts = new Float32Array(manifest.outgrowths.length).fill(Infinity);
  for (let i = 0; i < vertices; i++) {
    if (part[i] !== PART.horn && part[i] !== PART.spine && part[i] !== PART.crest) continue;
    let [best, next] = [Infinity, Infinity];
    manifest.outgrowths.forEach((o, j) => {
      if (o.part !== part[i]) return;
      const d = Math.hypot(positions[i * 3] - o.root[0], positions[i * 3 + 1] - o.root[1], positions[i * 3 + 2] - o.root[2]);
      if (d < best) {
        [next, neighbour[i]] = [best, outgrowth[i]];
        [best, outgrowth[i]] = [d, j];
      } else if (d < next) [next, neighbour[i]] = [d, j];
    });
    starts[outgrowth[i]] = Math.min(starts[outgrowth[i]], best);
  }
  return { manifest, positions, along, part, jaw, outgrowth, neighbour, starts, indices, teeth: { index: Uint32Array.from(teeth) }, mouth: { index: Uint32Array.from(mouth) }, skin: { index: Uint32Array.from(skin), shade, tone, belly }, horn: { index: Uint32Array.from(horn) }, eyes, cover, shaped: new Map() };
}

export async function loadDragonborn(): Promise<DragonbornAsset> {
  const [manifest, buffer] = await Promise.all([
    fetch(siteUrl("models/dragonborn.json")).then((response) => {
      if (!response.ok) throw new Error(`could not load the Dragonborn model's description (${response.status})`);
      return response.json() as Promise<DragonbornManifest>;
    }),
    fetch(siteUrl("models/dragonborn.bin")).then((response) => {
      if (!response.ok) throw new Error(`could not load the Dragonborn model (${response.status})`);
      return response.arrayBuffer();
    }),
  ]);
  return parseDragonborn(buffer, manifest);
}

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Each control's reach (0.5 is the sculpt as made; each slider runs 0..1). The regions are in the head frame of the
// sculpt script (metres, the origin between the eyes), so they line up with the forms named there.
const SHAPE = {
  muzzle: 0.03, // how far the muzzle's tip moves forward or back at either end of the slider
  snout: 0.18, // how much wider or narrower the muzzle gets
  jaw: 0.15, // the lower jaw and jowls, wider or narrower
  brow: 0.012, // how far the brow plates stand out or sink
  horns: [0.7, 1.3], // the horns' size, from the root
  sweep: 0.3, // how far the horns turn back (or forward) about their roots, radians
  spines: [0.75, 1.25], // the cheek spines' and crest's size (short and thick at the root, they fold when halved, and grown much larger two of them run into each other)
  neck: 0.12, // the neck thicker or thinner
};
// The expressions at full strength (head frame, metres): how far a scowl brings the brow plates down, a snarl lifts the
// upper lip, and a smile lifts the corners of the mouth; how far forward the jaw glides as it opens, per radian; and the
// height of the line of the lips
const EXPRESSION = { scowl: 0.008, snarl: 0.009, smile: 0.006 };
const JAW_GLIDE = 0.03; // (more, and the lower lip slid forward under the upper one at the corners of the mouth, and folded)
const LIP = -0.067;
// Where a horn's or spine's resizing begins past the skin, and over what distance it grows to full (head frame, metres)
const OUTGROWTH = { horn: [0.012, 0.06], spine: [0.006, 0.05], seam: 0.03 };
// The neck's axis, and where it runs (head units, the bust's own frame)
// (each fades in over a wide span from the axis outward: a steep fade folds the surface where it changes, as a point
// farther out moves inward past one nearer in)
const NECK = { z: -0.4, top: -0.75, bottom: -1.4, reach: 0.65, fade: 0.3 };
const TORSO = { top: -1.05, rise: 0.6, core: 0.25, fade: 0.6, depth: 0.7 }; // slimmed below the neck, outside a core round its axis

// The key for a shape: every setting that reshapes the Dragonborn
const shapeKey = (p: Params) => [p.dragonMuzzle, p.dragonSnout, p.dragonJaw, p.dragonBrow, p.dragonHorns, p.dragonSweep, p.dragonSpines, p.dragonNeck, p.torso, p.jawOpen, p.snarl, p.scowl, p.smile].join(" ");

export function shapeDragonborn(asset: DragonbornAsset, p: Params): Shaped {
  const key = shapeKey(p);
  const known = asset.shaped.get(key);
  if (known) return known;
  const { headAt, headScale, units } = asset.manifest.frame;
  const k = units * headScale; // head units per metre of the head frame
  const eyes = asset.manifest.eyes.map((e) => new THREE.Vector3(...e.centre));
  const roots = asset.manifest.outgrowths.map((o) => ({ part: o.part, root: new THREE.Vector3(...o.root) }));
  const muzzle = (p.dragonMuzzle - 0.5) * 2 * SHAPE.muzzle;
  const snout = (p.dragonSnout - 0.5) * 2 * SHAPE.snout;
  const jaw = (p.dragonJaw - 0.5) * 2 * SHAPE.jaw;
  const brow = (p.dragonBrow - 0.5) * 2 * SHAPE.brow;
  const hornSize = SHAPE.horns[0] + (SHAPE.horns[1] - SHAPE.horns[0]) * p.dragonHorns;
  const sweep = (p.dragonSweep - 0.5) * 2 * SHAPE.sweep;
  const spineSize = SHAPE.spines[0] + (SHAPE.spines[1] - SHAPE.spines[0]) * p.dragonSpines;
  const neck = 1 + (p.dragonNeck - 0.5) * 2 * SHAPE.neck;
  const opening = p.jawOpen * asset.manifest.jaw.max;
  const hinge = new THREE.Vector3(...asset.manifest.jaw.hinge);
  const turn = new THREE.Quaternion();
  const v = new THREE.Vector3();

  // How the face's controls move a point (in head units), whatever part it is on
  // (`lowerJaw`: how far the point turns with the lower jaw, which the lip's own expressions leave alone)
  const faceShift = (x: number, y: number, z: number, out: THREE.Vector3, lowerJaw = 0) => {
    // (in the head frame of the sculpt)
    const hx = (x - headAt[0]) / k;
    const hy = (y - headAt[1]) / k;
    const hz = (z - headAt[2]) / k;
    const ax = Math.abs(hx);
    let [dx, dy, dz] = [0, 0, 0];
    // Nothing right round the eyes moves, so the lids stay on the eyeballs
    let eyeClear = 1;
    for (const e of eyes) eyeClear = Math.min(eyeClear, smooth((Math.hypot(x - e.x, y - e.y, z - e.z) / k - 0.022) / 0.015));
    // The muzzle: everything in front of the eyes and below the brow moves forward with its tip, the more the nearer
    // the tip (so it stretches rather than slides)
    const front = smooth((hz - 0.03) / 0.09) * smooth((0.08 - hy) / 0.05) * eyeClear;
    dz += muzzle * front;
    // ...and is wider or narrower, the muzzle and the jaw under it
    const band = smooth((hz - 0.02) / 0.08) * smooth((0.035 - hy) / 0.03) * smooth((hy + 0.16) / 0.04) * eyeClear;
    dx += hx * snout * band;
    // The lower jaw and the jowls behind it, broader or narrower (fading out down the throat)
    const lower = smooth((-0.06 - hy) / 0.04) * smooth((hz + 0.14) / 0.05) * smooth((hy + 0.19) / 0.04) * (1 - band);
    dx += hx * jaw * lower;
    // The brow plates stand out (up and forward) or sink
    const plate = Math.exp(-(((ax - 0.043) / 0.035) ** 2) - ((hy - 0.026) / 0.022) ** 2 - ((hz - 0.018) / 0.04) ** 2) * eyeClear;
    dy += 0.45 * brow * plate;
    dz += 0.9 * brow * plate;
    // Expressions (see EXPRESSION). A scowl draws the brow plates down, forward and in toward the nose.
    dy -= EXPRESSION.scowl * p.scowl * plate;
    dz += 0.4 * EXPRESSION.scowl * p.scowl * plate;
    dx -= Math.sign(hx) * 0.5 * EXPRESSION.scowl * p.scowl * plate;
    // A snarl lifts the upper lip along the front of the muzzle and draws it back, baring the teeth, and wrinkles the
    // bridge of the nose
    const upperLip = (1 - lowerJaw) * smooth((hz - 0.02) / 0.05) * Math.exp(-(((hy - LIP) / 0.018) ** 2)) * eyeClear;
    dy += EXPRESSION.snarl * p.snarl * upperLip;
    dz -= 0.35 * EXPRESSION.snarl * p.snarl * upperLip;
    dy += 0.3 * EXPRESSION.snarl * p.snarl * Math.exp(-((hx / 0.03) ** 2) - ((hy - 0.005) / 0.02) ** 2 - ((hz - 0.07) / 0.03) ** 2) * eyeClear;
    // A smile draws the corners of the mouth up and back
    const corners = Math.exp(-(((ax - 0.042) / 0.025) ** 2) - ((hy - LIP) / 0.015) ** 2 - ((hz - 0.015) / 0.03) ** 2) * eyeClear;
    dy += EXPRESSION.smile * p.smile * corners;
    dz -= 0.7 * EXPRESSION.smile * p.smile * corners;
    return out.set(dx * k, dy * k, dz * k);
  };
  // (each horn and spine is reshaped with the face around it, as one smooth warp of everything, so it never parts from
  // the skin it grows from; its root moves as the skin there does)
  const movedRoots = roots.map((r) => r.root.clone().add(faceShift(r.root.x, r.root.y, r.root.z, new THREE.Vector3())));
  const shift = new THREE.Vector3();
  const held = new THREE.Vector3();

  const warp = (x: number, y: number, z: number, part: number, which: number, i: number, out: THREE.Vector3) => {
    out.set(x, y, z);
    if (part === PART.eye) {
      // (the eyeball is held: see eyeClear)
    } else if (part === PART.horn || part === PART.spine || part === PART.crest) {
      // The horns, spines and crest: moved with the face, then larger or smaller from their roots. The change grows
      // with the distance from the root, from a little past where their vertices begin at the skin (not quite the same
      // distance all round a root), so the first of them stay with the skin beside them. (By distance, which changes
      // evenly over the surface: by how far along the horn's path a point is, it changed in small jumps where the path
      // bends, and the surface creased there.)
      out.add(faceShift(x, y, z, shift));
      const [margin, ramp] = part === PART.horn ? OUTGROWTH.horn : OUTGROWTH.spine;
      const grows = (j: number) => smooth((Math.hypot(x - roots[j].root.x, y - roots[j].root.y, z - roots[j].root.z) - asset.starts[j] - margin * k) / (ramp * k));
      let grow = grows(which);
      const root = held.copy(movedRoots[which]);
      // (where two spines' bases run together, a point halfway between their roots is resized about a point halfway
      // between them, so the surface there does not tear between two centres)
      const other = asset.neighbour[i];
      if (other >= 0) {
        const near = Math.hypot(x - roots[which].root.x, y - roots[which].root.y, z - roots[which].root.z);
        const far = Math.hypot(x - roots[other].root.x, y - roots[other].root.y, z - roots[other].root.z);
        const t = 0.5 + 0.5 * smooth((far - near) / (OUTGROWTH.seam * k));
        root.lerpVectors(movedRoots[other], movedRoots[which], t);
        // (and grows only as far as both allow: the same either side of the seam, and still nothing at either root)
        grow = Math.min(grow, grows(other));
      }
      const size = 1 + ((part === PART.horn ? hornSize : spineSize) - 1) * grow;
      v.copy(out).sub(root).multiplyScalar(size);
      // (the horns turn about a line across the head through their roots: back, or forward)
      if (part === PART.horn && sweep !== 0) v.applyQuaternion(turn.setFromAxisAngle(HORN_AXIS, -sweep * grow));
      out.copy(root).add(v);
    } else out.add(faceShift(x, y, z, shift, i >= 0 ? asset.jaw[i] : 0));
    // The lower jaw, its teeth and the tongue turn open about the hinge, gliding a little forward as they do (as the
    // human jaw does: see jaw.ts), each vertex as far as its weight (the corners of the mouth and under the jaw part way)
    const w = i >= 0 ? asset.jaw[i] : 0;
    if (w > 0 && opening > 0) {
      const angle = opening * w;
      const [ry, rz] = [out.y - hinge.y, out.z - hinge.z];
      out.y = hinge.y + ry * Math.cos(angle) - rz * Math.sin(angle);
      out.z = hinge.z + ry * Math.sin(angle) + rz * Math.cos(angle) + JAW_GLIDE * k * angle;
    }
    // The neck, thicker or thinner about its axis, between the jaw and the shoulders
    const r = Math.hypot(out.x, out.z - NECK.z);
    const neckness = smooth((out.y - NECK.bottom) / 0.25) * smooth((NECK.top - out.y) / 0.15) * smooth((NECK.reach - r) / NECK.fade);
    const g = 1 + (neck - 1) * neckness;
    // The torso slimmed below the neck (for a print that must fit a small base: see fit.ts), outside its core
    const torso = (p.torso - 1) * smooth((TORSO.top - out.y) / TORSO.rise) * smooth((r - TORSO.core) / TORSO.fade);
    out.x *= g * (1 + torso);
    out.z = NECK.z + (out.z - NECK.z) * g * (1 + TORSO.depth * torso);
  };

  const n = asset.positions.length / 3;
  const positions = new Float32Array(asset.positions.length);
  const at = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    warp(asset.positions[i * 3], asset.positions[i * 3 + 1], asset.positions[i * 3 + 2], asset.part[i], asset.outgrowth[i], i, at);
    positions[i * 3] = at.x;
    positions[i * 3 + 1] = at.y;
    positions[i * 3 + 2] = at.z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(asset.indices, 1));
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal.array as Float32Array;

  // The underside: the bust is cut flat at its base, and stands centred on the middle of that cut
  let baseY = Infinity;
  for (let i = 1; i < positions.length; i += 3) baseY = Math.min(baseY, positions[i]);
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 1] > baseY + 0.01) continue;
    [x0, x1, z0, z1] = [Math.min(x0, positions[i]), Math.max(x1, positions[i]), Math.min(z0, positions[i + 2]), Math.max(z1, positions[i + 2])];
  }
  const underside = findUnderside(positions, asset.indices, baseY, { x: (x0 + x1) / 2, z: (z0 + z1) / 2 });

  // Each eye in its own frame: its centre moved as the eye's vertices were (a part that no control moves but the neck
  // and torso far below it, so this is where it was), and its vertices about that centre, turned to face +z
  const shapedEyes = asset.eyes.map((eye) => {
    const centre = new THREE.Vector3();
    warp(eye.centre.x, eye.centre.y, eye.centre.z, PART.eye, -1, -1, centre);
    const toLocal = new THREE.Quaternion().setFromUnitVectors(eye.look, FORWARD);
    const local = new Float32Array(eye.vertices.length * 3);
    eye.vertices.forEach((vertex, i) => {
      at.fromArray(positions, vertex * 3).sub(centre).applyQuaternion(toLocal);
      local.set([at.x, at.y, at.z], i * 3);
    });
    return { centre, positions: local };
  });
  const shaped = { positions, normals, baseY, underside, eyes: shapedEyes };
  // (a few kept: a slider dragged back and forth, the draft and the carved build, and the tabletop fit's tries)
  if (asset.shaped.size >= 6) asset.shaped.delete(asset.shaped.keys().next().value!);
  asset.shaped.set(key, shaped);
  return shaped;
}

// The bust, as buildBust makes one (see builder.ts): its parts in a group standing on the plinth's centre, with the
// same measurements for the base, the cut and the framing. Its parts are open pieces of one closed solid (marked
// `joined`), which the print puts back together as one part (see export.ts).
export function buildDragonborn(asset: DragonbornAsset, p: Params, gusset = false): THREE.Group {
  const shape = shapeDragonborn(asset, p);
  const root = new THREE.Group();
  const head = new THREE.Group();
  root.add(head);
  const cut = shape.underside.cut;
  const clay = new THREE.MeshStandardMaterial({ color: 0x9c9a96, roughness: 0.75, clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), -cut * MM)] });
  const position = new THREE.BufferAttribute(shape.positions, 3);
  const normal = new THREE.BufferAttribute(shape.normals, 3);
  const part = (name: string, index: Uint32Array, attributes: Record<string, THREE.BufferAttribute>) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", position);
    geometry.setAttribute("normal", normal);
    for (const [key, attribute] of Object.entries(attributes)) geometry.setAttribute(key, attribute);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = new THREE.Mesh(geometry, clay);
    mesh.name = name;
    mesh.userData.joined = true;
    head.add(mesh);
  };
  // (the scales take a paint of their own, not the human skin's: see paint.ts)
  part("scales", asset.skin.index, { shade: new THREE.BufferAttribute(asset.skin.shade, 1), tone: new THREE.BufferAttribute(asset.skin.tone, 1), belly: new THREE.BufferAttribute(asset.skin.belly, 1) });
  part("horn", asset.horn.index, { along: new THREE.BufferAttribute(asset.along, 1) });
  // (the teeth take the teeth's paint, the inside of the mouth the mouth's: see parts.ts)
  part("dragonTeeth", asset.teeth.index, {});
  part("dragonMouth", asset.mouth.index, {});
  asset.eyes.forEach((eye, e) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(shape.eyes[e].positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(eye.index, 1));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, clay);
    // (not "eye": a humanoid's eyeball is a ball of its own, printed a little larger to join the head, where this one
    // is part of the head's surface already: see export.ts)
    mesh.name = "dragonEye";
    mesh.userData.joined = true;
    mesh.position.copy(shape.eyes[e].centre);
    mesh.quaternion.setFromUnitVectors(FORWARD, eye.look);
    head.add(mesh);
  });
  // Stand the bust on the plinth, with the middle of its underside over the middle of the base
  head.position.set(-shape.underside.footprint.x, -shape.baseY, -shape.underside.footprint.z);
  root.userData.reach = shape.underside.reach;
  root.userData.flatCut = cut;
  root.userData.faceBottom = asset.manifest.chin - shape.baseY;
  if (gusset) root.userData.warnings = ["The Dragonborn has no throat gusset yet: its chin and muzzle will need the slicer's supports."];
  return root;
}
