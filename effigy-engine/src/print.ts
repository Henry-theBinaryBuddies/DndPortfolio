// The print the sculpt is made for: one profile, which the carving, the base and the export all read. An FDM
// printer with a 0.2 mm nozzle, a bust 75-90 mm tall. The bust is about 2.6 head units tall, so at about 82 mm
// one unit is 32 mm. Surface detail is sized in print millimetres with this, so it survives printing: a
// groove narrower than about two nozzle widths fills in, and a ridge thinner than about three is lost.
// (Detail at these sizes is a design target: it should be checked on a small printed coupon at the actual
// settings before it is relied on.)

export const MM = 1 / 32; // one print millimetre, in head units

export const PRINT = {
  nozzle: 0.2, // mm
  bustHeight: [75, 90] as const, // mm, the bust itself (without its base)
  baseHeight: 24, // mm: the whole pedestal, disc and stem (below the bust's flat underside)
  baseRadius: 25, // mm: the disc is at least this wide (a 50 mm base), and wider when the bust's underside needs it
  baseMargin: 2, // mm: how far the disc reaches beyond the farthest corner of the bust's underside
  discHeight: 3, // mm: the disc's rim, with its sloped top
  discBevel: 2, // mm: how far the sloped top of the disc comes in
  flatCut: 1.2, // mm: the least the bust is cut flat above its lowest point (see underside.ts: it goes higher where the underside hangs out)
  overhang: 1, // mm of outward growth allowed per mm of height above the cut: 1 is 45 degrees
  baseOverlap: 0.4, // mm: the base reaches this far up inside the bust, so the two are joined, not just touching
};

export const MIN_GROOVE = 0.4 * MM; // the narrowest groove that prints
export const MIN_FEATURE = 0.6 * MM; // the thinnest raised feature that prints

type Point = [number, number];

// The convex hull of points (Andrew's monotone chain), counter-clockwise
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// The outline of the base: the hull of the bust's underside, grown outward by `margin` with rounded
// corners, so it carries the bust whatever its shape (the busts are 45-70 mm across at the bottom, wider than
// a 50 mm round base would hold). Convex, counter-clockwise. In the same units as the points.
export function baseOutline(underside: Point[], margin: number, arcSteps = 8): Point[] {
  const hull = convexHull(underside);
  const out: Point[] = [];
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const prev = hull[(i + n - 1) % n];
    const here = hull[i];
    const next = hull[(i + 1) % n];
    // The outward normals of the edges either side of this corner (counter-clockwise: outward is to the right)
    const normal = (a: Point, b: Point): Point => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy) || 1;
      return [dy / length, -dx / length];
    };
    const [n0, n1] = [normal(prev, here), normal(here, next)];
    const a0 = Math.atan2(n0[1], n0[0]);
    let a1 = Math.atan2(n1[1], n1[0]);
    while (a1 < a0) a1 += 2 * Math.PI;
    // (counter-clockwise: the corner's arc turns from the first normal to the second)
    const steps = Math.max(1, Math.ceil(((a1 - a0) / (Math.PI / 2)) * arcSteps));
    for (let s = 0; s <= steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps;
      out.push([here[0] + Math.cos(a) * margin, here[1] + Math.sin(a) * margin]);
    }
  }
  return out;
}

// How far the outline (convex, with the origin inside it) reaches from the origin in direction `angle`
export function radiusAt(hull: Point[], angle: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let reach = 0;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % n];
    // The ray t*(dx, dy) meets the edge a + u*(b - a)
    const ex = bx - ax;
    const ey = by - ay;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-12) continue;
    const t = (ax * ey - ay * ex) / denominator;
    const u = (ax * dy - ay * dx) / denominator;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) reach = Math.max(reach, t);
  }
  return reach;
}

const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export const PEDESTAL_SIDES = 96;

// The pedestal, as rings of points from its foot to its top (in head units: each ring is (x, y, z) triples, y up).
// Like the busts on turned bases it stands on a round disc with a sloped rim, narrows to a waist and flares
// out under the bust to the section of the bust at its flat cut (`reach`: how far that outline reaches from the
// middle in each of PEDESTAL_SIDES directions), so the bust has solid support wherever it reaches (a bust
// whose flat bottom hung out over a narrow stem would print as a bridge).
export function pedestalRings(reach: ArrayLike<number>, bottom: number, top: number): number[][] {
  const farthest = Math.max(...Array.from(reach));
  const nearest = Math.min(...Array.from(reach));
  const disc = Math.max(PRINT.baseRadius * MM, farthest + PRINT.baseMargin * MM);
  const waist = Math.min(16 * MM, Math.max(10 * MM, 0.65 * nearest));
  const foot = disc - PRINT.discBevel * MM;
  const discTop = bottom + PRINT.discHeight * MM;
  const rim = bottom + PRINT.discHeight * MM * 0.4;
  const stemSteps = 24;
  const heights: [number, (k: number) => number][] = [
    [bottom, () => disc - 0.4 * MM], // (a small bevel at the foot, so the first layer does not flare out)
    [bottom + 0.4 * MM, () => disc],
    [rim, () => disc],
    [discTop, () => foot],
  ];
  for (let s = 1; s <= stemSteps; s++) {
    const t = s / stemSteps;
    const y = discTop + (top - discTop) * t;
    heights.push([y, (k) => waist + (foot - waist) * (1 - ease(t / 0.45)) + (reach[k] - waist) * ease((t - 0.45) / 0.55)]);
  }
  return heights.map(([y, radius]) => {
    const ring: number[] = [];
    for (let k = 0; k < PEDESTAL_SIDES; k++) {
      const a = (k / PEDESTAL_SIDES) * 2 * Math.PI;
      const r = radius(k);
      ring.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
    return ring;
  });
}

// The reach (see pedestalRings) of a convex outline around the origin
export function reachOfHull(points: Point[]): number[] {
  const hull = convexHull(points);
  return Array.from({ length: PEDESTAL_SIDES }, (_, k) => radiusAt(hull, (k / PEDESTAL_SIDES) * 2 * Math.PI));
}
