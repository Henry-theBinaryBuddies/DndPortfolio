// ② Expand: apply a source's effects to the tally. A choice effect opens a choice on its step; what has been
// picked is applied too (a fixed-list pick fills in `each`; a collection pick is granted), so a picked entry
// with effects of its own (a feat, later) is expanded in turn.
import type { ChoiceSpec, Option } from "../../../core";
import type { EachTemplate, Effect } from "../packFormat";
import { ABILITY_NAMES, choiceListValues, SKILLS, type ChoiceList, type Collection } from "../vocabulary";
import { fullRef, matchesWhere, picksOf, type Context, type Source } from "./context";
import type { Origin } from "./tally";

/** Guards against an entry that (through choices and grants) ends up granting itself. */
const MAX_DEPTH = 6;

export function expandSource(ctx: Context, source: Source, depth = 0): void {
  for (const effect of source.effects) applyEffect(ctx, source, effect, undefined, depth);
}

function applyEffect(ctx: Context, source: Source, effect: Effect, choice: string | undefined, depth: number): void {
  const from: Origin = { name: source.name, choice };
  const { tally } = ctx;
  switch (effect.type) {
    case "ability-bonus":
      tally.abilityBonuses.push({ ability: effect.ability, amount: effect.amount, from });
      return;
    case "speed":
      for (const mode of ["walk", "fly", "swim", "climb", "burrow"] as const) {
        const value = (effect as Record<string, unknown>)[mode];
        if (typeof value === "number") tally.speeds.push({ mode, value, from });
      }
      return;
    case "sense":
      tally.senses.push({ sense: effect.sense, range: effect.range, from });
      return;
    case "proficiency":
      tally.proficiencies.push({ kind: effect.kind, id: effect.id, from });
      return;
    case "resistance":
      tally.resistances.push({ damage: effect.damage, from });
      return;
    case "language":
      grant(ctx, source, "languages", fullRef(effect.id, source.pack), from, depth);
      return;
    case "grant":
      grant(ctx, source, effect.collection, fullRef(effect.id, source.pack), from, depth);
      return;
    case "resource":
      tally.resources.push({ id: effect.id, name: effect.name ?? effect.id, uses: effect.uses, recharge: effect.recharge, from });
      return;
    case "feature":
      tally.features.push({ name: effect.name, summary: effect.summary, source: effect.source, from });
      return;
    case "choice":
      openChoice(ctx, source, effect, depth);
      return;
  }
}

/** Grants an entry. A missing one is skipped here; the check stage reports it. */
function grant(ctx: Context, source: Source, collection: Collection, ref: string, from: Origin, depth: number): void {
  const entry = ctx.content.get(ref);
  if (!entry) return;
  if (collection === "languages") ctx.tally.languages.push({ ref, name: entry.name, from });
  else ctx.tally.grants.push({ collection, ref, name: entry.name, from });

  const effects = (entry as { effects?: unknown }).effects;
  if (Array.isArray(effects) && depth < MAX_DEPTH) {
    expandSource(ctx, { key: `${source.key}.${entry.id}`, name: entry.name, step: source.step, pack: entry.pack, effects: effects as Effect[] }, depth + 1);
  }
}

function openChoice(ctx: Context, source: Source, effect: Extract<Effect, { type: "choice" }>, depth: number): void {
  const key = `${source.key}.${effect.id}`;
  const picks = picksOf(ctx.doc.choices[key]);
  const spec: ChoiceSpec = {
    key,
    step: source.step,
    label: effect.label,
    source: source.name,
    kind: effect.pick === 1 ? "pick-one" : "pick-many",
    options: optionsFor(ctx, effect.from),
    count: effect.pick === 1 ? undefined : { min: effect.pick, max: effect.pick },
    required: true,
  };
  const collection = "collection" in effect.from ? effect.from.collection : undefined;
  ctx.open.push({ spec, picks, collection, effect });

  // Apply what was picked, even if a pick breaks a rule: the check stage reports it, and a DM may allow it.
  for (const pick of new Set(picks)) {
    if ("list" in effect.from) {
      if (effect.each && choiceListValues(effect.from.list).includes(pick)) {
        applyEffect(ctx, source, fill(effect.each, pick), key, depth + 1);
      }
    } else {
      grant(ctx, source, effect.from.collection, pick, { name: source.name, choice: key }, depth + 1);
    }
  }
}

/** Fills the blank field of an `each` template with a pick. */
function fill(each: EachTemplate, pick: string): Effect {
  switch (each.type) {
    case "ability-bonus":
      return { ...each, ability: pick as Extract<Effect, { type: "ability-bonus" }>["ability"] };
    case "proficiency":
      return { ...each, id: pick };
    case "resistance":
      return { ...each, damage: pick as Extract<Effect, { type: "resistance" }>["damage"] };
  }
}

type ChoiceFrom = Extract<Effect, { type: "choice" }>["from"];

function optionsFor(ctx: Context, from: ChoiceFrom): Option[] {
  if ("list" in from) {
    return choiceListValues(from.list)
      .filter((v) => (!from.only || from.only.includes(v)) && !(from.except ?? []).includes(v))
      .map((v) => ({ value: v, name: listName(from.list, v) }));
  }
  return ctx.content
    .list(from.collection)
    .filter((entry) => matchesWhere(entry, from.where))
    .map((entry) => ({ value: entry.ref, name: entry.name, summary: typeof entry.summary === "string" ? entry.summary : undefined }));
}

export function listName(list: ChoiceList, value: string): string {
  if (list === "abilities") return ABILITY_NAMES[value as keyof typeof ABILITY_NAMES] ?? value;
  if (list === "skills") return SKILLS[value as keyof typeof SKILLS]?.name ?? value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
