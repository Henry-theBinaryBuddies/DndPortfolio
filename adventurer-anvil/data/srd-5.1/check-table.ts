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
    weapons: ["Battleaxe", "Handaxe", "Light hammer", "Warhammer"], resistances: ["Poison"],
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
  "rock-gnome": { name: "Rock Gnome", race: "gnome", bonuses: { con: 1 }, tools: ["Tinker's Tools"] },
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
  kit: KitFacts;
}

export const BACKGROUNDS: Record<string, BackgroundFacts> = {
  acolyte: {
    name: "Acolyte", skills: ["Insight", "Religion"], languages: 2, feature: "Shelter of the Faithful",
    tables: { traits: 8, ideals: 6, bonds: 6, flaws: 6 },
    // A holy symbol, a prayer book or prayer wheel, 5 sticks of incense, vestments, common clothes, a pouch with 15 gp.
    kit: { items: { vestments: 1, "clothes-common": 1, pouch: 1 }, named: ["Sticks of incense × 5"], any: ["a holy symbol"], choices: 1, gold: "15 gp" },
  },
};

/** A class's or background's starting equipment: fixed items by item id and count, things named only, "any" lines, how many lettered choices, and gold. */
export interface KitFacts {
  items: Record<string, number>;
  named?: string[];
  any?: string[];
  choices: number;
  gold?: string;
}

/** Each class's starting equipment ("You start with the following equipment, in addition to the equipment granted by your background"). */
export const KITS: Record<string, KitFacts> = {
  barbarian: { items: { "explorers-pack": 1, javelin: 4 }, choices: 2 },
  bard: { items: { "leather-armor": 1, dagger: 1 }, choices: 3 },
  cleric: { items: { shield: 1 }, any: ["a holy symbol"], choices: 4 },
  druid: { items: { "leather-armor": 1, "explorers-pack": 1 }, any: ["a druidic focus"], choices: 2 },
  fighter: { items: {}, choices: 4 },
  monk: { items: { dart: 10 }, choices: 2 },
  paladin: { items: { "chain-mail": 1 }, any: ["a holy symbol"], choices: 3 },
  ranger: { items: { longbow: 1, quiver: 1, arrow: 20 }, choices: 3 },
  rogue: { items: { "leather-armor": 1, dagger: 2, "thieves-tools": 1 }, choices: 3 },
  sorcerer: { items: { dagger: 2 }, choices: 3 },
  warlock: { items: { "leather-armor": 1, dagger: 2 }, any: ["a simple weapon"], choices: 3 },
  wizard: { items: { spellbook: 1 }, choices: 3 },
};

/** Each caster at level 1, from the class tables and text: cantrips, spells known (or in the spellbook), 1st-level slots, the ability, and its cantrips by name. */
export interface CasterFacts {
  ability: string;
  /** The class level spellcasting starts at. */
  starts: number;
  cantrips?: number;
  known?: number;
  spellbook?: number;
  slots1?: number;
  cantripList?: string[];
}

export const CASTERS: Record<string, CasterFacts> = {
  bard: {
    ability: "cha", starts: 1, cantrips: 2, known: 4, slots1: 2,
    cantripList: ["Dancing Lights", "Light", "Mage Hand", "Mending", "Message", "Minor Illusion", "Prestidigitation", "True Strike", "Vicious Mockery"],
  },
  cleric: {
    ability: "wis", starts: 1, cantrips: 3, slots1: 2,
    cantripList: ["Guidance", "Light", "Mending", "Resistance", "Sacred Flame", "Spare the Dying", "Thaumaturgy"],
  },
  druid: {
    ability: "wis", starts: 1, cantrips: 2, slots1: 2,
    cantripList: ["Druidcraft", "Guidance", "Mending", "Poison Spray", "Produce Flame", "Resistance", "Shillelagh"],
  },
  paladin: { ability: "cha", starts: 2 },
  ranger: { ability: "wis", starts: 2 },
  sorcerer: {
    ability: "cha", starts: 1, cantrips: 4, known: 2, slots1: 2,
    cantripList: ["Acid Splash", "Chill Touch", "Dancing Lights", "Fire Bolt", "Light", "Mage Hand", "Mending", "Message", "Minor Illusion", "Poison Spray", "Prestidigitation", "Ray of Frost", "Shocking Grasp", "True Strike"],
  },
  warlock: {
    ability: "cha", starts: 1, cantrips: 2, known: 2, slots1: 1,
    cantripList: ["Chill Touch", "Eldritch Blast", "Mage Hand", "Minor Illusion", "Poison Spray", "Prestidigitation", "True Strike"],
  },
  wizard: {
    ability: "int", starts: 1, cantrips: 3, spellbook: 6, slots1: 2,
    cantripList: ["Acid Splash", "Chill Touch", "Dancing Lights", "Fire Bolt", "Light", "Mage Hand", "Mending", "Message", "Minor Illusion", "Poison Spray", "Prestidigitation", "Ray of Frost", "Shocking Grasp", "True Strike"],
  },
};
