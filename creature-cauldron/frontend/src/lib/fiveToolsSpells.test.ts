import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import realFixture from "./fixtures/5etools-mm/monsters.json";
import type { Monster, Spellcasting } from "../types/monster";
import { buildFiveToolsFile } from "./fiveTools";
import { parseSpellcasting, spellTag, splitSpellList } from "./fiveToolsSpells";
import type { JsonObject } from "./foundryJson";

const monsters = sample as unknown as Monster[];
const real = (realFixture as unknown as { monster: JsonObject[] }).monster;
const realBlock = (name: string): JsonObject => (real.find((m) => m.name === name)!.spellcasting as JsonObject[])[0];
const NOW = "2026-10-19T12:00:00.000Z";

const sc = (ability: Spellcasting["ability"], text: string): Spellcasting => ({ ability, dc: 14, attack_bonus: 6, text });
const parse = (text: string, ability: Spellcasting["ability"] = "int"): JsonObject => parseSpellcasting(sc(ability, text))!;

/** Removes {@tag name} wrappers, so lists can be compared by their words alone. */
const plain = (list: unknown): string[] => (list as string[]).map((e) => e.replace(/\{@\w+ ([^}|]+)[^}]*\}/g, "$1"));

// The real Mage and Djinni from the 5etools data, rewritten in OUR wording, must come out the same.
const MAGE_TEXT =
  "The mage is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 14, +6 to hit with spell attacks). " +
  "The mage has the following wizard spells prepared: " +
  "Cantrips (at will): fire bolt, light, mage hand, prestidigitation. " +
  "1st level (4 slots): detect magic, mage armor, magic missile, shield. " +
  "2nd level (3 slots): misty step, suggestion. " +
  "3rd level (3 slots): counterspell, fireball, fly. " +
  "4th level (3 slots): greater invisibility, ice storm. " +
  "5th level (1 slot): cone of cold.";

const DJINNI_TEXT =
  "The djinni's innate spellcasting ability is Charisma (spell save DC 17, +9 to hit with spell attacks). " +
  "It can innately cast the following spells, requiring no material components: " +
  "At will: detect evil and good, detect magic, thunderwave. " +
  "3/day each: create food and water (can create wine instead of water), tongues, wind walk. " +
  "1/day each: conjure elemental (air elemental only), creation, gaseous form, invisibility, major image, plane shift.";

describe("splitSpellList and spellTag", () => {
  it("splits at commas but not inside brackets", () => {
    expect(splitSpellList("a, b (c, d), e")).toEqual(["a", "b (c, d)", "e"]);
    expect(splitSpellList("  one ,two  ")).toEqual(["one", "two"]);
    expect(splitSpellList("")).toEqual([]);
  });

  it("tags the spell and leaves a bracketed note as plain text", () => {
    expect(spellTag("fireball")).toBe("{@spell fireball}");
    expect(spellTag("create food and water (can create wine instead of water)")).toBe(
      "{@spell create food and water} (can create wine instead of water)",
    );
  });
});

describe("matches the real Mage (slot-based casting)", () => {
  const ours = parse(MAGE_TEXT, "int");
  const theirs = realBlock("Mage");

  it("has the same header, ability, name and type", () => {
    expect(ours.name).toBe(theirs.name);
    expect(ours.type).toBe(theirs.type);
    expect(ours.headerEntries).toEqual(theirs.headerEntries);
    expect(ours.ability).toBe(theirs.ability);
  });

  it("has exactly the same spells and slots at every level", () => {
    expect(ours.spells).toEqual(theirs.spells);
  });

  it("has no innate lists", () => {
    expect(ours).not.toHaveProperty("will");
    expect(ours).not.toHaveProperty("daily");
  });
});

describe("matches the real Djinni (innate casting)", () => {
  const ours = parse(DJINNI_TEXT, "cha");
  const theirs = realBlock("Djinni");

  it("has the same header, ability, name and type", () => {
    expect(ours.name).toBe("Innate Spellcasting");
    expect(ours.name).toBe(theirs.name);
    expect(ours.headerEntries).toEqual(theirs.headerEntries);
    expect(ours.ability).toBe(theirs.ability);
  });

  it("has the same at-will list, exactly", () => {
    expect(ours.will).toEqual(theirs.will);
  });

  it("has the same per-day lists, comparing the words (the real file also tags creatures inside notes)", () => {
    const daily = ours.daily as JsonObject;
    const realDaily = theirs.daily as JsonObject;
    expect(Object.keys(daily).sort()).toEqual(Object.keys(realDaily).sort());
    expect(plain(daily["3e"])).toEqual(plain(realDaily["3e"]));
    expect(plain(daily["1e"])).toEqual(plain(realDaily["1e"]));
  });

  it("tags every spell and keeps the bracketed note outside the tag", () => {
    expect((ours.daily as JsonObject)["3e"]).toContain("{@spell create food and water} (can create wine instead of water)");
    expect(ours).not.toHaveProperty("spells");
  });
});

