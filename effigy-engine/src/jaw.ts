import type { HeadBase } from "./headMesh";

// Opening the mouth: the lower jaw turns about a hinge just in front of each ear, carrying the chin, the
// lower lip, the floor of the mouth and the skin of the throat with it. The head is a closed surface with a
// real hollow mouth behind the lips (a cavity from the lips back to the throat), so turning the lower part
// down parts the lips along their line and opens the cavity, and the surface stays closed.
//
// How much each vertex goes with the jaw (0 not at all, 1 fully) is found on the mesh itself, not by
// position, because the upper and lower lips are a hair apart: the upper lip is attached to the face above
// it and the lower lip to the chin below, and across the corners of the mouth the weight must change over
// a few millimetres, which no function of height could do. So the weights are fixed at the chin (1) and at
// the skull, the back wall of the throat and the neck (0), and everything between takes the average of its
// neighbours (a harmonic field, solved once per head).

export const JAW_HINGE = { y: -0.15, z: -0.4 }; // the hinge's axis runs along x through here
export const JAW = {
  max: 0.5, // radians at full Jaw open: about 29 degrees
  // How far the jaw slides forward as it opens, per radian (head units). A real jaw's hinge glides forward as
  // it turns; turned about a fixed hinge alone, the chin swung back into the neck at full opening, and the
  // skin between them was squeezed into folds (about 900 folded triangles; none under the throat with this).
  glide: 0.3,
};

const cache = new WeakMap<HeadBase, Float32Array>();

export function jawWeights(base: HeadBase): Float32Array {
  const cached = cache.get(base);
  if (cached) return cached;
  const p = base.positions;
  const count = p.length / 3;
  const w = new Float32Array(count);
  const fixed = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const x = Math.abs(p[i * 3]);
    const y = p[i * 3 + 1];
    const z = p[i * 3 + 2];
    if (y > -0.3 || z < -0.3 || y < -0.85) {
      // the skull and face down to the base of the upper lip (the roof of the mouth is in here too), the
      // back of the head and throat, and the neck and chest
      fixed[i] = 1;
    } else if ((y < -0.48 && y > -0.64 && z > 0 && x < 0.22) || (y < -0.4 && y > -0.64 && z > 0 && x < 0.1)) {
      // the chin, in front and below, and the lower lip (inside and out) and the front of the floor of the
      // mouth: all of it goes with the jaw (a harmonic field alone left the lip following only half way)
      fixed[i] = 1;
      w[i] = 1;
    }
  }
  const free: number[] = [];
  for (let i = 0; i < count; i++) if (!fixed[i]) free.push(i);
  // Successive over-relaxation: each free vertex moves toward the average of its neighbours
  const omega = 1.9;
  for (let iteration = 0; iteration < 900; iteration++) {
    let change = 0;
    for (const i of free) {
      const from = base.offsets[i];
      const to = base.offsets[i + 1];
      if (to === from) continue;
      let sum = 0;
      for (let k = from; k < to; k++) sum += w[base.neighbours[k]];
      const next = w[i] + omega * (sum / (to - from) - w[i]);
      change = Math.max(change, Math.abs(next - w[i]));
      w[i] = next;
    }
    if (change < 2e-4) break;
  }
  for (let i = 0; i < count; i++) w[i] = Math.min(1, Math.max(0, w[i]));
  cache.set(base, w);
  return w;
}

// A point turned with the jaw by `angle` (radians, positive is opening) about the hinge
export function turnWithJaw(y: number, z: number, angle: number): [number, number] {
  const dy = y - JAW_HINGE.y;
  const dz = z - JAW_HINGE.z;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [JAW_HINGE.y + dy * c - dz * s, JAW_HINGE.z + dy * s + dz * c + JAW.glide * angle];
}
