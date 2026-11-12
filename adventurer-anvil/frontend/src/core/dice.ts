// Dice notation shared across games: "4d6kh3" (four six-sided dice, keep the highest three), "2d10+3", "1d8-1",
// "3d6kl1" (keep the lowest one), and terms added together: "1d4+1d6+2".

export interface DiceTerm {
  kind: "dice";
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { which: "highest" | "lowest"; n: number };
}

export interface ConstantTerm {
  kind: "constant";
  sign: 1 | -1;
  value: number;
}

export type Term = DiceTerm | ConstantTerm;

export interface RollResult {
  expression: string;
  dice: number[];
  kept: number[];
  total: number;
}

const MAX_COUNT = 100;
const MAX_SIDES = 1000;

/** Parses dice notation. Throws with a readable message when it is not valid. */
export function parseDice(expression: string): Term[] {
  // Spaces are allowed only around + and -: "1d6 2" is a typo, not a 62-sided die.
  if (/\w\s+\w/.test(expression)) throw new Error(`Cannot read the dice expression "${expression}".`);
  const text = expression.replace(/\s+/g, "").toLowerCase();
  if (!text) throw new Error("Empty dice expression.");
  const termPattern = /([+-]?)(?:(\d*)d(\d+)(?:k([hl])(\d+))?|(\d+))/y;
  const terms: Term[] = [];
  let at = 0;
  while (at < text.length) {
    termPattern.lastIndex = at;
    const m = termPattern.exec(text);
    if (!m || (terms.length > 0 && !m[1])) throw new Error(`Cannot read the dice expression "${expression}".`);
    const sign = m[1] === "-" ? -1 : 1;
    if (m[6] !== undefined) {
      terms.push({ kind: "constant", sign, value: Number(m[6]) });
    } else {
      const count = m[2] === "" ? 1 : Number(m[2]);
      const sides = Number(m[3]);
      if (count < 1 || count > MAX_COUNT) throw new Error(`Between 1 and ${MAX_COUNT} dice, please ("${expression}").`);
      if (sides < 2 || sides > MAX_SIDES) throw new Error(`Dice need 2 to ${MAX_SIDES} sides ("${expression}").`);
      const term: DiceTerm = { kind: "dice", sign, count, sides };
      if (m[4]) {
        const n = Number(m[5]);
        if (n < 1 || n > count) throw new Error(`Cannot keep ${n} of ${count} dice ("${expression}").`);
        term.keep = { which: m[4] === "h" ? "highest" : "lowest", n };
      }
      terms.push(term);
    }
    at = termPattern.lastIndex;
  }
  return terms;
}

/**
 * Rolls dice notation. `random` returns a number in [0, 1), like Math.random, which is the default;
 * tests pass their own to get known results.
 */
export function rollDice(expression: string, random: () => number = Math.random): RollResult {
  const dice: number[] = [];
  const kept: number[] = [];
  let total = 0;
  for (const term of parseDice(expression)) {
    if (term.kind === "constant") {
      total += term.sign * term.value;
      continue;
    }
    const rolled = Array.from({ length: term.count }, () => 1 + Math.floor(random() * term.sides));
    dice.push(...rolled);
    const counted = term.keep ? keepDice(rolled, term.keep) : rolled;
    kept.push(...counted);
    total += term.sign * counted.reduce((a, b) => a + b, 0);
  }
  return { expression, dice, kept, total };
}

/** The dice that count, in the order they were rolled. */
function keepDice(rolled: number[], keep: { which: "highest" | "lowest"; n: number }): number[] {
  const order = rolled.map((value, index) => ({ value, index }));
  order.sort((a, b) => (keep.which === "highest" ? b.value - a.value : a.value - b.value) || a.index - b.index);
  const keptIndexes = new Set(order.slice(0, keep.n).map((d) => d.index));
  return rolled.filter((_, index) => keptIndexes.has(index));
}
