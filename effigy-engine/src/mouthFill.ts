import * as THREE from "three";
import { hullGeometry } from "./hull";

// The base head has a hollow mouth behind its lips: a pocket about 13 x 16 x 9 mm at print scale, whose roof is
// a flat ceiling over open air. With the lips shut it cannot be seen, and printed it is all cost: a ceiling that
// has to bridge, and supports inside a pocket nobody can reach. So with the jaw closed the export fills it.
// The filling is the convex hull of the pocket's own walls (the vertices of the head that face into it, so it
// follows each face as it is deformed), grown a few percent about its middle so it reaches into the walls on
// every side and joins the head as one solid. (The walls are thicker than that: about 2 mm at the lips.)

const BOX = { x: 0.3, yLow: -0.5, yHigh: -0.17, zBack: -0.6, zFront: 0.1 }; // head units: where the pocket can be
const MIDDLE = new THREE.Vector3(0, -0.32, -0.18); // inside the pocket, on the middle of the face
const FACING = 0.5; // a wall's normal must point at least this much (cosine) toward the middle
const GROWTH = new THREE.Vector3(1.05, 1.12, 1.04); // (taller most: the roof curves, and a hull cannot follow a dimple in it)
const MIN_WALL = 40; // fewer vertices than this: not the pocket (some other head), nothing to fill

export function buildMouthFill(positions: ArrayLike<number>, normals: ArrayLike<number>, jawOpen: number): THREE.BufferGeometry | null {
  if (jawOpen >= 0.02) return null;
  const wall: THREE.Vector3[] = [];
  const toMiddle = new THREE.Vector3();
  for (let i = 0; i < positions.length / 3; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (Math.abs(x) > BOX.x || y < BOX.yLow || y > BOX.yHigh || z < BOX.zBack || z > BOX.zFront) continue;
    toMiddle.set(MIDDLE.x - x, MIDDLE.y - y, MIDDLE.z - z).normalize();
    if (toMiddle.x * normals[i * 3] + toMiddle.y * normals[i * 3 + 1] + toMiddle.z * normals[i * 3 + 2] < FACING) continue;
    wall.push(new THREE.Vector3(x, y, z));
  }
  if (wall.length < MIN_WALL) return null;
  const centre = wall.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(wall.length);
  for (const v of wall) v.sub(centre).multiply(GROWTH).add(centre);

  return hullGeometry(wall);
}
