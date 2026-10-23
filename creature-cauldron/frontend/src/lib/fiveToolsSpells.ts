import type { SpellRef, Spellcasting } from "../types/monster";
import type { JsonObject } from "./foundryJson";
import { tagProse } from "./fiveToolsTags";
import { hasSpellLists } from "./spellcastingText";

// Builds 5etools' structured spellcasting block from a monster's spellcasting data, so a tool like
// Plutonium can read the spell lists (and link each spell) instead of showing a paragraph.

/** "fireball" becomes "{@spell fireball}". A note stays as plain text in brackets after the tag. */
export function spellTag(spell: SpellRef): string {
  return `{@spell ${spell.name}}${spell.note ? ` (${spell.note})` : ""}`;
}

/** The block for this spellcasting, or null when it has no spell lists (the caller then keeps the text as a trait). */
export function buildSpellcastingBlock(spellcasting: Spellcasting): JsonObject | null {
  if (!hasSpellLists(spellcasting)) return null;

  const spells: Record<string, JsonObject> = {};
  if (spellcasting.cantrips.length > 0) spells["0"] = { spells: spellcasting.cantrips.map(spellTag) };
  for (const { level, slots, spells: list } of spellcasting.slots) {
    spells[String(level)] = { spells: list.map(spellTag), slots };
  }

  const daily: Record<string, string[]> = {};
  for (const { uses, each, spells: list } of spellcasting.per_day) {
    (daily[`${uses}${each ? "e" : ""}`] ??= []).push(...list.map(spellTag));
  }

  const block: JsonObject = {
    name: spellcasting.innate ? "Innate Spellcasting" : "Spellcasting",
    type: "spellcasting",
    headerEntries: [tagProse(spellcasting.intro)],
  };
  if (spellcasting.at_will.length > 0) block.will = spellcasting.at_will.map(spellTag);
  if (Object.keys(daily).length > 0) block.daily = daily;
  if (Object.keys(spells).length > 0) block.spells = spells;
  if (spellcasting.footer !== "") block.footerEntries = [tagProse(spellcasting.footer)];
  block.ability = spellcasting.ability;
  return block;
}
