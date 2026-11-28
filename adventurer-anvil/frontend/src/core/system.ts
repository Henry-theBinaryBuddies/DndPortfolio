// The contract every system module meets, and the one function the app shell calls to see a character.
import type { CharacterDocument } from "./character";
import type { ChoiceKey, ChoiceValue } from "./choices";
import type { ContentIndex, IndexedPack } from "./content";
import type { PackFile } from "./pack";
import type { Evaluation, Issue, StepView } from "./evaluation";

/**
 * Checks a pack's contents for this system and lists what is wrong (empty when it is valid).
 * Called by readPack (pack.ts) after the wrapper is checked; `required` are the loaded packs this one
 * names in `requires`, so references into them can be followed.
 */
export interface PackSchema {
  validate(pack: PackFile, required: IndexedPack[]): string[];
}

/**
 * What the always-visible summary shows, in order. The system supplies it, so the app shell draws a summary
 * without knowing any game: tiles (big numbers), rows (label and value) or a list. Rows may add every derived
 * value whose key starts with `prefix.key` (one per attack, say), after the named ones.
 */
/** How a number is shown: "+3", "30 ft", "14 gp 5 sp" (a number of copper pieces), "81 lb". */
export type ValueFormat = "signed" | "feet" | "coins" | "pounds";

export type SummaryGroup =
  | { kind: "tiles"; label: string; items: { key: string; short: string }[] }
  | { kind: "rows"; label: string; items: { key: string; format?: ValueFormat }[]; prefix?: { key: string; format?: ValueFormat } }
  | { kind: "list"; label: string; list: string };

/**
 * One fact in the sheet's identity block: a chosen value (shown as its answer), a derived one, or a blank to write on
 * by hand (the label over an empty line).
 */
export type SheetField = { choice: string; label?: string } | { derived: string; label?: string; format?: ValueFormat } | { blank: string };

/**
 * A section of the character sheet. The system lays the sheet out; the app draws each kind without knowing the game:
 * identity (name, the list's words, portrait, and facts), tiles (big numbers with a second value under them), stats
 * (boxed numbers), checklist (derived values with their marks; `unmarked` says what no mark means), rows (label and
 * value, perhaps every derived value whose key starts with a prefix), list (a named list; `full` lists print their
 * long text when the reader asks for it), text (written choices, by key, with their labels), and records (the rows of
 * a records choice; "full-only" ones print only when the reader asks for long text).
 *
 * For a sheet filled in by hand at the table: blanks (labelled empty boxes, perhaps with a derived value written small
 * above, such as the most the box can hold), ticks (rows of boxes to tick), and split (columns inside a column).
 *
 * Shapes and options: `banner` draws the identity block as a band across the page; `tall` tiles stack in a column with
 * the note big and the value small under it; a stat's `shape` gives it a shield's outline; `inline` stats sit as a
 * number beside its label; `table` rows split each value into columns at `separator`; a list's `ticks` draws a box per
 * use after items that have uses, and `groupTicks` draws boxes after a group's heading, as many as the derived value it
 * names; `flow: "columns"` runs a long list in newspaper columns; an `inline` list is one paragraph of names; a
 * checklist's `trim` is cut from its labels (words its caption already says); text `boxes` gives every key its own box,
 * empty ones too, to write in. A ledger is a table of things carried (how many, the name, the weight: items' `count`
 * and `weight`) with empty lines to add more by hand, and a strip of boxes beside it (money, the total weight); it can
 * run down several tables side by side, keeping a group of rows together. `small` stats are a row of little boxes, and
 * `blankZero` leaves a nought empty, to write in; a `large` blank is a big box for notes.
 */
export type SheetSection =
  | { kind: "identity"; label: string; fields: SheetField[]; banner?: boolean }
  | { kind: "tiles"; label: string; items: { key: string; short: string; note?: string }[]; tall?: boolean }
  | { kind: "stats"; label: string; items: { key: string; label?: string; format?: ValueFormat; shape?: "shield" }[]; inline?: boolean; small?: boolean; blankZero?: boolean }
  | { kind: "checklist"; label: string; items: { key: string }[]; prefix?: { key: string }; unmarked: string; trim?: string }
  | { kind: "rows"; label: string; items: { key: string; format?: ValueFormat }[]; prefix?: { key: string; format?: ValueFormat }; table?: { columns: string[]; separator: string } }
  | { kind: "list"; label: string; list: string; full?: boolean; ticks?: boolean; groupTicks?: Record<string, string>; flow?: "columns"; inline?: boolean }
  | { kind: "text"; label: string; keys: string[]; boxes?: boolean }
  | { kind: "records"; label: string; key: string; newestFirst?: boolean; print?: "full-only" }
  | { kind: "blanks"; label: string; items: { label: string; above?: { key: string; label: string; format?: ValueFormat }; large?: boolean }[] }
  | { kind: "ticks"; label: string; rows: { label: string; count: number }[] }
  | { kind: "portrait"; label: string }
  | { kind: "split"; label: string; columns: SheetSection[][] }
  | {
      kind: "ledger"; label: string; list: string;
      /** The table's three column headings: how many, what, how heavy. */
      columns: [string, string, string];
      /** Boxes down the side (or across the top), each a derived value (left empty when there is none, to write in). */
      side: { key: string; label: string; format?: ValueFormat }[];
      sideAcross?: boolean;
      /** Side by side tables the rows run down in turn, and how many lines each has at least (blank ones to write on). */
      split?: number;
      lines?: number;
      /** Tick-box columns after the name, one per flag: ticked when the item has it, empty to tick by hand otherwise. */
      checks?: { flag: string; short: string; name: string }[];
    };

