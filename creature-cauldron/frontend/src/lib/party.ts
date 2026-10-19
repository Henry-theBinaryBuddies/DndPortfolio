import { CR_LADDER, type XpRange } from "./filters";

// Party and encounter math from the 2014 DMG (the encounter-building tables).
// Pure functions, so every number here is covered by unit tests.

export const DIFFICULTIES = ["easy", "medium", "hard", "deadly"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** What an encounter rates as: below the easy threshold it is "trivial". */
export type Rating = "trivial" | Difficulty;

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 20;
export const MIN_PARTY_SIZE = 1;
export const MAX_PARTY_SIZE = 10;

/** One entry per character, holding that character's level. */
export interface Party {
  levels: number[];
}

export const DEFAULT_PARTY: Party = { levels: [3, 3, 3, 3] };

/** XP thresholds per character, indexed by level - 1, as [easy, medium, hard, deadly]. */
const THRESHOLDS_BY_LEVEL: readonly (readonly [number, number, number, number])[] = [
  [25, 50, 75, 100],
  [50, 100, 150, 200],
  [75, 150, 225, 400],
  [125, 250, 375, 500],
  [250, 500, 750, 1100],
  [300, 600, 900, 1400],
  [350, 750, 1100, 1700],
  [450, 900, 1400, 2100],
  [550, 1100, 1600, 2400],
  [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600],
  [1000, 2000, 3000, 4500],
  [1100, 2200, 3400, 5100],
  [1250, 2500, 3800, 5700],
  [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200],
  [2000, 3900, 5900, 8800],
  [2100, 4200, 6300, 9500],
  [2400, 4900, 7300, 10900],
  [2800, 5700, 8500, 12700],
];

/** XP awarded by challenge rating, keyed by the CR label ("1/4", "12", ...). */
export const XP_BY_CR: Record<string, number> = {
  "0": 10,
  "1/8": 25,
  "1/4": 50,
  "1/2": 100,
  "1": 200,
  "2": 450,
  "3": 700,
  "4": 1100,
  "5": 1800,
  "6": 2300,
  "7": 2900,
  "8": 3900,
  "9": 5000,
  "10": 5900,
  "11": 7200,
  "12": 8400,
  "13": 10000,
  "14": 11500,
  "15": 13000,
  "16": 15000,
  "17": 18000,
  "18": 20000,
  "19": 22000,
  "20": 25000,
  "21": 33000,
  "22": 41000,
  "23": 50000,
  "24": 62000,
  "25": 75000,
  "26": 90000,
  "27": 105000,
  "28": 120000,
  "29": 135000,
  "30": 155000,
};

export type Thresholds = Record<Difficulty, number>;

/** The party's XP budget for each difficulty: every character's threshold, added up. */
export function partyThresholds(party: Party): Thresholds {
  const totals: Thresholds = { easy: 0, medium: 0, hard: 0, deadly: 0 };
  for (const level of party.levels) {
    const row = THRESHOLDS_BY_LEVEL[Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level)) - 1];
    DIFFICULTIES.forEach((difficulty, i) => {
      totals[difficulty] += row[i];
    });
  }
  return totals;
}

const MULTIPLIERS = [0.5, 1, 1.5, 2, 2.5, 3, 4] as const;

/** Position in MULTIPLIERS for a number of monsters: 1 is x1, 2 is x1.5, 3-6 is x2, and so on. */
function multiplierIndex(monsterCount: number): number {
  if (monsterCount <= 1) return 1;
  if (monsterCount === 2) return 2;
  if (monsterCount <= 6) return 3;
  if (monsterCount <= 10) return 4;
  if (monsterCount <= 14) return 5;
  return 6;
}

/**
 * The encounter multiplier for a number of monsters. Parties under 3 characters
 * use the next higher multiplier; parties of 6 or more use the next lower one.
 */
export function encounterMultiplier(monsterCount: number, partySize: number): number {
  let index = multiplierIndex(monsterCount);
  if (partySize < 3) index = Math.min(index + 1, MULTIPLIERS.length - 1);
  else if (partySize >= 6) index = Math.max(index - 1, 0);
  return MULTIPLIERS[index];
}

/** Total monster XP times the multiplier for how many there are. This is what gets rated. */
export function adjustedXp(monsterXps: number[], partySize: number): number {
  if (monsterXps.length === 0) return 0;
  const total = monsterXps.reduce((sum, xp) => sum + xp, 0);
  return total * encounterMultiplier(monsterXps.length, partySize);
}

/** Rates adjusted XP against the party's budgets. At a threshold counts as that difficulty. */
export function rateEncounter(adjusted: number, thresholds: Thresholds): Rating {
  if (adjusted >= thresholds.deadly) return "deadly";
  if (adjusted >= thresholds.hard) return "hard";
  if (adjusted >= thresholds.medium) return "medium";
  if (adjusted >= thresholds.easy) return "easy";
  return "trivial";
}

/**
 * The monster XP range for which a lone monster makes an encounter of exactly
 * this difficulty. A lone monster is multiplied by encounterMultiplier(1, size),
 * so each threshold is divided by that to get back to the monster's own XP.
 */
export function soloBand(party: Party, difficulty: Difficulty): XpRange {
  const thresholds = partyThresholds(party);
  const multiplier = encounterMultiplier(1, party.levels.length);
  const next = DIFFICULTIES[DIFFICULTIES.indexOf(difficulty) + 1];
  return {
    min: thresholds[difficulty] / multiplier,
    max: next === undefined ? null : thresholds[next] / multiplier,
  };
}

/** The challenge ratings whose XP falls inside the band, as labels in ascending order. */
export function crLabelsInBand(band: XpRange): string[] {
  return CR_LADDER.filter(({ label }) => {
    const xp = XP_BY_CR[label];
    return xp >= band.min && (band.max === null || xp < band.max);
  }).map(({ label }) => label);
}

/** "CR 8", "CR 4-5", "CR 9+", or "no CR fits" when the band falls between two ratings. */
export function describeBand(band: XpRange): string {
  const labels = crLabelsInBand(band);
  if (labels.length === 0) return "no CR fits";
  if (band.max === null) return `CR ${labels[0]}+`;
  if (labels.length === 1) return `CR ${labels[0]}`;
  return `CR ${labels[0]}–${labels[labels.length - 1]}`;
}

/** "4 level-5 characters", or "3 characters (levels 2-4)" for a mixed party. */
export function describeParty(party: Party): string {
  const count = party.levels.length;
  const lowest = Math.min(...party.levels);
  const highest = Math.max(...party.levels);
  if (lowest === highest) return `${count} level-${lowest} character${count === 1 ? "" : "s"}`;
  return `${count} characters (levels ${lowest}–${highest})`;
}
