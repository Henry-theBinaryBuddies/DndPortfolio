// ⑤ Check: mark options already owned, report rule problems, work out each step's status, and find
// choices left behind.
import type { ChoiceKey, Option, StepReport } from "../../../core";
import { ABILITIES, ABILITY_NAMES, type Ability } from "../vocabulary";
import type { Context, OpenChoice } from "./context";

/** For one open choice: option value → the source that already gives it (from anywhere but this choice). */
function owned(ctx: Context, choice: OpenChoice): Map<string, { verb: string; from: string }> {
  const map = new Map<string, { verb: string; from: string }>();
  const notThis = (from: { choice?: ChoiceKey }) => from.choice !== choice.spec.key;
  const effect = choice.effect;
  if (!effect) return map;

  if ("list" in effect.from) {
    if (effect.from.list === "skills") {
      for (const p of ctx.tally.proficiencies) if (p.kind === "skill" && notThis(p.from)) map.set(p.id, { verb: "Already proficient", from: p.from.name });
    } else if (effect.from.list === "damage-types") {
      for (const r of ctx.tally.resistances) if (notThis(r.from)) map.set(r.damage, { verb: "Already resistant", from: r.from.name });
    }
    // Ability bonuses stack with others, so no ability is ever "already owned".
  } else if (effect.from.collection === "languages") {
    for (const l of ctx.tally.languages) if (notThis(l.from)) map.set(l.ref, { verb: "Already known", from: l.from.name });
  } else {
    const collection = effect.from.collection;
    for (const g of ctx.tally.grants) if (g.collection === collection && notThis(g.from)) map.set(g.ref, { verb: "Already have", from: g.from.name });
  }
  return map;
}

export function check(ctx: Context, scores: Record<Ability, number>): void {
  for (const choice of ctx.open) {
    const { spec, picks } = choice;
    const have = owned(ctx, choice);
    spec.options = spec.options?.map((option): Option => {
      const o = have.get(String(option.value));
      return o ? { ...option, unavailable: `${o.verb} (${o.from})` } : option;
    });
    const options = spec.options ?? [];
    const want = spec.count?.min ?? 1;

    if (spec.kind === "pick-one" || spec.kind === "pick-many") {
      if (options.length === 0) {
        ctx.issues.push({
          id: `no-options:${spec.key}`, severity: "warning", step: spec.step, key: spec.key, overridable: false,
          message: `${spec.label}: the loaded packs have nothing to choose from yet.`,
        });
      }
      if (picks.length > 0 && picks.length !== want) {
        ctx.issues.push({
          id: `pick-count:${spec.key}`, severity: "error", step: spec.step, key: spec.key, overridable: true,
          message: `${spec.label}: choose ${want} (${picks.length} chosen).`,
        });
      }
      if (new Set(picks).size !== picks.length) {
        ctx.issues.push({
          id: `duplicate-pick:${spec.key}`, severity: "error", step: spec.step, key: spec.key, overridable: true,
          message: `${spec.label}: the same option is chosen twice.`,
        });
      }
      for (const pick of new Set(picks)) {
        const option = options.find((o) => o.value === pick);
        if (!option) {
          const missing = choice.collection !== undefined && !ctx.content.get(choice.collection, pick);
          ctx.issues.push(
            missing
              ? {
                  id: `missing-content:${spec.key}:${pick}`, severity: "error", step: spec.step, key: spec.key, overridable: false,
                  message: `${spec.label}: "${pick}" is not in any loaded pack.`,
                }
              : {
                  id: `invalid-pick:${spec.key}:${pick}`, severity: "error", step: spec.step, key: spec.key, overridable: true,
                  message: `${spec.label}: "${pick}" is not one of the options.`,
                },
          );
        } else if (option.unavailable) {
          ctx.issues.push({
            id: `already-have:${spec.key}:${pick}`, severity: "error", step: spec.step, key: spec.key, overridable: true,
            message: `${spec.label}: ${option.name}: ${option.unavailable.charAt(0).toLowerCase()}${option.unavailable.slice(1)}.`,
          });
        }
      }
    }
  }

  for (const ability of ABILITIES) {
    if (scores[ability] > 20) {
      ctx.issues.push({
        id: `score-above-20:${ability}`, severity: "warning", step: "abilities", key: "abilities.scores", overridable: true,
        message: `${ABILITY_NAMES[ability]} is ${scores[ability]}; scores normally top out at 20.`,
      });
    }
  }
}

/** A step is done when every required choice on it is answered (or has nothing to choose from). */
export function stepReports(ctx: Context): StepReport[] {
  return ctx.steps.map(({ id, label }) => {
    const choices = ctx.open.filter((c) => c.spec.step === id);
    const done = choices.every(
      (c) => !c.spec.required || (c.answered ?? c.picks.length > 0) || (c.spec.options !== undefined && c.spec.options.length === 0),
    );
    return { id, label, status: done ? "done" : "todo", choices: choices.map((c) => c.spec) };
  });
}

/** Choices stored in the file that nothing on screen asks for any more. */
export function unusedChoices(ctx: Context): ChoiceKey[] {
  const offered = new Set(ctx.open.map((c) => c.spec.key));
  return Object.keys(ctx.doc.choices).filter((key) => !offered.has(key));
}
