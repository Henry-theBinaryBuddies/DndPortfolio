import { describe, expect, it } from "vitest";
import { NUMERIC_DEFS, PRESETS, RACES, applyPreset, applyRace, clampParams, defaultParams, randomParams } from "./params";

// Small deterministic generator so the random tests give the same answer every run.
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const inRange = (params: ReturnType<typeof defaultParams>) => {
  for (const def of NUMERIC_DEFS) {
    expect(params[def.key], def.key).toBeGreaterThanOrEqual(def.min);
    expect(params[def.key], def.key).toBeLessThanOrEqual(def.max);
  }
};

describe("params", () => {
  it("defaults sit inside their slider ranges", () => {
    inRange(defaultParams());
  });

  it("clamps out-of-range values", () => {
    const wild = { ...defaultParams(), headWidth: 9, bulk: -3 };
    const fixed = clampParams(wild);
    expect(fixed.headWidth).toBe(1.2);
    expect(fixed.bulk).toBe(0.7);
  });

  it("randomizes within range, and repeatably for the same seed", () => {
    const a = randomParams(seeded(7));
    const b = randomParams(seeded(7));
    expect(a).toEqual(b);
    inRange(a);
  });

  it("keeps every random roll in range across many seeds", () => {
    for (let seed = 1; seed <= 40; seed++) inRange(randomParams(seeded(seed)));
  });
});

describe("races", () => {
  it("every race produces in-range sliders", () => {
    for (const race of RACES) inRange(applyRace(defaultParams(), race));
  });

  it("gives elves long ears and dwarves a big beard", () => {
    expect(applyRace(defaultParams(), "elf").earSize).toBe(1);
    expect(applyRace(defaultParams(), "dwarf").beard).toBeGreaterThan(0.8);
  });

  it("gives dragonborn a snout and scales, and no ears", () => {
    const dragonborn = applyRace(defaultParams(), "dragonborn");
    expect(dragonborn.snout).toBeGreaterThan(0.5);
    expect(dragonborn.scales).toBeGreaterThan(0.5);
    expect(dragonborn.earSize).toBe(0);
  });

  it("resets the previous race's shape when switching", () => {
    const orc = applyRace(defaultParams(), "half-orc");
    expect(orc.tusks).toBeGreaterThan(0);
    expect(applyRace(orc, "elf").tusks).toBe(0);
  });

  it("keeps cloth, eye colour and hood choice across a race change", () => {
    const current = { ...defaultParams(), cloth: "#123456", eyes: "#abcdef", hood: false };
    const next = applyRace(current, "tiefling");
    expect(next.cloth).toBe("#123456");
    expect(next.eyes).toBe("#abcdef");
    expect(next.hood).toBe(false);
  });
});

describe("presets", () => {
  it("every preset produces in-range sliders", () => {
    for (const preset of PRESETS) inRange(applyPreset(defaultParams(), preset));
  });

  it("applies the preset's race, hood and colours", () => {
    const ghoul = PRESETS.find((p) => p.name === "Ghoul")!;
    const result = applyPreset(defaultParams(), ghoul);
    expect(result.hood).toBe(false);
    expect(result.skin).toBe(ghoul.skin);
    const warlord = applyPreset(defaultParams(), PRESETS.find((p) => p.name === "Warlord")!);
    expect(warlord.race).toBe("half-orc");
  });
});
