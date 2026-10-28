import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import { basePrism, pedestalGeometry } from "./builder";
import { collectParts } from "./export";
import { applyRace, defaultParams, type Params } from "./params";
import { baseOutline, convexHull, MM, pedestalRings, PEDESTAL_SIDES, PRINT, radiusAt } from "./print";
import { mergeParts, readStl, splitShells, weld, writeStl, type Part, type PrintReport } from "./printable";

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

const params = (overrides: Partial<Params>): Params => ({ ...defaultParams(), ...overrides });

// The signed volume of a closed surface: positive when its triangles wind outward
const volumeOf = (positions: ArrayLike<number>, indices: ArrayLike<number>) => {
  let volume = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    volume += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return volume / 6;
};

const cube = () => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]),
  indices: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]),
});

describe("preparing parts", () => {
  it("welds vertices at the same place, even when rounding noise puts them either side of a cell's edge", () => {
    const tolerance = 1e-4;
    // Two copies of one vertex a few millionths of a millimetre apart, straddling the edge between two cells
    const edge = 3 * tolerance;
    const welded = weld(new Float32Array([edge - 3e-6, 1, 2, edge + 3e-6, 1, 2, 5, 5, 5, 6, 6, 6]), new Uint32Array([0, 2, 3, 1, 2, 3]));
    expect(welded.positions.length / 3).toBe(3);
    // ...but not vertices that are really apart
    expect(weld(new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2])).positions.length / 3).toBe(3);
    // Triangles that collapse to a line are dropped
    expect(weld(new Float32Array([0, 0, 0, 1e-6, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2])).collapsed).toBe(1);
  });

  it("splits a mesh into its separate closed surfaces", () => {
    const one = cube();
    expect(splitShells(one.positions, one.indices).length).toBe(1);
    const two = new Float32Array([...one.positions, ...Array.from(one.positions, (v, i) => (i % 3 === 0 ? v + 5 : v))]);
    const indices = new Uint32Array([...one.indices, ...Array.from(one.indices, (v) => v + 8)]);
    const shells = splitShells(two, indices);
    expect(shells.length).toBe(2);
    for (const shell of shells) expect(volumeOf(shell.positions, shell.indices)).toBeCloseTo(1, 5);
  });

  it("writes a binary STL that reads back the same", () => {
    const { positions, indices } = cube();
    const { stl, degenerate } = writeStl(positions, indices);
    expect(degenerate).toBe(0);
    expect(stl.byteLength).toBe(84 + 12 * 50);
    const back = readStl(stl);
    expect(back.count).toBe(12);
    expect(Array.from(back.positions.slice(0, 9))).toEqual([0, 0, 0, 1, 1, 0, 1, 0, 0]);
    // A triangle with two corners at one place has no area and is left out
    const flat = writeStl(new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2, 0, 2, 3]));
    expect(flat.degenerate).toBe(1);
    expect(readStl(flat.stl).count).toBe(1);
  });

  it("builds the base from the underside of the bust: convex, with a margin all round, a closed outward solid", () => {
    const points: [number, number][] = [[-30, -10], [30, -10], [20, 20], [-20, 20], [0, 0], [5, 5]];
    const hull = convexHull(points);
    expect(hull.length).toBe(4);
    const margin = 2.5;
    const outline = baseOutline(points, margin);
    // Every point of the underside is inside it by at least the margin
    for (const [x, y] of points) {
      let nearest = Infinity;
      for (let i = 0; i < outline.length; i++) {
        const [a, b] = [outline[i], outline[(i + 1) % outline.length]];
        const length2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
        const t = Math.min(1, Math.max(0, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / length2));
        nearest = Math.min(nearest, Math.hypot(x - a[0] - (b[0] - a[0]) * t, y - a[1] - (b[1] - a[1]) * t));
      }
      expect(nearest).toBeGreaterThan(-1e-9);
    }
    const prism = basePrism(outline, -4, 0.4);
    const uses = new Map<number, number>();
    const index = prism.index!;
    for (let t = 0; t < index.count; t += 3) {
      for (let e = 0; e < 3; e++) {
        const [i, j] = [index.getX(t + e), index.getX(t + ((e + 1) % 3))];
        uses.set(i * 65536 + j, (uses.get(i * 65536 + j) ?? 0) + 1);
      }
    }
    for (const [key] of uses) {
      const [i, j] = [Math.floor(key / 65536), key % 65536];
      expect(uses.get(j * 65536 + i), "each edge is used once each way").toBe(1);
    }
    expect(volumeOf(prism.attributes.position.array, index.array)).toBeGreaterThan(0);
  });
});

