import { describe, expect, it } from "vitest";
import { exportFileName, slugify, toJsonText } from "./exportCommon";

describe("slugify", () => {
  it.each([
    ["Stormhide Drake", "stormhide-drake"],
    ["  Crypt   Ambush!  ", "crypt-ambush"],
    ["Brinewrack Cutthroat", "brinewrack-cutthroat"],
    ["Café Épée", "cafe-epee"],
    ["a/b\\c:d", "a-b-c-d"],
    ["--Leading and trailing--", "leading-and-trailing"],
  ])("%s becomes %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("returns the fallback when nothing is left", () => {
    expect(slugify("!!!", "unnamed")).toBe("unnamed");
    expect(slugify("")).toBe("");
    expect(slugify("日本語", "x")).toBe("x");
  });

  it("cuts to 60 characters without leaving a trailing dash", () => {
    const slug = slugify(`${"a".repeat(59)} ${"b".repeat(30)}`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("only ever produces letters, digits and dashes", () => {
    expect(slugify("Weird <name> \u0000 with \"quotes\" & 😀 symbols")).toMatch(/^[a-z0-9-]*$/);
  });
});

describe("toJsonText", () => {
  it("indents by two spaces and ends with a newline", () => {
    expect(toJsonText({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}\n');
  });

  it("round-trips", () => {
    const value = { name: "x", list: [1, 2, { deep: true }], nothing: null };
    expect(JSON.parse(toJsonText(value))).toEqual(value);
  });
});

describe("exportFileName", () => {
  it("joins the prefix and the slugged name", () => {
    expect(exportFileName("monster", "Stormhide Drake")).toBe("monster-stormhide-drake.json");
    expect(exportFileName("encounter", "Goblin Ambush")).toBe("encounter-goblin-ambush.json");
  });

  it("uses just the prefix when the name has nothing to slug", () => {
    expect(exportFileName("encounter", "")).toBe("encounter.json");
    expect(exportFileName("encounter", "???")).toBe("encounter.json");
  });
});
