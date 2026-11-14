// ④ Derive: the 2014 math, from the tally and the base ability scores. Every value carries its breakdown.
import type { BreakdownLine, Derived, ListItem } from "../../../core";
import { ABILITIES, ABILITY_NAMES, SKILLS, type Ability, type Skill } from "../vocabulary";
import { listName } from "./expand";
import { bonusesFor, type AbilityUses, type Tally } from "./tally";

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

  // Level and proficiency bonus: the class levels added up (level 1 until a class is chosen).
  const level = tally.classes.reduce((total, c) => total + c.level, 0) || 1;
  derived["level"] = {
    value: level,
    label: "Level",
    breakdown: tally.classes.length ? tally.classes.map((c) => ({ label: c.name, amount: c.level })) : [{ label: "No class yet", amount: 1 }],
  };
  const prof = proficiencyBonusFor(level);
  derived["proficiency-bonus"] = { value: prof, label: "Proficiency bonus", breakdown: [{ label: `Level ${level}`, amount: prof }] };

  const proficientFrom = (kind: "skill" | "saving-throw", id: string) =>
    tally.proficiencies.find((p) => p.kind === kind && p.id === id)?.from.name;
  const expertFrom = (id: string) => tally.expertise.find((e) => e.kind === "skill" && e.id === id)?.from.name;

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
    // Expertise doubles the bonus, and only for a skill you are proficient in (the check stage reports any other).
    const expert = by ? expertFrom(skill) : undefined;
    if (expert) breakdown.push({ label: `Expertise (${expert})`, amount: prof });
    derived[`skill.${skill}`] = { value: sum(breakdown), label: info.name, breakdown };
  }

  const perception = Number(derived["skill.perception"].value);
  derived["passive.perception"] = {
    value: 10 + perception,
    label: "Passive Perception",
    breakdown: [{ label: "Base", amount: 10 }, { label: "Perception", amount: perception }],
  };
  derived["initiative"] = { value: modifier(scores.dex), label: "Initiative", breakdown: [{ label: "Dexterity", amount: modifier(scores.dex) }] };
  derived["ac"] = armorClass(tally, scores);

  // Hit points and hit dice, once there is a class. Level 1: the first class's whole hit die, plus Con, plus any
  // per-level bonus. (Later levels, rolled or averaged, arrive with levelling up.)
  const first = tally.classes[0];
  if (first) {
    const con = modifier(scores.con);
    const hp: BreakdownLine[] = [{ label: `${first.name} hit die (d${first.hitDie}, highest at level 1)`, amount: first.hitDie }];
    hp.push({ label: level > 1 ? `Constitution × ${level}` : "Constitution", amount: con * level });
    for (const h of tally.hitPoints) hp.push({ label: level > 1 ? `${h.from.name} × ${level}` : h.from.name, amount: h.perLevel * level });
    derived["hp"] = { value: Math.max(1, sum(hp)), label: "Hit points", breakdown: hp };
    const dice = new Map<number, number>();
    for (const c of tally.classes) dice.set(c.hitDie, (dice.get(c.hitDie) ?? 0) + c.level);
    derived["hit-dice"] = {
      value: [...dice].map(([die, n]) => `${n}d${die}`).join(" + "),
      label: "Hit dice",
      breakdown: tally.classes.map((c) => ({ label: c.name, amount: `${c.level}d${c.hitDie}` })),
    };
  }

  // Speeds: the fastest given for each kind of movement (a subrace's 35 ft beats its race's 30 ft). Heavy armour
  // without the Strength it needs costs 10 feet.
  const heavy = tally.worn.armor?.armor.strength;
  const slowed = heavy !== undefined && scores.str < heavy ? tally.worn.armor!.name : undefined;
  for (const mode of ["walk", "fly", "swim", "climb", "burrow"] as const) {
    const best = tally.speeds.filter((s) => s.mode === mode).sort((a, b) => b.value - a.value)[0];
    if (!best) continue;
    const breakdown: BreakdownLine[] = [{ label: best.from.name, amount: best.value }];
    if (slowed) breakdown.push({ label: `${slowed} (Strength ${scores.str}, needs ${heavy})`, amount: -10 });
    derived[`speed.${mode}`] = { value: Math.max(0, sum(breakdown)), label: `${capital(mode)} speed`, breakdown };
  }

  // Attacks: one per weapon carried. Melee weapons use Strength, ranged ones Dexterity, finesse ones the better.
  for (const w of tally.weapons) {
    const { weapon } = w;
    const ability: Ability =
      weapon.properties.includes("finesse") ? (modifier(scores.dex) > modifier(scores.str) ? "dex" : "str")
      : weapon.range === "ranged" ? "dex" : "str";
    const mod = modifier(scores[ability]);
    const breakdown: BreakdownLine[] = [{ label: ABILITY_NAMES[ability], amount: mod }];
    const localId = w.ref.slice(w.ref.indexOf(":") + 1);
    const by = tally.proficiencies.find((p) => p.kind === "weapon" && !p.replaced && (p.id === weapon.class || p.id === localId))?.from.name;
    if (by) breakdown.push({ label: `Proficient (${by})`, amount: prof });
    const bonus = sum(breakdown);
    const damage = (dice: string) => (/^\d+$/.test(dice) ? String(Math.max(0, Number(dice) + mod)) : `${dice}${mod > 0 ? `+${mod}` : mod < 0 ? `−${-mod}` : ""}`);
    const hit = weapon.damage
      ? `${damage(weapon.damage.dice)} ${weapon.damage.type}${weapon.versatile ? ` (${damage(weapon.versatile)} two-handed)` : ""}`
      : "no damage (special)";
    derived[`attack.${w.ref}`] = { value: `${bonus >= 0 ? "+" : "−"}${Math.abs(bonus)} to hit, ${hit}`, label: w.name, breakdown };
  }

  // What's carried, against the carrying capacity (Strength × 15 lb).
  const byName = new Map<string, number>();
  for (const i of tally.items) if (i.weight > 0) byName.set(i.name, (byName.get(i.name) ?? 0) + i.weight * i.qty);
  const weights: BreakdownLine[] = [...byName].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, lb]) => ({ label: name, amount: round2(lb) }));
  const capacity = scores.str * 15;
  if (tally.items.length) derived["weight"] = {
    value: round2(sum(weights)),
    label: `Weight carried (of ${capacity} lb)`,
    breakdown: weights.length ? weights : [{ label: "Nothing carried", amount: 0 }],
  };
  derived["carrying-capacity"] = { value: capacity, label: "Carrying capacity", breakdown: [{ label: `Strength ${scores.str} × 15`, amount: capacity }] };
  if (tally.coins.length) {
    const coins = tally.coins.map((c) => ({ label: c.label, amount: c.cp }));
    derived["coins"] = { value: sum(coins), label: "Money", breakdown: coins };
  }

  const usesOf = (u: number | AbilityUses) => (typeof u === "number" ? u : Math.max(u.min ?? 0, modifier(scores[u.ability]) + (u.add ?? 0)));
  return { derived, lists: buildLists(tally, usesOf), scores };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Armor Class: worn armour's (its base, plus as much Dexterity as it allows); without armour, the best of 10 + Dex
 * and any other formula (Unarmored Defense; a monk's only without a shield). Then a shield, then bonuses that apply
 * while armoured or unarmoured (a shield isn't armour).
 */
function armorClass(tally: Tally, scores: Record<Ability, number>): Derived {
  const { armor, shield } = tally.worn;
  let ac: BreakdownLine[];
  if (armor) {
    const dex = modifier(scores.dex);
    ac = [{ label: armor.name, amount: armor.armor.base }];
    const d = armor.armor.dex;
    if (d === "full") ac.push({ label: ABILITY_NAMES.dex, amount: dex });
    else if (d !== "none") ac.push({ label: `${ABILITY_NAMES.dex} (max ${d.max})`, amount: Math.min(dex, d.max) });
  } else {
    const formulas = [{ base: 10, abilities: ["dex"] as Ability[], shield: true as boolean | undefined, from: { name: "Unarmored" } }, ...tally.acFormulas]
      .filter((f) => !shield || f.shield !== false);
    const options = formulas.map((f) => {
      const breakdown: BreakdownLine[] = [{ label: f.from.name === "Unarmored" ? "Unarmored" : `${f.from.name} (unarmoured)`, amount: f.base }];
      for (const a of f.abilities) breakdown.push({ label: ABILITY_NAMES[a], amount: modifier(scores[a]) });
      return breakdown;
    });
    ac = options.reduce((best, b) => (sum(b) > sum(best) ? b : best));
  }
  if (shield) ac.push({ label: shield.name, amount: shield.bonus });
  for (const bonus of tally.acBonuses) {
    if (bonus.while === undefined || (bonus.while === "armored") === Boolean(armor)) ac.push({ label: bonus.from.name, amount: bonus.amount });
  }
  return { value: sum(ac), label: "Armor Class", breakdown: ac };
}

const ARMOR_NAMES: Record<string, string> = { light: "Light armor", medium: "Medium armor", heavy: "Heavy armor", shield: "Shields" };
const WEAPON_NAMES: Record<string, string> = {
  simple: "Simple weapons", martial: "Martial weapons",
  "crossbow-light": "Light crossbow", "crossbow-heavy": "Heavy crossbow", "crossbow-hand": "Hand crossbow",
};

function proficiencyName(kind: string, id: string): string {
  if (kind === "skill") return listName("skills", id);
  if (kind === "saving-throw") return ABILITY_NAMES[id as Ability] ?? id;
  if (kind === "armor") return ARMOR_NAMES[id] ?? titleFromId(id);
  if (kind === "weapon") return WEAPON_NAMES[id] ?? titleFromId(id);
  return titleFromId(id);
}

function buildLists(tally: Tally, usesOf: (u: number | AbilityUses) => number): Record<string, ListItem[]> {
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
  for (const p of tally.proficiencies) add("proficiencies", { name: proficiencyName(p.kind, p.id), source: p.from.name, detail: p.kind });
  // For the summary: saving throws, skills (marking expertise), then armour, weapons and tools.
  const abilityOrder = (id: string) => ABILITIES.indexOf(id as Ability);
  for (const p of tally.proficiencies.filter((p) => p.kind === "saving-throw").sort((a, b) => abilityOrder(a.id) - abilityOrder(b.id))) {
    add("saving-throws", { name: proficiencyName(p.kind, p.id), source: p.from.name });
  }
  for (const p of tally.proficiencies.filter((p) => p.kind === "skill")) {
    const expert = tally.expertise.some((e) => e.kind === "skill" && e.id === p.id);
    add("skills", { name: `${proficiencyName(p.kind, p.id)}${expert ? " (expertise)" : ""}`, source: p.from.name });
  }
  for (const kind of ["armor", "weapon", "tool"] as const) {
    for (const p of tally.proficiencies.filter((p) => p.kind === kind)) {
      const expert = kind === "tool" && tally.expertise.some((e) => e.kind === "tool" && e.id === p.id);
      add("other-proficiencies", { name: `${proficiencyName(p.kind, p.id)}${expert ? " (expertise)" : ""}`, source: p.from.name, detail: kind });
    }
  }
  for (const r of tally.resistances) add("resistances", { name: capital(r.damage), source: r.from.name });
  const per = (r: Tally["resources"][number]) =>
    `${usesOf(r.uses)} per ${r.recharge === "short" ? "short rest" : r.recharge === "long" ? "long rest" : "dawn"}`;
  for (const f of tally.features) {
    const page = f.source ? ` (${f.source.book}${f.source.page ? ` p. ${f.source.page}` : ""})` : "";
    add("features", { name: f.name, source: f.from.name, detail: f.summary ? `${f.summary}${page}` : page.trim() || undefined }, false);
  }
  for (const r of tally.resources) add("resources", { name: r.name, source: r.from.name, detail: per(r) }, false);

  // What each step gives, for the step's own page ("gains.class"): its features, with the uses where a resource
  // shares the feature's name (Second Wind), then any other resources.
  const steps = new Set([...tally.features, ...tally.resources].map((x) => x.from.step).filter((s): s is string => Boolean(s)));
  for (const step of steps) {
    const resources = tally.resources.filter((r) => r.from.step === step);
    const named = new Set<string>();
    for (const f of tally.features.filter((f) => f.from.step === step)) {
      const r = resources.find((r) => r.name === f.name && r.from.name === f.from.name);
      if (r) named.add(r.id);
      add(`gains.${step}`, { name: f.name, source: f.from.name, detail: r ? per(r) : f.summary, description: f.description }, false);
    }
    for (const r of resources) if (!named.has(r.id)) add(`gains.${step}`, { name: r.name, source: r.from.name, detail: per(r) }, false);
  }
  for (const g of tally.grants) add(g.collection, { name: g.name, source: g.from.name });

  // The inventory: the same thing from the same place (and pack) is one line.
  const inventory = new Map<string, ListItem & { qty: number; base: string }>();
  for (const i of tally.items) {
    const key = `${i.ref ?? i.name}|${i.in ?? ""}|${i.from.name}`;
    const line = inventory.get(key) ?? { name: "", base: i.name, qty: 0, source: i.from.name, detail: i.in ? `in ${i.in}` : undefined };
    line.qty += i.qty;
    inventory.set(key, line);
  }
  for (const { base, qty, ...line } of inventory.values()) add("inventory", { ...line, name: qty > 1 ? `${base} × ${qty}` : base }, false);
  return lists;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "light-crossbow" → "Light Crossbow", until items give weapons their real names. */
const titleFromId = (id: string) => id.split("-").map(capital).join(" ");
