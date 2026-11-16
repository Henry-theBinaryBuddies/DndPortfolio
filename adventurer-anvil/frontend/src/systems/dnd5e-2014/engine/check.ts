// ⑤ Check: mark options already owned, report rule problems, work out each step's status, and find
// choices left behind.
import type { ChoiceKey, Option, StepReport } from "../../../core";
import { ABILITIES, ABILITY_NAMES, type Ability } from "../vocabulary";
import type { Context, OpenChoice } from "./context";
import { listName } from "./expand";

/** For one open choice: option value → the source that already gives it (from anywhere but this choice). */
function owned(ctx: Context, choice: OpenChoice): Map<string, { verb: string; from: string }> {
  const map = new Map<string, { verb: string; from: string }>();
  const notThis = (from: { choice?: ChoiceKey }) => from.choice !== choice.spec.key;
  const effect = choice.effect;
  const spellsHad = () => {
    for (const s of ctx.tally.spells) if (notThis(s.from)) map.set(s.ref, { verb: "Already known", from: s.from.name });
  };
  if (!effect) {
    // The Spells step's own choices: a spell you already have from elsewhere can't be picked again.
    if (choice.collection === "spells") spellsHad();
    return map;
  }

  if ("list" in effect.from) {
    if (effect.from.list === "skills") {
      for (const p of ctx.tally.proficiencies) if (p.kind === "skill" && notThis(p.from) && !p.replaced) map.set(p.id, { verb: "Already proficient", from: p.from.name });
    } else if (effect.from.list === "damage-types") {
      for (const r of ctx.tally.resistances) if (notThis(r.from)) map.set(r.damage, { verb: "Already resistant", from: r.from.name });
    }
    // Ability bonuses stack with others, so no ability is ever "already owned".
  } else if ("proficient" in effect.from) {
    for (const e of ctx.tally.expertise) if (notThis(e.from)) map.set(`${e.kind}:${e.id}`, { verb: "Already expert", from: e.from.name });
  } else if ("options" in effect.from) {
    // Written-in options (a fighting style) are only ever given by their own choice.
  } else if (effect.from.collection === "spells") {
    spellsHad();
  } else if (effect.from.collection === "languages") {
    for (const l of ctx.tally.languages) if (notThis(l.from)) map.set(l.ref, { verb: "Already known", from: l.from.name });
  } else {
    const collection = effect.from.collection;
    for (const g of ctx.tally.grants) if (g.collection === collection && notThis(g.from)) map.set(g.ref, { verb: "Already have", from: g.from.name });
  }
  return map;
}

/** The options of a pick among your proficiencies: every matching one you have, from anywhere but this choice. */
function proficientOptions(ctx: Context, choice: OpenChoice): Option[] {
  const wanted = choice.proficient ?? [];
  const seen = new Set<string>();
  const options: Option[] = [];
  for (const p of ctx.tally.proficiencies) {
    if (p.kind !== "skill" && p.kind !== "tool") continue;
    const value = `${p.kind}:${p.id}`;
    if (seen.has(value) || !(wanted.includes(p.kind) || wanted.includes(value))) continue;
    seen.add(value);
    const name = p.kind === "skill" ? listName("skills", p.id) : p.id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    options.push({ value, name, summary: `Proficient (${p.from.name})` });
  }
  return options.sort((a, b) => a.name.localeCompare(b.name));
}

export function check(ctx: Context, scores: Record<Ability, number>): void {
  for (const choice of ctx.open) {
    if (choice.proficient) choice.spec.options = proficientOptions(ctx, choice);
  }
  for (const choice of ctx.open) {
    const { spec, picks } = choice;
    const have = owned(ctx, choice);
    spec.options = spec.options?.map((option): Option => {
      const o = have.get(String(option.value));
      return o ? { ...option, unavailable: `${o.verb} (${o.from})` } : option;
    });
    const options = spec.options ?? [];
    const min = spec.count?.min ?? 1;
    const max = spec.count?.max ?? 1;

    if (spec.kind === "pick-one" || spec.kind === "pick-many") {
      if (options.length === 0) {
        ctx.issues.push({
          id: `no-options:${spec.key}`, severity: "warning", step: spec.step, key: spec.key, overridable: false,
          message: `${spec.label}: the loaded packs have nothing to choose from yet.`,
        });
      }
      if (picks.length > 0 && (picks.length < min || picks.length > max)) {
        ctx.issues.push({
          id: `pick-count:${spec.key}`, severity: "error", step: spec.step, key: spec.key, overridable: true,
          message: `${spec.label}: choose ${min === max ? min : min === 0 ? `up to ${max}` : `${min} to ${max}`} (${picks.length} chosen).`,
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
        id: `score-above-20:${ability}`, severity: "warning", step: "abilities", overridable: true,
        message: `${ABILITY_NAMES[ability]} is ${scores[ability]}; scores normally top out at 20.`,
      });
    }
  }
}

/** A step is done when every required choice on it is answered (or has nothing to choose from). */
export function stepReports(ctx: Context): StepReport[] {
  return ctx.steps.map(({ id, label }) => {
    const choices = ctx.open.filter((c) => c.spec.step === id);
    const answered = (c: (typeof choices)[number]) => c.answered ?? c.picks.length > 0;
    const done = choices.every(
      (c) => !c.spec.required || answered(c) || (c.spec.options !== undefined && c.spec.options.length === 0),
    );
    return { id, label, status: done ? "done" : "todo", choices: choices.map((c) => ({ ...c.spec, answered: answered(c) })) };
  });
}

/** Choices stored in the file that nothing on screen asks for any more. */
export function unusedChoices(ctx: Context): ChoiceKey[] {
  const offered = new Set(ctx.open.map((c) => c.spec.key));
  return Object.keys(ctx.doc.choices).filter((key) => !offered.has(key));
}
