import type { Monster } from "../types/monster";
import { parseDice } from "./dice";
import { isValidId } from "./storage";
import { CREATURE_TYPES, ROLES, SIZES } from "./options";

// Generated monsters are remembered in the browser until the server's shared cache exists. Like
// everything read from storage they are untrusted, and a malformed one would crash the stat block, so
// each is checked before it is allowed into the library. A monster that fails is simply left out.

export const GENERATED_STORAGE_KEY = "creature-cauldron:generated";
export const MAX_GENERATED = 200;

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isStr = (value: unknown): value is string => typeof value === "string";
const isStrList = (value: unknown): boolean => Array.isArray(value) && value.every(isStr);
const dicesParse = (dice: unknown): boolean => {
  if (!isStr(dice)) return false;
  try {
    parseDice(dice);
    return true;
  } catch {
    return false;
  }
};

function looksLikeRoll(value: unknown): boolean {
  return isObj(value) && dicesParse(value.dice) && isNum(value.bonus) && isStr(value.type);
}

function looksLikeAction(value: unknown): boolean {
  if (!isObj(value) || !isStr(value.name)) return false;
  switch (value.kind) {
    case "attack": {
      const attack = value.attack;
      return (
        isObj(attack) &&
        isStr(attack.mode) &&
        isStr(attack.ability) &&
        isNum(attack.to_hit) &&
        isStr(attack.targets) &&
        Array.isArray(value.damage) &&
        value.damage.every(looksLikeRoll)
      );
    }
    case "save": {
      const save = value.save;
      return (
        isObj(save) &&
        isStr(save.ability) &&
        isNum(save.dc) &&
        Array.isArray(value.on_fail) &&
        value.on_fail.every(looksLikeRoll) &&
        (value.on_success === "half" || value.on_success === "none")
      );
    }
    case "multiattack":
      return Array.isArray(value.sequence) && value.sequence.every((e) => isObj(e) && isStr(e.action) && isNum(e.count));
    case "text":
      return isStr(value.text);
    default:
      return false;
  }
}

const isSpellList = (value: unknown): boolean => Array.isArray(value) && value.every((s) => isObj(s) && isStr(s.name) && (s.note === undefined || isStr(s.note)));

function looksLikeSpellcasting(value: unknown): boolean {
  if (!isObj(value)) return false;
  if (!isStr(value.ability) || !isNum(value.dc) || !isNum(value.attack_bonus) || typeof value.innate !== "boolean") return false;
  if (!isStr(value.intro) || !isStr(value.footer) || !isSpellList(value.cantrips) || !isSpellList(value.at_will)) return false;
  if (!Array.isArray(value.slots) || !value.slots.every((s) => isObj(s) && isNum(s.level) && isNum(s.slots) && isSpellList(s.spells))) return false;
  return Array.isArray(value.per_day) && value.per_day.every((d) => isObj(d) && isNum(d.uses) && typeof d.each === "boolean" && isSpellList(d.spells));
}

/** Does this look like a complete, displayable Monster? Cheap structural checks, not rules validation. */
export function looksLikeMonster(value: unknown): value is Monster {
  if (!isObj(value)) return false;
  if (!isValidId(value.id) || !isStr(value.name) || value.name === "") return false;
  if (!["srd", "curated", "ai", "reskin"].includes(value.source as string) || typeof value.validated !== "boolean") return false;
  if (!(SIZES as readonly unknown[]).includes(value.size) || !(CREATURE_TYPES as readonly unknown[]).includes(value.type)) return false;
  if (!(ROLES as readonly unknown[]).includes(value.role)) return false;
  if (!isStr(value.alignment) || !isStr(value.languages) || !isStr(value.description)) return false;

  const { abilities, armor_class: ac, hit_points: hp, challenge, senses, speeds } = value;
  if (!isObj(abilities) || !["str", "dex", "con", "int", "wis", "cha"].every((a) => isNum(abilities[a]))) return false;
  if (!isObj(ac) || !isNum(ac.value)) return false;
  if (!isObj(hp) || !isNum(hp.average) || !isStr(hp.dice)) return false;
  if (!isObj(challenge) || !isStr(challenge.cr) || !isNum(challenge.cr_value) || !isNum(challenge.xp) || !isNum(challenge.proficiency_bonus)) return false;
  if (!isObj(senses) || !isNum(senses.passive_perception) || !isObj(speeds)) return false;
  if (!isObj(value.saves) || !isObj(value.skills)) return false;

  for (const key of ["subtypes", "vulnerabilities", "resistances", "immunities", "condition_immunities", "environments", "damage_themes", "features"]) {
    if (!isStrList(value[key])) return false;
  }
  if (value.changes !== undefined && !isStrList(value.changes)) return false;
  if (value.attribution != null && !isStr(value.attribution)) return false;
  if (!Array.isArray(value.traits) || !value.traits.every((t) => isObj(t) && isStr(t.name) && isStr(t.text))) return false;
  for (const key of ["actions", "bonus_actions", "reactions"]) {
    const list = value[key];
    if (!Array.isArray(list) || !list.every(looksLikeAction)) return false;
  }

  const damageText = value.damage_text;
  if (damageText !== null && damageText !== undefined) {
    if (!isObj(damageText)) return false;
    for (const key of ["vulnerabilities", "resistances", "immunities"]) {
      if (damageText[key] !== undefined && !isStr(damageText[key])) return false;
    }
  }

  const legendary = value.legendary_actions;
  if (legendary !== null && legendary !== undefined) {
    if (!isObj(legendary) || !isNum(legendary.per_round) || !Array.isArray(legendary.options)) return false;
    if (!legendary.options.every((o) => isObj(o) && isStr(o.name) && isNum(o.cost) && isStr(o.text))) return false;
  }
  const spellcasting = value.spellcasting;
  if (spellcasting !== null && spellcasting !== undefined) {
    if (!looksLikeSpellcasting(spellcasting)) return false;
  }
  return true;
}

/** The stored generated monsters: bad entries and repeated ids are dropped, and the list is capped. Never throws. */
export function parseGenerated(value: unknown): Monster[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const kept: Monster[] = [];
  for (const item of value) {
    if (kept.length >= MAX_GENERATED) break;
    if (looksLikeMonster(item) && !seen.has(item.id)) {
      seen.add(item.id);
      kept.push({ ...item, legendary_actions: item.legendary_actions ?? null, spellcasting: item.spellcasting ?? null });
    }
  }
  return kept;
}
