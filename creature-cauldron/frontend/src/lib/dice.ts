// Pure helpers for D&D arithmetic. No React in here, so they are easy to test.

export interface ParsedDice {
  count: number;
  sides: number;
  bonus: number;
}

/** Ability score to modifier: 10-11 is +0, 12-13 is +1, 8-9 is -1, and so on. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** 4 becomes "+4", -1 becomes "-1", 0 becomes "+0". */
export function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : `-${Math.abs(n)}`;
}

/** Parses "2d6" or "4d8+8" or "1d6 - 1". Throws on anything else. */
export function parseDice(expression: string): ParsedDice {
  const match = /^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/.exec(expression.trim());
  if (!match) {
    throw new Error(`Invalid dice expression: "${expression}"`);
  }
  const [, count, sides, sign, amount] = match;
  const bonus = amount ? Number(amount) * (sign === "-" ? -1 : 1) : 0;
  return { count: Number(count), sides: Number(sides), bonus };
}

/**
 * Average of a dice expression plus an extra flat bonus, rounded down.
 * Rounding down is the convention printed in stat blocks: 1d4+3 is 5, not 5.5.
 */
export function averageDice(expression: string, extraBonus = 0): number {
  const { count, sides, bonus } = parseDice(expression);
  return Math.floor((count * (sides + 1)) / 2 + bonus + extraBonus);
}

/** "9 (2d6 + 2)" for a roll with a bonus, "3 (1d6)" without one. */
export function formatDamageRoll(dice: string, bonus: number): string {
  const average = averageDice(dice, bonus);
  if (bonus === 0) return `${average} (${dice})`;
  const sign = bonus > 0 ? "+" : "-";
  return `${average} (${dice} ${sign} ${Math.abs(bonus)})`;
}
