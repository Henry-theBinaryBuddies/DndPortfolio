import type { Params } from "./params";

// Where hair grows. The hair itself is a sculpted shell over the scalp, with a draped curtain for long
// hair's hanging lengths (see hairShell.ts); this file says which parts of the head carry it.

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Half the width of a mohawk's strip; everywhere else on the scalp is shaved
export const STRIP_HALF_WIDTH = 0.15;

// How shaved the scalp is at a point: 1 on the sides of a mohawk, where the skin shows the shadow of
// stubble, and 0 everywhere else
export function shavedWeight(p: Params, x: number, y: number, z: number): number {
  if (p.hairStyle !== "mohawk") return 0;
  return scalp(x, y, z) * smooth((Math.abs(x) - STRIP_HALF_WIDTH + 0.02) / 0.05);
}

// How much of a point on the head lies inside the hair-bearing scalp: nothing on the face below the
// hairline or on the ears, full above the brow, around the sides, and down the back of the head.
export function scalp(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const front = 0.38 - 0.16 * smooth((ax - 0.14) / 0.22);
  const side = 0.12;
  const back = -0.42;
  const toSide = smooth((-z - 0.18) / 0.2);
  const toBack = smooth((-z - 0.55) / 0.15);
  const threshold = (front + (side - front) * toSide) * (1 - toBack) + back * toBack;
  return smooth((y - threshold) / 0.04);
}
