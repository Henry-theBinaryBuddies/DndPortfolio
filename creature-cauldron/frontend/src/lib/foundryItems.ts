import type { Ability, Action, AttackAction, DamageRoll, Monster, MultiattackAction, SaveAction, TextAction } from "../types/monster";
import { parseDice } from "./dice";
import { escapeHtml, stableId, uniqueSlug } from "./exportCommon";
import type { JsonObject } from "./foundryJson";
import { STATS_STAMP, areaTemplate, atModBonus } from "./foundryMaps";
import { legendaryIntro, renderAction, type Segment } from "./renderAction";
import { spellcastingToText } from "./spellcastingText";

// Turns a monster's traits and actions into Foundry "items" (Foundry's word for each ability on an
// NPC sheet). The shapes are copied from real SRD monsters in the dnd5e system, so Foundry knows them.
// Everything here is a pure function. Anything that cannot be converted adds a note instead of throwing.

export interface ItemContext {
  monster: Monster;
  /** Foundry's proficiency bonus for this monster's CR. */
  pb: number;
  mods: Record<Ability, number>;
  notes: string[];
  /** Identifiers already used, so two abilities with the same name still get different ones. */
  slugs: Set<string>;
}

type Section = "trait" | "spellcasting" | "action" | "bonus" | "reaction" | "legendary-header" | "legendary";

const ACTIVATION: Record<"action" | "bonus" | "reaction" | "legendary", string> = {
  action: "action",
  bonus: "bonus",
  reaction: "reaction",
  legendary: "legendary",
};

/** Our prose segments as an HTML paragraph, with everything escaped. */
export function segmentsToHtml(segments: Segment[]): string {
  const inner = segments.map((s) => (s.italic ? `<em>${escapeHtml(s.text)}</em>` : escapeHtml(s.text))).join("");
  return `<p>${inner}</p>`;
}

function textHtml(text: string): string {
  return `<p>${escapeHtml(text)}</p>`;
}

/** The prose for an action, or just its name (with a note) if the prose can't be written, for example from unreadable dice. */
function proseHtml(ctx: ItemContext, action: Action): string {
  try {
    return segmentsToHtml(renderAction(action, ctx.monster.name));
  } catch {
    ctx.notes.push(`Could not write the description of "${action.name}", so only its name is shown.`);
    return textHtml(action.name);
  }
}

function sourceBlock(monster: Monster): JsonObject {
  return {
    custom: "",
    book: "",
    page: "",
    license: monster.source === "srd" ? "CC-BY-4.0" : "",
    revision: 1,
    rules: "2014",
  };
}

function plainUses(): JsonObject {
  return { max: "", recovery: [], spent: 0 };
}

/** "Recharge 5-6" as Foundry stores it: one use that comes back on a roll of 5 or more. */
function rechargeUses(min: number): JsonObject {
  return { max: "1", recovery: [{ period: "recharge", formula: String(min), type: "recoverAll" }], spent: 0 };
}

/** The fields every activity (Foundry's word for "something an item can do") has. */
function baseActivity(id: string, type: string, activationType: string, activationValue: number): JsonObject {
  return {
    _id: id,
    type,
    activation: { type: activationType, value: activationValue, condition: "", override: false },
    consumption: { targets: [], scaling: { allowed: false, max: "" }, spellSlot: true },
    description: { chatFlavor: "" },
    duration: { concentration: false, value: "", units: "", special: "", override: false },
    effects: [],
    range: { units: "", special: "", override: false },
    target: {
      template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
      affects: { count: "", type: "", choice: false, special: "" },
      prompt: true,
      override: false,
    },
    uses: { spent: 0, max: "", recovery: [] },
    sort: 0,
  };
}

