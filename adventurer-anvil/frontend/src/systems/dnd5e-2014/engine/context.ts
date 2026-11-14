// The state one evaluation builds up as it runs through the pipeline (sources → expand → tally → derive → check).
import type { CharacterDocument, ChoiceSpec, ChoiceValue, ContentIndex, Issue } from "../../../core";
import type { Effect } from "../packFormat";
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
}

export interface Context {
  doc: CharacterDocument;
  content: ContentIndex;
  tally: Tally;
  open: OpenChoice[];
  issues: Issue[];
  /** Step ids in order, with labels. */
  steps: { id: string; label: string }[];
}

export function newContext(doc: CharacterDocument, content: ContentIndex): Context {
  return { doc, content, tally: emptyTally(), open: [], issues: [], steps: [] };
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

/** A `where` filter: a list field matches if it contains the value, any other field if it equals it. */
export function matchesWhere(entry: Record<string, unknown>, where: Record<string, string | number | boolean> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([field, wanted]) => {
    const have = entry[field];
    return Array.isArray(have) ? have.includes(wanted) : have === wanted;
  });
}
