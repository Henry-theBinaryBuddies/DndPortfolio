import * as THREE from "three";
import { MM } from "./print";

// Carving a beard the way a sculptor does on a miniature: broad locks separated by V-grooves, with a finer
// groove down the middle of each lock, and a moustache whose locks sweep out from under the nose and down.
// The beard shell (see hairShell.ts) is far too coarse to carry grooves a printer can make (its edges are
// about 0.3 mm), so it is subdivided until its edges are well under a groove's width, and the grooves are cut
// into its outer surface. Everything is sized in print millimetres (print.ts) for a 0.2 mm nozzle.

export const BEARD_CARVING = {
  lockPitch: 2 * MM, // one lock every 2 mm
  lockGroove: 0.5 * MM, // the groove between locks: its width at the surface
  lockDepth: 0.4 * MM,
  fineGroove: 0.4 * MM, // the finer groove down the middle of a lock (a ridge of at least 0.5 mm is left between)
  fineDepth: 0.22 * MM,
  moustachePitch: 1.2 * MM,
  levels: 2, // each level quarters the triangles: edges of about 0.07 mm
  // Never cut deeper than this share of the shell's thickness there, so a groove cannot break through
  share: 0.45,
};

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

const hash = (k: number) => {
  const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// A V-groove at the middle of each unit of phase: 1 at the centre, 0 at half a width either side
const vee = (phase: number, halfWidth: number) => {
  const f = phase - Math.floor(phase);
  return Math.max(0, 1 - Math.abs(f - 0.5) / halfWidth);
};

// How deep the carving is at a point of the face (in the undeformed head's coordinates, so the carving
// stays with the face however it is reshaped), in head units
export function carvingDepth(x: number, y: number, z: number): number {
  const c = BEARD_CARVING;
  // Locks hang down the beard, wavering a little so they do not read as ruled lines. Across them is the
  // angle round the head's vertical axis (as an arc length at about the beard's radius): across the front
  // that is the width, and down the side of the face it is the depth, where the width hardly changes (used
  // as the coordinate, the locks ran round the cheeks in ripples)
  const u = 0.4 * Math.atan2(x, z + 0.3) + 0.012 * Math.sin(y * 11 + x * 7) + 0.006 * Math.sin(y * 23 + 1.7 + z * 5);
  const p1 = u / c.lockPitch;
  const lock = Math.floor(p1);
  // Each groove starts and stops along its length, as separate locks do, and no two are alike
  const major = vee(p1, c.lockGroove / c.lockPitch / 2) * (0.7 + 0.6 * hash(lock)) * (0.6 + 0.4 * Math.sin(y * 13 + lock * 2.3));
  const p2 = p1 + 0.5;
  const fine = vee(p2, c.fineGroove / c.lockPitch / 2) * (0.7 + 0.6 * hash(Math.floor(p2) + 57)) * (0.5 + 0.5 * Math.sin(y * 9 + Math.floor(p2) * 1.7));
  const beard = Math.max(c.lockDepth * major, c.fineDepth * fine);

  // The moustache: locks fanning out from under the nose and down to the corners of the mouth
  const ax = Math.abs(x);
  const zone = smooth((y + 0.4) / 0.05) * (1 - smooth((ax - 0.2) / 0.05));
  if (zone <= 0) return beard;
  const um = Math.atan2(x, -(y + 0.22)) * 0.12 + 0.004 * Math.sin(y * 31 + x * 9);
  const pm = um / c.moustachePitch;
  const lockM = Math.floor(pm);
  const majorM = vee(pm, c.lockGroove / c.moustachePitch / 2) * (0.7 + 0.6 * hash(lockM + 200)) * (0.7 + 0.3 * Math.sin(y * 17 + lockM));
  const fineM = vee(pm + 0.5, c.fineGroove / c.moustachePitch / 2) * (0.7 + 0.6 * hash(lockM + 300)) * 0.8;
  const moustache = Math.max(c.lockDepth * majorM, c.fineDepth * fineM);
  return beard * (1 - zone) + moustache * zone;
}

// How a closed shell is split: which vertices each new one lies between, and the new triangles. It depends
// only on the shell's triangles, which depend only on the head and the beard style, so it is made once.
interface Plan {
  source: Uint32Array;
  index: Uint32Array;
  count: number;
  first: number; // the number of vertices before subdividing
  parentA: Uint32Array;
  parentB: Uint32Array;
  outer: Uint8Array; // 1 for the vertices that lie on the outer surface
}

const plans = new WeakMap<object, Map<string, Plan>>();

function makePlan(source: Uint32Array, first: number, outerCount: number): Plan {
  const parentA: number[] = [];
  const parentB: number[] = [];
  const outerNew: number[] = [];
  const isOuter = (id: number) => (id < first ? id < outerCount : outerNew[id - first] === 1);
  let triangles = source;
  let count = first;
  for (let level = 0; level < BEARD_CARVING.levels; level++) {
    const edges = new Map<number, number>();
    const next = new Uint32Array(triangles.length * 4);
    const middle = (a: number, b: number) => {
      const key = a < b ? a * 2097152 + b : b * 2097152 + a;
      let m = edges.get(key);
      if (m === undefined) {
        m = count++;
        edges.set(key, m);
        parentA.push(a);
        parentB.push(b);
        outerNew.push(isOuter(a) && isOuter(b) ? 1 : 0);
      }
      return m;
    };
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t];
      const b = triangles[t + 1];
      const c = triangles[t + 2];
      const ab = middle(a, b);
      const bc = middle(b, c);
      const ca = middle(c, a);
      next.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], t * 4);
    }
    triangles = next;
  }
  const outer = new Uint8Array(count);
  for (let i = 0; i < first; i++) outer[i] = i < outerCount ? 1 : 0;
  outerNew.forEach((v, i) => (outer[first + i] = v));
  return { source, index: triangles, count, first, parentA: Uint32Array.from(parentA), parentB: Uint32Array.from(parentB), outer };
}

