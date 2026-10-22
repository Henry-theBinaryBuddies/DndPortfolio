import type { CreatureType, DamageTheme, DamageType, Environment, Feature, Role, Size } from "../lib/options";

// The option lists live in lib/options.ts; re-exported so the schema reads in one place.
export type { CreatureType, DamageTheme, DamageType, Environment, Feature, Role, Size };

// Monster schema (2014 rules). Mirrors the design in docs/REQUIREMENTS.md.
// Once the Python back end exists these types will be generated from its
// OpenAPI spec; until then they are the source of truth.

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type Source = "srd" | "a5e" | "curated" | "ai" | "reskin";

export interface DamageRoll {
  dice: string; // e.g. "2d6"
  bonus: number;
  type: DamageType;
}

export interface Recharge {
  min: number; // recharges on a roll of min-6
}

// The hybrid action model: a discriminated union on `kind`.
// attack, save and multiattack are typed; text is free-form prose.

export interface AttackAction {
  kind: "attack";
  name: string;
  attack: {
    mode: "melee_weapon" | "ranged_weapon" | "melee_spell" | "ranged_spell";
    ability: Ability;
    to_hit: number;
    reach?: number;
    range?: { normal: number; long: number };
    targets: string;
  };
  damage: DamageRoll[];
  effects_text?: string | null;
}

export interface SaveAction {
  kind: "save";
  name: string;
  recharge?: Recharge;
  save: { ability: Ability; dc: number };
  area?: { shape: "cone" | "line" | "radius" | "cube" | "sphere"; size: number; width?: number };
  on_fail: DamageRoll[];
  on_success: "half" | "none";
  effects_text?: string | null;
}

export interface MultiattackAction {
  kind: "multiattack";
  name: string;
  sequence: { action: string; count: number }[];
  text?: string | null;
}

export interface TextAction {
  kind: "text";
  name: string;
  text: string;
  recharge?: Recharge;
}

export type Action = AttackAction | SaveAction | MultiattackAction | TextAction;

/** One spell, with an optional note such as "self only" or "can create wine instead of water". */
export interface SpellRef {
  name: string;
  note?: string;
}

export interface SpellSlotLevel {
  /** 1 to 9. Cantrips are kept in `cantrips`. */
  level: number;
  slots: number;
  spells: SpellRef[];
}

export interface SpellPerDay {
  uses: number;
  /** True for "3/day each", false for "1/day" shared between the listed spells. */
  each: boolean;
  spells: SpellRef[];
}

/**
 * Spellcasting as data. The stat block sentence is built from it (lib/spellcastingText.ts) and the
 * exports read the spell lists directly, so a spell is never found by searching prose.
 */
export interface Spellcasting {
  ability: Ability;
  dc: number;
  attack_bonus: number;
  /** "Innate Spellcasting" rather than "Spellcasting". */
  innate: boolean;
  /** The sentence(s) before the spell lists, for example "The hexer is a 4th-level spellcaster. …". */
  intro: string;
  cantrips: SpellRef[];
  slots: SpellSlotLevel[];
  at_will: SpellRef[];
  per_day: SpellPerDay[];
  /** Any sentence after the lists. Usually empty. */
  footer: string;
}

/**
 * The exact printed wording of a damage line, when a plain list of types cannot express it, for example
 * "bludgeoning, piercing, and slashing from nonmagical weapons". The type lists still hold the types.
 */
export interface DamageText {
  vulnerabilities?: string;
  resistances?: string;
  immunities?: string;
}

export interface LegendaryActions {
  per_round: number;
  options: { name: string; cost: number; text: string }[];
}

export interface Monster {
  // identity and provenance
  id: string;
  schema_version: number;
  name: string;
  source: Source;
  validated: boolean;
  parent_id?: string | null;
  generator?: string | null;
  changes?: string[];
  attribution?: string | null;

  // core stat block
  size: Size;
  type: CreatureType;
  subtypes: string[];
  alignment: string;
  armor_class: { value: number; note?: string };
  hit_points: { average: number; dice: string };
  speeds: { walk?: number; fly?: number; swim?: number; climb?: number; burrow?: number; hover?: boolean };
  abilities: Record<Ability, number>;
  saves: Partial<Record<Ability, number>>;
  skills: Record<string, number>;
  vulnerabilities: DamageType[];
  resistances: DamageType[];
  immunities: DamageType[];
  damage_text?: DamageText | null;
  condition_immunities: string[];
  senses: {
    darkvision?: number;
    blindsight?: number;
    tremorsense?: number;
    truesight?: number;
    passive_perception: number;
  };
  languages: string;
  challenge: { cr: string; cr_value: number; xp: number; proficiency_bonus: number };

  // abilities
  traits: TextAction[];
  actions: Action[];
  bonus_actions: Action[];
  reactions: Action[];
  legendary_actions?: LegendaryActions | null;
  spellcasting?: Spellcasting | null;

  // discovery tags
  environments: Environment[];
  role: Role;
  damage_themes: DamageTheme[];
  features: Feature[];

  // presentation
  description: string;
}
