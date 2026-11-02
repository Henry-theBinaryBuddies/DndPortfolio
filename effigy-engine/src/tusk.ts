import * as THREE from "three";

// A half-orc's tusk as one closed solid: a tube swept along a curve through the given points (from its root in the
// gum to its tip), round in section, thickest at the root and tapering to a blunt rounded point. A tusk is a tooth
// of the lower jaw that has to leave a closed mouth: from its place in the row of teeth it runs forward through the
// parting of the lips and then curves up in front of the upper lip, as a boar's does, so it is built along a
// curve rather than set in straight.

const SIDES = 14;
const RINGS = 48;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export function tuskGeometry(points: THREE.Vector3[], base: number, tip: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const { normals, binormals } = curve.computeFrenetFrames(RINGS, false);
  const positions: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const centre = curve.getPointAt(t);
    // (keeping its girth past the lips and tapering toward the tip, rounding off over the last tenth so the point is
    // blunt and prints)
    const radius = (base + (tip - base) * t ** 1.4) * (1 - 0.75 * smooth((t - 0.9) / 0.1));
    for (let j = 0; j < SIDES; j++) {
      const a = (2 * Math.PI * j) / SIDES;
      const [c, s] = [Math.cos(a) * radius, Math.sin(a) * radius];
      positions.push(centre.x + normals[i].x * c + binormals[i].x * s, centre.y + normals[i].y * c + binormals[i].y * s, centre.z + normals[i].z * c + binormals[i].z * s);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * SIDES + j;
      const b = i * SIDES + ((j + 1) % SIDES);
      index.push(a, a + SIDES, b, b, a + SIDES, b + SIDES);
    }
  }
  // The ends: a point in the middle of each
  const root = positions.length / 3;
  const start = curve.getPointAt(0);
  const end = curve.getPointAt(1);
  positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
  for (let j = 0; j < SIDES; j++) {
    const k = (j + 1) % SIDES;
    // (each cap wound to match the sides it closes, so every edge is shared by two triangles running opposite ways)
    index.push(root, j, k);
    index.push(root + 1, RINGS * SIDES + k, RINGS * SIDES + j);
  }
  // Wound outward whichever way the frames turned: the signed volume must be positive
  let volume = 0;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
    const p = positions;
    volume += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  if (volume < 0) for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
