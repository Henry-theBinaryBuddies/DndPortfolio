// Suggestions for the Details step for each SRD race: ages, heights and weights read from its SRD text, and name
// syllables written for Adventurer Anvil.
//
// Ranges: SRD 5.1 describes ages and sizes in words ("between 4 and 5 feet tall", "live less than a century"), so
// each was turned into numbers by hand, with the words beside it. Weights are given only where the SRD gives an
// average, as that average plus or minus 15%; the others get no weight suggestion rather than an invented one.
//
// Names: SRD 5.1 has no name lists. These syllables are our own (Adventurer Anvil's code licence, not the SRD's),
// chosen for each race's feel, and checked so that no start and end rebuild an example name from the Player's Handbook.
import type { Race } from "../../frontend/src/systems/dnd5e-2014/packFormat";

type Suggestions = NonNullable<Race["suggestions"]>;
const ft = (feet: number, inches = 0) => feet * 12 + inches;
const around = (average: number) => ({ min: Math.round(average * 0.85), max: Math.round(average * 1.15) });

/** The SRD's words, and what they became. */
export const RANGES: Record<string, { words: string; ageAdult: number; ageMax: number; height: { min: number; max: number }; weight?: { min: number; max: number } }> = {
  dwarf: { words: "young until 50, live about 350; 4 to 5 feet, about 150 lb", ageAdult: 50, ageMax: 350, height: { min: ft(4), max: ft(5) }, weight: around(150) },
  elf: { words: "adult around 100, live to 750; under 5 to over 6 feet", ageAdult: 100, ageMax: 750, height: { min: ft(4, 10), max: ft(6, 2) } },
  halfling: { words: "adult at 20, live into the middle of their second century; about 3 feet, about 40 lb", ageAdult: 20, ageMax: 150, height: { min: ft(2, 10), max: ft(3, 2) }, weight: around(40) },
  human: { words: "adult in their late teens, live less than a century; barely 5 to well over 6 feet", ageAdult: 18, ageMax: 90, height: { min: ft(5), max: ft(6, 6) } },
  dragonborn: { words: "adult by 15, live to around 80; well over 6 feet, almost 250 lb", ageAdult: 15, ageMax: 80, height: { min: ft(6, 2), max: ft(6, 8) }, weight: around(250) },
  gnome: { words: "adult around 40, live 350 to almost 500; 3 to 4 feet, about 40 lb", ageAdult: 40, ageMax: 450, height: { min: ft(3), max: ft(4) }, weight: around(40) },
  "half-elf": { words: "adult around 20, often exceed 180; 5 to 6 feet", ageAdult: 20, ageMax: 180, height: { min: ft(5), max: ft(6) } },
  "half-orc": { words: "adult around 14, rarely live past 75; 5 to well over 6 feet", ageAdult: 14, ageMax: 75, height: { min: ft(5), max: ft(6, 6) } },
  tiefling: { words: "mature as humans, live a few years longer; human size", ageAdult: 18, ageMax: 100, height: { min: ft(5), max: ft(6, 6) } },
};

