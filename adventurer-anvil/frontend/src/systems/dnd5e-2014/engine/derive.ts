// ④ Derive: the 2014 math, from the tally and the base ability scores. Every value carries its breakdown.
import type { BreakdownLine, Derived, ListItem } from "../../../core";
import { ABILITIES, ABILITY_NAMES, SKILLS, type Ability, type Skill } from "../vocabulary";
import { listName } from "./expand";
import { bonusesFor, type Tally } from "./tally";

export interface DerivedResult {
  derived: Record<string, Derived>;
  lists: Record<string, ListItem[]>;
  scores: Record<Ability, number>;
}

export const modifier = (score: number) => Math.floor((score - 10) / 2);
export const proficiencyBonusFor = (level: number) => 2 + Math.floor((level - 1) / 4);

const sum = (lines: BreakdownLine[]) => lines.reduce((total, line) => total + Number(line.amount), 0);

export function derive(tally: Tally, base: Record<Ability, number>): DerivedResult {
  const derived: Record<string, Derived> = {};
  const scores = {} as Record<Ability, number>;

  // Ability scores and modifiers.
  for (const ability of ABILITIES) {
    const breakdown: BreakdownLine[] = [{ label: "Base", amount: base[ability] }];
    for (const bonus of bonusesFor(tally, ability)) breakdown.push({ label: bonus.from.name, amount: bonus.amount });
    scores[ability] = sum(breakdown);
    derived[`ability.${ability}`] = { value: scores[ability], label: ABILITY_NAMES[ability], breakdown };
    derived[`ability.${ability}.mod`] = {
      value: modifier(scores[ability]),
      label: `${ABILITY_NAMES[ability]} modifier`,
      breakdown: [{ label: `${ABILITY_NAMES[ability]} ${scores[ability]}`, amount: modifier(scores[ability]) }],
    };
  }

  // Level and proficiency bonus. Classes arrive in a later step; until then the character is level 1.
  const level = 1;
  derived["level"] = { value: level, label: "Level", breakdown: [{ label: "No classes yet", amount: level }] };
  const prof = proficiencyBonusFor(level);
  derived["proficiency-bonus"] = { value: prof, label: "Proficiency bonus", breakdown: [{ label: `Level ${level}`, amount: prof }] };

  const proficientFrom = (kind: "skill" | "saving-throw", id: string) =>
    tally.proficiencies.find((p) => p.kind === kind && p.id === id)?.from.name;

  // Saving throws.
  for (const ability of ABILITIES) {
    const breakdown: BreakdownLine[] = [{ label: ABILITY_NAMES[ability], amount: modifier(scores[ability]) }];
    const by = proficientFrom("saving-throw", ability);
    if (by) breakdown.push({ label: `Proficient (${by})`, amount: prof });
    derived[`save.${ability}`] = { value: sum(breakdown), label: `${ABILITY_NAMES[ability]} saving throw`, breakdown };
  }

  // Skills.
  for (const [skill, info] of Object.entries(SKILLS) as [Skill, (typeof SKILLS)[Skill]][]) {
    const breakdown: BreakdownLine[] = [{ label: ABILITY_NAMES[info.ability], amount: modifier(scores[info.ability]) }];
    const by = proficientFrom("skill", skill);
    if (by) breakdown.push({ label: `Proficient (${by})`, amount: prof });
    derived[`skill.${skill}`] = { value: sum(breakdown), label: info.name, breakdown };
  }

  const perception = Number(derived["skill.perception"].value);
  derived["passive.perception"] = {
    value: 10 + perception,
    label: "Passive Perception",
    breakdown: [{ label: "Base", amount: 10 }, { label: "Perception", amount: perception }],
  };
  derived["initiative"] = { value: modifier(scores.dex), label: "Initiative", breakdown: [{ label: "Dexterity", amount: modifier(scores.dex) }] };
  // Armour arrives with equipment; until then, unarmoured.
  derived["ac"] = {
    value: 10 + modifier(scores.dex),
    label: "Armor Class",
    breakdown: [{ label: "Unarmored", amount: 10 }, { label: "Dexterity", amount: modifier(scores.dex) }],
  };

  // Speeds: the fastest given for each kind of movement (a subrace's 35 ft beats its race's 30 ft).
  for (const mode of ["walk", "fly", "swim", "climb", "burrow"] as const) {
    const best = tally.speeds.filter((s) => s.mode === mode).sort((a, b) => b.value - a.value)[0];
    if (best) derived[`speed.${mode}`] = { value: best.value, label: `${capital(mode)} speed`, breakdown: [{ label: best.from.name, amount: best.value }] };
  }

  return { derived, lists: buildLists(tally), scores };
}

function buildLists(tally: Tally): Record<string, ListItem[]> {
  const lists: Record<string, ListItem[]> = {};
  const add = (list: string, item: ListItem, unique = true) => {
    const items = (lists[list] ??= []);
    if (!unique || !items.some((i) => i.name === item.name && i.detail === item.detail)) items.push(item);
  };

  // Senses: the longest range of each.
  const senses = new Map<string, { range: number; from: string }>();
  for (const s of tally.senses) if ((senses.get(s.sense)?.range ?? 0) < s.range) senses.set(s.sense, { range: s.range, from: s.from.name });
  for (const [sense, { range, from }] of senses) add("senses", { name: `${capital(sense)} ${range} ft`, source: from });

  for (const l of tally.languages) add("languages", { name: l.name, source: l.from.name });
  for (const p of tally.proficiencies) {
    const name = p.kind === "skill" ? listName("skills", p.id) : p.kind === "saving-throw" ? ABILITY_NAMES[p.id as Ability] ?? p.id : titleFromId(p.id);
    add("proficiencies", { name, source: p.from.name, detail: p.kind });
  }
  for (const r of tally.resistances) add("resistances", { name: capital(r.damage), source: r.from.name });
  for (const f of tally.features) {
    const page = f.source ? ` (${f.source.book}${f.source.page ? ` p. ${f.source.page}` : ""})` : "";
    add("features", { name: f.name, source: f.from.name, detail: f.summary ? `${f.summary}${page}` : page.trim() || undefined }, false);
  }
  for (const r of tally.resources) {
    const per = r.recharge === "short" ? "short rest" : r.recharge === "long" ? "long rest" : "dawn";
    add("resources", { name: r.name, source: r.from.name, detail: `${r.uses} per ${per}` }, false);
  }
  for (const g of tally.grants) add(g.collection, { name: g.name, source: g.from.name });
  return lists;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "light-crossbow" → "Light Crossbow", until items give weapons their real names. */
const titleFromId = (id: string) => id.split("-").map(capital).join(" ");
