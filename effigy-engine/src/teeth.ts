import * as THREE from "three";
import { JAW, turnWithJaw } from "./jaw";
import { derive, type Params } from "./params";
import { MM } from "./print";

// Teeth: an upper and a lower row in the mouth's cavity, each a few rounded teeth standing in a gum that
// fills the space between them and the wall of the cavity. At print scale (a head is about 30 mm) an incisor
// is about 1.3 mm wide, so the teeth are plain rounded blocks with a groove between each pair, not
// individually modelled. They are placed on the undeformed head, along the arch of the cavity's front wall
// (measured on the head: its inner surface behind the lips is z = 0.085 - 4.8 x^2 at the mouth line, then
// straight back from about 0.12 either side), carried by the skull's scaling, and the lower row turns with
// the jaw (see jaw.ts).
//
// Each tooth and each gum is a closed solid, as the hair's locks are; they overlap the head and each other,
// to be merged into one solid when the bust is exported.

const UPPER_EDGE = -0.395; // the cutting edge of the upper teeth: a little below the line of the lips (-0.363), as in a real mouth
const LOWER_TOP = -0.352; // the top of the lower teeth: above the line of the lips, so they show over the lower lip when the mouth is open
const ARCH_Z = (x: number) => 0.075 - 4.8 * x * x;
const ARCH_SLOPE = (x: number) => -9.6 * x;

// Widths of the teeth from the middle of the face outward: the central and lateral incisors, the canine and
// the first premolar (head units: about 8.5, 6.5, 7.5 and 7 mm of a real mouth, with a head 20 cm)
const WIDTHS = [0.042, 0.034, 0.038, 0.036];
const THICKNESS = 0.03;
const CROWN = 0.052; // a crown's height

export const TEETH = {
  minWidth: 1.0 * MM, // no tooth narrower than this at print scale
};

// Turns a solid inside out if its triangles wind the wrong way (a negative volume), so each is outward whatever
// the handedness of the frame it was built in
function outward(into: { positions: number[]; index: number[] }, from: number) {
  let volume = 0;
  const p = into.positions;
  for (let t = from; t < into.index.length; t += 3) {
    const a = into.index[t] * 3;
    const b = into.index[t + 1] * 3;
    const c = into.index[t + 2] * 3;
    volume +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  if (volume >= 0) return;
  for (let t = from; t < into.index.length; t += 3) [into.index[t + 1], into.index[t + 2]] = [into.index[t + 2], into.index[t + 1]];
}

// A closed rounded block: a sphere subdivided from an octahedron (so its vertices are shared and it is
// closed), squared off toward a box
function roundedBlock(into: { positions: number[]; index: number[] }, centre: THREE.Vector3, tangent: THREE.Vector3, up: THREE.Vector3, normal: THREE.Vector3, radii: [number, number, number], squareness = 3) {
  const vertices: THREE.Vector3[] = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ];
  let faces = [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ];
  for (let level = 0; level < 3; level++) {
    const middle = new Map<number, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let m = middle.get(key);
      if (m === undefined) {
        m = vertices.length;
        vertices.push(vertices[a].clone().add(vertices[b]).normalize());
        middle.set(key, m);
      }
      return m;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    faces = next;
  }
  const first = into.positions.length / 3;
  const e = 2 / squareness;
  for (const v of vertices) {
    const sq = (t: number) => Math.sign(t) * Math.abs(t) ** e;
    const u = sq(v.x) * radii[0];
    const h = sq(v.y) * radii[1];
    const t = sq(v.z) * radii[2];
    into.positions.push(
      centre.x + tangent.x * u + up.x * h + normal.x * t,
      centre.y + tangent.y * u + up.y * h + normal.y * t,
      centre.z + tangent.z * u + up.z * h + normal.z * t,
    );
  }
  const from = into.index.length;
  for (const [a, b, c] of faces) into.index.push(first + a, first + b, first + c);
  outward(into, from);
}

// A closed gum: a loft of an ellipse along the arch, capped at both ends
function gumLoft(into: { positions: number[]; index: number[] }, samples: { x: number; z: number; nx: number; nz: number }[], y: number, radiusFront: number, radiusUp: number, sides = 12) {
  const first = into.positions.length / 3;
  const from = into.index.length;
  for (const s of samples) {
    for (let j = 0; j < sides; j++) {
      const a = (2 * Math.PI * j) / sides;
      const f = radiusFront * Math.cos(a);
      into.positions.push(s.x + s.nx * f, y + radiusUp * Math.sin(a), s.z + s.nz * f);
    }
  }
  for (let i = 0; i < samples.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = first + i * sides + j;
      const b = first + i * sides + ((j + 1) % sides);
      into.index.push(a, c(a, sides), b, b, c(a, sides), c(b, sides));
    }
  }
  for (const [ring, flip] of [
    [0, true],
    [samples.length - 1, false],
  ] as const) {
    const m = into.positions.length / 3;
    const s = samples[ring];
    into.positions.push(s.x, y, s.z);
    for (let j = 0; j < sides; j++) {
      const a = first + ring * sides + j;
      const b = first + ring * sides + ((j + 1) % sides);
      if (flip) into.index.push(m, a, b);
      else into.index.push(m, b, a);
    }
  }
  outward(into, from);
}
const c = (v: number, sides: number) => v + sides;

