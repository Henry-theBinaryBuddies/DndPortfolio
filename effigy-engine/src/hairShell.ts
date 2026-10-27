import * as THREE from "three";
import { scalp, STRIP_HALF_WIDTH } from "./hair";
import { beardWeight } from "./beard";
import type { HeadBase } from "./headMesh";
import type { Params } from "./params";

// Hair as a sculpted shell, the way hair is modelled on a bust: the hair-bearing part of the scalp raised
// into a solid mass whose thickness follows the style (a close crop, a swept-back mane, a mohawk's crest).
// It is one continuous surface, so there are no gaps between clumps, and it sits on the head like a sculpted
// form (which is also what a printer needs). Strand detail is carved into it by the shader below: fine
// grooves stretched along the direction the hair is combed.
//
// Every shell vertex is a copy of a head vertex, raised along the head's normal. At the hairline the
// thickness tapers to almost nothing and the shell fades to transparent, so the real skin shows through
// with its own shading and the hairline blends instead of ending in a stepped edge. (Colouring the edge to
// match the skin left a lighter, stepped band: it was lit as hair, not as skin.)

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

interface Style {
  thickness: (x: number, y: number, z: number) => number; // in head-local units (1 = 20 cm)
  flow: [number, number, number]; // the direction it is combed
  lean: number; // how far the mass is carried along the combing direction, as a share of its thickness
  // How broadly the direction the shell is raised in is smoothed across the surface (passes over
  // neighbouring vertices). Raised along the skin's own normals, a crease tips them inward and the shell
  // folds into a wall or a point there.
  directionSmoothing?: number;
  clumps?: (x: number, y: number, z: number) => number; // sculpted clumps: a factor on the thickness
  // How much the displacement off the skin is smoothed across the shell (passes). Neighbouring vertices
  // that move very differently fold the surface over itself: a full beard's lean pushed the front of the
  // chin down past its own underside.
  displacementSmoothing?: number;
  // Hang the lean in one straight direction (the comb) rather than along the surface. A beard hangs: along
  // the surface, the lean nearly vanished where the chin turns under and the front slid past it.
  hang?: boolean;
  // Only where it actually grows, not over the wider faded margin round it (a beard's margin reached into
  // the corners of the mouth, where the sculpt's lips meet through unconnected vertices)
  tight?: boolean;
}

const STYLES: Record<"cropped" | "swept" | "mohawk" | "long", Style> = {
  // A close crop: a short, even cap of a few millimetres
  cropped: { thickness: (_x, y) => 0.012 + 0.008 * smooth((y - 0.1) / 0.4), flow: [0, 0.1, -1], lean: 0 },
  // Swept back: volume lifted at the front and over the crown, carried back along the comb
  swept: {
    thickness: (_x, y, z) =>
      0.018 + 0.05 * smooth((y - 0.05) / 0.35) * (1 - 0.4 * smooth((-z - 0.5) / 0.3)) + 0.03 * smooth((y - 0.25) / 0.15) * smooth((z + 0.15) / 0.2) + 0.02 * smooth((-z - 0.2) / 0.3),
    flow: [0, 0.3, -1],
    lean: 0.6,
  },
  // A crest along the middle of the head, swept back and built from a row of distinct clumps, each rising
  // to its own peak, narrower toward the top (a crest that rose straight up to a narrow edge read as a
  // single fin or horn, and a smooth one as a single hump)
  mohawk: {
    thickness: (x, y, z) => {
      const wave = 0.5 + 0.5 * Math.cos(z * 16 + 0.6); // one clump about every 8 cm
      const clump = 0.55 + 0.45 * wave * wave;
      const halfWidth = STRIP_HALF_WIDTH * (0.75 + 0.25 * wave);
      const across = 1 - smooth(Math.abs(x) / halfWidth);
      return 0.02 + 0.15 * Math.pow(across, 0.7) * smooth((y + 0.2) / 0.5) * clump;
    },
    flow: [0, 0.3, -1],
    lean: 0.35, // (leaning a tall crest further folded its surface over where it curves down the back)
  },
  // Long hair: a cap over the scalp (the hanging lengths are a draped curtain, see buildHangingHair)
  long: { thickness: (_x, y) => 0.025 + 0.02 * smooth((y - 0.1) / 0.4), flow: [0, -0.1, -1], lean: 0.3 },
};

