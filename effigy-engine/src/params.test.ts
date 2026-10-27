import { describe, expect, it } from "vitest";
import { NUMERIC_DEFS, PRESETS, RACES, applyPreset, applyRace, clampParams, defaultParams, derive, randomParams } from "./params";

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
    const fixed = clampParams({ ...defaultParams(), age: 9, weight: -3 });
    expect(fixed.age).toBe(1);
    expect(fixed.weight).toBe(0);
  });

  it("randomizes within range, and repeatably for the same seed", () => {
    const a = randomParams(seeded(7));
    expect(a).toEqual(randomParams(seeded(7)));
    inRange(a);
  });

  it("keeps every random roll in range across many seeds", () => {
    for (let seed = 1; seed <= 40; seed++) inRange(randomParams(seeded(seed)));
  });
});

describe("anatomy derived from the sliders", () => {
  it("makes a lean person gaunt and a heavy one full-faced", () => {
    const lean = derive({ ...defaultParams(), weight: 0 });
    const heavy = derive({ ...defaultParams(), weight: 1 });
    expect(lean.gaunt).toBeGreaterThan(heavy.gaunt);
    expect(heavy.fullness).toBeGreaterThan(lean.fullness);
  });

  it("hollows the face with age", () => {
    expect(derive({ ...defaultParams(), age: 1 }).gaunt).toBeGreaterThan(derive({ ...defaultParams(), age: 0 }).gaunt);
  });

  it("widens the shoulders and thickens the neck with muscle", () => {
    const slight = derive({ ...defaultParams(), muscle: 0 });
    const strong = derive({ ...defaultParams(), muscle: 1 });
    expect(strong.shoulders).toBeGreaterThan(slight.shoulders);
    expect(strong.neckGirth).toBeGreaterThan(slight.neckGirth);
  });

  it("keeps every derived value inside a believable range for any slider setting", () => {
    for (const race of RACES) {
      for (const v of [0, 1]) {
        const p = { ...applyRace(defaultParams(), race) };
        for (const def of NUMERIC_DEFS) p[def.key] = v;
        const k = derive(p);
        expect(k.noseLength).toBeGreaterThanOrEqual(0);
        expect(k.noseLength).toBeLessThanOrEqual(1);
        expect(k.chin).toBeGreaterThanOrEqual(0);
        expect(k.chin).toBeLessThanOrEqual(1);
        expect(k.gaunt).toBeLessThanOrEqual(1);
        expect(k.jawWidth).toBeGreaterThan(0.7);
        expect(k.jawWidth).toBeLessThan(1.5);
      }
    }
  });
});

describe("races", () => {
  it("every race produces in-range sliders", () => {
    for (const race of RACES) inRange(applyRace(defaultParams(), race));
  });

  it("gives elves long ears and a narrower skull than dwarves", () => {
    const elf = derive(applyRace(defaultParams(), "elf"));
    const dwarf = derive(applyRace(defaultParams(), "dwarf"));
    expect(elf.earSize).toBe(1);
    expect(dwarf.headWidth).toBeGreaterThan(elf.headWidth);
    expect(dwarf.shoulders).toBeGreaterThan(elf.shoulders);
  });

  it("gives dragonborn a snout and scales, and no ears", () => {
    const dragonborn = derive(applyRace(defaultParams(), "dragonborn"));
    expect(dragonborn.snout).toBeGreaterThan(0.5);
    expect(dragonborn.scales).toBeGreaterThan(0.5);
    expect(dragonborn.earSize).toBe(0);
  });

  it("starts each race with its own fantasy features, and resets them on switching", () => {
    const orc = applyRace(defaultParams(), "half-orc");
    expect(derive(orc).tusks).toBeGreaterThan(0);
    // Tusks belong to half-orcs: any other race gets none, whatever the slider says
    expect(derive(applyRace({ ...orc, tusks: 1 }, "elf")).tusks).toBe(0);
    expect(applyRace(defaultParams(), "tiefling").hornStyle).not.toBe("none");
    expect(applyRace(defaultParams(), "human").hornStyle).toBe("none");
  });

  it("keeps build, cloth, eyes and eye style across a race change", () => {
    const current = { ...defaultParams(), body: "feminine" as const, cloth: "#123456", eyes: "#abcdef", eyeStyle: "glow" as const };
    const next = applyRace(current, "tiefling");
    expect(next.body).toBe("feminine");
    expect(next.cloth).toBe("#123456");
    expect(next.eyes).toBe("#abcdef");
    expect(next.eyeStyle).toBe("glow");
  });
});

describe("presets", () => {
  it("every preset produces in-range sliders", () => {
    for (const preset of PRESETS) inRange(applyPreset(defaultParams(), preset));
  });

  it("applies the preset's race, eye style and colours", () => {
    const ghoul = PRESETS.find((p) => p.name === "Ghoul")!;
    const result = applyPreset(defaultParams(), ghoul);
    expect(result.skin).toBe(ghoul.skin);
    expect(result.eyeStyle).toBe("glow");
    expect(applyPreset(defaultParams(), PRESETS.find((p) => p.name === "Warlord")!).race).toBe("half-orc");
  });
});
