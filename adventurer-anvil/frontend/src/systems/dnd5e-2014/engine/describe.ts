// Short chips describing an entry's effects, for its option card: "+2 Dex", "30 ft", "Darkvision 60 ft", ...
// Most important first: ability bonuses, then movement and senses, proficiencies, resistances, choices, features.
import type { Effect } from "../packFormat";
import { ABILITIES, SKILLS, type Ability } from "../vocabulary";

const SHORT: Record<Ability, string> = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function describeEffects(effects: Effect[]): string[] {
  const tags: string[] = [];
  const bonuses = effects.filter((e): e is Extract<Effect, { type: "ability-bonus" }> => e.type === "ability-bonus");
  if (bonuses.length === ABILITIES.length && new Set(bonuses.map((b) => b.amount)).size === 1) {
    tags.push(`${signed(bonuses[0].amount)} all`);
  } else {
    // Largest first, so a card's first chip is the main bonus (a Tiefling's +2 Cha before its +1 Int).
    for (const b of [...bonuses].sort((x, y) => y.amount - x.amount)) tags.push(`${signed(b.amount)} ${SHORT[b.ability]}`);
  }
  for (const e of effects) {
    if (e.type === "choice" && "list" in e.from && e.from.list === "abilities" && e.each?.type === "ability-bonus") {
      tags.push(`${signed(e.each.amount)} to ${e.pick} of your choice`);
    }
  }
  for (const e of effects) if (e.type === "speed" && e.walk !== undefined) tags.push(`${e.walk} ft`);
  for (const e of effects) if (e.type === "sense") tags.push(`${capital(e.sense)} ${e.range} ft`);
  for (const e of effects) {
    if (e.type === "proficiency" && e.kind === "skill") tags.push(SKILLS[e.id as keyof typeof SKILLS]?.name ?? e.id);
  }
  for (const e of effects) if (e.type === "resistance") tags.push(`${capital(e.damage)} resistance`);
  for (const e of effects) {
    if (e.type !== "choice") continue;
    if ("list" in e.from && e.from.list === "skills") tags.push(`${e.pick} skills of your choice`);
    else if ("list" in e.from && e.from.list === "damage-types") tags.push("Damage resistance of your choice");
    else if ("collection" in e.from && e.from.collection === "languages") tags.push(`+${e.pick} language`);
    else if ("collection" in e.from && e.from.collection === "spells") tags.push("A cantrip");
  }
  for (const e of effects) if (e.type === "feature") tags.push(e.name);
  return tags;
}
