import { hash, smooth, vee, type Pattern } from "./carve";
import type { HairStyle } from "./params";
import { MM } from "./print";

// How hair is carved, the way a sculptor does it on a miniature: broad locks separated by V-grooves, with a
// finer groove down the middle of each lock, running the way the hair is combed. Bolder than the beard (hair
// is longer and thicker), and sized in print millimetres (print.ts) for a 0.2 mm nozzle. carve.ts subdivides
// the shell and cuts this into it.

export const HAIR_CARVING = {
  lockPitch: 2.4 * MM,
  lockGroove: 0.6 * MM,
  lockDepth: 0.5 * MM,
  fineGroove: 0.4 * MM, // (a ridge of at least 0.6 mm is left between it and the lock's groove)
  fineDepth: 0.25 * MM,
};

// The carving across one family of locks: `across` is how far across the locks the point is (as a length),
// `along` how far along them (it makes each groove start and stop where a separate lock would). Round a
// rope the locks come back to where they began, and `period` (how many there are) makes the numbering come
// back with them, or the grooves would carve differently on the two sides of the seam.
export function locks(across: number, along: number, period = 0): number {
  const c = HAIR_CARVING;
  const wrap = (k: number) => (period ? ((k % period) + period) % period : k);
  const p1 = across / c.lockPitch;
  const lock = wrap(Math.floor(p1));
  const major = vee(p1, c.lockGroove / c.lockPitch / 2) * (0.7 + 0.6 * hash(lock)) * (0.6 + 0.4 * Math.sin(along * 13 + lock * 2.3));
  const p2 = p1 + 0.5;
  const fineLock = wrap(Math.floor(p2));
  const fine = vee(p2, c.fineGroove / c.lockPitch / 2) * (0.7 + 0.6 * hash(fineLock + 57)) * (0.5 + 0.5 * Math.sin(along * 9 + fineLock * 1.7));
  return Math.max(c.lockDepth * major, c.fineDepth * fine);
}

// Combed back, the locks run from the brow toward the nape, where they converge, at the base of the back of
// the head and not at the middle of it (there they came together on the skull itself, closer than a printer
// can hold apart). Across them is the angle round that line; the grooves fade out wherever the locks would
// come closer than the printer can show.
const swept: Pattern = (x, y, z) => {
  const axisY = 0.05 - 0.6 * smooth((-z - 0.1) / 0.5);
  const radius = Math.hypot(x, y - axisY);
  return locks(0.5 * Math.atan2(x, y - axisY) + 0.01 * Math.sin(z * 9 + x * 5), z) * smooth((radius - 0.22) / 0.1);
};

const CROWN_Z = -0.15; // the whorl at the crown, where a short crop's hair grows out from
const CROP_LOCKS = 36; // round the whole head

// A short crop grows out from the whorl at the crown, so its locks radiate from there (a whole number of them
// round the head, or they would meet in a seam), and the whorl itself is left plain, where they would be too
// close together to print
const crop: Pattern = (x, _y, z) => {
  const angle = Math.atan2(x, z - CROWN_Z);
  const r = Math.hypot(x, z - CROWN_Z);
  const across = ((angle + 0.02 * Math.sin(r * 17)) / (2 * Math.PI)) * CROP_LOCKS * HAIR_CARVING.lockPitch;
  return locks(across, r) * smooth((r - 0.1) / 0.08);
};

// The carving at a point of the scalp, in the undeformed head's coordinates (so it stays with the head
// however it is reshaped), for each style
const PATTERNS: Record<Exclude<HairStyle, "none">, Pattern> = {
  swept,
  long: swept,
  cropped: crop,
  // A crest swept back: locks run along its length, side by side across its width
  mohawk: (x, y, z) => locks(x + 0.008 * Math.sin(z * 11 + y * 5), z),
  // (dreadlocks and braids grow from a close crop)
  dreadlocks: crop,
  braids: crop,
};

export function hairPattern(style: Exclude<HairStyle, "none">): Pattern {
  return PATTERNS[style];
}

// Long hair's hanging curtain and locks carry their own coordinates (the hanging shell has no place on the
// head to read): across them is the arc round the neck, or round the lock's own section, and the grooves run
// down their length.
export const hangingPattern: Pattern = (across, y) => locks(across + 0.008 * Math.sin(y * 11), y);
