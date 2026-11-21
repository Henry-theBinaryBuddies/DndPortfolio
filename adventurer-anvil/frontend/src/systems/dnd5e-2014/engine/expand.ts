// ② Expand: apply a source's effects to the tally. A choice effect opens a choice on its step; what has been
// picked is applied too (a fixed-list pick fills in `each`, a collection pick is granted, a written-in option
// gives its own effects), so a picked entry with effects of its own (a feat, later) is expanded in turn.
import type { ChoiceSpec, Option } from "../../../core";
import type { ChoiceEffect, EachTemplate, Effect, Spell } from "../packFormat";
import { ABILITY_SLOTS } from "../steps/abilities";
import { ABILITIES, ABILITY_NAMES, choiceListValues, SKILLS, type Ability, type ChoiceList, type Collection } from "../vocabulary";
import { fullRef, matchesWhere, picksOf, type Context, type Source } from "./context";
import { describeEffects } from "./describe";
import { originText, type Origin } from "./tally";

/** Guards against an entry that (through choices and grants) ends up granting itself. */
const MAX_DEPTH = 6;

export function expandSource(ctx: Context, source: Source, depth = 0): void {
  for (const effect of source.effects) applyEffect(ctx, source, effect, undefined, depth);
}

/** Where a source's choices say they come from: "Fighter 3", "Champion (Fighter 10)", "Elf". */
const sourceText = (source: Source) => originText({ name: source.name, at: source.at });

function applyEffect(ctx: Context, source: Source, effect: Effect, choice: string | undefined, depth: number): void {
  const from: Origin = { name: source.name, step: source.step, choice, ...(source.at ? { at: source.at } : {}) };
  const { tally } = ctx;
  switch (effect.type) {
    case "ability-bonus":
      tally.abilityBonuses.push({ ability: effect.ability, amount: effect.amount, from, ...(source.abilityCap ? { cap: source.abilityCap } : {}) });
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
      tally.hitPoints.push({ perLevel: effect.perLevel, from, ...(source.classLevel ? { classLevel: source.classLevel } : {}) });
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
    case "ability-score-improvement":
      openImprovement(ctx, source, effect.id);
      return;
  }
}

/** An Ability Score Improvement: 2 points, at most 2 to one score. */
export const IMPROVEMENT = { points: 2, max: 2, cap: 20 };

/** The stored increases ({ str: 2 } or { dex: 1, con: 1 }); null if malformed. Zeros are allowed and ignored. */
function readImprovement(value: unknown): Partial<Record<Ability, number>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Partial<Record<Ability, number>> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!(ABILITIES as readonly string[]).includes(k) || !Number.isInteger(v) || (v as number) < 0 || (v as number) > IMPROVEMENT.max) return null;
    if (v) out[k as Ability] = v as number;
  }
  return out;
}

/**
 * Opens an Ability Score Improvement as points to spend on the six scores, and applies what is spent. With the feats
 * rule, a switch comes first: increase scores (as without it) or take a feat, chosen from the feats collection.
 *
 *   class.srd-5.1:fighter.asi-4         { "str": 2 }               the increases
 *   class.srd-5.1:fighter.asi-4.take    "scores" | "feat"          feats rule only
 *   class.srd-5.1:fighter.asi-4.feat    "srd-5.1:grappler"         the feat; its own choices follow its id
 */