describe("our own spellcasters", () => {
  const block = (name: string): JsonObject => {
    const monster = monsters.find((m) => m.name === name)!;
    return parseSpellcasting(monster.spellcasting!)!;
  };

  it("Hollowvale Hexer: cantrips and two slot levels", () => {
    const b = block("Hollowvale Hexer");
    expect(b.name).toBe("Spellcasting");
    expect(b.ability).toBe("cha");
    expect(b.spells).toEqual({
      "0": { spells: ["{@spell minor illusion}", "{@spell poison spray}"] },
      "1": { slots: 4, spells: ["{@spell charm person}", "{@spell ray of sickness}"] },
      "2": { slots: 3, spells: ["{@spell hold person}", "{@spell misty step}"] },
    });
  });

  it("Brightwing Sentinel: innate, at will and once a day each", () => {
    const b = block("Brightwing Sentinel");
    expect(b.name).toBe("Innate Spellcasting");
    expect(b.will).toEqual(["{@spell light}", "{@spell thaumaturgy}"]);
    expect(b.daily).toEqual({ "1e": ["{@spell lesser restoration}", "{@spell protection from evil and good}"] });
    expect(b.ability).toBe("wis");
  });

  it("Voidbloom Seer: '1/day' without 'each' is the plain daily key", () => {
    const b = block("Voidbloom Seer");
    expect(b.name).toBe("Innate Spellcasting");
    expect(b.will).toEqual(["{@spell detect thoughts}", "{@spell mage hand}"]);
    expect(b.daily).toEqual({ "1": ["{@spell confusion}"] });
  });

  it("every sample spellcaster parses, and its header has the DC tagged", () => {
    const casters = monsters.filter((m) => m.spellcasting);
    expect(casters.length).toBeGreaterThanOrEqual(3);
    for (const m of casters) {
      const b = parseSpellcasting(m.spellcasting!);
      expect(b, m.name).not.toBeNull();
      expect(String((b!.headerEntries as string[])[0]), m.name).toContain("{@dc ");
    }
  });
});

describe("edge cases", () => {
  it("accepts a singular '1 slot' and the highest spell level", () => {
    const b = parse("Intro. 9th level (1 slot): wish. 1st level (2 slots): bless.");
    expect(b.spells).toEqual({ "9": { slots: 1, spells: ["{@spell wish}"] }, "1": { slots: 2, spells: ["{@spell bless}"] } });
  });

  it("merges a repeated heading instead of dropping the first", () => {
    const b = parse("Intro. At will: light. At will: mage hand.");
    expect(b.will).toEqual(["{@spell light}", "{@spell mage hand}"]);
  });

  it("keeps text after the last list as a footer, with tags", () => {
    const b = parse("Intro. 1st level (2 slots): shield. The caster prefers DC 15 effects.");
    expect(b.footerEntries).toEqual(["The caster prefers {@dc 15} effects."]);
  });

  it("calls it innate only when the intro says so", () => {
    expect(parse("It innately casts these. At will: light.").name).toBe("Innate Spellcasting");
    expect(parse("It casts these. Cantrips (at will): light.").name).toBe("Spellcasting");
  });

  it("returns null when no spell list is recognised, so the caller can keep the text", () => {
    expect(parseSpellcasting(sc("int", "The wizard knows many spells and casts them well."))).toBeNull();
    expect(parseSpellcasting(sc("int", ""))).toBeNull();
    expect(parseSpellcasting(sc("int", "At will light mage hand"))).toBeNull(); // no colon
    expect(parseSpellcasting(sc("int", "Cantrips: light."))).toBeNull(); // heading we do not know
  });

  it("never throws, whatever the text", () => {
    for (const text of ["", ".", ":", "At will: .", "1st level (x slots): a.", "((((", "At will: ((a, b."]) {
      expect(() => parseSpellcasting(sc("int", text)), JSON.stringify(text)).not.toThrow();
    }
  });
});

describe("in the full export", () => {
  const withText = (text: string): Monster => ({
    ...monsters.find((m) => m.name === "Hollowvale Hexer")!,
    spellcasting: sc("cha", text),
  });

  it("replaces the plain trait with the structured block", () => {
    const { file, notes } = buildFiveToolsFile([withText(MAGE_TEXT)], NOW);
    const [m] = file.monster as JsonObject[];
    expect(m.spellcasting).toHaveLength(1);
    expect(((m.trait as JsonObject[] | undefined) ?? []).some((t) => t.name === "Spellcasting")).toBe(false);
    expect(notes.some((n) => n.includes("plain trait"))).toBe(false);
  });

  it("falls back to a plain trait, with a note, when the wording is not recognised", () => {
    const { file, notes } = buildFiveToolsFile([withText("The hexer curses people. DC 13 applies.")], NOW);
    const [m] = file.monster as JsonObject[];
    expect(m).not.toHaveProperty("spellcasting");
    const trait = (m.trait as JsonObject[]).find((t) => t.name === "Spellcasting")!;
    expect(trait.entries).toEqual(["The hexer curses people. {@dc 13} applies."]);
    expect(notes.some((n) => n.includes("plain trait"))).toBe(true);
  });
});
