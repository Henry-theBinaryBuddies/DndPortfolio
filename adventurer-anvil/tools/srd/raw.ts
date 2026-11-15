// The parts of the 5e-bits 2014 files the importer reads (see data/srd-5.1/raw/SOURCE.md). Only what is used is typed.

export interface RawRef {
  index: string;
  name: string;
}

export interface RawOptionSet<T> {
  choose: number;
  from: { options: T[] };
}

export interface RawAbilityBonus {
  ability_score: RawRef;
  bonus: number;
}

export interface RawRace {
  index: string;
  name: string;
  speed: number;
  size: string;
  ability_bonuses: RawAbilityBonus[];
  ability_bonus_options?: RawOptionSet<RawAbilityBonus>;
  age: string;
  alignment: string;
  size_description: string;
  languages: RawRef[];
  language_desc: string;
  language_options?: RawOptionSet<{ item: RawRef }>;
  traits: RawRef[];
}

export interface RawSubrace {
  index: string;
  name: string;
  race: RawRef;
  desc: string;
  ability_bonuses: RawAbilityBonus[];
  racial_traits: RawRef[];
}

export interface RawTrait {
  index: string;
  name: string;
  desc: string[];
  parent?: RawRef;
  proficiencies: RawRef[];
  proficiency_choices?: RawOptionSet<{ item: RawRef }>;
  language_options?: RawOptionSet<{ item: RawRef }>;
  trait_specific?: {
    damage_type?: RawRef;
    breath_weapon?: { area_of_effect: { size: number; type: string }; dc?: { dc_type: RawRef } };
  };
}

export interface RawLanguage {
  index: string;
  name: string;
  type: "Standard" | "Exotic";
  script?: string;
  typical_speakers?: string[];
  desc?: string;
}

export interface RawSrd extends RawSrdClasses {
  backgrounds: RawBackground[];
  equipment: RawEquipment[];
  spells: RawSpell[];
  races: RawRace[];
  subraces: RawSubrace[];
  traits: RawTrait[];
  languages: RawLanguage[];
}

// ---- Classes (5e-SRD-Classes, -Subclasses, -Features, -Levels, -Proficiencies) ----

/** An option in a 5e-bits option set: a reference, a nested choice, or a plain string. */
export type RawOption =
  | { option_type: "reference"; item: RawRef }
  | { option_type: "choice"; choice: RawChoice }
  | { option_type: "multiple"; items: RawOption[] }
  | { option_type: "score_prerequisite"; ability_score: RawRef; minimum_score: number }
  | string;

export interface RawChoice {
  desc?: string;
  choose: number;
  type?: string;
  from: { option_set_type?: string; options: RawOption[] };
}

export interface RawClass extends RawStartingEquipment {
  index: string;
  name: string;
  hit_die: number;
  proficiency_choices: RawChoice[];
  proficiencies: RawRef[];
  saving_throws: RawRef[];
  multi_classing: {
    prerequisites?: { ability_score: RawRef; minimum_score: number }[];
    prerequisite_options?: RawChoice;
    proficiencies: RawRef[];
    proficiency_choices?: RawChoice[];
  };
  subclasses: RawRef[];
  spellcasting?: { level: number; spellcasting_ability: RawRef };
}

export interface RawSubclass {
  index: string;
  name: string;
  class: RawRef;
  subclass_flavor: string;
  desc: string[];
  /** Domain, oath, circle or expanded spells, each from a class level (and, for the Land, a terrain). */
  spells?: { prerequisites: { index: string; type: string }[]; spell: RawRef }[];
}

export interface RawFeature {
  index: string;
  name: string;
  level: number;
  class: RawRef;
  subclass?: RawRef;
  parent?: RawRef;
  desc: string[];
  feature_specific?: {
    subfeature_options?: RawChoice;
    expertise_options?: RawChoice;
    enemy_type_options?: RawChoice;
    terrain_type_options?: RawChoice;
    invocations?: RawRef[];
  };
}

export interface RawLevel {
  index: string;
  level: number;
  class: RawRef;
  subclass?: RawRef;
  features: RawRef[];
  class_specific?: Record<string, unknown>;
  spellcasting?: Record<string, number>;
  subclass_specific?: Record<string, unknown>;
}

export interface RawProficiency {
  index: string;
  name: string;
  type: string;
}

export interface RawSrdClasses {
  classes: RawClass[];
  subclasses: RawSubclass[];
  features: RawFeature[];
  levels: RawLevel[];
  proficiencies: RawProficiency[];
}

// ---- Backgrounds (5e-SRD-Backgrounds) ----

export interface RawBackground extends RawStartingEquipment {
  starting_gold?: { quantity: number; unit: "cp" | "sp" | "gp" };
  index: string;
  name: string;
  starting_proficiencies: RawRef[];
  language_options?: { choose: number };
  feature: { name: string; desc: string[] };
  personality_traits: { choose: number; from: { options: { string: string }[] } };
  ideals: { from: { options: { desc: string; alignments: RawRef[] }[] } };
  bonds: { from: { options: { string: string }[] } };
  flaws: { from: { options: { string: string }[] } };
}

// ---- Equipment (5e-SRD-Equipment, -Equipment-Categories) and starting equipment ----

export interface RawEquipment {
  index: string;
  name: string;
  equipment_categories: RawRef[];
  cost?: { quantity: number; unit: "cp" | "sp" | "gp" };
  weight?: number;
  /** Sold in a bundle of this many (arrows, 20). */
  quantity?: number;
  desc?: string[];
  special?: string[];
  weapon_category?: "Simple" | "Martial";
  weapon_range?: "Melee" | "Ranged";
  damage?: { damage_dice: string; damage_type: RawRef };
  two_handed_damage?: { damage_dice: string; damage_type: RawRef };
  range?: { normal: number; long?: number };
  throw_range?: { normal: number; long?: number };
  properties?: RawRef[];
  armor_category?: "Light" | "Medium" | "Heavy" | "Shield";
  armor_class?: { base: number; dex_bonus: boolean; max_bonus?: number };
  str_minimum?: number;
  stealth_disadvantage?: boolean;
  contents?: { item: RawRef; quantity: number }[];
}

/** An option in a starting-equipment choice. */
export type RawEquipmentOption =
  | { option_type: "counted_reference"; count: number; of: RawRef }
  | { option_type: "multiple"; items: RawEquipmentOption[] }
  | { option_type: "choice"; choice: RawEquipmentChoice };

export interface RawEquipmentChoice {
  desc?: string;
  choose: number;
  from:
    | { option_set_type: "options_array"; options: RawEquipmentOption[] }
    | { option_set_type: "equipment_category"; equipment_category: RawRef };
}

export interface RawStartingEquipment {
  starting_equipment: { equipment: RawRef; quantity: number }[];
  starting_equipment_options: RawEquipmentChoice[];
}

// ---- Spells (5e-SRD-Spells) ----

export interface RawSpell {
  index: string;
  name: string;
  level: number;
  school: RawRef;
  classes: RawRef[];
  casting_time: string;
  range: string;
  components: ("V" | "S" | "M")[];
  material?: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  desc: string[];
  higher_level?: string[];
}
