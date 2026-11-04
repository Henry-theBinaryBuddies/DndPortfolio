import * as THREE from "three";
import type { Vec3 } from "./headMesh";
import { MM } from "./print";
import { findUnderside, type Underside } from "./underside";

// The Dragonborn: not a race of the humanoid head (which cannot be pushed that far) but a family of its own, with its
// own sculpt: a fixed, closed-mouthed bust made by tools/sculpt_dragonborn.py (see assets/dragonborn/README.md),
// loaded only when it is first chosen. It has no shape controls yet; the humanoid's sliders, hair, beard and horns do
// not apply to it.
//
// The model is in the same head units, origin and axes as the human head (see headMesh.ts), so the camera, the
// pedestal, the tabletop fit, the print and the token all treat it as they treat any bust. Its file says which
// triangles are horn (and spine and crest) and which are eye, so the paint can colour them, and how far each vertex
// lies in a hollow (the grooves between the scales), which the skin's paint darkens.

export const DRAGONBORN_VERSION = 1;

export interface DragonbornManifest {
  name: string;
  version: number;
  vertices: number;
  triangles: number;
  eyes: { centre: Vec3; look: Vec3; radius: number }[];
  chin: number; // the lowest point of the lower jaw, for framing the face
}

export interface DragonbornAsset {
  manifest: DragonbornManifest;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  baseY: number; // its flat underside
  underside: Underside;
  // The parts, each the triangles of one region: the scales as the head (with its paint per vertex), the horns, spines
  // and crest as horn (with how far along each one a vertex is), and each eye, in a frame of its own facing +z (as the
  // eye's paint expects: see paint.ts)
  skin: { index: Uint32Array; paintA: Float32Array; paintB: Float32Array };
  horn: { index: Uint32Array; along: Float32Array };
  eyes: { centre: THREE.Vector3; look: THREE.Vector3; positions: Float32Array; index: Uint32Array }[];
}

const REGION = { scales: 0, horn: 1, eye: 2 } as const;
const FORWARD = new THREE.Vector3(0, 0, 1);

export function parseDragonborn(buffer: ArrayBuffer, manifest: DragonbornManifest): DragonbornAsset {
  if (manifest.version !== DRAGONBORN_VERSION) throw new Error(`the Dragonborn model is version ${manifest.version}, not the ${DRAGONBORN_VERSION} this app reads`);
  const [vertices, triangles] = new Uint32Array(buffer, 0, 2);
  if (vertices !== manifest.vertices || triangles !== manifest.triangles) throw new Error("the Dragonborn model does not match its description");
  if (buffer.byteLength !== 8 + vertices * 20 + triangles * 13) throw new Error("the Dragonborn model file is the wrong length");
  let at = 8;
  const take = (bytes: number) => buffer.slice(at, (at += bytes));
  const positions = new Float32Array(take(vertices * 12));
  const shade = new Float32Array(take(vertices * 4));
  const along = new Float32Array(take(vertices * 4));
  const indices = new Uint32Array(take(triangles * 12));
  const region = new Uint8Array(take(triangles));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal.array as Float32Array;

  // The underside: the bust is cut flat at its base, and stands centred on the middle of that cut
  let baseY = Infinity;
  for (let i = 1; i < positions.length; i += 3) baseY = Math.min(baseY, positions[i]);
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 1] > baseY + 0.01) continue;
    [x0, x1, z0, z1] = [Math.min(x0, positions[i]), Math.max(x1, positions[i]), Math.min(z0, positions[i + 2]), Math.max(z1, positions[i + 2])];
  }
  const underside = findUnderside(positions, indices, baseY, { x: (x0 + x1) / 2, z: (z0 + z1) / 2 });

  const skin: number[] = [];
  const horn: number[] = [];
  const eyeTriangles: number[][] = manifest.eyes.map(() => []);
  for (let t = 0; t < triangles; t++) {
    const corners = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
    if (region[t] === REGION.horn) horn.push(...corners);
    else if (region[t] === REGION.eye) {
      // (the eye whose centre is nearer)
      const x = positions[corners[0] * 3];
      const nearest = manifest.eyes.reduce((best, eye, e) => (Math.abs(eye.centre[0] - x) < Math.abs(manifest.eyes[best].centre[0] - x) ? e : best), 0);
      eyeTriangles[nearest].push(...corners);
    } else skin.push(...corners);
  }
  // The skin's paint per vertex (see paint.ts): only the shade of the hollows; the human face's other measures (lips,
  // flush, stubble) are zero
  const paintA = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i++) paintA[i * 4] = shade[i];
  const paintB = new Float32Array(vertices * 4);

  const eyes = manifest.eyes.map((eye, e) => {
    const centre = new THREE.Vector3(...eye.centre);
    const look = new THREE.Vector3(...eye.look).normalize();
    // (each eye's own vertices, turned so it faces +z about its centre)
    const toLocal = new THREE.Quaternion().setFromUnitVectors(look, FORWARD);
    const remap = new Map<number, number>();
    const local: number[] = [];
    const index = eyeTriangles[e].map((v) => {
      let i = remap.get(v);
      if (i === undefined) {
        i = remap.size;
        remap.set(v, i);
        const p = new THREE.Vector3().fromArray(positions, v * 3).sub(centre).applyQuaternion(toLocal);
        local.push(p.x, p.y, p.z);
      }
      return i;
    });
    return { centre, look, positions: Float32Array.from(local), index: Uint32Array.from(index) };
  });
  return { manifest, positions, normals, indices, baseY, underside, skin: { index: Uint32Array.from(skin), paintA, paintB }, horn: { index: Uint32Array.from(horn), along }, eyes };
}

