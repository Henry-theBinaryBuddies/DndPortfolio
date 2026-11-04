import { RACE_INFO, type Params } from "./params";

// Broad forms shared by the humanoid sculpt and grooming builders.
// Dragonborn has a separate builder and does not use these fields.
const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export function sweptVolume(x: number, y: number, z: number): number {
  const crown = smooth((y - 0.08) / 0.4);
  const forelock = Math.exp(-(((x + 0.13) / 0.27) ** 2) - ((z - 0.06) / 0.32) ** 2);
  const part = Math.exp(-(((x - 0.18 + 0.1 * z) / 0.07) ** 2));
  // A broad swept forelock, a shallow off-centre part, and a quieter side/nape.
  return 0.017 + crown * (0.055 + 0.085 * forelock - 0.014 * part)
    + 0.012 * smooth((-z - 0.2) / 0.3);
}

export function sweptCoordinate(x: number, y: number, z: number): number {
  const axisY = 0.05 - 0.6 * smooth((-z - 0.1) / 0.5);
  return 0.5 * Math.atan2(x + 0.12 * smooth((z + 0.4) / 0.5), y - axisY)
    + 0.075 * z + 0.018 * Math.sin(z * 5 + x * 3);
}

export function sweptClumps(x: number, y: number, z: number): number {
  const across = sweptCoordinate(x, y, z);
  // Larger primary locks establish the volume; carved secondary grooves remain subordinate.
  return 1 + 0.085 * Math.sin(across * 32 + z * 1.4) * smooth((y - 0.1) / 0.3);
}

// A contour with temple recession, a restrained central point and broad, uneven
// clump endings. This is a growth field used by geometry AND the skin paint.
export function scalpContour(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const temple = Math.exp(-(((ax - 0.235) / 0.085) ** 2));
  const point = Math.exp(-((ax / 0.065) ** 2));
  const front = 0.365 + 0.085 * temple - 0.028 * point - 0.205 * smooth((ax - 0.27) / 0.16);
  const toSide = smooth((-z - 0.18) / 0.2);
  const toBack = smooth((-z - 0.44) / 0.12);
  let threshold = (front + (0.12 - front) * toSide) * (1 - toBack) - 0.42 * toBack;
  const sideburn = Math.exp(-(((z + 0.205) / 0.075) ** 2)) * smooth((ax - 0.31) / 0.08);
  threshold -= 0.23 * sideburn * (1 - toBack);
  threshold += (0.008 * Math.sin(x * 47 + z * 9) + 0.003 * Math.sin(x * 89 - z * 13)) * (1 - toBack);
  // (over a band about four mesh rows wide: narrower, the hair's edge followed the rows as a stepped line)
  return smooth((y - threshold + 0.03) / 0.12);
}

export function beardVolume(x: number, y: number, z: number, style: "short" | "full" | "goatee"): number {
  const ax = Math.abs(x);
  const lower = smooth((-0.36 - y) / 0.22);
  const chin = (1 - smooth((ax - 0.13) / 0.18)) * smooth((z + 0.08) / 0.18);
  const moustache = Math.exp(-(((ax - 0.075) / 0.075) ** 2) - ((y + 0.295) / 0.045) ** 2) * smooth((z + 0.05) / 0.15);
  if (style === "short") return 0.013 + 0.014 * lower + 0.014 * moustache;
  if (style === "goatee") return 0.014 + 0.065 * lower * chin + 0.018 * moustache;
  const fullChin = smooth((-0.45 - y) / 0.15) * (1 - 0.5 * smooth((ax - 0.18) / 0.15));
  return 0.024 + 0.1 * fullChin + 0.018 * moustache;
}

export function beardMasses(x: number, y: number, z: number): number {
  const angle = Math.atan2(x, z + 0.3);
  return 0.9 + 0.1 * Math.cos(angle * 7.5 + 0.45 * Math.sin(y * 4) + 0.15 * Math.sin(angle * 3));
}

// The existing eight races share this head topology. Normalize only the grooming
// fields to its authored frame; each race keeps its skull, ears, tusks and face.
export function groomingFrame(p: Params) {
  return RACE_INFO[p.race].skeleton;
}
