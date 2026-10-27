import * as THREE from "three";
import { deformHead, type Deformed } from "./deform";
import { LANDMARK, type HeadBase } from "./headMesh";
import { derive, type Params } from "./params";

// Turns the deformed base head into a painted mesh. Shading comes from cavity: wherever a vertex sits
// below the average of its neighbours (a socket, a crease, the corner of the mouth) it is darkened, and
// raised ridges are left light. Grime, scars, brows, lips, age lines, scales and a tunic go on top as
// vertex colours, placed using the landmarks measured on the real head.

export interface Bust {
  geometry: THREE.BufferGeometry;
  eyes: Deformed["eyes"];
}

type Vec2 = [number, number];

// Scars run down the face as lines in the front view (x, y), so they hug whatever surface lies under
// them. More appear as the slider rises.
const SCARS: { from: Vec2; to: Vec2; starts: number }[] = [
  { from: [0.31, 0.3], to: [0.27, -0.32], starts: 0.03 }, // temple to cheek, beside the right eye
  { from: [-0.37, 0.02], to: [-0.2, -0.32], starts: 0.25 }, // left cheek
  { from: [0.06, -0.3], to: [0.12, -0.55], starts: 0.5 }, // through the lip and chin
];
const SCAR_WIDTH = 0.028;
export const MAX_STITCHES_PER_SCAR = 8;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Repeatable pseudo-random value in [0, 1) for a lattice point, smoothed into 3D value noise below.
const hash3 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const w = smooth(z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const at = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v),
    lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v),
    w,
  );
}

// A 3D gaussian blob weight: 1 at the centre, fading to 0 by roughly one `s` away on each axis.
const gauss = (dx: number, sx: number, dy: number, sy: number, dz: number, sz: number) =>
  Math.exp(-((dx / sx) ** 2 + (dy / sy) ** 2 + (dz / sz) ** 2));

// Distance from a point to a line segment, in the front view
function distanceToSegment2(px: number, py: number, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const t = Math.min(1, Math.max(0, ((px - a[0]) * abx + (py - a[1]) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - a[0] - abx * t, py - a[1] - aby * t);
}

const scarStrengths = (p: Params) => SCARS.map((s) => smooth((p.scars - s.starts) * 3));

// How far each vertex sits inside the average of its neighbours, along its normal. Positive means a
// hollow (darken it); negative means a ridge. Averaging over several passes makes it a measure of the
// local shape at the scale of a lip or a socket, not of vertex-to-vertex noise.
function cavity(base: HeadBase, positions: Float32Array, normals: Float32Array): Float32Array {
  const count = positions.length / 3;
  let a = new Float32Array(positions);
  let b = new Float32Array(positions.length);
  for (let pass = 0; pass < 20; pass++) {
    for (let i = 0; i < count; i++) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      const from = base.offsets[i];
      const to = base.offsets[i + 1];
      for (let j = from; j < to; j++) {
        const n = base.neighbours[j] * 3;
        sx += a[n];
        sy += a[n + 1];
        sz += a[n + 2];
      }
      const c = to - from;
      b[i * 3] = sx / c;
      b[i * 3 + 1] = sy / c;
      b[i * 3 + 2] = sz / c;
    }
    [a, b] = [b, a];
  }
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = (a[i * 3] - positions[i * 3]) * normals[i * 3] + (a[i * 3 + 1] - positions[i * 3 + 1]) * normals[i * 3 + 1] + (a[i * 3 + 2] - positions[i * 3 + 2]) * normals[i * 3 + 2];
  }
  return out;
}

