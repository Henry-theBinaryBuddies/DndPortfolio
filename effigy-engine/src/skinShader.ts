import * as THREE from "three";
import type { Params } from "./params";

// Skin micro-detail. The base head has about 13,000 vertices, far too few to carry pores or fine
// wrinkles, so that detail is added in the material instead: a height field (pores, pits, and
// age-driven creases) that tilts the surface normal as the skin is shaded. It is evaluated per
// pixel, so it stays sharp however close you zoom, and the fine pores fade out at a distance so they
// never shimmer. The height field lives in the head's own coordinates, so wrinkles sit where the
// anatomy puts them (forehead, between the brows, beside the eyes, above the lip, around the neck).

const HEIGHT_FIELD = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vObjNormal;
uniform float uAge;
uniform float uDetail;
uniform float uScales;
uniform vec3 uCloth;
varying float vLip;

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

// Where scales cover the skin: the head and neck, but not the eyes or the lips
float scaleCover(vec3 p) {
  float eye = smoothstep(0.07, 0.17, length(vec2(abs(p.x) - 0.161, p.y)));
  float lips = 1.0 - 0.9 * smoothstep(0.16, 0.12, abs(p.x)) * smoothstep(-0.46, -0.42, p.y) * (1.0 - smoothstep(-0.28, -0.24, p.y));
  return eye * lips * smoothstep(-1.2, -0.95, p.y);
}

// 1 on the face of a scale, 0 in the grooves. The tint darkens the grooves and varies scale to scale.
float scalePlate(vec3 p, out float tint) {
  float freq = mix(36.0, 21.0, smoothstep(-0.2, -0.85, p.y));
  vec3 w = worley(p * freq);
  float plate = smoothstep(0.0, 0.3, w.y - w.x);
  tint = (1.0 - plate) * 0.4 + w.z * 0.22;
  return plate;
}


// The tunic: everything below a V-shaped neckline. Evaluated per pixel so the edge is crisp, not stair-stepped.
float clothAmount(vec3 p, vec3 n) {
  float front = smoothstep(-0.1, 0.5, n.z);
  float neckline = -1.08 - 0.42 * (1.0 - smoothstep(0.0, 0.3, abs(p.x))) * front;
  return 1.0 - smoothstep(-0.007, 0.007, p.y - neckline);
}

float clothTrim(vec3 p, vec3 n) {
  float front = smoothstep(-0.1, 0.5, n.z);
  float neckline = -1.08 - 0.42 * (1.0 - smoothstep(0.0, 0.3, abs(p.x))) * front;
  return exp(-pow((p.y - neckline) / 0.02, 2.0));
}

float crease(float d, float w) {
  return exp(-(d * d) / (w * w));
}

