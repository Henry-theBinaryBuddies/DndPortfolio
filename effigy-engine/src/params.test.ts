import { describe, expect, it } from "vitest";
import { NUMERIC_DEFS, RACES, applyRace, clampParams, defaultParams, derive, randomParams, switchRace } from "./params";

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
    expect(fixed.weight).toBe(0.15); // the Weight slider's lower bound
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

  it("defines the muscles with the Muscle slider rather than enlarging the bust, and fat softens them", () => {
    const slight = derive({ ...defaultParams(), muscle: 0 });
    const strong = derive({ ...defaultParams(), muscle: 1 });
    expect(strong.definition).toBeGreaterThan(slight.definition + 0.6);
    expect(strong.shoulders / slight.shoulders).toBeLessThan(1.05);
    expect(strong.neckGirth / slight.neckGirth).toBeLessThan(1.1);
    expect(derive({ ...defaultParams(), muscle: 1, weight: 1 }).definition).toBeLessThan(strong.definition);
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

  it("keeps every edit when switching race, and changes only the race's anatomy", () => {
    const edited = { ...defaultParams(), weight: 0.85, muscle: 0.9, lips: 0.25, lids: 0.1, hairStyle: "none" as const };
    const orc = switchRace(edited, "half-orc");
    expect({ ...orc, race: "human" }).toEqual(edited);
    expect(orc.race).toBe("half-orc");
    expect(derive(orc).tusks).toBeGreaterThan(0);
    expect(derive(orc).jawWidth).toBeGreaterThan(derive(edited).jawWidth);
  });

  it("starts each race with its own fantasy features, and resets them on switching", () => {
    const orc = applyRace(defaultParams(), "half-orc");
    expect(derive(orc).tusks).toBeGreaterThan(0);
    // Tusks belong to half-orcs: any other race gets none, whatever the slider says
    expect(derive(applyRace({ ...orc, tusks: 1 }, "elf")).tusks).toBe(0);
    expect(applyRace(defaultParams(), "tiefling").hornStyle).not.toBe("none");
    expect(applyRace(defaultParams(), "human").hornStyle).toBe("none");
  });

  it("keeps the build across a race change", () => {
    const next = applyRace({ ...defaultParams(), body: "feminine" as const }, "tiefling");
    expect(next.body).toBe("feminine");
  });
});
