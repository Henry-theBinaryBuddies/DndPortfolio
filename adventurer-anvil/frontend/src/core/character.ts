// The character file: only what was chosen. Derived values are never stored; they are recalculated.
// Every change returns a new document, so undo and comparison stay simple.
import type { ChoiceKey, ChoiceValue } from "./choices";

export interface PackRef {
  id: string;
  version: string;
}

/** A DM ruling that lets one specific rule problem stand. */
export interface Override {
  issueId: string;
  note: string;
  at: string;
}

/** A logged dice roll, e.g. rolled stats, so the DM can see the real results. */
export interface RollRecord {
  id: string;
  expression: string;
  /** Every die rolled, in order. */
  dice: number[];
  /** The dice that counted (all of them, unless the expression keeps the highest or lowest). */
  kept: number[];
  total: number;
  /** The choice the roll was made for. */
  for: ChoiceKey;
  /** Rolls made together (e.g. six for ability scores) share a set id. */
  set?: string;
  at: string;
}

export interface CharacterDocument {
  format: "adventurer-anvil-character";
  /** The core's file version; bumped only when this shape changes. */
  formatVersion: 1;
  id: string;
  name: string;
  /** Which rules, and which version of that system's data. */
  system: { id: string; version: number };
  packs: PackRef[];
  choices: Record<ChoiceKey, ChoiceValue>;
  overrides: Override[];
  rolls: RollRecord[];
  /** Reserved for play at the table (Milestone 3). The system module owns what goes in it. */
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const CHARACTER_FORMAT = "adventurer-anvil-character" as const;
export const CHARACTER_FORMAT_VERSION = 1 as const;

/** A fresh, empty character for a system. `now` and `id` are passed in so tests are repeatable. */
export function newCharacterDocument(args: {
  id: string;
  system: { id: string; version: number };
  packs: PackRef[];
  now: string;
  name?: string;
  choices?: Record<ChoiceKey, ChoiceValue>;
}): CharacterDocument {
  return {
    format: CHARACTER_FORMAT,
    formatVersion: CHARACTER_FORMAT_VERSION,
    id: args.id,
    name: args.name ?? "",
    system: args.system,
    packs: args.packs,
    choices: { ...(args.choices ?? {}) },
    overrides: [],
    rolls: [],
    state: {},
    createdAt: args.now,
    updatedAt: args.now,
  };
}

export function setChoice(doc: CharacterDocument, key: ChoiceKey, value: ChoiceValue, now: string): CharacterDocument {
  return { ...doc, choices: { ...doc.choices, [key]: value }, updatedAt: now };
}

/** Removes choices, e.g. the ones an evaluation reported as unused, once the user confirms. */
export function clearChoices(doc: CharacterDocument, keys: ChoiceKey[], now: string): CharacterDocument {
  const choices = { ...doc.choices };
  for (const key of keys) delete choices[key];
  return { ...doc, choices, updatedAt: now };
}

export function setName(doc: CharacterDocument, name: string, now: string): CharacterDocument {
  return { ...doc, name, updatedAt: now };
}

/** Adds or replaces the ruling for one issue. */
export function addOverride(doc: CharacterDocument, issueId: string, note: string, now: string): CharacterDocument {
  const overrides = doc.overrides.filter((o) => o.issueId !== issueId);
  overrides.push({ issueId, note, at: now });
  return { ...doc, overrides, updatedAt: now };
}

export function removeOverride(doc: CharacterDocument, issueId: string, now: string): CharacterDocument {
  return { ...doc, overrides: doc.overrides.filter((o) => o.issueId !== issueId), updatedAt: now };
}

export function addRoll(doc: CharacterDocument, roll: RollRecord, now: string): CharacterDocument {
  return { ...doc, rolls: [...doc.rolls, roll], updatedAt: now };
}

export function addRolls(doc: CharacterDocument, rolls: RollRecord[], now: string): CharacterDocument {
  return { ...doc, rolls: [...doc.rolls, ...rolls], updatedAt: now };
}

/** The roll sets made for a choice, oldest first: each a list of rolls sharing a set id. */
export function rollSets(doc: CharacterDocument, key: ChoiceKey): RollRecord[][] {
  const sets = new Map<string, RollRecord[]>();
  for (const roll of doc.rolls) {
    if (roll.for !== key) continue;
    const id = roll.set ?? roll.id;
    sets.set(id, [...(sets.get(id) ?? []), roll]);
  }
  return [...sets.values()];
}
