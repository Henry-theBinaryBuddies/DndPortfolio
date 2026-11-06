import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import { bodyKey, bodySurface, COLLAR_POINTS, type BodySurface } from "./bodySurface";
import { buildBust } from "./builder";
import { parseDragonborn, type DragonbornManifest } from "./dragonborn";
import { applyRace, BODIES, defaultParams, RACES, type Params } from "./params";

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

const cases: [string, () => Params][] = [
  ["a masculine human", () => applyRace(defaultParams(), "human")],
  ["a feminine half-elf", () => ({ ...applyRace(defaultParams(), "half-elf"), body: "feminine" })],
  ["a dwarf", () => applyRace(defaultParams(), "dwarf")],
  ["a Dragonborn", () => ({ ...defaultParams(), family: "dragonborn" })],
];

describe("the body surface clothing is fitted to", () => {
  for (const [label, params] of cases) {
    it(`puts the anchors of ${label} where a collar and pauldrons would go`, () => {
      const s: BodySurface = bodySurface(params(), assets);
      const { neckBase, sternum, nape, shoulders, collar } = s.anchors;
      // the neck meets the shoulders below the chin and well above the cut
      expect(neckBase).toBeLessThan(-0.6);
      expect(neckBase).toBeGreaterThan(s.baseY + 0.4);
      // the sternum is at the front and faces forward; the nape at the back, facing back
      expect(sternum.position.z).toBeGreaterThan(nape.position.z + 0.2);
      expect(sternum.normal.z).toBeGreaterThan(0.3);
      expect(nape.normal.z).toBeLessThan(-0.3);
      // the shoulders mirror each other, out to the sides, below the neck's base, and face up and out
      expect(shoulders.right.position.x).toBeGreaterThan(0.3);
      expect(Math.abs(shoulders.right.position.x + shoulders.left.position.x)).toBeLessThan(0.05);
      expect(Math.abs(shoulders.right.position.y - shoulders.left.position.y)).toBeLessThan(0.05);
      expect(shoulders.right.position.y).toBeLessThan(neckBase + 0.1);
      expect(shoulders.right.normal.y).toBeGreaterThan(0.2);
      // the collar is a ring round the neck at its base, narrower than the shoulders, its points on the surface
      expect(collar).toHaveLength(COLLAR_POINTS);
      for (const point of collar) {
        expect(point.y).toBeCloseTo(neckBase, 6);
        expect(Math.abs(point.x)).toBeLessThan(shoulders.right.position.x);
        expect(s.closest(point).distance).toBeLessThan(1e-3);
      }
      console.log(`${label}: neck base ${neckBase.toFixed(3)}, sternum z ${sternum.position.z.toFixed(3)}, nape z ${nape.position.z.toFixed(3)}, shoulders x ${shoulders.right.position.x.toFixed(3)} y ${shoulders.right.position.y.toFixed(3)}`);
    }, 120000);
  }

  it("keeps each shoulder outside the collar, on every race, build and torso, and on the Dragonborn's neck too", () => {
    // (audit 20: slim at 60% torso, an elf's, a halfling's and a gnome's shoulder anchors were inside their collars)
    const all: Params[] = [];
    for (const race of RACES) for (const body of BODIES) for (const torso of [0.6, 1.1]) all.push({ ...applyRace(defaultParams(), race), body, torso });
    for (const torso of [0.6, 1.1]) for (const dragonNeck of [0, 1]) all.push({ ...defaultParams(), family: "dragonborn", torso, dragonNeck });
    for (const p of all) {
      const label = `${p.family === "dragonborn" ? `Dragonborn neck ${p.dragonNeck}` : `${p.race} ${p.body}`} torso ${p.torso}`;
      const { neckBase, shoulders, collar } = bodySurface(p, assets).anchors;
      const collarHalf = Math.max(...collar.map((point) => Math.abs(point.x)));
      for (const [side, sign] of [["right", 1], ["left", -1]] as const) {
        expect(sign * shoulders[side].position.x, `${label}: ${side} shoulder outside the collar`).toBeGreaterThan(collarHalf);
        expect(shoulders[side].normal.y, `${label}: ${side} shoulder faces up`).toBeGreaterThan(0.2);
        expect(shoulders[side].position.y, `${label}: ${side} shoulder below the neck's base`).toBeLessThan(neckBase + 0.1);
      }
    }
  }, 300000);

  it("finds the nearest point of the surface and its outward normal, in its own frame", () => {
    const s = bodySurface(applyRace(defaultParams(), "human"), assets);
    const { position, normal } = s.anchors.sternum;
    const off = position.clone().addScaledVector(normal, 0.1);
    const near = s.closest(off);
    expect(near.distance).toBeCloseTo(0.1, 2);
    expect(near.normal.dot(normal)).toBeGreaterThan(0.8);
  });

  it("is the frame the bust is built in, moved onto its plinth by `stand`", () => {
    for (const [, params] of cases) {
      const p = params();
      const bust = buildBust(p, assets, false);
      expect(bust.children[0].position.distanceTo(bodySurface(p, assets).stand)).toBeLessThan(1e-9);
    }
  });

  it("keeps one surface for a shape, and only the settings that shape the body change it", () => {
    const p = applyRace(defaultParams(), "human");
    expect(bodySurface(p, assets)).toBe(bodySurface({ ...p }, assets));
    expect(bodyKey({ ...p, hairStyle: "long", beardStyle: "full" })).toBe(bodyKey(p));
    expect(bodyKey({ ...p, torso: 0.7 })).not.toBe(bodyKey(p));
    const d: Params = { ...defaultParams(), family: "dragonborn" };
    expect(bodyKey({ ...d, race: "elf", brow: 0.8 })).toBe(bodyKey(d));
    expect(bodyKey({ ...d, dragonNeck: 0.9 })).not.toBe(bodyKey(d));
  });
});
