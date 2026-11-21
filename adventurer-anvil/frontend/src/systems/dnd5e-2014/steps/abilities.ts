// The Abilities step: choose a method, then set the six base scores with it. Each method's work is its own
// choice, so switching methods and back loses nothing; only the active method's scores count.
//
//   abilities.method          "standard-array" | "point-buy" | "roll"
//   abilities.standard-array  { str: 15, ... }   the array's values, one per ability
//   abilities.point-buy       { str: 8, ... }    scores 8 to 15, costing at most 27 points
//   abilities.roll            (no value: its rolls are in the roll log, six to a set)
//   abilities.rolled          { str: 15, ... }   the latest set's totals, one per ability
import { rollSets, type ChoiceSpec, type Slot } from "../../../core";
import type { Context } from "../engine/context";
import { picksOf } from "../engine/context";
import { ABILITIES, ABILITY_NAMES, type Ability } from "../vocabulary";

export const ABILITIES_STEP = { id: "abilities", label: "Abilities" };

export const METHOD_KEY = "abilities.method";
export const STANDARD_KEY = "abilities.standard-array";
export const POINT_BUY_KEY = "abilities.point-buy";
export const ROLL_KEY = "abilities.roll";
export const ROLLED_KEY = "abilities.rolled";

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY = { total: 27, min: 8, max: 15, cost: { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 } as Record<number, number> };
export const ROLL_DICE = "4d6kh3";

const METHODS = [
  { value: "standard-array", name: "Standard array" },
  { value: "point-buy", name: "Point buy" },
  { value: "roll", name: "Roll" },
];

export const ABILITY_SLOTS: Slot[] = ABILITIES.map((a) => ({ id: a, name: ABILITY_NAMES[a], derived: `ability.${a}`, derivedNote: `ability.${a}.mod` }));

type Partial6 = Partial<Record<Ability, number>>;

/** The stored scores as far as they go: whole numbers from 1 to 30 only. Null if the value is malformed. */
function readPartial(value: unknown): Partial6 | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Partial6 = {};
  for (const [k, v] of Object.entries(value)) {
    if (!(ABILITIES as readonly string[]).includes(k) || !Number.isInteger(v) || (v as number) < 1 || (v as number) > 30) return null;
    out[k as Ability] = v as number;
  }
  return out;
}

const complete = (s: Partial6) => ABILITIES.every((a) => s[a] !== undefined);

/** True if every given value can be taken from `pool` (each pool value used at most once). */
function drawnFrom(given: number[], pool: number[]): boolean {
  const left = [...pool];
  for (const v of given) {
    const at = left.indexOf(v);
    if (at < 0) return false;
    left.splice(at, 1);
  }
  return true;
}

/** Opens the step's choices, reports problems with the active method, and returns the base scores (10 where unset). */
export function abilitiesStep(ctx: Context): Record<Ability, number> {
  ctx.steps.push(ABILITIES_STEP);
  const method = picksOf(ctx.doc.choices[METHOD_KEY])[0];
  ctx.open.push({
    spec: { key: METHOD_KEY, step: "abilities", label: "How will you set your scores?", kind: "pick-one", presentation: "segmented", required: true, options: METHODS },
    picks: method ? [method] : [],
  });

  const issue = (id: string, key: string, message: string, overridable = true) =>
    ctx.issues.push({ id, severity: "error", step: "abilities", key, message, overridable });

  let scores: Partial6 = {};
  const open = (spec: ChoiceSpec, stored: Partial6 | null) => {
    ctx.open.push({ spec, picks: [], answered: stored !== null && complete(stored) });
    if (stored === null) issue("bad-scores", spec.key, "Ability scores must be whole numbers from 1 to 30.", false);
    scores = stored ?? {};
  };

  if (method === "standard-array") {
    const stored = readPartial(ctx.doc.choices[STANDARD_KEY]);
    open({ key: STANDARD_KEY, step: "abilities", label: "Give each value to an ability", kind: "assign", required: true, slots: ABILITY_SLOTS, values: STANDARD_ARRAY }, stored);
    if (stored && !drawnFrom(Object.values(stored), STANDARD_ARRAY)) {
      issue("standard-array", STANDARD_KEY, "The standard array is 15, 14, 13, 12, 10 and 8, each used once.");
    }
  } else if (method === "point-buy") {
    const stored = readPartial(ctx.doc.choices[POINT_BUY_KEY]);
    open(
      {
        key: POINT_BUY_KEY, step: "abilities", label: "Spend your points", kind: "allocate", required: true, slots: ABILITY_SLOTS,
        range: { min: POINT_BUY.min, max: POINT_BUY.max }, budget: { total: POINT_BUY.total, cost: POINT_BUY.cost },
      },
      stored,
    );
    if (stored) {
      const values = Object.values(stored);
      if (values.some((v) => v < POINT_BUY.min || v > POINT_BUY.max)) {
        issue("point-buy-range", POINT_BUY_KEY, "With point buy, each score is from 8 to 15 before your race's bonuses.");
      } else {
        const spent = values.reduce((sum, v) => sum + POINT_BUY.cost[v], 0);
        if (spent > POINT_BUY.total) issue("point-buy-over", POINT_BUY_KEY, `Point buy allows 27 points; these cost ${spent}.`);
      }
    }
  } else if (method === "roll") {
    const sets = rollSets(ctx.doc, ROLL_KEY);
    const latest = sets.at(-1)?.map((r) => r.total);
    ctx.open.push({
      spec: { key: ROLL_KEY, step: "abilities", label: "Roll 4d6 six times, dropping each lowest die", kind: "roll", dice: ROLL_DICE, times: ABILITIES.length, required: true },
      picks: [],
      answered: latest !== undefined,
    });
    if (latest) {
      const stored = readPartial(ctx.doc.choices[ROLLED_KEY]);
      open({ key: ROLLED_KEY, step: "abilities", label: "Give each total to an ability", kind: "assign", required: true, slots: ABILITY_SLOTS, values: latest }, stored);
      if (stored && !drawnFrom(Object.values(stored), latest)) {
        issue("rolled-mismatch", ROLLED_KEY, "These scores don't match your latest roll. Give its totals out again.");
      }
    }
  }

  return Object.fromEntries(ABILITIES.map((a) => [a, scores[a] ?? 10])) as Record<Ability, number>;
}
