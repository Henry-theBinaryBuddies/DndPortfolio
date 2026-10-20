import type { Monster } from "../types/monster";
import { label } from "./options";
import { adjustedXp, encounterMultiplier, partyThresholds, rateEncounter, type Party, type Rating } from "./party";

// The encounter builder's logic: pure functions with no React and no storage.
// "Pure" means the same input always gives the same output and nothing outside
// changes. That is why this file is easy to test, and why the screen code stays thin.
//
// Every function that "changes" a list returns a NEW list and leaves the old one
// alone. React redraws when it sees a new array. Where nothing needs to change, the
// SAME array comes back, which means "nothing changed, don't redraw or re-save".
//
// This file must not import storage.ts: storage.ts imports from here, so the
// other direction would be a circular import.

export const MIN_COUNT = 1;
/** Per row. Also stops a hand-edited 1e9 in storage from building an enormous list. */
export const MAX_COUNT = 99;
/** Different monsters in one encounter. */
export const MAX_ENTRIES = 40;
export const MAX_NAME_LENGTH = 80;
/** Saved encounters. */
export const MAX_SAVED = 100;

/** One row of an encounter. Holds ids and counts, never XP: XP is looked up in the library every time. */
export interface EncounterEntry {
  monsterId: string; // may be stale: never assume the library has it
  count: number; // whole number, MIN_COUNT to MAX_COUNT
  name?: string; // display-only snapshot, used only if the library no longer has the monster
}

/** A named, stored encounter. The name is its identity: saving the same name again replaces it. */
export interface SavedEncounter {
  name: string;
  entries: EncounterEntry[];
}

/** A row paired with its monster, or undefined when the library does not have that id. */
export interface EncounterLine {
  entry: EncounterEntry;
  monster: Monster | undefined;
  /** The monster's XP, or null when the row can't be counted (monster missing, or XP not a usable number). */
  xp: number | null;
}

/** Everything the panel shows. Worked out on every render from rows + library + party, never stored. */
export interface EncounterSummary {
  lines: EncounterLine[]; // same order as the entries
  monsterCount: number; // monsters actually counted: rows with a usable XP, times their counts
  missingCount: number; // monsters in rows that could not be counted (left out of the maths)
  totalXp: number; // before the multiplier
  multiplier: number | null; // null when nothing is counted: a multiplier for nothing means nothing
  adjustedXp: number; // totalXp times multiplier; 0 when nothing is counted
  rating: Rating | null; // null when nothing is counted. That is not the same as "trivial".
  partySize: number;
  /** Did the party size move the multiplier off the normal 4-character table? */
  partyShift: "up" | "down" | null;
}

/** Rounds to a whole number and clamps to MIN_COUNT..MAX_COUNT. NaN becomes MIN_COUNT. */
export function clampCount(count: number): number {
  if (Number.isNaN(count)) return MIN_COUNT;
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(count)));
}

/** Trims spaces and cuts to MAX_NAME_LENGTH. */
export function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH).trimEnd();
}

/** Are two names the same once cleaned, ignoring capital letters? */
export function sameName(a: string, b: string): boolean {
  return cleanName(a).toLowerCase() === cleanName(b).toLowerCase();
}

/** Can one more of this monster be added? False at the per-row limit, or when the encounter has too many different monsters. */
export function canAddMonster(entries: EncounterEntry[], monsterId: string): boolean {
  const row = entries.find((entry) => entry.monsterId === monsterId);
  return row ? row.count < MAX_COUNT : entries.length < MAX_ENTRIES;
}

/** Adds one of a monster: a new row, or one more on its existing row. */
export function addMonster(entries: EncounterEntry[], monster: Pick<Monster, "id" | "name">): EncounterEntry[] {
  if (!canAddMonster(entries, monster.id)) return entries;
  const name = cleanName(monster.name);
  if (entries.some((entry) => entry.monsterId === monster.id)) {
    return entries.map((entry) =>
      entry.monsterId === monster.id ? { ...entry, count: clampCount(entry.count + 1), name } : entry,
    );
  }
  return [...entries, { monsterId: monster.id, count: 1, name }];
}

/** Sets a row's count (rounded and clamped). Unknown ids and non-finite numbers change nothing. */
export function setCount(entries: EncounterEntry[], monsterId: string, count: number): EncounterEntry[] {
  if (!Number.isFinite(count)) return entries;
  const row = entries.find((entry) => entry.monsterId === monsterId);
  if (!row) return entries;
  const next = clampCount(count);
  if (next === row.count) return entries;
  return entries.map((entry) => (entry.monsterId === monsterId ? { ...entry, count: next } : entry));
}

export function removeMonster(entries: EncounterEntry[], monsterId: string): EncounterEntry[] {
  if (!entries.some((entry) => entry.monsterId === monsterId)) return entries;
  return entries.filter((entry) => entry.monsterId !== monsterId);
}

