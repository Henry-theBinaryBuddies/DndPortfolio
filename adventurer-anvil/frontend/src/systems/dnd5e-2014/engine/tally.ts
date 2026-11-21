// ③ The tally: every applied effect as a labelled entry, so every derived number can say where it came from.
import type { ChoiceKey } from "../../../core";
import type { Ability, Collection } from "../vocabulary";
import type { DAMAGE_TYPES, MOVEMENT, PROFICIENCY_KINDS, RECHARGE, SENSES } from "../vocabulary";
import type { Item } from "../packFormat";

/**
 * Where an entry came from: the source's name ("Elf"), its step, and the choice key if it was picked. For a class or
 * subclass, `at` is the class level it comes at ("Fighter 3").
 */
export interface Origin {
  name: string;
  step?: string;
  choice?: ChoiceKey;
  at?: string;
}

/** An origin for people: "Fighter 3", "Champion (Fighter 3)", or just the name. */
export function originText(o: Origin): string {
  if (!o.at) return o.name;
  return o.at.startsWith(o.name) ? o.at : `${o.name} (${o.at})`;
}

type Of<T extends readonly string[]> = T[number];

/** Uses known once the scores are: an ability modifier, plus `add`, at least `min`. */
export type AbilityUses = { ability: Ability; add?: number; min?: number };

export interface Tally {
  /** `cap`: this bonus may not raise the score above it (an Ability Score Improvement's 20). */
  abilityBonuses: { ability: Ability; amount: number; from: Origin; cap?: number }[];
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
  /** `classLevel`: given by a class or subclass, so counted per level in that class rather than per character level. */
  hitPoints: { perLevel: number; from: Origin; classLevel?: number }[];
  /**
   * Class levels, the first class first, with the subclass's name once chosen. `rolled`: with rolled hit points, the
   * latest roll for each class level after the first ever taken (missing until rolled).
   */
  classes: { ref: string; name: string; hitDie: number; level: number; subclass?: string; rolled?: Record<number, number> }[];
  /**
   * What the character carries. `ref` is missing for things named only in starting equipment ("vestments");
   * `weight` is per item (a bundle's weight already shared out); `in` names the pack it came in.
   */
  items: { ref?: string; name: string; qty: number; weight: number; from: Origin; in?: string }[];
  /** Money in copper pieces: what was given or rolled, and what was spent (negative). */
  coins: { cp: number; label: string }[];
  /** What is worn: body armour and a shield. */
  worn: { armor?: { ref: string; name: string; armor: NonNullable<Item["armor"]> }; shield?: { ref: string; name: string; bonus: number } };
  /**
   * Spells the character has, once each: `ability` is what it's cast with; `always` means always prepared;
   * `prepared` is set by the Spells step for spells prepared today.
   */
  spells: { ref: string; name: string; level: number; from: Origin; ability?: Ability; always?: boolean; prepared?: boolean; description?: string }[];
  /**
   * Each class that casts spells: its ability and slots by spell level (a warlock's pact slots come back on a short
   * rest). A multiclass character's shared slots are one entry of their own, without an ability.
   */
  casting: { name: string; ability?: Ability; slots: Record<number, number>; pact?: boolean }[];
  /** Spells added to a class's list (a Fiend's expanded spells). */
  expandedSpells: { ref: string; from: Origin }[];
  /** Weapons carried, once each, for the attack list. */
  weapons: { ref: string; name: string; weapon: NonNullable<Item["weapon"]> }[];
}

export function emptyTally(): Tally {
  return {
    abilityBonuses: [], speeds: [], senses: [], proficiencies: [], expertise: [], languages: [], resistances: [], grants: [],
    resources: [], features: [], acFormulas: [], acBonuses: [], hitPoints: [], classes: [], items: [], coins: [], worn: {}, weapons: [], spells: [], casting: [], expandedSpells: [],
  };
}

/** Ability bonuses for one ability, in the order they were applied. */
export function bonusesFor(tally: Tally, ability: Ability) {
  return tally.abilityBonuses.filter((b) => b.ability === ability);
}
