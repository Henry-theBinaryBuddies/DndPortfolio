import type { BeardStyle } from "./params";

// Where a beard grows, in head-local units on the undeformed head (origin between the eyes, +y up, the face
// toward +z), so it stays put however the face is reshaped. A beard covers the cheeks below a cheek line
// that runs from the sideburn in front of the ear down toward the corner of the nose, the jaw, the chin,
// under the chin to the top of the neck, and the upper lip below the nose (the moustache). It keeps off the
// lips, and the ears. A goatee is just the moustache and the chin.

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// The top edge of the beard: the cheek line, highest at the sideburn and lowest beside the nose; under the
// nose, the top of the moustache, which arches with the base of the nose (rising a little beside the
// nostrils) before dropping to meet the cheek line (a flat top read as a band across the lip)
function topLine(ax: number): number {
  // (with a little irregularity, as a beard's edge has: one smooth contour read as a painted border)
  const cheek = -0.27 + 0.25 * smooth((ax - 0.2) / 0.22) + (0.012 * Math.sin(ax * 55) + 0.006 * Math.sin(ax * 131 + 1)) * smooth((ax - 0.16) / 0.06);
  // (a little notch under the philtrum, where a moustache parts: a level top read as a band)
  const moustache = -0.256 - 0.018 * (1 - smooth(ax / 0.03)) + 0.018 * smooth((ax - 0.02) / 0.07) - 0.03 * smooth((ax - 0.1) / 0.09) + 0.004 * Math.sin(ax * 97);
  return ax < 0.2 ? Math.min(moustache, cheek + 0.03) : cheek;
}

// The opening around the mouth; 1 well outside it, 0 inside. Not an oval (that read as a hole cut in a
// mask): above, the moustache's hem sits just over the lip in the middle and droops past the corners of the
// mouth, where it runs down into the beard; below, the beard starts lower under the middle of the lip than
// at its sides. The hem is a little ragged, as hair is.
function mouthClearance(ax: number, y: number): number {
  const hem = STOMION + 0.04 - 0.075 * smooth((ax - 0.1) / 0.08) + 0.005 * Math.sin(ax * 90 + 1);
  const below = STOMION - 0.056 + 0.012 * smooth((ax - 0.03) / 0.08);
  const open = smooth((hem - y) / 0.012) * smooth((y - below) / 0.015) * (1 - smooth((ax - 0.17) / 0.035));
  return 1 - open;
}
const STOMION = -0.363;

// lips: how much of this point is the red of the lips (0..1), which a beard keeps off
export function beardWeight(x: number, y: number, z: number, style: BeardStyle, lips: number): number {
  if (style === "none") return 0;
  const ax = Math.abs(x);
  // Below the cheek line, above the top of the neck (lower at the front, under the chin)
  let w = smooth((topLine(ax) - y) / 0.03) * smooth((y + 0.7 - 0.1 * smooth((ax - 0.15) / 0.2)) / 0.1);
  // In front of the ears, and not round the back of the neck
  w *= smooth((z + 0.5) / 0.1);
  // (the whole ear, its front edge included: the beard's sideburn ran up over it)
  // (a soft edge: cut off sharply, the shell folded where the sideburn stopped)
  w *= 1 - smooth((ax - 0.33) / 0.04) * smooth((y + 0.26) / 0.06) * smooth((0.27 - y) / 0.04) * smooth((-0.13 - z) / 0.12);
  // Off the lips, with a rounded margin round the mouth
  w *= (1 - smooth(lips * 1.6)) * mouthClearance(ax, y);
  // A goatee: the moustache and the front of the chin only (not under it)
  if (style === "goatee") w *= (1 - smooth((ax - 0.12 - 0.04 * smooth((-0.42 - y) / 0.1)) / 0.03)) * smooth((y + 0.62) / 0.05) * smooth(z / 0.08);
  return w;
}
