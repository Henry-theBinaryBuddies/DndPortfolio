// The shape of an eyebrow, in head-local units on the undeformed head (origin between the eyes, +y up, the
// face toward +z), measured outward from the middle of the face. A brow has a fuller head near the nose,
// an arch that peaks about two thirds of the way out, and a tail that thins and dips toward the temple. A
// masculine brow sits lower and flatter and is heavier; a feminine one is finer with a higher arch. (A plain
// band the same height all the way along read as a bar.)

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

const HEAD = 0.045; // where the brow starts, out from the middle of the face
const TAIL = 0.335; // where it ends, past the outer corner of the eye

export interface BrowShape {
  t: number; // 0 at the head of the brow, 1 at the tip of the tail
  centre: number; // the height of its centre line
  half: number; // half its height
  slope: number; // how steeply its centre line rises (+) or falls (-) going outward
}

// m: 1 masculine, 0 feminine. bushy: the Eyebrows slider.
export function browShape(ax: number, m: number, bushy: number): BrowShape {
  const t = (ax - HEAD) / (TAIL - HEAD);
  const arch = 0.026 + 0.022 * (1 - m);
  const lift = (u: number) => 0.088 - 0.008 * m + arch * Math.sin(Math.PI * Math.min(1, Math.max(0, u)) * 0.82) - 0.028 * smooth((u - 0.72) / 0.28);
  const centre = lift(t);
  const slope = (lift(t + 0.02) - lift(t - 0.02)) / (0.04 * (TAIL - HEAD));
  const half = 0.024 * (0.75 + 0.45 * m) * (0.75 + 0.5 * bushy) * (1 - 0.7 * smooth((t - 0.35) / 0.65)) * (1 - 0.15 * smooth((0.12 - t) / 0.12));
  return { t, centre, half, slope };
}

// How much a point lies inside the brow: 1 well inside, fading over a soft edge, 0 outside. Only the front
// of the face carries brows.
export function browWeight(x: number, y: number, z: number, m: number, bushy: number): number {
  const ax = Math.abs(x);
  const s = browShape(ax, m, bushy);
  if (s.t < -0.15 || s.t > 1.1 || z < -0.15) return 0;
  const along = smooth((s.t + 0.08) / 0.12) * (1 - smooth((s.t - 0.94) / 0.12));
  const across = 1 - smooth((Math.abs(y - s.centre) - s.half * 0.7) / (s.half * 0.6 + 0.004));
  return along * across * smooth((z + 0.15) / 0.2);
}
