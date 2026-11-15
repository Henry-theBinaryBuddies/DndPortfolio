import { describe, expect, it } from "vitest";
import { parseDice, rollDice } from "./dice";

/** A stand-in for Math.random that makes each die show the given faces, in order. */
function faces(sides: number, ...values: number[]) {
  let i = 0;
  return () => (values[i++] - 1 + 0.5) / sides;
}

describe("dice", () => {
  it("reads common notation", () => {
    expect(parseDice("4d6kh3")).toEqual([{ kind: "dice", sign: 1, count: 4, sides: 6, keep: { which: "highest", n: 3 } }]);
    expect(parseDice("d8")).toEqual([{ kind: "dice", sign: 1, count: 1, sides: 8 }]);
    expect(parseDice("2d10 + 3")).toEqual([
      { kind: "dice", sign: 1, count: 2, sides: 10 },
      { kind: "constant", sign: 1, value: 3 },
    ]);
    expect(parseDice("1d8-1")[1]).toEqual({ kind: "constant", sign: -1, value: 1 });
  });

  it("refuses what it cannot read", () => {
    for (const bad of ["", "abc", "4d", "4d6kh5", "0d6", "1d1", "1d6 2", "101d6"]) {
      expect(() => parseDice(bad), bad).toThrow();
    }
  });

  it("keeps the highest dice, and logs every die", () => {
    const result = rollDice("4d6kh3", faces(6, 2, 6, 1, 5));
    expect(result).toEqual({ expression: "4d6kh3", dice: [2, 6, 1, 5], kept: [2, 6, 5], total: 13 });
  });

  it("keeps the lowest dice", () => {
    expect(rollDice("3d6kl1", faces(6, 4, 2, 5)).total).toBe(2);
  });

  it("adds terms and constants", () => {
    expect(rollDice("2d10+3", faces(10, 7, 4)).total).toBe(14);
    expect(rollDice("1d8-1", faces(8, 1)).total).toBe(0);
  });

  it("multiplies the whole total (starting wealth: 5d4 × 10)", () => {
    expect(rollDice("5d4x10", faces(4, 1, 2, 3, 4, 4))).toEqual({ expression: "5d4x10", dice: [1, 2, 3, 4, 4], kept: [1, 2, 3, 4, 4], total: 140 });
    expect(parseDice("2d4×5").at(-1)).toEqual({ kind: "multiply", value: 5 });
    expect(() => parseDice("x10")).toThrow();
  });

  it("only ever rolls faces that exist", () => {
    for (let i = 0; i < 2000; i++) {
      const { dice } = rollDice("1d6");
      expect(dice[0]).toBeGreaterThanOrEqual(1);
      expect(dice[0]).toBeLessThanOrEqual(6);
    }
  });
});