/** How many of this monster are in the encounter (0 if none). */
export function countOf(entries: EncounterEntry[], monsterId: string): number {
  return entries.find((entry) => entry.monsterId === monsterId)?.count ?? 0;
}

/** Total monsters in a list of rows, with no library lookup (for "5 monsters" in the saved list). */
export function totalMonsters(entries: EncounterEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.count, 0);
}

/** A monster's XP if it is a usable number (finite and not negative), otherwise null. Zero is usable. */
export function usableXp(monster: Monster | undefined): number | null {
  const xp = monster?.challenge.xp;
  return typeof xp === "number" && Number.isFinite(xp) && xp >= 0 ? xp : null;
}

/**
 * Works out everything the panel shows. A row whose monster the library lacks, or
 * whose XP is not a usable number, is simply left out of the maths and counted in
 * missingCount: the calculators do their work on what they can count.
 */
export function summarizeEncounter(
  entries: EncounterEntry[],
  monsters: readonly Monster[],
  party: Party,
): EncounterSummary {
  // A Map answers "which monster has this id?" instantly, once per row.
  const byId = new Map(monsters.map((m) => [m.id, m]));
  const lines: EncounterLine[] = entries.map((entry) => {
    const monster = byId.get(entry.monsterId);
    return { entry, monster, xp: usableXp(monster) };
  });

  // One XP value per monster, so 3 gloomcaps give [50, 50, 50] and adjustedXp counts all three for the multiplier.
  const xps: number[] = [];
  let missingCount = 0;
  for (const { entry, xp } of lines) {
    if (xp === null) {
      missingCount += entry.count;
    } else {
      for (let i = 0; i < entry.count; i++) xps.push(xp);
    }
  }

  const partySize = party.levels.length;
  const monsterCount = xps.length;
  const base = { lines, monsterCount, missingCount, partySize };
  if (monsterCount === 0) {
    return { ...base, totalXp: 0, multiplier: null, adjustedXp: 0, rating: null, partyShift: null };
  }

  const multiplier = encounterMultiplier(monsterCount, partySize);
  const normal = encounterMultiplier(monsterCount, 4);
  const adjusted = adjustedXp(xps, partySize);
  return {
    ...base,
    totalXp: xps.reduce((sum, xp) => sum + xp, 0),
    multiplier,
    adjustedXp: adjusted,
    rating: rateEncounter(adjusted, partyThresholds(party)),
    partyShift: multiplier > normal ? "up" : multiplier < normal ? "down" : null,
  };
}

/** "Hard", "Trivial", or "" when there is nothing to rate. */
export function describeRating(rating: Rating | null): string {
  return rating === null ? "" : label(rating);
}

// ---- Saved encounters ----

/** The first "Encounter N" not already taken, starting from the number of saved encounters plus one. */
export function defaultEncounterName(saved: SavedEncounter[]): string {
  let n = saved.length + 1;
  while (saved.some((s) => sameName(s.name, `Encounter ${n}`))) n++;
  return `Encounter ${n}`;
}

/** The name a save will use: what was typed, or the default when the box is blank. */
export function resolveSaveName(saved: SavedEncounter[], typed: string): string {
  return cleanName(typed) || defaultEncounterName(saved);
}

/** Does a saved encounter already have this typed name? A blank box never does (it gets a fresh default). */
export function hasSavedName(saved: SavedEncounter[], typed: string): boolean {
  return cleanName(typed) !== "" && saved.some((s) => sameName(s.name, typed));
}

/** Saving needs rows to save, and either room in the list or a name that replaces an existing save. */
export function canSave(saved: SavedEncounter[], typed: string, entries: EncounterEntry[]): boolean {
  return entries.length > 0 && (hasSavedName(saved, typed) || saved.length < MAX_SAVED);
}

/** Saves under the typed name (or a default one). The same name replaces the old save; otherwise it is added. */
export function saveEncounter(saved: SavedEncounter[], typed: string, entries: EncounterEntry[]): SavedEncounter[] {
  if (!canSave(saved, typed, entries)) return saved;
  const name = resolveSaveName(saved, typed);
  // Copy the rows so later changes to the working encounter can never alter the saved one.
  const snapshot: SavedEncounter = { name, entries: entries.map((entry) => ({ ...entry })) };
  if (saved.some((s) => sameName(s.name, name))) {
    return saved.map((s) => (sameName(s.name, name) ? snapshot : s));
  }
  return [...saved, snapshot];
}

export function deleteSaved(saved: SavedEncounter[], name: string): SavedEncounter[] {
  if (!saved.some((s) => sameName(s.name, name))) return saved;
  return saved.filter((s) => !sameName(s.name, name));
}
