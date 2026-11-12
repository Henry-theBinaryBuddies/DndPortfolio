import { describe, expect, it } from "vitest";
import { FLOORS, newMap, type MapDoc } from "./model";
import { clipCentre, copyItem, makeStamp, pasteClip } from "./objects";
import { MAX_STEPS, MIN_STEPS, STAIRS_PRESETS, clampSteps, parseStairs } from "./stairs";
import { parse, serialize } from "./storage";

describe("stairs descriptions", () => {
  it("keeps the number of steps in range", () => {
    expect(clampSteps(1)).toBe(MIN_STEPS);
    expect(clampSteps(99)).toBe(MAX_STEPS);
    expect(clampSteps(7.6)).toBe(8);
    expect(clampSteps(Number.NaN)).toBe(8);
  });

  it("reads good stairs and rejects bad ones", () => {
    expect(parseStairs({ steps: 6, material: "wood", dir: "down" })).toEqual({ steps: 6, material: "wood", dir: "down" });
    expect(parseStairs({ steps: 500, material: "stone", dir: "sideways" })).toEqual({ steps: MAX_STEPS, material: "stone", dir: "up" });
    expect(parseStairs({ steps: 5, material: "adamantine", dir: "up" })).toBeNull();
    expect(parseStairs({ steps: 5, material: "plain", dir: "up" })).toBeNull();
    expect(parseStairs(null)).toBeNull();
    expect(parseStairs("stairs")).toBeNull();
  });

  it("offers presets that are all valid and have different ids", () => {
    expect(new Set(STAIRS_PRESETS.map((p) => p.id)).size).toBe(STAIRS_PRESETS.length);
    for (const p of STAIRS_PRESETS) {
      expect(parseStairs(p.spec)).toEqual(p.spec);
      expect(FLOORS.some((f) => f.id === p.spec.material)).toBe(true);
      expect(p.widthCells).toBeGreaterThan(0);
      expect(p.lengthCells).toBeGreaterThan(0);
    }
  });
});

describe("stairs as stamps", () => {
  const asset = { id: "stairs-stone-up", width: 200, height: 300, stairs: { steps: 8, material: "stone", dir: "up" } as const };

  it("are made with their description and no extra shadow", () => {
    const s = makeStamp("s1", asset, { x: 100, y: 100 }, 210, 0, true);
    expect(s.stairs).toEqual({ steps: 8, material: "stone", dir: "up" });
    expect(s.shadow).toBe(false);
    expect(s.height).toBe(210);
    expect(s.width).toBeCloseTo(140);
  });

  it("do not share their description with the list entry", () => {
    const s = makeStamp("s1", asset, { x: 0, y: 0 }, 210, 0, false);
    s.stairs!.steps = 3;
    expect(asset.stairs.steps).toBe(8);
  });

  it("save and open with their description", () => {
    const doc: MapDoc = { ...newMap(), stamps: [makeStamp("s1", asset, { x: 70, y: 70 }, 210, 0.5, false)] };
    const back = parse(serialize(doc)).stamps[0];
    expect(back.stairs).toEqual({ steps: 8, material: "stone", dir: "up" });
    expect(back.rotation).toBe(0.5);
  });

  it("keep the stamp but drop a damaged description", () => {
    const doc: MapDoc = { ...newMap(), stamps: [makeStamp("s1", asset, { x: 70, y: 70 }, 210, 0, false)] };
    const raw = JSON.parse(serialize(doc));
    raw.stamps[0].stairs.material = "adamantine";
    const back = parse(JSON.stringify(raw));
    expect(back.stamps).toHaveLength(1);
    expect(back.stamps[0].stairs).toBeUndefined();
  });

  it("copy and paste with their description", () => {
    const doc: MapDoc = { ...newMap(), stamps: [makeStamp("s1", asset, { x: 70, y: 70 }, 210, 0, false)] };
    const clip = copyItem(doc, "s1")!;
    const pasted = pasteClip(doc, clip, () => "s2", { x: 400, y: 400 })!;
    const copy = pasted.doc.stamps.find((s) => s.id === "s2")!;
    expect(copy.stairs).toEqual({ steps: 8, material: "stone", dir: "up" });
    expect(clipCentre(clip)).toEqual({ x: 70, y: 70 });
  });
});
