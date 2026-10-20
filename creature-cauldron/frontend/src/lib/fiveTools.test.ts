import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import realFixture from "./fixtures/5etools-mm/monsters.json";
import type { Monster } from "../types/monster";
import { FIVETOOLS_SOURCE, alignmentLetters, buildFiveToolsFile, tagProse } from "./fiveTools";
import type { JsonObject } from "./foundryJson";
import { SKILLS } from "./foundryMaps";
import { findUndefined, keyPaths } from "./testing/foundryChecks";
import { goblin, hillGiant, redDragon } from "./testing/srdMonsters";

const monsters = sample as unknown as Monster[];
const NOW = "2026-10-19T12:00:00.000Z";
const real = (realFixture as unknown as { monster: JsonObject[] }).monster;
const realNamed = (name: string): JsonObject => real.find((m) => m.name === name)!;
const byName = (name: string): Monster => monsters.find((m) => m.name === name)!;

/** One monster through the builder, as the loosely typed object. */
const convert = (monster: Monster): JsonObject => (buildFiveToolsFile([monster], NOW).file.monster as JsonObject[])[0];
const entriesOf = (list: unknown, name: string): unknown =>
  (list as JsonObject[]).find((a) => a.name === name)?.entries;

describe("tagProse", () => {
  it("tags DCs, to-hit bonuses and dice in parentheses", () => {
    expect(tagProse("must make a DC 13 Wisdom saving throw, taking 10 (3d6) necrotic damage")).toBe(
      "must make a {@dc 13} Wisdom saving throw, taking 10 ({@damage 3d6}) necrotic damage",
    );
    expect(tagProse("+5 to hit with spell attacks")).toBe("{@hit 5} to hit with spell attacks");
    expect(tagProse("-1 to hit")).toBe("{@hit -1} to hit");
    expect(tagProse("takes 9 (2d6 + 2) damage")).toBe("takes 9 ({@damage 2d6 + 2}) damage");
  });

  it("leaves other text alone", () => {
    expect(tagProse("The goblin can take the Disengage or Hide action.")).toBe(
      "The goblin can take the Disengage or Hide action.",
    );
    expect(tagProse("It has 25 (hit points) and DCs vary.")).toBe("It has 25 (hit points) and DCs vary.");
  });
});

describe("alignmentLetters", () => {
  it.each([
    ["chaotic evil", ["C", "E"]],
    ["Neutral Good", ["N", "G"]],
    ["lawful neutral", ["L", "N"]],
    ["neutral", ["N"]],
    ["unaligned", ["U"]],
    ["any alignment", ["A"]],
    ["lawful good", ["L", "G"]],
  ])("%s", (text, expected) => {
    expect(alignmentLetters(text)).toEqual(expected);
  });

  it("keeps text it cannot read word for word", () => {
    expect(alignmentLetters("any non-lawful alignment")).toEqual([{ special: "any non-lawful alignment" }]);
    expect(alignmentLetters("typically evil")).toEqual([{ special: "typically evil" }]);
  });
});

describe("the file wrapper", () => {
  const { file } = buildFiveToolsFile([goblin], NOW);

  it("declares a unique homebrew source and the 2014 rules, as importers require", () => {
    const meta = file._meta as JsonObject;
    expect(meta.edition).toBe("classic");
    expect(meta.sources).toEqual([
      { json: "CreatureCauldronHB", abbreviation: "CCHB", full: "Creature Cauldron Homebrew", version: "1.0.0", authors: ["The Binary Buddies"] },
    ]);
    expect(meta.dateAdded).toBe(Math.floor(Date.parse(NOW) / 1000));
    expect(meta.dateLastModified).toBe(meta.dateAdded);
  });

  it("follows the source id rules from the schema", () => {
    const id = FIVETOOLS_SOURCE.json;
    expect(id.length).toBeGreaterThanOrEqual(6);
    expect(id).toMatch(/^[-a-zA-Z0-9&+!][-a-zA-Z0-9&+! ]*[-a-zA-Z0-9&+!]$/);
    expect(id.startsWith("UA") || id.startsWith("XUA")).toBe(false);
  });

  it("gives every monster that source", () => {
    const all = buildFiveToolsFile(monsters, NOW).file.monster as JsonObject[];
    expect(all).toHaveLength(monsters.length);
    for (const m of all) expect(m.source).toBe("CreatureCauldronHB");
  });

  it("handles a bad time without throwing", () => {
    expect(((buildFiveToolsFile([goblin], "not a date").file._meta as JsonObject).dateAdded)).toBe(0);
  });

  it("keeps only the first monster of a repeated name", () => {
    const { file: f, notes } = buildFiveToolsFile([goblin, { ...goblin, id: "other" }], NOW);
    expect(f.monster as JsonObject[]).toHaveLength(1);
    expect(notes.some((n) => n.includes("Goblin"))).toBe(true);
  });

  it("is a pure function of its input", () => {
    expect(buildFiveToolsFile(monsters, NOW)).toEqual(buildFiveToolsFile(monsters, NOW));
  });
});