// The smallest lift off the skin, so the shell never fights the skin for the same depth at the hairline
const SKIN_GAP = 0.0015;

export function buildHairShell(
  p: Params,
  positions: Float32Array,
  normals: Float32Array,
  base: HeadBase,
  _skinColors: Float32Array,
): THREE.BufferGeometry | null {
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
  return raiseShell(positions, normals, base, grow, style, new THREE.Color(p.hairColor));
}

// Raises a solid shell from the head wherever the growth map says hair grows (0..1 per vertex), with the
// style's thickness (times scale, per vertex, if given), carried along its comb by its lean. It is closed:
// an outer surface, an inner one just under the skin, and walls joining them round the edge, so it is a
// solid that prints and that never shows an open underside. Shared by the hair and the beard.
function raiseShell(positions: Float32Array, normals: Float32Array, base: HeadBase, grow: Float32Array, style: Style, hair: THREE.Color, scale?: Float32Array): THREE.BufferGeometry | null {
  const indices = base.indices;
  const count = positions.length / 3;

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

  // The direction to raise each vertex in: the skin's normals, smoothed across the surface
  let dirs = new Float32Array(normals);
  for (let pass = 0; pass < (style.directionSmoothing ?? 8); pass++) {
    const next = new Float32Array(dirs.length);
    for (let i = 0; i < count; i++) {
      const from = base.offsets[i];
      const to = base.offsets[i + 1];
      let x = dirs[i * 3];
      let y = dirs[i * 3 + 1];
      let z = dirs[i * 3 + 2];
      for (let k = from; k < to; k++) {
        const j = base.neighbours[k];
        x += dirs[j * 3];
        y += dirs[j * 3 + 1];
        z += dirs[j * 3 + 2];
      }
      const length = Math.hypot(x, y, z) || 1;
      next[i * 3] = x / length;
      next[i * 3 + 1] = y / length;
      next[i * 3 + 2] = z / length;
    }
    dirs = next;
  }

  // The triangles that carry hair, and the vertices they use
  const triangles: number[] = [];
  const used = new Int32Array(count).fill(-1);
  const order: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    if (grow[a] <= 0.01 && grow[b] <= 0.01 && grow[c] <= 0.01 && (style.tight || soft[a] <= 0.02)) continue;
    for (const v of [a, b, c]) {
      if (used[v] < 0) {
        used[v] = order.length;
        order.push(v);
      }
    }
    triangles.push(used[a], used[b], used[c]);
  }
  if (triangles.length === 0) return null;

  const total = order.length;
  const out = new Float32Array(total * 6);
  const colors = new Float32Array(total * 8);
  const amount = new Float32Array(total * 2);
  const n = new THREE.Vector3();
  const comb = new THREE.Vector3(...style.flow).normalize();
  const lean = new THREE.Vector3();
  const c = new THREE.Color();
  order.forEach((v, j) => {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    n.set(dirs[v * 3], dirs[v * 3 + 1], dirs[v * 3 + 2]).normalize();
    const w = grow[v];
    // Full thickness well inside the hairline, tapering to a hair's breadth at its edge
    const depth = smooth((soft[v] - 0.25) / 0.65) * smooth(w / 0.3);
    // Clumps and lean fade out toward the edge, so the shell never overhangs its own root (where it did, its
    // edge ended in knife-thin points with an open underside showing)
    const settle = smooth(depth / 0.35);
    const clumped = 1 + ((style.clumps ? style.clumps(x, y, z) : 1) - 1) * settle;
    // At the very edge it dips just under the skin, so it meets the skin without a step
    const root = SKIN_GAP * (2 * smooth(w / 0.08) - 1);
    const lift = root + style.thickness(x, y, z) * (scale ? scale[v] : 1) * clumped * depth;
    // ...and carried along the comb, so a swept style's mass leans back instead of rising straight up
    if (style.hang) lean.copy(comb);
    else lean.copy(comb).addScaledVector(n, -comb.dot(n));
    if (lean.lengthSq() > 1e-6) lean.normalize().multiplyScalar(Math.max(0, lift - root) * style.lean * settle);
    else lean.set(0, 0, 0);
    out[j * 3] = x + n.x * lift + lean.x;
    out[j * 3 + 1] = y + n.y * lift + lean.y;
    out[j * 3 + 2] = z + n.z * lift + lean.z;
    // The inner surface, just under the skin
    out[(total + j) * 3] = x - n.x * 2 * SKIN_GAP;
    out[(total + j) * 3 + 1] = y - n.y * 2 * SKIN_GAP;
    out[(total + j) * 3 + 2] = z - n.z * 2 * SKIN_GAP;
    // Darker near the roots (where the hair is thin and shadowed), and fading out at the hairline
    c.copy(hair).multiplyScalar(0.75 + 0.25 * smooth((w - 0.3) / 0.7));
    const hairy = smooth((Math.min(w, soft[v] * 1.6) - 0.02) / 0.5);
    for (const k of [j, total + j]) {
      amount[k] = hairy;
      colors[k * 4] = c.r;
      colors[k * 4 + 1] = c.g;
      colors[k * 4 + 2] = c.b;
      colors[k * 4 + 3] = hairy;
    }
  });

  // Smooth the displacement off the skin across the shell, so no part slides past its neighbours and folds.
  // The edge stays anchored where it meets the skin.
  const passes = style.displacementSmoothing ?? 4;
  if (passes > 0) {
    const links: number[][] = Array.from({ length: total }, () => []);
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t];
      const b = triangles[t + 1];
      const c2 = triangles[t + 2];
      links[a].push(b, c2);
      links[b].push(a, c2);
      links[c2].push(a, b);
    }
    const anchor = new Float32Array(total);
    let disp = new Float32Array(total * 3);
    order.forEach((v, j) => {
      anchor[j] = smooth((Math.min(grow[v], soft[v] * 1.6) - 0.05) / 0.4);
      for (let k = 0; k < 3; k++) disp[j * 3 + k] = out[j * 3 + k] - positions[v * 3 + k];
    });
    for (let pass = 0; pass < passes; pass++) {
      const next = new Float32Array(disp);
      for (let j = 0; j < total; j++) {
        const near = links[j];
        if (near.length === 0) continue;
        for (let k = 0; k < 3; k++) {
          let sum = 0;
          for (const q of near) sum += disp[q * 3 + k];
          next[j * 3 + k] = disp[j * 3 + k] + 0.5 * anchor[j] * (sum / near.length - disp[j * 3 + k]);
        }
      }
      disp = next;
    }
    order.forEach((v, j) => {
      for (let k = 0; k < 3; k++) out[j * 3 + k] = positions[v * 3 + k] + disp[j * 3 + k];
    });
  }

  // Close it: the inner surface faces the other way, and a wall runs round every open edge
  const closed = triangles.slice();
  const edgeUse = new Map<string, number>();
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t];
    const b = triangles[t + 1];
    const c2 = triangles[t + 2];
    closed.push(total + a, total + c2, total + b);
    for (const [p0, p1] of [
      [a, b],
      [b, c2],
      [c2, a],
    ]) {
      const key = p0 < p1 ? `${p0},${p1}` : `${p1},${p0}`;
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  }
  for (let t = 0; t < triangles.length; t += 3) {
    for (const [p0, p1] of [
      [triangles[t], triangles[t + 1]],
      [triangles[t + 1], triangles[t + 2]],
      [triangles[t + 2], triangles[t]],
    ]) {
      const key = p0 < p1 ? `${p0},${p1}` : `${p1},${p0}`;
      if (edgeUse.get(key) !== 1) continue;
      // An open edge of the outer surface (p0 -> p1 in its winding): wall down to the inner surface
      closed.push(p1, p0, total + p0, p1, total + p0, total + p1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(out, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  // How much is hair rather than the skin-coloured edge, so the shader leaves strand grooves off the skin
  geometry.setAttribute("hairAmount", new THREE.BufferAttribute(amount, 1));
  geometry.setIndex(closed);
  geometry.computeVertexNormals();
  return geometry;
}

// Beards, sculpted like the hair: a shell raised over the beard's region of the face (see beard.ts), with
// its strands running down. A short beard is a close layer; a full one is thick, its chin hanging below the
// jaw; a goatee covers just the chin and the upper lip. Stubble is only painted (see face.ts).
// Broad clumps, as a sculptor would carve them: a few rounded locks running down the beard, with narrow
// partings between them (many narrow ones read as flutes or flames)
const beardClumps = (x: number, y: number, z: number) => 0.68 + 0.32 * Math.pow(0.5 + 0.5 * Math.cos(Math.atan2(x, z + 0.3) * 11 + 2 * Math.sin(y * 6)), 0.6);
const BEARDS: Record<"goatee" | "short" | "full", Style> = {
  goatee: { thickness: (_x, y) => 0.012 + 0.035 * smooth((-0.45 - y) / 0.12), flow: [0, -1, 0.25], lean: 0.5, directionSmoothing: 40, clumps: beardClumps, tight: true, displacementSmoothing: 30, hang: true },
  short: {
    thickness: (_x, y) => 0.01 + 0.006 * smooth((-0.45 - y) / 0.12),
    flow: [0, -1, 0.2],
    lean: 0.2,
    directionSmoothing: 40,
    clumps: (x, y, z) => 0.92 + 0.08 * (beardClumps(x, y, z) - 0.68) / 0.32,
    tight: true,
    displacementSmoothing: 30, hang: true,
  },
  full: {
    thickness: (x, y) => {
      // Thickest at the chin and along the jaw
      // (less forward bulk and more hang, so it falls toward a rounded point instead of swelling into a ball)
      const chin = smooth((-0.45 - y) / 0.15) * (1 - 0.5 * smooth((Math.abs(x) - 0.18) / 0.15));
      return 0.024 + 0.1 * chin;
    },
    flow: [0, -1, 0.15],
    lean: 1.4,
    directionSmoothing: 40,
    clumps: beardClumps,
    tight: true,
    displacementSmoothing: 30, hang: true,
  },
};

// Shaping that belongs to the face, measured on the undeformed head so it stays with the lips whatever the
// Lips and Jaw sliders do (measured on the reshaped face, a full lower lip moved away from it and left a
// notch): under the lower lip the beard thins to its root before building toward the chin, so it never
// rises into a wall facing the lip; the moustache is two lobes parted under the nose, kept thin so the
// mouth stays clear.
function beardShaping(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  // Thin under the jaw where it meets the throat, a sharply concave crease where a thick shell folds over
  // itself; the beard's mass hangs from the front of the chin instead
  const throat = 1 - 0.92 * smooth((-0.52 - y) / 0.08) * smooth((0.06 - z) / 0.14);
  // ...and thin at the corners of the mouth, another concave crease
  const corners = 1 - 0.7 * Math.exp(-(((ax - 0.14) / 0.05) ** 2) - ((y + 0.34) / 0.07) ** 2);
  const underLip = 1 - 0.85 * Math.exp(-(((y + 0.435) / 0.035) ** 2)) * (1 - smooth((ax - 0.12) / 0.06));
  const aboveMouth = smooth((y + 0.34) / 0.05);
  // (fuller lobes than before: kept thin, the moustache read as a painted band across the lip)
  const parted = 0.45 + 0.55 * smooth((ax - 0.004) / 0.035);
  const moustache = 1 - aboveMouth * (1 - 0.65 * parted);
  return underLip * moustache * throat * corners;
}

export function buildBeard(p: Params, positions: Float32Array, normals: Float32Array, base: HeadBase): THREE.BufferGeometry | null {
  if (p.beardStyle === "none" || p.beardStyle === "stubble") return null;
  const count = positions.length / 3;
  const grow = new Float32Array(count);
  const bp = base.positions;
  const scale = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    grow[i] = beardWeight(bp[i * 3], bp[i * 3 + 1], bp[i * 3 + 2], p.beardStyle, base.masks.lipsSoft[i]);
    scale[i] = beardShaping(bp[i * 3], bp[i * 3 + 1], bp[i * 3 + 2]);
  }
  return raiseShell(positions, normals, base, grow, BEARDS[p.beardStyle], new THREE.Color(p.hairColor).multiplyScalar(0.92), scale);
}

// Long hair's hanging lengths: a curtain draped from the scalp down the back, sculpted as one solid mass like
// the rest of the hair, and a lock on each side that frames the face. At every height and angle around the
// neck the curtain hangs just outside the body, drifting inward only slowly as it falls, so it drapes from
// the widest part of the skull over the upper back. It is thick near the head, thins toward uneven, layered
// ends, and has rounded side edges (thinned to nothing, they read as separate straps). The ears are left out
// of the outline the hair drapes around: hair falls behind them, and an elf's long ears poke through it
// instead of the hair looping round them. (Sweeping the curtain itself forward wrapped it over the shoulders
// like a stole.)
// How far round from the back it reaches, either side (radians; the ears are at about 1.45). Kept on the back
// behind the neck: reaching further, its sides lay over the slope of the shoulders, seen edge-on as a sliver.
const CURTAIN_ANGLE = 0.85;
const CURTAIN_TOP = 0.32; // where it starts under the cap at the back of the head (lower at the sides)
const ACROSS = 80;
const DOWN = 44;

export function buildHangingHair(p: Params, positions: Float32Array, base: HeadBase): THREE.BufferGeometry | null {
  if (p.hairStyle !== "long") return null;
  const ax = base.neck.x;
  const az = base.neck.z;
  const count = positions.length / 3;

  // The body's outline: the furthest the surface reaches from the neck's axis, by angle (all the way round,
  // 0 straight behind) and height. Ears are left out.
  const ANGLE_BINS = 128;
  const HEIGHT_BINS = 100;
  const lowest = -1.6;
  const angleBin = (a: number) => ((Math.floor(((a + Math.PI) / (2 * Math.PI)) * ANGLE_BINS) % ANGLE_BINS) + ANGLE_BINS) % ANGLE_BINS;
  const heightBin = (y: number) => Math.floor(((CURTAIN_TOP + 0.3 - y) / (CURTAIN_TOP + 0.3 - lowest)) * HEIGHT_BINS);
  let outline = new Float32Array(ANGLE_BINS * HEIGHT_BINS);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (Math.abs(x) > 0.36 && y > -0.35 && y < 0.5 && z > -0.8 && z < -0.15) continue;
    const dx = x - ax;
    const dz = z - az;
    const hi = heightBin(y);
    if (hi < 0 || hi >= HEIGHT_BINS) continue;
    const ai = angleBin(Math.atan2(dx, -dz));
    outline[hi * ANGLE_BINS + ai] = Math.max(outline[hi * ANGLE_BINS + ai], Math.hypot(dx, dz));
  }
  // Grown a little in every direction, so the hair clears the surface between samples too
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
  // ...and blurred, since the furthest vertex in each sample is noisy, and wherever the hair rests on the
  // body it would take on that noise as ridges
  for (let pass = 0; pass < 4; pass++) {
    const next = new Float32Array(outline);
    for (let h = 1; h < HEIGHT_BINS - 1; h++) {
      for (let a = 0; a < ANGLE_BINS; a++) {
        const left = outline[h * ANGLE_BINS + ((a + ANGLE_BINS - 1) % ANGLE_BINS)];
        const right = outline[h * ANGLE_BINS + ((a + 1) % ANGLE_BINS)];
        const k = h * ANGLE_BINS + a;
        next[k] = Math.max(outline[k] * 0.9, (2 * outline[k] + left + right + outline[k - ANGLE_BINS] + outline[k + ANGLE_BINS]) / 6);
      }
    }
    outline = next;
  }
  // Read smoothly between samples (snapping to the nearest one gave neighbouring columns slightly different
  // floors, which showed as vertical ridges)
  const bodyAt = (a: number, y: number) => {
    const fa = ((a + Math.PI) / (2 * Math.PI)) * ANGLE_BINS - 0.5;
    const fh = ((CURTAIN_TOP + 0.3 - y) / (CURTAIN_TOP + 0.3 - lowest)) * HEIGHT_BINS - 0.5;
    const a0 = Math.floor(fa);
    const h0 = Math.min(HEIGHT_BINS - 2, Math.max(0, Math.floor(fh)));
    const ta = fa - a0;
    const th = Math.min(1, Math.max(0, fh - h0));
    const cell = (h: number, a2: number) => outline[h * ANGLE_BINS + (((a2 % ANGLE_BINS) + ANGLE_BINS) % ANGLE_BINS)];
    const lo = cell(h0, a0) * (1 - ta) + cell(h0, a0 + 1) * ta;
    const hi = cell(h0 + 1, a0) * (1 - ta) + cell(h0 + 1, a0 + 1) * ta;
    return lo * (1 - th) + hi * th;
  };

  let seed = 4242;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const columns = ACROSS + 1;
  const rows = DOWN + 1;
  // Each column's angle, where it starts and where it ends
  const start: number[] = [];
  const top: number[] = [];
  const ends: number[] = [];
  for (let u = 0; u <= ACROSS; u++) {
    const a0 = -CURTAIN_ANGLE + (2 * CURTAIN_ANGLE * u) / ACROSS;
    start.push(a0);
    top.push(0.05 + (CURTAIN_TOP - 0.05) * Math.cos(a0 * 0.9) ** 2);
    // A curved, layered hem: longest down the middle of the back, and ending at the sides on the neck, above
    // the rise of the shoulders (sides that reached the shoulders followed them outward and lay across them
    // as a thin flap)
    ends.push(-0.7 - 0.55 * Math.max(0, Math.cos(a0 * 1.2)) ** 1.3 - 0.08 * rand());
  }
  for (let pass = 0; pass < 2; pass++) for (let u = 1; u < ACROSS; u++) ends[u] = (ends[u - 1] + 2 * ends[u] + ends[u + 1]) / 4;
  const angleOf = (u: number, _t: number) => start[u];
  const heightOf = (u: number, t: number) => top[u] + (ends[u] - top[u]) * t;

  // How far out the drape hangs at each point: just off the body, drifting inward only slowly as it falls
  let reach = new Float32Array(columns * rows);
  const floor = new Float32Array(columns * rows);
  for (let u = 0; u <= ACROSS; u++) {
    for (let v = 0; v <= DOWN; v++) {
      const t = v / DOWN;
      const body = bodyAt(angleOf(u, t), heightOf(u, t));
      floor[u * rows + v] = body + 0.012;
      // (starting just under the cap's surface, so no edge stands proud of it, then swelling to full depth)
      // (standing off the back with some volume, rather than shrink-wrapped onto it)
      const wanted = body + 0.03 + 0.09 * smooth(t / 0.25) - 0.03 * t;
      reach[u * rows + v] = v === 0 ? wanted : Math.max(wanted, reach[u * rows + v - 1] * 0.985);
    }
  }
  // Smoothed in both directions, so it falls in clean sweeps instead of following every bump beneath it,
  // and then kept clear of the body
  for (let pass = 0; pass < 14; pass++) {
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
    const band = 0.88 + 0.24 * rand(); // locks of slightly different shade
    // Rounded at the side edges: the outer and inner surfaces close together over the last few columns
    // (rounded over a wide span, so the sides end full and round instead of in a thin line)
    const edge = Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, Math.min(u, ACROSS - u) / 10)) ** 2));
    for (let v = 0; v <= DOWN; v++) {
      const t = v / DOWN;
      const a = angleOf(u, t);
      const y = heightOf(u, t);
      const r = reach[u * rows + v];
      // Grows out from nothing under the cap, full through the length, thinning to the tips
      // (full until near the tips, which close in a rounded end: tapered over the last third, the sides
      // thinned to a sliver)
      const thick = (0.09 + 0.03 * (1 - t)) * smooth(t / 0.15) * Math.sqrt(Math.max(0, 1 - smooth((t - 0.82) / 0.18)));
      const middle = Math.max(r - thick / 2, floor[u * rows + v] - 0.006 + (thick / 2) * edge);
      const ro = middle + (thick / 2) * edge;
      const ri = middle - (thick / 2) * edge;
      outer.push(ax + Math.sin(a) * ro, y, az - Math.cos(a) * ro);
      inner.push(ax + Math.sin(a) * ri, y, az - Math.cos(a) * ri);
      c.copy(hair).multiplyScalar(band * (0.82 + 0.18 * t));
      colors.push(c.r, c.g, c.b);
    }
  }

  // Outer and inner surfaces, closed along the top and the two sides (the ends meet at the tips)
  const half = columns * rows;
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
      const quad = [at(u, v, 0), at(u, v + 1, 0), at(u, v, 1), at(u, v + 1, 0), at(u, v + 1, 1), at(u, v, 1)];
      index.push(...(u === 0 ? quad : [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]]));
    }
  }
  // A lock on each side frames the face. It starts inside the curtain's side, so it emerges from the mass
  // (laid over it, the two surfaces met in a seam), runs down behind the ear as if tucked there, then sweeps
  // forward past the jaw and neck onto the front of the shoulder and chest, lying close to the body all the
  // way. It is a flattened band, thick near the head and tapering to a point.
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
      const a = side * (0.95 + 1.6 * smooth((t - 0.3) / 0.6));
      const y = 0.12 + (-1.3 - 0.12) * t;
      const wanted = bodyAcross(a, y, 0.055 * lockGrow(t)) + 0.05;
      drift = k === 0 ? wanted : Math.max(wanted, drift * 0.95);
      reachAlong.push(drift);
      path.push({ a, y });
    }
    // Smoothed along its length so it falls in one sweep, never closer to the body than it may be
    for (let pass = 0; pass < 6; pass++) {
      for (let k = 1; k < LOCK_ROWS; k++) {
        const minimum = bodyAcross(path[k].a, path[k].y, 0.055 * lockGrow(k / LOCK_ROWS)) + 0.05;
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
      // A rounded tress (a flat band read as a strap)
      const halfWidth = 0.055 * grow;
      const halfThick = 0.042 * grow;
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
  geometry.setAttribute("hairAmount", new THREE.BufferAttribute(new Float32Array(all.length / 3).fill(1), 1));
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
  return 0.75 * hnoise(q * 48.0) + 0.25 * hnoise(q * 120.0 + 7.0);
}
`;

export function applyHairDetail(material: THREE.MeshStandardMaterial, p: Params, part: "scalp" | "hanging" | "beard" = "scalp"): void {
  // One fixed combing direction per style (stretching the noise along each vertex's own direction scrambled
  // the pattern into specks wherever that direction turned); hanging hair runs straight down
  const direction: [number, number, number] =
    part === "hanging"
      ? [0, -1, -0.1]
      : part === "beard"
        ? BEARDS[p.beardStyle === "goatee" || p.beardStyle === "short" || p.beardStyle === "full" ? p.beardStyle : "short"].flow
        : STYLES[p.hairStyle === "none" ? "swept" : p.hairStyle].flow;
  const flow = { value: new THREE.Vector3(...direction).normalize() };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlow = flow;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float hairAmount;\nvarying float vHairAmount;\nvarying vec3 vHairPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHairPos = position;\nvHairAmount = hairAmount;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform vec3 uFlow;\nvarying float vHairAmount;\nvarying vec3 vHairPos;\n${HAIR_HEIGHT}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  float strand = strands(vHairPos, uFlow);
  diffuseColor.rgb *= mix(1.0, 0.72 + 0.45 * strand, vHairAmount);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  vec3 surf = -vViewPosition;
  vec3 sX = dFdx(surf);
  vec3 sY = dFdy(surf);
  float hh = strands(vHairPos, uFlow) * 0.003 * vHairAmount;
  vec2 dH = vec2(dFdx(hh), dFdy(hh));
  vec3 R1 = cross(sY, normal);
  vec3 R2 = cross(normal, sX);
  float det = dot(sX, R1);
  vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
  normal = normalize(normal - grad / max(abs(det), 1e-12));
}`,
      );
  };
  material.customProgramCacheKey = () => `effigy-hair-v4-${part}`;
}