describe("collecting a bust's parts for printing", () => {
  it("bakes every part's place into it, in millimetres with Z up, each wound outward (the mirrored horns and tusks included)", () => {
    const orc = applyRace({ ...defaultParams(), hairStyle: "none" }, "half-orc");
    orc.tusks = 0.7;
    const tiefling = applyRace({ ...defaultParams(), hairStyle: "none" }, "tiefling");
    for (const p of [orc, tiefling, params({ hairStyle: "swept", beardStyle: "full" })]) {
      const parts = collectParts(p, assets);
      const names = parts.map((part) => part.name);
      expect(names).toContain("head");
      expect(names).toContain("base");
      expect(names.filter((n) => n === "eye").length).toBe(2);
      for (const part of parts) {
        expect(volumeOf(part.positions, part.indices), `${p.race} ${part.name}`).toBeGreaterThan(0);
      }
    }
    expect(collectParts(orc, assets).filter((part) => part.name === "tusk").length).toBe(2);
    expect(collectParts(tiefling, assets).filter((part) => part.name === "horn").length).toBe(2);
    // Z up: the bust stands on z = 0 and rises about 80 mm; the face looks toward -y
    const head = collectParts(params({ hairStyle: "none", beardStyle: "none" }), assets).find((part) => part.name === "head")!;
    let [minZ, maxZ, nose] = [Infinity, -Infinity, Infinity];
    for (let i = 0; i < head.positions.length; i += 3) {
      minZ = Math.min(minZ, head.positions[i + 2]);
      maxZ = Math.max(maxZ, head.positions[i + 2]);
      nose = Math.min(nose, head.positions[i + 1]);
    }
    expect(minZ).toBeCloseTo(0, 1);
    expect(maxZ).toBeGreaterThan(PRINT.bustHeight[0]);
    expect(maxZ).toBeLessThan(PRINT.bustHeight[1]);
    expect(nose).toBeLessThan(-10);
  }, 120000);
});

