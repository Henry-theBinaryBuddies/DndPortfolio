import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import { sculptBust } from "./face";
import { buildHair, buildHangingHair } from "./hairShell";
import { applyRace, defaultParams, BODIES, RACES } from "./params";
import { collectBust } from "./export";
import { edgeProblems, mergeParts, splitShells, weld } from "./printable";

let assets: Assets;
beforeAll(() => {
  const read = (path: string) => {
    const b = readFileSync(new URL(path, import.meta.url));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  const shapes = {} as Record<ShapeName, ArrayBuffer>;
  for (const name of SHAPE_NAMES) shapes[name] = read(`../public/models/horns/${name}.bin`);
  assets = parseAssets(read("../public/models/head.bin"), shapes, read("../public/models/feminine.bin"));
});

describe("integrated humanoid sculpt forms", () => {
  it("closes the hair caps whose growth regions previously pinched at an ear", () => {
    const cases = [
      ...(["cropped", "swept", "long"] as const).map(hairStyle => ({ ...applyRace(defaultParams(), "elf"), hairStyle })),
      { ...applyRace(defaultParams(), "dwarf"), body: "neutral" as const, hairStyle: "dreadlocks" as const },
      { ...applyRace(defaultParams(), "halfling"), hairStyle: "mohawk" as const },
      { ...applyRace(defaultParams(), "halfling"), hairStyle: "dreadlocks" as const },
      { ...applyRace(defaultParams(), "half-orc"), hairStyle: "mohawk" as const },
    ];
    for (const p of cases) {
      const bust = sculptBust(p, assets.head);
      const hair = buildHair(p, bust.positions, bust.normals, assets.head)!;
      const clean = weld(Float32Array.from(hair.attributes.position.array), Uint32Array.from(hair.index!.array));
      const edges = edgeProblems(clean.positions, clean.indices);
      expect(edges.open, `${p.race}/${p.body}/${p.hairStyle}`).toBe(0);
      expect(edges.shared, `${p.race}/${p.body}/${p.hairStyle}`).toBe(0);
      hair.dispose(); bust.geometry.dispose();
    }
  }, 120000);

  it("keeps the layered curtain and its two asymmetrical tresses closed across races and builds", () => {
    for (const race of RACES) for (const body of BODIES) {
      const p = { ...applyRace(defaultParams(), race), body, hairStyle: "long" as const };
      const bust = sculptBust(p, assets.head);
      const hair = buildHangingHair(p, bust.positions, assets.head)!;
      const positions = Float32Array.from(hair.attributes.position.array);
      expect(positions.every(Number.isFinite)).toBe(true);
      const clean = weld(positions, Uint32Array.from(hair.index!.array));
      const edges = edgeProblems(clean.positions, clean.indices);
      expect(edges.open, `${race}/${body}`).toBe(0);
      expect(edges.shared, `${race}/${body}`).toBe(0);
      const shells = splitShells(clean.positions, clean.indices).sort((a, b) => a.positions.length - b.positions.length);
      expect(shells, `${race}/${body}`).toHaveLength(3);
      const bottom = (v: Float32Array) => {
        let y = Infinity;
        for (let i = 1; i < v.length; i += 3) y = Math.min(y, v[i]);
        return y;
      };
      expect(Math.abs(bottom(shells[0].positions) - bottom(shells[1].positions))).toBeGreaterThan(0.1);
      hair.dispose(); bust.geometry.dispose();
    }
  }, 120000);

  for (const race of ["human", "half-orc"] as const) {
    it(`strictly exports the new long hair on a feminine ${race} as one solid`, async () => {
      const p = { ...applyRace(defaultParams(), race), body: "feminine" as const, hairStyle: "long" as const, beardStyle: "none" as const };
      const prepared = collectBust(p, assets, true);
      const { report } = await mergeParts(prepared.parts, () => {}, undefined, prepared.flatCut);
      expect(report.status).toBe("NoError");
      expect(report.components).toHaveLength(1);
      expect(report.badEdges).toBe(0);
      expect(report.parts.every(part => part.accepted)).toBe(true);
    }, 180000);
  }
});
