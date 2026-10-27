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
  // Long hair: a cap over the scalp (the hanging lengths are a draped curtain, see buildHangingHair)
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

// Long hair's hanging lengths: a curtain draped from the scalp around the sides and back of the head down
// to the upper back, sculpted as one solid mass like the rest of the hair. At every height and angle around
// the neck it hangs just outside the body, and it can only drift inward slowly as it falls, so it drapes
// from the widest part of the skull past the neck and rests on the upper back without cutting into it. It
// is thick near the head and thins toward uneven, layered ends.
const CURTAIN_ANGLE = 1.4; // how far round from the back toward the face it reaches, either side (radians)
const CURTAIN_TOP = 0.32; // where it starts under the cap at the back of the head (lower at the sides)
const ACROSS = 72;
const DOWN = 40;

export function buildHangingHair(p: Params, positions: Float32Array, base: HeadBase): THREE.BufferGeometry | null {
  if (p.hairStyle !== "long") return null;
  const ax = base.neck.x;
  const az = base.neck.z;
  const count = positions.length / 3;

  // The body's outline: the furthest the surface reaches from the neck's axis, by angle (all the way round,
  // 0 straight behind) and height
  const ANGLE_BINS = 128;
  const HEIGHT_BINS = 100;
  const lowest = -1.6;
  const angleBin = (a: number) => ((Math.floor(((a + Math.PI) / (2 * Math.PI)) * ANGLE_BINS) % ANGLE_BINS) + ANGLE_BINS) % ANGLE_BINS;
  const heightBin = (y: number) => Math.floor(((CURTAIN_TOP + 0.3 - y) / (CURTAIN_TOP + 0.3 - lowest)) * HEIGHT_BINS);
  let outline = new Float32Array(ANGLE_BINS * HEIGHT_BINS);
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - ax;
    const dz = positions[i * 3 + 2] - az;
    const a = Math.atan2(dx, -dz);
    const ai = angleBin(a);
    const hi = heightBin(positions[i * 3 + 1]);
    if (hi < 0 || hi >= HEIGHT_BINS) continue;
    outline[hi * ANGLE_BINS + ai] = Math.max(outline[hi * ANGLE_BINS + ai], Math.hypot(dx, dz));
  }
  // Grown a little in every direction, so the curtain clears the surface between samples too
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(outline);
    for (let h = 0; h < HEIGHT_BINS; h++) {
      for (let a = 0; a < ANGLE_BINS; a++) {
        let m = outline[h * ANGLE_BINS + a];
        for (const [dh, da] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const hh = h + dh;
          const aa = (a + da + ANGLE_BINS) % ANGLE_BINS;
          if (hh >= 0 && hh < HEIGHT_BINS) m = Math.max(m, outline[hh * ANGLE_BINS + aa]);
        }
        next[h * ANGLE_BINS + a] = m;
      }
    }
    outline = next;
  }
  const bodyAt = (a: number, y: number) => {
    const ai = angleBin(a);
    const hi = Math.min(HEIGHT_BINS - 1, Math.max(0, heightBin(y)));
    return outline[hi * ANGLE_BINS + ai];
  };

  const rand = (() => {
    let seed = 4242;
    return () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
  })();
  // Uneven ends: shorter toward the sides, with a little layering
  const ends: number[] = [];
  for (let u = 0; u <= ACROSS; u++) {
    const a = -CURTAIN_ANGLE + (2 * CURTAIN_ANGLE * u) / ACROSS;
    ends.push(-1.05 - 0.3 * Math.cos(a * 0.8) - 0.06 * rand());
  }
  for (let pass = 0; pass < 2; pass++) for (let u = 1; u < ACROSS; u++) ends[u] = (ends[u - 1] + 2 * ends[u] + ends[u + 1]) / 4;

  // Where it starts: high on the back of the head under the cap, down to the tops of the ears at the sides
  const topAt = (a: number) => 0.05 + (CURTAIN_TOP - 0.05) * Math.cos(a * 0.9) ** 2;

  // How far out the drape hangs at each point: just off the body, and only drifting inward slowly as it
  // falls (so it hangs from the widest part of the skull instead of shrinking onto the neck)
  const columns = ACROSS + 1;
  const rows = DOWN + 1;
  let reach = new Float32Array(columns * rows);
  const floor = new Float32Array(columns * rows);
  for (let u = 0; u <= ACROSS; u++) {
    const a = -CURTAIN_ANGLE + (2 * CURTAIN_ANGLE * u) / ACROSS;
    for (let v = 0; v <= DOWN; v++) {
      const t = v / DOWN;
      const y = topAt(a) + (ends[u] - topAt(a)) * t;
      const body = bodyAt(a, y);
      floor[u * rows + v] = body + 0.012;
      // (starting just under the cap's surface, so no edge stands proud of it, then swelling to full depth)
      const wanted = body + 0.03 + 0.035 * smooth(t / 0.25) - 0.02 * t;
      reach[u * rows + v] = v === 0 ? wanted : Math.max(wanted, reach[u * rows + v - 1] * 0.985);
    }
  }
  // Smoothed in both directions, so it falls in clean sweeps instead of following every bump beneath it,
  // and then kept clear of the body
  for (let pass = 0; pass < 6; pass++) {
    const next = new Float32Array(reach);
    for (let u = 0; u <= ACROSS; u++) {
      for (let v = 0; v <= DOWN; v++) {
        const k = u * rows + v;
        let sum = reach[k] * 2;
        let n = 2;
        if (u > 0) (sum += reach[k - rows]), n++;
        if (u < ACROSS) (sum += reach[k + rows]), n++;
        if (v > 0) (sum += reach[k - 1]), n++;
        if (v < DOWN) (sum += reach[k + 1]), n++;
        next[k] = Math.max(floor[k], sum / n);
      }
    }
    reach = next;
  }

  const hair = new THREE.Color(p.hairColor);
  const outer: number[] = [];
  const inner: number[] = [];
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let u = 0; u <= ACROSS; u++) {
    const a = -CURTAIN_ANGLE + (2 * CURTAIN_ANGLE * u) / ACROSS;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    const band = 0.88 + 0.24 * rand(); // locks of slightly different shade
    // Thin at the side edges, so the curtain ends in soft edges rather than flat panels
    const edge = smooth(Math.min(u, ACROSS - u) / 6);
    for (let v = 0; v <= DOWN; v++) {
      const t = v / DOWN;
      const y = topAt(a) + (ends[u] - topAt(a)) * t;
      const r = reach[u * rows + v];
      // Grows out from nothing under the cap, full through the length, thinning to the tips
      const thick = (0.05 + 0.02 * (1 - t)) * smooth(t / 0.15) * (1 - smooth((t - 0.8) / 0.2)) * edge;
      const r0 = Math.max(r - thick, floor[u * rows + v] - 0.006);
      outer.push(ax + sa * r, y, az - ca * r);
      inner.push(ax + sa * Math.min(r, r0), y, az - ca * Math.min(r, r0));
      c.copy(hair).multiplyScalar(band * (0.82 + 0.18 * t));
      colors.push(c.r, c.g, c.b);
    }
  }

  // Outer and inner surfaces, closed along the top and the two sides (the ends meet at the tips)
  const half = (ACROSS + 1) * rows;
  const vertices = new Float32Array(half * 6);
  vertices.set(outer, 0);
  vertices.set(inner, half * 3);
  const vertexColors = new Float32Array(half * 6);
  vertexColors.set(colors, 0);
  vertexColors.set(colors.map((value) => value * 0.6), half * 3);
  const index: number[] = [];
  const at = (u: number, v: number, side: 0 | 1) => side * half + u * rows + v;
  for (let u = 0; u < ACROSS; u++) {
    for (let v = 0; v < DOWN; v++) {
      index.push(at(u, v, 0), at(u + 1, v, 0), at(u, v + 1, 0), at(u + 1, v, 0), at(u + 1, v + 1, 0), at(u, v + 1, 0));
      index.push(at(u, v, 1), at(u, v + 1, 1), at(u + 1, v, 1), at(u + 1, v, 1), at(u, v + 1, 1), at(u + 1, v + 1, 1));
    }
    index.push(at(u, 0, 0), at(u, 0, 1), at(u + 1, 0, 0), at(u + 1, 0, 0), at(u, 0, 1), at(u + 1, 0, 1));
  }
  for (const u of [0, ACROSS]) {
    for (let v = 0; v < DOWN; v++) {
      const flip = u === 0;
      const quad = [at(u, v, 0), at(u, v + 1, 0), at(u, v, 1), at(u, v + 1, 0), at(u, v + 1, 1), at(u, v, 1)];
      index.push(...(flip ? quad : [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]]));
    }
  }
  // A lock on each side frames the face: it carries on from the curtain's side edge under the cap, runs down
  // behind the ear as if tucked there, then sweeps forward past the jaw and neck and comes over the front of the shoulder onto the chest,
  // lying close to the body all the way (it drifts in quickly, so it does not hang off the cheek). It is a flattened band, thick near the head and tapering to a point.
  const lockVertices: number[] = [];
  const lockColors: number[] = [];
  const LOCK_ROWS = 36;
  const LOCK_SIDES = 12;
  const lockGrow = (t: number) => smooth(t / 0.15) * (1 - 0.85 * smooth((t - 0.6) / 0.4));
  // The body's outline across the whole width of the band at that height (its edges reach round to where
  // the jaw or an ear may stand further out than at its middle)
  const bodyAcross = (a: number, y: number, halfWidth: number) => {
    const spread = halfWidth / Math.max(0.2, bodyAt(a, y));
    let most = 0;
    for (let n = -4; n <= 4; n++) most = Math.max(most, bodyAt(a + (spread * n) / 4, y));
    return most;
  };
  for (const side of [-1, 1]) {
    const first = half * 2 + lockVertices.length / 3;
    const reachAlong: number[] = [];
    const path: { a: number; y: number }[] = [];
    let drift = 0;
    for (let k = 0; k <= LOCK_ROWS; k++) {
      const t = k / LOCK_ROWS;
      // Behind the ear until below it, then sweeping forward (passing over the ear pushed it out like a fin)
      const a = side * (1.2 + 1.35 * smooth((t - 0.3) / 0.6));
      const y = 0.28 + (-1.3 - 0.28) * t;
      const wanted = bodyAcross(a, y, 0.11 * lockGrow(t)) + 0.03;
      drift = k === 0 ? wanted : Math.max(wanted, drift * 0.95);
      reachAlong.push(drift);
      path.push({ a, y });
    }
    // Smoothed along its length so it falls in one sweep, never closer to the body than it may be
    for (let pass = 0; pass < 6; pass++) {
      for (let k = 1; k < LOCK_ROWS; k++) {
        const minimum = bodyAcross(path[k].a, path[k].y, 0.11 * lockGrow(k / LOCK_ROWS)) + 0.03;
        reachAlong[k] = Math.max(minimum, (reachAlong[k - 1] + 2 * reachAlong[k] + reachAlong[k + 1]) / 4);
      }
    }
    const band = 0.92 + 0.12 * rand();
    for (let k = 0; k <= LOCK_ROWS; k++) {
      const t = k / LOCK_ROWS;
      const { a, y } = path[k];
      const r = reachAlong[k];
      const cx = ax + Math.sin(a) * r;
      const cz = az - Math.cos(a) * r;
      // Across the band runs around the neck; through it runs out from the neck
      const grow = lockGrow(t);
      const halfWidth = 0.11 * grow;
      const halfThick = 0.026 * grow;
      for (let j = 0; j < LOCK_SIDES; j++) {
        const angle = (2 * Math.PI * j) / LOCK_SIDES;
        const across = Math.cos(angle) * halfWidth;
        const out = Math.sin(angle) * halfThick;
        lockVertices.push(cx + Math.cos(a) * across + Math.sin(a) * out, y, cz + Math.sin(a) * across - Math.cos(a) * out);
        c.copy(hair).multiplyScalar(band * (0.85 + 0.15 * t) * (0.8 + 0.2 * Math.max(0, Math.sin(angle))));
        lockColors.push(c.r, c.g, c.b);
      }
    }
    for (let k = 0; k < LOCK_ROWS; k++) {
      for (let j = 0; j < LOCK_SIDES; j++) {
        const q0 = first + k * LOCK_SIDES + j;
        const q1 = first + k * LOCK_SIDES + ((j + 1) % LOCK_SIDES);
        const q2 = q0 + LOCK_SIDES;
        const q3 = q1 + LOCK_SIDES;
        if (side > 0) index.push(q0, q2, q1, q1, q2, q3);
        else index.push(q0, q1, q2, q1, q3, q2);
      }
    }
  }

  const all = new Float32Array(vertices.length + lockVertices.length);
  all.set(vertices, 0);
  all.set(lockVertices, vertices.length);
  const allColors = new Float32Array(vertexColors.length + lockColors.length);
  allColors.set(vertexColors, 0);
  allColors.set(lockColors, vertexColors.length);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(all, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(allColors, 3));
  geometry.setIndex(index);
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

export function applyHairDetail(material: THREE.MeshStandardMaterial, p: Params, hanging = false): void {
  // One fixed combing direction per style (stretching the noise along each vertex's own direction scrambled
  // the pattern into specks wherever that direction turned); hanging hair runs straight down
  const direction: [number, number, number] = hanging ? [0, -1, -0.1] : STYLES[p.hairStyle === "none" ? "swept" : p.hairStyle].flow;
  const flow = { value: new THREE.Vector3(...direction).normalize() };
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
  material.customProgramCacheKey = () => `effigy-hair-v3-${hanging ? "hanging" : "scalp"}`;
}
