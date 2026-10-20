import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Monster } from "../types/monster";
import {
  MAX_COUNT,
  MAX_ENTRIES,
  MAX_NAME_LENGTH,
  MAX_SAVED,
  addMonster,
  canAddMonster,
  canSave,
  clampCount,
  cleanName,
  countOf,
  defaultEncounterName,
  deleteSaved,
  describeRating,
  hasSavedName,
  removeMonster,
  resolveSaveName,
  sameName,
  saveEncounter,
  setCount,
  summarizeEncounter,
  totalMonsters,
  type EncounterEntry,
  type SavedEncounter,
} from "./encounter";
import { DIFFICULTIES, adjustedXp, soloBand, type Party } from "./party";

const monsters = sample as unknown as Monster[];

const GLOOMCAP = "gloomcap-shambler-7c42"; // 50 XP
const STALKER = "gravewick-stalker-e13b"; // 450 XP
const SCRABBLER = "cellar-scrabbler-8f01"; // 10 XP
const MURKMAW = "murkmaw-lurker-b905"; // 100 XP
const BRIGHTWING = "brightwing-sentinel-e5f6"; // 1,800 XP

const row = (monsterId: string, count: number, name?: string): EncounterEntry =>
  name === undefined ? { monsterId, count } : { monsterId, count, name };
const party = (...levels: number[]): Party => ({ levels });
const four = party(3, 3, 3, 3); // budgets 300 / 600 / 900 / 1,600

/** Calls `change` and checks the input list was not altered (compared as JSON before and after). */
function expectNoMutation<T>(input: T, change: (value: T) => unknown) {
  const before = JSON.stringify(input);
  change(input);
  expect(JSON.stringify(input)).toBe(before);
}

describe("clampCount", () => {
  it.each([
    [0, 1],
    [1, 1],
    [2.4, 2],
    [2.5, 3],
    [99, 99],
    [100, 99],
    [-5, 1],
    [Number.NaN, 1],
    [Infinity, 99],
  ])("%s becomes %i", (input, expected) => {
    expect(clampCount(input)).toBe(expected);
  });
});

