import * as THREE from "three";
import { scalp, STRIP_HALF_WIDTH } from "./hair";
import type { HeadBase } from "./headMesh";
import type { Params } from "./params";

// Hair as a sculpted shell, the way hair is modelled on a bust: the hair-bearing part of the scalp raised
// into a solid mass whose thickness follows the style (a close crop, a swept-back mane, a mohawk's crest).
// It is one continuous surface, so there are no gaps between clumps, and it sits on the head like a sculpted
// form (which is also what a printer needs). Strand detail is carved into it by the shader below: fine
// grooves stretched along the direction the hair is combed.
//
// Every shell vertex is a copy of a head vertex, raised along the head's normal. At the hairline the
// thickness tapers to almost nothing and the colour fades from the head's own paint into the hair colour,
// so the hairline blends instead of ending in a stepped edge.

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

interface Style {
  thickness: (x: number, y: number, z: number) => number; // in head-local units (1 = 20 cm)
  flow: [number, number, number]; // the direction it is combed
}

const STYLES: Record<"cropped" | "swept" | "mohawk" | "long", Style> = {
  // A close crop: an even few millimetres, a little fuller on top
  cropped: { thickness: (_x, y) => 0.012 + 0.01 * smooth((y - 0.1) / 0.4), flow: [0, 0.1, -1] },
  // Swept back: thin at the hairline, building volume over the crown and down the back of the head
  swept: {
    thickness: (_x, y, z) => 0.016 + 0.05 * smooth((y - 0.05) / 0.35) * (1 - 0.4 * smooth((-z - 0.5) / 0.3)) + 0.02 * smooth((-z - 0.2) / 0.3),
    flow: [0, 0.3, -1],
  },
  // A crest along the middle of the head, tallest over the crown, falling off to the shaved sides
  mohawk: {
    thickness: (x, y) => {
      const across = 1 - smooth(Math.abs(x) / STRIP_HALF_WIDTH);
      return 0.02 + 0.2 * across * across * smooth((y + 0.2) / 0.5);
    },
    flow: [0, 0.3, -1],
  },
  // Long hair: a cap over the scalp (the hanging lengths are drawn as strands in hair.ts)
  long: { thickness: (_x, y) => 0.025 + 0.02 * smooth((y - 0.1) / 0.4), flow: [0, -0.1, -1] },
};

// The smallest lift off the skin, so the shell never fights the skin for the same depth at the hairline
const SKIN_GAP = 0.0015;

