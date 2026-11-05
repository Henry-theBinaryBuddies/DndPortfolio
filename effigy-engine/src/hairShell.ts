import * as THREE from "three";
import { scalp, STRIP_HALF_WIDTH } from "./hair";
import { beardWeight } from "./beard";
import { carvingDepth } from "./beardCarve";
import { carveShell } from "./carve";
import { hairPattern, hangingPattern } from "./hairCarve";
import type { HeadBase } from "./headMesh";
import type { HairStyle, Params } from "./params";
import { beardMasses, beardVolume, groomingFrame, scalpContour, sweptClumps, sweptVolume } from "./sculptForms";
import { trimPinchedBoundary } from "./shellRegion";

// Hair as a sculpted shell, the way hair is modelled on a bust: the hair-bearing part of the scalp raised
// into a solid mass whose thickness follows the style (a close crop, a swept-back mane, a mohawk's crest).
// It is one continuous surface, so there are no gaps between clumps, and it sits on the head like a sculpted
// form (which is also what a printer needs).
//
// Every shell vertex is a copy of a head vertex, raised along the head's normal. At the hairline the
// thickness tapers to almost nothing and dips just under the skin, so the hairline blends instead of ending
// in a stepped edge. Each vertex also records how much of it is hair (hairAmount: 1 well inside, 0 at the
// edge).

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
  // How many rings of the head's mesh the thickness takes to build up inside the hairline (the hair's growth map
  // spread inward this many passes). With none, the shell stood almost full height one ring inside its edge and
  // met the skin within a single row of triangles: the line where it went under followed their edges, a sawtooth
  // along the hairline.
  taper?: number;
}

const STYLES: Record<Exclude<HairStyle, "none">, Style> = {
  // A close crop: a short, even cap, about a millimetre (any thinner and there is no carving it, or printing it)
  cropped: { thickness: (_x, y) => 0.025 + 0.012 * smooth((y - 0.1) / 0.4), flow: [0, 0.1, -1], lean: 0 },
  // Swept back: volume lifted at the front and over the crown, carried back along the comb
  swept: { thickness: sweptVolume, clumps: sweptClumps, flow: [-0.65, 0.3, -1], lean: 0.65 },
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
  // Dreadlocks are tubes (see locks.ts) rooted in a close crop, so the scalp is covered between them
  dreadlocks: { thickness: (_x, y) => 0.025 + 0.012 * smooth((y - 0.1) / 0.4), flow: [0, -1, 0], lean: 0 },
};

// The smallest lift off the skin, so the shell never fights the skin for the same depth at the hairline
const SKIN_GAP = 0.0015;

export function buildHairShell(
  p: Params,
  positions: Float32Array,
  normals: Float32Array,
  base: HeadBase,
): THREE.BufferGeometry | null {
  if (p.hairStyle === "none") return null;
  const style = STYLES[p.hairStyle];
  const count = positions.length / 3;

  // How much hair grows at each vertex
  const grow = new Float32Array(count);
  const clear = earClearance(positions, base);
  for (let i = 0; i < count; i++) grow[i] = hairGrowth(p, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], clear[i]);
  return raiseShell(positions, normals, base, grow, { ...style, taper: HAIRLINE_TAPER }, undefined, undefined, clear);
}
const HAIRLINE_TAPER = 3;

