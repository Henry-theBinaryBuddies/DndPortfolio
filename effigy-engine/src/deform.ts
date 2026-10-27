import { LANDMARK, type HeadBase, type Vec3 } from "./headMesh";
import { derive, masculinity, type Params } from "./params";

// Every slider, race and build becomes a small, smooth displacement of the base head's vertices in the
// right place: push the brow outward, hollow the cheek, lengthen the nose tip, scale the lips about the
// mouth line, widen the jaw, stretch the ears. The base head already has real lips, nostrils, eyelids and
// ears, so the result keeps real anatomy; the displacements only vary it. Displacements fade to nothing
// around the eyes so the eyelids always fit the eyeballs.

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Distance from a point to a line segment in 3D
function distanceToSegment3(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const t = Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / (abx * abx + aby * aby + abz * abz)));
  return Math.hypot(px - ax - abx * t, py - ay - aby * t, pz - az - abz * t);
}

// Distance from a point to a line segment, in the front view
function distanceToSegment2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - ax - abx * t, py - ay - aby * t);
}

// Where each tusk roots, beside the middle of the lower lip (before the mouth is widened)
export const TUSK_X = 0.095;

export interface Deformed {
  positions: Float32Array;
  eyes: { left: Vec3; right: Vec3; radius: number };
}