describe("cleanName and sameName", () => {
  it("trims spaces", () => {
    expect(cleanName("  Crypt ambush  ")).toBe("Crypt ambush");
  });

  it("cuts to the maximum length and leaves no trailing space", () => {
    const long = `${"a".repeat(MAX_NAME_LENGTH - 1)} ${"b".repeat(20)}`;
    const cleaned = cleanName(long);
    expect(cleaned).toBe("a".repeat(MAX_NAME_LENGTH - 1));
    expect(cleaned.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
  });

  it("compares names ignoring capitals and surrounding spaces", () => {
    expect(sameName(" Crypt Ambush", "crypt ambush ")).toBe(true);
    expect(sameName("Crypt", "Crypts")).toBe(false);
  });
});

describe("addMonster", () => {
  it("adds a new monster with a count of 1 and a remembered name", () => {
    expect(addMonster([], { id: GLOOMCAP, name: "Gloomcap Shambler" })).toEqual([
      { monsterId: GLOOMCAP, count: 1, name: "Gloomcap Shambler" },
    ]);
  });

  it("raises the count when the monster is already there, and refreshes its name", () => {
    const entries = [row(GLOOMCAP, 2, "Old name"), row(STALKER, 1)];
    expect(addMonster(entries, { id: GLOOMCAP, name: "Gloomcap Shambler" })).toEqual([
      { monsterId: GLOOMCAP, count: 3, name: "Gloomcap Shambler" },
      { monsterId: STALKER, count: 1 },
    ]);
  });

  it("returns the same list when the row is already at the maximum", () => {
    const entries = [row(GLOOMCAP, MAX_COUNT)];
    expect(addMonster(entries, { id: GLOOMCAP, name: "x" })).toBe(entries);
  });

  it("returns the same list when the encounter already has the maximum number of different monsters", () => {
    const entries = Array.from({ length: MAX_ENTRIES }, (_, i) => row(`m-${i}`, 1));
    expect(addMonster(entries, { id: "brand-new", name: "x" })).toBe(entries);
    // ...but a monster that is already in it can still go up
    expect(countOf(addMonster(entries, { id: "m-0", name: "x" }), "m-0")).toBe(2);
  });

  it("does not change the list it was given", () => {
    expectNoMutation([row(GLOOMCAP, 2, "x")], (e) => addMonster(e, { id: GLOOMCAP, name: "y" }));
    expectNoMutation([row(GLOOMCAP, 2, "x")], (e) => addMonster(e, { id: STALKER, name: "y" }));
  });
});

describe("canAddMonster", () => {
  it("allows a new monster, a row below the maximum, and refuses the rest", () => {
    expect(canAddMonster([], GLOOMCAP)).toBe(true);
    expect(canAddMonster([row(GLOOMCAP, MAX_COUNT - 1)], GLOOMCAP)).toBe(true);
    expect(canAddMonster([row(GLOOMCAP, MAX_COUNT)], GLOOMCAP)).toBe(false);
    const full = Array.from({ length: MAX_ENTRIES }, (_, i) => row(`m-${i}`, 1));
    expect(canAddMonster(full, "brand-new")).toBe(false);
    expect(canAddMonster(full, "m-3")).toBe(true);
  });
});

describe("setCount, removeMonster, countOf, totalMonsters", () => {
  const entries = [row(GLOOMCAP, 2), row(STALKER, 1)];

  it("sets a count, rounding and clamping it", () => {
    expect(setCount(entries, GLOOMCAP, 5)).toEqual([row(GLOOMCAP, 5), row(STALKER, 1)]);
    expect(countOf(setCount(entries, GLOOMCAP, 500), GLOOMCAP)).toBe(99);
    expect(countOf(setCount(entries, GLOOMCAP, 0), GLOOMCAP)).toBe(1);
    expect(countOf(setCount(entries, GLOOMCAP, 3.6), GLOOMCAP)).toBe(4);
  });

  it("changes nothing for NaN, Infinity, an unknown id, or an unchanged count", () => {
    expect(setCount(entries, GLOOMCAP, Number.NaN)).toBe(entries);
    expect(setCount(entries, GLOOMCAP, Infinity)).toBe(entries);
    expect(setCount(entries, "nope", 3)).toBe(entries);
    expect(setCount(entries, GLOOMCAP, 2)).toBe(entries);
  });

  it("removes a row and keeps the order of the others", () => {
    expect(removeMonster(entries, GLOOMCAP)).toEqual([row(STALKER, 1)]);
    expect(removeMonster(entries, "nope")).toBe(entries);
  });

  it("counts monsters", () => {
    expect(countOf(entries, STALKER)).toBe(1);
    expect(countOf(entries, "nope")).toBe(0);
    expect(totalMonsters(entries)).toBe(3);
    expect(totalMonsters([])).toBe(0);
  });

  it("never changes the list it was given", () => {
    expectNoMutation(entries, (e) => setCount(e, GLOOMCAP, 9));
    expectNoMutation(entries, (e) => removeMonster(e, GLOOMCAP));
  });
});

describe("summarizeEncounter", () => {
  it("counts every monster for the multiplier and rates the adjusted XP", () => {
    const summary = summarizeEncounter([row(GLOOMCAP, 3)], monsters, four);
    expect(summary).toMatchObject({
      monsterCount: 3,
      missingCount: 0,
      totalXp: 150,
      multiplier: 2, // 3 monsters
      adjustedXp: 300,
      rating: "easy", // budgets 300 / 600 / 900 / 1,600: exactly at easy
      partyShift: null,
    });
    expect(summary.adjustedXp).toBe(adjustedXp([50, 50, 50], 4));
  });

  it("keeps rows in order and pairs each with its monster", () => {
    const summary = summarizeEncounter([row(STALKER, 1), row("gone", 2)], monsters, four);
    expect(summary.lines.map((l) => l.entry.monsterId)).toEqual([STALKER, "gone"]);
    expect(summary.lines[0].monster?.name).toBe("Gravewick Stalker");
    expect(summary.lines[1].monster).toBeUndefined();
  });

  it("shifts the multiplier up for a party of 2 and says so", () => {
    const summary = summarizeEncounter([row(GLOOMCAP, 3)], monsters, party(3, 3)); // budgets 150 / 300 / 450 / 800
    expect(summary).toMatchObject({ multiplier: 2.5, adjustedXp: 375, rating: "medium", partyShift: "up", partySize: 2 });
  });

  it("shifts the multiplier down for a party of 6", () => {
    const six = party(3, 3, 3, 3, 3, 3); // budgets 450 / 900 / 1,350 / 2,400
    expect(summarizeEncounter([row(GLOOMCAP, 7)], monsters, six)).toMatchObject({
      multiplier: 2,
      adjustedXp: 700,
      rating: "easy",
      partyShift: "down",
    });
    expect(summarizeEncounter([row(GLOOMCAP, 11)], monsters, six)).toMatchObject({
      multiplier: 2.5,
      adjustedXp: 1375,
      rating: "hard",
      partyShift: "down",
    });
  });

  it("does not shift past x4 for 15 monsters against a small party", () => {
    const summary = summarizeEncounter([row(SCRABBLER, 15)], monsters, party(3, 3));
    expect(summary).toMatchObject({ multiplier: 4, adjustedXp: 600, rating: "hard", partyShift: null });
  });

  it("gives nulls, not a fake rating, for an empty encounter", () => {
    expect(summarizeEncounter([], monsters, four)).toMatchObject({
      monsterCount: 0,
      totalXp: 0,
      multiplier: null,
      adjustedXp: 0,
      rating: null,
      partyShift: null,
    });
  });

  it("leaves monsters the library lacks out of the maths and counts them as missing", () => {
    const summary = summarizeEncounter([row(STALKER, 2), row("long-gone", 3)], monsters, four);
    expect(summary).toMatchObject({
      monsterCount: 2,
      missingCount: 3,
      totalXp: 900,
      multiplier: 1.5, // only the 2 counted monsters
      adjustedXp: 1350,
      rating: "hard",
    });
  });

  it("has no rating when every row is missing", () => {
    expect(summarizeEncounter([row("a", 2), row("b", 3)], monsters, four)).toMatchObject({
      monsterCount: 0,
      missingCount: 5,
      multiplier: null,
      rating: null,
    });
  });

  it("ignores a monster whose XP is not a usable number, and marks its line as uncounted", () => {
    const stalker = monsters.find((m) => m.id === STALKER)!;
    const broken = (xp: unknown): Monster => ({ ...stalker, challenge: { ...stalker.challenge, xp: xp as number } });
    // null is what a bad value in the JSON file would actually look like; JSON cannot hold NaN.
    for (const xp of [Number.NaN, Infinity, -450, null, undefined, "450"]) {
      const summary = summarizeEncounter([row(STALKER, 2)], [broken(xp)], four);
      expect(summary, String(xp)).toMatchObject({ monsterCount: 0, missingCount: 2, rating: null });
      expect(summary.lines[0].xp, String(xp)).toBeNull();
    }
  });

  it("counts a monster worth 0 XP: only negative or non-numeric XP is dropped", () => {
    const stalker = monsters.find((m) => m.id === STALKER)!;
    const free: Monster = { ...stalker, challenge: { ...stalker.challenge, xp: 0 } };
    const summary = summarizeEncounter([row(STALKER, 1)], [free], four);
    expect(summary).toMatchObject({ monsterCount: 1, missingCount: 0, totalXp: 0, rating: "trivial" });
    expect(summary.lines[0].xp).toBe(0);
  });

  it("reports each line's usable XP, or null for a row it cannot count", () => {
    const summary = summarizeEncounter([row(STALKER, 1), row("long-gone", 1), row(GLOOMCAP, 1)], monsters, four);
    expect(summary.lines.map((l) => l.xp)).toEqual([450, null, 50]);
  });

  it("adds XP and counts across different monsters", () => {
    // 2 gloomcaps (100) + 1 stalker (450): 3 monsters, x2
    expect(summarizeEncounter([row(GLOOMCAP, 2), row(STALKER, 1)], monsters, four)).toMatchObject({
      monsterCount: 3,
      totalXp: 550,
      multiplier: 2,
      adjustedXp: 1100,
      rating: "hard",
    });
    // 1 + 1: 2 monsters, x1.5. The higher-XP monster is second, so "first row only" and "last row only" bugs both fail.
    expect(summarizeEncounter([row(GLOOMCAP, 1), row(STALKER, 1)], monsters, four)).toMatchObject({
      monsterCount: 2,
      totalXp: 500,
      multiplier: 1.5,
      adjustedXp: 750,
      rating: "medium",
    });
  });

  it("applies the party-size shift to a mixed encounter", () => {
    // 550 XP of 3 monsters against a party of 2 (budgets 150 / 300 / 450 / 800): x2.5 = 1,375
    const summary = summarizeEncounter([row(GLOOMCAP, 2), row(STALKER, 1)], monsters, party(3, 3));
    expect(summary).toMatchObject({ multiplier: 2.5, adjustedXp: 1375, partyShift: "up", rating: "deadly" });
    expect(summary.adjustedXp).toBe(adjustedXp([50, 50, 450], 2));
  });

  it("still rates the good rows when another row is broken", () => {
    const stalker = monsters.find((m) => m.id === STALKER)!;
    const broken: Monster = { ...stalker, id: "broken", challenge: { ...stalker.challenge, xp: Number.NaN } };
    const summary = summarizeEncounter([row(STALKER, 1), row("broken", 4)], [...monsters, broken], four);
    expect(summary).toMatchObject({ monsterCount: 1, missingCount: 4, totalXp: 450, rating: "easy" }); // 450 is between easy (300) and medium (600)
  });

  it("does not change its inputs", () => {
    // One object holding all three inputs, so a single before/after comparison covers them.
    const inputs = { entries: [row(GLOOMCAP, 3)], monsters, party: { levels: [...four.levels] } };
    expectNoMutation(inputs, (x) => summarizeEncounter(x.entries, x.monsters, x.party));
  });
});

// The difficulty filter (soloBand) and the builder (summarizeEncounter) must never disagree about
// what a lone monster rates as. The named cases sit exactly on a band edge.
describe("summarizeEncounter agrees with the difficulty filter", () => {
  it.each([
    ["1 level-1 character, 50 XP", party(1), GLOOMCAP, "hard"],
    ["2 level-1 characters, 100 XP", party(1, 1), MURKMAW, "hard"],
    ["3 level-3 characters, 450 XP", party(3, 3, 3), STALKER, "medium"],
    ["6 level-3 characters, 1,800 XP", party(3, 3, 3, 3, 3, 3), BRIGHTWING, "medium"],
  ])("%s", (_label, p, id, expected) => {
    expect(summarizeEncounter([row(id, 1)], monsters, p).rating).toBe(expected);
  });

  it("holds for every sample monster against a range of parties", () => {
    const parties = [party(1), party(2, 2), party(3, 3, 3), four, party(5, 5, 5, 5), party(5, 5, 5, 5, 5, 5), party(10, 10), party(20, 20, 20, 20)];
    for (const p of parties) {
      for (const monster of monsters) {
        const inBand = DIFFICULTIES.find((d) => {
          const band = soloBand(p, d);
          return monster.challenge.xp >= band.min && (band.max === null || monster.challenge.xp < band.max);
        });
        const rating = summarizeEncounter([row(monster.id, 1)], monsters, p).rating;
        expect(rating, `${monster.name} vs ${JSON.stringify(p.levels)}`).toBe(inBand ?? "trivial");
      }
    }
  });
});

describe("describeRating", () => {
  it("capitalises a rating and is blank when there is none", () => {
    expect(describeRating("hard")).toBe("Hard");
    expect(describeRating("trivial")).toBe("Trivial");
    expect(describeRating(null)).toBe("");
  });
});

describe("default names", () => {
  const saved = (...names: string[]): SavedEncounter[] => names.map((name) => ({ name, entries: [row(GLOOMCAP, 1)] }));

  it("starts at Encounter 1 and follows the number saved", () => {
    expect(defaultEncounterName([])).toBe("Encounter 1");
    expect(defaultEncounterName(saved("Encounter 1", "Encounter 2"))).toBe("Encounter 3");
  });

  it("skips numbers that are already taken, ignoring capitals", () => {
    expect(defaultEncounterName(saved("Encounter 1", "encounter 3"))).toBe("Encounter 4");
    expect(defaultEncounterName(saved("Crypt ambush"))).toBe("Encounter 2");
  });

  it("uses what was typed, or the default when the box is blank", () => {
    expect(resolveSaveName(saved("Encounter 1"), "  Boss fight ")).toBe("Boss fight");
    expect(resolveSaveName(saved("Encounter 1"), "   ")).toBe("Encounter 2");
  });
});

describe("saving, replacing and deleting", () => {
  const entries = [row(STALKER, 2, "Gravewick Stalker")];
  const existing: SavedEncounter[] = [
    { name: "Crypt ambush", entries: [row(GLOOMCAP, 1)] },
    { name: "Boss", entries: [row(BRIGHTWING, 1)] },
  ];

  it("adds a new save under the typed name", () => {
    const result = saveEncounter(existing, "Dragon lair", entries);
    expect(result.map((s) => s.name)).toEqual(["Crypt ambush", "Boss", "Dragon lair"]);
    expect(result[2].entries).toEqual(entries);
  });

  it("uses a default name when none is typed", () => {
    expect(saveEncounter([], "", entries)[0].name).toBe("Encounter 1");
    expect(saveEncounter(existing, "  ", entries)[2].name).toBe("Encounter 3");
  });

  it("replaces a save with the same name (any capitals) in place, taking the new spelling", () => {
    const result = saveEncounter(existing, "crypt AMBUSH", entries);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "crypt AMBUSH", entries });
    expect(result[1]).toBe(existing[1]);
  });

  it("does not save an empty encounter", () => {
    expect(saveEncounter(existing, "Nothing", [])).toBe(existing);
    expect(canSave(existing, "Nothing", [])).toBe(false);
  });

  it("copies the rows, so later edits to the working encounter cannot alter the save", () => {
    const working = [row(STALKER, 2)];
    const result = saveEncounter([], "Copy test", working);
    working[0].count = 50;
    expect(result[0].entries[0].count).toBe(2);
  });

  it("stops adding new saves at the limit, but still allows replacing", () => {
    const full: SavedEncounter[] = Array.from({ length: MAX_SAVED }, (_, i) => ({
      name: `Save ${i}`,
      entries: [row(GLOOMCAP, 1)],
    }));
    expect(canSave(full, "Brand new", entries)).toBe(false);
    expect(saveEncounter(full, "Brand new", entries)).toBe(full);
    expect(canSave(full, "save 5", entries)).toBe(true);
    expect(saveEncounter(full, "save 5", entries)).toHaveLength(MAX_SAVED);
  });

  it("knows whether a typed name already exists (never for a blank box)", () => {
    expect(hasSavedName(existing, "BOSS")).toBe(true);
    expect(hasSavedName(existing, "Other")).toBe(false);
    expect(hasSavedName(existing, "   ")).toBe(false);
  });

  it("deletes by name, ignoring capitals; an unknown name changes nothing", () => {
    expect(deleteSaved(existing, "boss").map((s) => s.name)).toEqual(["Crypt ambush"]);
    expect(deleteSaved(existing, "nope")).toBe(existing);
  });

  it("never changes the list it was given", () => {
    expectNoMutation(existing, (s) => saveEncounter(s, "New", entries));
    expectNoMutation(existing, (s) => saveEncounter(s, "boss", entries));
    expectNoMutation(existing, (s) => deleteSaved(s, "boss"));
  });
});