// How clear of the ears each vertex of the reshaped head is (0 on them, 1 away): along the surface from the ear
// (see earClear in headMesh.ts), and straight across from it too, since a reshaped ear can lie back over scalp far
// from where it grows (an elf's point is drawn up over the side of the head, onto scalp the hair would cover)
const EAR_NEAR = { margin: 0.02, fade: 0.05 }; // (more than along the surface: an ear lying back over the scalp, as an elf's point does, needs the hair beneath it thinned well clear)
// (`near`: how far off the reshaped ear, straight across, it starts to clear, and over how far; `alongSurface` false
// for the straight distance alone)
// (the hair, the beard and the paint each ask for these of the same bust, so each is worked out once per reshaped
// head and settings and shared: read it, never write to it)
const clearances = new WeakMap<Float32Array, Map<string, Float32Array>>();
export function earClearance(positions: Float32Array, base: HeadBase, near = EAR_NEAR, alongSurface = true): Float32Array {
  const setting = `${near.margin},${near.fade},${alongSurface}`;
  let known = clearances.get(positions);
  if (!known) clearances.set(positions, (known = new Map()));
  const cached = known.get(setting);
  if (cached) return cached;

  const count = positions.length / 3;
  const clear = alongSurface ? Float32Array.from(base.masks.earClear) : new Float32Array(count).fill(1);
  const cell = near.margin + near.fade;
  // The ear's own vertices, by cell (a cell's number packs its three coordinates), and the box round them: a vertex
  // further than a cell outside the box is clear of the ear
  const grid = new Map<number, number[]>();
  const key = (cx: number, cy: number, cz: number) => ((cx + 512) * 1024 + cy + 512) * 1024 + cz + 512;
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    if (base.masks.earClear[i] > 0) continue;
    for (let k = 0; k < 3; k++) {
      low[k] = Math.min(low[k], positions[i * 3 + k]);
      high[k] = Math.max(high[k], positions[i * 3 + k]);
    }
    const at = key(Math.floor(positions[i * 3] / cell), Math.floor(positions[i * 3 + 1] / cell), Math.floor(positions[i * 3 + 2] / cell));
    (grid.get(at) ?? grid.set(at, []).get(at)!).push(i);
  }
  for (let i = 0; i < count; i++) {
    if (clear[i] === 0) continue;
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < low[0] - cell || x > high[0] + cell || y < low[1] - cell || y > high[1] + cell || z < low[2] - cell || z > high[2] + cell) continue;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let d2 = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const ear = grid.get(key(cx + dx, cy + dy, cz + dz));
          if (!ear) continue;
          for (const j of ear) {
            const ex = positions[j * 3] - x;
            const ey = positions[j * 3 + 1] - y;
            const ez = positions[j * 3 + 2] - z;
            d2 = Math.min(d2, ex * ex + ey * ey + ez * ez);
          }
        }
    const d = Math.sqrt(d2);
    if (d < cell) clear[i] = Math.min(clear[i], smooth((d - near.margin) / near.fade));
  }
  known.set(setting, clear);
  return clear;
}

// How much hair grows at a point of the head (0..1), for the style: the scalp, less the shaved sides of a
// mohawk, fading out as it nears an ear (`earClear`, see headMesh.ts), so the hairline tucks round and behind
// the ear instead of over it. (The paint shades the scalp under the hair with it too: see paint.ts.)
export function hairGrowth(p: Params, x: number, y: number, z: number, earClear: number): number {
  if (p.hairStyle === "none") return 0;
  const frame = groomingFrame(p);
  let w = p.hairStyle !== "dreadlocks" ? scalpContour(x / frame.headWidth, (y + 0.59) / frame.headHeight - 0.59, z) : scalp(x, y, z);
  if (p.hairStyle === "mohawk") w *= 1 - smooth((Math.abs(x) - STRIP_HALF_WIDTH) / 0.05);
  return w * earClear;
}

// The hair as it prints: its shell, subdivided and carved into locks (see hairCarve.ts)
export function buildHair(p: Params, positions: Float32Array, normals: Float32Array, base: HeadBase): THREE.BufferGeometry | null {
  if (p.hairStyle === "none") return null;
  const shell = buildHairShell(p, positions, normals, base);
  // (a groove leaves the hair at least a gap's height above the skin: where the shell thins to its edge, grooves cut
  // at their full depth dipped under the skin, and each dip showed as a tooth along the hairline)
  return shell ? carveShell(shell, base, `hair-${p.hairStyle}`, hairPattern(p.hairStyle), 3 * SKIN_GAP) : null;
}

