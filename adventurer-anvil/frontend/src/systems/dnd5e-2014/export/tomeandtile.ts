// The Tome & Tile export: a character as Tome & Tile's `Creature` message, written as Protobuf JSON (its file format,
// ADR 0003 and 0010 in Tome & Tile). Built with Tome & Tile's own generated types (copied into ./tomeandtile/gen by
// tools/sync-tomeandtile.ts), so the file can't drift from its contract.
//
// What goes in: the worked-out numbers, the spell slots and class resources (all full), hit dice, and abilities a
// player can click: each weapon, the spells castable today (cantrips, spells known, prepared and always-prepared, and
// spells from a race or feature), and every feature as a passive card. Left out: the id (Tome & Tile's server makes
// ids) and the portrait (Tome & Tile needs an uploaded picture).
import { create, toJsonString, type MessageInitShape } from "@bufbuild/protobuf";
import type { CharacterBlurb, CharacterDocument, ContentIndex } from "../../../core";
import { modifier } from "../engine/derive";
import type { Context } from "../engine/context";
import type { AbilityUses, Tally } from "../engine/tally";
import type { Item, Spell } from "../packFormat";
import { RACE_KEY } from "../steps/race";
import { picksOf } from "../engine/context";
import type { Ability as AbilityId } from "../vocabulary";
import { AbilityScore, RulesEdition } from "./tomeandtile/gen/common_pb";
import { CreatureSize } from "./tomeandtile/gen/scene_pb";
import {
  ActionCost, CreatureKind, CreatureSchema, DamageType, TargetShape,
  type AbilitySchema, type EffectStepSchema, type ResourceSchema, type TargetingSchema,
} from "./tomeandtile/gen/creature_pb";

type Pipeline = (doc: CharacterDocument, content: ContentIndex) => {
  ctx: Context;
  derived: Record<string, { value: number | string | boolean; breakdown: { amount: number | string }[] }>;
  scores: Record<AbilityId, number>;
};
type AbilityInit = MessageInitShape<typeof AbilitySchema>;
type StepInit = MessageInitShape<typeof EffectStepSchema>;

const ABILITY: Record<AbilityId, AbilityScore> = {
  str: AbilityScore.STRENGTH, dex: AbilityScore.DEXTERITY, con: AbilityScore.CONSTITUTION,
  int: AbilityScore.INTELLIGENCE, wis: AbilityScore.WISDOM, cha: AbilityScore.CHARISMA,
};
const DAMAGE: Record<string, DamageType> = {
  acid: DamageType.ACID, bludgeoning: DamageType.BLUDGEONING, cold: DamageType.COLD, fire: DamageType.FIRE, force: DamageType.FORCE,
  lightning: DamageType.LIGHTNING, necrotic: DamageType.NECROTIC, piercing: DamageType.PIERCING, poison: DamageType.POISON,
  psychic: DamageType.PSYCHIC, radiant: DamageType.RADIANT, slashing: DamageType.SLASHING, thunder: DamageType.THUNDER,
};
const SIZE: Record<string, CreatureSize> = {
  tiny: CreatureSize.TINY, small: CreatureSize.SMALL, medium: CreatureSize.MEDIUM, large: CreatureSize.LARGE,
  huge: CreatureSize.HUGE, gargantuan: CreatureSize.GARGANTUAN,
};
const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/** "ki-points" → "ki_points": Tome & Tile's keys and skill ids use underscores. */
const snake = (id: string) => id.replace(/-/g, "_");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `-${-n}` : "");
/** "1d8" plus a modifier: "1d8+3", "1d8-1", "1d8"; a flat number has it added. */
const withMod = (dice: string, mod: number) => (/^\d+$/.test(dice) ? String(Math.max(0, Number(dice) + mod)) : `${dice}${signed(mod)}`);
/** The value for the highest level listed at or below `level`. */
const atLevel = (table: Record<string, string> | undefined, level: number) =>
  table ? Object.entries(table).filter(([l]) => Number(l) <= level).sort((a, b) => Number(b[0]) - Number(a[0]))[0]?.[1] : undefined;
/** "120 feet" → 120; "Touch" and "Self" → 0. */
const feet = (range: string) => Number(/(\d+)\s*(?:feet|foot|ft)/i.exec(range)?.[1] ?? 0);

function cost(castingTime: string): ActionCost {
  if (/^1 bonus action/i.test(castingTime)) return ActionCost.BONUS_ACTION;
  if (/^1 reaction/i.test(castingTime)) return ActionCost.REACTION;
  return ActionCost.ACTION; // an action, or longer (the card says how long)
}

