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
  baseHeight: 34, // mm: the whole pedestal, foot, shaft and flare (below the bust's flat underside)
  baseRadius: 25, // mm: the foot is at least this wide (a 50 mm base), and wider when the bust's underside needs it
  baseMargin: 2, // mm: how far the foot reaches beyond the farthest corner of the bust's underside
  flatCut: 1.2, // mm: the least the bust is cut flat above its lowest point (see underside.ts: it goes higher where the underside hangs out)
  overhang: 1, // mm of outward growth allowed per mm of height above the cut: 1 is 45 degrees
  baseOverlap: 0.4, // mm: the base reaches this far up inside the bust, so the two are joined, not just touching
};

// Tabletop size (see fit.ts): the whole bust, hair and shoulders included, stands within a one inch square of a
// gaming board, on a round base a little under that, and is about as tall as a miniature's head and shoulders
// are wanted. All in millimetres as printed (the sculpt is scaled to fit).
export const TABLETOP = {
  base: 25, // mm: the base's width (a square is 25.4 mm)
  bustHeight: [45, 55] as const, // mm, the bust itself (without its base)
  aim: 50, // mm: the height aimed for
  plinth: 18, // mm: the whole base is this tall (a board has no ceiling: height costs nothing, and buys the base its shape)
  torso: 0.45, // the least the Torso size slider goes to, which the fit may slim the body to
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

// The pedestal's turned profile, from the foot up, in printed millimetres at either size (see pedestalRings: at
// full size the shaft and flare are taller, the moldings the same). Sized so every molding survives even a
// 0.4 mm nozzle, on which a ring that juts out less than about 0.5 mm prints as a faint line (the 0.2 mm
// nozzle the rest is sized for draws them sharper). Every part either narrows
// going up or widens no faster than 45 degrees, so it all prints without supports: a molding that juts out is a
// diamond in section (out at an angle, then back in), never a round bead with an undercut.
const SOCLE = {
  bevel: 0.3, // the first layer's chamfer, so it does not squash out into an elephant's foot
  band: 1.2, // the foot's upright band
  chamfer: 0.6, // a 45 degree chamfer in from the top of the band (as far in as it is high)
  ledge: 0.5, // then a flat step in: a ledge facing up, which prints like any top surface
  tier: [0.7, 0.5, 0.4], // a second, narrower step on the first: its band, its chamfer, its ledge
  cove: 1.8, // a concave sweep in from the ledge to the foot of the shaft
  collar: [0.7, 0.75], // a ring round the foot of the shaft, doubled: each out this far, over this height, and back in (43 degrees)
  neck: [0.55, 0.6], // the single ring where the flare begins (42 degrees)
  shaft: 0.8, // how much wider the shaft is at its foot than at its waist
};

const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// The flare's profile: mostly a straight cone (the least steep way to widen by a given amount), eased at its ends.
// Its steepest slope is FLARE_PEAK times the straight slope.
const FLARE_PEAK = 0.65 + 0.35 * 1.5;
const flareEase = (t: number) => 0.65 * Math.min(1, Math.max(0, t)) + 0.35 * ease(t);

export const PEDESTAL_SIDES = 96;

// The pedestal, as rings of points from its foot to its top (in head units: each ring is (x, y, z) triples, y up).
// A turned socle (see SOCLE): a round foot with a chamfered band and a second, narrower stepped tier, a cove
// sweeping in to a shaft with a doubled collar at its foot, narrowing to a waist; then a ring, and a flare out
// under the bust that ends at the section of the bust at its flat cut (`reach`: how far that outline reaches
// from the middle in each of PEDESTAL_SIDES directions), so the bust has solid support wherever it reaches and
// meets it flush (a bust whose flat bottom hung out over a narrow stem would print as a bridge).
// (`fixedDisc`: the foot's radius, head units, where it is fixed and not the least that the bust needs. `unit`:
// one printed millimetre in head units: MM at full size, and MM over the print's scale at tabletop size, so the
// moldings print at the sizes SOCLE gives whatever the scale. Grown with the taller full-size base they would
// leave a broad bust's flare too little height to stay within 45 degrees.)
export function pedestalRings(reach: ArrayLike<number>, bottom: number, top: number, fixedDisc?: number, unit = MM): number[][] {
  const farthest = Math.max(...Array.from(reach));
  const nearest = Math.min(...Array.from(reach));
  const disc = fixedDisc ?? Math.max(PRINT.baseRadius * MM, farthest + PRINT.baseMargin * MM);
  const [tierBand, tierChamfer, tierLedge] = SOCLE.tier;
  // (the moldings must fit between the foot and the shaft, however small the foot)
  const step = disc - (SOCLE.chamfer + SOCLE.ledge) * unit;
  const inner = step - (tierChamfer + tierLedge) * unit;
  const waist = Math.min(16 * MM, Math.max(10 * MM, 0.65 * nearest), inner - (SOCLE.shaft + SOCLE.collar[0] + 1) * unit);
  const shaftFoot = waist + SOCLE.shaft * unit;
  const heights: [number, (k: number) => number][] = [];
  const ring = (y: number, radius: (k: number) => number) => heights.push([y, radius]);
  let y = bottom;
  ring(y, () => disc - SOCLE.bevel * unit);
  ring((y += SOCLE.bevel * unit), () => disc);
  ring((y += (SOCLE.band - SOCLE.bevel) * unit), () => disc);
  ring((y += SOCLE.chamfer * unit), () => disc - SOCLE.chamfer * unit);
  // (a ledge: two rings at one height, the second further in)
  ring(y, () => step);
  // The second tier: a band, a chamfer and a ledge again, narrower
  ring((y += tierBand * unit), () => step);
  ring((y += tierChamfer * unit), () => step - tierChamfer * unit);
  ring(y, () => inner);
  // The cove: concave, steep at first and easing in to the shaft
  const coveSteps = 8;
  for (let s = 1; s <= coveSteps; s++) {
    const t = s / coveSteps;
    ring(y + SOCLE.cove * unit * t, () => shaftFoot + (inner - shaftFoot) * (1 - t) ** 2);
  }
  y += SOCLE.cove * unit;
  const collar = (at: number, radius: number, [out, up]: number[]) => {
    ring(at + up * unit, () => radius + out * unit);
    ring(at + 2 * up * unit, () => radius);
    return at + 2 * up * unit;
  };
  y = collar(collar(y, shaftFoot, SOCLE.collar), shaftFoot, SOCLE.collar);
  // The shaft narrows to its waist, then the flare. The flare is an overhang: each layer sticks out past the one
  // below. It starts as low as the bust's reach needs, so that its steepest part stays near PRINT.overhang (45
  // degrees from vertical) and prints without supports; a ring marks where it begins.
  const stem = top - y - 2 * SOCLE.neck[1] * unit;
  const flare = (farthest - waist) / (PRINT.overhang / FLARE_PEAK);
  const start = Math.min(0.6, Math.max(0.06, 1 - flare / stem));
  const shaftSteps = 6;
  for (let s = 1; s <= shaftSteps; s++) {
    const t = s / shaftSteps;
    ring(y + stem * start * t, () => waist + (shaftFoot - waist) * (1 - ease(t)));
  }
  y = collar(y + stem * start, waist, SOCLE.neck);
  const flareSteps = 18;
  const rest = top - y;
  for (let s = 1; s <= flareSteps; s++) {
    const t = s / flareSteps;
    const u = flareEase(t);
    ring(y + rest * t, (k) => waist + (reach[k] - waist) * u);
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