// Raises a solid shell from the head wherever the growth map says hair grows (0..1 per vertex), with the
// style's thickness (times scale, per vertex, if given), carried along its comb by its lean. It is closed:
// an outer surface, an inner one just under the skin, and walls joining them round the edge, so it is a
// solid that prints and that never shows an open underside. Shared by the hair and the beard.
// (floor: where, per head vertex, 0..1, the shell is raised along the skin's own normal)
// (`keepOff`, 0..1 per vertex: where the spread-out margin of the shell may not reach, as the ears for the hair)
function raiseShell(positions: Float32Array, normals: Float32Array, base: HeadBase, grow: Float32Array, style: Style, scale?: Float32Array, floor?: Float32Array, keepOff?: Float32Array): THREE.BufferGeometry | null {
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
  // (spread out, the margin crept back over the top of an ear, a thin film that took the hair's colour: it is held
  // off again, as softly as it fades in, so there is no ledge)
  if (keepOff) for (let i = 0; i < count; i++) soft[i] *= keepOff[i];

  // The growth map tapered inward from the hairline (see Style.taper): by how many rings of the mesh each vertex
  // lies inside it, so it builds up over that many rings whatever the growth map does at its edge
  let inward = grow;
  if (style.taper) {
    const rings = new Float32Array(count).fill(style.taper);
    let front: number[] = [];
    for (let i = 0; i < count; i++)
      if (grow[i] < 0.5) {
        rings[i] = 0;
        front.push(i);
      }
    for (let ring = 1; ring < style.taper && front.length; ring++) {
      const next: number[] = [];
      for (const i of front)
        for (let k = base.offsets[i]; k < base.offsets[i + 1]; k++) {
          const j = base.neighbours[k];
          if (rings[j] > ring) {
            rings[j] = ring;
            next.push(j);
          }
        }
      front = next;
    }
    inward = new Float32Array(count);
    for (let i = 0; i < count; i++) inward[i] = grow[i] * smooth(rings[i] / style.taper);
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
  trimPinchedBoundary(triangles, order.length);

  const total = order.length;
  const out = new Float32Array(total * 6);
  const amount = new Float32Array(total * 2);
  const n = new THREE.Vector3();
  const comb = new THREE.Vector3(...style.flow).normalize();
  const lean = new THREE.Vector3();
  order.forEach((v, j) => {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    n.set(dirs[v * 3], dirs[v * 3 + 1], dirs[v * 3 + 2]).normalize();
    const w = grow[v];
    // Full thickness well inside the hairline, tapering to a hair's breadth at its edge
    const depth = smooth((soft[v] - 0.25) / 0.65) * (style.taper ? smooth((inward[v] - 0.05) / 0.85) : smooth(w / 0.3));
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
    // How much of it is hair, fading out at the hairline
    // (over the same rings as the thickness, with a taper: the colour fading to the roots' tone only over its last
    // ring, the hard hair colour met the skin right where the shell goes under it, along the mesh's rows)
    const hairy = smooth((Math.min(style.taper ? inward[v] : w, soft[v] * 1.6) - 0.02) / 0.5);
    amount[j] = hairy;
    amount[total + j] = hairy;
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
    // Where asked, kept from sinking under the skin it grows from, on the part of the face that faces the
    // viewer: under a full lower lip the skin bulges (the lip is pushed out, the crease below it filled in)
    // and a thin shell smoothed with its neighbours was dragged down into the bulge, leaving a crescent of
    // skin showing through the beard. The shortfall is spread to the neighbours (pushing single points
    // folded the shell), but only inside the floor's own area and only on skin that faces forward: in the
    // crease behind the lip, or by the ear, the skin turns too sharply to push along.
    const facing = (v: number) => smooth((normals[v * 3 + 2] - 0.3) / 0.2);
    let push = new Float32Array(total);
    if (floor) {
      order.forEach((v, j) => {
        const along = disp[j * 3] * normals[v * 3] + disp[j * 3 + 1] * normals[v * 3 + 1] + disp[j * 3 + 2] * normals[v * 3 + 2];
        push[j] = Math.max(0, 2 * SKIN_GAP * anchor[j] - along) * facing(v);
      });
      for (let pass = 0; pass < 6; pass++) {
        const next = new Float32Array(push);
        for (let j = 0; j < total; j++) {
          const near = links[j];
          if (near.length === 0) continue;
          let sum = 0;
          for (const q of near) sum += push[q];
          next[j] = Math.max(push[j], sum / near.length);
        }
        push = next;
      }
    }
    order.forEach((v, j) => {
      const lift = floor ? push[j] * floor[v] : 0;
      for (let k = 0; k < 3; k++) out[j * 3 + k] = positions[v * 3 + k] + disp[j * 3 + k] + normals[v * 3 + k] * lift;
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

  // Where each vertex lies on the undeformed head, so anything carved into the shell stays with the face
  const headPos = new Float32Array(total * 6);
  order.forEach((v, j) => {
    for (let k = 0; k < 3; k++) {
      headPos[j * 3 + k] = base.positions[v * 3 + k];
      headPos[(total + j) * 3 + k] = base.positions[v * 3 + k];
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(out, 3));
  geometry.setAttribute("hairAmount", new THREE.BufferAttribute(amount, 1));
  geometry.setAttribute("headPos", new THREE.BufferAttribute(headPos, 3));
  geometry.setIndex(closed);
  geometry.computeVertexNormals();
  return geometry;
}

// Beards, sculpted like the hair: a shell raised over the beard's region of the face (see beard.ts), with
// its strands running down. A short beard is a close layer; a full one is thick, its chin hanging below the
// jaw; a goatee covers just the chin and the upper lip.
// Broad clumps, as a sculptor would carve them: a few rounded locks running down the beard, with narrow
// partings between them (many narrow ones read as flutes or flames)
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
  // (fuller lobes than before: kept thin, the moustache read as a painted band across the lip; and fuller again, 85% of
  // the beard's thickness at its sides: as thick as the beard, it folded at the corner of the mouth)
  const parted = 0.5 + 0.5 * smooth((ax - 0.004) / 0.035);
  const moustache = 1 - aboveMouth * (1 - 0.85 * parted);
  return underLip * moustache * throat * corners;
}

const BEARD_UNDER_EAR = { margin: 0.004, fade: 0.16, thin: 0.05 }; // straight from the ear: where the beard thins, and to what share

// How clear of the ears the shadow of a beard on the skin keeps (0 on them, 1 away, see paint.ts): further off than
// the hair, so none of it reaches the lobe or the bowl of the ear just inside its rim
const BEARD_EAR = { margin: 0.03, fade: 0.04 };
export function beardEarClearance(positions: Float32Array, base: HeadBase): Float32Array {
  const clear = Float32Array.from(earClearance(positions, base));
  for (let i = 0; i < clear.length; i++) clear[i] = Math.min(clear[i], smooth((base.masks.earDistance[i] - BEARD_EAR.margin) / BEARD_EAR.fade));
  return clear;
}


// The beard's own shape, before it is carved: a closed shell of the head's resolution
export function buildBeardShell(p: Params, positions: Float32Array, normals: Float32Array, base: HeadBase): THREE.BufferGeometry | null {
  if (p.beardStyle === "none") return null;
  const count = positions.length / 3;
  const grow = new Float32Array(count);
  const bp = base.positions;
  const scale = new Float32Array(count);
  const floor = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const ax = Math.abs(bp[i * 3]);
    const y = bp[i * 3 + 1];
    grow[i] = beardWeight(bp[i * 3], y, bp[i * 3 + 2], p.beardStyle, base.masks.lipsSoft[i]);
    scale[i] = beardShaping(bp[i * 3], y, bp[i * 3 + 2]);
    // Under the lower lip, across the width of the mouth
    const band = (1 - smooth((ax - 0.15) / 0.06)) * smooth((y + 0.54) / 0.03) * (1 - smooth((y + 0.37) / 0.03));
    floor[i] = band;
    // ...where the skin tucks into the crease behind the lip, facing up and back, hidden by the lip: no hair
    // there (it only folded over itself in the crease, and nobody sees it)
    grow[i] *= 1 - band * smooth((base.normals[i * 3 + 1] - 0.35) / 0.25);
  }
  // The beard's own shape keeps it off most of the ear (see beardWeight), but it grew on the lobe itself, low on the
  // ear: none grows on the ear's own vertices (and the beard keeps only the triangles where it grows, so none lie on
  // it). Under the lobe, which hangs in front of the beard, the beard is thinner, so the lobe stays outside it
  // instead of sunk in it. Its thickness is what changes, not where it grows: cut back where it grows over a fade,
  // as the hair is, a full beard's thick edge folded over itself here.
  const nearEar = earClearance(positions, base, BEARD_UNDER_EAR, false);
  for (let i = 0; i < count; i++) {
    if (base.masks.earDistance[i] === 0) grow[i] = 0;
    scale[i] *= BEARD_UNDER_EAR.thin + (1 - BEARD_UNDER_EAR.thin) * nearEar[i];
  }
  const kind = p.beardStyle;
  const style: Style = {
    directionSmoothing: 40,
    displacementSmoothing: 40,
    tight: true,
    hang: true,
    thickness: (x, y, z) => {
      const frame = groomingFrame(p);
      return beardVolume(x / frame.headWidth, (y + 0.59) / frame.headHeight - 0.59, z, kind);
    },
    clumps: beardMasses,
    lean: kind === "full" ? 0.95 : kind === "goatee" ? 0.75 : 0.2,
    flow: [0, -1, kind === "full" ? 0.03 : kind === "goatee" ? 0.25 : 0.2],
  };
  return raiseShell(positions, normals, base, grow, style, scale, floor);
}

// The beard as it prints: its shape, subdivided and carved into locks (see beardCarve.ts)
export function buildBeard(p: Params, positions: Float32Array, normals: Float32Array, base: HeadBase): THREE.BufferGeometry | null {
  const shell = buildBeardShell(p, positions, normals, base);
  return shell ? carveShell(shell, base, p.beardStyle, carvingDepth) : null;
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
const CURTAIN_ANGLE = 1.08;
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
    ends.push(-0.7 - 0.55 * Math.max(0, Math.cos(a0 * 1.2)) ** 1.3 - 0.06 * (0.5 + 0.5 * Math.cos(a0 * 7 + 0.35)) - 0.04 * rand());
  }
  for (let pass = 0; pass < 2; pass++) for (let u = 1; u < ACROSS; u++) ends[u] = (ends[u - 1] + 2 * ends[u] + ends[u + 1]) / 4;
  const angleOf = (u: number, t: number) => start[u] + 0.035 * Math.sin(Math.PI * t) * Math.sin(start[u] * 2 + 0.5);
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
      const wave = 0.018 * Math.sin(start[u] * 6 + 1.2 * Math.sin(t * Math.PI)) * Math.sin(Math.PI * t);
      const wanted = body + 0.02 + 0.11 * smooth(t / 0.25) - 0.025 * t + wave;
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

  const outer: number[] = [];
  const inner: number[] = [];
  // For carving: where each curtain vertex lies as an arc round the neck and a height, and how thick it is
  const curtainAt: number[] = [];
  const curtainThick: number[] = [];
  for (let u = 0; u <= ACROSS; u++) {
    // Rounded at the side edges: the outer and inner surfaces close together over the last few columns
    // (rounded over a wide span, so the sides end full and round instead of in a thin line)
    const edge = 0.15 + 0.85 * Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, Math.min(u, ACROSS - u) / 10)) ** 2));
    for (let v = 0; v <= DOWN; v++) {
      const t = v / DOWN;
      const a = angleOf(u, t);
      const y = heightOf(u, t);
      const r = reach[u * rows + v];
      // Grows out from nothing under the cap, full through the length, thinning to the tips
      // (full until near the tips, which close in a rounded end: tapered over the last third, the sides
      // thinned to a sliver)
      const thick = (0.12 + 0.02 * (1 - t)) * smooth(t / 0.15) * Math.sqrt(Math.max(0, 1 - smooth((t - 0.82) / 0.18)));
      const middle = Math.max(r - thick / 2, floor[u * rows + v] - 0.006 + (thick / 2) * edge);
      const ro = middle + (thick / 2) * edge;
      const ri = middle - (thick / 2) * edge;
      outer.push(ax + Math.sin(a) * ro, y, az - Math.cos(a) * ro);
      inner.push(ax + Math.sin(a) * ri, y, az - Math.cos(a) * ri);
      curtainAt.push(0.5 * a, y, 0);
      curtainThick.push(thick * edge);
    }
  }

  // Outer and inner surfaces, closed along the top and the two sides (the ends meet at the tips)
  const half = columns * rows;
  const vertices = new Float32Array(half * 6);
  vertices.set(outer, 0);
  vertices.set(inner, half * 3);
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
  // Broad, asymmetrical tresses frame the face; their volume is part of the printable mesh.
  // A lock on each side frames the face. It starts inside the curtain's side, so it emerges from the mass
  // (laid over it, the two surfaces met in a seam), runs down behind the ear as if tucked there, then sweeps
  // forward past the jaw and neck onto the front of the shoulder and chest, lying close to the body all the
  // way. Its rounded section turns gently as it falls, thick near the head and tapering to a point.
  const lockVertices: number[] = [];
  const lockAt: number[] = [];
  const lockThick: number[] = [];
  const LOCK_ROWS = 36;
  const LOCK_SIDES = 12;
  const lockGrow = (t: number) => smooth(t / 0.14) * (1 - 0.88 * smooth((t - 0.7) / 0.3));
  const lockClearance = (t: number) => 0.018 + 0.055 * smooth(t / 0.14);
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
    const tubeFrom = index.length;
    const reachAlong: number[] = [];
    const path: { a: number; y: number }[] = [];
    let drift = 0;
    for (let k = 0; k <= LOCK_ROWS; k++) {
      const t = k / LOCK_ROWS;
      // Behind the ear until below it, then sweeping forward (passing over the ear pushed it out like a fin)
      const a = side * (1.04 + 1.45 * smooth((t - 0.25) / 0.6));
      const end = side < 0 ? -1.18 : -1.36;
      const y = 0.1 + (end - 0.1) * t;
      const wanted = bodyAcross(a, y, 0.085 * lockGrow(t)) + lockClearance(t);
      drift = k === 0 ? wanted : Math.max(wanted, drift * 0.95);
      reachAlong.push(drift);
      path.push({ a, y });
    }
    // Smoothed along its length so it falls in one sweep, never closer to the body than it may be
    for (let pass = 0; pass < 6; pass++) {
      for (let k = 1; k < LOCK_ROWS; k++) {
        const minimum = bodyAcross(path[k].a, path[k].y, 0.085 * lockGrow(k / LOCK_ROWS)) + lockClearance(k / LOCK_ROWS);
        reachAlong[k] = Math.max(minimum, (reachAlong[k - 1] + 2 * reachAlong[k] + reachAlong[k + 1]) / 4);
      }
    }
    for (let k = 0; k <= LOCK_ROWS; k++) {
      const t = k / LOCK_ROWS;
      const { a, y } = path[k];
      const r = reachAlong[k];
      const cx = ax + Math.sin(a) * r;
      const cz = az - Math.cos(a) * r;
      // Across the band runs around the neck; through it runs out from the neck
      const grow = lockGrow(t);
      // A rounded tress (a flat band read as a strap: a little wider than thick, not twice as wide)
      const halfWidth = 0.085 * grow;
      const halfThick = 0.062 * grow * (0.94 + 0.06 * Math.cos(t * Math.PI * 3 + side));
      for (let j = 0; j < LOCK_SIDES; j++) {
        const angle = (2 * Math.PI * j) / LOCK_SIDES;
        // A slow turn and broad lobes break the uniform strap silhouette. The section stays
        // within halfWidth in every direction, the clearance measured by bodyAcross above.
        const twist = side * 0.38 * Math.sin(Math.PI * t) + 0.12 * Math.sin(2 * Math.PI * t);
        const lobe = 0.95 + 0.05 * Math.cos(3 * angle + side * 0.7 + t * 2);
        const u = Math.cos(angle) * halfWidth * lobe;
        const v = Math.sin(angle) * halfThick * lobe;
        const across = u * Math.cos(twist) - v * Math.sin(twist);
        const out = u * Math.sin(twist) + v * Math.cos(twist);
        lockVertices.push(cx + Math.cos(a) * across + Math.sin(a) * out, y, cz + Math.sin(a) * across - Math.cos(a) * out);
        // (the arc round the tress's own section, offset per side so the two are not mirror images)
        lockAt.push((angle / (2 * Math.PI)) * 2 * Math.PI * 0.05 + side * 0.31, y, 0);
        lockThick.push(2 * halfThick);
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
    // The tip is closed with a cap (its root closes itself: the tress grows from nothing there), so each lock
    // is a closed solid
    const tip = first + LOCK_ROWS * LOCK_SIDES;
    const middle = half * 2 + lockVertices.length / 3;
    let [mx, my, mz] = [0, 0, 0];
    for (let j = 0; j < LOCK_SIDES; j++) {
      const v = (tip - half * 2 + j) * 3;
      mx += lockVertices[v] / LOCK_SIDES;
      my += lockVertices[v + 1] / LOCK_SIDES;
      mz += lockVertices[v + 2] / LOCK_SIDES;
    }
    lockVertices.push(mx, my, mz);
    lockAt.push(side * 0.31, my, 0);
    lockThick.push(0);
    for (let j = 0; j < LOCK_SIDES; j++) {
      const next = tip + ((j + 1) % LOCK_SIDES);
      if (side > 0) index.push(middle, next, tip + j);
      else index.push(middle, tip + j, next);
    }
    // Wound outward, whichever side it is on (by its volume: the two sides were built as mirror images, and
    // one came out inside out)
    let volume = 0;
    const at = (v: number) => (v - half * 2) * 3;
    for (let t = tubeFrom; t < index.length; t += 3) {
      const [a, b, c] = [at(index[t]), at(index[t + 1]), at(index[t + 2])];
      if (a < 0 || b < 0 || c < 0) continue;
      const p = lockVertices;
      volume += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    if (volume < 0) for (let t = tubeFrom; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
  }


  const all = new Float32Array(vertices.length + lockVertices.length);
  all.set(vertices, 0);
  all.set(lockVertices, vertices.length);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(all, 3));
  geometry.setAttribute("hairAmount", new THREE.BufferAttribute(new Float32Array(all.length / 3).fill(1), 1));
  // ...for carving: the outer surface of the curtain and all of the locks, with where each lies and how thick
  geometry.setAttribute("headPos", new THREE.Float32BufferAttribute([...curtainAt, ...curtainAt, ...lockAt], 3));
  geometry.setAttribute("thick", new THREE.Float32BufferAttribute([...curtainThick, ...curtainThick, ...lockThick], 1));
  const carve = new Float32Array(all.length / 3);
  carve.fill(1, 0, half);
  carve.fill(1, half * 2);
  geometry.setAttribute("carve", new THREE.BufferAttribute(carve, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

// Long hair's hanging lengths as they print: subdivided and carved with locks running down them
export function buildHanging(p: Params, positions: Float32Array, base: HeadBase): THREE.BufferGeometry | null {
  const hanging = buildHangingHair(p, positions, base);
  return hanging ? carveShell(hanging, base, "hanging", hangingPattern) : null;
}