export function makeTomeAndTileExporter(run: Pipeline, describe: (doc: CharacterDocument, content: ContentIndex) => CharacterBlurb) {
  return {
    id: "tome-and-tile",
    label: "Export for Tome & Tile",
    build(doc: CharacterDocument, content: ContentIndex) {
      const { creature, warnings } = toCreature(doc, content, run, describe);
      const slug = (doc.name || "character").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "character";
      return { fileName: `${slug}.creature.json`, mediaType: "application/json", text: `${toJsonString(CreatureSchema, creature, { prettySpaces: 2 })}\n`, warnings };
    },
  };
}

/** The character as a Tome & Tile Creature, and what the person should know before exporting it. */
export function toCreature(doc: CharacterDocument, content: ContentIndex, run: Pipeline, describe: (doc: CharacterDocument, content: ContentIndex) => CharacterBlurb) {
  const { ctx, derived, scores } = run(doc, content);
  const { tally } = ctx;
  const value = (key: string) => num(derived[key]?.value);
  const mod = (a: AbilityId) => modifier(scores[a]);
  const prof = value("proficiency-bonus");
  const level = value("level");
  const packs = content.packs();
  const credit = (pack: string) =>
    pack === "srd-5.1" ? { source: "srd-5.1", attribution: packs.find((p) => p.id === pack)?.attribution ?? "" } : { source: "user", attribution: "" };

  // Warnings: unfinished steps, and rule problems allowed or not.
  const warnings: string[] = [];
  const todo = ctx.steps.filter((s) => ctx.open.some((c) => c.spec.step === s.id && c.spec.required && !(c.answered ?? c.picks.length > 0) && !(c.spec.options && c.spec.options.length === 0)));
  if (todo.length) warnings.push(`Not finished: ${todo.map((s) => s.label).join(", ")} still to do. Its numbers export as they are.`);
  const ruled = new Set(doc.overrides.map((o) => o.issueId));
  const errors = ctx.issues.filter((i) => i.severity === "error" && !ruled.has(i.id));
  if (errors.length) warnings.push(`${errors.length} rule problem${errors.length > 1 ? "s" : ""} not allowed by a DM (see Review).`);

  // Size: the race's, or the size chosen.
  const raceRef = picksOf(doc.choices[RACE_KEY])[0];
  const race = raceRef ? content.get("races", raceRef) : undefined;
  const size = typeof race?.size === "string" ? race.size : raceRef ? picksOf(doc.choices[`race.${raceRef}.size`])[0] : undefined;

  // Resources: spell slots (Pact Magic apart), class resources, hit dice. All full.
  const resources: MessageInitShape<typeof ResourceSchema>[] = [];
  const pact = tally.casting.find((c) => c.pact && Object.keys(c.slots).length);
  const pactLevel = pact ? Math.max(...Object.keys(pact.slots).map(Number)) : 0;
  for (const c of tally.casting) {
    for (const [l, n] of Object.entries(c.slots)) {
      if (!n) continue;
      const key = c.pact ? `pact_slot_${l}` : `spell_slot_${l}`;
      if (!resources.some((r) => r.key === key)) resources.push({ key, label: c.pact ? `Pact Magic (${ORDINAL[Number(l)]} level)` : `${ORDINAL[Number(l)]}-level slots`, current: n, max: n });
    }
  }
  const usesOf = (u: number | AbilityUses) => (typeof u === "number" ? u : Math.max(u.min ?? 0, mod(u.ability) + (u.add ?? 0)));
  for (const r of tally.resources) {
    const n = usesOf(r.uses);
    if (n > 0 && !resources.some((x) => x.key === snake(r.id))) resources.push({ key: snake(r.id), label: r.name, current: n, max: n });
  }
  const dice = new Map<number, number>();
  for (const c of tally.classes) dice.set(c.hitDie, (dice.get(c.hitDie) ?? 0) + c.level);
  for (const [die, n] of dice) resources.push({ key: `hit_dice_d${die}`, label: `Hit dice (d${die})`, current: n, max: n });

  const abilities: AbilityInit[] = [...weaponAbilities(tally, derived, mod, content, credit), ...spellAbilities(tally, content, mod, prof, level, pactLevel, credit), ...featureAbilities(tally, credit)];

  const notes = [`Exported from Adventurer Anvil with ${packs.map((p) => `${p.id} ${p.version}`).join(", ")}.`];
  if (doc.overrides.length) notes.push(`DM rulings: ${doc.overrides.map((o) => o.note).join("; ")}.`);
  const usesSrd = packs.some((p) => p.id === "srd-5.1");

  const creature = create(CreatureSchema, {
    kind: CreatureKind.PLAYER_CHARACTER,
    name: doc.name || "Unnamed character",
    edition: RulesEdition.RULES_EDITION_2014,
    size: size ? SIZE[size] ?? CreatureSize.MEDIUM : CreatureSize.MEDIUM,
    scores: { strength: scores.str, dexterity: scores.dex, constitution: scores.con, intelligence: scores.int, wisdom: scores.wis, charisma: scores.cha },
    proficiencyBonus: prof,
    armorClass: value("ac"),
    hpCurrent: value("hp"),
    hpMax: value("hp"),
    speedFeet: value("speed.walk"),
    flySpeedFeet: value("speed.fly"),
    swimSpeedFeet: value("speed.swim"),
    climbSpeedFeet: value("speed.climb"),
    burrowSpeedFeet: value("speed.burrow"),
    initiativeBonus: value("initiative"),
    saveProficiencies: [...new Set(tally.proficiencies.filter((p) => p.kind === "saving-throw" && !p.replaced).map((p) => ABILITY[p.id as AbilityId]))],
    resistances: [...new Set(tally.resistances.map((r) => DAMAGE[r.damage]))],
    resources,
    abilities,
    summary: describe(doc, content).text,
    skills: Object.entries(derived)
      .filter(([k, d]) => k.startsWith("skill.") && (d as { mark?: unknown }).mark)
      .map(([k, d]) => ({ skill: snake(k.slice(6)), bonus: num(d.value) })),
    passivePerception: value("passive.perception"),
    provenance: {
      source: "adventurers-anvil",
      attribution: usesSrd ? packs.find((p) => p.id === "srd-5.1")?.attribution ?? "" : "",
      externalId: doc.id,
      originNotes: notes.join(" "),
    },
  });
  return { creature, warnings };
}

