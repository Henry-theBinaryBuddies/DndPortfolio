import * as THREE from "three";
import type { Assets } from "./assets";
import { printBounds } from "./bounds";
import { collectBust } from "./export";
import { collectTabletop, type Tabletop } from "./fit";
import type { Params } from "./params";
import { MM, SQUARE, TABLETOP } from "./print";
import type { Part } from "./printable";

// The print, before it is saved: the parts exactly as the export will merge them (at tabletop size the slimmed
// torso, the small base and the scale; the throat gusset; the eyes grown 7% so they join the head), and the same
// parts are what the export then merges, so the file is what was shown. The sculpt the sliders edit stays as it
// was: the preview is a separate view of it.

export interface Prepared {
  key: string; // the settings it was made from (see printKey)
  parts: Part[];
  flatCut: number; // mm
  tabletop: Tabletop | null; // how it was fitted, at tabletop size
  scale: number; // the print's size as a fraction of the sculpt's
  warnings: string[]; // at full size, what the build could not do as it should (at tabletop size they are among its notes)
}

export const printKey = (p: Params, gusset: boolean, tabletop: boolean) => JSON.stringify([p, gusset, tabletop]);

export function preparePrint(p: Params, assets: Assets, gusset: boolean, tabletop: boolean): Prepared {
  const key = printKey(p, gusset, tabletop);
  if (tabletop) {
    const fitted = collectTabletop(p, assets, gusset);
    return { key, parts: fitted.parts, flatCut: fitted.flatCut, tabletop: fitted, scale: fitted.scale, warnings: [] };
  }
  const { parts, flatCut, warnings } = collectBust(p, assets, gusset);
  return { key, parts, flatCut, tabletop: null, scale: 1, warnings };
}

// Copies of the parts, to hand to the export's worker (handing them over empties the originals)
export const copyParts = (parts: Part[]): Part[] => parts.map((part) => ({ name: part.name, positions: part.positions.slice(), indices: part.indices.slice() }));

// How far the print reaches across, front to back and overall (mm): the bust above its flat cut (below it is trimmed
// away in the merge), and the base; and how tall the bust and the base are, where they meet at the cut
export function printSize(parts: Part[], flatCut: number): { width: number; depth: number; overall: number; bust: number; base: number } {
  const { min, max } = printBounds(parts, flatCut);
  return { width: max[0] - min[0], depth: max[1] - min[1], overall: max[2] - min[2], bust: max[2] - flatCut, base: flatCut - min[2] };
}

// The parts as a scene group, at the sculpt's own size (so the view frames it as it framed the sculpt), turned
// back from the slicer's Z up to the scene's y up. At tabletop size, the board's one inch square lies under it.
export function previewGroup(prepared: Prepared): THREE.Group {
  const group = new THREE.Group();
  group.name = "print preview";
  const toScene = MM / prepared.scale;
  // (the bust is drawn cut at its flat cut, as the merge trims it: see builder.ts for the sculpt's own)
  const clay = new THREE.MeshStandardMaterial({ color: 0x9c9a96, roughness: 0.75, clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), -prepared.flatCut * toScene)] });
  const plinth = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.95, flatShading: true });
  let bottom = Infinity;
  for (const part of prepared.parts) {
    const v = part.positions;
    const positions = new Float32Array(v.length);
    for (let i = 0; i < v.length; i += 3) {
      // (Z up, face toward -y  ->  y up, face toward +z: the export's turn, undone)
      positions[i] = v[i] * toScene;
      positions[i + 1] = v[i + 2] * toScene;
      positions[i + 2] = -v[i + 1] * toScene;
      if (part.name === "base") bottom = Math.min(bottom, v[i + 2]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(part.indices.slice(), 1));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, part.name === "base" ? plinth : clay);
    mesh.name = part.name;
    group.add(mesh);
  }
  if (prepared.tabletop) {
    // (a hair above the table, so it is not lost in the base's underside)
    const half = (SQUARE / 2) * toScene;
    const y = bottom * toScene + 0.002;
    const corners = [new THREE.Vector3(-half, y, -half), new THREE.Vector3(half, y, -half), new THREE.Vector3(half, y, half), new THREE.Vector3(-half, y, half)];
    const square = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color: 0xb8431f }));
    square.name = "one inch square";
    group.add(square);
  }
  return group;
}

export function disposePreview(group: THREE.Group) {
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineLoop) {
      object.geometry.dispose();
      materials.add(object.material as THREE.Material);
    }
  });
  for (const material of materials) material.dispose();
}

// What the preview shows, in words
export function describePrint(prepared: Prepared): string {
  const { width, depth, overall, bust, base } = printSize(prepared.parts, prepared.flatCut);
  const lines: string[] = [];
  if (prepared.tabletop) {
    const t = prepared.tabletop;
    lines.push(`Print preview, tabletop size: the sculpt at ${Math.round(t.scale * 100)}%, a ${t.height.toFixed(1)} mm bust (${TABLETOP.bustHeight[0]}-${TABLETOP.bustHeight[1]} mm wanted), ${overall.toFixed(1)} mm tall overall, ${width.toFixed(1)} x ${depth.toFixed(1)} mm across: inside the one inch (25.4 mm) square drawn under it, on a ${TABLETOP.base} mm base.`);
    if (t.notes.length) lines.push(t.notes.join(" "));
  } else {
    lines.push(`Print preview, full size: a ${bust.toFixed(0)} mm bust on a ${base.toFixed(0)} mm base, ${overall.toFixed(0)} mm tall overall, ${width.toFixed(0)} x ${depth.toFixed(0)} mm across.`);
    if (prepared.warnings.length) lines.push(prepared.warnings.join(" "));
  }
  lines.push("These are the parts as the export merges them, with the throat gusset if it is ticked and the eyes 7% larger so they join the head. Export STL saves exactly this; any change to the sculpt goes back to it.");
  return lines.join(" ");
}