// Points along the arch of the front teeth, by distance round it from the middle
function archAt(distance: number): { x: number; z: number; tx: number; tz: number; nx: number; nz: number } {
  let remaining = Math.abs(distance);
  let x = 0;
  const step = 0.0005;
  while (remaining > 0) {
    const slope = ARCH_SLOPE(x);
    remaining -= step * Math.hypot(1, slope);
    x += step;
  }
  const slope = ARCH_SLOPE(x);
  const length = Math.hypot(1, slope);
  const side = Math.sign(distance) || 1;
  return { x: side * x, z: ARCH_Z(x), tx: (side * 1) / length, tz: (side * slope * side) / length, nx: (-slope * side) / length, nz: 1 / length };
}

// Both rows as one geometry of closed solids, in the bust's own coordinates: carried by the skull's scaling,
// and the lower row turned with the jaw as far as it is open. Null when the mouth is shut (nothing shows).
export function buildTeeth(p: Params): THREE.BufferGeometry | null {
  if (p.jawOpen < 0.02 && p.snarl < 0.05 && p.smile < 0.3) return null;
  const k = derive(p);
  const into = { positions: [] as number[], index: [] as number[] };
  const scale = 0.92 + 0.25 * k.angularity; // broader teeth on a heavier face
  const jawAngle = p.jawOpen * JAW.max;

  for (const lower of [false, true]) {
    const first = into.positions.length / 3;
    const crown = CROWN * (lower ? 0.9 : 1);
    const crownCentre = lower ? LOWER_TOP - crown / 2 : UPPER_EDGE + crown / 2;
    const arch: { x: number; z: number; nx: number; nz: number }[] = [];
    let distance = 0;
    const centres: number[] = [];
    for (const w of WIDTHS) {
      centres.push(distance + (w * scale) / 2);
      distance += w * scale;
    }
    for (const side of [-1, 1]) {
      WIDTHS.forEach((w, i) => {
        const at = archAt(side * centres[i]);
        const tangent = new THREE.Vector3(at.tx, 0, at.tz).normalize();
        const normal = new THREE.Vector3(at.nx, 0, at.nz).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const centre = new THREE.Vector3(at.x, crownCentre, at.z + 0.006);
        // (a little taller at the middle, and the lower row's front teeth a little shorter and narrower)
        const lift = i === 0 ? 1.08 : i === 1 ? 0.96 : 1;
        roundedBlock(into, centre, tangent, up, normal, [(w * scale * (lower ? 0.92 : 1)) / 2 + 0.002, (crown * lift) / 2, THICKNESS / 2], 3.2);
      });
    }
    // The gum, along the whole arch: above the upper teeth to the roof of the mouth, below the lower to the floor
    const reach = centres[WIDTHS.length - 1] + (WIDTHS[WIDTHS.length - 1] * scale) / 2;
    // (not quite as far as the last tooth, or its end came out through the cheek beside the nose)
    for (let d = -reach * 0.86; d <= reach * 0.86 + 1e-9; d += (reach * 0.86) / 12) {
      const at = archAt(d);
      arch.push({ x: at.x, z: at.z + 0.002, nx: at.nx, nz: at.nz });
    }
    // (the lower gum is drawn back and slimmer, or it came out through the chin of a face with a small chin)
    if (lower) gumLoft(into, arch.map((a) => ({ ...a, z: a.z - 0.026 })), LOWER_TOP - crown - 0.04, 0.02, 0.046);
    else gumLoft(into, arch, UPPER_EDGE + crown + 0.04, 0.028, 0.046);

    // Into the bust's coordinates: the skull's scaling, and for the lower row the jaw's turn
    for (let v = first; v < into.positions.length / 3; v++) {
      let x = into.positions[v * 3];
      let y = into.positions[v * 3 + 1];
      let z = into.positions[v * 3 + 2];
      x *= k.headWidth;
      y += (k.headHeight - 1) * (y + 0.59);
      if (lower && jawAngle > 0) [y, z] = turnWithJaw(y, z, jawAngle);
      into.positions[v * 3] = x;
      into.positions[v * 3 + 1] = y;
      into.positions[v * 3 + 2] = z;
    }
  }
  // The tongue, lying on the floor of the mouth and going with the jaw: a rounded body from just behind the
  // lower teeth back toward the throat
  if (p.jawOpen >= 0.02) {
    const first = into.positions.length / 3;
    const tongue = new THREE.Vector3(0, -0.438, -0.075);
    roundedBlock(into, tongue, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), [0.075 * k.headWidth, 0.04, 0.15], 2.2);
    for (let v = first; v < into.positions.length / 3; v++) {
      let y = into.positions[v * 3 + 1];
      let z = into.positions[v * 3 + 2];
      y += (k.headHeight - 1) * (y + 0.59);
      if (jawAngle > 0) [y, z] = turnWithJaw(y, z, 0.8 * jawAngle);
      into.positions[v * 3 + 1] = y;
      into.positions[v * 3 + 2] = z;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(into.positions, 3));
  geometry.setIndex(into.index);
  geometry.computeVertexNormals();
  return geometry;
}
