import * as THREE from "three";
import { beardWeight } from "./beard";
import { earClearance, hairGrowth } from "./hairShell";
import { LANDMARK, type HeadBase } from "./headMesh";
import { MM } from "./print";
import { masculinity, type Params, type Race } from "./params";

// The bust's colours, for the picture (the token): the sculpt is the same either way, and what prints is the
// form alone, so none of this reaches the print. The paint is kept apart from the sculpt's settings: changing a
// colour only changes the materials' settings, never rebuilds the bust.
//
// Each kind of part has one material, shared by every bust in turn and changed in place. The skin's detail is in
// its shader: the head has about 53,000 vertices, far too few for pores or fine wrinkles, so those are a height
// field that tilts the surface normal per pixel; the broader paint (shading in the hollows, flushed cheeks, the
// red of the lips, age, stubble, grime) is worked out per vertex for each bust, and mixed with the colours here.

export interface Paint {
  skin: string;
  eyes: string;
  eyeGlow: boolean; // the irises glow, as a tiefling's or a ghost's do
  hair: string; // the hair, beard and eyebrows
  horns: string;
  teeth: string; // the teeth and tusks
  grime: number; // 0..1: dirt in the hollows, soot and wear
}

export interface Swatch {
  name: string;
  value: string;
}

export const SKIN_TONES: Swatch[] = [
  { name: "Elven pale", value: "#c4baa8" },
  { name: "Pale", value: "#c9b8a4" },
  { name: "Tan", value: "#a8825e" },
  { name: "Ruddy", value: "#b07a5a" },
  { name: "Dark brown", value: "#5e3d2b" },
  { name: "Grave pallor", value: "#8d8676" },
  { name: "Ash", value: "#7a7a84" },
  { name: "Burnt umber", value: "#4a3326" },
  { name: "Rot green", value: "#5f7a4c" },
  { name: "Orc grey-green", value: "#6d7a5a" },
  { name: "Infernal red", value: "#8a3a34" },
  { name: "Infernal violet", value: "#5a3a63" },
  { name: "Blue-grey", value: "#5c6f80" },
];

export const EYE_COLORS: Swatch[] = [
  { name: "Brown", value: "#5a3a1e" },
  { name: "Hazel", value: "#7a5a2a" },
  { name: "Green", value: "#4a7a4a" },
  { name: "Blue", value: "#3a6a9a" },
  { name: "Grey", value: "#7a8288" },
  { name: "Ember", value: "#ff3a1c" },
  { name: "Amber", value: "#ffb020" },
  { name: "Wisp", value: "#40ff70" },
  { name: "Frost", value: "#c8d0ff" },
];

export const HAIR_COLORS: Swatch[] = [
  { name: "Coal", value: "#17130f" },
  { name: "Chestnut", value: "#4a2f1d" },
  { name: "Auburn", value: "#6a2a16" },
  { name: "Rust", value: "#7a3418" },
  { name: "Straw", value: "#a08654" },
  { name: "Dust", value: "#8a7a55" },
  { name: "Ash", value: "#8c8c8a" },
  { name: "Bone", value: "#d6ccb6" },
];

export const HORN_COLORS: Swatch[] = [
  { name: "Bone", value: "#c9bda0" },
  { name: "Horn", value: "#7a5f45" },
  { name: "Black", value: "#241d18" },
  { name: "Ash", value: "#6d6a66" },
  { name: "Blood", value: "#5a1a16" },
];

export const TEETH_COLORS: Swatch[] = [
  { name: "White", value: "#ece6d8" },
  { name: "Ivory", value: "#e0d4b4" },
  { name: "Yellowed", value: "#c4b691" },
  { name: "Rotten", value: "#8a7f62" },
];

const swatch = (list: Swatch[], name: string) => list.find((s) => s.name === name)!.value;

const PLAIN: Paint = { skin: swatch(SKIN_TONES, "Tan"), eyes: swatch(EYE_COLORS, "Brown"), eyeGlow: false, hair: swatch(HAIR_COLORS, "Chestnut"), horns: swatch(HORN_COLORS, "Horn"), teeth: swatch(TEETH_COLORS, "Ivory"), grime: 0.2 };

