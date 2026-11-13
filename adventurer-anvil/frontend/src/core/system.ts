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

export interface SystemModule {
  id: string;
  /** The version of this system's character data; `migrate` brings older files up to it. */
  version: number;
  title: string;
  packSchema: PackSchema;
  /** Choices a new character starts with. */
  initialChoices(): Record<ChoiceKey, ChoiceValue>;
  /** Pure: reads the file and the content, returns the whole picture, changes nothing. */
  evaluate(doc: CharacterDocument, content: ContentIndex): Evaluation;
  /** Upgrades a file written by an older version of this system. */
  migrate(doc: CharacterDocument): CharacterDocument;
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
