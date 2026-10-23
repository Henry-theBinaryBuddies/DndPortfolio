import { describe, expect, it } from "vitest";
import { abilityModifier, averageDice, formatDamageRoll, formatSigned, parseDice } from "./dice";

describe("abilityModifier", () => {
  it.each([
    [1, -5],
    [8, -1],
    [9, -1],
    [10, 0],
    [11, 0],
    [12, 1],
    [16, 3],
    [19, 4],
    [20, 5],
    [30, 10],
  ])("score %i gives modifier %i", (score, modifier) => {
    expect(abilityModifier(score)).toBe(modifier);
  });
});

describe("formatSigned", () => {
  it("adds a plus sign to zero and positive numbers", () => {
    expect(formatSigned(4)).toBe("+4");
    expect(formatSigned(0)).toBe("+0");
  });

  it("keeps the minus sign on negative numbers", () => {
    expect(formatSigned(-2)).toBe("-2");
  });
});

describe("parseDice", () => {
  it("parses a plain expression", () => {
    expect(parseDice("2d6")).toEqual({ count: 2, sides: 6, bonus: 0 });
  });

  it("parses a bonus or penalty, with or without spaces", () => {
    expect(parseDice("4d8+8")).toEqual({ count: 4, sides: 8, bonus: 8 });
    expect(parseDice("1d6 - 1")).toEqual({ count: 1, sides: 6, bonus: -1 });
  });

  it("throws on junk input", () => {
    expect(() => parseDice("banana")).toThrow();
    expect(() => parseDice("d6")).toThrow();
  });
});

describe("averageDice", () => {
  it("averages and rounds down", () => {
    expect(averageDice("1d4", 3)).toBe(5); // 2.5 + 3 = 5.5
    expect(averageDice("2d6", 2)).toBe(9); // 7 + 2
    expect(averageDice("1d8")).toBe(4); // 4.5
  });

  it("includes a bonus written inside the expression", () => {
    expect(averageDice("10d10+30")).toBe(85);
  });
});

describe("formatDamageRoll", () => {
  it("shows the bonus when there is one", () => {
    expect(formatDamageRoll("2d6", 2)).toBe("9 (2d6 + 2)");
  });

  it("omits a zero bonus", () => {
    expect(formatDamageRoll("1d6", 0)).toBe("3 (1d6)");
  });

  it("shows a negative bonus as a subtraction", () => {
    expect(formatDamageRoll("1d6", -1)).toBe("2 (1d6 - 1)");
  });
});
