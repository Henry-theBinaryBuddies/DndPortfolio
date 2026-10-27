import type { Bounds } from "./mesher";
import { capsule, ellipsoid, smax, smin, sphere, type Sdf } from "./sdf";
import { derive, type Params } from "./params";

// The sculpt. Everything here is in "head-local" units: the origin is roughly the centre of the
// skull, +y is up, +z is the way the face points, and the head is about 1.2 tall. The base of the
// bust is the flat plane at BASE_Y. All the shapes are symmetric left to right, so they are written
// for x >= 0 and the field takes the absolute value of x.
//
// Proportions follow real anthropometry: a head about 1.45 times taller than it is wide, a neck
// roughly two thirds of the head's width, shoulders about twice as wide as the head, eyes at the
// vertical middle of the head, the nose base about two thirds down, the mouth just above the chin.

export const BASE_Y = -1.4;

// How far the facial features sit below where the skull's own proportions first put them.
export const FACE_DROP = 0.09;

// 1 for masculine, 0 for feminine, halfway for neutral. Used to blend proportions.
export function masculinity(p: Params): number {
  return p.body === "masculine" ? 1 : p.body === "feminine" ? 0 : 0.5;
}

// Shoulder breadth: the race's frame, the build of the person, and masculine or feminine proportions.
export function shoulderSpan(p: Params): number {
  return derive(p).shoulders * (0.86 + 0.14 * masculinity(p));
}

// Eyeball radius and where each eye sits. The sculpt carves a socket exactly this big and the eye
// meshes fill it, so the eye and the lids can never clip through the skin.
export function eyeRadius(p: Params): number {
  return 0.052 * derive(p).eyeSize;
}

export function eyeCentre(p: Params, side: -1 | 1): [number, number, number] {
  const k = derive(p);
  return [side * 0.155 * k.eyeSpacing, 0.1 * k.headHeight - FACE_DROP, 0.335];
}

export interface Anatomy {
  sdf: Sdf;
  outer: Sdf; // contains the whole body
  inner: Sdf; // lies wholly inside it
  bounds: Bounds;
}

