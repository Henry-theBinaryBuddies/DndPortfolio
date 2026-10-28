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
  baseHeight: 4, // mm
  baseMargin: 2.5, // mm: how far the base reaches beyond the underside of the bust
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