function openImprovement(ctx: Context, source: Source, id: string): void {
  const key = `${source.key}.${id}`;
  const where = sourceText(source);
  const owner = { key: source.key, name: source.name, pack: source.pack, classLevel: source.classLevel };
  if (ctx.rules.feats) {
    const takeKey = `${key}.take`;
    const feat = picksOf(ctx.doc.choices[takeKey])[0] === "feat";
    ctx.open.push({
      spec: {
        key: takeKey, step: source.step, label: "Ability Score Improvement", source: where, kind: "pick-one", presentation: "segmented", required: false,
        hint: "Increase your scores, or take a feat instead.", defaultValue: "scores",
        options: [{ value: "scores", name: "Increase scores" }, { value: "feat", name: "Take a feat" }],
      },
      picks: feat ? ["feat"] : [],
      answered: true,
      source: owner,
    });
    if (feat) {
      openChoice(ctx, { ...source, key }, { type: "choice", id: "feat", label: "Choose a feat", pick: 1, from: { collection: "feats" } });
      return;
    }
  }
  const value = ctx.doc.choices[key];
  const stored = value === undefined ? {} : readImprovement(value);
  const spent = Object.values(stored ?? {}).reduce((t, v) => t + v, 0);
  const cost = Object.fromEntries(Array.from({ length: IMPROVEMENT.max + 1 }, (_, v) => [String(v), v]));
  ctx.open.push({
    spec: {
      key, step: source.step, label: ctx.rules.feats ? "Increase your scores" : "Ability Score Improvement", source: where, kind: "allocate", required: true,
      hint: `Add 2 to one score, or 1 to two. This can't raise a score above ${IMPROVEMENT.cap}.`,
      slots: ABILITY_SLOTS, range: { min: 0, max: IMPROVEMENT.max }, budget: { total: IMPROVEMENT.points, cost }, slotValue: { label: "Increase", cost: false },
    },
    picks: [],
    answered: stored !== null && spent === IMPROVEMENT.points,
    source: owner,
  });
  if (stored === null || spent > IMPROVEMENT.points) {
    ctx.issues.push({
      id: `improvement:${key}`, severity: "error", step: source.step, key, overridable: stored !== null,
      message: `Ability Score Improvement (${where}): add ${IMPROVEMENT.points} points in all, at most ${IMPROVEMENT.max} to one score.`,
    });
  }
  for (const [ability, amount] of Object.entries(stored ?? {}) as [Ability, number][]) {
    ctx.tally.abilityBonuses.push({ ability, amount, cap: IMPROVEMENT.cap, from: { name: `Ability Score Improvement (${where})`, step: source.step, choice: key } });
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
    // A feat's ability bonuses stop at 20; what it gives says where it came from ("Grappler (Fighter 4)").
    expandSource(ctx, {
      key: `${source.key}.${entry.id}`, name: entry.name, step: source.step, pack: entry.pack, effects: effects as Effect[],
      ...(source.at ? { at: source.at } : {}), ...(collection === "feats" ? { abilityCap: 20 } : {}),
    }, depth + 1);
  }
}

/** How many a choice picks: its number, or its class table column at the class's level (0 if the table has none yet). */
export function pickCount(effect: ChoiceEffect, source: Pick<Source, "columns">): number {
  return typeof effect.pick === "number" ? effect.pick : Number(source.columns?.[effect.pick.column] ?? 0) || 0;
}

export function openChoice(ctx: Context, source: Source, effect: ChoiceEffect, depth = 0): void {
  const key = `${source.key}.${effect.id}`;
  const picks = picksOf(ctx.doc.choices[key]);
  const from = effect.from;
  const n = pickCount(effect, source);
  if (n <= 0) return;
  // One pick of a fixed number is a pick-one; a count from the class table stays a list as it grows.
  const one = n === 1 && typeof effect.pick === "number";
  // Spell picks appear on the Spells step, drawn as a spell list, wherever they come from (a high elf's cantrip).
  const spells = "collection" in from && from.collection === "spells";
  const spec: ChoiceSpec = {
    key,
    step: spells ? "spells" : source.step,
    label: effect.label,
    source: sourceText(source),
    kind: one ? "pick-one" : "pick-many",
    options: optionsFor(ctx, from),
    count: one ? undefined : { min: n, max: n },
    required: true,
    ...(spells ? { presentation: "list" as const } : {}),
  };
  ctx.open.push({
    spec, picks, effect,
    collection: "collection" in from ? from.collection : undefined,
    proficient: "proficient" in from ? from.proficient : undefined,
    source: { key: source.key, name: source.name, pack: source.pack, classLevel: source.classLevel },
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
      grant(ctx, source, from.collection, pick, { name: source.name, step: source.step, choice: key, ...(source.at ? { at: source.at } : {}) }, depth + 1, spells ? { ability: effect.ability } : undefined);
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
  return entries.map((entry) => ({
    value: entry.ref, name: entry.name,
    summary: typeof entry.summary === "string" ? entry.summary : undefined,
    description: typeof entry.description === "string" ? entry.description : undefined,
  }));
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