export function deformHead(base: HeadBase, p: Params): Deformed {
  const k = derive(p);
  const m = masculinity(p);
  const gender = (m - 0.5) * 2; // +1 masculine, -1 feminine
  const count = base.positions.length / 3;
  const out = new Float32Array(base.positions.length);
  const eyeX = LANDMARK.eyeX;
  const lipScale = k.lipFull * (1 + 0.15 * (1 - m));
  const { menton, stomion } = LANDMARK;
  const axis = base.neck;

  // The shoulders and chest come from two sculpted bodies; the build blends between them
  const f = 1 - m;
  const fem = base.feminine;
  for (let i = 0; i < count; i++) {
    const x0 = base.positions[i * 3] + f * (fem.positions[i * 3] - base.positions[i * 3]);
    const y0 = base.positions[i * 3 + 1] + f * (fem.positions[i * 3 + 1] - base.positions[i * 3 + 1]);
    const z0 = base.positions[i * 3 + 2] + f * (fem.positions[i * 3 + 2] - base.positions[i * 3 + 2]);
    const nx = base.normals[i * 3] + f * (fem.normals[i * 3] - base.normals[i * 3]);
    const ny = base.normals[i * 3 + 1] + f * (fem.normals[i * 3 + 1] - base.normals[i * 3 + 1]);
    const nz = base.normals[i * 3 + 2] + f * (fem.normals[i * 3 + 2] - base.normals[i * 3 + 2]);
    const ax = Math.abs(x0);
    const side = x0 < 0 ? -1 : 1;

    // Nothing moves right at the eyes, so the lids keep fitting the eyeballs
    const eyeDistance = Math.sqrt((ax - eyeX) * (ax - eyeX) + y0 * y0 + z0 * z0);
    const mask = 1 - Math.exp(-((eyeDistance / 0.12) ** 2));

    let dx = 0;
    let dy = 0;
    let dz = 0;
    // A soft blob centred on a landmark (mirrored left to right)
    const blob = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) =>
      Math.exp(-(((ax - cx) / sx) ** 2 + ((y0 - cy) / sy) ** 2 + ((z0 - cz) / sz) ** 2));
    // Push a blob outward (or inward) along the surface normal
    const push = (weight: number, amount: number) => {
      const a = weight * amount * mask;
      dx += nx * a;
      dy += ny * a;
      dz += nz * a;
    };

    // Brow ridge, heavier on masculine heads, and the bump between the brows. (The feminine build's softer
    // brow, narrower jaw and smaller chin come from its sculpted face, so these only add masculine weight.)
    push(blob(0.13, 0.13, 0.19, 0.17, 0.06, 0.12), (-0.01 + 0.075 * k.brow) * (0.9 + 0.4 * m) + 0.015 * k.socketDepth);
    push(blob(0, 0.12, 0.2, 0.08, 0.06, 0.1), 0.03 * k.brow * m);

    // Cheekbones, the hollow beneath them, and the temples
    push(blob(0.3, -0.12, 0.12, 0.13, 0.09, 0.12), -0.015 + 0.09 * k.cheek);
    push(blob(0.27, -0.3, 0.1, 0.15, 0.15, 0.12), -0.08 * k.gaunt + 0.07 * k.fullness);
    push(blob(0.36, 0.18, -0.02, 0.1, 0.14, 0.14), -0.035 * k.gaunt);

    // Nose: the tip moves forward or back, the bridge rises, the wings of the nostrils widen
    dz += (k.noseLength - 0.4) * 0.3 * blob(0, -0.15, 0.2, 0.1, 0.12, 0.12);
    push(blob(0, -0.05, 0.17, 0.05, 0.12, 0.1), (k.noseLength - 0.4) * 0.05);
    dx += x0 * (k.noseWidth - 1) * 0.7 * blob(0, -0.2, 0.17, 0.16, 0.12, 0.12);

    // Nose structure: bridge height (flat for an orc, high for an elf), and the creases that wrap the
    // nostril wings
    push(blob(0, -0.03, 0.17, 0.05, 0.14, 0.1), k.noseBridge * 0.05);
    push(blob(0.11, -0.23, 0.14, 0.025, 0.05, 0.06), -0.014);

    // Nasolabial folds: a soft groove from the side of the nose toward the corner of the mouth, ending
    // above it. Young faces barely have one; it deepens with age and with a heavy face. (Carved deep at
    // every age, and run past the corner, it read as trenches beside the mouth.)
    const foldDistance = distanceToSegment2(ax, y0, 0.095, -0.24, 0.135, -0.33);
    const foldEnd = smooth((y0 + 0.37) / 0.05);
    push(Math.exp(-((foldDistance / 0.03) ** 2)) * Math.max(0, nz) * foldEnd, -(0.002 + 0.022 * Math.max(0, p.age - 0.2) + 0.006 * k.fullness) * (0.8 + 0.4 * k.angularity));

    // Forehead recession (a sloped brow for an orc) and a jutting lower face (a heavy jaw)
    const forehead = smooth((y0 - 0.15) / 0.2) * (1 - smooth((y0 - 0.5) / 0.1)) * smooth((z0 + 0.1) / 0.2);
    dz -= k.slope * 0.1 * forehead;
    // (The jut is around the mouth and teeth; carried down to the bottom of the chin it made a long shelf.)
    const lowerFace = smooth((-0.18 - y0) / 0.12) * (1 - smooth((-0.48 - y0) / 0.1)) * smooth((z0 + 0.2) / 0.3);
    dz += k.prognathism * 0.1 * lowerFace;

    // Hard structure, scaled by how angular the race is: the bony rim around each eye, the hollow just
    // beneath it, the temporal line up the side of the forehead, the edge of the jaw, the bulge of the
    // chewing muscle on masculine faces, and heavier jowls with age and weight
    const edge = 0.35 + 0.65 * k.angularity;
    // (Only above and beside the eye: run under the lower lid it raised a ridge with a trough behind it.)
    const rim = Math.exp(-(((eyeDistance - 0.115) / 0.02) ** 2)) * (0.4 + 0.6 * Math.max(0, nz)) * smooth((y0 + 0.04) / 0.08);
    push(rim, (0.006 + 0.022 * k.angularity) * (0.7 + 0.5 * m));
    push(blob(0.2, -0.17, 0.09, 0.09, 0.035, 0.1), -0.01 * k.angularity);
    const temporal = distanceToSegment3(ax, y0, z0, 0.3, 0.2, 0.02, 0.28, 0.5, -0.3);
    push(Math.exp(-((temporal / 0.03) ** 2)), 0.006 + 0.014 * k.angularity);
    const jawEdge = Math.min(distanceToSegment3(ax, y0, z0, 0.38, -0.22, -0.38, 0.33, -0.46, -0.12), distanceToSegment3(ax, y0, z0, 0.33, -0.46, -0.12, 0.1, -0.58, 0.12));
    push(Math.exp(-((jawEdge / 0.04) ** 2)), (0.008 + 0.03 * k.angularity) * (0.5 + 0.6 * m));
    push(blob(0.36, -0.32, -0.2, 0.07, 0.12, 0.12), 0.015 * Math.max(0, gender) * (0.5 + k.angularity));
    push(blob(0.26, -0.43, 0.1, 0.07, 0.05, 0.1), 0.03 * Math.max(0, p.age - 0.45) + 0.025 * k.fullness);
    // The wings of the nose and the ridge of the nasal bones
    push(blob(0.1, -0.21, 0.15, 0.03, 0.035, 0.05), 0.008 + 0.01 * edge);
    push(blob(0, -0.06, 0.17, 0.026, 0.1, 0.08), 0.008 * edge + k.noseBridge * 0.02);
    // The cords of the neck: the muscle that runs from behind each ear down to the notch between the collarbones
    const cord = distanceToSegment3(ax, y0, z0, 0.34, -0.42, -0.42, 0.07, -0.92, -0.12);
    push(Math.exp(-((cord / 0.04) ** 2)) * smooth((-0.45 - y0) / 0.1), (0.005 + 0.01 * Math.max(0, gender) + 0.006 * (p.muscle - 0.45)) * (0.6 + 0.5 * k.angularity));

    // Lips: fuller lips grow taller about the mouth line and push forward; thinner ones only flatten
    // (squashing them toward the mouth line pinches the corners open). The base sculpt already has a real
    // mouth (the cupid's bow, the philtrum, tapered corners), so nothing else is added.
    const lips = blob(0, stomion, 0.16, 0.2, 0.06, 0.2);
    dy += (y0 - stomion) * Math.max(0, lipScale - 1) * 0.28 * lips;
    push(lips, (lipScale - 1) * 0.03);
    dx += x0 * (k.mouthWidth - 1) * 0.8 * lips;
    // Tusks press up behind the lower lip, so it bulges a little over each one
    if (k.tusks > 0) push(blob(TUSK_X, stomion - 0.03, 0.16, 0.025, 0.025, 0.06), 0.012 * k.tusks);

    // Chin projection and jaw breadth (the jaw runs from below the mouth to the chin)
    push(blob(0, -0.5, 0.1, 0.14, 0.09, 0.14), (k.chin - 0.4) * 0.15 + 0.02 + 0.02 * m);
    // (The jaw widens from below the mouth: widened from just under the cheekbones, it swelled the cheeks
    // into balloons.)
    const jaw = smooth((-0.3 - y0) / 0.14) * (1 - smooth((-0.66 - y0) / 0.12));
    dx += x0 * (k.jawWidth - 1 + 0.06 * Math.max(0, gender)) * jaw;

    // Ears: scaled, and swept up into a point for elven ears
    const ear = blob(0.44, -0.08, -0.45, 0.09, 0.2, 0.16);
    const earDelta = k.earSize - 0.3;
    const earTip = ear * smooth((y0 + 0.1) / 0.15);
    dy += (y0 + 0.1) * earDelta * 0.3 * ear + earDelta * 0.3 * earTip;
    dx += side * earDelta * 0.12 * ear;
    dz -= Math.max(0, earDelta) * 0.1 * earTip;

    // Neck: thicker with muscle and weight (the sculpted bodies already give the build's neck); an
    // Adam's apple on masculine ones
    const neckBand = smooth((-0.62 - y0) / 0.12) * (1 - smooth((-0.95 - y0) / 0.12));
    const girth = k.neckGirth - 1 + 0.04 * Math.max(0, gender);
    dx += (x0 - axis.x) * girth * neckBand;
    dz += (z0 - axis.z) * girth * neckBand;
    const adamsApple = Math.exp(-((ax / 0.07) ** 2) - (((y0 + 0.8) / 0.06) ** 2)) * Math.max(0, nz);
    const apple = 0.035 * Math.max(0, gender) * adamsApple;
    dx += nx * apple;
    dy += ny * apple;
    dz += nz * apple;

    // Shoulders: broader with muscle and with the race's frame (the build's own breadth is in the sculpt)
    const shoulders = smooth((-0.85 - y0) / 0.25);
    dx += x0 * (k.shoulders - 1) * shoulders;
    // A fuller chest with weight
    const chest = Math.exp(-(((ax - 0.25) / 0.2) ** 2) - (((y0 + 1.4) / 0.2) ** 2)) * Math.max(0, nz);
    const chestPush = 0.03 * k.fullness;
    dx += nx * chest * chestPush;
    dy += ny * chest * chestPush;
    dz += nz * chest * chestPush;

    // Heavy lids: the upper lid slides down over the eyeball. Each lid vertex turns about the eye's own
    // centre (about its horizontal axis), so it keeps its distance from the eye and can never cut into it.
    // The turn is strongest at the lid's edge and fades out toward the corners of the eye and up the lid.
    const eyeR = base.eyes.radius;
    if (eyeDistance < 2 * eyeR && z0 > -0.2 * eyeR && y0 > -0.3 * eyeR) {
      const rx = ax - eyeX;
      const near = 1 - smooth((eyeDistance - 1.05 * eyeR) / (0.9 * eyeR));
      const upper = smooth((y0 + 0.1 * eyeR) / (0.5 * eyeR));
      const corners = Math.max(0, 1 - (rx / (1.3 * eyeR)) ** 2);
      const turn = (0.02 + 0.36 * p.lids) * near * upper * corners;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      dy += y0 * c - z0 * s - y0;
      dz += y0 * s + z0 * c - z0;
    }

    // Skull breadth and height scale the whole head about the middle of its width and the chin
    const head = smooth((y0 + 0.75) / 0.25);
    out[i * 3] = (x0 + dx) * (1 + (k.headWidth - 1) * head);
    out[i * 3 + 1] = y0 + dy + (k.headHeight - 1) * (y0 - menton) * head;
    out[i * 3 + 2] = z0 + dz;
  }

  // The eyes follow the skull scaling, so they stay centred in their sockets
  const headAtEyes = smooth((0 + 0.75) / 0.25);
  const sx = 1 + (k.headWidth - 1) * headAtEyes;
  const eyeY = (k.headHeight - 1) * (0 - menton) * headAtEyes;
  return {
    positions: out,
    eyes: {
      left: [eyeX * sx, eyeY, 0],
      right: [-eyeX * sx, eyeY, 0],
      // The smaller of the two scalings, so a skull that gets narrower or shorter never squeezes the lids onto a larger eyeball
      radius: base.eyes.radius * Math.min(sx, 1 + (k.headHeight - 1) * headAtEyes),
    },
  };
}
