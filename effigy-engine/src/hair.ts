// Where hair grows. The hair itself is a sculpted shell over the scalp, with a draped curtain for long
// hair's hanging lengths (see hairShell.ts); this file says which parts of the head carry it.

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Half the width of a mohawk's strip; everywhere else on the scalp is shaved
export const STRIP_HALF_WIDTH = 0.15;

// How much of a point on the head lies inside the hair-bearing scalp: nothing on the face below the
// hairline or on the ears, full above the brow, around the sides, and down the back of the head.
export function scalp(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const front = 0.38 - 0.16 * smooth((ax - 0.14) / 0.22);
  const side = 0.12;
  const back = -0.42;
  const toSide = smooth((-z - 0.18) / 0.2);
  // (down to the nape from just behind the ear, so the hair comes down behind it: dropping only from well behind the
  // ear, it left a band of bare skin between the ear and the hair; on the ear itself the hair keeps off, see
  // earClear in headMesh.ts)
  const toBack = smooth((-z - 0.44) / 0.12);
  const threshold = (front + (side - front) * toSide) * (1 - toBack) + back * toBack;
  return smooth((y - threshold) / 0.04);
}
