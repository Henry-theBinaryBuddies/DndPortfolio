// Suggestions for the Details step: names built from a race's syllables, and ages, heights and weights inside its
// ranges. They are a writing aid, not a game roll, so they come from a seed (the character and the race), which
// keeps evaluation pure and gives the same character the same list each time.

/** A small seeded random generator (mulberry32): numbers in [0, 1). */
export function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length)];
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface NameParts {
  start: string[];
  middle?: string[];
  end: string[];
  family?: { start: string[]; end: string[] };
}

/** Up to `count` different names: a start, a middle about a third of the time, an end, and a family name if the race has one. */
export function makeNames(parts: NameParts, random: () => number, count: number): string[] {
  const names = new Set<string>();
  for (let tries = 0; names.size < count && tries < count * 20; tries++) {
    const given = capital(pick(parts.start, random) + (parts.middle && random() < 0.35 ? pick(parts.middle, random) : "") + pick(parts.end, random));
    const family = parts.family ? ` ${capital(pick(parts.family.start, random) + pick(parts.family.end, random))}` : "";
    names.add(given + family);
  }
  return [...names];
}

/**
 * Up to `count` names from a pack's lists: every list but "family" holds given names, and each is paired with a
 * family name when there is a "family" list.
 */
export function namesFromLists(lists: Record<string, string[]>, random: () => number, count: number): string[] {
  const given = Object.entries(lists).filter(([kind]) => kind !== "family").flatMap(([, l]) => l);
  const family = lists.family ?? [];
  if (!given.length) return [];
  const names = new Set<string>();
  for (let tries = 0; names.size < Math.min(count, given.length * Math.max(1, family.length)) && tries < count * 20; tries++) {
    names.add(family.length ? `${pick(given, random)} ${pick(family, random)}` : pick(given, random));
  }
  return [...names];
}

/** "4 ft 7 in" from inches. */
export const feetAndInches = (inches: number) => `${Math.floor(inches / 12)} ft ${Math.round(inches % 12)} in`;

/** `count` whole numbers spread across a range, in a random order: each suggestion different where the range allows. */
export function spread(min: number, max: number, random: () => number, count: number): number[] {
  const values = new Set<number>();
  for (let tries = 0; values.size < count && tries < count * 20; tries++) values.add(Math.round(min + random() * (max - min)));
  return [...values];
}