export function buildHairShell(
  p: Params,
  positions: Float32Array,
  normals: Float32Array,
  base: HeadBase,
  skinColors: Float32Array,
): THREE.BufferGeometry | null {
  const indices = base.indices;
  if (p.hairStyle === "none") return null;
  const style = STYLES[p.hairStyle];
  const count = positions.length / 3;

  // How much hair grows at each vertex
  const grow = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    let w = scalp(x, y, z);
    if (p.hairStyle === "mohawk") w *= 1 - smooth((Math.abs(x) - STRIP_HALF_WIDTH) / 0.05);
    // The ears are not scalp
    if (Math.abs(x) > 0.4 && y > -0.3 && y < 0.2 && z > -0.7 && z < -0.2) w = 0;
    grow[i] = w;
  }

  // The thickness builds up gradually from the hairline: the growth map spread a few centimetres across
  // the surface (it changes within about 8 mm, which made the shell's edge a ledge)
  let soft = grow;
  for (let pass = 0; pass < 30; pass++) {
    const next = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const from = base.offsets[i];
      const to = base.offsets[i + 1];
      let sum = 0;
      for (let k = from; k < to; k++) sum += soft[base.neighbours[k]];
      next[i] = to > from ? (soft[i] + sum / (to - from)) / 2 : soft[i];
    }
    soft = next;
  }

  // The triangles that carry hair, and the vertices they use
  const triangles: number[] = [];
  const used = new Int32Array(count).fill(-1);
  const order: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    if (grow[a] <= 0.01 && grow[b] <= 0.01 && grow[c] <= 0.01 && soft[a] <= 0.02) continue;
    for (const v of [a, b, c]) {
      if (used[v] < 0) {
        used[v] = order.length;
        order.push(v);
      }
    }
    triangles.push(used[a], used[b], used[c]);
  }
  if (triangles.length === 0) return null;

  const hair = new THREE.Color(p.hairColor);
  const out = new Float32Array(order.length * 3);
  const colors = new Float32Array(order.length * 3);
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  const skin = new THREE.Color();
  order.forEach((v, j) => {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    n.set(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]).normalize();
    const w = grow[v];
    // Full thickness well inside the hairline, tapering to a hair's breadth at its edge
    const lift = SKIN_GAP + style.thickness(x, y, z) * smooth((soft[v] - 0.25) / 0.65) * smooth(w / 0.3);
    out[j * 3] = x + n.x * lift;
    out[j * 3 + 1] = y + n.y * lift;
    out[j * 3 + 2] = z + n.z * lift;
    // Darker near the roots (where the hair is thin and shadowed), and fading into the skin at the hairline
    skin.setRGB(skinColors[v * 3], skinColors[v * 3 + 1], skinColors[v * 3 + 2]);
    c.copy(hair).multiplyScalar(0.75 + 0.25 * smooth((w - 0.3) / 0.7));
    c.lerp(skin, 1 - smooth((Math.min(w, soft[v] * 1.6) - 0.02) / 0.5));
    colors[j * 3] = c.r;
    colors[j * 3 + 1] = c.g;
    colors[j * 3 + 2] = c.b;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(out, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  return geometry;
}

// Strand relief for the shell: a fine noise stretched along the combing direction reads as grooves between
// strands, as carved into a sculpted bust. It bends the surface normal (bump) and shades the grooves a
// little darker. The hair's colour comes from the vertex colours.
const HAIR_HEIGHT = /* glsl */ `
float hhash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float hnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hhash(i), hhash(i + vec3(1, 0, 0)), f.x), mix(hhash(i + vec3(0, 1, 0)), hhash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hhash(i + vec3(0, 0, 1)), hhash(i + vec3(1, 0, 1)), f.x), mix(hhash(i + vec3(0, 1, 1)), hhash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z
  );
}
// Squash the point along the strands, so the noise varies quickly across them and slowly along them
float strands(vec3 p, vec3 flow) {
  vec3 q = p - flow * dot(p, flow) * 0.92;
  return 0.65 * hnoise(q * 70.0) + 0.35 * hnoise(q * 160.0 + 7.0);
}
`;

export function applyHairDetail(material: THREE.MeshStandardMaterial, p: Params): void {
  // One fixed combing direction per style (stretching the noise along each vertex's own direction scrambled
  // the pattern into specks wherever that direction turned)
  const flow = { value: new THREE.Vector3(...STYLES[p.hairStyle === "none" ? "swept" : p.hairStyle].flow).normalize() };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlow = flow;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHairPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHairPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform vec3 uFlow;\nvarying vec3 vHairPos;\n${HAIR_HEIGHT}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  float strand = strands(vHairPos, uFlow);
  diffuseColor.rgb *= 0.6 + 0.7 * strand;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  vec3 surf = -vViewPosition;
  vec3 sX = dFdx(surf);
  vec3 sY = dFdy(surf);
  float hh = strands(vHairPos, uFlow) * 0.004;
  vec2 dH = vec2(dFdx(hh), dFdy(hh));
  vec3 R1 = cross(sY, normal);
  vec3 R2 = cross(normal, sX);
  float det = dot(sX, R1);
  vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
  normal = normalize(normal - grad / max(abs(det), 1e-12));
}`,
      );
  };
  material.customProgramCacheKey = () => "effigy-hair-v3";
}
