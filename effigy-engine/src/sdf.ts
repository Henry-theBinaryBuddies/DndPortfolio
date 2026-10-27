// A signed distance field (SDF) is a function that returns, for any point in space, how far that
// point is from a shape's surface: negative inside, positive outside, zero exactly on the surface.
// Sculpting becomes maths. Shapes are combined with min (union), max (intersection), and the "smooth"
// versions below, which blend two shapes together the way clay would, with no visible seam.

export type Sdf = (x: number, y: number, z: number) => number;

// Smooth union: like min(a, b) but rounds the join over a distance k.
export const smin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

// Smooth intersection. smax(a, -b, k) smoothly carves shape b out of shape a.
export const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k);

export const sphere = (px: number, py: number, pz: number, cx: number, cy: number, cz: number, r: number): number =>
  Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy) + (pz - cz) * (pz - cz)) - r;

// Approximate distance to an axis-aligned ellipsoid. Accurate near the surface, which is where it matters.
export const ellipsoid = (px: number, py: number, pz: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): number => {
  const x = (px - cx) / rx;
  const y = (py - cy) / ry;
  const z = (pz - cz) / rz;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const k1 = Math.sqrt((x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
};

// Distance to a capsule: a line segment from a to b, thickened by radius r.
export const capsule = (px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number => {
  const pax = px - ax;
  const pay = py - ay;
  const paz = pz - az;
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const qx = pax - bax * h;
  const qy = pay - bay * h;
  const qz = paz - baz * h;
  return Math.sqrt(qx * qx + qy * qy + qz * qz) - r;
};

export const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Starting from a point outside the shape and walking toward `target`, find where the surface is.
// Sphere tracing: each step is as long as the distance field says it is safe to move.
export function raycastSurface(
  sdf: Sdf,
  origin: [number, number, number],
  target: [number, number, number],
): [number, number, number] | null {
  let dx = target[0] - origin[0];
  let dy = target[1] - origin[1];
  let dz = target[2] - origin[2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  dx /= length;
  dy /= length;
  dz /= length;
  let t = 0;
  for (let i = 0; i < 96 && t < length; i++) {
    const x = origin[0] + dx * t;
    const y = origin[1] + dy * t;
    const z = origin[2] + dz * t;
    const d = sdf(x, y, z);
    if (d < 0.0004) return [x, y, z];
    t += Math.max(d * 0.9, 0.0008);
  }
  return null;
}

// The outward direction at a point, from the gradient of the field.
export function gradient(sdf: Sdf, x: number, y: number, z: number, e = 0.002): [number, number, number] {
  const gx = sdf(x + e, y, z) - sdf(x - e, y, z);
  const gy = sdf(x, y + e, z) - sdf(x, y - e, z);
  const gz = sdf(x, y, z + e) - sdf(x, y, z - e);
  const length = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  return [gx / length, gy / length, gz / length];
}
