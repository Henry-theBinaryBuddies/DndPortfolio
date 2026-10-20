import type { Ability, SaveAction } from "../types/monster";
import type { Size } from "./options";
import { parseDice } from "./dice";

// Lookup tables and tiny conversions for the Foundry VTT (dnd5e system) export. Pure functions.

/** The one Foundry version this export is written for. Everything that mentions it reads from here. */
export const FOUNDRY_TARGET = {
  label: "dnd5e 5.3.3",
  systemVersion: "5.3.3",
  filePrefix: "fvtt-Actor",
} as const;

/** Stamped on the actor and every item. It says which system version the data was written for. */
export const STATS_STAMP = {
  systemId: "dnd5e",
  systemVersion: FOUNDRY_TARGET.systemVersion,
  coreVersion: "13.347",
} as const;

export const SIZE_KEYS: Record<Size, string> = {
  tiny: "tiny",
  small: "sm",
  medium: "med",
  large: "lg",
  huge: "huge",
  gargantuan: "grg",
};

/** Token width and height in grid squares. */
export const TOKEN_SIZES: Record<Size, number> = {
  tiny: 0.5,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
};

/** Foundry's 18 skills: its three-letter id, our display name, and the ability each uses. */
export const SKILLS: readonly { id: string; name: string; ability: Ability }[] = [
  { id: "acr", name: "Acrobatics", ability: "dex" },
  { id: "ani", name: "Animal Handling", ability: "wis" },
  { id: "arc", name: "Arcana", ability: "int" },
  { id: "ath", name: "Athletics", ability: "str" },
  { id: "dec", name: "Deception", ability: "cha" },
  { id: "his", name: "History", ability: "int" },
  { id: "ins", name: "Insight", ability: "wis" },
  { id: "itm", name: "Intimidation", ability: "cha" },
  { id: "inv", name: "Investigation", ability: "int" },
  { id: "med", name: "Medicine", ability: "wis" },
  { id: "nat", name: "Nature", ability: "int" },
  { id: "prc", name: "Perception", ability: "wis" },
  { id: "prf", name: "Performance", ability: "cha" },
  { id: "per", name: "Persuasion", ability: "cha" },
  { id: "rel", name: "Religion", ability: "int" },
  { id: "slt", name: "Sleight of Hand", ability: "dex" },
  { id: "ste", name: "Stealth", ability: "dex" },
  { id: "sur", name: "Survival", ability: "wis" },
];

/** The skill for a display name such as "Sleight of Hand", ignoring capitals. */
export function skillFor(name: string): (typeof SKILLS)[number] | undefined {
  const wanted = name.trim().toLowerCase();
  return SKILLS.find((skill) => skill.name.toLowerCase() === wanted);
}

/** Language names (lower case) to Foundry's keys. Anything not here goes into the free-text field. */
const LANGUAGE_KEYS: Record<string, string> = {
  common: "common",
  dwarvish: "dwarvish",
  elvish: "elvish",
  giant: "giant",
  gnomish: "gnomish",
  goblin: "goblin",
  halfling: "halfling",
  orc: "orc",
  abyssal: "abyssal",
  celestial: "celestial",
  "deep speech": "deep",
  draconic: "draconic",
  infernal: "infernal",
  primordial: "primordial",
  aquan: "aquan",
  auran: "auran",
  ignan: "ignan",
  terran: "terran",
  sylvan: "sylvan",
  undercommon: "undercommon",
  "thieves' cant": "cant",
  druidic: "druidic",
};

const CONDITION_KEYS = new Set([
  "blinded",
  "charmed",
  "deafened",
  "exhaustion",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious",
]);

/**
 * Splits a language line like "Common, Sylvan" into Foundry keys plus leftover text
 * ("understands Deep Speech but can't speak" has no key, so it all goes to `custom`).
 * A dash means no languages.
 */
export function parseLanguages(text: string): { value: string[]; custom: string } {
  const trimmed = text.trim();
  if (trimmed === "" || /^[-–—]$/.test(trimmed)) return { value: [], custom: "" };
  const value: string[] = [];
  const leftover: string[] = [];
  for (const piece of trimmed.split(",").map((p) => p.trim()).filter(Boolean)) {
    const key = LANGUAGE_KEYS[piece.toLowerCase()];
    if (key && !value.includes(key)) value.push(key);
    else if (!key) leftover.push(piece);
  }
  return { value, custom: leftover.join("; ") };
}

/** Known condition names become Foundry keys; anything else goes to the free-text field. */
export function parseConditions(list: string[]): { value: string[]; custom: string } {
  const value: string[] = [];
  const leftover: string[] = [];
  for (const entry of list.map((e) => e.trim()).filter(Boolean)) {
    const key = entry.toLowerCase();
    if (CONDITION_KEYS.has(key)) {
      if (!value.includes(key)) value.push(key);
    } else {
      leftover.push(entry);
    }
  }
  return { value, custom: leftover.join("; ") };
}

/** Foundry's NPC proficiency bonus from challenge rating: CR 1/8 to 4 is +2, 5 to 8 is +3, and so on. */
export function foundryProficiency(crValue: number): number {
  return Math.floor((Math.max(crValue, 1) + 7) / 4);
}

/**
 * A stat block shows one total ("+13"), but Foundry builds it from a proficiency multiplier plus a
 * flat bonus. This finds the largest multiplier (up to `maxMultiplier`) that fits, and the flat
 * remainder, so multiplier * pb + modifier + flat always equals the printed total.
 */
export function splitBonus(
  total: number,
  modifier: number,
  pb: number,
  maxMultiplier: 1 | 2,
): { multiplier: number; flat: number } {
  const extra = total - modifier;
  const multiplier = extra < pb ? 0 : Math.min(maxMultiplier, Math.floor(extra / pb));
  return { multiplier, flat: extra - multiplier * pb };
}

/** True only for digits, dice such as "2d6", plus, minus and spaces: text safe to put in a Foundry formula field. */
export function isStrictFormula(text: string): boolean {
  return /^\d+(d\d+)?(\s*[+-]\s*\d+(d\d+)?)*$/.test(text.trim());
}

/** "4d8+8" becomes "4d8 + 8", the spacing Foundry writes. Returns "" if the text is not a plain dice formula. */
export function normalizeHpFormula(dice: string): string {
  try {
    const { count, sides, bonus } = parseDice(dice);
    const text = bonus === 0 ? `${count}d${sides}` : `${count}d${sides} ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`;
    return isStrictFormula(text) ? text : "";
  } catch {
    return "";
  }
}

const TEMPLATE_TYPES: Record<NonNullable<SaveAction["area"]>["shape"], string> = {
  cone: "cone",
  line: "line",
  radius: "circle",
  sphere: "sphere",
  cube: "cube",
};

/** A save's area as Foundry's target template (all values are text, as Foundry stores them). */
export function areaTemplate(area: NonNullable<SaveAction["area"]>): {
  type: string;
  size: string;
  width: string;
  units: string;
} {
  return {
    type: TEMPLATE_TYPES[area.shape],
    size: String(area.size),
    width: area.width !== undefined ? String(area.width) : "",
    units: "ft",
  };
}

/**
 * The bonus text for a weapon's base damage. Foundry adds the ability modifier to weapon damage unless
 * the formula already mentions it, so we always write "@mod" and add or subtract whatever is left over.
 */
export function atModBonus(bonus: number, modifier: number): string {
  const diff = bonus - modifier;
  if (diff === 0) return "@mod";
  return diff > 0 ? `@mod + ${diff}` : `@mod - ${Math.abs(diff)}`;
}
