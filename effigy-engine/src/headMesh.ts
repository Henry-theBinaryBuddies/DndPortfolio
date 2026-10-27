import * as THREE from "three";

// The sculpted base head the whole app deforms. It is a CC0 mesh (see public/models/README.md), exported
// to a small binary file. Everything downstream works in "head-local" units: the origin is the midpoint
// between the eyes, +y is up, +z is the way the face points, and one unit is 20 cm.

export const SCALE = 5;

// Where the eyes sit in the source file's own units (metres): the midpoint between the eyes, and the
// eyeball radius that fits this head's eyelids. The bundle's own eyeball mesh is larger (12.4 mm), but the
// head's lids are modelled around a smaller eye: its skin comes within 8.7 mm of the eye's centre, so a
// 9.4 mm eyeball sits snugly against the lids without poking through. The head is symmetric about x = EYE_X.
const SOURCE = { eyeX: 1.785735, eyeY: 0.76586, eyeZ: 0.12507, eyeRadius: 0.0094, eyeHalfSpacing: 0.03214 };

// Landmarks measured along the face's centre line, in head-local units. Used to place paint and
// features on the real anatomy instead of guessing.
export const LANDMARK = {
  top: 0.565,
  nasion: 0.006, // the dip between the eyes
  noseTip: -0.168,
  subnasale: -0.25, // where the nose meets the upper lip
  upperLip: -0.326,
  stomion: -0.363, // the mouth line
  lowerLip: -0.4,
  mentolabial: -0.451, // the crease under the lower lip
  pogonion: -0.493, // front of the chin
  menton: -0.59, // bottom of the chin
  eyeX: SOURCE.eyeHalfSpacing * SCALE,
  eyeRadius: SOURCE.eyeRadius * SCALE,
} as const;

export type Vec3 = [number, number, number];

export interface HeadBase {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  // Which vertices touch which: neighbours of vertex i are neighbours[offsets[i] .. offsets[i + 1]]
  offsets: Uint32Array;
  neighbours: Uint32Array;
  eyes: { left: Vec3; right: Vec3; radius: number };
  baseY: number; // the flat underside the bust stands on
  bottom: Uint32Array; // the vertices on that underside, used to centre the bust on its plinth
  // Per-vertex landmark weights (0..1) measured on the undeformed head, so paint stays on the lips,
  // mouth line, brows and nostrils however the face is reshaped
  masks: { lips: Float32Array; mouthLine: Float32Array; brows: Float32Array; nostrils: Float32Array };
  neck: { x: number; z: number }; // centre line of the neck
}

