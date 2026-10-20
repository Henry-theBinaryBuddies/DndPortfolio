import { describe, expect, it } from "vitest";
import { bubbleLayout } from "./bubbles";

describe("bubbleLayout", () => {
  it("makes the number of bubbles asked for", () => {
    expect(bubbleLayout(0)).toEqual([]);
    expect(bubbleLayout(18)).toHaveLength(18);
  });

  it("keeps every bubble on screen with a sensible size and timing", () => {
    for (const b of bubbleLayout(40)) {
      expect(b.left).toBeGreaterThanOrEqual(6);
      expect(b.left).toBeLessThanOrEqual(94);
      expect(b.size).toBeGreaterThan(0.5);
      expect(b.size).toBeLessThan(3);
      expect(b.delay).toBeGreaterThanOrEqual(0);
      expect(b.delay).toBeLessThan(4);
      expect(b.duration).toBeGreaterThan(3);
    }
  });

  it("is the same every time", () => {
    expect(bubbleLayout(12)).toEqual(bubbleLayout(12));
  });

  it("spreads the bubbles rather than stacking them", () => {
    expect(new Set(bubbleLayout(18).map((b) => b.left)).size).toBeGreaterThan(12);
  });
});