// With `full` off, only the skin tone and shading are painted. That is enough to keep a slider drag
// responsive; the full paint (brows, lips, age lines, grime, scars, tunic) follows once it is still.
export function sculptBust(p: Params, base: HeadBase, full = true): Bust {
  const deformed = deformHead(base, p);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(deformed.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(base.indices, 1));
  geometry.computeVertexNormals();
  const normals = (geometry.attributes.normal as THREE.BufferAttribute).array as Float32Array;
  const positions = deformed.positions;
  const count = positions.length / 3;

  const k = derive(p);
  const hollows = cavity(base, positions, normals);

  const skin = new THREE.Color(p.skin);
  const clothTone = new THREE.Color(p.cloth);
  const trimTone = clothTone.clone().multiplyScalar(0.35);
  const scarTone = skin.clone().lerp(new THREE.Color(0x7a2a26), 0.6);
  const grimeTone = new THREE.Color(0x15110c);
  const rimTone = skin.clone().lerp(new THREE.Color(0xe6d2c4), 0.55);
  const browTone = new THREE.Color(p.hairColor);
  const lipTone = skin.clone().lerp(new THREE.Color(0xa04650), 0.5);
  const blushTone = skin.clone().lerp(new THREE.Color(0xa0473c), 0.35);
  const strengths = scarStrengths(p);
  const { eyeX, stomion } = LANDMARK;

  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  const tunic = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const nz = normals[i * 3 + 2];
    const ax = Math.abs(x);
    const front = smooth((nz + 0.15) / 0.5); // 1 on skin that faces the viewer
    const head = smooth((y + 0.78) / 0.15); // 1 on the head, fading out down the neck

    // Shading: hollows darken, ridges catch a little extra light
    const shade = Math.min(1, Math.max(-0.4, hollows[i] * 55));
    color.copy(skin).multiplyScalar(1 - 0.7 * Math.max(0, shade) + 0.2 * Math.max(0, -shade));
    if (!full) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      continue;
    }

    // Light flush on the cheeks and nose, a little less when the skin is filthy
    const blush = Math.max(gauss(ax - 0.27, 0.13, y + 0.12, 0.1, z - 0.12, 0.2), gauss(x, 0.07, y + 0.17, 0.08, z - 0.2, 0.15)) * head * front;
    const earFlush = gauss(ax - 0.45, 0.07, y + 0.05, 0.16, z + 0.45, 0.2) * head;
    color.lerp(blushTone, Math.max(blush * 0.35, earFlush * 0.4) * (1 - p.grime * 0.6));

    // Eyebrows, eye bags, and the creases from nose to mouth
    let brow = 0;
    let bags = 0;
    let lines = 0;
    let creaseLid = 0;
    for (const sign of [-1, 1]) {
      brow = Math.max(brow, gauss(x - sign * (eyeX + 0.02), 0.17, y - 0.16, 0.03 + 0.035 * p.eyebrows, z - 0.17, 0.2));
      bags = Math.max(bags, gauss(x - sign * eyeX, 0.13, y + 0.1, 0.035, z - 0.1, 0.18));
      const fold = distanceToSegment2(x, y, [sign * 0.09, -0.25], [sign * 0.14, -0.37]);
      lines = Math.max(lines, Math.exp(-((fold / 0.025) ** 2)));
      // The crease of the upper eyelid
      creaseLid = Math.max(creaseLid, gauss(x - sign * eyeX, 0.1, y - 0.058, 0.008, z - 0.07, 0.2));
    }
    color.lerp(browTone, brow * Math.min(1, p.eyebrows * 2.2) * head * front);
    color.multiplyScalar(1 - 0.35 * bags * (0.3 + p.age) * head * front);
    color.multiplyScalar(1 - 0.4 * lines * (0.35 + p.age) * head * front);
    color.multiplyScalar(1 - 0.28 * creaseLid * head * front);
    for (const band of [0.28, 0.36, 0.44]) {
      const crease = Math.exp(-(((y - band) / 0.016) ** 2)) * (1 - smooth((ax - 0.35) / 0.12));
      color.multiplyScalar(1 - 0.22 * crease * p.age * head * front * smooth((noise3(x * 5 + band * 10, band * 7, 1) - 0.35) * 3));
    }

    // Lips and the mouth line
    // The lips have a crisp edge (the vermilion border) with a slightly darker, more saturated rim
    const lipHalf = 0.062 * (1 + (k.lipFull - 1) * 0.28);
    const lipBand = smooth((y - (stomion - lipHalf)) / 0.01) * (1 - smooth((y - (stomion + lipHalf)) / 0.01)) * (1 - smooth((ax - 0.125 * k.mouthWidth) / 0.02));
    const rimOffset = (Math.abs(y - stomion) - lipHalf) / 0.01;
    const lipRim = Math.exp(-(rimOffset * rimOffset)) * (1 - smooth((ax - 0.125 * k.mouthWidth) / 0.02));
    color.lerp(lipTone, lipBand * 0.9 * head * front);
    color.multiplyScalar(1 - 0.1 * lipRim * head * front);
    const mouthLine = gauss(x, 0.13 * k.mouthWidth, y - stomion, 0.007, z - 0.16, 0.2) * head * front;
    color.lerp(grimeTone, mouthLine * 0.7);

    // Dragonborn scales: diamond cells with dark seams
    if (k.scales > 0.02) {
      const g1 = Math.sin((x + y * 0.5) * 38);
      const g2 = Math.sin((x - y * 0.5) * 38);
      const seam = 1 - smooth(Math.abs(g1 * g2) / 0.22);
      color.multiplyScalar(1 - 0.5 * seam * k.scales * head * front);
      color.multiplyScalar(1 + 0.12 * k.scales * head * (noise3(x * 24, y * 24, z * 24) - 0.5));
    }

    // Grime blotches, heavier in recesses
    const n = noise3(x * 3 + 5, y * 3, z * 3) * 0.6 + noise3(x * 9, y * 9 + 3, z * 9) * 0.4;
    const grime = smooth((n - 0.38) / 0.28) * p.grime * 0.8 + Math.max(0, shade) * p.grime * 0.35;
    color.lerp(grimeTone, Math.min(0.9, grime) * (0.4 + 0.6 * head));

    // Scars: a dark-red core with paler raised edges
    let scarMix = 0;
    let scarRim = 0;
    for (let s = 0; s < SCARS.length; s++) {
      if (strengths[s] <= 0) continue;
      const d = distanceToSegment2(x, y, SCARS[s].from, SCARS[s].to);
      scarMix = Math.max(scarMix, Math.exp(-((d / SCAR_WIDTH) ** 2)) * strengths[s]);
      scarRim = Math.max(scarRim, Math.exp(-(((d - SCAR_WIDTH * 1.15) / (SCAR_WIDTH * 0.6)) ** 2)) * strengths[s]);
    }
    color.lerp(rimTone, scarRim * 0.85 * head * front);
    color.lerp(scarTone, scarMix * head * front);

    // Tunic: everything below a V-shaped neckline is cloth, with a dark trim along the edge
    const neckline = -0.95 - 0.22 * (1 - smooth(ax / 0.24)) * smooth(nz * 3 + 0.5);
    const cloth = smooth((neckline - y) / 0.06);
    if (cloth > 0) {
      const weave = 0.9 + 0.2 * noise3(x * 50, y * 50, z * 50);
      tunic.copy(clothTone).multiplyScalar(weave * (1 - 0.5 * Math.max(0, shade)));
      color.lerp(tunic, cloth);
      color.lerp(trimTone, Math.exp(-(((y - neckline) / 0.03) ** 2)) * 0.8 * cloth);
    }

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return { geometry, eyes: deformed.eyes };
}

