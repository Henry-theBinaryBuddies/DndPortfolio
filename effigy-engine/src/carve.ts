import * as THREE from "three";

// Carving grooves into a hair or beard shell. The shells (see hairShell.ts) are far too coarse to carry
// grooves a printer can make (their edges are about 0.3 mm), so a shell is subdivided until its edges are
// well under a groove's width, and a pattern says how deep to cut at each point of the outer surface.
//
// A shell is a closed mesh with these per-vertex attributes:
//   hairAmount  how much of it is hair, 0 at its faded edge to 1 well inside
//   headPos     where the vertex lies, in the coordinates the pattern reads (the undeformed head's, so the
//               carving stays with the face however it is reshaped)
// and, if its vertices are not simply "outer surface first, inner surface second":
//   carve       1 for vertices on the surface to carve
//   thick       how thick the shell is there
// Without them, the first half of the vertices is the outer surface, the second half the inner, and the
// thickness is the distance between each outer vertex and its inner twin.

export const CARVE = {
  levels: 2, // each level quarters the triangles: edges of about 0.07 mm at print scale
  // Never cut deeper than this share of the shell's thickness there, so a groove cannot break through
  share: 0.45,
};

export const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export const hash = (k: number) => {
  const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// A V-groove at the middle of each unit of phase: 1 at the centre, 0 at half a width either side
export const vee = (phase: number, halfWidth: number) => {
  const f = phase - Math.floor(phase);
  return Math.max(0, 1 - Math.abs(f - 0.5) / halfWidth);
};

// How deep to cut at a point, in head units
export type Pattern = (x: number, y: number, z: number) => number;

// How a closed shell is split: which vertices each new one lies between, and the new triangles. It depends
// only on the shell's triangles, which depend only on the head and the style, so it is made once.
interface Plan {
  source: Uint32Array;
  index: Uint32Array;
  count: number;
  first: number; // the number of vertices before subdividing
  parentA: Uint32Array;
  parentB: Uint32Array;
}

const plans = new WeakMap<object, Map<string, Plan>>();

function makePlan(source: Uint32Array, first: number): Plan {
  const parentA: number[] = [];
  const parentB: number[] = [];
  let triangles = source;
  let count = first;
  for (let level = 0; level < CARVE.levels; level++) {
    const edges = new Map<number, number>();
    const next = new Uint32Array(triangles.length * 4);
    const middle = (a: number, b: number) => {
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      let m = edges.get(key);
      if (m === undefined) {
        m = count++;
        edges.set(key, m);
        parentA.push(a);
        parentB.push(b);
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
  return { source, index: triangles, count, first, parentA: Uint32Array.from(parentA), parentB: Uint32Array.from(parentB) };
}

// Subdivides a closed shell and cuts the pattern into its outer surface. `owner` and `key` say what the
// subdivision pattern may be cached under (the head, and the style).
export function carveShell(shell: THREE.BufferGeometry, owner: object, key: string, pattern: Pattern): THREE.BufferGeometry {
  const position = shell.attributes.position;
  const first = position.count;
  const source = Uint32Array.from(shell.index!.array);
  let byKey = plans.get(owner);
  if (!byKey) plans.set(owner, (byKey = new Map()));
  let plan = byKey.get(key);
  if (!plan || plan.first !== first || plan.source.length !== source.length || plan.source.some((v, i) => v !== source[i])) {
    plan = makePlan(source, first);
    byKey.set(key, plan);
  }
  const { count, parentA, parentB } = plan;

  const pos = new Float32Array(count * 3);
  const head = new Float32Array(count * 3);
  const hair = new Float32Array(count);
  const thick = new Float32Array(count);
  const outer = new Uint8Array(count);
  pos.set(position.array as Float32Array);
  head.set(shell.attributes.headPos.array as Float32Array);
  hair.set(shell.attributes.hairAmount.array as Float32Array);
  const half = first / 2;
  if (shell.attributes.carve && shell.attributes.thick) {
    const carve = shell.attributes.carve.array;
    thick.set(shell.attributes.thick.array as Float32Array);
    for (let v = 0; v < first; v++) outer[v] = carve[v] > 0.5 ? 1 : 0;
  } else {
    // How thick the shell is at each vertex: the distance from its outer surface to its inner twin
    for (let j = 0; j < half; j++) {
      const d = Math.hypot(pos[j * 3] - pos[(half + j) * 3], pos[j * 3 + 1] - pos[(half + j) * 3 + 1], pos[j * 3 + 2] - pos[(half + j) * 3 + 2]);
      thick[j] = d;
      thick[half + j] = d;
      outer[j] = 1;
    }
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
    outer[v] = outer[a] && outer[b] ? 1 : 0;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(new THREE.BufferAttribute(plan.index, 1));
  geometry.computeVertexNormals();
  const normal = geometry.attributes.normal.array as Float32Array;
  for (let v = 0; v < count; v++) {
    if (!outer[v]) continue;
    // Not at the faded edge of the hair, and never through the shell
    const amount = smooth((hair[v] - 0.3) / 0.4);
    if (amount <= 0) continue;
    const depth = Math.min(pattern(head[v * 3], head[v * 3 + 1], head[v * 3 + 2]) * amount, CARVE.share * thick[v]);
    pos[v * 3] -= normal[v * 3] * depth;
    pos[v * 3 + 1] -= normal[v * 3 + 1] * depth;
    pos[v * 3 + 2] -= normal[v * 3 + 2] * depth;
  }
  geometry.setAttribute("hairAmount", new THREE.BufferAttribute(hair, 1));
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
