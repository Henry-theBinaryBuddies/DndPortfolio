// The fixed vocabulary of the 2014 rules: things no book adds more of. Content (races, spells, ...) is in packs.

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];

export const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};

export const SKILLS = {
  acrobatics: { name: "Acrobatics", ability: "dex" },
  "animal-handling": { name: "Animal Handling", ability: "wis" },
  arcana: { name: "Arcana", ability: "int" },
  athletics: { name: "Athletics", ability: "str" },
  deception: { name: "Deception", ability: "cha" },
  history: { name: "History", ability: "int" },
  insight: { name: "Insight", ability: "wis" },
  intimidation: { name: "Intimidation", ability: "cha" },
  investigation: { name: "Investigation", ability: "int" },
  medicine: { name: "Medicine", ability: "wis" },
  nature: { name: "Nature", ability: "int" },
  perception: { name: "Perception", ability: "wis" },
  performance: { name: "Performance", ability: "cha" },
  persuasion: { name: "Persuasion", ability: "cha" },
  religion: { name: "Religion", ability: "int" },
  "sleight-of-hand": { name: "Sleight of Hand", ability: "dex" },
  stealth: { name: "Stealth", ability: "dex" },
  survival: { name: "Survival", ability: "wis" },
} as const satisfies Record<string, { name: string; ability: Ability }>;
export type Skill = keyof typeof SKILLS;
export const SKILL_IDS = Object.keys(SKILLS) as [Skill, ...Skill[]];

export const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;

export const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
] as const;

export const CONDITIONS = [
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible",
  "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious",
] as const;

export const SENSES = ["darkvision", "blindsight", "tremorsense", "truesight"] as const;

export const MOVEMENT = ["walk", "fly", "swim", "climb", "burrow"] as const;

/** What a proficiency effect can grant. Weapon, armour and tool ids will be checked against items once that collection exists. */
export const PROFICIENCY_KINDS = ["skill", "saving-throw", "weapon", "armor", "tool"] as const;

export const RECHARGE = ["short", "long", "dawn"] as const;

/** Every collection a 2014 pack may hold. Formats for the rest arrive with the steps that use them. */
export const COLLECTIONS = [
  "races", "subraces", "classes", "subclasses", "backgrounds", "feats", "spells", "items", "languages",
] as const;
export type Collection = (typeof COLLECTIONS)[number];
