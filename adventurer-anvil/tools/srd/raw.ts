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

export interface RawSrd {
  races: RawRace[];
  subraces: RawSubrace[];
  traits: RawTrait[];
  languages: RawLanguage[];
}
