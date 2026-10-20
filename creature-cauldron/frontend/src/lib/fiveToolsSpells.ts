import type { Spellcasting } from "../types/monster";
import type { JsonObject } from "./foundryJson";
import { tagProse } from "./fiveToolsTags";

// Turns a monster's spellcasting prose into 5etools' structured spellcasting block, so a tool like
// Plutonium can read the spell lists (and link each spell) instead of showing a paragraph.
//
// It understands OUR wording, which follows the stat block pattern:
//   "<intro>. Cantrips (at will): a, b. 1st level (4 slots): c, d. At will: e. 1/day each: f, g."
// Anything else returns null, and the caller keeps the text as a plain trait instead.

/**
 * One list line: a heading, a colon, the spells, and a full stop. The headings are
 * "Cantrips (at will)", "At will", "1st level (4 slots)", "1/day", and "3/day each".
 */
const LIST_LINE = /(Cantrips \(at will\)|At will|(\d)(?:st|nd|rd|th) level \((\d+) slots?\)|(\d)\/day( each)?): ([^.]+)\./g;

/** Splits "a, b (c, d), e" at the commas that are not inside brackets. */
export function splitSpellList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth++;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** "fireball" becomes "{@spell fireball}". A note in brackets stays as plain text after the tag. */
export function spellTag(entry: string): string {
  const bracket = entry.indexOf(" (");
  if (bracket === -1) return `{@spell ${entry}}`;
  return `{@spell ${entry.slice(0, bracket)}}${entry.slice(bracket)}`;
}

/**
 * The structured block for this spellcasting text, or null when no spell lists are recognised.
 * The casting ability comes from the monster's own field, not from the prose.
 */
export function parseSpellcasting(spellcasting: Spellcasting): JsonObject | null {
  const text = spellcasting.text;
  const spells: Record<string, JsonObject> = {};
  const daily: Record<string, string[]> = {};
  const will: string[] = [];
  let firstStart = -1;
  let lastEnd = 0;

  for (const match of text.matchAll(LIST_LINE)) {
    const [whole, heading, levelText, slotsText, perDay, each, list] = match;
    if (firstStart === -1) firstStart = match.index;
    lastEnd = match.index + whole.length;
    const tagged = splitSpellList(list).map(spellTag);

    if (heading === "At will") {
      will.push(...tagged);
    } else if (heading.startsWith("Cantrips")) {
      const entry = (spells["0"] ??= { spells: [] });
      (entry.spells as string[]).push(...tagged);
    } else if (levelText !== undefined) {
      const entry = (spells[levelText] ??= { spells: [] });
      entry.slots = Number(slotsText);
      (entry.spells as string[]).push(...tagged);
    } else if (perDay !== undefined) {
      const key = `${perDay}${each ? "e" : ""}`;
      (daily[key] ??= []).push(...tagged);
    }
  }
  if (firstStart === -1) return null;

  const header = text.slice(0, firstStart).trim();
  const footer = text.slice(lastEnd).trim();
  const innate = /innate/i.test(header);

  const block: JsonObject = {
    name: innate ? "Innate Spellcasting" : "Spellcasting",
    type: "spellcasting",
    headerEntries: [tagProse(header)],
  };
  if (will.length > 0) block.will = will;
  if (Object.keys(daily).length > 0) block.daily = daily;
  if (Object.keys(spells).length > 0) block.spells = spells;
  if (footer !== "") block.footerEntries = [tagProse(footer)];
  block.ability = spellcasting.ability;
  return block;
}
