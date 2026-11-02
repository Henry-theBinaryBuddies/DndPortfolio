import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import { applyRace, defaultParams } from "./params";
import { MM } from "./print";
import { copyParts, describePrint, preparePrint, previewGroup, printKey, printSize } from "./printPreview";

let assets: Assets;
beforeAll(() => {
  const read = (path: string) => {
    const file = readFileSync(new URL(path, import.meta.url));
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  };
  const shapes = {} as Record<ShapeName, ArrayBuffer>;
  for (const name of SHAPE_NAMES) shapes[name] = read(`../public/models/horns/${name}.bin`);
  assets = parseAssets(read("../public/models/head.bin"), shapes, read("../public/models/feminine.bin"));
});

describe("the print preview", () => {
  it("shows the parts the export merges, cut where the merge cuts them, over the one inch square, and says how big they are", () => {
    // (dreadlocks: some locks slide down the back past the flat cut, which the merge trims away)
    const p = { ...applyRace(defaultParams(), "dwarf"), hairStyle: "dreadlocks" as const };
    const prepared = preparePrint(p, assets, true, true);
    const group = previewGroup(prepared);
    const toScene = MM / prepared.scale;
    // every part is there, with the gusset, and the square
    const names = group.children.map((child) => child.name);
    for (const part of prepared.parts) expect(names).toContain(part.name);
    expect(names).toContain("gusset");
    const square = group.getObjectByName("one inch square") as THREE.LineLoop;
    const corners = new THREE.Box3().setFromObject(square);
    expect((corners.max.x - corners.min.x) / toScene).toBeCloseTo(25.4, 3);
    // ...at the table: the underside of the base
    const base = group.getObjectByName("base") as THREE.Mesh;
    base.geometry.computeBoundingBox();
    expect(corners.min.y).toBeCloseTo(base.geometry.boundingBox!.min.y + 0.002, 6);
    // the bust is drawn cut at the flat cut, as it prints
    const head = group.getObjectByName("head") as THREE.Mesh;
    const [plane] = (head.material as THREE.MeshStandardMaterial).clippingPlanes!;
    expect(-plane.constant / toScene).toBeCloseTo(prepared.flatCut, 6);
    // the size it reports: the bust above its cut, on its base, inside the square
    const size = printSize(prepared.parts, prepared.flatCut);
    expect(size.width).toBeLessThanOrEqual(25.4);
    expect(size.depth).toBeLessThanOrEqual(25.4);
    expect(size.overall).toBeCloseTo(prepared.tabletop!.height + prepared.flatCut + 5, 1);
    expect(describePrint(prepared)).toMatch(new RegExp(`${prepared.tabletop!.height.toFixed(1)} mm bust`));
  }, 300000);

  it("is identified by everything that changes the print, and hands the export copies it can keep", () => {
    const p = defaultParams();
    expect(printKey(p, true, true)).not.toBe(printKey(p, false, true));
    expect(printKey(p, true, true)).not.toBe(printKey(p, true, false));
    expect(printKey(p, true, true)).not.toBe(printKey({ ...p, age: p.age + 0.01 }, true, true));
    const parts = [{ name: "a", positions: Float32Array.from([1, 2, 3]), indices: Uint32Array.from([0, 0, 0]) }];
    const copies = copyParts(parts);
    copies[0].positions[0] = 9;
    expect(parts[0].positions[0]).toBe(1);
    expect(copies[0].positions.buffer).not.toBe(parts[0].positions.buffer);
  });
});
