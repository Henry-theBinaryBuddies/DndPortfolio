import * as THREE from "three";
import { buildBust, disposeObject, pedestalGeometry } from "./builder";
import type { Assets } from "./assets";
import type { Params } from "./params";
import type { Part } from "./printable";
import { MM, PRINT, shiftReach, TABLETOP } from "./print";

// The parts of a bust as the printer will have them, ready to be merged (see printable.ts): each mesh with
// its place in the bust baked into its vertices (the horns and tusks are mirrored by a negative scale, which
// turns a mesh inside out, so their triangles are re-wound), in millimetres, with Z up as slicers expect
// (the bust's y is up and its face looks along +z; printed, the face looks toward -y). The base comes with it.

const MILLIMETRES = 1 / MM;
const EYE_GROWTH = 1.07; // printed eyeballs are this much larger than the sculpt's, so they join the head

export function collectParts(p: Params, assets: Assets): Part[] {
  return collectBust(p, assets).parts;
}

// The parts, and how high above the bust's lowest point it is cut flat (mm). With a `scale`, they are the
// tabletop print (see fit.ts): the whole sculpt scaled by it, on the small low base. `centred` (on at tabletop
// size): the bust stands over the base by the middle of its whole outline, seen from above (muzzle to horns,
// shoulder to shoulder, hair included), not by the middle of its underside. The square it must fit in is centred on
// the base, so a head that reaches far forward (a Dragonborn's muzzle) or back (long hair) no longer reaches past
// one side of it while the other has room to spare. The pedestal still meets the underside, from where it now is;
// the shift is held to three quarters of the underside's reach that way (CENTRING_LIMIT), so the pedestal stays under the chest.
// (`warnings`: what the build found it could not do as it should, for the print preview and the export to say)
export function collectBust(p: Params, assets: Assets, gusset = false, scale?: number, detail = true, centred = scale !== undefined): { parts: Part[]; flatCut: number; warnings: string[] } {
  const k = scale ?? 1;
  const bust = buildBust(p, assets, detail, gusset);
  bust.updateMatrixWorld(true);
  let reach: ArrayLike<number> = bust.userData.reach;
  if (centred) {
    const shift = centring(bust, reach);
    bust.position.x += shift.x;
    bust.position.z += shift.z;
    bust.updateMatrixWorld(true);
    // (the base's middle is now where the bust was moved from, seen from the underside)
    reach = shiftReach(reach, -shift.x, -shift.z);
  }
  const parts: Part[] = [];
  const v = new THREE.Vector3();
  const add = (name: string, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) => {
    const position = geometry.attributes.position;
    const positions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(matrix);
      // y up, face toward +z  ->  Z up, face toward -y: a turn of a quarter about x, which keeps handedness
      positions[i * 3] = v.x * MILLIMETRES * k;
      positions[i * 3 + 1] = -v.z * MILLIMETRES * k;
      positions[i * 3 + 2] = v.y * MILLIMETRES * k;
    }
    const indices = Uint32Array.from(geometry.index!.array);
    if (matrix.determinant() < 0) for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
    parts.push({ name, positions, indices });
  };
  // (open pieces of one closed solid, painted apart: a Dragonborn's scales, horns and eyes; printed, they are one part
  // again, whose welded seams close it: see dragonborn.ts)
  const joined: Part[] = [];
  bust.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const matrix = object.matrixWorld;
    if (object.userData.joined) {
      const before = parts.length;
      add("head", object.geometry, matrix);
      joined.push(...parts.splice(before));
      return;
    }
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
  if (joined.length) {
    const positions = new Float32Array(joined.reduce((n, p) => n + p.positions.length, 0));
    const indices = new Uint32Array(joined.reduce((n, p) => n + p.indices.length, 0));
    let [at, offset] = [0, 0];
    for (const piece of joined) {
      positions.set(piece.positions, at * 3);
      for (let i = 0; i < piece.indices.length; i++) indices[offset + i] = piece.indices[i] + at;
      at += piece.positions.length / 3;
      offset += piece.indices.length;
    }
    parts.unshift({ name: "head", positions, indices });
  }
  // The base reaches a little way up inside the bust, so the two are joined and not merely touching
  // (at tabletop size it is a fixed width and low, in the sculpt's own millimetres: the scale brings it to print
  // size, and its moldings are sized in printed millimetres, so they do not shrink with it)
  const baseHeight = scale === undefined ? PRINT.baseHeight : TABLETOP.plinth / k;
  const tabletop = scale !== undefined;
  const prism = pedestalGeometry(reach, -baseHeight * MM, (bust.userData.flatCut + PRINT.baseOverlap) * MM, tabletop ? (TABLETOP.base / 2 / k) * MM : undefined, tabletop ? MM / k : undefined);
  add("base", prism, new THREE.Matrix4());
  prism.dispose();
  const flatCut = (bust.userData.flatCut as number) * k;
  const warnings = (bust.userData.warnings as string[] | undefined) ?? [];
  disposeObject(bust);
  return { parts, flatCut, warnings };
}

// How far to move the bust (head units, across and front to back) so the middle of its whole outline above its flat
// cut, seen from above, is over the middle of the base: held to a share of how far its underside reaches in that
// direction (`reach`, see underside.ts), so the pedestal's middle stays well inside the underside
const CENTRING_LIMIT = 0.75;
function centring(bust: THREE.Object3D, reach: ArrayLike<number>): { x: number; z: number } {
  const cut = (bust.userData.flatCut as number) * MM;
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  const v = new THREE.Vector3();
  bust.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      if (v.y < cut) continue;
      [x0, x1, z0, z1] = [Math.min(x0, v.x), Math.max(x1, v.x), Math.min(z0, v.z), Math.max(z1, v.z)];
    }
  });
  let [x, z] = [-(x0 + x1) / 2, -(z0 + z1) / 2];
  const length = Math.hypot(x, z);
  if (length > 0) {
    // (the underside's reach in the direction the bust moves: the pedestal's middle moves the other way under it)
    const n = reach.length;
    const angle = Math.atan2(-z, -x);
    const k = Math.round(((angle + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / n)) % n;
    const most = CENTRING_LIMIT * reach[k];
    if (length > most) [x, z] = [(x * most) / length, (z * most) / length];
  }
  return { x, z };
}
