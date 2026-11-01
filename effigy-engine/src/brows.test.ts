import { describe, expect, it } from "vitest";
import { browShape, browWeight } from "./brows";

describe("eyebrow shape", () => {
  // Points along the brow, out from the middle of the face: its head, the peak of its arch, its tail
  const head = 0.06;
  const peak = 0.21;
  const tail = 0.32;

  it("arches: the peak sits above both the head and the tail, and the tail dips lowest", () => {
    for (const m of [0, 1]) {
      const at = (ax: number) => browShape(ax, m, 0.5).centre;
      expect(at(peak)).toBeGreaterThan(at(head));
      expect(at(peak)).toBeGreaterThan(at(tail));
      expect(at(tail)).toBeLessThan(at(head));
    }
  });

  it("tapers: the tail is much thinner than the head, and bushier brows are thicker", () => {
    expect(browShape(tail, 1, 0.5).half).toBeLessThan(browShape(head, 1, 0.5).half * 0.6);
    expect(browShape(head, 1, 1).half).toBeGreaterThan(browShape(head, 1, 0.2).half);
  });

  it("gives feminine brows a higher arch and a finer line than masculine ones", () => {
    const rise = (m: number) => browShape(peak, m, 0.5).centre - browShape(head, m, 0.5).centre;
    expect(rise(0)).toBeGreaterThan(rise(1));
    expect(browShape(head, 0, 0.5).half).toBeLessThan(browShape(head, 1, 0.5).half);
  });

  it("covers the brow and nothing else: not the middle of the forehead, the eye, or the temple", () => {
    const at = (x: number, y: number) => browWeight(x, y, 0.1, 1, 0.5);
    expect(at(peak, browShape(peak, 1, 0.5).centre)).toBeGreaterThan(0.9);
    expect(at(0, 0.1)).toBe(0);
    expect(at(0.16, 0)).toBe(0);
    expect(at(0.45, 0.05)).toBe(0);
  });
});
