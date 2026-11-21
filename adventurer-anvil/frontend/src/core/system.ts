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

export interface SystemModule {
  id: string;
  /** The version of this system's character data; `migrate` brings older files up to it. */
  version: number;
  title: string;
  packSchema: PackSchema;
  /** The summary's layout. */
  summary: SummaryGroup[];
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
