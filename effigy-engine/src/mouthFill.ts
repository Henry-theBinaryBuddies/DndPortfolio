import * as THREE from "three";
import { hullGeometry } from "./hull";
import { MM } from "./print";

// The base head has a hollow mouth behind its lips: a pocket about 13 x 16 x 9 mm at print scale, whose roof is
// a flat ceiling over open air. With the lips shut it cannot be seen, and printed it is all cost: a ceiling that
// has to bridge, and supports inside a pocket nobody can reach. So with the jaw closed the export fills it.
// The filling is the convex hull of the pocket's own walls (the vertices of the head that face into it, so it
// follows each face as it is deformed), grown a few percent about its middle so it reaches into the walls on
// every side and joins the head as one solid. (The walls are thicker than that: about 2 mm at the lips.)
// With the jaw open the pocket shows between the lips, and printed whole its roof was a bridge some 15 mm deep
// that sagged into a hole. So it is filled then too, but only up to RECESS behind the front of the front teeth:
// the mouth still reads as open, with the teeth in it, and the roof bridges no more than that.

const BOX = { x: 0.3, yLow: -0.5, yHigh: -0.17, zBack: -0.6, zFront: 0.1 }; // head units: where the pocket can be
const OPEN_LOW = 0.15; // how much lower the box reaches with the jaw fully open (the floor of the mouth drops with it)
const RECESS = 3 * MM; // how far behind the front teeth the filling stops, with the jaw open
const MIDDLE = new THREE.Vector3(0, -0.32, -0.18); // inside the pocket, on the middle of the face
const FACING = 0.5; // a wall's normal must point at least this much (cosine) toward the middle
const GROWTH = new THREE.Vector3(1.05, 1.12, 1.04); // (taller most: the roof curves, and a hull cannot follow a dimple in it)
const ROUNDS = 16; // at most this many times the hull is tried for faces through the skin and made again
const PULL = { near: 0.05, by: 0.15 }; // wall points this near such a face are drawn this far toward the middle
const MIN_WALL = 40; // fewer vertices than this: not the pocket (some other head), nothing to fill

// (`teethFront`: with the jaw open, how far forward the front teeth reach, z; without teeth there is no filling)
// The walls are chosen on the head as sculpted (`base`, the undeformed head, with the same vertices), so they are
// the pocket's own walls whatever the face does: chosen on the face as reshaped, a snarl lifted the outside of the
// upper lip into the box, the filling took it for wall, and grown, it came out through the skin beside the nose.
export function buildMouthFill(positions: ArrayLike<number>, normals: ArrayLike<number>, jawOpen: number, teethFront?: number, base?: { positions: ArrayLike<number>; normals: ArrayLike<number> }, outside?: (v: THREE.Vector3) => boolean): THREE.BufferGeometry | null {
  const open = jawOpen >= 0.02;
  if (open && teethFront === undefined) return null;
  const choose = base ?? { positions, normals };
  // (on the reshaped face the floor of the mouth drops with an open jaw, so the box reaches lower; the sculpted
  // head's floor is where it always is)
  const yLow = BOX.yLow - (open && !base ? OPEN_LOW * jawOpen : 0);
  const wall: THREE.Vector3[] = [];
  const toMiddle = new THREE.Vector3();
  for (let i = 0; i < positions.length / 3; i++) {
    const [x, y, z] = [choose.positions[i * 3], choose.positions[i * 3 + 1], choose.positions[i * 3 + 2]];
    if (Math.abs(x) > BOX.x || y < yLow || y > BOX.yHigh || z < BOX.zBack || z > BOX.zFront) continue;
    toMiddle.set(MIDDLE.x - x, MIDDLE.y - y, MIDDLE.z - z).normalize();
    if (toMiddle.x * choose.normals[i * 3] + toMiddle.y * choose.normals[i * 3 + 1] + toMiddle.z * choose.normals[i * 3 + 2] < FACING) continue;
    wall.push(new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
  }
  if (wall.length < MIN_WALL) return null;
  const centre = wall.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(wall.length);
  for (const v of wall) v.sub(centre).multiply(GROWTH).add(centre);
  // (with the jaw open, the front of the filling is pressed back flat, a little behind the teeth)
  if (open) for (const v of wall) v.z = Math.min(v.z, teethFront! - RECESS);

  let hull = hullGeometry(wall);
  // Grown, the filling can come out through the skin where the flesh over the pocket is thin (a snarl draws the upper
  // lip up under the nose until there is next to none), at a corner or across a face: it is convex, and the skin is
  // not (the crease between the wing of the nose and the lip curves in), so a face can cut out between corners
  // that are all inside. So the corners and points across the faces of its front half (the back is deep in the
  // head) are tried against the face (`outside`), and wherever one is outside, the wall points near it are drawn in
  // and the hull made again. (With the mouth shut only: open, the front of the filling looks out through the mouth,
  // which would read as outside, and it is pressed back behind the teeth anyway.)
  const check = open ? undefined : outside;
  for (let round = 0; check && round < ROUNDS; round++) {
    const position = hull.attributes.position;
    const index = hull.index!;
    const out: THREE.Vector3[] = [];
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const tried = new Set<string>();
    const test = (point: THREE.Vector3) => {
      if (point.z < centre.z) return;
      const key = `${point.x.toFixed(5)},${point.y.toFixed(5)},${point.z.toFixed(5)}`;
      if (tried.has(key)) return;
      tried.add(key);
      if (check(point)) out.push(point);
    };
    for (let t = 0; t < index.count; t += 3) {
      a.fromBufferAttribute(position, index.getX(t));
      b.fromBufferAttribute(position, index.getX(t + 1));
      c.fromBufferAttribute(position, index.getX(t + 2));
      for (const point of [a.clone(), b.clone(), c.clone(), a.clone().add(b).add(c).divideScalar(3), a.clone().lerp(b, 0.5), b.clone().lerp(c, 0.5), c.clone().lerp(a, 0.5)]) test(point);
    }
    if (!out.length) break;
    for (const v of wall) if (out.some((point) => point.distanceTo(v) < PULL.near)) v.lerp(centre, PULL.by);
    hull.dispose();
    hull = hullGeometry(wall);
  }
  return hull;
}