/** One ability per weapon carried: an attack with its to-hit bonus, damage and reach or range; a versatile weapon's two-handed grip as a second. */
function weaponAbilities(
  tally: Tally, derived: Record<string, { breakdown: { amount: number | string }[] }>, mod: (a: AbilityId) => number, content: ContentIndex,
  credit: (pack: string) => { source: string; attribution: string },
): AbilityInit[] {
  const out: AbilityInit[] = [];
  for (const w of tally.weapons) {
    const { weapon } = w;
    const toHit = (derived[`attack.${w.ref}`]?.breakdown ?? []).reduce((t, l) => t + num(l.amount), 0);
    const ability: AbilityId = weapon.properties.includes("finesse") ? (mod("dex") > mod("str") ? "dex" : "str") : weapon.range === "ranged" ? "dex" : "str";
    const item = content.get("items", w.ref) as (Item & { pack: string; description?: string; summary?: string }) | undefined;
    const targeting: MessageInitShape<typeof TargetingSchema> =
      weapon.range === "ranged"
        ? { shape: TargetShape.CREATURES, rangeFeet: weapon.normal ?? 0, longRangeFeet: weapon.long ?? 0, maxTargets: 1 }
        : { shape: TargetShape.CREATURES, rangeFeet: weapon.properties.includes("reach") ? 10 : 5, maxTargets: 1 };
    const attack = (dice: string | undefined): StepInit => ({
      step: { case: "attack", value: { toHitBonus: toHit, damage: dice && weapon.damage ? [{ dice: withMod(dice, mod(ability)), type: DAMAGE[weapon.damage.type] }] : [] } },
    });
    const base = { cost: ActionCost.ACTION, targeting, provenance: credit(item?.pack ?? "") };
    const describeWeapon = [item?.summary, weapon.properties.length ? `Properties: ${weapon.properties.join(", ")}.` : ""].filter(Boolean).join(" ");
    out.push({ ...base, abilityId: `weapon-${w.ref.split(":").pop()}`, name: w.name, description: describeWeapon, steps: [attack(weapon.damage?.dice)] });
    if (weapon.versatile) {
      out.push({ ...base, abilityId: `weapon-${w.ref.split(":").pop()}-two-handed`, name: `${w.name} (two-handed)`, description: describeWeapon, steps: [attack(weapon.versatile)] });
    }
  }
  return out;
}

/**
 * The spells castable today, each as an attack, a saving throw, plain damage or healing where the pack says so (else a
 * card with its text), spending a slot of its level (a warlock's, a pact slot). Cantrips scale with character level.
 */
