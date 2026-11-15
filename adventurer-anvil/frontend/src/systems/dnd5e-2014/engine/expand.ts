// ② Expand: apply a source's effects to the tally. A choice effect opens a choice on its step; what has been
// picked is applied too (a fixed-list pick fills in `each`, a collection pick is granted, a written-in option
// gives its own effects), so a picked entry with effects of its own (a feat, later) is expanded in turn.
import type { ChoiceSpec, Option } from "../../../core";
import type { ChoiceEffect, EachTemplate, Effect, Spell } from "../packFormat";
import { ABILITY_NAMES, choiceListValues, SKILLS, type Ability, type ChoiceList, type Collection } from "../vocabulary";
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
    case "spell":
      grant(ctx, source, "spells", fullRef(effect.id, source.pack), from, depth, { ability: effect.ability, always: effect.always });
      return;
    case "expanded-spells":
      for (const id of effect.ids) tally.expandedSpells.push({ ref: fullRef(id, source.pack), from });
      return;
    case "choice":
      openChoice(ctx, source, effect, depth);
      return;
  }
}

/** How a granted spell is cast. */
export type SpellGrant = { ability?: Ability; always?: boolean };

/** Grants an entry. A missing one is skipped here; the check stage reports it. */
export function grant(ctx: Context, source: Source, collection: Collection, ref: string, from: Origin, depth: number, spell?: SpellGrant): void {
  const entry = ctx.content.get(collection, ref);
  if (!entry) return;
  if (collection === "languages") ctx.tally.languages.push({ ref, name: entry.name, from });
  else ctx.tally.grants.push({ collection, ref, name: entry.name, from });
  if (collection === "spells" && !ctx.tally.spells.some((s) => s.ref === ref)) {
    ctx.tally.spells.push({ ref, name: entry.name, level: Number(entry.level) || 0, from, ...spell });
  }

  const effects = (entry as { effects?: unknown }).effects;
  if (Array.isArray(effects) && depth < MAX_DEPTH) {
    expandSource(ctx, { key: `${source.key}.${entry.id}`, name: entry.name, step: source.step, pack: entry.pack, effects: effects as Effect[] }, depth + 1);
  }
}

export function openChoice(ctx: Context, source: Source, effect: ChoiceEffect, depth = 0): void {
  const key = `${source.key}.${effect.id}`;
  const picks = picksOf(ctx.doc.choices[key]);
  const from = effect.from;
  // Spell picks appear on the Spells step, drawn as a spell list, wherever they come from (a high elf's cantrip).
  const spells = "collection" in from && from.collection === "spells";
  const spec: ChoiceSpec = {
    key,
    step: spells ? "spells" : source.step,
    label: effect.label,
    source: source.name,
    kind: effect.pick === 1 ? "pick-one" : "pick-many",
    options: optionsFor(ctx, from),
    count: effect.pick === 1 ? undefined : { min: effect.pick, max: effect.pick },
    required: true,
    ...(spells ? { presentation: "list" as const } : {}),
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
      grant(ctx, source, from.collection, pick, { name: source.name, step: source.step, choice: key }, depth + 1, spells ? { ability: effect.ability } : undefined);
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
  const entries = ctx.content.list(from.collection).filter((entry) => matchesWhere(entry, from.where));
  if (from.collection === "spells") return entries.map((entry) => spellOption(entry as unknown as Spell & { ref: string }));
  return entries.map((entry) => ({ value: entry.ref, name: entry.name, summary: typeof entry.summary === "string" ? entry.summary : undefined }));
}

const ORDINALS = ["cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
/** "Cantrip", "1st level". */
export const spellLevelName = (level: number) => (level === 0 ? "Cantrip" : `${ORDINALS[level]} level`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A spell as an option: "Evocation cantrip · 1 action · 120 feet", tagged with its school, and Concentration or Ritual. */
export function spellOption(spell: Spell & { ref: string }): Option {
  const what = spell.level === 0 ? `${capital(spell.school)} cantrip` : `${ORDINALS[spell.level]}-level ${spell.school}`;
  const components = [spell.components.verbal && "V", spell.components.somatic && "S", spell.components.material && "M"].filter(Boolean).join(", ");
  return {
    value: spell.ref,
    name: spell.name,
    summary: [what, spell.castingTime, spell.range, spell.duration].join(" · "),
    description: [
      `Components: ${components}${spell.components.material ? ` (${spell.components.material})` : ""}.`,
      spell.description ?? "",
      spell.higherLevels ? `At higher levels. ${spell.higherLevels}` : "",
    ].filter(Boolean).join("\n\n"),
    tags: [capital(spell.school), ...(spell.concentration ? ["Concentration"] : []), ...(spell.ritual ? ["Ritual"] : [])],
  };
}

export function listName(list: ChoiceList, value: string): string {
  if (list === "abilities") return ABILITY_NAMES[value as keyof typeof ABILITY_NAMES] ?? value;
  if (list === "skills") return SKILLS[value as keyof typeof SKILLS]?.name ?? value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
