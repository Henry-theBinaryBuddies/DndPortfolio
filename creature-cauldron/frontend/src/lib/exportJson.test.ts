import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Monster } from "../types/monster";
import { summarizeEncounter, type EncounterEntry } from "./encounter";
import { toJsonText } from "./exportCommon";
import { APP_NAME, FORMAT_VERSION, buildEncounterFile, buildMonsterFile } from "./exportJson";
import type { Party } from "./party";

const monsters = sample as unknown as Monster[];
const NOW = "2026-10-19T12:00:00.000Z";
const four: Party = { levels: [3, 3, 3, 3] };

const GLOOMCAP = "gloomcap-shambler-7c42"; // 50 XP
const STALKER = "gravewick-stalker-e13b"; // 450 XP
const row = (monsterId: string, count: number, name?: string): EncounterEntry =>
  name === undefined ? { monsterId, count } : { monsterId, count, name };

describe("buildMonsterFile", () => {
  it("wraps the monster in a versioned envelope", () => {
    const file = buildMonsterFile(monsters[0], NOW);
    expect(file).toMatchObject({ app: APP_NAME, kind: "monster", format_version: FORMAT_VERSION, exported_at: NOW });
    expect(FORMAT_VERSION).toBe(1);
  });

  it("carries every sample monster through JSON unchanged", () => {
    for (const monster of monsters) {
      const parsed = JSON.parse(toJsonText(buildMonsterFile(monster, NOW)));
      expect(parsed.monster, monster.name).toEqual(monster);
    }
  });

  it("is a pure function of its input", () => {
    expect(buildMonsterFile(monsters[3], NOW)).toEqual(buildMonsterFile(monsters[3], NOW));
  });
});

describe("buildEncounterFile", () => {
  const entries = [row(GLOOMCAP, 3), row(STALKER, 1), row("long-gone", 2, "Vanished Horror")];
  const summary = summarizeEncounter(entries, monsters, four);
  const file = buildEncounterFile("Goblin Ambush", summary, four, NOW);

  it("has the envelope, the name and the party", () => {
    expect(file).toMatchObject({
      app: APP_NAME,
      kind: "encounter",
      format_version: FORMAT_VERSION,
      exported_at: NOW,
      name: "Goblin Ambush",
      party: { levels: [3, 3, 3, 3] },
    });
  });

  it("describes each row, flagging monsters the library lacks", () => {
    expect(file.entries).toEqual([
      { monster_id: GLOOMCAP, count: 3, name: "Gloomcap Shambler", in_library: true, counted: true },
      { monster_id: STALKER, count: 1, name: "Gravewick Stalker", in_library: true, counted: true },
      { monster_id: "long-gone", count: 2, name: "Vanished Horror", in_library: false, counted: false },
    ]);
  });

  it("repeats the panel's numbers, as snake_case", () => {
    expect(file.summary).toEqual({
      monster_count: 4,
      missing_count: 2,
      total_xp: 600,
      multiplier: 2,
      adjusted_xp: 1200,
      rating: "hard",
      party_size: 4,
      party_shift: null,
    });
  });

  it("includes each known monster's full stat block exactly once", () => {
    expect(file.monsters.map((m) => m.id)).toEqual([GLOOMCAP, STALKER]);
    expect(file.monsters[0]).toEqual(monsters.find((m) => m.id === GLOOMCAP));
  });

  it("copies the party instead of sharing the array", () => {
    file.party.levels.push(99);
    expect(four.levels).toEqual([3, 3, 3, 3]);
    file.party.levels.pop();
  });

  it("survives a JSON round trip", () => {
    expect(JSON.parse(toJsonText(file))).toEqual(file);
  });

  it("lists a monster that is in the library but cannot be counted, with its stat block", () => {
    const stalker = monsters.find((m) => m.id === STALKER)!;
    const broken: Monster = { ...stalker, challenge: { ...stalker.challenge, xp: Number.NaN } };
    const brokenSummary = summarizeEncounter([row(STALKER, 2)], [broken], four);
    const brokenFile = buildEncounterFile("Odd", brokenSummary, four, NOW);
    expect(brokenFile.entries[0]).toMatchObject({ in_library: true, counted: false });
    expect(brokenFile.monsters).toHaveLength(1);
    expect(brokenFile.summary).toMatchObject({ monster_count: 0, missing_count: 2, rating: null, multiplier: null });
  });

  it("handles an empty encounter", () => {
    const empty = buildEncounterFile("Encounter", summarizeEncounter([], monsters, four), four, NOW);
    expect(empty.entries).toEqual([]);
    expect(empty.monsters).toEqual([]);
    expect(empty.summary).toMatchObject({ monster_count: 0, rating: null, multiplier: null, adjusted_xp: 0 });
  });

  it("does not repeat a monster that is on two rows", () => {
    const twice = summarizeEncounter([row(GLOOMCAP, 1), row(GLOOMCAP, 2)], monsters, four);
    expect(buildEncounterFile("Dup", twice, four, NOW).monsters).toHaveLength(1);
  });
});