function spellAbilities(
  tally: Tally, content: ContentIndex, mod: (a: AbilityId) => number, prof: number, level: number, pactLevel: number,
  credit: (pack: string) => { source: string; attribution: string },
): AbilityInit[] {
  const pactCasters = new Set(tally.casting.filter((c) => c.pact).map((c) => c.name));
  const out: AbilityInit[] = [];
  for (const s of tally.spells) {
    const castable = s.level === 0 || s.always || s.prepared || !(s.from.choice ?? "").endsWith(".spellbook");
    if (!castable) continue;
    const spell = content.get("spells", s.ref) as (Spell & { pack: string; ref: string }) | undefined;
    if (!spell) continue;
    const ability = s.ability ?? "int";
    const m = mod(ability);
    const fromClass = s.from.step === "spells" || s.from.step === "class";
    // A slot of its level (a warlock's, a pact slot); none for cantrips, spells cast at will, and spells a race gives.
    const slotKey = s.level === 0 || s.atWill || !fromClass ? "" : pactCasters.has(s.from.name) && pactLevel ? `pact_slot_${pactLevel}` : `spell_slot_${s.level}`;
    /** "1d8+MOD" with the modifier filled in: "1d8+3", "1d8-1", "1d8". */
    const fill = (dice: string) => dice.replace(/\+MOD/, signed(m)).replace(/MOD/, String(m));
    const damageAt = (d: NonNullable<Spell["damage"]>[number]) => (s.level === 0 ? atLevel(d.atCharacterLevel, level) : atLevel(d.atSlotLevel, s.level) ?? atLevel(d.atCharacterLevel, level));
    const damage = (spell.damage ?? []).flatMap((d) => (damageAt(d) ? [{ dice: fill(damageAt(d)!), type: DAMAGE[d.type] }] : []));
    const steps: StepInit[] = [];
    if (spell.attack) {
      for (let n = 0; n < (spell.attacks ?? 1); n++) steps.push({ step: { case: "attack", value: { toHitBonus: prof + m, damage } } });
    } else if (spell.save) {
      steps.push({ step: { case: "save", value: { ability: ABILITY[spell.save.ability], dc: 8 + prof + m, damage, halfOnSuccess: spell.save.onSuccess === "half" } } });
    } else if (spell.automatic && damage.length) {
      steps.push({ step: { case: "flat", value: { damage } } });
    }
    const heal = atLevel(spell.healing?.atSlotLevel, Math.max(1, s.level));
    if (heal) steps.push({ step: { case: "flat", value: { healingDice: fill(heal) } } });

    const range = feet(spell.range);
    const area = spell.area;
    const shape = area?.shape === "sphere" ? TargetShape.SPHERE : area?.shape === "cone" ? TargetShape.CONE : area?.shape === "line" ? TargetShape.LINE : area?.shape === "cube" ? TargetShape.CUBE : undefined;
    const targeting: MessageInitShape<typeof TargetingSchema> =
      shape ? { shape, rangeFeet: range, sizeFeet: area!.size, ...(shape === TargetShape.LINE ? { widthFeet: 5 } : {}) }
      : /^self/i.test(spell.range) && !area ? { shape: TargetShape.SELF }
      : { shape: TargetShape.CREATURES, rangeFeet: range, maxTargets: area ? 0 : spell.attacks ?? 1 }; // a cylinder: the GM picks who's inside

    const words = [`${s.level === 0 ? "Cantrip" : `${ORDINAL[s.level]}-level ${spell.school}`}. ${spell.castingTime}, ${spell.range}, ${spell.duration}.`, spell.description ?? spell.summary ?? ""];
    out.push({
      abilityId: `spell-${s.ref.split(":").pop()}`,
      name: spell.name,
      description: words.filter(Boolean).join("\n\n"),
      cost: cost(spell.castingTime),
      ...(slotKey ? { resourceKey: slotKey, resourceAmount: 1 } : {}),
      targeting,
      steps,
      provenance: credit(spell.pack),
    });
  }
  return out;
}

/** Every feature and trait as a passive card with its text; their uses are tracked as resources. */
function featureAbilities(tally: Tally, credit: (pack: string) => { source: string; attribution: string }): AbilityInit[] {
  const seen = new Set<string>();
  return tally.features.flatMap((f) => {
    const id = `feature-${f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      abilityId: id, name: f.name, description: f.description ?? f.summary ?? "", cost: ActionCost.PASSIVE,
      // Features come from the built-in SRD pack unless a pack of your own gave them; the tally doesn't say which, so
      // the SRD's credit is used when the feature has SRD text.
      provenance: credit(f.description ? "srd-5.1" : ""),
    }];
  });
}
