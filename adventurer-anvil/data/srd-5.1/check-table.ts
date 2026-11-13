// The facts that matter for each SRD 5.1 race and subrace, entered by hand from the SRD 5.1 (not from the community
// files), so a mistake in those files or in the importer shows up as a failing test (srd.test.ts).
// Entered from knowledge of the SRD 5.1 "Races" chapter; still to be confirmed line by line against the official PDF.

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
