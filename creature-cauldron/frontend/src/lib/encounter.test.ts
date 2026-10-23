import { afterEach, describe, expect, it, vi } from "vitest";
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
  emptyWorking,
  generateId,
  isDirty,
  loadSaved,
  nameConflict,
  orderForList,
  removeMonster,
  resolvedName,
  sameName,
  saveWorking,
  setCount,
  startNewEncounter,
  summarizeEncounter,
  toggleSavedFavorite,
  toggleWorkingFavorite,
  totalMonsters,
  type EncounterEntry,
  type EncounterState,
  type SavedEncounter,
  type WorkingEncounter,
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

  it("turns runs of spaces and other whitespace into one space, since a page shows them the same", () => {
    expect(cleanName("Boss   Fight")).toBe("Boss Fight");
    expect(cleanName("Boss\t  Fight")).toBe("Boss Fight");
    expect(sameName("Boss  fight", "boss fight")).toBe(true);
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

const rec = (id: string, name: string, favorite = false, entries: EncounterEntry[] = [row(GLOOMCAP, 1)]): SavedEncounter => ({
  id,
  name,
  favorite,
  entries,
});
const card = (changes: Partial<WorkingEncounter> = {}): WorkingEncounter => ({ ...emptyWorking(), ...changes });
const stateOf = (saved: SavedEncounter[], working: WorkingEncounter): EncounterState => ({ saved, working });
/** A predictable id source, so tests can name the id a new save gets. */
const idMaker = () => {
  let n = 0;
  return () => `new-${++n}`;
};

describe("default names", () => {
  it("starts at Encounter 1 and follows the number saved", () => {
    expect(defaultEncounterName([])).toBe("Encounter 1");
    expect(defaultEncounterName([rec("a", "Encounter 1"), rec("b", "Encounter 2")])).toBe("Encounter 3");
  });

  it("skips numbers that are already taken, ignoring capitals", () => {
    expect(defaultEncounterName([rec("a", "Encounter 1"), rec("b", "encounter 3")])).toBe("Encounter 4");
    expect(defaultEncounterName([rec("a", "Crypt ambush")])).toBe("Encounter 2");
  });
});

describe("resolvedName and nameConflict", () => {
  const saved = [rec("a", "Crypt ambush"), rec("b", "Boss")];

  it("uses what was typed, or the next default when the box is blank", () => {
    expect(resolvedName(saved, card({ name: "  Dragon lair " }))).toBe("Dragon lair");
    expect(resolvedName(saved, card({ name: "   " }))).toBe("Encounter 3");
  });

  it("flags a name another saved encounter uses, ignoring capitals and spaces", () => {
    expect(nameConflict(saved, card({ name: " crypt AMBUSH " }))).toBe(true);
    expect(nameConflict(saved, card({ name: "Something new" }))).toBe(false);
  });

  it("lets an encounter keep its own name, even with different capitals", () => {
    expect(nameConflict(saved, card({ id: "a", name: "CRYPT ambush" }))).toBe(false);
    expect(nameConflict(saved, card({ id: "a", name: "Boss" }))).toBe(true);
  });

  it("never flags a blank name, because the default is always free", () => {
    expect(nameConflict(saved, card({ name: "" }))).toBe(false);
  });

  it("treats a name that differs only in inner spacing as taken", () => {
    expect(nameConflict([rec("a", "Boss fight")], card({ name: "Boss   Fight" }))).toBe(true);
  });

  it("keeps the saved name when the box of a loaded encounter is blank", () => {
    expect(resolvedName(saved, card({ id: "a", name: "" }))).toBe("Crypt ambush");
    expect(resolvedName(saved, card({ id: "a", name: "   " }))).toBe("Crypt ambush");
  });

  it("uses the next default for a card whose saved copy no longer exists", () => {
    expect(resolvedName(saved, card({ id: "gone", name: "" }))).toBe("Encounter 3");
  });
});

describe("isDirty", () => {
  const saved = [rec("a", "Crypt ambush", false, [row(STALKER, 2, "Gravewick Stalker")])];
  const loaded = card({ id: "a", name: "Crypt ambush", entries: [row(STALKER, 2, "Gravewick Stalker")] });

  it("is false for an empty, unsaved card and true once it has rows", () => {
    expect(isDirty(saved, card())).toBe(false);
    expect(isDirty(saved, card({ entries: [row(GLOOMCAP, 1)] }))).toBe(true);
  });

  it("is false for a loaded encounter that has not been changed", () => {
    expect(isDirty(saved, loaded)).toBe(false);
  });

  it("is true after a count change, an added monster, a removal or a rename", () => {
    expect(isDirty(saved, { ...loaded, entries: [row(STALKER, 3)] })).toBe(true);
    expect(isDirty(saved, { ...loaded, entries: [...loaded.entries, row(GLOOMCAP, 1)] })).toBe(true);
    expect(isDirty(saved, { ...loaded, entries: [] })).toBe(true);
    expect(isDirty(saved, { ...loaded, name: "Renamed" })).toBe(true);
  });

  it("does not count starring, a changed display name, or extra spaces around the name", () => {
    expect(isDirty(saved, { ...loaded, favorite: true })).toBe(false);
    expect(isDirty(saved, { ...loaded, entries: [row(STALKER, 2, "Old name")] })).toBe(false);
    expect(isDirty(saved, { ...loaded, name: "  Crypt ambush  " })).toBe(false);
  });

  it("does not count a blank name box on a loaded encounter, which keeps its name", () => {
    expect(isDirty(saved, { ...loaded, name: "" })).toBe(false);
  });

  it("treats a card whose saved copy no longer exists as unsaved work", () => {
    expect(isDirty([], loaded)).toBe(true);
    expect(isDirty([], { ...loaded, entries: [] })).toBe(false);
  });
});

describe("canSave", () => {
  const rows = [row(GLOOMCAP, 1)];

  it("needs at least one row", () => {
    expect(canSave([], card())).toBe(false);
    expect(canSave([], card({ entries: rows }))).toBe(true);
  });

  it("is blocked by a name another saved encounter uses", () => {
    expect(canSave([rec("a", "Boss")], card({ name: "boss", entries: rows }))).toBe(false);
    expect(canSave([rec("a", "Boss")], card({ id: "a", name: "BOSS", entries: rows }))).toBe(true);
  });

  it("stops new saves at the limit but still allows updating a loaded one", () => {
    const full = Array.from({ length: MAX_SAVED }, (_, i) => rec(`id-${i}`, `Save ${i}`));
    expect(canSave(full, card({ name: "Brand new", entries: rows }))).toBe(false);
    expect(canSave(full, card({ id: "id-5", name: "Save 5", entries: rows }))).toBe(true);
  });
});

describe("saveWorking", () => {
  const rows = [row(STALKER, 2, "Gravewick Stalker")];

  it("adds a new encounter with a fresh id, the typed name and the star", () => {
    const next = saveWorking(stateOf([], card({ name: "Crypt ambush", favorite: true, entries: rows })), idMaker());
    expect(next.saved).toEqual([{ id: "new-1", name: "Crypt ambush", favorite: true, entries: rows }]);
    expect(next.working).toMatchObject({ id: "new-1", name: "Crypt ambush", favorite: true });
  });

  it("gives a blank name the next default and shows it on the card", () => {
    const next = saveWorking(stateOf([rec("a", "Boss")], card({ entries: rows })), idMaker());
    expect(next.saved[1].name).toBe("Encounter 2");
    expect(next.working.name).toBe("Encounter 2");
  });

  it("updates a loaded encounter in place, so renaming renames it", () => {
    const saved = [rec("a", "Crypt ambush"), rec("b", "Boss")];
    const working = card({ id: "a", name: "Crypt ambush II", entries: rows });
    const next = saveWorking(stateOf(saved, working), idMaker());
    expect(next.saved.map((s) => [s.id, s.name])).toEqual([
      ["a", "Crypt ambush II"],
      ["b", "Boss"],
    ]);
    expect(next.saved[0].entries).toEqual(rows);
    expect(next.saved[1]).toBe(saved[1]);
    expect(next.working.id).toBe("a");
  });

  it("keeps a loaded encounter's name when its name box was cleared", () => {
    const saved = [rec("a", "Crypt ambush"), rec("b", "Boss")];
    const next = saveWorking(stateOf(saved, card({ id: "a", name: "", entries: rows })), idMaker());
    expect(next.saved[0]).toMatchObject({ id: "a", name: "Crypt ambush" });
    expect(next.working.name).toBe("Crypt ambush");
  });

  it("changes nothing when the name is taken, the card is empty, or the list is full", () => {
    const taken = stateOf([rec("a", "Boss")], card({ name: "boss", entries: rows }));
    expect(saveWorking(taken)).toBe(taken);
    const empty = stateOf([], card({ name: "Anything" }));
    expect(saveWorking(empty)).toBe(empty);
    const full = Array.from({ length: MAX_SAVED }, (_, i) => rec(`id-${i}`, `Save ${i}`));
    const overflow = stateOf(full, card({ name: "One more", entries: rows }));
    expect(saveWorking(overflow)).toBe(overflow);
  });

  it("copies the rows, so later changes on the card cannot alter the saved copy", () => {
    const working = card({ name: "Copy test", entries: [row(STALKER, 2)] });
    const next = saveWorking(stateOf([], working), idMaker());
    working.entries[0].count = 50;
    expect(next.saved[0].entries[0].count).toBe(2);
  });

  it("creates a new encounter when the saved copy it was loaded from has been deleted", () => {
    const next = saveWorking(stateOf([], card({ id: "gone", name: "Orphan", entries: rows })), idMaker());
    expect(next.saved).toHaveLength(1);
    expect(next.saved[0].id).toBe("new-1");
    expect(next.working.id).toBe("new-1");
  });

  it("makes a real id when none is supplied", () => {
    const next = saveWorking(stateOf([], card({ name: "Auto id", entries: rows })));
    expect(typeof next.saved[0].id).toBe("string");
    expect(next.saved[0].id.length).toBeGreaterThan(0);
  });

  it("does not change the state it was given", () => {
    expectNoMutation(stateOf([rec("a", "Boss")], card({ name: "New", entries: rows })), (s) => saveWorking(s, idMaker()));
    expectNoMutation(stateOf([rec("a", "Boss")], card({ id: "a", name: "Boss 2", entries: rows })), (s) =>
      saveWorking(s, idMaker()),
    );
  });
});

describe("loadSaved, deleteSaved and startNewEncounter", () => {
  const saved = [rec("a", "Crypt ambush", true, [row(STALKER, 2, "Gravewick Stalker")]), rec("b", "Boss")];

  it("puts a saved encounter on the card as copies", () => {
    const next = loadSaved(stateOf(saved, card({ entries: [row(GLOOMCAP, 5)] })), "a");
    expect(next.working).toEqual({
      id: "a",
      name: "Crypt ambush",
      favorite: true,
      entries: [row(STALKER, 2, "Gravewick Stalker")],
    });
    next.working.entries[0].count = 99;
    expect(saved[0].entries[0].count).toBe(2);
  });

  it("changes nothing for an unknown id", () => {
    const state = stateOf(saved, card());
    expect(loadSaved(state, "nope")).toBe(state);
    expect(deleteSaved(state, "nope")).toBe(state);
  });

  it("deletes a saved encounter and leaves an unrelated card alone", () => {
    const working = card({ id: "b", name: "Boss", entries: [row(GLOOMCAP, 1)] });
    const next = deleteSaved(stateOf(saved, working), "a");
    expect(next.saved.map((s) => s.id)).toEqual(["b"]);
    expect(next.working).toBe(working);
  });

  it("unlinks the card, keeping its rows, when its saved copy is deleted", () => {
    const working = card({ id: "a", name: "Crypt ambush", entries: [row(STALKER, 2)] });
    const next = deleteSaved(stateOf(saved, working), "a");
    expect(next.working).toEqual({ ...working, id: null });
    expect(isDirty(next.saved, next.working)).toBe(true);
  });

  it("starts a fresh encounter without touching the saved list", () => {
    const state = stateOf(saved, card({ id: "a", name: "Crypt ambush", entries: [row(STALKER, 2)] }));
    const next = startNewEncounter(state);
    expect(next.working).toEqual(emptyWorking());
    expect(next.saved).toBe(saved);
  });

  it("does not change the state it was given", () => {
    const state = stateOf(saved, card({ id: "a", name: "Crypt ambush", entries: [row(STALKER, 2)] }));
    expectNoMutation(state, (s) => loadSaved(s, "b"));
    expectNoMutation(state, (s) => deleteSaved(s, "a"));
    expectNoMutation(state, (s) => startNewEncounter(s));
  });
});

describe("favorites on encounters", () => {
  const saved = [rec("a", "Crypt ambush"), rec("b", "Boss", true)];

  it("stars and unstars a saved encounter", () => {
    const starred = toggleSavedFavorite(stateOf(saved, card()), "a");
    expect(starred.saved.map((s) => s.favorite)).toEqual([true, true]);
    const unstarred = toggleSavedFavorite(starred, "b");
    expect(unstarred.saved.map((s) => s.favorite)).toEqual([true, false]);
  });

  it("keeps the card's star in step when the card shows that encounter", () => {
    const state = stateOf(saved, card({ id: "a", name: "Crypt ambush", entries: [row(GLOOMCAP, 1)] }));
    expect(toggleSavedFavorite(state, "a").working.favorite).toBe(true);
    expect(toggleSavedFavorite(state, "b").working.favorite).toBe(false);
  });

  it("changes nothing for an unknown id", () => {
    const state = stateOf(saved, card());
    expect(toggleSavedFavorite(state, "nope")).toBe(state);
  });

  it("stars an unsaved card without saving anything", () => {
    const state = stateOf(saved, card({ entries: [row(GLOOMCAP, 1)] }));
    const next = toggleWorkingFavorite(state);
    expect(next.working.favorite).toBe(true);
    expect(next.saved).toBe(saved);
  });

  it("saves a loaded card's star at once, without making it dirty", () => {
    const state = loadSaved(stateOf(saved, card()), "a");
    const next = toggleWorkingFavorite(state);
    expect(next.working.favorite).toBe(true);
    expect(next.saved[0].favorite).toBe(true);
    expect(isDirty(next.saved, next.working)).toBe(false);
  });

  it("lists starred encounters first, keeping the saved order otherwise", () => {
    const list = [rec("a", "A"), rec("b", "B", true), rec("c", "C"), rec("d", "D", true)];
    expect(orderForList(list).map((s) => s.id)).toEqual(["b", "d", "a", "c"]);
    expectNoMutation(list, (l) => orderForList(l));
  });
});

describe("generateId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes different, non-empty ids", () => {
    const first = generateId();
    expect(first.length).toBeGreaterThan(0);
    expect(generateId()).not.toBe(first);
  });

  it("falls back when crypto.randomUUID is not available (plain http pages)", () => {
    vi.stubGlobal("crypto", {});
    const first = generateId();
    expect(first.startsWith("enc-")).toBe(true);
    expect(generateId()).not.toBe(first);
  });
});