// What a race starts with, over the plain paint: applied when the race is chosen
export const RACE_PAINT: Record<Race, Partial<Paint>> = {
  human: {},
  elf: { skin: swatch(SKIN_TONES, "Elven pale"), eyes: swatch(EYE_COLORS, "Green"), hair: swatch(HAIR_COLORS, "Straw") },
  "half-elf": { skin: swatch(SKIN_TONES, "Pale"), eyes: swatch(EYE_COLORS, "Hazel") },
  dwarf: { skin: swatch(SKIN_TONES, "Ruddy"), hair: swatch(HAIR_COLORS, "Rust") },
  halfling: { eyes: swatch(EYE_COLORS, "Hazel"), hair: swatch(HAIR_COLORS, "Chestnut") },
  gnome: { skin: swatch(SKIN_TONES, "Ruddy"), eyes: swatch(EYE_COLORS, "Blue"), hair: swatch(HAIR_COLORS, "Ash") },
  "half-orc": { skin: swatch(SKIN_TONES, "Orc grey-green"), eyes: swatch(EYE_COLORS, "Amber"), hair: swatch(HAIR_COLORS, "Coal"), teeth: swatch(TEETH_COLORS, "Yellowed"), grime: 0.35 },
  tiefling: { skin: swatch(SKIN_TONES, "Infernal red"), eyes: swatch(EYE_COLORS, "Amber"), eyeGlow: true, hair: swatch(HAIR_COLORS, "Coal"), horns: swatch(HORN_COLORS, "Black") },
};

export const defaultPaint = (race: Race): Paint => ({ ...PLAIN, ...RACE_PAINT[race] });

// The race's own colours over the paint as it is (the grime stays as it was set)
export const racePaint = (paint: Paint, race: Race): Paint => ({ ...paint, ...PLAIN, ...RACE_PAINT[race], grime: paint.grime });

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Repeatable pseudo-random value in [0, 1) for a lattice point, smoothed into 3D value noise below
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
  return lerp(lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v), lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v), w);
}

// A 3D gaussian blob weight: 1 at the centre, fading to 0 by roughly one `s` away on each axis
const gauss = (dx: number, sx: number, dy: number, sy: number, dz: number, sz: number) => Math.exp(-((dx / sx) ** 2 + (dy / sy) ** 2 + (dz / sz) ** 2));

