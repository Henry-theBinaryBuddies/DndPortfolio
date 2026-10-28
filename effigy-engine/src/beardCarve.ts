import { hash, smooth, vee } from "./carve";
import { MM } from "./print";

// Carving a beard the way a sculptor does on a miniature: broad locks separated by V-grooves, with a finer
// groove down the middle of each lock, and a moustache whose locks sweep out from under the nose and down.
// The shell is subdivided and cut by carve.ts; this says where. Everything is sized in print millimetres
// (print.ts) for a 0.2 mm nozzle.

export const BEARD_CARVING = {
  lockPitch: 2 * MM, // one lock every 2 mm
  lockGroove: 0.5 * MM, // the groove between locks: its width at the surface
  lockDepth: 0.4 * MM,
  fineGroove: 0.4 * MM, // the finer groove down the middle of a lock (a ridge of at least 0.5 mm is left between)
  fineDepth: 0.22 * MM,
  moustachePitch: 1.2 * MM,
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