// Turns the raw file into a normalised mesh with normals and connectivity.
export function parseHead(buffer: ArrayBuffer): HeadBase {
  const header = new Uint32Array(buffer, 0, 2);
  const vertexCount = header[0];
  const triangleCount = header[1];
  const raw = new Float32Array(buffer, 8, vertexCount * 3);
  const indices = new Uint32Array(buffer.slice(8 + vertexCount * 12, 8 + vertexCount * 12 + triangleCount * 12));

  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3] = (raw[i * 3] - SOURCE.eyeX) * SCALE;
    positions[i * 3 + 1] = (raw[i * 3 + 1] - SOURCE.eyeY) * SCALE;
    positions[i * 3 + 2] = (raw[i * 3 + 2] - SOURCE.eyeZ) * SCALE;
  }

  const sets: Set<number>[] = Array.from({ length: vertexCount }, () => new Set<number>());
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    sets[a].add(b).add(c);
    sets[b].add(a).add(c);
    sets[c].add(a).add(b);
  }
  const offsets = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) offsets[i + 1] = offsets[i] + sets[i].size;
  const neighbours = new Uint32Array(offsets[vertexCount]);
  for (let i = 0; i < vertexCount; i++) neighbours.set([...sets[i]], offsets[i]);

  // The shoulders and chest are built from a few coarse rings, which leaves flat facets in the silhouette.
  // A shrink-free smoothing pass (Taubin: smooth, then inflate a little) rounds them without thinning the
  // body. It fades out above the shoulders, so the neck and face are untouched, and at the flat underside.
  let lowest = Infinity;
  for (let i = 0; i < vertexCount; i++) lowest = Math.min(lowest, positions[i * 3 + 1]);
  const smoothWeight = new Float32Array(vertexCount);
  const ease = (t: number) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };
  for (let i = 0; i < vertexCount; i++) {
    const y = positions[i * 3 + 1];
    smoothWeight[i] = ease((-0.88 - y) / 0.16) * ease((y - lowest) / 0.1);
  }
  const relaxed = new Float32Array(positions.length);
  const relax = (factor: number) => {
    for (let i = 0; i < vertexCount; i++) {
      const w = smoothWeight[i];
      const from = offsets[i];
      const to = offsets[i + 1];
      if (w === 0 || to === from) {
        relaxed[i * 3] = positions[i * 3];
        relaxed[i * 3 + 1] = positions[i * 3 + 1];
        relaxed[i * 3 + 2] = positions[i * 3 + 2];
        continue;
      }
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let j = from; j < to; j++) {
        const n = neighbours[j] * 3;
        sx += positions[n];
        sy += positions[n + 1];
        sz += positions[n + 2];
      }
      const c = to - from;
      relaxed[i * 3] = positions[i * 3] + factor * w * (sx / c - positions[i * 3]);
      relaxed[i * 3 + 1] = positions[i * 3 + 1] + factor * w * (sy / c - positions[i * 3 + 1]);
      relaxed[i * 3 + 2] = positions[i * 3 + 2] + factor * w * (sz / c - positions[i * 3 + 2]);
    }
    positions.set(relaxed);
  };
  for (let pass = 0; pass < 14; pass++) {
    relax(0.5);
    relax(-0.53);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const normals = new Float32Array((geometry.attributes.normal as THREE.BufferAttribute).array);
  geometry.dispose();

  let baseY = Infinity;
  let neckX = 0;
  let neckZ = 0;
  let neckCount = 0;
  for (let i = 0; i < vertexCount; i++) {
    const y = positions[i * 3 + 1];
    baseY = Math.min(baseY, y);
    if (y > -0.8 && y < -0.7) {
      neckX += positions[i * 3];
      neckZ += positions[i * 3 + 2];
      neckCount++;
    }
  }

  const underside: number[] = [];
  for (let i = 0; i < vertexCount; i++) if (positions[i * 3 + 1] < baseY + 0.02) underside.push(i);

  const smooth = (t: number) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };
  const lips = new Float32Array(vertexCount);
  const mouthLine = new Float32Array(vertexCount);
  const brows = new Float32Array(vertexCount);
  const nostrils = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const x = Math.abs(positions[i * 3]);
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const ny = normals[i * 3 + 1];
    const mouthWindow = (1 - smooth((x - 0.125) / 0.02)) * smooth((z - 0.06) / 0.06);
    // The red of the lips, between the lip border above and below the mouth line
    lips[i] = smooth((y - (LANDMARK.stomion - 0.062)) / 0.01) * (1 - smooth((y - (LANDMARK.stomion + 0.062)) / 0.01)) * mouthWindow;
    mouthLine[i] = Math.exp(-(((y - LANDMARK.stomion) / 0.008) ** 2)) * (1 - smooth((x - 0.13) / 0.02)) * smooth((z - 0.06) / 0.06);
    brows[i] = Math.exp(-(((x - 0.18) / 0.17) ** 2) - ((y - 0.16) / 0.045) ** 2) * smooth((z + 0.1) / 0.2);
    // The underside of the nose, where the nostrils open
    nostrils[i] = Math.exp(-(((x - 0.055) / 0.035) ** 2) - ((y + 0.225) / 0.05) ** 2) * smooth((-ny - 0.2) / 0.3) * smooth((z - 0.08) / 0.05);
  }

  const half = SOURCE.eyeHalfSpacing * SCALE;
  return {
    positions,
    normals,
    indices,
    offsets,
    neighbours,
    eyes: { left: [half, 0, 0], right: [-half, 0, 0], radius: SOURCE.eyeRadius * SCALE },
    baseY,
    bottom: Uint32Array.from(underside),
    masks: { lips, mouthLine, brows, nostrils },
    neck: { x: neckX / neckCount, z: neckZ / neckCount },
  };
}

// Loads the head in the browser. The file sits next to the page, under models/.
export async function loadHead(): Promise<HeadBase> {
  const response = await fetch(`${import.meta.env.BASE_URL}models/head.bin`);
  if (!response.ok) throw new Error(`Could not load the head model (${response.status})`);
  return parseHead(await response.arrayBuffer());
}
