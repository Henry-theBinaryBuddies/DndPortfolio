import { describe, expect, it } from "vitest";
import { NUMERIC_DEFS, clampParams, defaultParams, randomParams } from "./params";

// Small deterministic generator so the random tests give the same answer every run.
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("params", () => {
  it("defaults sit inside their slider ranges", () => {
    const params = defaultParams();
    for (const def of NUMERIC_DEFS) {
      expect(params[def.key]).toBeGreaterThanOrEqual(def.min);
      expect(params[def.key]).toBeLessThanOrEqual(def.max);
    }
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
    for (const def of NUMERIC_DEFS) {
      expect(a[def.key]).toBeGreaterThanOrEqual(def.min);
      expect(a[def.key]).toBeLessThanOrEqual(def.max);
    }
  });
});
