import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import { buildBust } from "./builder";
import { defaultPaint, Painter, racePaint, RACE_PAINT } from "./paint";
import { applyRace, defaultParams, RACES } from "./params";

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

describe("the paint", () => {
  it("starts each race with its own colours, and keeps the grime that was set when the race changes", () => {
    for (const race of RACES) {
      const paint = defaultPaint(race);
      for (const value of [paint.skin, paint.eyes, paint.hair, paint.horns, paint.teeth]) expect(value).toMatch(/^#[0-9a-f]{6}$/);
      expect(paint.grime).toBeGreaterThanOrEqual(0);
      expect(paint.grime).toBeLessThanOrEqual(1);
    }
    expect(defaultPaint("half-orc").skin).toBe(RACE_PAINT["half-orc"].skin);
    const grimy = { ...defaultPaint("human"), grime: 0.9, skin: "#123456" };
    const orc = racePaint(grimy, "half-orc");
    expect(orc.skin).toBe(RACE_PAINT["half-orc"].skin);
    expect(orc.grime).toBe(0.9);
    // (a colour the new race does not set goes back to the plain one, not the last race's)
    expect(racePaint(defaultPaint("tiefling"), "human").eyeGlow).toBe(false);
  });

  it("gives every part of a bust a material for what it is, and leaves the sculpt itself as it was", () => {
    const p = { ...applyRace(defaultParams(), "half-orc"), hornStyle: "ram" as const, hairStyle: "swept" as const, beardStyle: "short" as const, jawOpen: 0.3 };
    const bust = buildBust(p, assets, false);
    const before = new Map<THREE.Mesh, Float32Array>();
    bust.traverse((o) => o instanceof THREE.Mesh && before.set(o, Float32Array.from(o.geometry.attributes.position.array as Float32Array)));
    const painter = new Painter(assets.head, defaultPaint("half-orc"));
    painter.apply(bust, p, false);
    const kinds = new Map<string, THREE.Material>();
    bust.traverse((o) => o instanceof THREE.Mesh && kinds.set(o.name, o.material as THREE.Material));
    expect(kinds.get("head")).toBe(painter.materials.skin);
    expect(kinds.get("eye")).toBe(painter.materials.eye);
    expect(kinds.get("horn")).toBe(painter.materials.horn);
    expect(kinds.get("tusk")).toBe(painter.materials.teeth);
    expect(kinds.get("teeth")).toBe(painter.materials.teeth);
    expect(kinds.get("hair")).toBe(painter.materials.hair);
    expect(kinds.get("beard")).toBe(painter.materials.hair);
    // The head carries its per-vertex paint, one set of weights per vertex
    const head = [...before.keys()].find((m) => m.name === "head")!;
    const count = head.geometry.attributes.position.count;
    expect(head.geometry.attributes.paintA.count).toBe(count);
    expect(head.geometry.attributes.paintB.count).toBe(count);
    const weights = head.geometry.attributes.paintA.array as Float32Array;
    expect(weights.every(Number.isFinite)).toBe(true);
    // Painting moves nothing: the print is made from the same shapes
    for (const [mesh, positions] of before) expect(mesh.geometry.attributes.position.array).toEqual(positions);
    // Clay puts every part back in the one plain material, and the paint's materials outlive the bust
    painter.apply(bust, p, true);
    bust.traverse((o) => o instanceof THREE.Mesh && expect(o.material).toBe(painter.materials.clay));
    expect(Object.values(painter.materials).every((m) => m.userData.shared)).toBe(true);
  }, 120000);

  it("writes every ramp in its shaders with its edges in order (GLSL leaves smoothstep undefined otherwise)", () => {
    const file = readFileSync(new URL("./paint.ts", import.meta.url));
    const source = new TextDecoder().decode(new Uint8Array(file.buffer, file.byteOffset, file.byteLength));
    const calls = [...source.matchAll(/smoothstep\(\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*,/g)];
    expect(calls.length).toBeGreaterThan(10);
    for (const [call, from, to] of calls) expect(Number(from), call).toBeLessThan(Number(to));
  });
});
