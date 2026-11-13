// Choices: what the user picks, types or rolls, and how a system describes an open choice to the app shell.

/** Any value that survives a round trip through JSON. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * A readable path made by the system module, naming where the choice came from,
 * e.g. "class.0.level.4.improvement". Keys are stable: the same source always gives the same key.
 */
export type ChoiceKey = string;

/** What was chosen. Content is referred to as "pack:entry" (see content.ts). */
export type ChoiceValue = JsonValue;

/** The generic kinds of choice the app shell knows how to draw. None belongs to any one game. */
export type ChoiceKind =
  | "pick-one" // one option from a list
  | "pick-many" // several options, within count
  | "number" // a number, within min and max
  | "text" // a short line
  | "long-text" // paragraphs
  | "assign" // put given values into slots (e.g. a fixed set of scores into stats)
  | "allocate" // spend a budget across slots, with a cost per value
  | "roll"; // dice whose result is logged

export interface Option {
  /** The value stored when this option is picked: usually a content reference "pack:entry". */
  value: ChoiceValue;
  name: string;
  /** One line for the list. */
  summary?: string;
  /** The full text, shown when the option is opened. */
  description?: string;
  /** Shown but not pickable, with the reason (the DM override can still unlock it). */
  unavailable?: string;
  /** Short facts shown as chips on the option, most important first. */
  tags?: string[];
}

/** A slot for "assign" and "allocate": e.g. one stat. */
export interface Slot {
  id: string;
  name: string;
}

export interface ChoiceSpec {
  key: ChoiceKey;
  /** Which step screen it appears on. */
  step: string;
  label: string;
  /** Why this choice exists, e.g. the trait or level that grants it. */
  source?: string;
  kind: ChoiceKind;
  options?: Option[];
  /** pick-many: how many to pick. */
  count?: { min: number; max: number };
  /** number: the allowed range. */
  range?: { min: number; max: number };
  /** assign and allocate: the slots to fill. */
  slots?: Slot[];
  /** assign: the values to place, one per slot. */
  values?: number[];
  /** allocate: the budget, and the cost of each value a slot may take. */
  budget?: { total: number; cost: Record<string, number> };
  /** roll: the dice expression, e.g. "4d6kh3" (see dice.ts). */
  dice?: string;
  required: boolean;
}
