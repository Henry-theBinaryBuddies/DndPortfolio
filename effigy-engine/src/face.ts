import * as THREE from "three";
import { deformHead, type Deformed } from "./deform";
import { shavedWeight } from "./hair";
import { LANDMARK, type HeadBase } from "./headMesh";
import type { Params } from "./params";

// Turns the deformed base head into a painted mesh. Shading comes from cavity: wherever a vertex sits
// below the average of its neighbours (a socket, a crease, the corner of the mouth) it is darkened, and
// raised ridges are left light. Grime, scars, brows, lips, age lines, scales and a tunic go on top as
// vertex colours, placed using the landmarks measured on the real head.

export interface Bust {
  geometry: THREE.BufferGeometry;
  eyes: Deformed["eyes"];
  positions: Float32Array; // the deformed vertices, for fitting hair and attachments
  normals: Float32Array;
  footprint: { x: number; z: number }; // the centre of the underside, so the bust can sit centred on its plinth
  baseY: number;
}

type Vec2 = [number, number];

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

  const hollows = cavity(base, positions, normals);

  const skin = new THREE.Color(p.skin);
  const grimeTone = new THREE.Color(0x15110c);
  const browTone = new THREE.Color(p.hairColor);
  // Lips are a little darker and redder than the skin, not a separate colour (on green or red skin a
  // strong pink reads as two rolls stuck on)
  const lipTone = skin.clone().multiplyScalar(0.92).lerp(new THREE.Color(0xa85a60), 0.35);
  const stubbleTone = new THREE.Color(p.hairColor).lerp(skin, 0.55);
  const blushTone = skin.clone().lerp(new THREE.Color(0xa0473c), 0.35);
  const { eyeX } = LANDMARK;

  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const nz = normals[i * 3 + 2];
    const ax = Math.abs(x);
    const front = smooth((nz + 0.15) / 0.5); // 1 on skin that faces the viewer
    const head = smooth((y + 0.78) / 0.15); // 1 on the head, fading out down the neck

    // Shading: hollows darken, ridges catch a little extra light
    // The neck is a smooth column: let its creases shade less so it does not look hatched
    const neckEase = 1 - 0.55 * smooth((-0.55 - y) / 0.25);
    const shade = Math.min(1, Math.max(-0.4, hollows[i] * 55 * neckEase));
    // (Gentle: the lights shade the hollows too, and doubled up the face read dark and dirty)
    color.copy(skin).multiplyScalar(1 - 0.3 * Math.max(0, shade) + 0.12 * Math.max(0, -shade));
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
    let bags = 0;
    let lines = 0;
    let creaseLid = 0;
    for (const sign of [-1, 1]) {
      // (the eyebrows come from the brow mask below)
      bags = Math.max(bags, gauss(x - sign * eyeX, 0.13, y + 0.1, 0.035, z - 0.1, 0.18));
      const fold = distanceToSegment2(x, y, [sign * 0.095, -0.24], [sign * 0.135, -0.33]);
      lines = Math.max(lines, Math.exp(-((fold / 0.03) ** 2)) * smooth((y + 0.37) / 0.05));
      // The crease of the upper eyelid
      creaseLid = Math.max(creaseLid, gauss(x - sign * eyeX, 0.1, y - 0.058, 0.008, z - 0.07, 0.2));
    }
    // (a light shadow under the brow hairs; strong, it read as a painted bar)
    color.lerp(browTone, base.masks.brows[i] * 0.45 * Math.min(1, p.eyebrows * 1.5) * head * front);
    color.multiplyScalar(1 - 0.35 * bags * (0.1 + 0.9 * Math.max(0, p.age - 0.2)) * head * front);
    color.multiplyScalar(1 - 0.4 * lines * Math.max(0, p.age - 0.15) * head * front);
    color.multiplyScalar(1 - 0.28 * creaseLid * head * front);
    for (const band of [0.28, 0.36, 0.44]) {
      const crease = Math.exp(-(((y - band) / 0.016) ** 2)) * (1 - smooth((ax - 0.35) / 0.12));
      color.multiplyScalar(1 - 0.22 * crease * p.age * head * front * smooth((noise3(x * 5 + band * 10, band * 7, 1) - 0.35) * 3));
    }

    // Lips and the mouth line
    // The lips are the red between the lip borders, fading softly into the skin at the edge
    const lip = base.masks.lipsSoft[i];
    color.lerp(lipTone, lip * 0.85 * head * front);
    color.lerp(grimeTone, base.masks.mouthLine[i] * 0.3 * head * front);
    // The nostrils are dark openings under the tip of the nose
    color.lerp(grimeTone, base.masks.nostrils[i] * 1.0 * head);

    // The shaved sides of a mohawk show the shadow of stubble
    const shaved = shavedWeight(p, x, y, z);
    if (shaved > 0) color.lerp(stubbleTone, shaved * 0.45 * head);

    // Grime blotches, heavier in recesses
    const n = noise3(x * 3 + 5, y * 3, z * 3) * 0.6 + noise3(x * 9, y * 9 + 3, z * 9) * 0.4;
    const grime = smooth((n - 0.38) / 0.28) * p.grime * 0.8 + Math.max(0, shade) * p.grime * 0.35;
    color.lerp(grimeTone, Math.min(0.9, grime) * (0.4 + 0.6 * head));

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // Where the lips are, for the skin shader (a wet highlight and fine vertical lines)
  geometry.setAttribute("lip", new THREE.BufferAttribute(base.masks.lipsSoft, 1));
  // The bust's underside: where it stands on the plinth, and the middle of that footprint
  let footX = 0;
  let footZ = 0;
  let baseY = Infinity;
  for (const i of base.bottom) {
    footX += positions[i * 3];
    footZ += positions[i * 3 + 2];
    baseY = Math.min(baseY, positions[i * 3 + 1]);
  }
  const footprint = { x: footX / base.bottom.length, z: footZ / base.bottom.length };
  return { geometry, eyes: deformed.eyes, positions, normals, footprint, baseY };
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