// Subdivides a closed beard shell (outer surface, then the same vertices again as its inner surface, walls
// between) and cuts the carving into the outer surface. The shell must carry headPos (each vertex's place on
// the undeformed head) and hairAmount.
export function carveBeard(shell: THREE.BufferGeometry, owner: object, key: string): THREE.BufferGeometry {
  const position = shell.attributes.position;
  const first = position.count;
  const source = Uint32Array.from(shell.index!.array);
  let byKey = plans.get(owner);
  if (!byKey) plans.set(owner, (byKey = new Map()));
  let plan = byKey.get(key);
  if (!plan || plan.source.length !== source.length || plan.source.some((v, i) => v !== source[i])) {
    plan = makePlan(source, first, first / 2);
    byKey.set(key, plan);
  }

  const { count, parentA, parentB, outer } = plan;
  const pos = new Float32Array(count * 3);
  const head = new Float32Array(count * 3);
  const hair = new Float32Array(count);
  const thick = new Float32Array(count);
  pos.set(position.array as Float32Array);
  head.set(shell.attributes.headPos.array as Float32Array);
  hair.set(shell.attributes.hairAmount.array as Float32Array);
  // How thick the shell is at each vertex: the distance from its outer surface to its inner one
  const half = first / 2;
  for (let j = 0; j < half; j++) {
    const d = Math.hypot(pos[j * 3] - pos[(half + j) * 3], pos[j * 3 + 1] - pos[(half + j) * 3 + 1], pos[j * 3 + 2] - pos[(half + j) * 3 + 2]);
    thick[j] = d;
    thick[half + j] = d;
  }
  for (let i = 0; i < parentA.length; i++) {
    const v = first + i;
    const a = parentA[i];
    const b = parentB[i];
    for (let k = 0; k < 3; k++) {
      pos[v * 3 + k] = (pos[a * 3 + k] + pos[b * 3 + k]) / 2;
      head[v * 3 + k] = (head[a * 3 + k] + head[b * 3 + k]) / 2;
    }
    hair[v] = (hair[a] + hair[b]) / 2;
    thick[v] = (thick[a] + thick[b]) / 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(new THREE.BufferAttribute(plan.index, 1));
  geometry.computeVertexNormals();
  const normal = geometry.attributes.normal.array as Float32Array;
  for (let v = 0; v < count; v++) {
    if (!outer[v]) continue;
    // Not at the faded edge of the beard, and never through the shell
    const amount = smooth((hair[v] - 0.3) / 0.4);
    if (amount <= 0) continue;
    const depth = Math.min(carvingDepth(head[v * 3], head[v * 3 + 1], head[v * 3 + 2]) * amount, BEARD_CARVING.share * thick[v]);
    pos[v * 3] -= normal[v * 3] * depth;
    pos[v * 3 + 1] -= normal[v * 3 + 1] * depth;
    pos[v * 3 + 2] -= normal[v * 3 + 2] * depth;
  }
  geometry.setAttribute("hairAmount", new THREE.BufferAttribute(hair, 1));
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