export async function loadDragonborn(): Promise<DragonbornAsset> {
  const [manifest, buffer] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}models/dragonborn.json`).then((response) => {
      if (!response.ok) throw new Error(`could not load the Dragonborn model's description (${response.status})`);
      return response.json() as Promise<DragonbornManifest>;
    }),
    fetch(`${import.meta.env.BASE_URL}models/dragonborn.bin`).then((response) => {
      if (!response.ok) throw new Error(`could not load the Dragonborn model (${response.status})`);
      return response.arrayBuffer();
    }),
  ]);
  return parseDragonborn(buffer, manifest);
}

// The bust, as buildBust makes one (see builder.ts): its parts in a group standing on the plinth's centre, with the
// same measurements for the base, the cut and the framing. Its parts are open pieces of one closed solid (marked
// `joined`), which the print puts back together as one part (see export.ts).
export function buildDragonborn(asset: DragonbornAsset, gusset = false): THREE.Group {
  const root = new THREE.Group();
  const head = new THREE.Group();
  root.add(head);
  const cut = asset.underside.cut;
  const clay = new THREE.MeshStandardMaterial({ color: 0x9c9a96, roughness: 0.75, clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), -cut * MM)] });
  const position = new THREE.BufferAttribute(asset.positions, 3);
  const normal = new THREE.BufferAttribute(asset.normals, 3);
  const part = (name: string, index: Uint32Array, attributes: Record<string, THREE.BufferAttribute>) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", position);
    geometry.setAttribute("normal", normal);
    for (const [key, attribute] of Object.entries(attributes)) geometry.setAttribute(key, attribute);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = new THREE.Mesh(geometry, clay);
    mesh.name = name;
    mesh.userData.joined = true;
    head.add(mesh);
  };
  part("head", asset.skin.index, { paintA: new THREE.BufferAttribute(asset.skin.paintA, 4), paintB: new THREE.BufferAttribute(asset.skin.paintB, 4) });
  part("horn", asset.horn.index, { along: new THREE.BufferAttribute(asset.horn.along, 1) });
  for (const eye of asset.eyes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(eye.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(eye.index, 1));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, clay);
    // (not "eye": a humanoid's eyeball is a ball of its own, printed a little larger to join the head, where this one
    // is part of the head's surface already: see export.ts)
    mesh.name = "dragonEye";
    mesh.userData.joined = true;
    mesh.position.copy(eye.centre);
    mesh.quaternion.setFromUnitVectors(FORWARD, eye.look);
    head.add(mesh);
  }
  // Stand the bust on the plinth, with the middle of its underside over the middle of the base
  head.position.set(-asset.underside.footprint.x, -asset.baseY, -asset.underside.footprint.z);
  root.userData.reach = asset.underside.reach;
  root.userData.flatCut = cut;
  root.userData.faceBottom = asset.manifest.chin - asset.baseY;
  if (gusset) root.userData.warnings = ["The Dragonborn has no throat gusset yet: its chin and muzzle will need the slicer's supports."];
  return root;
}
