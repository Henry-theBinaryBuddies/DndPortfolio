import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import { buildBust } from "./builder";
import { readCharacter, characterFile } from "./character";
import { parseDragonborn, shapeDragonborn, type DragonbornManifest } from "./dragonborn";
import { collectBust } from "./export";
import { collectTabletop } from "./fit";
import { defaultPaint, paintKind } from "./paint";
import { applyRace, characterName, defaultParams, NUMERIC_DEFS, type Params } from "./params";
import { mergeParts } from "./printable";
import { PEDESTAL_SIDES, shiftReach, TABLETOP } from "./print";

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
      ["scales", 1],
      ["horn", 1],
      ["dragonEye", 2],
    ]);
    // the lowest point is the top of the base, and the base and framing measurements are there
    bust.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(bust);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(bust.userData.reach).toHaveLength(PEDESTAL_SIDES);
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
    expect(() => parseDragonborn(model, { ...manifest, version: manifest.version + 1 })).toThrow(/version/);
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

  it("fits the one inch square at tabletop size, horns included, centred over its base by its whole outline", () => {
    const t = collectTabletop(dragonborn(), assets, false);
    let reach = 0;
    for (const part of t.parts) {
      if (part.name === "base") continue;
      for (let i = 0; i < part.positions.length; i += 3) reach = Math.max(reach, Math.abs(part.positions[i]), Math.abs(part.positions[i + 1]));
    }
    expect(reach).toBeLessThanOrEqual(25.4 / 2);
    // (its torso slims, as a humanoid's does, only as far as that lets it grow: here its head's depth sets its size)
    expect(t.params.torso).toBeLessThanOrEqual(dragonborn().torso);
    console.log(`dragonborn at tabletop size: scale ${t.scale.toFixed(3)}, bust ${t.height.toFixed(1)} mm, ${t.width.toFixed(1)} x ${t.depth.toFixed(1)} mm; ${t.notes.join(" ")}`);
    expect(t.height).toBeLessThanOrEqual(TABLETOP.aim + 1e-6);
    // ...centred over its base by its whole outline: its muzzle reaches as far forward as its horns reach back
    let [front, back] = [Infinity, -Infinity];
    for (const part of t.parts) {
      if (part.name === "base") continue;
      for (let i = 1; i < part.positions.length; i += 3) [front, back] = [Math.min(front, part.positions[i]), Math.max(back, part.positions[i])];
    }
    expect(Math.abs(front + back)).toBeLessThan(0.5);
  }, 300000);

  it("is the sculpt as made with its own sliders at their middles, and the controls move what they name", () => {
    const asset = assets.dragonborn!;
    expect(shapeDragonborn(asset, dragonborn()).positions).toEqual(asset.positions);
    const reach = (p: Params, axis: number, pick: (y: number) => boolean) => {
      const v = shapeDragonborn(asset, p).positions;
      let most = -Infinity;
      // (of the scales only, unless the horns are what is measured: a cheek spine reaches past the jaw)
      for (let i = 0; i < v.length; i += 3) if (pick(v[i + 1]) && (asset.part[i / 3] === 0 || measuringHorns)) most = Math.max(most, Math.abs(v[i + axis]));
      return most;
    };
    let measuringHorns = false;
    const head = (y: number) => y > -0.7;
    // a longer muzzle reaches farther forward; a broader jaw is wider low on the head; bigger horns reach farther out
    expect(reach({ ...dragonborn(), dragonMuzzle: 1 }, 2, head)).toBeGreaterThan(reach(dragonborn(), 2, head) + 0.1);
    expect(reach({ ...dragonborn(), dragonMuzzle: 0 }, 2, head)).toBeLessThan(reach(dragonborn(), 2, head) - 0.1);
    const low = (y: number) => y < -0.35 && y > -0.65;
    expect(reach({ ...dragonborn(), dragonJaw: 1 }, 0, low)).toBeGreaterThan(reach(dragonborn(), 0, low) * 1.05);
    measuringHorns = true;
    expect(reach({ ...dragonborn(), dragonHorns: 1 }, 0, head)).toBeGreaterThan(reach(dragonborn(), 0, head) * 1.1);
    // and the eyes stay in their sockets: no face control moves them
    const eyes = (p: Params) => shapeDragonborn(asset, p).eyes.map((e) => e.centre.toArray());
    for (const key of ["dragonMuzzle", "dragonSnout", "dragonJaw", "dragonBrow", "dragonHorns", "dragonSweep", "dragonSpines"] as const) {
      for (const value of [0, 1]) eyes({ ...dragonborn(), [key]: value }).forEach((c, i) => c.forEach((x, k) => expect(x, `${key} ${value}`).toBeCloseTo(eyes(dragonborn())[i][k], 6)));
    }
  });

  it("never folds its surface over itself, at either end of every control", () => {
    const asset = assets.dragonborn!;
    const index = asset.indices;
    const base = asset.positions;
    let lowest = Infinity;
    for (let i = 1; i < base.length; i += 3) lowest = Math.min(lowest, base[i]);
    const folded = (v: Float32Array) => {
      let count = 0;
      for (let t = 0; t < index.length; t += 3) {
        const [i, j, k] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
        // (not on the flat underside, which the print cuts away and joins to the pedestal, nor the few slivers of next to
        // no area that the decimation left, which turn over at the least change and cannot be seen)
        if (Math.min(base[i + 1], base[j + 1], base[k + 1]) < lowest + 0.05) continue;
        const n = (w: Float32Array) => {
          const [ux, uy, uz] = [w[j] - w[i], w[j + 1] - w[i + 1], w[j + 2] - w[i + 2]];
          const [wx, wy, wz] = [w[k] - w[i], w[k + 1] - w[i + 1], w[k + 2] - w[i + 2]];
          return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
        };
        const [a, b] = [n(v), n(base)];
        // (a sliver: next to no area, or a needle, its area tiny for its length)
        const longest = Math.max(...[[i, j], [j, k], [k, i]].map(([p, q]) => Math.hypot(base[p] - base[q], base[p + 1] - base[q + 1], base[p + 2] - base[q + 2])));
        if (Math.hypot(b[0], b[1], b[2]) < Math.max(1e-5, 0.05 * longest * longest)) continue;
        if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) count++;
      }
      return count;
    };
    const controls = NUMERIC_DEFS.filter((d) => d.families.includes("dragonborn"));
    for (const d of controls) for (const value of [d.min, d.max]) expect(folded(shapeDragonborn(asset, { ...dragonborn(), [d.key]: value }).positions), `${d.key} ${value}`).toBe(0);
    const all = (value: number) => Object.fromEntries(controls.filter((d) => d.key !== "torso").map((d) => [d.key, value]));
    for (const value of [0, 1]) expect(folded(shapeDragonborn(asset, { ...dragonborn(), ...all(value), torso: 0.6 }).positions), `all ${value}`).toBe(0);
  }, 300000);

  it("prints as one closed solid at the ends of its controls too", async () => {
    for (const value of [0, 1]) {
      const p = { ...dragonborn(), dragonMuzzle: value, dragonSnout: value, dragonJaw: value, dragonBrow: value, dragonNeck: value, dragonHorns: value, dragonSweep: value, dragonSpines: value };
      const { parts, flatCut } = collectBust(p, assets);
      const { report } = await mergeParts(parts, undefined, undefined, flatCut);
      expect(report.components, `all at ${value}`).toHaveLength(1);
      expect(report.badEdges).toBe(0);
    }
  }, 300000);

  it("measures the pedestal's reach again from where the base's middle has moved to", () => {
    // a round outline of radius 10, seen from 3 to one side: 7 that way, 13 the other, the same either side across
    const circle = Array.from({ length: PEDESTAL_SIDES }, () => 10);
    const seen = shiftReach(circle, 3, 0);
    expect(seen[0]).toBeCloseTo(7, 1);
    expect(seen[PEDESTAL_SIDES / 2]).toBeCloseTo(13, 1);
    expect(seen[PEDESTAL_SIDES / 4]).toBeCloseTo(seen[(3 * PEDESTAL_SIDES) / 4], 3);
    expect(Math.hypot(3, seen[PEDESTAL_SIDES / 4])).toBeCloseTo(10, 1);
  });
});
