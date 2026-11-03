import { describe, expect, it } from "vitest";
import { printBounds } from "./bounds";
import type { Part } from "./printable";

describe("how far the print reaches", () => {
  it("counts where a triangle crossing the flat cut is trimmed, not only the vertices above it", () => {
    // one triangle hanging down past a cut at z = 1: its corner out at x = 20 is below the cut, and its edge to
    // (0, 0, 2) crosses the cut at x = 10, farther out than any corner above it
    const lock: Part = { name: "hair", positions: new Float32Array([20, 0, 0, 0, 0, 2, 0, 1, 2]), indices: new Uint32Array([0, 1, 2]) };
    const { min, max } = printBounds([lock], 1);
    expect(max[0]).toBeCloseTo(10, 6);
    expect(min[0]).toBeCloseTo(0, 6);
    expect(min[2]).toBeCloseTo(1, 6);
    expect(max[2]).toBeCloseTo(2, 6);
  });

  it("takes the base whole, below the cut as well, unless it is left out", () => {
    const base: Part = { name: "base", positions: new Float32Array([-5, -5, -10, 5, -5, -10, 0, 5, 0.5]), indices: new Uint32Array([0, 1, 2]) };
    const head: Part = { name: "head", positions: new Float32Array([-1, 0, 0, 1, 0, 0, 0, 0, 3]), indices: new Uint32Array([0, 1, 2]) };
    expect(printBounds([base, head], 0).min[2]).toBe(-10);
    const bust = printBounds([base, head], 0, false);
    expect(bust.min[0]).toBe(-1);
    expect(bust.max[2]).toBe(3);
  });
});