export interface SurfaceHit {
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

const caster = new THREE.Raycaster();

// Finds where the surface is along a ray, for seating tusks, stitches, horns and armour on the skin.
export function castRay(mesh: THREE.Mesh, origin: THREE.Vector3, direction: THREE.Vector3): SurfaceHit | null {
  caster.set(origin, direction.clone().normalize());
  const hit = caster.intersectObject(mesh, false)[0];
  if (!hit || !hit.face) return null;
  return { position: hit.point.clone(), normal: hit.face.normal.clone() };
}

// Looking at the face from the front: the skin surface under the point (x, y)
export function frontPoint(mesh: THREE.Mesh, x: number, y: number): SurfaceHit | null {
  return castRay(mesh, new THREE.Vector3(x, y, 4), new THREE.Vector3(0, 0, -1));
}

// Looking down from above: the skin surface under the point (x, z), for the top of the skull and shoulders
export function topPoint(mesh: THREE.Mesh, x: number, z: number): SurfaceHit | null {
  return castRay(mesh, new THREE.Vector3(x, 4, z), new THREE.Vector3(0, -1, 0));
}

export interface Stitch {
  position: THREE.Vector3;
  across: THREE.Vector3; // unit vector pointing across the scar, along the thread
}

// Cross-stitches spaced along every visible scar. The stitches slider sets how many per scar.
export function stitchPlacements(p: Params, mesh: THREE.Mesh): Stitch[] {
  const count = Math.round(p.stitches * MAX_STITCHES_PER_SCAR);
  if (count === 0) return [];
  const out: Stitch[] = [];
  const strengths = scarStrengths(p);

  SCARS.forEach((scar, s) => {
    if (strengths[s] < 0.3) return;
    for (let t = 0; t < count; t++) {
      const f = 0.07 + 0.86 * ((t + 0.5) / count);
      const x = scar.from[0] + (scar.to[0] - scar.from[0]) * f;
      const y = scar.from[1] + (scar.to[1] - scar.from[1]) * f;
      const hit = frontPoint(mesh, x, y);
      if (!hit) continue;
      const along = new THREE.Vector3(scar.to[0] - scar.from[0], scar.to[1] - scar.from[1], 0);
      along.addScaledVector(hit.normal, -along.dot(hit.normal)).normalize();
      const across = new THREE.Vector3().crossVectors(hit.normal, along).normalize();
      out.push({ position: hit.position.addScaledVector(hit.normal, 0.004), across });
    }
  });
  return out;
}