/** A target template with nothing set (no area). */
const NO_TEMPLATE: JsonObject = { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" };

/** An activity that only announces itself (Multiattack, reactions, legendary options). Copied from real SRD items. */
function utilityActivity(id: string, activationType: string, cost = 1): JsonObject {
  return { ...baseActivity(id, "utility", activationType, cost), roll: { formula: "", name: "", prompt: false, visible: false } };
}

function itemShell(ctx: ItemContext, section: Section, index: number, name: string, type: string, system: JsonObject): JsonObject {
  return {
    _id: stableId(`${ctx.monster.id}|${section}|${index}|${name}`),
    name,
    type,
    system,
    effects: [],
    flags: {},
    _stats: { ...STATS_STAMP },
  };
}

function activityId(itemId: string): string {
  return stableId(`${itemId}|activity`);
}

function featSystem(
  ctx: ItemContext,
  name: string,
  html: string,
  properties: string[],
  activities: JsonObject,
  uses: JsonObject,
): JsonObject {
  return {
    description: { value: html, chat: "" },
    source: sourceBlock(ctx.monster),
    uses,
    type: { value: "", subtype: "" },
    requirements: "",
    properties,
    activities,
    enchant: {},
    prerequisites: { level: null },
    identifier: uniqueSlug(name, ctx.slugs),
  };
}

/** One damage dice roll in Foundry's shape, or undefined (with a note) if the dice can't be read. */
function damagePart(ctx: ItemContext, roll: DamageRoll, bonus: string, scalingMode: string): JsonObject | undefined {
  try {
    const { count, sides } = parseDice(roll.dice);
    return {
      number: count,
      denomination: sides,
      bonus,
      types: [roll.type],
      custom: { enabled: false, formula: "" },
      scaling: { mode: scalingMode, number: null, formula: "" },
    };
  } catch {
    ctx.notes.push(`Left out damage "${roll.dice} ${roll.type}" because the dice could not be read.`);
    return undefined;
  }
}

function flatBonus(bonus: number): string {
  return bonus === 0 ? "" : String(bonus);
}

function compact(parts: (JsonObject | undefined)[]): JsonObject[] {
  return parts.filter((p): p is JsonObject => p !== undefined);
}

function emptyBase(): JsonObject {
  return {
    number: null,
    denomination: 0,
    bonus: "",
    types: [],
    custom: { enabled: false, formula: "" },
    scaling: { mode: "", number: null, formula: "" },
  };
}

/** A melee or ranged weapon attack becomes a Foundry weapon item, like a dragon's Bite or a giant's rock. */
function weaponItem(ctx: ItemContext, section: Section, index: number, action: AttackAction, activationType: string): JsonObject {
  const { ability, to_hit, reach, range, mode } = action.attack;
  const ranged = mode === "ranged_weapon";
  const mod = ctx.mods[ability];
  // Foundry works out the to-hit as ability modifier + proficiency. If ours differs, the difference goes in "bonus".
  const diff = to_hit - (ctx.pb + mod);

  const [first, ...rest] = action.damage;
  const baseDamage = first ? damagePart(ctx, first, atModBonus(first.bonus, mod), "") : undefined;
  const parts = compact(rest.map((roll) => damagePart(ctx, roll, flatBonus(roll.bonus), "whole")));

  const reachValue = reach ?? 5;
  const id = stableId(`${ctx.monster.id}|${section}|${index}|${action.name}`);
  const activity: JsonObject = {
    ...baseActivity(activityId(id), "attack", activationType, 1),
    range: { value: String(ranged ? (range?.normal ?? "") : reachValue), units: "ft", special: "", override: false },
    attack: {
      ability,
      bonus: diff === 0 ? "" : String(diff),
      critical: { threshold: null },
      flat: false,
      type: { value: ranged ? "ranged" : "melee", classification: "weapon" },
    },
    damage: { critical: { bonus: "" }, includeBase: true, parts },
  };

  const system: JsonObject = {
    description: { value: proseHtml(ctx, action), chat: "" },
    source: sourceBlock(ctx.monster),
    quantity: 1,
    weight: { value: 0, units: "lb" },
    price: { value: 0, denomination: "gp" },
    attunement: "",
    equipped: true,
    rarity: "",
    identified: true,
    cover: null,
    range: {
      value: ranged ? (range?.normal ?? null) : null,
      long: ranged ? (range?.long ?? null) : null,
      units: "ft",
      reach: ranged ? null : reachValue,
    },
    uses: plainUses(),
    damage: {
      versatile: { number: null, denomination: null, bonus: "", types: [], custom: { enabled: false, formula: "" }, scaling: { mode: "", number: null, formula: "" } },
      base: baseDamage ?? emptyBase(),
    },
    armor: { value: 10 },
    hp: { value: 0, max: 0, dt: null, conditions: "" },
    properties: [],
    proficient: 1,
    unidentified: { description: "" },
    type: { value: ranged ? "simpleR" : "natural", baseItem: "" },
    container: null,
    crewed: false,
    activities: { [activityId(id)]: activity },
    attuned: false,
    ammunition: {},
    magicalBonus: null,
    identifier: uniqueSlug(action.name, ctx.slugs),
    mastery: "",
  };
  return { _id: id, name: action.name, type: "weapon", system, effects: [], flags: {}, _stats: { ...STATS_STAMP } };
}

/**
 * A spell attack (such as Mind Lash) becomes a feature with an attack activity. The to-hit is written as a
 * flat number so we don't depend on how Foundry applies proficiency to a feature.
 */
function spellAttackItem(ctx: ItemContext, section: Section, index: number, action: AttackAction, activationType: string): JsonObject {
  const { ability, to_hit, reach, range, mode } = action.attack;
  const ranged = mode === "ranged_spell";
  const id = stableId(`${ctx.monster.id}|${section}|${index}|${action.name}`);
  const parts = compact(action.damage.map((roll) => damagePart(ctx, roll, flatBonus(roll.bonus), "whole")));
  const activity: JsonObject = {
    ...baseActivity(activityId(id), "attack", activationType, 1),
    range: { value: String(ranged ? (range?.normal ?? "") : (reach ?? 5)), units: "ft", special: "", override: false },
    attack: {
      ability,
      bonus: String(to_hit),
      critical: { threshold: null },
      flat: true,
      type: { value: ranged ? "ranged" : "melee", classification: "spell" },
    },
    damage: { critical: { bonus: "" }, includeBase: false, parts },
  };
  const html = proseHtml(ctx, action);
  const system = featSystem(ctx, action.name, html, [], { [activityId(id)]: activity }, plainUses());
  return { _id: id, name: action.name, type: "feat", system, effects: [], flags: {}, _stats: { ...STATS_STAMP } };
}

/** A save-based ability (a breath weapon, an aura) becomes a feature with a save activity. */
function saveItem(ctx: ItemContext, section: Section, index: number, action: SaveAction, activationType: string): JsonObject {
  const id = stableId(`${ctx.monster.id}|${section}|${index}|${action.name}`);
  const parts = compact(action.on_fail.map((roll) => damagePart(ctx, roll, flatBonus(roll.bonus), "whole")));
  const area = action.area;
  const activity: JsonObject = {
    ...baseActivity(activityId(id), "save", activationType, 1),
    duration: { concentration: false, value: "", units: "inst", special: "", override: false },
    range: { units: area ? "self" : "", special: "", override: false },
    target: {
      template: area ? { ...NO_TEMPLATE, ...areaTemplate(area) } : { ...NO_TEMPLATE },
      affects: { count: "", type: "", choice: false, special: "" },
      prompt: true,
      override: false,
    },
    damage: { onSave: action.on_success, parts },
    save: { ability: [action.save.ability], dc: { calculation: "", formula: String(action.save.dc) } },
  };
  if (action.recharge) {
    activity.consumption = {
      targets: [{ type: "itemUses", target: "", value: "1", scaling: { mode: "", formula: "" } }],
      scaling: { allowed: false, max: "" },
      spellSlot: true,
    };
  }
  const html = proseHtml(ctx, action);
  const uses = action.recharge ? rechargeUses(action.recharge.min) : plainUses();
  const system = featSystem(ctx, action.name, html, [], { [activityId(id)]: activity }, uses);
  return { _id: id, name: action.name, type: "feat", system, effects: [], flags: {}, _stats: { ...STATS_STAMP } };
}

/** Multiattack and free-text abilities: a feature with a plain activity so the sheet files it under the right heading. */
function textItem(
  ctx: ItemContext,
  section: Section,
  index: number,
  action: MultiattackAction | TextAction,
  activationType: string,
): JsonObject {
  const id = stableId(`${ctx.monster.id}|${section}|${index}|${action.name}`);
  const recharge = action.kind === "text" ? action.recharge : undefined;
  const activity = utilityActivity(activityId(id), activationType, 1);
  if (recharge) {
    activity.consumption = {
      targets: [{ type: "itemUses", target: "", value: "1", scaling: { mode: "", formula: "" } }],
      scaling: { allowed: false, max: "" },
      spellSlot: true,
    };
  }
  const html = proseHtml(ctx, action);
  const uses = recharge ? rechargeUses(recharge.min) : plainUses();
  const system = featSystem(ctx, action.name, html, [], { [activityId(id)]: activity }, uses);
  return itemShell(ctx, section, index, action.name, "feat", system);
}

function actionItem(ctx: ItemContext, action: Action, section: "action" | "bonus" | "reaction", index: number): JsonObject {
  const activationType = ACTIVATION[section];
  switch (action.kind) {
    case "attack":
      return action.attack.mode === "melee_weapon" || action.attack.mode === "ranged_weapon"
        ? weaponItem(ctx, section, index, action, activationType)
        : spellAttackItem(ctx, section, index, action, activationType);
    case "save":
      return saveItem(ctx, section, index, action, activationType);
    case "multiattack":
    case "text":
      return textItem(ctx, section, index, action, activationType);
  }
}

/** A passive trait: a feature marked "trait", with no activities. */
function traitItem(ctx: ItemContext, section: Section, index: number, name: string, html: string): JsonObject {
  const system = featSystem(ctx, name, html, ["trait"], {}, plainUses());
  return itemShell(ctx, section, index, name, "feat", system);
}

/** All of a monster's abilities as Foundry items, in the order a stat block lists them. */
export function buildItems(ctx: ItemContext): JsonObject[] {
  const { monster } = ctx;
  const items: JsonObject[] = [];

  monster.traits.forEach((trait, i) => items.push(traitItem(ctx, "trait", i, trait.name, textHtml(trait.text))));
  if (monster.spellcasting) {
    items.push(traitItem(ctx, "spellcasting", 0, "Spellcasting", textHtml(spellcastingToText(monster.spellcasting))));
  }
  monster.actions.forEach((a, i) => items.push(actionItem(ctx, a, "action", i)));
  monster.bonus_actions.forEach((a, i) => items.push(actionItem(ctx, a, "bonus", i)));
  monster.reactions.forEach((a, i) => items.push(actionItem(ctx, a, "reaction", i)));

  const legendary = monster.legendary_actions;
  if (legendary) {
    items.push(traitItem(ctx, "legendary-header", 0, "Legendary Actions", textHtml(legendaryIntro(monster.name, legendary.per_round))));
    legendary.options.forEach((option, i) => {
      const id = stableId(`${monster.id}|legendary|${i}|${option.name}`);
      const activity = utilityActivity(activityId(id), ACTIVATION.legendary, option.cost);
      const system = featSystem(ctx, option.name, textHtml(option.text), [], { [activityId(id)]: activity }, plainUses());
      items.push(itemShell(ctx, "legendary", i, option.name, "feat", system));
    });
  }
  return items;
}
