import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import { buildBust } from "./builder";
import { parseDragonborn, type DragonbornManifest } from "./dragonborn";
import { applyRace, defaultParams, type Params } from "./params";
import { PART_NAMES, partInfo } from "./parts";

let assets: Assets;
beforeAll(() => {
  const read = (path: string) => {
    const file = readFileSync(new URL(path, import.meta.url));
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  };
  const shapes = {} as Record<ShapeName, ArrayBuffer>;
  for (const name of SHAPE_NAMES) shapes[name] = read(`../public/models/horns/${name}.bin`);
  assets = parseAssets(read("../public/models/head.bin"), shapes, read("../public/models/feminine.bin"));
  assets.dragonborn = parseDragonborn(read("../public/models/dragonborn.bin"), JSON.parse(new TextDecoder().decode(read("../public/models/dragonborn.json"))) as DragonbornManifest);
});

describe("the parts of a bust", () => {
  it("are all known to the one table that paint, fit and print read", () => {
    const busts: Params[] = [
      // (between them, every part a humanoid can have: horns, tusks, open mouth with teeth, every kind of hair, a beard, brows, the gusset)
      { ...applyRace(defaultParams(), "half-orc"), hornStyle: "ram", jawOpen: 0.6, hairStyle: "long", beardStyle: "full" },
      { ...applyRace(defaultParams(), "dwarf"), hairStyle: "dreadlocks" },
      { ...defaultParams(), family: "dragonborn" },
    ];
    const seen = new Set<string>();
    for (const p of busts) buildBust(p, assets, false, true).traverse((o) => o instanceof THREE.Mesh && seen.add(o.name));
    for (const name of seen) expect(PART_NAMES, name).toContain(name);
    expect([...seen].sort()).toEqual(expect.arrayContaining(["head", "eye", "horn", "tusk", "teeth", "hair", "curtain", "beard", "locks", "brows", "mouthFill", "gusset", "scales", "dragonEye"]));
  }, 120000);

  it("say what each is: its paint, its name in the fit's notes, its role, and the eyes printed larger", () => {
    expect(partInfo("scales")).toMatchObject({ material: "scales", role: "body" });
    expect(partInfo("curtain").label).toBe("the hair");
    expect(partInfo("eye").printGrowth).toBe(1.07);
    expect(partInfo("dragonEye").printGrowth).toBeUndefined();
    expect(partInfo("something new")).toMatchObject({ material: "clay", label: "the bust" });
  });
});
