import type * as THREE from "three";
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

  // Everything creased deepens with age
  h -= w * (0.0008 + 0.0042 * uAge) * uDetail;
  return h;
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
  const detail = { value: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAge = age;
    shader.uniforms.uDetail = detail;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${HEIGHT_FIELD}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${PERTURB}`);
  };
  material.customProgramCacheKey = () => "effigy-skin-v1";
}
