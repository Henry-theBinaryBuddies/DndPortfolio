import * as THREE from "three";
import { basePrism, buildBust, disposeObject } from "./builder";
import type { Assets } from "./assets";
import type { Params } from "./params";
import type { Part } from "./printable";
import { MM, PRINT } from "./print";

// The parts of a bust as the printer will have them, ready to be merged (see printable.ts): each mesh with
// its place in the bust baked into its vertices (the horns and tusks are mirrored by a negative scale, which
// turns a mesh inside out, so their triangles are re-wound), in millimetres, with Z up as slicers expect
// (the bust's y is up and its face looks along +z; printed, the face looks toward -y). The base comes with it.

const MILLIMETRES = 1 / MM;
const EYE_GROWTH = 1.07; // printed eyeballs are this much larger than the sculpt's, so they join the head

export function collectParts(p: Params, assets: Assets): Part[] {
  const bust = buildBust(p, assets, true);
  bust.updateMatrixWorld(true);
  const parts: Part[] = [];
  const v = new THREE.Vector3();
  const add = (name: string, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) => {
    const position = geometry.attributes.position;
    const positions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(matrix);
      // y up, face toward +z  ->  Z up, face toward -y: a turn of a quarter about x, which keeps handedness
      positions[i * 3] = v.x * MILLIMETRES;
      positions[i * 3 + 1] = -v.z * MILLIMETRES;
      positions[i * 3 + 2] = v.y * MILLIMETRES;
    }
    const indices = Uint32Array.from(geometry.index!.array);
    if (matrix.determinant() < 0) for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
    parts.push({ name, positions, indices });
  };
  bust.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const matrix = object.matrixWorld;
    if (object.name === "eye") {
      // An eyeball sits in its socket with a hair's gap all round (so the lids never cut into it), which on a
      // print would leave it floating free inside the head. Printed a little larger it overlaps the socket and
      // is joined to the head.
      const centre = new THREE.Vector3().setFromMatrixPosition(matrix);
      const grown = new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z).multiply(new THREE.Matrix4().makeScale(EYE_GROWTH, EYE_GROWTH, EYE_GROWTH)).multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
      add("eye", object.geometry, grown.multiply(matrix));
      return;
    }
    add(object.name || "part", object.geometry, matrix);
  });
  // The base reaches a little way up inside the bust, so the two are joined and not merely touching
  const prism = basePrism(bust.userData.outline, -PRINT.baseHeight * MM, PRINT.baseOverlap * MM);
  add("base", prism, new THREE.Matrix4());
  prism.dispose();
  disposeObject(bust);
  return parts;
}
