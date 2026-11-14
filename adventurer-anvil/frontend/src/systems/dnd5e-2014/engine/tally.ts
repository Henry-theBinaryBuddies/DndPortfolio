// ③ The tally: every applied effect as a labelled entry, so every derived number can say where it came from.
import type { ChoiceKey } from "../../../core";
import type { Ability, Collection } from "../vocabulary";
import type { DAMAGE_TYPES, MOVEMENT, PROFICIENCY_KINDS, RECHARGE, SENSES } from "../vocabulary";
import type { Item } from "../packFormat";

/** Where an entry came from: the source's name ("Elf"), its step, and the choice key if it was picked. */
export interface Origin {
  name: string;
  step?: string;
  choice?: ChoiceKey;
}

type Of<T extends readonly string[]> = T[number];

/** Uses known once the scores are: an ability modifier, plus `add`, at least `min`. */
export type AbilityUses = { ability: Ability; add?: number; min?: number };

export interface Tally {
  abilityBonuses: { ability: Ability; amount: number; from: Origin }[];
  speeds: { mode: Of<typeof MOVEMENT>; value: number; from: Origin }[];
  senses: { sense: Of<typeof SENSES>; range: number; from: Origin }[];
  /** `replaced`: a duplicate the character swaps for another (see engine/duplicates.ts); it counts for nothing. */
  proficiencies: { kind: Of<typeof PROFICIENCY_KINDS>; id: string; from: Origin; replaced?: boolean }[];
  expertise: { kind: "skill" | "tool"; id: string; from: Origin }[];
  languages: { ref: string; name: string; from: Origin }[];
  resistances: { damage: Of<typeof DAMAGE_TYPES>; from: Origin }[];
  grants: { collection: Collection; ref: string; name: string; from: Origin }[];
  resources: { id: string; name: string; uses: number | AbilityUses; recharge: Of<typeof RECHARGE>; from: Origin }[];
  features: { name: string; summary?: string; description?: string; source?: { book: string; page?: number }; from: Origin }[];
  /** Ways to work out Armor Class unarmoured, besides 10 + Dex. */
  acFormulas: { base: number; abilities: Ability[]; shield?: boolean; from: Origin }[];
  acBonuses: { amount: number; while?: "armored" | "unarmored"; from: Origin }[];
  hitPoints: { perLevel: number; from: Origin }[];
  /** Class levels, the first class first. */
  classes: { ref: string; name: string; hitDie: number; level: number }[];
  /**
   * What the character carries. `ref` is missing for things named only in starting equipment ("vestments");
   * `weight` is per item (a bundle's weight already shared out); `in` names the pack it came in.
   */
  items: { ref?: string; name: string; qty: number; weight: number; from: Origin; in?: string }[];
  /** Money in copper pieces: what was given or rolled, and what was spent (negative). */
  coins: { cp: number; label: string }[];
  /** What is worn: body armour and a shield. */
  worn: { armor?: { ref: string; name: string; armor: NonNullable<Item["armor"]> }; shield?: { ref: string; name: string; bonus: number } };
  /** Weapons carried, once each, for the attack list. */
  weapons: { ref: string; name: string; weapon: NonNullable<Item["weapon"]> }[];
}

export function emptyTally(): Tally {
  return {
    abilityBonuses: [], speeds: [], senses: [], proficiencies: [], expertise: [], languages: [], resistances: [], grants: [],
    resources: [], features: [], acFormulas: [], acBonuses: [], hitPoints: [], classes: [], items: [], coins: [], worn: {}, weapons: [],
  };
}

/** Ability bonuses for one ability, in the order they were applied. */
export function bonusesFor(tally: Tally, ability: Ability) {
  return tally.abilityBonuses.filter((b) => b.ability === ability);
}
