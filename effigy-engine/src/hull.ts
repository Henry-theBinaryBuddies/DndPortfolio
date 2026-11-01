import * as THREE from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";

// The convex hull of some points as a closed, indexed mesh wound outward
export function hullGeometry(wall: THREE.Vector3[]): THREE.BufferGeometry {
  const hull = new ConvexHull().setFromPoints(wall);
  const index = new Map<THREE.Vector3, number>();
  const out: number[] = [];
  const triangles: number[] = [];
  for (const face of hull.faces) {
    let edge = face.edge;
    const corners: number[] = [];
    do {
      const point = edge.head().point;
      let k = index.get(point);
      if (k === undefined) {
        k = out.length / 3;
        index.set(point, k);
        out.push(point.x, point.y, point.z);
      }
      corners.push(k);
      edge = edge.next;
    } while (edge !== face.edge);
    for (let c = 1; c < corners.length - 1; c++) triangles.push(corners[0], corners[c], corners[c + 1]);
  }
  // (wound outward, whichever way the hull came out)
  let volume = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t] * 3, triangles[t + 1] * 3, triangles[t + 2] * 3];
    volume += out[a] * (out[b + 1] * out[c + 2] - out[b + 2] * out[c + 1]) - out[a + 1] * (out[b] * out[c + 2] - out[b + 2] * out[c]) + out[a + 2] * (out[b] * out[c + 1] - out[b + 1] * out[c]);
  }
  if (volume < 0) for (let t = 0; t < triangles.length; t += 3) [triangles[t + 1], triangles[t + 2]] = [triangles[t + 2], triangles[t + 1]];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  return geometry;
}
