import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import { sculptBust } from "./face";
import { collectTabletop } from "./fit";
import { applyRace, defaultParams, NUMERIC_DEFS, type Params, type Race } from "./params";
import { TABLETOP } from "./print";

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

const halfWidth = (p: Params, lo: number, hi: number) => {
  const { positions } = sculptBust(p, assets.head);
  let most = 0;
  for (let i = 0; i < positions.length; i += 3) if (positions[i + 1] >= lo && positions[i + 1] < hi) most = Math.max(most, Math.abs(positions[i]));
  return most;
};

describe("the Torso size slider", () => {
  it("is a body slider that leaves the head and the neck alone and slims the shoulders and chest", () => {
    const def = NUMERIC_DEFS.find((d) => d.key === "torso")!;
    expect(def.group).toBe("Body");
    expect(def.default).toBe(1);
    const full = defaultParams();
    const slim = { ...full, torso: 0.6 };
    expect(halfWidth(slim, -0.3, 0.6)).toBeCloseTo(halfWidth(full, -0.3, 0.6), 6);
    expect(halfWidth(slim, -1.6, -1.0)).toBeLessThan(0.7 * halfWidth(full, -1.6, -1.0));
    // (and the default is the sculpt as it always was: nothing moves at 1)
    expect(halfWidth({ ...full, torso: 1 }, -1.6, -1.0)).toBe(halfWidth(full, -1.6, -1.0));
  });

  it("never folds the neck or shoulders over themselves, however slim, on any build", () => {
    // (a fold shows as a triangle turned the other way from the same triangle at full size)
    const index = assets.head.indices;
    const folded = (p: Params) => {
      const a = sculptBust(p, assets.head).positions;
      const b = sculptBust({ ...p, torso: 1 }, assets.head).positions;
      const normal = (v: Float32Array, t: number) => {
        const [i, j, k] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
        const [ux, uy, uz] = [v[j] - v[i], v[j + 1] - v[i + 1], v[j + 2] - v[i + 2]];
        const [wx, wy, wz] = [v[k] - v[i], v[k + 1] - v[i + 1], v[k + 2] - v[i + 2]];
        return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
      };
      let count = 0;
      for (let t = 0; t < index.length; t += 3) {
        const [n, m] = [normal(a, t), normal(b, t)];
        if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) count++;
      }
      return count;
    };
    for (const race of ["human", "half-orc", "dwarf"] as const) {
      for (const body of ["masculine", "feminine"] as const) {
        for (const torso of [0.9, 0.7, 0.6]) expect(folded({ ...applyRace({ ...defaultParams(), body }, race), torso }), `${race} ${body} ${torso}`).toBe(0);
      }
    }
  }, 300000);
});

describe("tabletop size", () => {
  const cases: [string, Race, Partial<Params>][] = [
    ["a dwarf with dreadlocks and a beard", "dwarf", { hairStyle: "dreadlocks", jawOpen: 0.3 }],
    ["a half-orc with a mohawk and tusks", "half-orc", { hairStyle: "mohawk" }],
  ];
  for (const [label, race, overrides] of cases) {
    it(`fits ${label} inside the one inch square on a base no wider than asked, as the parts will print`, () => {
      const p = { ...applyRace(defaultParams(), race), ...overrides };
      const started = Date.now();
      const t = collectTabletop(p, assets, true);
      const seconds = (Date.now() - started) / 1000;
      const half = TABLETOP.base / 2;
      let reach = 0;
      let top = -Infinity;
      for (const part of t.parts) {
        const v = part.positions;
        for (let i = 0; i < v.length; i += 3) {
          const r = Math.max(Math.abs(v[i]), Math.abs(v[i + 1]));
          if (part.name === "base") expect(Math.hypot(v[i], v[i + 1])).toBeLessThanOrEqual(half + 1e-3);
          else reach = Math.max(reach, r);
          if (part.name !== "base") top = Math.max(top, v[i + 2]);
        }
      }
      // the whole bust, hair and beard and horns included, is inside the square (25.4 mm), the base inside its circle
      expect(reach).toBeLessThanOrEqual(25.4 / 2);
      expect(t.scale).toBeGreaterThan(0.2);
      expect(t.scale).toBeLessThan(1);
      expect(t.params.torso).toBeLessThanOrEqual(p.torso);
      // the height reported is the height of the parts above the flat cut
      expect(t.height).toBeCloseTo(top - t.flatCut, 6);
      // and when it falls short of the height wanted, it says so
      if (t.height < TABLETOP.bustHeight[0]) expect(t.notes.join(" ")).toMatch(/tall, under/);
      console.log(`${label}: ${seconds.toFixed(1)} s, scale ${t.scale.toFixed(3)}, torso ${t.params.torso.toFixed(2)}, bust ${t.height.toFixed(1)} mm, ${t.width.toFixed(1)} x ${t.depth.toFixed(1)} mm`);
    }, 600000);
  }
});
