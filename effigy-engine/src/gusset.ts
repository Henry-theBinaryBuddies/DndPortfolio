import * as THREE from "three";
import { hullGeometry } from "./hull";

// A throat gusset, an option for the export. The chin sticks out about 9 mm past the neck, and its underside is a
// nearly flat ceiling over open air: printed, it needs supports under the chin, which leave a scar. The gusset
// is a wedge under it that slopes back to the neck at 45 degrees (the steepest overhang that prints clean), so
// nothing under the chin is left to support. It changes the shape: a heavier throat, as if the bust wore a
// high collar or a short beard, which is why it is a choice and not always on.
//
// For each vertex of the chin's underside, the wedge reaches back to where the neck is, and down by as far as
// it reaches back; the hull of those points and the underside is the wedge.

const BAND = { x: 0.2, yLow: -0.66, yHigh: -0.5, zBack: -0.5, zFront: 0.25 }; // head units: the chin's underside, in the middle
const FACING_DOWN = -0.6; // the y of the normal below which a vertex belongs to the underside
const SINK = 0.04; // how far the wedge's back goes into the neck, so it joins it
const MAX_REACH = 0.6; // no wedge reaches back farther than this (head units): then it is not the neck behind

export function buildThroatGusset(geometry: THREE.BufferGeometry, positions: ArrayLike<number>, normals: ArrayLike<number>): THREE.BufferGeometry | null {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  const caster = new THREE.Raycaster();
  caster.firstHitOnly = true;
  const back = new THREE.Vector3(0, 0, -1);
  // How far back from (x, y, z) the head's surface is, going straight back along the face; null if it is not there
  const reachBack = (x: number, y: number, z: number): number | null => {
    caster.set(new THREE.Vector3(x, y, z), back);
    caster.far = MAX_REACH;
    const hit = caster.intersectObject(mesh, false)[0];
    return hit ? hit.distance : null;
  };
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const [x, y, z] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    if (Math.abs(x) > BAND.x || y < BAND.yLow || y > BAND.yHigh || z < BAND.zBack || z > BAND.zFront) continue;
    if (normals[i * 3 + 1] > FACING_DOWN) continue;
    // The neck is behind the chin: where it is at the height of the underside, then lower down where the wedge ends
    // (the wedge falls as far as it reaches back, so it is at 45 degrees; the neck is not quite straight, so twice)
    let reach = reachBack(x, y - 0.01, z);
    for (let round = 0; round < 3 && reach !== null; round++) reach = reachBack(x, y - reach, z);
    if (reach === null) continue;
    points.push(new THREE.Vector3(x, y + 0.03, z), new THREE.Vector3(x, y, z), new THREE.Vector3(x, y - reach, z - reach - SINK));
  }
  mesh.material.dispose();
  if (points.length < 30) return null;
  return hullGeometry(points);
}
