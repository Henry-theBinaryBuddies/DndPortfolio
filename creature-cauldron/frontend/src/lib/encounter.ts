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

/**
 * A named, stored encounter. The id never changes and is never shown: it is how the
 * encounter card knows which saved encounter it is editing, so renaming works.
 */
export interface SavedEncounter {
  id: string;
  name: string;
  favorite: boolean;
  entries: EncounterEntry[];
}

/**
 * The encounter being built on the card. "id" is the saved encounter it came from,
 * or null if it has never been saved. "name" is what is typed in the name box; blank
 * means "keep the saved name" for a loaded encounter, or "use the next default name"
 * for a new one.
 */
export interface WorkingEncounter {
  id: string | null;
  name: string;
  favorite: boolean;
  entries: EncounterEntry[];
}

/** Both pieces of encounter state that change together (saving, deleting and starring touch both). */
export interface EncounterState {
  saved: SavedEncounter[];
  working: WorkingEncounter;
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

/**
 * Trims spaces, turns any run of spaces into one, and cuts to MAX_NAME_LENGTH. Collapsing
 * matters because a page shows "Boss  fight" and "Boss fight" identically, so they must
 * count as the same name.
 */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH).trimEnd();
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

// ---- The working encounter and the saved ones ----
//
// Every function here takes the state and returns NEW state (or the very same object
// when nothing changed), so the screen code only has to store what comes back.

export function emptyWorking(): WorkingEncounter {
  return { id: null, name: "", favorite: false, entries: [] };
}

/** A fresh id. crypto.randomUUID only exists on secure pages (https or localhost), hence the fallback. */
export function generateId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID();
  return `enc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The first "Encounter N" not already taken, starting from the number of saved encounters plus one. */
export function defaultEncounterName(saved: SavedEncounter[]): string {
  let n = saved.length + 1;
  while (saved.some((s) => sameName(s.name, `Encounter ${n}`))) n++;
  return `Encounter ${n}`;
}

/** The saved encounter the card is editing, if it still exists (it may have been deleted since). */
export function linkedSave(saved: SavedEncounter[], working: WorkingEncounter): SavedEncounter | undefined {
  return working.id === null ? undefined : saved.find((s) => s.id === working.id);
}

/**
 * The name a save will use: what was typed. A blank box keeps the name of the saved
 * encounter being edited (clearing the box is not a request to rename it), and for a
 * never-saved encounter becomes the next default, "Encounter N".
 */
export function resolvedName(saved: SavedEncounter[], working: WorkingEncounter): string {
  return cleanName(working.name) || linkedSave(saved, working)?.name || defaultEncounterName(saved);
}

/** Is the typed name already used by a DIFFERENT saved encounter? (Keeping your own name is fine.) */
export function nameConflict(saved: SavedEncounter[], working: WorkingEncounter): boolean {
  const typed = cleanName(working.name);
  return typed !== "" && saved.some((s) => s.id !== working.id && sameName(s.name, typed));
}

/** The rows as plain [id, count] pairs, for comparing two encounters (the display-name copy is ignored). */
function rowKey(entries: EncounterEntry[]): string {
  return JSON.stringify(entries.map((entry) => [entry.monsterId, entry.count]));
}

/**
 * Does the card hold work that is not saved? A never-saved encounter counts once it has rows.
 * A loaded one counts when its name or rows differ from the saved copy. Starring is not a
 * change: it is saved the moment you press the star.
 */
export function isDirty(saved: SavedEncounter[], working: WorkingEncounter): boolean {
  const linked = linkedSave(saved, working);
  if (!linked) return working.entries.length > 0;
  return resolvedName(saved, working) !== linked.name || rowKey(working.entries) !== rowKey(linked.entries);
}

/** Saving needs rows, a name no other save uses, and either an existing save to update or room for a new one. */
export function canSave(saved: SavedEncounter[], working: WorkingEncounter): boolean {
  if (working.entries.length === 0 || nameConflict(saved, working)) return false;
  return linkedSave(saved, working) !== undefined || saved.length < MAX_SAVED;
}

/**
 * Saves the card. A loaded encounter is updated in place (so renaming renames it); a new
 * one is added with a fresh id. The card then shows the name that was actually used.
 */
export function saveWorking(state: EncounterState, makeId: () => string = generateId): EncounterState {
  const { saved, working } = state;
  if (!canSave(saved, working)) return state;

  const name = resolvedName(saved, working);
  // Copy the rows, so later changes to the card can never alter the saved copy.
  const entries = working.entries.map((entry) => ({ ...entry }));
  const linked = linkedSave(saved, working);

  if (linked) {
    return {
      saved: saved.map((s) => (s.id === linked.id ? { ...s, name, entries, favorite: working.favorite } : s)),
      working: { ...working, name },
    };
  }
  const id = makeId();
  return {
    saved: [...saved, { id, name, favorite: working.favorite, entries }],
    working: { ...working, id, name },
  };
}

/** Puts a saved encounter on the card (as copies). Unknown ids change nothing. */
export function loadSaved(state: EncounterState, id: string): EncounterState {
  const found = state.saved.find((s) => s.id === id);
  if (!found) return state;
  return {
    saved: state.saved,
    working: {
      id: found.id,
      name: found.name,
      favorite: found.favorite,
      entries: found.entries.map((entry) => ({ ...entry })),
    },
  };
}

/** Deletes a saved encounter. If it is the one on the card, the card keeps its rows but becomes unsaved. */
export function deleteSaved(state: EncounterState, id: string): EncounterState {
  if (!state.saved.some((s) => s.id === id)) return state;
  return {
    saved: state.saved.filter((s) => s.id !== id),
    working: state.working.id === id ? { ...state.working, id: null } : state.working,
  };
}

/** Stars or unstars a saved encounter, and the card too if it is showing that one. */
export function toggleSavedFavorite(state: EncounterState, id: string): EncounterState {
  const found = state.saved.find((s) => s.id === id);
  if (!found) return state;
  const favorite = !found.favorite;
  return {
    saved: state.saved.map((s) => (s.id === id ? { ...s, favorite } : s)),
    working: state.working.id === id ? { ...state.working, favorite } : state.working,
  };
}

/** The star on the card: saved at once if the encounter is saved, otherwise kept until you save it. */
export function toggleWorkingFavorite(state: EncounterState): EncounterState {
  const linked = linkedSave(state.saved, state.working);
  return linked ? toggleSavedFavorite(state, linked.id) : { ...state, working: { ...state.working, favorite: !state.working.favorite } };
}

/** Starts a fresh, unsaved encounter. The saved list is untouched. */
export function startNewEncounter(state: EncounterState): EncounterState {
  return { saved: state.saved, working: emptyWorking() };
}

/** Saved encounters for the list: starred first, otherwise in the order they were saved. */
export function orderForList(saved: SavedEncounter[]): SavedEncounter[] {
  return [...saved.filter((s) => s.favorite), ...saved.filter((s) => !s.favorite)];
}