// Height of the skin surface at a point, in scene units. Negative is a pit or a crease.
float skinHeight(vec3 p, vec3 n, float pixelSize) {
  // Pores and fine texture. Fine detail fades out once a pixel covers more than a pore.
  float fine = 1.0 - smoothstep(0.0015, 0.0045, pixelSize);
  float h = (vnoise(p * 95.0) - 0.5) * 0.0015 * fine;
  h += (vnoise(p * 210.0) - 0.5) * 0.0006 * fine;
  h -= smoothstep(0.74, 0.94, vnoise(p * 140.0)) * 0.001 * fine;
  // Broader unevenness so the skin is never perfectly smooth
  h += (vnoise(p * 28.0) - 0.5) * 0.0016;

  float facing = smoothstep(0.1, 0.6, n.z);
  float ax = abs(p.x);
  float w = 0.0;

  // Forehead creases: three wavering horizontal lines
  float fore = facing * smoothstep(0.18, 0.26, p.y) * (1.0 - smoothstep(0.5, 0.58, p.y)) * (1.0 - smoothstep(0.4, 0.5, ax));
  float wob = 0.012 * sin(p.x * 9.0 + 1.0) + 0.006 * sin(p.x * 23.0);
  w += fore * (crease(p.y - 0.30 + wob, 0.007) + crease(p.y - 0.38 + wob * 1.2, 0.007) + crease(p.y - 0.46 + wob, 0.006));

  // Frown lines between the brows
  w += facing * crease(ax - 0.035, 0.006) * smoothstep(0.06, 0.12, p.y) * (1.0 - smoothstep(0.2, 0.26, p.y));

  // Crow's feet: short lines fanning out from the outer corner of each eye
  vec2 corner = vec2(ax - 0.235, p.y);
  float cr = length(corner);
  float ca = atan(corner.y, corner.x);
  float feet = smoothstep(0.03, 0.05, cr) * (1.0 - smoothstep(0.1, 0.14, cr)) * step(0.0, corner.x) * smoothstep(0.1, 0.5, n.x * sign(p.x) + 0.3);
  w += feet * pow(abs(sin(ca * 6.0)), 18.0) * 0.5;

  // Fine vertical lines above the upper lip
  float lip = facing * smoothstep(-0.34, -0.3, p.y) * (1.0 - smoothstep(-0.26, -0.23, p.y)) * (1.0 - smoothstep(0.09, 0.13, ax));
  w += lip * pow(abs(sin(p.x * 70.0 + sin(p.y * 30.0))), 14.0) * 0.35;

  // Rings around the neck
  float neck = (1.0 - smoothstep(-0.62, -0.58, p.y)) * smoothstep(-0.92, -0.78, p.y);
  w += neck * (crease(p.y + 0.70 + 0.01 * sin(p.x * 6.0), 0.01) + crease(p.y + 0.79 + 0.01 * sin(p.x * 5.0 + 2.0), 0.009)) * 0.8;

  // Scales: plates raised between grooves, deeper the higher the Scales slider
  if (uScales > 0.01) {
    float tint;
    float plate = scalePlate(p, tint);
    h -= (1.0 - plate) * 0.0042 * uScales * scaleCover(p);
  }

  // Lips: fine vertical lines across the red, and a soft pillow
  h -= vLip * pow(abs(sin(p.x * 150.0 + sin(p.y * 40.0) * 0.6)), 24.0) * 0.0009;
  h += vLip * 0.0008;

  // Cloth has a weave instead of pores
  float cloth = clothAmount(p, n);
  h *= 1.0 - 0.9 * cloth;
  h += cloth * (sin(p.x * 260.0) * sin(p.z * 260.0 + p.y * 40.0) * 0.00035);

  // Everything creased deepens with age
  h -= w * (0.0008 + 0.0042 * uAge) * uDetail;
  return h;
}
`;

const CLOTH_TINT = /* glsl */ `
{
  vec3 n = normalize(vObjNormal);
  float cloth = clothAmount(vObjPos, n);
  float weave = 0.88 + 0.24 * vnoise(vObjPos * 90.0);
  vec3 fabric = uCloth * weave;
  fabric = mix(fabric, uCloth * 0.35, 0.8 * clothTrim(vObjPos, n));
  diffuseColor.rgb = mix(diffuseColor.rgb, fabric, cloth);
}
`;

const ROUGHNESS = /* glsl */ `
{
  // Cloth is matte; the lips are wet and catch the light
  float cloth = clothAmount(vObjPos, normalize(vObjNormal));
  roughnessFactor = mix(roughnessFactor, 0.92, cloth);
  roughnessFactor = mix(roughnessFactor, 0.28, vLip * 0.7);
}
`;

const SCALE_TINT = /* glsl */ `
if (uScales > 0.01) {
  float scaleTint;
  scalePlate(vObjPos, scaleTint);
  diffuseColor.rgb *= 1.0 - uScales * scaleTint * scaleCover(vObjPos);
}
`;

const PERTURB = /* glsl */ `
{
  vec3 surf = -vViewPosition;
  vec3 sX = dFdx(surf);
  vec3 sY = dFdy(surf);
  float pixelSize = length(sX);
  float hh = skinHeight(vObjPos, normalize(vObjNormal), pixelSize);
  vec2 dH = vec2(dFdx(hh), dFdy(hh));
  vec3 R1 = cross(sY, normal);
  vec3 R2 = cross(normal, sX);
  float det = dot(sX, R1);
  vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
  normal = normalize(normal - grad / max(abs(det), 1e-12));
}
`;

// Adds the pore and wrinkle height field to a standard material. The material must be used on the
// sculpted head, whose vertex positions are in head-local units.
export function applySkinDetail(material: THREE.MeshStandardMaterial, p: Params): void {
  const age = { value: p.age };
  const scales = { value: p.scales };
  const cloth = { value: new THREE.Color(p.cloth) };
  const detail = { value: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAge = age;
    shader.uniforms.uDetail = detail;
    shader.uniforms.uScales = scales;
    shader.uniforms.uCloth = cloth;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;\nattribute float lip;\nvarying float vLip;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;\nvLip = lip;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${HEIGHT_FIELD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${SCALE_TINT}\n${CLOTH_TINT}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${ROUGHNESS}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${PERTURB}`);
  };
  material.customProgramCacheKey = () => "effigy-skin-v3";
}
