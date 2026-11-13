// The Abilities step: the six base scores, before any bonuses. Point buy, the standard array and rolling
// (designed with the Abilities screen in a later step) all end by writing the one choice "abilities.scores".
import { ABILITIES, ABILITY_NAMES, type Ability } from "../vocabulary";
import type { Context } from "../engine/context";

export const ABILITIES_STEP = { id: "abilities", label: "Abilities" };
export const SCORES_KEY = "abilities.scores";

/** The stored scores if they are six whole numbers from 1 to 30; otherwise null. */
export function readScores(value: unknown): Record<Ability, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const ok = ABILITIES.every((a) => Number.isInteger(v[a]) && (v[a] as number) >= 1 && (v[a] as number) <= 30);
  return ok ? (Object.fromEntries(ABILITIES.map((a) => [a, v[a]])) as Record<Ability, number>) : null;
}

/** Opens the scores choice and returns the base scores to use: the stored ones, or 10s until they are set. */
export function abilitiesStep(ctx: Context): Record<Ability, number> {
  ctx.steps.push(ABILITIES_STEP);
  const stored = ctx.doc.choices[SCORES_KEY];
  const scores = readScores(stored);
  ctx.open.push({
    spec: {
      key: SCORES_KEY, step: "abilities", label: "Set your ability scores", kind: "assign", required: true,
      slots: ABILITIES.map((a) => ({ id: a, name: ABILITY_NAMES[a] })),
    },
    picks: [],
    answered: scores !== null,
  });
  if (stored !== undefined && !scores) {
    ctx.issues.push({
      id: "bad-scores", severity: "error", step: "abilities", key: SCORES_KEY, overridable: false,
      message: "Ability scores must be six whole numbers from 1 to 30.",
    });
  }
  return scores ?? (Object.fromEntries(ABILITIES.map((a) => [a, 10])) as Record<Ability, number>);
}
