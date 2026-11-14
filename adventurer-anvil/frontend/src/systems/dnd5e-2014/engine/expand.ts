// ② Expand: apply a source's effects to the tally. A choice effect opens a choice on its step; what has been
// picked is applied too (a fixed-list pick fills in `each`, a collection pick is granted, a written-in option
// gives its own effects), so a picked entry with effects of its own (a feat, later) is expanded in turn.
import type { ChoiceSpec, Option } from "../../../core";
import type { ChoiceEffect, EachTemplate, Effect } from "../packFormat";
import { ABILITY_NAMES, choiceListValues, SKILLS, type ChoiceList, type Collection } from "../vocabulary";
import { fullRef, matchesWhere, picksOf, type Context, type Source } from "./context";
import { describeEffects } from "./describe";
import type { Origin } from "./tally";

/** Guards against an entry that (through choices and grants) ends up granting itself. */
const MAX_DEPTH = 6;

export function expandSource(ctx: Context, source: Source, depth = 0): void {
  for (const effect of source.effects) applyEffect(ctx, source, effect, undefined, depth);
}

function applyEffect(ctx: Context, source: Source, effect: Effect, choice: string | undefined, depth: number): void {
  const from: Origin = { name: source.name, step: source.step, choice };
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
    case "expertise":
      tally.expertise.push({ kind: effect.kind, id: effect.id, from });
      return;
    case "resistance":
      tally.resistances.push({ damage: effect.damage, from });
      return;
    case "armor-class":
      tally.acFormulas.push({ base: effect.base, abilities: effect.abilities, shield: effect.shield, from });
      return;
    case "armor-class-bonus":
      tally.acBonuses.push({ amount: effect.amount, while: effect.while, from });
      return;
    case "hit-points":
      tally.hitPoints.push({ perLevel: effect.perLevel, from });
      return;
    case "language":
      grant(ctx, source, "languages", fullRef(effect.id, source.pack), from, depth);
      return;
    case "grant":
      grant(ctx, source, effect.collection, fullRef(effect.id, source.pack), from, depth);
      return;
    case "resource": {
      const u = effect.uses;
      // Counts from the class (its table, its level) are known now; an ability modifier only once scores are derived.
      const uses =
        typeof u === "number" ? u
        : "column" in u ? Number(source.columns?.[u.column] ?? 0) || 0
        : "perLevel" in u ? u.perLevel * (source.classLevel ?? 1)
        : u;
      tally.resources.push({ id: effect.id, name: effect.name ?? effect.id, uses, recharge: effect.recharge, from });
      return;
    }
    case "feature":
      tally.features.push({ name: effect.name, summary: effect.summary, description: effect.description, source: effect.source, from });
      return;
    case "choice":
      openChoice(ctx, source, effect, depth);
      return;
  }
}

/** Grants an entry. A missing one is skipped here; the check stage reports it. */
function grant(ctx: Context, source: Source, collection: Collection, ref: string, from: Origin, depth: number): void {
  const entry = ctx.content.get(collection, ref);
  if (!entry) return;
  if (collection === "languages") ctx.tally.languages.push({ ref, name: entry.name, from });
  else ctx.tally.grants.push({ collection, ref, name: entry.name, from });

  const effects = (entry as { effects?: unknown }).effects;
  if (Array.isArray(effects) && depth < MAX_DEPTH) {
    expandSource(ctx, { key: `${source.key}.${entry.id}`, name: entry.name, step: source.step, pack: entry.pack, effects: effects as Effect[] }, depth + 1);
  }
}

export function openChoice(ctx: Context, source: Source, effect: ChoiceEffect, depth = 0): void {
  const key = `${source.key}.${effect.id}`;
  const picks = picksOf(ctx.doc.choices[key]);
  const from = effect.from;
  const spec: ChoiceSpec = {
    key,
    step: source.step,
    label: effect.label,
    source: source.name,
    kind: effect.pick === 1 ? "pick-one" : "pick-many",
    options: optionsFor(ctx, from),
    count: effect.pick === 1 ? undefined : { min: effect.pick, max: effect.pick },
    required: true,
  };
  ctx.open.push({
    spec, picks, effect,
    collection: "collection" in from ? from.collection : undefined,
    proficient: "proficient" in from ? from.proficient : undefined,
  });

  // Apply what was picked, even if a pick breaks a rule: the check stage reports it, and a DM may allow it.
  for (const pick of new Set(picks)) {
    if ("list" in from) {
      if (effect.each && choiceListValues(from.list).includes(pick)) applyEffect(ctx, source, fill(effect.each, pick), key, depth + 1);
    } else if ("proficient" in from) {
      const [kind, id] = pick.split(":");
      if ((kind === "skill" || kind === "tool") && id) applyEffect(ctx, source, { type: "expertise", kind, id }, key, depth + 1);
    } else if ("options" in from) {
      const option = from.options.find((o) => o.id === pick);
      for (const e of option?.effects ?? []) applyEffect(ctx, source, e as Effect, key, depth + 1);
    } else {
      grant(ctx, source, from.collection, pick, { name: source.name, step: source.step, choice: key }, depth + 1);
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
    case "expertise":
      return { type: "expertise", kind: "skill", id: pick };
  }
}

function optionsFor(ctx: Context, from: ChoiceEffect["from"]): Option[] {
  if ("list" in from) {
    return choiceListValues(from.list)
      .filter((v) => (!from.only || from.only.includes(v)) && !(from.except ?? []).includes(v))
      .map((v) => ({ value: v, name: listName(from.list, v) }));
  }
  if ("options" in from) {
    return from.options.map((o) => ({ value: o.id, name: o.name, summary: o.summary, description: o.description, tags: describeEffects(o.effects as Effect[]) }));
  }
  if ("proficient" in from) return []; // filled in by the check stage
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