describe("the shape matches real SRD monsters in the 5etools data", () => {
  const REAL_PATHS = new Set<string>();
  for (const m of real) keyPaths(m, "monster[]", REAL_PATHS);
  const EXTRA = new Set([
    // Fields the schema allows that the four real examples happen not to use.
    "monster[].vulnerable",
    "monster[].resist",
    "monster[].conditionImmune",
    "monster[].bonus",
    "monster[].bonus[]",
    "monster[].bonus[].name",
    "monster[].bonus[].entries",
    "monster[].reaction",
    "monster[].reaction[]",
    "monster[].reaction[].name",
    "monster[].reaction[].entries",
    "monster[].legendaryActions",
    // keyPaths() reads any 16-letter key as an id and writes it as "*"; "legendaryActions" is exactly 16 letters.
    "monster[].*",
    "monster[].hp.special",
    "monster[].alignment[]",
    "monster[].alignment[].special",
    "monster[].type.tags",
    "monster[].speed.canHover",
    "monster[].speed.fly.number",
    "monster[].speed.fly.condition",
    "monster[].speed.fly",
    "monster[].speed.swim",
    "monster[].speed.burrow",
    "monster[].speed.climb",
    // Spellcasting blocks: the Mage and Djinni show the common fields; the rest are in the schema.
    "monster[].spellcasting[].footerEntries",
    ...["6", "7", "8", "9"].flatMap((level) => [
      `monster[].spellcasting[].spells.${level}`,
      `monster[].spellcasting[].spells.${level}.slots`,
      `monster[].spellcasting[].spells.${level}.spells`,
    ]),
    ...["1", "2", "3", "2e"].map((key) => `monster[].spellcasting[].daily.${key}`),
    // All eighteen skills, lower case, as 5etools spells them.
    ...SKILLS.map((skill) => `monster[].skill.${skill.name.toLowerCase()}`),
  ]);

  it("only writes fields that exist in real 5etools data or in the schema's own list", () => {
    for (const monster of monsters) {
      const [converted] = (buildFiveToolsFile([monster], NOW).file.monster as JsonObject[]).map((m) => keyPaths(m, "monster[]"));
      const unknown = [...converted].filter((p) => !REAL_PATHS.has(p) && !EXTRA.has(p));
      expect(unknown, monster.name).toEqual([]);
    }
  });

  it("writes only the top-level keys a homebrew file needs", () => {
    expect(Object.keys(buildFiveToolsFile([goblin], NOW).file).sort()).toEqual(["_meta", "monster"]);
  });
});

