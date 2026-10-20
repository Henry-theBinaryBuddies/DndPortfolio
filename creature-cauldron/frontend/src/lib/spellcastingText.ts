import type { SpellPerDay, SpellRef, SpellSlotLevel, Spellcasting } from "../types/monster";

// Spellcasting is stored as data (see types/monster.ts). This file converts between that data and the
// stat block sentence:
//   "<intro> Cantrips (at will): a, b. 1st level (4 slots): c, d. At will: e. 1/day each: f, g. <footer>"
// spellcastingToText writes the sentence. parseSpellcastingText reads OUR wording back into data; it is
// how prose (for example an imported stat block) becomes structure. Text it does not recognise is kept
// whole in `intro`, so nothing is lost.

type Base = Pick<Spellcasting, "ability" | "dc" | "attack_bonus">;

/**
 * One list line: a heading, a colon, the spells, and a full stop. The headings are
 * "Cantrips (at will)", "At will", "1st level (4 slots)", "1/day", and "3/day each".
 */
const LIST_LINE = /(Cantrips \(at will\)|At will|(\d)(?:st|nd|rd|th) level \((\d+) slots?\)|(\d)\/day( each)?): ([^.]+)\./g;

const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

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