export function makeAnatomy(p: Params): Anatomy {
  const k = derive(p);
  const m = masculinity(p);
  const f = 1 - m;
  const w = k.headWidth;
  const h = k.headHeight;
  const sx = 0.9 * w; // skull breadth
  const span = shoulderSpan(p);
  const jw = k.jawWidth;
  const nl = k.noseLength;
  const nw = k.noseWidth;
  const mw = k.mouthWidth;
  const cheek = 0.5 + p.cheekbones * 0.9;
  const earOn = k.earSize > 0.03;
  const lf = k.lipFull * (1 + 0.2 * f);
  const girth = 1 + 0.12 * k.fullness - 0.05 * k.gaunt;
  const neckR = (0.2 + 0.04 * m) * k.neckGirth;

  // A feature's height on the head, lowered into place
  const fy = (v: number) => v * h - FACE_DROP;

  // Eye geometry, shared with the eye meshes
  const R = eyeRadius(p);
  const ex = 0.155 * k.eyeSpacing;
  const ey = fy(0.1);
  const ez = 0.335;
  const lidTop = Math.max(0.06, 0.5 - 0.42 * p.lids - 0.08 * p.age); // how far up the eyeball the upper lid reaches
  const lidBottom = 0.42;
  // The mesher places surface vertices to within about half a cell, so the cavity needs a margin of
  // roughly one fine cell around the eyeball or a vertex could land inside it.
  const lidInner = R + 0.011;
  const lidOuter = lidInner + 0.024;

  const sdf: Sdf = (px, y, z) => {
    const x = Math.abs(px);

    // ---- Head and face (skipped well below the chin) ----
    let d = 9;
    if (y > -0.95) {
      const cranium = ellipsoid(x, y, z, 0, 0.09 * h, -0.02, 0.46 * sx, 0.49 * h, 0.47);
      const face = ellipsoid(x, y, z, 0, -0.25 * h, 0.07, 0.36 * sx * (0.95 + 0.07 * m), 0.42 * h, 0.4);
      d = smin(cranium, face, 0.16);

      // Jawline: the ramus rises from the angle of the jaw up to just under the ear, and the body of
      // the mandible runs forward from the angle to the chin. Thicker and squarer on masculine heads.
      const angleX = 0.34 * sx * jw;
      d = smin(d, capsule(x, y, z, 0.42 * sx, -0.04 * h, -0.07, angleX, -0.4 * h, -0.02, 0.072 + 0.016 * m), 0.12);
      d = smin(d, capsule(x, y, z, angleX, -0.4 * h, -0.02, 0.15 * jw, -0.56 * h, 0.32, 0.068 + 0.022 * m), 0.12);
      d = smin(d, ellipsoid(x, y, z, 0, -0.55 * h, 0.39 + 0.02 * k.chin, 0.07 + 0.035 * jw, 0.065 + 0.05 * k.chin, 0.07 + 0.065 * k.chin), 0.09);

      // Neck, with an Adam's apple on masculine busts
      d = smin(d, capsule(x, y, z, 0, -0.4 * h, -0.08, 0, -0.98, -0.07, neckR), 0.16);
      if (m > 0.05) d = smin(d, sphere(x, y, z, 0, -0.66, 0.1 + neckR * 0.45, 0.02 * m), 0.02);

      // Brow ridge and cheekbones sit on the skull; the ridge is heavier on masculine heads
      d = smin(d, capsule(x, y, z, 0, fy(0.21), 0.44, 0.3 * sx, fy(0.19), 0.4, 0.035 + 0.07 * p.brow * (0.65 + 0.5 * m)), 0.08);
      d = smin(d, ellipsoid(x, y, z, 0.26 * sx, fy(-0.04), 0.35, 0.09 * cheek, 0.07 * cheek, 0.1 * cheek), 0.12);

      // Heavier builds fill out the cheeks and jaw
      if (k.fullness > 0.02) {
        d = smin(d, ellipsoid(x, y, z, 0.3 * sx, fy(-0.2), 0.3, 0.12 * k.fullness + 0.01, 0.12 * k.fullness + 0.01, 0.1), 0.12);
        d = smin(d, ellipsoid(x, y, z, 0.24 * sx, fy(-0.36), 0.2, 0.1 * k.fullness + 0.01, 0.07 * k.fullness + 0.01, 0.1), 0.1);
      }

      // Ears: a rounded rim with a scooped bowl, stretching into a swept spike as the race calls for it
      if (earOn && x > 0.3) {
        const ear = 0.46 * sx;
        d = smin(d, ellipsoid(x, y, z, ear + 0.005, fy(0.06), -0.03, 0.022, 0.07 + 0.045 * k.earSize, 0.048), 0.02);
        d = smax(d, -ellipsoid(x, y, z, ear + 0.032, fy(0.06), -0.015, 0.02, 0.04, 0.024), 0.014);
        if (k.earSize > 0.4) {
          const reach = k.earSize - 0.3;
          d = smin(d, capsule(x, y, z, ear + 0.005, fy(0.1), -0.05, ear + 0.005 + 0.14 * reach, fy(0.16 + 0.3 * reach), -0.1, 0.026), 0.05);
        }
      }

      // ---- Facial features, only evaluated near the front of the face ----
      if (z > 0.2 && x < 0.5 && y < 0.3 * h && y > -0.66 * h) {
        // Each eye sits in a socket carved to fit it, framed by an upper and lower lid
        const recessZ = 0.435 - 0.06 * k.socketDepth;
        const dx = x - ex;
        const dy = y - ey;
        const dz = z - ez;
        d = smax(d, -ellipsoid(x, y, z, ex, ey, recessZ, 0.095 * k.eyeSize, 0.075 * k.eyeSize, 0.11), 0.07);
        const s = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // The skin can never enter the eyeball: a sphere is carved out of it exactly the eye's size...
        d = smax(d, lidInner - s, 0.004);
        // ...then the lids are thin shells that hug the eyeball. Each covers the part of the sphere
        // above or below its edge, so the eye is left open between them.
        const shell = Math.max(s - lidOuter, lidInner - s, -(dz + 0.1));
        const upper = Math.max(shell, lidTop * s - dy);
        const lower = Math.max(shell, lidBottom * s + dy);
        d = smin(d, smin(upper, lower, 0.006), 0.03);

        // Nose: one continuous structure from the root between the brows, down the bridge and out
        // to the tip, flaring into the wings of the nostrils and joining the upper lip. Every piece
        // blends into the next, so the nose is part of the face, never stuck on.
        const tipZ = 0.47 + 0.1 * nl;
        const bridgeR = 0.03 * Math.sqrt(nw);
        d = smin(d, capsule(x, y, z, 0, fy(0.17), 0.43, 0, fy(-0.115), tipZ - 0.02, bridgeR), 0.07);
        d = smin(d, sphere(x, y, z, 0, fy(-0.115), tipZ, 0.044 * Math.pow(nw, 0.6)), 0.06);
        d = smin(d, sphere(x, y, z, 0.056 * nw, fy(-0.105), tipZ - 0.055, 0.034), 0.05);
        d = smin(d, ellipsoid(x, y, z, 0, fy(-0.175), tipZ - 0.06, 0.05 * nw, 0.045, 0.06), 0.06);
        d = smax(d, -ellipsoid(x, y, z, 0.027 * nw, fy(-0.14), tipZ - 0.03, 0.013, 0.012, 0.028), 0.012);

        // Snout (dragonborn): the muzzle and upper jaw push forward as one mass
        if (k.snout > 0.02) {
          d = smin(d, ellipsoid(x, y, z, 0, fy(-0.2), 0.4 + 0.3 * k.snout, 0.15, 0.15, 0.06 + 0.26 * k.snout), 0.1);
          d = smin(d, ellipsoid(x, y, z, 0, fy(-0.4), 0.36 + 0.24 * k.snout, 0.12, 0.08, 0.05 + 0.22 * k.snout), 0.08);
        }

        // Lips, fuller on feminine faces and when the slider is raised
        d = smin(d, capsule(x, y, z, 0, fy(-0.285), 0.455, 0.088 * mw, fy(-0.28), 0.435, 0.018 * lf + 0.004), 0.016);
        d = smin(d, capsule(x, y, z, 0, fy(-0.34), 0.45, 0.082 * mw, fy(-0.335), 0.43, 0.024 * lf + 0.004), 0.02);

        // Gaunt cheeks: a long, shallow hollow below the cheekbone, blended widely so it reads as a sunken cheek
        if (k.gaunt > 0.02) {
          d = smax(d, -ellipsoid(x, y, z, 0.28 * sx, fy(-0.22), 0.43 - 0.03 * k.gaunt, 0.13 + 0.04 * k.gaunt, 0.17 + 0.04 * k.gaunt, 0.1), 0.2);
        }
      }
    }

    // ---- Shoulders and chest (skipped well above the collarbones) ----
    if (y < -0.5) {
      const yb = y - 0.09; // the shoulders ride a little higher so the neck is not too long
      let body = capsule(x, yb, z, 0.1, -0.82, -0.03, 0.62 * span, -1.0, -0.03, 0.12 * k.neckGirth);
      body = smin(body, capsule(x, yb, z, 0.05, -1.0, 0.12, 0.5 * span, -1.03, 0.08, 0.035), 0.04);
      body = smin(body, ellipsoid(x, yb, z, 0.74 * span, -1.08, -0.01, 0.17 * girth, 0.19, 0.17 * girth), 0.12);
      body = smin(body, ellipsoid(x, yb, z, 0, -1.26, 0, 0.66 * span * girth, 0.34, 0.3 * girth), 0.14);
      // Pectoral definition on masculine busts, a soft rise on feminine ones
      body = smin(body, ellipsoid(x, yb, z, 0.2, -1.2, 0.22, 0.2 * Math.max(m, 0.01), 0.11 * Math.max(m, 0.01), 0.1 * Math.max(m, 0.01)), 0.1);
      body = smin(body, ellipsoid(x, yb, z, 0.19, -1.3, 0.2, 0.17 * Math.max(f, 0.01), 0.15 * Math.max(f, 0.01), 0.13 * Math.max(f, 0.01)), 0.12);
      d = smin(d, body, 0.18);
    }

    // The flat underside the bust stands on
    return Math.max(d, BASE_Y - y);
  };

  // Conservative bounding shapes. `outer` must enclose everything; `inner` must sit inside it.
  const outer: Sdf = (px, y, z) => {
    const x = Math.abs(px);
    const head = ellipsoid(x, y, z, 0, 0.0, 0.1, 0.62 * w + 0.1, 0.85 * h, 0.88);
    const neck = capsule(x, y, z, 0, -0.35, -0.07, 0, -1.1, -0.07, neckR + 0.14);
    const chest = ellipsoid(x, y, z, 0, -1.15, 0, 0.86 * span * girth + 0.3, 0.5, 0.5);
    return Math.min(head, neck, chest);
  };
  const inner: Sdf = (px, y, z) => {
    const x = Math.abs(px);
    const skull = ellipsoid(x, y, z, 0, 0.1 * h, -0.08, 0.34 * sx, 0.4 * h, 0.38);
    const neck = capsule(x, y, z, 0, -0.5, -0.07, 0, -0.9, -0.07, neckR * 0.6);
    const chest = ellipsoid(x, y, z, 0, -1.26, 0, 0.5 * span, 0.22, 0.2);
    return Math.max(Math.min(skull, neck, chest), BASE_Y + 0.02 - y);
  };

  // The grid needs a clear margin around the shape: the mesher can only close surfaces that sit at
  // least a cell or two inside it.
  const bounds: Bounds = { halfX: 0.92 * span * girth + 0.35, minY: BASE_Y - 0.1, maxY: 0.75 * h + 0.15, minZ: -0.75, maxZ: 1.05 };
  return { sdf, outer, inner, bounds };
}
