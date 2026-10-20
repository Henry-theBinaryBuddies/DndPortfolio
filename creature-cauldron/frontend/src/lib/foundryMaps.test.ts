import { describe, expect, it } from "vitest";
import { escapeHtml, stableId, uniqueSlug } from "./exportCommon";
import {
  SIZE_KEYS,
  STATS_STAMP,
  FOUNDRY_TARGET,
  TOKEN_SIZES,
  SKILLS,
  areaTemplate,
  atModBonus,
  foundryProficiency,
  isStrictFormula,
  normalizeHpFormula,
  parseConditions,
  parseLanguages,
  skillFor,
  splitBonus,
} from "./foundryMaps";
import { FOUNDRY_ID } from "./testing/foundryChecks";
import { SIZES } from "./options";
import { abilityModifier } from "./dice";

describe("escapeHtml, uniqueSlug, stableId", () => {
  it("escapes the characters that matter in HTML", () => {
    expect(escapeHtml(`<script>alert("x") & 'y'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;",
    );
    expect(escapeHtml("plain text")).toBe("plain text");
  });

  it("makes slugs unique with -2, -3", () => {
    const used = new Set<string>();
    expect(uniqueSlug("Mind Lash", used)).toBe("mind-lash");
    expect(uniqueSlug("Mind Lash", used)).toBe("mind-lash-2");
    expect(uniqueSlug("Mind Lash!", used)).toBe("mind-lash-3");
    expect(uniqueSlug("???", used)).toBe("item");
  });

  it("makes the same 16-character id from the same seed, and different ones from different seeds", () => {
    expect(stableId("a")).toBe(stableId("a"));
    expect(stableId("a")).toMatch(FOUNDRY_ID);
    const ids = new Set(Array.from({ length: 2000 }, (_, i) => stableId(`seed-${i}`)));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(FOUNDRY_ID);
  });
});

describe("tables", () => {
  it("covers every size", () => {
    for (const size of SIZES) {
      expect(SIZE_KEYS[size]).toBeTruthy();
      expect(TOKEN_SIZES[size]).toBeGreaterThan(0);
    }
    expect(SIZE_KEYS.small).toBe("sm");
    expect(SIZE_KEYS.gargantuan).toBe("grg");
  });

  it("lists Foundry's 18 skills with unique ids", () => {
    expect(SKILLS).toHaveLength(18);
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(18);
    expect(skillFor("sleight of hand")?.id).toBe("slt");
    expect(skillFor(" Perception ")?.ability).toBe("wis");
    expect(skillFor("Basket Weaving")).toBeUndefined();
  });

  it("states the target version in one place", () => {
    expect(FOUNDRY_TARGET.systemVersion).toBe("5.3.3");
    expect(STATS_STAMP.systemVersion).toBe(FOUNDRY_TARGET.systemVersion);
    // Items written for a system older than 4.0.1 get re-converted by Foundry's activities migration.
    const [major, minor, patch] = STATS_STAMP.systemVersion.split(".").map(Number);
    expect(major * 10000 + minor * 100 + patch).toBeGreaterThanOrEqual(40001);
  });
});

describe("foundryProficiency", () => {
  it.each([
    [0, 2],
    [0.125, 2],
    [1, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [12, 4],
    [13, 5],
    [16, 5],
    [17, 6],
    [20, 6],
    [21, 7],
    [30, 9],
  ])("CR %s gives +%i", (cr, expected) => {
    expect(foundryProficiency(cr)).toBe(expected);
  });
});

describe("splitBonus", () => {
  it("finds the proficiency multiplier and the flat remainder, so the total always adds up", () => {
    for (const pb of [2, 3, 4, 5, 6]) {
      for (const mod of [-3, 0, 2, 5]) {
        for (let total = -5; total <= 25; total++) {
          for (const max of [1, 2] as const) {
            const { multiplier, flat } = splitBonus(total, mod, pb, max);
            expect(multiplier).toBeGreaterThanOrEqual(0);
            expect(multiplier).toBeLessThanOrEqual(max);
            expect(mod + multiplier * pb + flat, `${total} ${mod} ${pb} ${max}`).toBe(total);
          }
        }
      }
    }
  });

  it("gives the usual proficient and expert cases", () => {
    expect(splitBonus(13, 1, 6, 2)).toEqual({ multiplier: 2, flat: 0 }); // expert Perception, Wis +1, PB 6
    expect(splitBonus(7, 1, 6, 1)).toEqual({ multiplier: 1, flat: 0 }); // proficient save
    expect(splitBonus(4, 2, 2, 1)).toEqual({ multiplier: 1, flat: 0 });
    expect(splitBonus(2, 2, 2, 1)).toEqual({ multiplier: 0, flat: 0 }); // not proficient
  });

  it("puts anything odd in the flat bonus", () => {
    expect(splitBonus(5, 2, 2, 1)).toEqual({ multiplier: 1, flat: 1 });
    expect(splitBonus(0, 2, 2, 1)).toEqual({ multiplier: 0, flat: -2 });
  });

  it("agrees with the ability modifier table", () => {
    expect(abilityModifier(27)).toBe(8);
  });
});

describe("parseLanguages and parseConditions", () => {
  it("turns known languages into keys", () => {
    expect(parseLanguages("Common, Sylvan")).toEqual({ value: ["common", "sylvan"], custom: "" });
    expect(parseLanguages("Draconic")).toEqual({ value: ["draconic"], custom: "" });
    expect(parseLanguages("Celestial, Common")).toEqual({ value: ["celestial", "common"], custom: "" });
    expect(parseLanguages("Ignan")).toEqual({ value: ["ignan"], custom: "" });
  });

  it("keeps anything it does not know as text", () => {
    expect(parseLanguages("Deep Speech, telepathy 120 ft.")).toEqual({ value: ["deep"], custom: "telepathy 120 ft." });
    expect(parseLanguages("understands the language of its maker but can't speak")).toEqual({
      value: [],
      custom: "understands the language of its maker but can't speak",
    });
  });

  it("treats a dash or nothing as no languages", () => {
    expect(parseLanguages("—")).toEqual({ value: [], custom: "" });
    expect(parseLanguages("-")).toEqual({ value: [], custom: "" });
    expect(parseLanguages("  ")).toEqual({ value: [], custom: "" });
  });

  it("splits known conditions from other text", () => {
    expect(parseConditions(["blinded", "Charmed", "exhaustion"])).toEqual({
      value: ["blinded", "charmed", "exhaustion"],
      custom: "",
    });
    expect(parseConditions(["poisoned", "turned to stone"])).toEqual({ value: ["poisoned"], custom: "turned to stone" });
    expect(parseConditions([])).toEqual({ value: [], custom: "" });
  });
});

describe("formulas", () => {
  it.each([
    ["2d6", true],
    ["2d6 + 3", true],
    ["19d12 + 133", true],
    ["5", true],
    ["@mod", false],
    ["2d6; drop table", false],
    ["", false],
    ["2d", false],
    ["1d4 * 2", false],
  ])("isStrictFormula(%j) is %s", (text, expected) => {
    expect(isStrictFormula(text)).toBe(expected);
  });

  it("writes hit point formulas with Foundry's spacing, or blank when unreadable", () => {
    expect(normalizeHpFormula("4d8+8")).toBe("4d8 + 8");
    expect(normalizeHpFormula("2d6")).toBe("2d6");
    expect(normalizeHpFormula("6d10 - 2")).toBe("6d10 - 2");
    expect(normalizeHpFormula("banana")).toBe("");
    expect(normalizeHpFormula("")).toBe("");
  });

  it("builds the base damage bonus around @mod", () => {
    expect(atModBonus(3, 3)).toBe("@mod");
    expect(atModBonus(5, 3)).toBe("@mod + 2");
    expect(atModBonus(1, 3)).toBe("@mod - 2");
    expect(atModBonus(0, 0)).toBe("@mod");
  });
});

describe("areaTemplate", () => {
  it("maps our shapes to Foundry's template types", () => {
    expect(areaTemplate({ shape: "cone", size: 15 })).toEqual({ type: "cone", size: "15", width: "", units: "ft" });
    expect(areaTemplate({ shape: "line", size: 30, width: 5 })).toEqual({ type: "line", size: "30", width: "5", units: "ft" });
    expect(areaTemplate({ shape: "radius", size: 10 }).type).toBe("circle");
    expect(areaTemplate({ shape: "sphere", size: 20 }).type).toBe("sphere");
    expect(areaTemplate({ shape: "cube", size: 15 }).type).toBe("cube");
  });
});
