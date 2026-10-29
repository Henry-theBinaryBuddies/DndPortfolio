import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import { basePrism, pedestalGeometry } from "./builder";
import { collectBust, collectParts } from "./export";
import { applyRace, defaultParams, type Params } from "./params";
import { baseOutline, convexHull, MM, pedestalRings, PEDESTAL_SIDES, PRINT, radiusAt, reachOfHull } from "./print";
import { edgeProblems, mergeParts, readStl, separateKisses, splitShells, weld, writeStl, type Part, type PrintReport } from "./printable";
import { measureWalls, summariseWalls } from "./thickness";

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
  }, 300000);
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
  const merge = async (p: Params) => {
    const { parts, flatCut } = collectBust(p, assets);
    return mergeParts(parts, undefined, undefined, flatCut);
  };
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
  }, 300000);

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
    expect(z1).toBeCloseTo(collectBust(params({ hairStyle: "none", beardStyle: "none" }), assets).flatCut + PRINT.baseOverlap, 3);
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
    const rings = pedestalRings(reachOfHull(footprint), -PRINT.baseHeight * MM, 1.6 * MM);
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
  it("flares no steeper than the print's overhang limit, for narrow and broad busts alike", () => {
    for (const farthest of [28, 33, 37]) {
      const reach = Array.from({ length: PEDESTAL_SIDES }, (_, k) => (24 + (farthest - 24) * (0.5 + 0.5 * Math.cos((k / PEDESTAL_SIDES) * 4 * Math.PI))) * MM);
      const rings = pedestalRings(reach, -PRINT.baseHeight * MM, 2.9 * MM);
      let steepest = 0;
      for (let i = 5; i < rings.length; i++) {
        const dy = rings[i][1] - rings[i - 1][1];
        for (let k = 0; k < PEDESTAL_SIDES; k++) {
          const grow = Math.hypot(rings[i][k * 3], rings[i][k * 3 + 2]) - Math.hypot(rings[i - 1][k * 3], rings[i - 1][k * 3 + 2]);
          steepest = Math.max(steepest, Math.atan2(grow, dy));
        }
      }
      expect((steepest * 180) / Math.PI).toBeLessThan(52); // (the broadest busts have too little stem to flare at exactly 45)
    }
  });
  it("is a closed solid wound outward", () => {
    const geometry = pedestalGeometry(reachOfHull(footprint), -PRINT.baseHeight * MM, 1.6 * MM);
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

describe("the file as a slicer reads it", () => {
  const cubeAt = (name: string, x: number, y: number): Part => {
    const { positions, indices } = cube();
    return { name, positions: Float32Array.from(positions, (v, i) => v + (i % 3 === 0 ? x : i % 3 === 1 ? y : 0)), indices };
  };
  it("counts an edge shared by four triangles, which two surfaces touching along a line produce", async () => {
    // Two cubes that meet only along one edge: the merge keeps them apart, but the file would show that edge four times
    const parts = [cubeAt("a", 0, 0), cubeAt("b", 1, 1)];
    const wasm = await import("./printable").then((m) => m.loadManifold());
    const kept = parts.map((part) => wasm.Manifold.ofMesh(new wasm.Mesh({ numProp: 3, vertProperties: part.positions, triVerts: part.indices })));
    const joined = wasm.Manifold.union(kept).getMesh();
    const positions = new Float32Array(joined.vertProperties);
    const before = edgeProblems(positions, joined.triVerts);
    expect(before.shared, "the touching edge").toBeGreaterThan(0);
    const after = separateKisses(positions, joined.triVerts);
    expect(after.moved).toBeGreaterThan(0);
    expect(after.open + after.shared).toBe(0);
  });
  it("leaves a clean cube alone", () => {
    const { positions, indices } = cube();
    const result = separateKisses(Float32Array.from(positions), indices);
    expect(result).toEqual({ moved: 0, open: 0, shared: 0 });
  });
});

describe("wall thickness", () => {
  const box = (x: number, y: number, z: number): { positions: Float32Array; indices: Uint32Array } => {
    const { positions, indices } = cube();
    return { positions: Float32Array.from(positions, (v, i) => v * [x, y, z][i % 3] + (i % 3 === 2 ? 5 : 0)), indices };
  };
  it("measures a thick block as thick all the way through", () => {
    const { positions, indices } = box(10, 10, 10);
    const walls = measureWalls(positions, indices, 4000, 0);
    const mostly = Array.from(walls.thickness).filter((t) => Math.abs(t - 10) < 0.05).length / walls.thickness.length;
    expect(mostly).toBeGreaterThan(0.9);
  });
  it("calls a thin plate thin, and says how much of the surface it is", () => {
    const { positions, indices } = box(20, 20, 0.3);
    const summary = summariseWalls(measureWalls(positions, indices, 6000, 0));
    // (nearly all the surface is the two big faces, each 0.3 mm from the other)
    expect(summary.thinner[0].share).toBeGreaterThan(0.95);
  });
  it("does not mistake carved ridges for a thin wall, since the ray goes into the core", () => {
    // A block with a row of ridges 0.4 mm wide and 0.6 mm tall standing on its top face, as a triangle soup
    const soup: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => soup.push(...a, ...b, ...c, ...a, ...c, ...d);
    const { positions, indices } = box(20, 20, 10);
    for (let t = 0; t < indices.length; t++) soup.push(positions[indices[t] * 3], positions[indices[t] * 3 + 1], positions[indices[t] * 3 + 2]);
    // (ridges sit on top, as extra closed prisms: overlapping solids are fine for ray measurements)
    for (let r = 0; r < 20; r++) {
      const x = 0.5 + r * 0.95;
      const [x1, y0, y1, z0, z1] = [x + 0.4, 1, 19, 15, 15.6];
      quad([x, y0, z0], [x1, y0, z0], [x1, y1, z0], [x, y1, z0]);
      quad([x, y0, z1], [x, y1, z1], [x1, y1, z1], [x1, y0, z1]);
      quad([x, y0, z0], [x, y0, z1], [x1, y0, z1], [x1, y0, z0]);
      quad([x1, y1, z0], [x1, y1, z1], [x, y1, z1], [x, y1, z0]);
      quad([x, y1, z0], [x, y1, z1], [x, y0, z1], [x, y0, z0]);
      quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]);
    }
    // The top of the block is at z = 15: with its ridges, and averaged normals, the flat top still reads as the block
    const walls = measureWalls(new Float32Array(soup), null, 8000, 0);
    const thin = Array.from(walls.thickness).filter((t) => t < 0.4).length / walls.thickness.length;
    expect(thin).toBeLessThan(0.15); // (the ridges' own sides and tops are 0.4 mm across: those do count, a little)
  });
  it("is repeatable", () => {
    const { positions, indices } = box(10, 10, 3);
    const a = measureWalls(positions, indices, 500, 0, 7);
    const b = measureWalls(positions, indices, 500, 0, 7);
    expect(Array.from(a.thickness)).toEqual(Array.from(b.thickness));
  });
});

describe("the pedestal junction", () => {
  it("leaves no thin wedge where the pedestal meets a half-orc's wide shoulders", async () => {
    const orc = applyRace(defaultParams(), "half-orc");
    orc.hairStyle = "none";
    const { parts, flatCut } = collectBust(orc, assets);
    const { stl, report } = await mergeParts(parts, undefined, undefined, flatCut);
    expect(flatCut).toBeGreaterThan(PRINT.flatCut); // the shoulders' underside is not flat: the cut goes higher
    // The junction band: from the cut to 4 mm above it
    const file = readStl(stl);
    const band = measureWalls(file.positions, null, 40000, flatCut - 0.5, 1, 0.8, flatCut + 4);
    const thin = Array.from(band.thickness).filter((t) => t < 0.4).length / band.thickness.length;
    expect(thin, `${(thin * 100).toFixed(1)}% of the junction is thin`).toBeLessThan(0.02);
    expect(report.walls.thinner[0].share).toBeLessThan(0.01);
  }, 300000);
});