describe("our SRD monsters reproduce the real 5etools entries", () => {
  it("goblin: core fields", () => {
    const ours = convert(goblin);
    const theirs = realNamed("Goblin");
    for (const key of ["size", "type", "alignment", "hp", "speed", "str", "dex", "con", "int", "wis", "cha", "skill", "senses", "passive", "languages", "cr", "environment"]) {
      expect(ours[key], key).toEqual(theirs[key]);
    }
  });

  it("goblin: attacks read exactly like the real ones", () => {
    const ours = convert(goblin);
    const theirs = realNamed("Goblin");
    expect(entriesOf(ours.action, "Scimitar")).toEqual(entriesOf(theirs.action, "Scimitar"));
    expect(entriesOf(ours.action, "Shortbow")).toEqual(entriesOf(theirs.action, "Shortbow"));
  });

  it("goblin: keeps the trait name", () => {
    expect((convert(goblin).trait as JsonObject[])[0].name).toBe("Nimble Escape");
  });

  it("hill giant: core fields, multiattack, and both attacks", () => {
    const ours = convert(hillGiant);
    const theirs = realNamed("Hill Giant");
    for (const key of ["size", "type", "alignment", "ac", "hp", "speed", "str", "dex", "con", "int", "wis", "cha", "skill", "passive", "languages", "cr", "environment"]) {
      expect(ours[key], key).toEqual(theirs[key]);
    }
    // The book says "The giant makes ..."; we write the full name ("The hill giant makes ..."), as the stat block does.
    expect(String((entriesOf(ours.action, "Multiattack") as string[])[0])).toMatch(/makes two greatclub attacks.$/);
    expect(entriesOf(ours.action, "Greatclub")).toEqual(entriesOf(theirs.action, "Greatclub"));
    expect(entriesOf(ours.action, "Rock")).toEqual(entriesOf(theirs.action, "Rock"));
  });

  it("dragon: core fields, saves, skills, senses and immunities", () => {
    const ours = convert(redDragon);
    const theirs = realNamed("Adult Red Dragon");
    for (const key of ["size", "type", "alignment", "ac", "hp", "speed", "str", "dex", "con", "int", "wis", "cha", "save", "skill", "senses", "passive", "immune", "languages", "cr", "environment"]) {
      expect(ours[key], key).toEqual(theirs[key]);
    }
  });

  it("dragon: attacks, the recharging breath, and the legendary action names", () => {
    const ours = convert(redDragon);
    const theirs = realNamed("Adult Red Dragon");
    for (const name of ["Bite", "Claw", "Tail"]) expect(entriesOf(ours.action, name), name).toEqual(entriesOf(theirs.action, name));
    const breath = (ours.action as JsonObject[]).find((a) => String(a.name).startsWith("Fire Breath"))!;
    expect(breath.name).toBe("Fire Breath {@recharge 5}");
    // The real entry opens with a sentence of its own; ours starts at "Each creature".
    const realBreath = (theirs.action as JsonObject[]).find((a) => String(a.name).startsWith("Fire Breath"))!;
    const tail = (e: unknown) => String((e as string[])[0]).slice(String((e as string[])[0]).indexOf("must make"));
    expect(tail(breath.entries)).toBe(tail(realBreath.entries));
    expect((ours.legendary as JsonObject[]).map((l) => l.name)).toEqual((theirs.legendary as JsonObject[]).map((l) => l.name));
    expect(ours.legendaryActions).toBe(3);
  });
});

