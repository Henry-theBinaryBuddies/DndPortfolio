import type { Bounds } from "./mesher";
import { capsule, ellipsoid, smax, smin, sphere, type Sdf } from "./sdf";
import type { Params } from "./params";

// The sculpt. Everything here is in "head-local" units: the origin is roughly the centre of the
// skull, +y is up, +z is the way the face points, and the face is about 1.24 tall. The base of the
// bust is the flat plane at BASE_Y. All the shapes are symmetric left to right, so they are written
// for x >= 0 and the field takes the absolute value of x.

export const BASE_Y = -1.4;

// 1 for masculine, 0 for feminine, halfway for neutral. Used to blend proportions.
export function masculinity(p: Params): number {
  return p.body === "masculine" ? 1 : p.body === "feminine" ? 0 : 0.5;
}

// Shoulder width, narrower on feminine busts.
export function shoulderSpan(p: Params): number {
  return p.bulk * (0.86 + 0.14 * masculinity(p));
}

export interface Anatomy {
  sdf: Sdf;
  outer: Sdf; // contains the whole body
  inner: Sdf; // lies wholly inside it
  bounds: Bounds;
}

export function makeAnatomy(p: Params): Anatomy {
  const m = masculinity(p);
  const f = 1 - m;
  const w = p.headWidth;
  const h = p.headHeight;
  const span = shoulderSpan(p);
  const es = p.eyeSpacing;
  const eyeS = p.eyeSize;
  const nl = p.noseLength;
  const nw = p.noseWidth;
  const mw = p.mouthWidth;
  const jw = p.jawWidth;
  const cheek = 0.5 + p.cheekbones * 0.9;
  const earOn = p.earSize > 0.03;

  const sdf: Sdf = (px, y, z) => {
    const x = Math.abs(px);

    // ---- Head and face (skipped well below the chin) ----
    let d = 9;
    if (y > -0.95) {
      const cranium = ellipsoid(x, y, z, 0, 0.13 * h, -0.05, 0.47 * w, 0.5 * h, 0.53);
      const face = ellipsoid(x, y, z, 0, -0.18 * h, 0.06, 0.4 * w * (0.94 + 0.08 * m), 0.46 * h, 0.41);
      d = smin(cranium, face, 0.16);

      // Jaw: a capsule from just under the ear to the chin, thicker and squarer on masculine heads
      d = smin(d, capsule(x, y, z, 0.36 * w * jw, -0.04 * h, -0.06, 0.2 * jw, -0.5 * h, 0.3, 0.09 + 0.02 * m), 0.14);
      d = smin(d, ellipsoid(x, y, z, 0, -0.5 * h, 0.36 + 0.02 * p.chin, 0.075 + 0.035 * jw, 0.06 + 0.05 * p.chin, 0.08 + 0.07 * p.chin), 0.11);

      // Neck, with an Adam's apple on masculine busts
      d = smin(d, capsule(x, y, z, 0, -0.4 * h, -0.04, 0, -0.98, -0.05, 0.15 + 0.04 * m), 0.14);
      if (m > 0.05) d = smin(d, sphere(x, y, z, 0, -0.66, 0.112 + 0.03 * m, 0.02 * m), 0.02);

      // Brow ridge and cheekbones sit on the skull; the ridge is heavier on masculine heads
      d = smin(d, capsule(x, y, z, 0, 0.21 * h, 0.44, 0.3 * w, 0.19 * h, 0.4, 0.035 + 0.07 * p.brow * (0.65 + 0.5 * m)), 0.08);
      d = smin(d, ellipsoid(x, y, z, 0.32 * w, -0.04 * h, 0.34, 0.12 * cheek, 0.075 * cheek, 0.09 * cheek), 0.08);

      // Ears: a rounded rim, stretching into a swept spike as the slider rises
      if (earOn && x > 0.3) {
        d = smin(d, ellipsoid(x, y, z, 0.47 * w, 0.0, -0.04, 0.024, 0.07 + 0.04 * p.earSize, 0.05), 0.02);
        if (p.earSize > 0.4) {
          const reach = p.earSize - 0.3;
          d = smin(d, capsule(x, y, z, 0.47 * w, 0.04, -0.05, 0.47 * w + 0.14 * reach, 0.1 + 0.3 * reach, -0.1, 0.016), 0.03);
        }
      }

      // ---- Facial features, only evaluated near the front of the face ----
      if (z > 0.2 && x < 0.5 && y < 0.4 * h && y > -0.62 * h) {
        // Eye sockets are carved in, then framed by upper and lower lids
        const depth = 0.51 - 0.06 * p.socketDepth;
        d = smax(d, -ellipsoid(x, y, z, 0.17 * es, 0.1 * h, depth, 0.095 * eyeS, 0.075 * eyeS, 0.1), 0.045);
        const lidDrop = 0.03 * p.lids;
        const lidR = 0.018 + 0.008 * p.lids;
        d = smin(d, capsule(x, y, z, 0.17 * es - 0.075 * eyeS, 0.155 * h - lidDrop, 0.455, 0.17 * es + 0.075 * eyeS, 0.15 * h - lidDrop, 0.45, lidR), 0.025);
        d = smin(d, capsule(x, y, z, 0.17 * es - 0.065 * eyeS, 0.055 * h, 0.45, 0.17 * es + 0.065 * eyeS, 0.052 * h, 0.445, 0.013), 0.02);

        // Nose: a bridge, a rounded tip, and flared nostril wings, with the nostrils themselves carved out
        const tipZ = 0.55 + 0.1 * nl;
        d = smin(d, capsule(x, y, z, 0, 0.15 * h, 0.47, 0, -0.08 * h, 0.52 + 0.1 * nl, 0.028 + 0.012 * nw), 0.05);
        d = smin(d, sphere(x, y, z, 0, -0.115 * h, tipZ, 0.042 * nw), 0.04);
        d = smin(d, sphere(x, y, z, 0.055 * nw, -0.105 * h, tipZ - 0.05, 0.032), 0.025);
        d = smax(d, -ellipsoid(x, y, z, 0.028 * nw, -0.14 * h, tipZ - 0.02, 0.013, 0.011, 0.028), 0.012);

        // Snout (dragonborn): the muzzle and upper jaw push forward as one mass
        if (p.snout > 0.02) {
          d = smin(d, ellipsoid(x, y, z, 0, -0.2 * h, 0.4 + 0.3 * p.snout, 0.15, 0.15, 0.06 + 0.26 * p.snout), 0.1);
          d = smin(d, ellipsoid(x, y, z, 0, -0.4 * h, 0.36 + 0.24 * p.snout, 0.12, 0.08, 0.05 + 0.22 * p.snout), 0.08);
        }

        // Lips, fuller on feminine faces
        d = smin(d, capsule(x, y, z, 0, -0.285 * h, 0.455, 0.075 * mw, -0.28 * h, 0.435, 0.02 + 0.01 * f), 0.015);
        d = smin(d, capsule(x, y, z, 0, -0.34 * h, 0.45, 0.07 * mw, -0.335 * h, 0.43, 0.025 + 0.012 * f), 0.018);

        // Gaunt cheeks: hollows carved under the cheekbones
        if (p.gaunt > 0.02) {
          // A long, shallow hollow below the cheekbone, blended widely so it reads as a sunken cheek, not a crater
          d = smax(d, -ellipsoid(x, y, z, 0.28 * w, -0.22 * h, 0.42 - 0.04 * p.gaunt, 0.13 + 0.04 * p.gaunt, 0.17 + 0.04 * p.gaunt, 0.1), 0.17);
        }
      }
    }

    // ---- Shoulders and chest (skipped well above the collarbones) ----
    if (y < -0.5) {
      const yb = y - 0.09; // the shoulders ride a little higher so the neck is not too long
      let body = capsule(x, yb, z, 0.08, -0.82, -0.03, 0.5 * span, -1.02, -0.03, 0.1);
      body = smin(body, capsule(x, yb, z, 0.05, -1.02, 0.11, 0.4 * span, -1.05, 0.08, 0.03), 0.04);
      body = smin(body, ellipsoid(x, yb, z, 0.58 * span, -1.1, -0.01, 0.15, 0.17, 0.16), 0.12);
      body = smin(body, ellipsoid(x, yb, z, 0, -1.28, 0, 0.52 * span, 0.32, 0.27), 0.14);
      // Pectoral definition on masculine busts, a soft rise on feminine ones
      body = smin(body, ellipsoid(x, yb, z, 0.17, -1.22, 0.2, 0.17 * Math.max(m, 0.01), 0.1 * Math.max(m, 0.01), 0.1 * Math.max(m, 0.01)), 0.1);
      body = smin(body, ellipsoid(x, yb, z, 0.16, -1.3, 0.19, 0.15 * Math.max(f, 0.01), 0.13 * Math.max(f, 0.01), 0.12 * Math.max(f, 0.01)), 0.12);
      d = smin(d, body, 0.18);
    }

    // The flat underside the bust stands on
    return Math.max(d, BASE_Y - y);
  };

  // Conservative bounding shapes. `outer` must enclose everything; `inner` must sit inside it.
  const outer: Sdf = (px, y, z) => {
    const x = Math.abs(px);
    const head = ellipsoid(x, y, z, 0, 0.0, 0.1, 0.72 * w + 0.1, 0.85 * h, 0.88);
    const neck = capsule(x, y, z, 0, -0.35, -0.04, 0, -1.1, -0.04, 0.26);
    const chest = ellipsoid(x, y, z, 0, -1.15, 0, 0.62 * span + 0.28, 0.5, 0.42);
    return Math.min(head, neck, chest);
  };
  const inner: Sdf = (px, y, z) => {
    const x = Math.abs(px);
    const skull = ellipsoid(x, y, z, 0, 0.1 * h, -0.08, 0.38 * w, 0.4 * h, 0.4);
    const neck = capsule(x, y, z, 0, -0.5, -0.04, 0, -0.9, -0.05, 0.11);
    const chest = ellipsoid(x, y, z, 0, -1.28, 0, 0.36 * span, 0.2, 0.16);
    return Math.max(Math.min(skull, neck, chest), BASE_Y + 0.02 - y);
  };

  // The grid needs a clear margin around the shape: the mesher can only close surfaces that sit at
  // least a cell or two inside it.
  const bounds: Bounds = { halfX: 0.62 * span + 0.45, minY: BASE_Y - 0.1, maxY: 0.75 * h + 0.15, minZ: -0.75, maxZ: 1.05 };
  return { sdf, outer, inner, bounds };
}