// Distance from a point to a line segment, in the front view
function distanceToSegment2(px: number, py: number, a: [number, number], b: [number, number]): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const t = Math.min(1, Math.max(0, ((px - a[0]) * abx + (py - a[1]) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - a[0] - abx * t, py - a[1] - aby * t);
}

// How far each vertex sits inside the average of its neighbours, along its normal. Positive means a hollow
// (shaded); negative a ridge. Averaged over several passes it measures the shape at the scale of a lip or a
// socket, not vertex-to-vertex noise.
function cavity(base: HeadBase, positions: ArrayLike<number>, normals: ArrayLike<number>): Float32Array {
  const count = positions.length / 3;
  let a = Float32Array.from(positions);
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

// The head's per-vertex paint, for the skin shader, as two attributes of four weights each:
//   paintA: shading (hollows dark, ridges light, -0.4..1), lips, dark openings (nostrils, the parting of the
//           lips), flush (cheeks, nose and ears)
//   paintB: age (bags, smile folds, the lid crease and forehead lines, as darkening), stubble under a beard,
//           grime blotches (a noise the Grime setting thresholds), the scalp under the hair (shaded like the hair,
//           so its edge does not stand out against bare skin)
export function headPaint(base: HeadBase, geometry: THREE.BufferGeometry, p: Params): void {
  const positions = geometry.attributes.position.array as Float32Array;
  const normals = geometry.attributes.normal.array as Float32Array;
  const count = positions.length / 3;
  const hollows = cavity(base, positions, normals);
  const a = new Float32Array(count * 4);
  const b = new Float32Array(count * 4);
  const { eyeX } = LANDMARK;
  const aged = (from: number) => Math.max(0, p.age - from);
  const earClear = earClearance(positions, base);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const ax = Math.abs(x);
    const front = smooth((normals[i * 3 + 2] + 0.15) / 0.5); // 1 on skin that faces the viewer
    const head = smooth((y + 0.78) / 0.15); // 1 on the head, fading out down the neck
    // The neck is a smooth column: its creases shade less, or it looks hatched
    const neckEase = 1 - 0.55 * smooth((-0.55 - y) / 0.25);
    const shade = Math.min(1, Math.max(-0.4, hollows[i] * 55 * neckEase));
    const blush = Math.max(gauss(ax - 0.27, 0.13, y + 0.12, 0.1, z - 0.12, 0.2), gauss(x, 0.07, y + 0.17, 0.08, z - 0.2, 0.15)) * head * front;
    const earFlush = gauss(ax - 0.45, 0.07, y + 0.05, 0.16, z + 0.45, 0.2) * head;

    let bags = 0;
    let lines = 0;
    let lid = 0;
    for (const sign of [-1, 1]) {
      bags = Math.max(bags, gauss(x - sign * eyeX, 0.13, y + 0.1, 0.035, z - 0.1, 0.18));
      const fold = distanceToSegment2(x, y, [sign * 0.095, -0.24], [sign * 0.135, -0.33]);
      lines = Math.max(lines, Math.exp(-((fold / 0.03) ** 2)) * smooth((y + 0.37) / 0.05));
      lid = Math.max(lid, gauss(x - sign * eyeX, 0.1, y - 0.058, 0.008, z - 0.07, 0.2));
    }
    let light = (1 - 0.35 * bags * (0.1 + 0.9 * aged(0.2))) * (1 - 0.4 * lines * aged(0.15)) * (1 - 0.28 * lid);
    for (const band of [0.28, 0.36, 0.44]) {
      const crease = Math.exp(-(((y - band) / 0.016) ** 2)) * (1 - smooth((ax - 0.35) / 0.12));
      light *= 1 - 0.22 * crease * p.age * smooth((noise3(x * 5 + band * 10, band * 7, 1) - 0.35) * 3);
    }
    const age = (1 - light) * head * front;

    const dark = Math.max(base.masks.nostrils[i], 0.3 * base.masks.mouthLine[i] * front) * head;
    const lip = base.masks.lipsSoft[i] * 0.85 * head * front;
    const stubble = p.beardStyle === "none" ? 0 : beardWeight(base.positions[i * 3], base.positions[i * 3 + 1], base.positions[i * 3 + 2], p.beardStyle, base.masks.lipsSoft[i]) * (0.8 + 0.4 * noise3(x * 90, y * 90, z * 90)) * earClear[i];
    const grime = noise3(x * 3 + 5, y * 3, z * 3) * 0.6 + noise3(x * 9, y * 9 + 3, z * 9) * 0.4;

    a.set([shade, lip, dark, Math.max(blush * 0.35, earFlush * 0.4)], i * 4);
    b.set([age, Math.min(1, stubble), grime, hairGrowth(p, x, y, z, earClear[i]) * head], i * 4);
  }
  geometry.setAttribute("paintA", new THREE.BufferAttribute(a, 4));
  geometry.setAttribute("paintB", new THREE.BufferAttribute(b, 4));
}

const NOISE = /* glsl */ `
float hash31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y),
    f.z
  );
}
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
// Cellular noise: x is the distance to the nearest cell centre, y to the next nearest, z a random value for the cell
vec3 worley(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      for (int z = -1; z <= 1; z++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 r = g + hash33(i + g) - f;
        float d = dot(r, r);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = hash31(i + g);
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
`;

// The skin's height field, in scene units: negative is a pit or a crease
const SKIN_HEIGHT = /* glsl */ `
float crease(float d, float w) {
  return exp(-(d * d) / (w * w));
}
float skinHeight(vec3 p, vec3 n, float pixelSize, float lip) {
  // Pores and fine texture, fading out once a pixel covers more than a pore
  float fine = 1.0 - smoothstep(0.0008, 0.0026, pixelSize);
  vec3 pore = worley(p * 260.0);
  float h = -(1.0 - smoothstep(0.0, 0.25, pore.x)) * 0.00045 * fine;
  // Between larger cells run the fine furrows that give skin its cross-hatched look
  vec3 furrow = worley(p * 120.0);
  h -= (1.0 - smoothstep(0.0, 0.09, furrow.y - furrow.x)) * 0.00025 * fine;
  h += (vnoise(p * 210.0) - 0.5) * 0.0003 * fine;
  // Broader unevenness, as smooth waves (lattice noise at this scale lined up into dashes on the cheek)
  h += sin(p.x * 23.0 + sin(p.y * 17.0)) * sin(p.y * 19.0 + sin(p.z * 21.0)) * sin(p.z * 25.0 + p.x * 7.0) * 0.0005;

  float facing = smoothstep(0.1, 0.6, n.z);
  float ax = abs(p.x);
  float w = 0.0;
  // Forehead creases: three wavering horizontal lines
  float fore = facing * smoothstep(0.18, 0.26, p.y) * (1.0 - smoothstep(0.5, 0.58, p.y)) * (1.0 - smoothstep(0.4, 0.5, ax));
  float wob = 0.012 * sin(p.x * 9.0 + 1.0) + 0.006 * sin(p.x * 23.0);
  w += fore * (crease(p.y - 0.30 + wob, 0.007) + crease(p.y - 0.38 + wob * 1.2, 0.007) + crease(p.y - 0.46 + wob, 0.006));
  // Frown lines between the brows
  w += 0.6 * facing * crease(ax - 0.035, 0.006) * smoothstep(0.06, 0.12, p.y) * (1.0 - smoothstep(0.2, 0.26, p.y));
  // Crow's feet, fanning from the outer corner of each eye (kept close to it: further out they were stray dashes)
  vec2 corner = vec2(ax - 0.235, p.y);
  float cr = length(corner);
  float ca = atan(corner.y, corner.x);
  float feet = smoothstep(0.025, 0.04, cr) * (1.0 - smoothstep(0.065, 0.09, cr)) * (1.0 - smoothstep(0.04, 0.07, abs(p.y))) * step(0.0, corner.x) * smoothstep(0.1, 0.5, n.x * sign(p.x) + 0.3);
  w += feet * pow(abs(sin(ca * 6.0)), 18.0) * 0.5;
  // Fine vertical lines above the upper lip
  float above = facing * smoothstep(-0.34, -0.3, p.y) * (1.0 - smoothstep(-0.26, -0.23, p.y)) * (1.0 - smoothstep(0.09, 0.13, ax));
  w += above * pow(abs(sin(p.x * 70.0 + sin(p.y * 30.0))), 14.0) * 0.35;
  // Rings around the neck
  float neck = (1.0 - smoothstep(-0.62, -0.58, p.y)) * smoothstep(-0.92, -0.78, p.y);
  w += neck * (crease(p.y + 0.70 + 0.01 * sin(p.x * 6.0), 0.01) + crease(p.y + 0.79 + 0.01 * sin(p.x * 5.0 + 2.0), 0.009)) * 0.3;
  // Lips: faint irregular vertical lines across the red (regular ones read as ribbing), and a soft pillow
  h -= lip * pow(abs(sin(p.x * 190.0 + vnoise(p * 60.0) * 3.0)), 12.0) * 0.00025;
  h += lip * 0.0008;
  // Everything creased deepens with age; young faces barely show these lines
  h -= w * (0.0002 + 0.0048 * max(0.0, uAge - 0.15));
  return h;
}
`;

// Tilts the shading normal by a height field `hh` worked out at this pixel (bump mapping from its screen
// derivatives)
const PERTURB = /* glsl */ `
  {
    vec3 sX = dFdx(-vViewPosition);
    vec3 sY = dFdy(-vViewPosition);
    vec2 dH = vec2(dFdx(hh), dFdy(hh));
    vec3 R1 = cross(sY, normal);
    vec3 R2 = cross(normal, sX);
    float det = dot(sX, R1);
    vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
    normal = normalize(normal - grad / max(abs(det), 1e-12));
  }
`;

type Uniform<T> = { value: T };

// The materials, and the uniforms they read the paint from
export class Painter {
  private readonly base: HeadBase;
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly u = {
    skin: { value: new THREE.Color() },
    hair: { value: new THREE.Color() },
    iris: { value: new THREE.Color() },
    glow: { value: 0 },
    horns: { value: new THREE.Color() },
    teeth: { value: new THREE.Color() },
    grime: { value: 0 },
    age: { value: 0.3 },
    masculine: { value: 1 },
  };
  readonly materials: Record<"skin" | "eye" | "hair" | "horn" | "teeth" | "mouth" | "clay", THREE.MeshStandardMaterial>;

  constructor(base: HeadBase, paint: Paint) {
    this.base = base;
    const clipping = [this.plane];
    const shared = (material: THREE.MeshStandardMaterial, key: string, compile?: (shader: THREE.WebGLProgramParametersWithUniforms) => void) => {
      material.clippingPlanes = clipping;
      // (shared by every bust in turn: disposeObject leaves it alone)
      material.userData.shared = true;
      if (compile) {
        material.onBeforeCompile = compile;
        material.customProgramCacheKey = () => key;
      }
      return material;
    };
    const u = this.u;
    const uniforms = (shader: THREE.WebGLProgramParametersWithUniforms, list: Record<string, Uniform<unknown>>) => Object.assign(shader.uniforms, list);
    this.materials = {
      skin: shared(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62 }), "effigy-skin-1", (shader) => {
        uniforms(shader, { uSkin: u.skin, uHair: u.hair, uGrime: u.grime, uAge: u.age, uMasculine: u.masculine });
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute vec4 paintA;\nattribute vec4 paintB;\nvarying vec4 vPaintA;\nvarying vec4 vPaintB;\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPaintA = paintA;\nvPaintB = paintB;\nvObjPos = position;\nvObjNormal = normal;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>\nuniform vec3 uSkin;\nuniform vec3 uHair;\nuniform float uGrime;\nuniform float uAge;\nuniform float uMasculine;\nvarying vec4 vPaintA;\nvarying vec4 vPaintB;\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;\n${NOISE}\n${SKIN_HEIGHT}`)
          .replace(
            "#include <color_fragment>",
            /* glsl */ `#include <color_fragment>
  {
    float shade = vPaintA.x;
    // Skin is never one flat colour: faint, slow variations in warmth
    vec3 mottle = vec3(0.96 + 0.08 * vnoise(vObjPos * 5.0), 0.94 + 0.1 * vnoise(vObjPos * 7.0 + 3.0), 0.94 + 0.1 * vnoise(vObjPos * 6.0 + 7.0));
    vec3 c = uSkin * mottle;
    // A face is not one colour: the forehead a little yellower, the jaw and upper lip a little cooler on a man (the
    // shadow of beard under the skin)
    float facing = smoothstep(0.0, 0.5, vObjNormal.z);
    float forehead = smoothstep(0.12, 0.3, vObjPos.y) * (1.0 - smoothstep(0.5, 0.62, vObjPos.y)) * facing;
    float jaw = smoothstep(-0.26, -0.4, vObjPos.y) * (1.0 - smoothstep(-0.66, -0.56, vObjPos.y)) * smoothstep(-0.2, 0.3, vObjNormal.z);
    c *= mix(vec3(1.0), vec3(1.03, 1.0, 0.92), forehead * 0.6);
    c *= mix(vec3(1.0), vec3(0.9, 0.95, 1.0), jaw * uMasculine * 0.7);
    // In the hollows the skin goes deeper and a little redder (light that scatters under skin comes back red), on
    // ridges a little lighter
    vec3 deep = c * vec3(0.62, 0.5, 0.48);
    c = mix(c, deep, 0.5 * max(shade, 0.0)) + c * 0.12 * max(-shade, 0.0);
    // Flushed cheeks, nose and ears, less on a filthy face
    c = mix(c, c * vec3(1.1, 0.8, 0.76), vPaintA.w * (1.0 - 0.6 * uGrime));
    // The lips: a little darker and redder than the skin, never a separate colour (on green or red skin a strong
    // pink reads as two rolls stuck on)
    vec3 lipTone = mix(c * 0.92, vec3(0.39, 0.10, 0.12), 0.35);
    c = mix(c, lipTone, vPaintA.y);
    c *= 1.0 - vPaintB.x;
    // The shadow of stubble under a beard, and of the roots on the scalp under the hair
    c = mix(c, mix(uHair, c, 0.3) * 0.85, vPaintB.y * 0.75);
    c = mix(c, mix(uHair, c, 0.35) * 0.8, vPaintB.w * 0.85);
    // Dark openings: the nostrils and the parting of the lips (a deep shade of the skin, not black, which read as a
    // mole beside the nose at three-quarter view)
    c = mix(c, c * vec3(0.35, 0.25, 0.23), vPaintA.z * 0.6);
    // Grime: blotches, heavier in the hollows
    float grime = smoothstep(0.38, 0.66, vPaintB.z) * uGrime * 0.8 + max(shade, 0.0) * uGrime * 0.35;
    c = mix(c, vec3(0.007, 0.005, 0.003), min(0.85, grime));
    diffuseColor.rgb = c;
  }`,
          )
          .replace(
            "#include <roughnessmap_fragment>",
            /* glsl */ `#include <roughnessmap_fragment>
  {
    // The lips are wet and catch the light; the oily T-zone (forehead, bridge and tip of the nose) is shinier than
    // the cheeks; grime is matte
    roughnessFactor = mix(roughnessFactor, 0.3, vPaintA.y * 0.7);
    vec3 tp = vObjPos;
    float tzone = smoothstep(0.12, 0.0, abs(tp.x)) * smoothstep(-0.28, -0.1, tp.y) * (1.0 - smoothstep(0.5, 0.6, tp.y));
    roughnessFactor = mix(roughnessFactor, 0.45, tzone * 0.4);
    roughnessFactor = mix(roughnessFactor, 0.85, uGrime * smoothstep(0.38, 0.66, vPaintB.z));
  }`,
          )
          .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n  float hh = skinHeight(vObjPos, normalize(vObjNormal), length(dFdx(-vViewPosition)), vPaintA.y);\n${PERTURB}`);
      }),
      // A realistic eye, coloured by direction from its centre (it is built facing +z): the iris about 11.5 mm
      // across on the 9.4 mm eyeball with fibres, a pale ring by the pupil and a dark limbal ring; a white with
      // faint veins toward the back; the top shaded by the lid. Glossy, like the wet cornea over it.
      eye: shared(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 }), "effigy-eye-1", (shader) => {
        uniforms(shader, { uIris: u.iris, uGlow: u.glow });
        shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vDir;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvDir = normalize(position);");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec3 uIris;\nuniform float uGlow;\nvarying vec3 vDir;\nfloat irisMask;")
          .replace(
            "#include <color_fragment>",
            /* glsl */ `#include <color_fragment>
  {
    float theta = acos(clamp(vDir.z, -1.0, 1.0));
    float phi = atan(vDir.y, vDir.x);
    const float irisEdge = 0.66;
    const float pupilEdge = 0.24;
    vec3 dark = vec3(0.002, 0.0015, 0.001);
    vec3 c;
    irisMask = 0.0;
    if (theta < pupilEdge) {
      c = dark;
    } else if (theta < irisEdge) {
      float t = (theta - pupilEdge) / (irisEdge - pupilEdge);
      float fibre = 0.82 + 0.18 * sin(phi * 28.0 + sin(phi * 5.0) * 3.0) + 0.08 * sin(phi * 61.0 + t * 9.0);
      c = uIris * (1.35 - 0.7 * t) * fibre;
      c = mix(c, vec3(0.69, 0.45, 0.14), 0.35 * (1.0 - smoothstep(0.0, 1.0, t * 4.0)));
      c = mix(c, dark, 0.6 * smoothstep(0.78, 1.0, t));
      c = mix(c, dark, 0.7 * (1.0 - smoothstep(0.0, 1.0, theta / (pupilEdge + 0.04))));
      irisMask = (1.0 - smoothstep(0.85, 1.0, t)) * fibre;
    } else {
      float edge = smoothstep(1.1, 1.8, theta);
      float streak = pow(max(0.0, sin(phi * 17.0 + sin(theta * 11.0) * 4.0)), 14.0);
      c = mix(vec3(0.69, 0.63, 0.53), vec3(0.43, 0.07, 0.05), streak * edge * 0.45) * (1.0 - 0.28 * edge);
      c = mix(c, dark, 0.45 * (1.0 - smoothstep(irisEdge, irisEdge + 0.07, theta)));
    }
    // The upper lid shades the top of the eye
    c *= 1.0 - 0.35 * smoothstep(-0.1, 0.7, vDir.y);
    diffuseColor.rgb = c;
  }`,
          )
          .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance += uIris * irisMask * uGlow * 2.5;");
      }),
      // Hair, beard and brows: the colour with strand-to-strand variation, darker down in the carved grooves. (Its
    // highlights are kept small and weak: on near-black hair the light is nearly all highlight, and broad ones
    // took the warm key light's colour and made black hair look brown.)
      hair: shared(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.55, specularIntensity: 0.55, sheen: 1, sheenRoughness: 0.4 }), "effigy-hair-3", (shader) => {
        uniforms(shader, { uHair: u.hair, uSkin: u.skin, uGrime: u.grime });
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float groove;\nattribute float hairAmount;\nvarying float vGroove;\nvarying float vAmount;\nvarying vec3 vObjPos;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGroove = groove;\nvAmount = hairAmount;\nvObjPos = position;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>\nuniform vec3 uHair;\nuniform vec3 uSkin;\nuniform float uGrime;\nvarying float vGroove;\nvarying float vAmount;\nvarying vec3 vObjPos;\n${NOISE}`)
          .replace(
            "#include <color_fragment>",
            /* glsl */ `#include <color_fragment>
  {
    vec3 c = uHair * (0.82 + 0.36 * vnoise(vObjPos * 55.0)) * (0.9 + 0.2 * vnoise(vObjPos * 9.0 + 4.0));
    c *= 1.0 - 0.6 * smoothstep(0.0, ${(0.45 * MM).toFixed(5)}, vGroove);
    // At its thin edge the hair is as sparse as the roots on the scalp, and takes their tone (as the scalp
    // does under it: see the skin), so the edge of the shell does not show as a line
    c = mix(mix(uHair, uSkin, 0.35) * 0.8, c, smoothstep(0.15, 0.75, vAmount));
    c = mix(c, vec3(0.012, 0.009, 0.006), uGrime * 0.35 * vnoise(vObjPos * 6.0));
    diffuseColor.rgb = c;
  }`,
          )
          .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.85, smoothstep(0.0, ${(0.45 * MM).toFixed(5)}, vGroove));`);
        shader.fragmentShader = shader.fragmentShader.replace("#include <lights_physical_fragment>", "#include <lights_physical_fragment>\n  material.sheenColor = mix(uHair, vec3(0.5), 0.1) * 0.25;");
      }),
      // Horns: stained dark at the root, the chosen colour along the shaft, deeper at the tip, with growth rings
      horn: shared(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }), "effigy-horn-1", (shader) => {
        uniforms(shader, { uHorn: u.horns, uGrime: u.grime });
        shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float along;\nvarying float vAlong;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvAlong = along;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec3 uHorn;\nuniform float uGrime;\nvarying float vAlong;")
          .replace(
            "#include <color_fragment>",
            /* glsl */ `#include <color_fragment>
  {
    vec3 c = mix(uHorn * 0.4, uHorn, smoothstep(0.0, 0.3, vAlong));
    c = mix(c, uHorn * uHorn * 0.7, smoothstep(0.7, 1.0, vAlong));
    c *= 0.86 + 0.14 * sin(vAlong * 95.0);
    c = mix(c, vec3(0.01, 0.008, 0.006), uGrime * 0.3 * (1.0 - vAlong));
    diffuseColor.rgb = c;
  }`,
          );
      }),
      // Teeth and tusks the chosen colour, yellowing with grime; the gums and tongue a dark wet red
      teeth: shared(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }), "effigy-teeth-1", (shader) => {
        uniforms(shader, { uTeeth: u.teeth, uGrime: u.grime });
        shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float tissue;\nvarying float vTissue;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvTissue = tissue;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec3 uTeeth;\nuniform float uGrime;\nvarying float vTissue;")
          .replace(
            "#include <color_fragment>",
            /* glsl */ `#include <color_fragment>
  {
    vec3 tooth = mix(uTeeth, uTeeth * vec3(0.8, 0.74, 0.6), uGrime * 0.5);
    diffuseColor.rgb = mix(tooth, vec3(0.28, 0.05, 0.05), vTissue);
  }`,
          )
          .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.35, vTissue);");
      }),
      // The solid behind the lips, seen in an open mouth: the dark of the inside of a mouth
      mouth: shared(new THREE.MeshStandardMaterial({ color: 0x1a0707, roughness: 0.55 }), "effigy-mouth-1"),
      // The bare form, for checking the sculpt
      clay: shared(new THREE.MeshStandardMaterial({ color: 0x9c9a96, roughness: 0.75 }), "effigy-clay-1"),
    };
    this.setPaint(paint);
  }

  setPaint(paint: Paint): void {
    this.u.skin.value.set(paint.skin);
    this.u.hair.value.set(paint.hair);
    this.u.iris.value.set(paint.eyes);
    this.u.glow.value = paint.eyeGlow ? 1 : 0;
    this.u.horns.value.set(paint.horns);
    this.u.teeth.value.set(paint.teeth);
    this.u.grime.value = paint.grime;
  }

  // Paints a bust from buildBust (or shows it as clay): each part takes its kind's material, and the head its
  // per-vertex paint, worked out once for the bust
  apply(root: THREE.Object3D, p: Params, clay: boolean): void {
    // (the bust is cut flat at its underside: see builder.ts)
    this.plane.constant = -(root.userData.flatCut as number) * MM;
    this.u.age.value = p.age;
    this.u.masculine.value = masculinity(p);
    // (a part that has no such measure takes a neutral one)
    const fill = (geometry: THREE.BufferGeometry, name: string, value: number) => {
      if (!geometry.attributes[name]) geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(value), 1));
    };
    const zeros = (geometry: THREE.BufferGeometry, name: string) => fill(geometry, name, 0);
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.unpainted) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      const kind = KINDS[object.name] ?? "clay";
      if (clay) {
        object.material = this.materials.clay;
        return;
      }
      if (kind === "skin" && !geometry.attributes.paintA) headPaint(this.base, geometry, p);
      if (kind === "hair") {
        zeros(geometry, "groove");
        fill(geometry, "hairAmount", 1);
      }
      if (kind === "teeth") zeros(geometry, "tissue");
      if (kind === "horn") zeros(geometry, "along");
      object.material = this.materials[kind];
    });
  }
}

// Which material each named part of a bust takes (see builder.ts for the names)
const KINDS: Record<string, keyof Painter["materials"]> = {
  head: "skin",
  eye: "eye",
  horn: "horn",
  tusk: "teeth",
  teeth: "teeth",
  hair: "hair",
  curtain: "hair",
  beard: "hair",
  locks: "hair",
  brows: "hair",
  mouthFill: "mouth",
};