export const NAME_PARTS: Record<string, NonNullable<Suggestions["nameParts"]>> = {
  dwarf: {
    start: ["Bar", "Dur", "Gor", "Kha", "Thra", "Bro", "Dag", "Hel", "Mor", "Rur", "Vol", "Ytt"],
    middle: ["a", "i", "o", "un"],
    end: ["din", "grim", "dra", "nar", "rik", "tha", "gar", "wyn", "bek", "dis"],
    family: { start: ["Iron", "Stone", "Deep", "Ember", "Gold", "Anvil", "Granite", "Copper", "Slate", "Hammer"], end: ["delve", "mantle", "vein", "shield", "brow", "hollow", "keel", "helm"] },
  },
  elf: {
    start: ["Ae", "Cael", "Ely", "Ithil", "Lor", "Mae", "Sylv", "Tae", "Vael", "Fen", "Ny", "Ser"],
    middle: ["ra", "li", "an", "the"],
    end: ["wen", "dris", "ion", "ara", "eth", "iel", "or", "yra", "as", "ien"],
    family: { start: ["Moon", "Star", "Silver", "Dawn", "Leaf", "Mist", "Wind", "Dusk"], end: ["bough", "song", "glade", "veil", "shade", "fall", "thorn", "light"] },
  },
  halfling: {
    start: ["Ro", "Pip", "Mer", "Tam", "Bel", "Cor", "Fen", "Lil", "Wil", "Os", "Dod", "Nim"],
    middle: ["a", "i", "o"],
    end: ["by", "wick", "lo", "ny", "ric", "sie", "bo", "den", "ella", "kin"],
    family: { start: ["Apple", "Bramble", "Hill", "Thistle", "Honey", "Kettle", "Tumble", "Clover", "Barley", "Mossy"], end: ["foot", "bottom", "dale", "whistle", "bank", "pot", "weed", "button"] },
  },
  human: {
    start: ["Al", "Bren", "Cor", "Da", "Ed", "Gar", "Hal", "Is", "Jor", "Kat", "Mar", "Ro", "Sel", "Tob", "Wen"],
    middle: ["a", "e", "ri", "o"],
    end: ["ric", "a", "wyn", "ton", "ra", "an", "ett", "ina", "mund", "ley"],
    family: { start: ["Ash", "Black", "Brook", "Har", "Kings", "Mill", "Thorn", "West", "Hollow", "Red"], end: ["wood", "more", "ford", "well", "ton", "field", "gate", "by"] },
  },
  dragonborn: {
    start: ["Ark", "Bal", "Dra", "Gha", "Kri", "Med", "Nal", "Rho", "Sha", "Tor", "Vre", "Zor"],
    middle: ["a", "i", "u", "esh"],
    end: ["ax", "ar", "ion", "esh", "ith", "os", "ra", "uun", "ex", "yra"],
    family: { start: ["Kel", "Mor", "Tur", "Vor", "Nax", "Shan", "Dar", "Yar"], end: ["dranth", "verax", "khan", "thul", "orrin", "sarix", "mesh", "iras"] },
  },
  gnome: {
    start: ["Bim", "Fiz", "Glim", "Nib", "Pock", "Quill", "Tink", "Wob", "Zan", "Orl", "Dim", "Sprock"],
    middle: ["a", "le", "bo", "i"],
    end: ["ble", "wick", "nock", "ix", "ry", "gin", "dle", "pip", "zy", "bert"],
    family: { start: ["Cog", "Gear", "Spark", "Brass", "Fizzle", "Tinker", "Copper", "Whistle"], end: ["spindle", "bottle", "sprocket", "wheel", "button", "pin", "nozzle", "coil"] },
  },
  "half-elf": {
    start: ["Ari", "Cal", "Ely", "Kae", "Lan", "Mir", "Ren", "Sar", "Tal", "Vel"],
    middle: ["a", "i", "en"],
    end: ["dor", "is", "wyn", "ia", "an", "eth", "ric", "elle", "on", "ys"],
    family: { start: ["Ash", "Silver", "Thorn", "Wind", "Brook", "Hollow"], end: ["wood", "glade", "more", "song", "ford", "veil"] },
  },
  "half-orc": {
    start: ["Bru", "Dru", "Gra", "Kru", "Mog", "Rag", "Sku", "Tho", "Urg", "Vol", "Zug", "Har"],
    middle: ["a", "o", "u"],
    end: ["nak", "gash", "ra", "dug", "osh", "ka", "mar", "rek", "tha", "ush"],
  },
  tiefling: {
    start: ["Ak", "Bael", "Cri", "Dam", "Ka", "Mor", "Nem", "Orth", "Ri", "Sor", "Vex", "Zar"],
    middle: ["a", "e", "i", "ra"],
    end: ["ion", "eth", "ira", "ius", "oth", "ys", "ael", "ex", "ora", "is"],
  },
};

/** A race's suggestions, or undefined for a race the tables don't cover. */
export function suggestionsFor(index: string): Suggestions | undefined {
  const r = RANGES[index];
  const names = NAME_PARTS[index];
  if (!r && !names) return undefined;
  return {
    ...(r ? { ageAdult: r.ageAdult, ageMax: r.ageMax, height: r.height, ...(r.weight ? { weight: r.weight } : {}) } : {}),
    ...(names ? { nameParts: names } : {}),
  };
}
