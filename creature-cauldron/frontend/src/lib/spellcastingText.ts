import type { SpellRef, Spellcasting } from "../types/monster";

// Spellcasting is stored as data (see types/monster.ts). This file converts between that data and the
// stat block sentence:
//   "<intro> Cantrips (at will): a, b. 1st level (4 slots): c, d. At will: e. 1/day each: f, g. <footer>"
// spellcastingToText writes the sentence. (The reverse, reading the sentence back into data, is only needed by the
// tests: lib/testing/parseSpellcasting.ts. Importing real stat blocks is done in Python, in seed/spells.py.)

const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

export function spellRefText(spell: SpellRef): string {
  return spell.note ? `${spell.name} (${spell.note})` : spell.name;
}

const listText = (spells: SpellRef[]): string => spells.map(spellRefText).join(", ");

/** "a 9th-level spellcaster" gives 9. Null when the intro does not say. */
export function casterLevel(sc: Spellcasting): number | null {
  const match = /(\d+)(?:st|nd|rd|th)-level spellcaster/i.exec(sc.intro);
  return match ? Number(match[1]) : null;
}

/** True when the spellcasting has at least one spell list (otherwise only `intro` carries information). */
export function hasSpellLists(sc: Spellcasting): boolean {
  return sc.cantrips.length + sc.slots.length + sc.at_will.length + sc.per_day.length > 0;
}

/** The stat block text: the intro, each list on its own sentence, then the footer. */
export function spellcastingToText(sc: Spellcasting): string {
  const lines: string[] = [];
  if (sc.cantrips.length > 0) lines.push(`Cantrips (at will): ${listText(sc.cantrips)}.`);
  for (const { level, slots, spells } of sc.slots) {
    lines.push(`${ORDINALS[level] ?? `${level}th`} level (${slots} ${slots === 1 ? "slot" : "slots"}): ${listText(spells)}.`);
  }
  if (sc.at_will.length > 0) lines.push(`At will: ${listText(sc.at_will)}.`);
  for (const { uses, each, spells } of sc.per_day) {
    lines.push(`${uses}/day${each ? " each" : ""}: ${listText(spells)}.`);
  }
  return [sc.intro, ...lines, sc.footer].filter((part) => part !== "").join(" ");
}