describe("conversions", () => {
  it("writes a recharge of 6 as a bare tag", () => {
    const m: Monster = { ...goblin, actions: [{ kind: "text", name: "Spit", text: "It spits.", recharge: { min: 6 } }] };
    expect((convert(m).action as JsonObject[])[0].name).toBe("Spit {@recharge}");
  });

  it("writes hover as the fly object plus canHover", () => {
    const sprite = convert(byName("Dustmote Sprite"));
    expect(sprite.speed).toEqual({ walk: 10, fly: { number: 40, condition: "(hover)" }, canHover: true });
  });

  it("omits fields that would be empty, because the schema forbids empty lists", () => {
    const out = convert(byName("Cinderkite"));
    for (const key of ["resist", "immune", "vulnerable", "conditionImmune", "save", "bonus", "reaction", "legendary", "spellcasting"]) {
      expect(out, key).not.toHaveProperty(key);
    }
    expect(out).not.toHaveProperty("languages"); // Cinderkite has none
  });

  it("converts sizes and tags", () => {
    expect(convert(byName("Dune Leviathan")).size).toEqual(["G"]);
    expect(convert(byName("Dustmote Sprite")).size).toEqual(["T"]);
    expect(convert(byName("Brinewrack Cutthroat")).type).toEqual({ type: "humanoid", tags: ["any race"] });
  });

  it("writes legendary costs in the name and the per-round count", () => {
    const seer = convert(byName("Voidbloom Seer"));
    expect((seer.legendary as JsonObject[]).map((l) => l.name)).toEqual(["Mind Lash", "Drift", "Unsettling Gaze (Costs 2 Actions)"]);
    expect(seer.legendaryActions).toBe(3);
  });

  it("tags a save's DC and damage", () => {
    const stalker = convert(byName("Gravewick Stalker"));
    const glare = (stalker.action as JsonObject[]).find((a) => String(a.name).startsWith("Lantern Glare"))!;
    expect(glare.name).toBe("Lantern Glare {@recharge 5}");
    expect(String((glare.entries as string[])[0])).toContain("{@dc 11} Wisdom saving throw, taking 10 ({@damage 3d6}) necrotic damage");
  });

  it("turns spellcasting into structured spell lists instead of a plain trait", () => {
    const hexer = convert(byName("Hollowvale Hexer"));
    expect((hexer.trait as JsonObject[] | undefined)?.some((t) => t.name === "Spellcasting") ?? false).toBe(false);
    const [block] = hexer.spellcasting as JsonObject[];
    expect(block.type).toBe("spellcasting");
    expect(block.ability).toBe("cha");
    expect(String((block.headerEntries as string[])[0])).toContain("{@dc 13}");
    expect(String((block.headerEntries as string[])[0])).toContain("{@hit 5} to hit with spell attacks");
  });

  it("maps environments and says what it dropped", () => {
    const { file, notes } = buildFiveToolsFile([byName("Murkmaw Lurker"), byName("Clockwork Warden")], NOW);
    const [murkmaw, warden] = file.monster as JsonObject[];
    expect(murkmaw.environment).toEqual(["underwater", "swamp", "coastal"]);
    expect(warden.environment).toEqual(["urban"]); // "dungeon" has no 5etools name
    expect(notes.some((n) => n.includes("dungeon"))).toBe(true);
  });

  it("drops unknown skills with a note", () => {
    const odd: Monster = { ...goblin, skills: { Stealth: 6, "Basket Weaving": 3 } };
    const { file, notes } = buildFiveToolsFile([odd], NOW);
    expect((file.monster as JsonObject[])[0].skill).toEqual({ stealth: "+6" });
    expect(notes.some((n) => n.includes("Basket Weaving"))).toBe(true);
  });

  it("falls back to special text for unreadable hit dice", () => {
    const odd: Monster = { ...goblin, hit_points: { average: 9, dice: "lots" } };
    expect(convert(odd).hp).toEqual({ special: "9" });
  });
});

describe("every sample monster converts into a valid-looking entry", () => {
  const LETTERS = /^[FDTSMLHGCV]$/;
  it.each(monsters.map((m) => [m.name, m] as const))("%s", (_name, monster) => {
    const out = convert(monster);
    expect(findUndefined(out)).toBeNull();
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    expect(out.name).toBe(monster.name);
    expect(out.source).toBe("CreatureCauldronHB");
    expect((out.size as string[]).every((s) => LETTERS.test(s))).toBe(true);
    expect(Array.isArray(out.ac)).toBe(true);
    const hp = out.hp as JsonObject;
    expect(typeof hp.average === "number" || typeof hp.special === "string").toBe(true);
    for (const key of ["str", "dex", "con", "int", "wis", "cha", "passive"]) expect(Number.isInteger(out[key])).toBe(true);
    expect(typeof out.cr).toBe("string");
    // Lists must never be empty, and saves and skills must be signed text.
    for (const key of ["senses", "resist", "immune", "vulnerable", "conditionImmune", "languages", "trait", "action", "bonus", "reaction", "legendary", "environment"]) {
      if (key in out) expect((out[key] as unknown[]).length, key).toBeGreaterThan(0);
    }
    for (const group of ["save", "skill"]) {
      for (const value of Object.values((out[group] ?? {}) as JsonObject)) expect(String(value)).toMatch(/^[+-]\d+$/);
    }
    // Every entry is plain text, with no raw "{@" tag left half open.
    const texts = ["trait", "action", "bonus", "reaction", "legendary"].flatMap((k) => (out[k] as JsonObject[] | undefined) ?? []);
    for (const t of texts) {
      expect(typeof t.name).toBe("string");
      for (const entry of t.entries as string[]) {
        expect((entry.match(/\{@/g) ?? []).length).toBe((entry.match(/\}/g) ?? []).length);
      }
    }
  });
});

describe("golden files: our exported 5etools files, written to disk so any change is visible in review", () => {
  it("one file with three monsters", async () => {
    const { file } = buildFiveToolsFile(["Cinderkite", "Stormhide Drake", "Hollowvale Hexer"].map(byName), NOW);
    await expect(`${JSON.stringify(file, null, 2)}\n`).toMatchFileSnapshot("./goldens/5etools-sample.json");
  });
});
