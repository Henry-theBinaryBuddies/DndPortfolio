import { describe, expect, it } from "vitest";
import { DEFAULT_PARTY } from "./party";
import { parseParty } from "./storage";

describe("parseParty", () => {
  it("accepts a valid party", () => {
    expect(parseParty({ levels: [2, 4, 4, 5] })).toEqual({ levels: [2, 4, 4, 5] });
  });

  it("clamps levels to 1-20 and rounds fractions", () => {
    expect(parseParty({ levels: [0, 99, 3.6, -5] })).toEqual({ levels: [1, 20, 4, 1] });
  });

  it("caps the party at 10 members", () => {
    const result = parseParty({ levels: Array(15).fill(5) });
    expect(result.levels).toHaveLength(10);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "hello"],
    ["a number", 4],
    ["an empty object", {}],
    ["levels that isn't an array", { levels: "5,5,5" }],
    ["an empty party", { levels: [] }],
    ["non-numeric levels", { levels: [3, "four", 5] }],
    ["NaN or Infinity", { levels: [3, Number.NaN, Infinity] }],
  ])("falls back to the default party for %s", (_label, value) => {
    expect(parseParty(value)).toEqual(DEFAULT_PARTY);
  });
});
