// ⑤ Check: mark options already owned, report rule problems, work out each step's status, and find
// choices left behind.
import type { ChoiceKey, ContentEntry, Option, StepReport } from "../../../core";
import type { Effect, Feat } from "../packFormat";
import { ABILITIES, ABILITY_NAMES, type Ability } from "../vocabulary";
import { fullRef, picksOf, type Context, type OpenChoice } from "./context";
import { originText } from "./tally";
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
    // A written-in option already chosen in another choice that offers it too (a second Fighting Style, Metamagic).
    const mine = effect.from.options;
    for (const other of ctx.open) {
      if (other === choice || !other.effect || !("options" in other.effect.from)) continue;
      for (const pick of other.picks) {
        const o = other.effect.from.options.find((x) => x.id === pick);
        if (o && mine.some((x) => x.id === o.id && x.name === o.name)) map.set(pick, { verb: "Already chosen", from: other.spec.source ?? other.spec.label });
      }
    }
  } else if (effect.from.collection === "spells") {
    spellsHad();
  } else if (effect.from.collection === "languages") {
    for (const l of ctx.tally.languages) if (notThis(l.from)) map.set(l.ref, { verb: "Already known", from: l.from.name });
  } else {
    // Had already, from elsewhere; a repeatable feat may be taken again.
    const collection = effect.from.collection;
    for (const g of ctx.tally.grants) {
      if (g.collection !== collection || !notThis(g.from)) continue;
      if (collection === "feats" && ctx.content.get("feats", g.ref)?.repeatable === true) continue;
      map.set(g.ref, { verb: "Already have", from: originText(g.from) });
    }
  }
  return map;
}

/** A choice effect with this id in a class's or subclass's levels (to name an option another choice needs). */
function findChoice(ctx: Context, sourceKey: string, id: string): Extract<Effect, { type: "choice" }> | undefined {
  const ref = sourceKey.slice(sourceKey.indexOf(".") + 1);
  const entry = (ctx.content.get("classes", ref) ?? ctx.content.get("subclasses", ref)) as (ContentEntry & { levels?: { effects: Effect[] }[] }) | undefined;
  for (const l of entry?.levels ?? []) {
    for (const e of l.effects) if (e.type === "choice" && e.id === id) return e;
  }
  return undefined;
}

/**
 * For a choice of written-in options: option id → what it still needs (an Eldritch Invocation's warlock level, its
 * Pact Boon, a cantrip known).
 */
function unmet(ctx: Context, choice: OpenChoice, scores: Record<Ability, number>): Map<string, string> {
  const map = new Map<string, string>();
  if (choice.collection === "feats") return featsUnmet(ctx, choice, scores);
  const effect = choice.effect;
  const source = choice.source;
  if (!effect || !source || !("options" in effect.from)) return map;
  for (const o of effect.from.options) {
    const r = o.requires;
    if (!r) continue;
    const needs: string[] = [];
    if (r.level !== undefined && (source.classLevel ?? 0) < r.level) needs.push(`${source.name} level ${r.level}`);
    if (r.option) {
      const key = `${source.key}.${r.option.choice}`;
      if (!picksOf(ctx.doc.choices[key]).includes(r.option.id)) {
        const other = findChoice(ctx, source.key, r.option.choice);
        const named = other && "options" in other.from ? other.from.options.find((x) => x.id === r.option!.id)?.name : undefined;
        needs.push(named ?? r.option.id);
      }
    }
    if (r.spell) {
      const ref = fullRef(r.spell, source.pack);
      if (!ctx.tally.spells.some((s) => s.ref === ref)) {
        const spell = ctx.content.get("spells", ref);
        needs.push(spell ? `the ${spell.name} ${Number(spell.level) === 0 ? "cantrip" : "spell"}` : r.spell);
      }
    }
    if (needs.length) map.set(o.id, `Needs ${needs.join(" and ")}`);
  }
  return map;
}

/** For a choice of feats: feat → what it still needs (scores, a proficiency, being able to cast a spell). */
function featsUnmet(ctx: Context, choice: OpenChoice, scores: Record<Ability, number>): Map<string, string> {
  const map = new Map<string, string>();
  for (const option of choice.spec.options ?? []) {
    const feat = ctx.content.get("feats", String(option.value)) as (ContentEntry & { requires?: Feat["requires"] }) | undefined;
    const r = feat?.requires;
    if (!r) continue;
    const needs: string[] = [];
    for (const a of r.abilities ?? []) if (scores[a.ability] < a.min) needs.push(`${ABILITY_NAMES[a.ability]} ${a.min} (you have ${scores[a.ability]})`);
    if (r.proficiency && !ctx.tally.proficiencies.some((p) => p.kind === r.proficiency!.kind && p.id === r.proficiency!.id && !p.replaced)) {
      needs.push(`proficiency with ${r.proficiency.kind === "armor" ? `${r.proficiency.id} armour` : r.proficiency.id.replace(/-/g, " ")}`);
    }
    // A class that casts counts even before its spells are picked.
    if (r.spellcasting && ctx.tally.casting.length === 0 && ctx.tally.spells.length === 0) needs.push("the ability to cast at least one spell");
    if (needs.length) map.set(String(option.value), `Needs ${needs.join(" and ")}`);
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
    const needs = unmet(ctx, choice, scores);
    spec.options = spec.options?.map((option): Option => {
      const o = have.get(String(option.value));
      if (o) return { ...option, unavailable: `${o.verb} (${o.from})` };
      const need = needs.get(String(option.value));
      return need ? { ...option, unavailable: need } : option;
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
                  // Named where the content is known ("Chain Mail is not one of the options"), else as stored.
                  message: `${spec.label}: ${(choice.collection && ctx.content.get(choice.collection, pick)?.name) || `"${pick}"`} is not one of the options.`,
                },
          );
        } else if (option.unavailable) {
          const needed = needs.has(pick) && !have.has(pick);
          ctx.issues.push({
            id: `${needed ? "needs" : "already-have"}:${spec.key}:${pick}`, severity: "error", step: spec.step, key: spec.key, overridable: true,
            message: `${spec.label}: ${option.name}: ${option.unavailable.charAt(0).toLowerCase()}${option.unavailable.slice(1)}.`,
          });
        }
      }
    }
  }

  // A bonus that may not raise a score above a cap (an Ability Score Improvement's 20).
  const capped = new Set<Ability>();
  for (const b of ctx.tally.abilityBonuses) {
    if (b.cap === undefined || scores[b.ability] <= b.cap) continue;
    capped.add(b.ability);
    ctx.issues.push({
      id: `above-cap:${b.from.choice ?? b.from.name}:${b.ability}`, severity: "error", step: b.from.step ?? "abilities", key: b.from.choice, overridable: true,
      message: `${b.from.name}: ${ABILITY_NAMES[b.ability]} would be ${scores[b.ability]}, but this can't raise a score above ${b.cap}.`,
    });
  }

  for (const ability of ABILITIES) {
    if (scores[ability] > 20 && !capped.has(ability)) {
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