/**
 * A file a character can be exported as. `build` is pure: it returns the file's name, type and text, and anything the
 * person should know first (an unfinished character), which the app shows before downloading.
 */
export interface Exporter {
  id: string;
  /** The button's words, e.g. "Export for Tome & Tile". */
  label: string;
  build(doc: CharacterDocument, content: ContentIndex): { fileName: string; mediaType: string; text: string; warnings: string[] };
}

/**
 * A page of the sheet: printed on its own page, one column on a phone. A band across the top (`header`), then side by
 * side `columns`, then `sections` across the page's full width. `onlyWithList`: the page is left out unless that list
 * has something in it (a page only some characters need, say).
 */
export interface SheetPage {
  label: string;
  header?: SheetSection[];
  columns?: SheetSection[][];
  sections?: SheetSection[];
  onlyWithList?: string;
}

/** Every section on a page, in reading order, including those inside splits. */
export function sheetSections(page: SheetPage): SheetSection[] {
  const flat = (sections: SheetSection[]): SheetSection[] => sections.flatMap((s) => (s.kind === "split" ? [s, ...flat(s.columns.flat())] : [s]));
  return flat([...(page.header ?? []), ...(page.columns ?? []).flat(), ...(page.sections ?? [])]);
}

export interface SystemModule {
  id: string;
  /** The version of this system's character data; `migrate` brings older files up to it. */
  version: number;
  title: string;
  packSchema: PackSchema;
  /** The summary's layout. */
  summary: SummaryGroup[];
  /** The character sheet, page by page. Without it, the app offers no sheet. */
  sheet?: SheetPage[];
  /** Files a character can be exported as, for other programs (a virtual table). */
  exporters?: Exporter[];
  /** Lists shown on a step's own page, after its choices (e.g. what the chosen class gives), by step id. */
  stepLists?: Record<string, { label: string; list: string }[]>;
  /** Choices a new character starts with. */
  initialChoices(): Record<ChoiceKey, ChoiceValue>;
  /** Pure: reads the file and the content, returns the whole picture, changes nothing. */
  evaluate(doc: CharacterDocument, content: ContentIndex): Evaluation;
  /** Upgrades a file written by an older version of this system. */
  migrate(doc: CharacterDocument): CharacterDocument;
  /** How a character appears in lists of saved characters. */
  describe(doc: CharacterDocument, content: ContentIndex): CharacterBlurb;
  /**
   * For games where characters advance: the choices to change to take the next step up, and the step to show them on;
   * or why it can't be done yet. Without it, the app offers no such button.
   */
  levelUp?(doc: CharacterDocument, content: ContentIndex): LevelUp;
}

/** `label`: the button's words, e.g. "Level up to 6". */
export type LevelUp = { ok: true; label: string; choices: Record<ChoiceKey, ChoiceValue>; step: string } | { ok: false; reason: string };

/** A few words, e.g. "Hill Dwarf Cleric 1" (empty when nothing is chosen yet), and the portrait, if one was added. */
export interface CharacterBlurb {
  text: string;
  /** A data URL. */
  picture?: string;
}

/** An issue as the app shell sees it: with the DM's ruling, if there is one. */
export interface ResolvedIssue extends Issue {
  override?: { note: string; at: string };
}

export interface CharacterView extends Omit<Evaluation, "issues" | "steps"> {
  steps: StepView[];
  issues: ResolvedIssue[];
  /** Rulings whose issue no longer arises (kept in the file, shown on Review). */
  staleOverrides: string[];
}

/**
 * Evaluates a character and applies its overrides. This is the generic part every system shares:
 * an overridden issue stays listed (so the sheet can mark it) but no longer makes its step a problem.
 */
export function viewCharacter(system: SystemModule, doc: CharacterDocument, content: ContentIndex): CharacterView {
  if (doc.system.id !== system.id) {
    throw new Error(`This character uses the system "${doc.system.id}", not "${system.id}".`);
  }
  const current = doc.system.version < system.version ? system.migrate(doc) : doc;
  const evaluation = system.evaluate(current, content);

  const rulings = new Map(current.overrides.map((o) => [o.issueId, o]));
  const issues: ResolvedIssue[] = evaluation.issues.map((issue) => {
    const ruling = issue.overridable ? rulings.get(issue.id) : undefined;
    return ruling ? { ...issue, override: { note: ruling.note, at: ruling.at } } : issue;
  });

  const openErrors = new Set(issues.filter((i) => i.severity === "error" && !i.override).map((i) => i.step));
  const steps: StepView[] = evaluation.steps.map((step) => ({
    ...step,
    status: openErrors.has(step.id) ? "problem" : step.status,
  }));

  const arising = new Set(evaluation.issues.map((i) => i.id));
  const staleOverrides = current.overrides.filter((o) => !arising.has(o.issueId)).map((o) => o.issueId);

  return { ...evaluation, steps, issues, staleOverrides };
}
