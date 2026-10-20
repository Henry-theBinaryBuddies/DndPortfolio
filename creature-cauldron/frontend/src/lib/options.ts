// The fixed option lists. They drive the filter panel, the TypeScript types,
// and (later) the generator API, so there is exactly one copy of each list.
//
// `as const` makes each array a read-only list of exact values. TypeScript can
// then derive a union type from it: (typeof SIZES)[number] is "tiny" | "small" | ...

export const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
export type Size = (typeof SIZES)[number];

export const CREATURE_TYPES = [
  "aberration",
  "beast",
  "celestial",
  "construct",
  "dragon",
  "elemental",
  "fey",
  "fiend",
  "giant",
  "humanoid",
  "monstrosity",
  "ooze",
  "plant",
  "undead",
] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];

export const DAMAGE_TYPES = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder",
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

/** Damage types a creature can be themed around. Weapon damage is not a theme. */
export const DAMAGE_THEMES = [
  "acid",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "poison",
  "psychic",
  "radiant",
  "thunder",
] as const satisfies readonly DamageType[];
export type DamageTheme = (typeof DAMAGE_THEMES)[number];

export const ROLES = ["brute", "skirmisher", "controller", "artillery", "lurker", "leader", "solo"] as const;
export type Role = (typeof ROLES)[number];

export const ENVIRONMENTS = [
  "arctic",
  "coast",
  "desert",
  "forest",
  "grassland",
  "hill",
  "mountain",
  "swamp",
  "underdark",
  "underwater",
  "urban",
  "dungeon",
  "planar",
] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Derived by code from the stat block, never trusted from the AI. */
export const FEATURES = [
  "flying",
  "swimming",
  "multiattack",
  "breath-weapon",
  "legendary",
  "spellcasting",
  "regeneration",
] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<Feature, string> = {
  flying: "Flying",
  swimming: "Swimming",
  multiattack: "Multiattack",
  "breath-weapon": "Breath weapon",
  legendary: "Legendary actions",
  spellcasting: "Spellcasting",
  regeneration: "Regeneration",
};

/** Display text for an option value: "breath-weapon" becomes "Breath-weapon". */
export function label(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
