import * as THREE from "three";
import { deformHead, type Deformed } from "./deform";
import type { HeadBase } from "./headMesh";
import type { Params } from "./params";
import { findUnderside, type Underside } from "./underside";

// Turns the deformed base head into the bust's mesh. (It was painted here too, with shading, grime, brows,
// lips and a tunic; that paint is in git history for when colour comes back.)

export interface Bust {
  geometry: THREE.BufferGeometry;
  eyes: Deformed["eyes"];
  positions: Float32Array; // the deformed vertices, for fitting hair and attachments
  normals: Float32Array;
  footprint: { x: number; z: number }; // the centre of the underside at the flat cut, so the bust can sit centred on its plinth
  baseY: number;
  underside: Underside; // where it is cut flat, and the outline of the cut
}

export function sculptBust(p: Params, base: HeadBase): Bust {
  const deformed = deformHead(base, p);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(deformed.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(base.indices, 1));
  geometry.computeVertexNormals();
  const normals = (geometry.attributes.normal as THREE.BufferAttribute).array as Float32Array;
  const positions = deformed.positions;

  // The bust's underside: where it stands on the plinth, and the middle of that footprint (the middle of its
  // extent, not the average of its vertices, which leans toward wherever the mesh is dense)
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  let baseY = Infinity;
  for (const i of base.bottom) {
    x0 = Math.min(x0, positions[i * 3]);
    x1 = Math.max(x1, positions[i * 3]);
    z0 = Math.min(z0, positions[i * 3 + 2]);
    z1 = Math.max(z1, positions[i * 3 + 2]);
    baseY = Math.min(baseY, positions[i * 3 + 1]);
  }
  const underside = findUnderside(positions, base.indices, baseY, { x: (x0 + x1) / 2, z: (z0 + z1) / 2 });
  return { geometry, eyes: deformed.eyes, positions, normals, footprint: underside.footprint, baseY, underside };
}

export interface SurfaceHit {
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

const caster = new THREE.Raycaster();

// Finds where the surface is along a ray, for seating tusks, stitches, horns and armour on the skin.
export function castRay(mesh: THREE.Mesh, origin: THREE.Vector3, direction: THREE.Vector3): SurfaceHit | null {
  caster.set(origin, direction.clone().normalize());
  const hit = caster.intersectObject(mesh, false)[0];
  if (!hit || !hit.face) return null;
  return { position: hit.point.clone(), normal: hit.face.normal.clone() };
}

// Looking at the face from the front: the skin surface under the point (x, y)
export function frontPoint(mesh: THREE.Mesh, x: number, y: number): SurfaceHit | null {
  return castRay(mesh, new THREE.Vector3(x, y, 4), new THREE.Vector3(0, 0, -1));
}

// Looking down from above: the skin surface under the point (x, z), for the top of the skull and shoulders
export function topPoint(mesh: THREE.Mesh, x: number, z: number): SurfaceHit | null {
  return castRay(mesh, new THREE.Vector3(x, 4, z), new THREE.Vector3(0, -1, 0));
}
