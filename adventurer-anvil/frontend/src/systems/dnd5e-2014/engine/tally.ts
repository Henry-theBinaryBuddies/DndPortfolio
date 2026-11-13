// ③ The tally: every applied effect as a labelled entry, so every derived number can say where it came from.
import type { ChoiceKey } from "../../../core";
import type { Ability, Collection } from "../vocabulary";
import type { DAMAGE_TYPES, MOVEMENT, PROFICIENCY_KINDS, RECHARGE, SENSES } from "../vocabulary";

/** Where an entry came from: the source's name ("Elf"), and the choice key if it was picked. */
export interface Origin {
  name: string;
  choice?: ChoiceKey;
}

type Of<T extends readonly string[]> = T[number];

export interface Tally {
  abilityBonuses: { ability: Ability; amount: number; from: Origin }[];
  speeds: { mode: Of<typeof MOVEMENT>; value: number; from: Origin }[];
  senses: { sense: Of<typeof SENSES>; range: number; from: Origin }[];
  proficiencies: { kind: Of<typeof PROFICIENCY_KINDS>; id: string; from: Origin }[];
  languages: { ref: string; name: string; from: Origin }[];
  resistances: { damage: Of<typeof DAMAGE_TYPES>; from: Origin }[];
  grants: { collection: Collection; ref: string; name: string; from: Origin }[];
  resources: { id: string; name: string; uses: number; recharge: Of<typeof RECHARGE>; from: Origin }[];
  features: { name: string; summary?: string; source?: { book: string; page?: number }; from: Origin }[];
}

export function emptyTally(): Tally {
  return {
    abilityBonuses: [], speeds: [], senses: [], proficiencies: [], languages: [],
    resistances: [], grants: [], resources: [], features: [],
  };
}

/** Ability bonuses for one ability, in the order they were applied. */
export function bonusesFor(tally: Tally, ability: Ability) {
  return tally.abilityBonuses.filter((b) => b.ability === ability);
}
