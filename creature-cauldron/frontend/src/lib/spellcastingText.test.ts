import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Monster, Spellcasting } from "../types/monster";
import { looksLikeMonster } from "./generatedStore";
import { casterLevel, hasSpellLists, parseSpellcastingText, spellRef, spellRefText, spellcastingToText } from "./spellcastingText";

const monsters = sample as unknown as Monster[];
const base = { ability: "int", dc: 14, attack_bonus: 6 } as const;

describe("spellRef", () => {
  it("splits a trailing note off the name", () => {
    expect(spellRef("misty step (self only)")).toEqual({ name: "misty step", note: "self only" });
    expect(spellRef("fireball")).toEqual({ name: "fireball" });
  });

  it("keeps brackets that are not a trailing note as part of the name", () => {
    expect(spellRef("odd (name) here")).toEqual({ name: "odd (name) here" });
  });

  it("writes a spell back with its note", () => {
    expect(spellRefText({ name: "misty step", note: "self only" })).toBe("misty step (self only)");
    expect(spellRefText({ name: "light" })).toBe("light");
  });
});

describe("parseSpellcastingText and spellcastingToText", () => {
  it("reads slots, cantrips, at will and per day into data", () => {
    const sc = parseSpellcastingText(
      "The mage is a 9th-level spellcaster. Cantrips (at will): light. 1st level (4 slots): shield. 5th level (1 slot): cone of cold. At will: mage hand. 3/day each: tongues. 1/day: wish.",
      base,
    );
    expect(sc.cantrips).toEqual([{ name: "light" }]);
    expect(sc.slots).toEqual([
      { level: 1, slots: 4, spells: [{ name: "shield" }] },
      { level: 5, slots: 1, spells: [{ name: "cone of cold" }] },
    ]);
    expect(sc.at_will).toEqual([{ name: "mage hand" }]);
    expect(sc.per_day).toEqual([
      { uses: 3, each: true, spells: [{ name: "tongues" }] },
      { uses: 1, each: false, spells: [{ name: "wish" }] },
    ]);
    expect(sc.intro).toBe("The mage is a 9th-level spellcaster.");
    expect(sc.innate).toBe(false);
  });

  it("round-trips every sample spellcaster to readable text with its spells in it", () => {
    for (const m of monsters.filter((x) => x.spellcasting)) {
      const text = spellcastingToText(m.spellcasting!);
      const again = parseSpellcastingText(text, m.spellcasting!);
      expect(again, m.name).toEqual(m.spellcasting);
      expect(text.startsWith(m.spellcasting!.intro), m.name).toBe(true);
    }
  });

  it("keeps unrecognised text whole in the intro, so nothing is lost", () => {
    const text = "The wizard knows many spells and casts them well.";
    const sc = parseSpellcastingText(text, base);
    expect(hasSpellLists(sc)).toBe(false);
    expect(spellcastingToText(sc)).toBe(text);
  });

  it("writes '1 slot' in the singular and keeps a footer", () => {
    const sc: Spellcasting = {
      ...base,
      innate: false,
      intro: "Intro.",
      cantrips: [],
      slots: [{ level: 9, slots: 1, spells: [{ name: "wish" }] }],
      at_will: [],
      per_day: [],
      footer: "Done.",
    };
    expect(spellcastingToText(sc)).toBe("Intro. 9th level (1 slot): wish. Done.");
  });

  it("never throws on odd text", () => {
    for (const text of ["", ".", ":", "At will: .", "1st level (x slots): a.", "((((", "At will: ((a, b."]) {
      expect(() => spellcastingToText(parseSpellcastingText(text, base)), JSON.stringify(text)).not.toThrow();
    }
  });
});

describe("casterLevel", () => {
  it("reads the level from the intro", () => {
    expect(casterLevel(parseSpellcastingText("The hexer is a 4th-level spellcaster.", base))).toBe(4);
    expect(casterLevel(parseSpellcastingText("It innately casts these. At will: light.", base))).toBeNull();
  });
});

describe("spellcasting in stored monsters", () => {
  const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(monsters.find((m) => m.name === "Hollowvale Hexer")));

  it("accepts the sample caster", () => {
    expect(looksLikeMonster(clone())).toBe(true);
  });

  it("rejects the old text-only shape and broken lists", () => {
    const old = clone();
    old.spellcasting = { ability: "cha", dc: 13, attack_bonus: 5, text: "x" };
    expect(looksLikeMonster(old)).toBe(false);

    const broken = clone();
    (broken.spellcasting as Record<string, unknown>).slots = [{ level: 1, slots: "four", spells: [] }];
    expect(looksLikeMonster(broken)).toBe(false);
  });
});
