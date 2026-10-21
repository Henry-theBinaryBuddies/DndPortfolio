// Test-only: reads OUR spellcasting wording back into data. The app never imports this file (it only writes the wording,
// in lib/spellcastingText.ts); the tests use it to build spellcasting fixtures from sentences and to prove the round trip.
import type { SpellPerDay, SpellRef, SpellSlotLevel, Spellcasting } from "../../types/monster";

type Base = Pick<Spellcasting, "ability" | "dc" | "attack_bonus">;

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

/** "misty step (self only)" becomes { name: "misty step", note: "self only" }. */
export function spellRef(entry: string): SpellRef {
  const bracket = entry.indexOf(" (");
  if (bracket === -1 || !entry.endsWith(")")) return { name: entry };
  return { name: entry.slice(0, bracket), note: entry.slice(bracket + 2, -1) };
}

/** Reads the stat block wording into data. With no recognised list, the whole text is the intro. */
export function parseSpellcastingText(text: string, base: Base): Spellcasting {
  const cantrips: SpellRef[] = [];
  const at_will: SpellRef[] = [];
  const slots: SpellSlotLevel[] = [];
  const per_day: SpellPerDay[] = [];
  let firstStart = -1;
  let lastEnd = 0;

  for (const match of text.matchAll(LIST_LINE)) {
    const [whole, heading, levelText, slotsText, perDay, each, list] = match;
    if (firstStart === -1) firstStart = match.index;
    lastEnd = match.index + whole.length;
    const spells = splitSpellList(list).map(spellRef);

    if (heading === "At will") {
      at_will.push(...spells);
    } else if (heading.startsWith("Cantrips")) {
      cantrips.push(...spells);
    } else if (levelText !== undefined) {
      const level = Number(levelText);
      const existing = slots.find((s) => s.level === level);
      if (existing) {
        existing.slots = Number(slotsText);
        existing.spells.push(...spells);
      } else {
        slots.push({ level, slots: Number(slotsText), spells });
      }
    } else if (perDay !== undefined) {
      const uses = Number(perDay);
      const together = each !== undefined;
      const existing = per_day.find((d) => d.uses === uses && d.each === together);
      if (existing) existing.spells.push(...spells);
      else per_day.push({ uses, each: together, spells });
    }
  }

  const common = { ability: base.ability, dc: base.dc, attack_bonus: base.attack_bonus };
  if (firstStart === -1) {
    return { ...common, innate: /innate/i.test(text), intro: text.trim(), cantrips, slots, at_will, per_day, footer: "" };
  }
  const intro = text.slice(0, firstStart).trim();
  return {
    ...common,
    innate: /innate/i.test(intro),
    intro,
    cantrips,
    slots,
    at_will,
    per_day,
    footer: text.slice(lastEnd).trim(),
  };
}