// Checks an STL file on its own terms, without Manifold: watertight (every edge shared by two triangles, one
// each way), and the volume it encloses
const inspect = (stl: ArrayBuffer) => {
  const { positions, count } = readStl(stl);
  const first = new Map<string, number>();
  const ids = new Uint32Array(count * 3);
  const unique: number[] = [];
  for (let i = 0; i < count * 3; i++) {
    const key = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
    let at = first.get(key);
    if (at === undefined) {
      at = unique.length / 3;
      first.set(key, at);
      unique.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    ids[i] = at;
  }
  const directed = new Map<string, number>();
  for (let t = 0; t < count; t++) {
    for (let e = 0; e < 3; e++) {
      const k = `${ids[t * 3 + e]},${ids[t * 3 + ((e + 1) % 3)]}`;
      directed.set(k, (directed.get(k) ?? 0) + 1);
    }
  }
  let unpaired = 0;
  for (const [k, n] of directed) {
    const [a, b] = k.split(",");
    if (n !== 1 || directed.get(`${b},${a}`) !== 1) unpaired++;
  }
  return { count, unpaired, volume: volumeOf(unique, ids) };
};

describe("merging a bust into one printable solid", () => {
  const merge = async (p: Params) => mergeParts(collectParts(p, assets), undefined, undefined, PRINT.flatCut);
  const expectOneSolid = (label: string, report: PrintReport) => {
    expect(report.status, label).toBe("NoError");
    expect(report.parts.filter((part) => !part.accepted).map((part) => `${part.name}: ${part.problem}`), label).toEqual([]);
    expect(report.components.length, `${label}: separate pieces ${report.components.map((c) => c.volume.toFixed(1))}`).toBe(1);
    expect(report.volume, label).toBeGreaterThan(30000);
  };

  it("makes a plain bust one solid of the right size, with a base wider than the bust's underside", async () => {
    const { stl, report } = await merge(params({ hairStyle: "none", beardStyle: "none" }));
    expectOneSolid("plain human", report);
    expect(report.voids).toBe(0);
    // Standing on the base: the base's underside is z = -4 and the bust is 75-90 mm tall above z = 0
    expect(report.min[2]).toBeCloseTo(-PRINT.baseHeight, 1);
    expect(report.size[2] - PRINT.baseHeight).toBeGreaterThan(PRINT.bustHeight[0]);
    expect(report.size[2] - PRINT.baseHeight).toBeLessThan(PRINT.bustHeight[1]);
    expect(report.size[0]).toBeGreaterThan(55);
    // The file: watertight, and it encloses what the merge says it does
    const file = inspect(stl);
    expect(file.count).toBe(report.triangles);
    expect(file.unpaired).toBe(0);
    expect(Math.abs(file.volume - report.volume) / report.volume).toBeLessThan(0.002);
  }, 120000);

  it("joins the eyes, brows, teeth, tongue and tusks to the head: a half-orc with its mouth open is one solid", async () => {
    const orc = applyRace(defaultParams(), "half-orc");
    orc.jawOpen = 0.5;
    orc.snarl = 0.5;
    orc.tusks = 0.7;
    orc.hairStyle = "mohawk";
    const { report } = await merge(orc);
    expectOneSolid("half-orc", report);
    expect(report.parts.find((part) => part.name === "teeth")!.shells).toBeGreaterThan(10);
  }, 300000);

  it("merges hair, a full beard and mirrored horns into one solid, and the file is watertight", async () => {
    const tiefling = applyRace(defaultParams(), "tiefling");
    tiefling.hairStyle = "swept";
    tiefling.beardStyle = "full";
    const { stl, report } = await merge(tiefling);
    expectOneSolid("tiefling", report);
    const file = inspect(stl);
    expect(file.unpaired).toBe(0);
    expect(Math.abs(file.volume - report.volume) / report.volume).toBeLessThan(0.002);
  }, 600000);

  it("merges dreadlocks, braids and long hair's side locks, each lock joined to the head", async () => {
    const dwarf = applyRace(defaultParams(), "dwarf");
    dwarf.hairStyle = "dreadlocks";
    const braids = applyRace({ ...defaultParams(), body: "feminine" }, "human");
    braids.hairStyle = "braids";
    const elf = applyRace({ ...defaultParams(), body: "feminine" }, "elf");
    elf.hairStyle = "long";
    for (const [label, p] of [["dreadlocks", dwarf], ["braids", braids], ["long hair", elf]] as const) {
      const { report } = await merge(p);
      expectOneSolid(label, report);
    }
  }, 900000);

  it("leaves out, and reports, a part that is not a closed solid instead of guessing", async () => {
    const { positions, indices } = cube();
    const open: Part = { name: "open", positions, indices: indices.slice(0, indices.length - 6) }; // two triangles missing
    const good: Part = { name: "good", positions: Float32Array.from(positions, (v) => v * 10), indices };
    // (by default it refuses: a file with a feature missing is never produced by accident)
    await expect(mergeParts([open, good])).rejects.toThrow(/open/);
    const { report } = await mergeParts([open, good], undefined, undefined, undefined, true);
    expect(report.parts.find((part) => part.name === "open")!.accepted).toBe(false);
    expect(report.parts.find((part) => part.name === "good")!.accepted).toBe(true);
    expect(report.volume).toBeCloseTo(1000, 1);
    // ...and refuses when nothing is left
    await expect(mergeParts([open])).rejects.toThrow();
  });

  it("is sized to the print profile: the base follows the bust with its margin", () => {
    const parts = collectParts(params({ hairStyle: "none", beardStyle: "none" }), assets);
    const base = parts.find((part) => part.name === "base")!;
    const head = parts.find((part) => part.name === "head")!;
    const span = (part: Part, axis: number) => {
      let [lo, hi] = [Infinity, -Infinity];
      for (let i = axis; i < part.positions.length; i += 3) {
        lo = Math.min(lo, part.positions[i]);
        hi = Math.max(hi, part.positions[i]);
      }
      return [lo, hi];
    };
    // (the bust's underside is its lowest part, at z = 0; take just that)
    const underside: [number, number][] = [];
    for (let i = 0; i < head.positions.length; i += 3) if (head.positions[i + 2] < 0.01) underside.push([head.positions[i], head.positions[i + 1]]);
    const [x0, x1] = [Math.min(...underside.map((p) => p[0])), Math.max(...underside.map((p) => p[0]))];
    const [bx0, bx1] = span(base, 0);
    expect(bx0).toBeLessThan(x0 - PRINT.baseMargin * 0.9);
    expect(bx1).toBeGreaterThan(x1 + PRINT.baseMargin * 0.9);
    const [z0, z1] = span(base, 2);
    expect(z0).toBeCloseTo(-PRINT.baseHeight, 3);
    expect(z1).toBeCloseTo(PRINT.flatCut + PRINT.baseOverlap, 3);
    expect(MM * 32).toBe(1);
  });
});

// (THREE is imported for the typed-array helpers some checks lean on)
void THREE;

describe("the pedestal", () => {
  const footprint: [number, number][] = [[-20 * MM, -10 * MM], [20 * MM, -10 * MM], [26 * MM, 18 * MM], [-26 * MM, 18 * MM]];
  it("reads how far an outline reaches in any direction", () => {
    const square = convexHull([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    expect(radiusAt(square, 0)).toBeCloseTo(1, 6);
    expect(radiusAt(square, Math.PI / 4)).toBeCloseTo(Math.SQRT2, 6);
    expect(radiusAt(square, Math.PI)).toBeCloseTo(1, 6);
  });
  it("is a round disc at the foot, narrows to a waist, and flares out to the bust's exact underside", () => {
    const rings = pedestalRings(footprint, -PRINT.baseHeight * MM, 1.6 * MM);
    const radii = rings.map((ring) => Array.from({ length: PEDESTAL_SIDES }, (_, k) => Math.hypot(ring[k * 3], ring[k * 3 + 2])));
    const foot = radii[1];
    expect(Math.min(...foot)).toBeCloseTo(Math.max(...foot), 6);
    expect(foot[0] / MM).toBeGreaterThanOrEqual(PRINT.baseRadius - 1e-6);
    const waist = Math.min(...radii.map((r) => Math.max(...r)).slice(4));
    expect(waist).toBeLessThan(0.6 * foot[0]);
    const top = radii[radii.length - 1];
    const hull = convexHull(footprint);
    for (let k = 0; k < PEDESTAL_SIDES; k++) expect(top[k]).toBeCloseTo(radiusAt(hull, (k / PEDESTAL_SIDES) * 2 * Math.PI), 6);
  });
  it("is a closed solid wound outward", () => {
    const geometry = pedestalGeometry(footprint, -PRINT.baseHeight * MM, 1.6 * MM);
    const index = geometry.index!;
    const uses = new Map<number, number>();
    for (let t = 0; t < index.count; t += 3) {
      for (let e = 0; e < 3; e++) {
        const [i, j] = [index.getX(t + e), index.getX(t + ((e + 1) % 3))];
        uses.set(i * 65536 + j, (uses.get(i * 65536 + j) ?? 0) + 1);
      }
    }
    for (const [key] of uses) expect(uses.get((key % 65536) * 65536 + Math.floor(key / 65536))).toBe(1);
    expect(volumeOf(geometry.attributes.position.array, index.array)).toBeGreaterThan(0);
  });
});

describe("refusing to export what is not one solid", () => {
  const box = (name: string, size: number, at: number): Part => {
    const { positions, indices } = cube();
    return { name, positions: Float32Array.from(positions, (v, i) => v * size + (i % 3 === 0 ? at : 0)), indices };
  };
  it("refuses two separate bodies by default, and reports both in a diagnostic export", async () => {
    const parts = [box("a", 10, 0), box("b", 10, 50)];
    await expect(mergeParts(parts)).rejects.toThrow(/2 separate bodies/);
    const { report } = await mergeParts(parts, undefined, undefined, undefined, true);
    expect(report.components.length).toBe(2);
  });
  it("removes a stray speck explicitly, so it is neither in the file nor hidden from the count", async () => {
    const parts = [box("a", 10, 0), box("speck", 0.5, 50)];
    const { stl, report } = await mergeParts(parts);
    expect(report.specks).toBe(1);
    expect(report.components.length).toBe(1);
    expect(report.volume).toBeCloseTo(1000, 1);
    expect(readStl(stl).count).toBe(report.triangles);
    expect(Math.max(...readStl(stl).positions.filter((_, i) => i % 3 === 0))).toBeLessThanOrEqual(10.001);
  });
});
