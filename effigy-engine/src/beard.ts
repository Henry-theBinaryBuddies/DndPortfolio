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
// nose, the top of the moustache
function topLine(ax: number): number {
  const cheek = -0.27 + 0.25 * smooth((ax - 0.2) / 0.22);
  return ax < 0.2 ? -0.258 - 0.012 * smooth((ax - 0.12) / 0.08) : cheek;
}

// lips: how much of this point is the red of the lips (0..1), which a beard keeps off
export function beardWeight(x: number, y: number, z: number, style: BeardStyle, lips: number): number {
  if (style === "none") return 0;
  const ax = Math.abs(x);
  // Below the cheek line, above the top of the neck (lower at the front, under the chin)
  let w = smooth((topLine(ax) - y) / 0.03) * smooth((y + 0.7 - 0.1 * smooth((ax - 0.15) / 0.2)) / 0.1);
  // In front of the ears, and not round the back of the neck
  w *= smooth((z + 0.5) / 0.1);
  if (ax > 0.38 && y > -0.3 && y < 0.25 && z < -0.25) w = 0;
  // Off the lips
  w *= 1 - smooth(lips * 1.6);
  // A goatee: the moustache and the front of the chin only (not under it)
  if (style === "goatee") w *= (1 - smooth((ax - 0.12 - 0.04 * smooth((-0.42 - y) / 0.1)) / 0.03)) * smooth((y + 0.62) / 0.05) * smooth(z / 0.08);
  return w;
}
