// The state one evaluation builds up as it runs through the pipeline (sources → expand → tally → derive → check).
import type { CharacterDocument, ChoiceSpec, ChoiceValue, ContentIndex, Issue } from "../../../core";
import type { Effect } from "../packFormat";
import { DEFAULT_RULES, type Rules } from "../steps/rules";
import type { Collection } from "../vocabulary";
import { emptyTally, type Tally } from "./tally";

/** Something in play on the character, whose effects apply: a race, a subrace, later a class level or a feat. */
export interface Source {
  /** The start of every choice key it opens, e.g. "race.srd-5.1:elf". */
  key: string;
  /** For breakdowns: "Elf". */
  name: string;
  /** The step its choices appear on. */
  step: string;
  /** Its pack, so plain ids in its effects ("elvish") resolve to "pack:elvish". */
  pack: string;
  effects: Effect[];
  /** For a class or subclass: its level, and its table's values at that level (resources may count from them). */
  classLevel?: number;
  columns?: Record<string, number | string>;
  /** For a class or subclass: the class level these effects come at, for people ("Fighter 3"). */
  at?: string;
  /** Ability bonuses from it may not raise a score above this (a feat's 20). */
  abilityCap?: number;
}

/** A choice on screen, with what has been picked so far. */
export interface OpenChoice {
  spec: ChoiceSpec;
  /** The picks as a list of option values (one for pick-one). */
  picks: string[];
  /** Picks from a collection: used to tell a missing entry from a merely invalid one. */
  collection?: Collection;
  /** The effect that opened it, when it came from a pack. */
  effect?: Extract<Effect, { type: "choice" }>;
  /** For picks among your proficiencies: which ones ("skill", "tool:thieves-tools"). The options are filled in by the check stage, once every proficiency is known. */
  proficient?: string[];
  /** For steps that store something other than picks (e.g. ability scores): is it answered? */
  answered?: boolean;
  /** The source that opened it, for options with prerequisites (a level in its class, another of its choices). */
  source?: Pick<Source, "key" | "name" | "pack" | "classLevel">;
}

export interface Context {
  doc: CharacterDocument;
  content: ContentIndex;
  tally: Tally;
  open: OpenChoice[];
  issues: Issue[];
  /** Step ids in order, with labels. */
  steps: { id: string; label: string }[];
  /** The optional rules in use, set by the Rules step. */
  rules: Rules;
}

export function newContext(doc: CharacterDocument, content: ContentIndex): Context {
  return { doc, content, tally: emptyTally(), open: [], issues: [], steps: [], rules: { ...DEFAULT_RULES } };
}

/** Whether an entry is offered under the rules in use: one that names an optional rule needs it on. */
export function allowedByRules(entry: object, rules: Rules): boolean {
  const rule = (entry as { rule?: unknown }).rule;
  return rule === undefined || (rule === "feats" && rules.feats);
}

/** A stored choice as a list of picks: "x" → ["x"], ["x","y"] → as is, anything else → []. */
export function picksOf(value: ChoiceValue | undefined): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

/** "elvish" from the pack "srd-5.1" → "srd-5.1:elvish"; a reference that already names a pack is kept. */
export function fullRef(id: string, pack: string): string {
  return id.includes(":") ? id : `${pack}:${id}`;
}

type WhereValue = string | number | boolean;

/**
 * A `where` filter: a list field matches if it contains the value, any other field if it equals it. A list of
 * wanted values matches if any of them does.
 */
export function matchesWhere(entry: Record<string, unknown>, where: Record<string, WhereValue | WhereValue[]> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([field, wanted]) => {
    const have = entry[field];
    return (Array.isArray(wanted) ? wanted : [wanted]).some((w) => (Array.isArray(have) ? have.includes(w) : have === w));
  });
}
