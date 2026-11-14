// The facts that matter for each SRD 5.1 race and subrace, entered by hand from the SRD 5.1 (not from the community
// files), so a mistake in those files or in the importer shows up as a failing test (srd.test.ts).
// Entered from knowledge of the SRD 5.1 "Races" and "Classes" chapters; still to be confirmed line by line against the official PDF.

export interface RaceFacts {
  name: string;
  bonuses: Record<string, number>;
  size: "small" | "medium";
  speed: number;
  darkvision?: number;
  languages: string[];
  /** Choices of extra language. */
  extraLanguages?: number;
  skills?: string[];
  weapons?: string[];
  tools?: string[];
  resistances?: string[];
}

export const RACES: Record<string, RaceFacts> = {
  dwarf: {
    name: "Dwarf", bonuses: { con: 2 }, size: "medium", speed: 25, darkvision: 60, languages: ["Common", "Dwarvish"],
    weapons: ["Battleaxe", "Handaxe", "Light Hammer", "Warhammer"], resistances: ["Poison"],
  },
  elf: { name: "Elf", bonuses: { dex: 2 }, size: "medium", speed: 30, darkvision: 60, languages: ["Common", "Elvish"], skills: ["Perception"] },
  halfling: { name: "Halfling", bonuses: { dex: 2 }, size: "small", speed: 25, languages: ["Common", "Halfling"] },
  human: {
    name: "Human", bonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, size: "medium", speed: 30, languages: ["Common"], extraLanguages: 1,
  },
  dragonborn: { name: "Dragonborn", bonuses: { str: 2, cha: 1 }, size: "medium", speed: 30, languages: ["Common", "Draconic"] },
  gnome: { name: "Gnome", bonuses: { int: 2 }, size: "small", speed: 25, darkvision: 60, languages: ["Common", "Gnomish"] },
  "half-elf": {
    name: "Half-Elf", bonuses: { cha: 2 }, size: "medium", speed: 30, darkvision: 60, languages: ["Common", "Elvish"], extraLanguages: 1,
  },
  "half-orc": {
    name: "Half-Orc", bonuses: { str: 2, con: 1 }, size: "medium", speed: 30, darkvision: 60, languages: ["Common", "Orc"], skills: ["Intimidation"],
  },
  tiefling: {
    name: "Tiefling", bonuses: { int: 1, cha: 2 }, size: "medium", speed: 30, darkvision: 60, languages: ["Common", "Infernal"], resistances: ["Fire"],
  },
};

export interface SubraceFacts {
  name: string;
  race: string;
  bonuses: Record<string, number>;
  weapons?: string[];
  tools?: string[];
  extraLanguages?: number;
}

export const SUBRACES: Record<string, SubraceFacts> = {
  "hill-dwarf": { name: "Hill Dwarf", race: "dwarf", bonuses: { wis: 1 } },
  "high-elf": { name: "High Elf", race: "elf", bonuses: { int: 1 }, weapons: ["Longsword", "Shortsword", "Shortbow", "Longbow"], extraLanguages: 1 },
  "lightfoot-halfling": { name: "Lightfoot Halfling", race: "halfling", bonuses: { cha: 1 } },
  "rock-gnome": { name: "Rock Gnome", race: "gnome", bonuses: { con: 1 }, tools: ["Tinkers Tools"] },
};

export const LANGUAGES = {
  standard: ["Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc"],
  exotic: ["Abyssal", "Celestial", "Draconic", "Deep Speech", "Infernal", "Primordial", "Sylvan", "Undercommon"],
};

export interface ClassFacts {
  name: string;
  hitDie: number;
  saves: string[];
  /** How many skills the class picks at level 1, and from how many. */
  skills: [pick: number, from: number];
  subclass: { name: string; level: number };
  /** Level-1 features by their SRD headings (each must appear; the pack may split one into parts). */
  level1: string[];
}

export const CLASSES: Record<string, ClassFacts> = {
  barbarian: { name: "Barbarian", hitDie: 12, saves: ["Strength", "Constitution"], skills: [2, 6], subclass: { name: "Primal Path", level: 3 }, level1: ["Rage", "Unarmored Defense"] },
  bard: { name: "Bard", hitDie: 8, saves: ["Dexterity", "Charisma"], skills: [3, 18], subclass: { name: "Bard College", level: 3 }, level1: ["Spellcasting", "Bardic Inspiration"] },
  cleric: { name: "Cleric", hitDie: 8, saves: ["Wisdom", "Charisma"], skills: [2, 5], subclass: { name: "Divine Domain", level: 1 }, level1: ["Spellcasting", "Divine Domain"] },
  druid: { name: "Druid", hitDie: 8, saves: ["Intelligence", "Wisdom"], skills: [2, 8], subclass: { name: "Druid Circle", level: 2 }, level1: ["Druidic", "Spellcasting"] },
  fighter: { name: "Fighter", hitDie: 10, saves: ["Strength", "Constitution"], skills: [2, 8], subclass: { name: "Martial Archetype", level: 3 }, level1: ["Fighting Style", "Second Wind"] },
  monk: { name: "Monk", hitDie: 8, saves: ["Strength", "Dexterity"], skills: [2, 6], subclass: { name: "Monastic Tradition", level: 3 }, level1: ["Unarmored Defense", "Martial Arts"] },
  paladin: { name: "Paladin", hitDie: 10, saves: ["Wisdom", "Charisma"], skills: [2, 6], subclass: { name: "Sacred Oath", level: 3 }, level1: ["Divine Sense", "Lay on Hands"] },
  ranger: { name: "Ranger", hitDie: 10, saves: ["Strength", "Dexterity"], skills: [3, 8], subclass: { name: "Ranger Archetype", level: 3 }, level1: ["Favored Enemy", "Natural Explorer"] },
  rogue: { name: "Rogue", hitDie: 8, saves: ["Dexterity", "Intelligence"], skills: [4, 11], subclass: { name: "Roguish Archetype", level: 3 }, level1: ["Expertise", "Sneak Attack", "Thieves' Cant"] },
  sorcerer: { name: "Sorcerer", hitDie: 6, saves: ["Constitution", "Charisma"], skills: [2, 6], subclass: { name: "Sorcerous Origin", level: 1 }, level1: ["Spellcasting", "Sorcerous Origin"] },
  warlock: { name: "Warlock", hitDie: 8, saves: ["Wisdom", "Charisma"], skills: [2, 7], subclass: { name: "Otherworldly Patron", level: 1 }, level1: ["Otherworldly Patron", "Pact Magic"] },
  wizard: { name: "Wizard", hitDie: 6, saves: ["Intelligence", "Wisdom"], skills: [2, 6], subclass: { name: "Arcane Tradition", level: 2 }, level1: ["Spellcasting", "Arcane Recovery"] },
};

export interface BackgroundFacts {
  name: string;
  skills: string[];
  /** Languages of your choice. */
  languages: number;
  feature: string;
  /** How many entries in each characteristics table (d8, d6, d6, d6). */
  tables: { traits: number; ideals: number; bonds: number; flaws: number };
}

export const BACKGROUNDS: Record<string, BackgroundFacts> = {
  acolyte: {
    name: "Acolyte", skills: ["Insight", "Religion"], languages: 2, feature: "Shelter of the Faithful",
    tables: { traits: 8, ideals: 6, bonds: 6, flaws: 6 },
  },
};
