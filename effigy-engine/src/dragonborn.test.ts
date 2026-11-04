import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import { buildBust } from "./builder";
import { readCharacter, characterFile } from "./character";
import { parseDragonborn, type DragonbornManifest } from "./dragonborn";
import { collectBust } from "./export";
import { collectTabletop } from "./fit";
import { defaultPaint, paintKind } from "./paint";
import { applyRace, characterName, defaultParams, type Params } from "./params";
import { mergeParts } from "./printable";
import { TABLETOP } from "./print";

let assets: Assets;
let manifest: DragonbornManifest;
let model: ArrayBuffer;
const read = (path: string) => {
  const file = readFileSync(new URL(path, import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
};
beforeAll(() => {
  const shapes = {} as Record<ShapeName, ArrayBuffer>;
  for (const name of SHAPE_NAMES) shapes[name] = read(`../public/models/horns/${name}.bin`);
  assets = parseAssets(read("../public/models/head.bin"), shapes, read("../public/models/feminine.bin"));
  manifest = JSON.parse(new TextDecoder().decode(read("../public/models/dragonborn.json"))) as DragonbornManifest;
  model = read("../public/models/dragonborn.bin");
  assets.dragonborn = parseDragonborn(model, manifest);
});

const dragonborn = (): Params => ({ ...applyRace(defaultParams(), "half-orc"), family: "dragonborn" });

describe("the Dragonborn family", () => {
  it("is a model of its own, with its scales, horns and both eyes as parts, standing on the plinth like any bust", () => {
    const bust = buildBust(dragonborn(), assets);
    const names = new Map<string, number>();
    bust.traverse((o) => {
      if (o instanceof THREE.Mesh) names.set(o.name, (names.get(o.name) ?? 0) + 1);
    });
    expect([...names]).toEqual([
      ["head", 1],
      ["horn", 1],
      ["dragonEye", 2],
    ]);
    // the lowest point is the top of the base, and the base and framing measurements are there
    bust.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(bust);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(bust.userData.reach).toHaveLength(assets.dragonborn!.underside.reach.length);
    expect(bust.userData.faceBottom).toBeGreaterThan(0.5);
    expect(bust.userData.faceBottom).toBeLessThan(box.max.y);
    // every triangle of the model is in exactly one part
    let triangles = 0;
    bust.traverse((o) => {
      if (o instanceof THREE.Mesh) triangles += o.geometry.index!.count / 3;
    });
    expect(triangles).toBe(manifest.triangles);
  });

  it("refuses a model that does not match its description, or that is from a newer version", () => {
    expect(() => parseDragonborn(model, { ...manifest, version: 2 })).toThrow(/version/);
    expect(() => parseDragonborn(model, { ...manifest, triangles: manifest.triangles - 1 })).toThrow(/does not match/);
    expect(() => parseDragonborn(model.slice(0, model.byteLength - 1), manifest)).toThrow(/wrong length/);
  });

  it("says plainly when it has not loaded, rather than building something else", () => {
    expect(() => buildBust(dragonborn(), { ...assets, dragonborn: undefined })).toThrow(/Dragonborn model has not loaded/);
  });

  it("keeps the humanoid's settings while it is a Dragonborn, so switching back restores them", () => {
    const humanoid = { ...applyRace(defaultParams(), "dwarf"), hairStyle: "dreadlocks" as const, brow: 0.7 };
    const back = { ...{ ...humanoid, family: "dragonborn" as const }, family: "humanoid" as const };
    expect(back).toEqual(humanoid);
    // and a character file keeps the family; an older file, without one, is a humanoid
    const saved = readCharacter(characterFile({ params: { ...humanoid, family: "dragonborn" }, paint: defaultPaint("dragonborn") }));
    expect(saved.params.family).toBe("dragonborn");
    expect(saved.params.brow).toBe(0.7);
    const old = JSON.parse(characterFile({ params: humanoid, paint: defaultPaint("dwarf") }));
    delete old.params.family;
    expect(readCharacter(JSON.stringify(old)).params.family).toBe("humanoid");
    expect(() => readCharacter(JSON.stringify({ ...old, params: { ...old.params, family: "kobold" } }))).toThrow(/unknown family/);
    expect(characterName(dragonborn())).toBe("dragonborn");
    expect(paintKind(dragonborn())).toBe("dragonborn");
  });

  it("prints as one closed solid with its base", async () => {
    const { parts, flatCut } = collectBust(dragonborn(), assets);
    const { report } = await mergeParts(parts, undefined, undefined, flatCut);
    expect(report.parts.every((part) => part.accepted)).toBe(true);
    expect(report.components).toHaveLength(1);
    expect(report.badEdges).toBe(0);
  }, 300000);

  it("fits the one inch square at tabletop size, horns included, without slimming a torso it does not have", () => {
    const t = collectTabletop(dragonborn(), assets, false);
    let reach = 0;
    for (const part of t.parts) {
      if (part.name === "base") continue;
      for (let i = 0; i < part.positions.length; i += 3) reach = Math.max(reach, Math.abs(part.positions[i]), Math.abs(part.positions[i + 1]));
    }
    expect(reach).toBeLessThanOrEqual(25.4 / 2);
    expect(t.params.torso).toBe(dragonborn().torso);
    expect(t.notes.join(" ")).not.toMatch(/slimmed/);
    console.log(`dragonborn at tabletop size: scale ${t.scale.toFixed(3)}, bust ${t.height.toFixed(1)} mm, ${t.width.toFixed(1)} x ${t.depth.toFixed(1)} mm; ${t.notes.join(" ")}`);
    expect(t.height).toBeLessThanOrEqual(TABLETOP.aim + 1e-6);
  }, 300000);
});
