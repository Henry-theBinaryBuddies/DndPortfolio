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

// Distance from a point to a line segment, in the front view
function distanceToSegment2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - ax - abx * t, py - ay - aby * t);
}

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

  for (let i = 0; i < count; i++) {
    const x0 = base.positions[i * 3];
    const y0 = base.positions[i * 3 + 1];
    const z0 = base.positions[i * 3 + 2];
    const nx = base.normals[i * 3];
    const ny = base.normals[i * 3 + 1];
    const nz = base.normals[i * 3 + 2];
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

    // Brow ridge, heavier on masculine heads, and the bump between the brows
    push(blob(0.13, 0.13, 0.19, 0.17, 0.06, 0.12), (-0.01 + 0.075 * k.brow) * (0.7 + 0.6 * m) + 0.015 * k.socketDepth);
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

    // Nasolabial folds: a groove from the side of the nose down past the corner of the mouth, deeper
    // with age and with a heavy face
    const foldDistance = distanceToSegment2(ax, y0, 0.09, -0.25, 0.145, -0.37);
    push(Math.exp(-((foldDistance / 0.022) ** 2)) * Math.max(0, nz), -(0.008 + 0.018 * p.age + 0.008 * k.fullness));

    // Forehead recession (a sloped brow for an orc) and a jutting lower face (a heavy jaw)
    const forehead = smooth((y0 - 0.15) / 0.2) * (1 - smooth((y0 - 0.5) / 0.1)) * smooth((z0 + 0.1) / 0.2);
    dz -= k.slope * 0.1 * forehead;
    const lowerFace = smooth((-0.15 - y0) / 0.15) * (1 - smooth((-0.62 - y0) / 0.12)) * smooth((z0 + 0.2) / 0.3);
    dz += k.prognathism * 0.1 * lowerFace;

    // Lips: scaled about the mouth line so they get taller and fuller, and the mouth widens
    const lips = blob(0, stomion, 0.16, 0.2, 0.06, 0.2);
    dy += (y0 - stomion) * (lipScale - 1) * 0.28 * lips;
    push(lips, (lipScale - 1) * 0.03);
    dx += x0 * (k.mouthWidth - 1) * 0.8 * lips;

    // Lip definition: a groove along the mouth line that deepens toward the corners, the two peaks of
    // the cupid's bow with the philtrum ridges rising to them, and the crease under the lower lip
    const cornerDepth = 0.4 + 0.6 * smooth((ax - 0.05) / 0.08);
    push(blob(0, stomion, 0.17, 0.2, 0.014, 0.18) * cornerDepth, -0.007 * Math.min(lipScale, 1.4));
    push(blob(0.035, -0.332, 0.17, 0.026, 0.02, 0.08), 0.006 * lipScale);
    push(blob(0.035, -0.29, 0.17, 0.018, 0.035, 0.08), 0.003);
    push(blob(0, -0.451, 0.14, 0.12, 0.018, 0.1), -0.009);

    // Chin projection and jaw breadth (the jaw runs from just below the cheeks to the chin)
    push(blob(0, -0.5, 0.1, 0.14, 0.09, 0.14), (k.chin - 0.4) * 0.2 + 0.04 * m);
    const jaw = smooth((-0.18 - y0) / 0.14) * (1 - smooth((-0.66 - y0) / 0.12));
    dx += x0 * (k.jawWidth - 1 + 0.06 * gender) * jaw;

    // Ears: scaled, swept up into a point for elven ears, or pressed flat against the head for none
    const ear = blob(0.44, -0.08, -0.45, 0.09, 0.2, 0.16);
    const earDelta = k.earSize - 0.3;
    const earTip = ear * smooth((y0 + 0.1) / 0.15);
    dy += (y0 + 0.1) * earDelta * 0.3 * ear + earDelta * 0.3 * earTip;
    dx += side * earDelta * 0.12 * ear;
    dz -= Math.max(0, earDelta) * 0.1 * earTip;

    // Snout (dragonborn): the muzzle pushes forward and broadens
    const snout = blob(0, -0.3, 0.2, 0.28, 0.3, 0.25);
    dz += k.snout * 0.5 * snout;
    dx += x0 * k.snout * 0.2 * snout;

    // Neck: thicker with muscle and weight, and on masculine builds; an Adam's apple on masculine ones
    const neckBand = smooth((-0.62 - y0) / 0.12) * (1 - smooth((-0.95 - y0) / 0.12));
    const girth = k.neckGirth - 1 + 0.1 * gender;
    dx += (x0 - axis.x) * girth * neckBand;
    dz += (z0 - axis.z) * girth * neckBand;
    const adamsApple = Math.exp(-((ax / 0.07) ** 2) - (((y0 + 0.8) / 0.06) ** 2)) * Math.max(0, nz);
    const apple = 0.035 * Math.max(0, gender) * adamsApple;
    dx += nx * apple;
    dy += ny * apple;
    dz += nz * apple;

    // Shoulders: broader with muscle, on masculine builds, and with the race's frame
    const shoulders = smooth((-0.85 - y0) / 0.25);
    dx += x0 * (k.shoulders - 1 + 0.1 * gender) * shoulders;
    // A soft chest rise on feminine busts, a fuller chest with weight
    const chest = Math.exp(-(((ax - 0.25) / 0.2) ** 2) - (((y0 + 1.15) / 0.16) ** 2)) * Math.max(0, nz);
    const chestPush = 0.05 * Math.max(0, -gender) + 0.03 * k.fullness;
    dx += nx * chest * chestPush;
    dy += ny * chest * chestPush;
    dz += nz * chest * chestPush;

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
