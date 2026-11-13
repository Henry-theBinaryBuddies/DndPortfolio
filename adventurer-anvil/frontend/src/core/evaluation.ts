// What a system module gives back after recalculating a character.
import type { ChoiceKey, ChoiceSpec } from "./choices";

/** "problem" is added by the core (see viewCharacter), never by a system. */
export type StepStatus = "done" | "todo" | "problem";

/** A step as a system reports it: complete or not. Rule problems are reported separately, as issues. */
export interface StepReport {
  id: string;
  label: string;
  status: "done" | "todo";
  choices: ChoiceSpec[];
}

/** A step as the app shell sees it. */
export interface StepView extends Omit<StepReport, "status"> {
  status: StepStatus;
}

/** One line of a derived value's explanation, e.g. { label: "Base", amount: 10 }. */
export interface BreakdownLine {
  label: string;
  amount: number | string;
}

/** A calculated value, with why it is what it is. */
export interface Derived {
  value: number | string | boolean;
  label: string;
  breakdown: BreakdownLine[];
}

export interface Issue {
  /** Stable, so an override can name it, e.g. "multiclass-prereq:some-class". */
  id: string;
  severity: "error" | "warning";
  step: string;
  key?: ChoiceKey;
  message: string;
  /** False for problems no ruling can fix, such as a broken file. */
  overridable: boolean;
}

/** A named thing in a list (a language, a sense, a feature...), with where it came from. */
export interface ListItem {
  name: string;
  source: string;
  detail?: string;
}

export interface Evaluation {
  steps: StepReport[];
  derived: Record<string, Derived>;
  /** Lists of named things, by list name, e.g. "languages". */
  lists: Record<string, ListItem[]>;
  issues: Issue[];
  /** Choices still in the file that no open choice uses any more (e.g. after switching an earlier pick). */
  unused: ChoiceKey[];
}
