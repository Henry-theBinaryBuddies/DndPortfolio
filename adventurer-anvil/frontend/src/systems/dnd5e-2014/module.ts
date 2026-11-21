// The 2014 system module: the pipeline from step 5 (sources → expand → tally → derive → check), assembled
// into the SystemModule the core expects.
import type { CharacterBlurb, CharacterDocument, ContentIndex, Evaluation, LevelUp, SystemModule } from "../../core";
import { check, stepReports, unusedChoices } from "./engine/check";
import { newContext } from "./engine/context";
import { derive } from "./engine/derive";
import { packSchema, SYSTEM_ID } from "./packFormat";
import { abilitiesStep } from "./steps/abilities";
import { backgroundStep } from "./steps/background";
import { CLASS_KEY, checkMulticlass, classStep, LEVEL_KEY, levelOf, MAX_LEVEL, storedOtherLevels } from "./steps/class";
import { checkEquipment, equipmentStep } from "./steps/equipment";
import { spellsStep } from "./steps/spells";
import { detailsStep, goodPortrait, PORTRAIT_KEY } from "./steps/details";
import { replaceDuplicateSkills } from "./engine/duplicates";
import { RACE_KEY, raceStep } from "./steps/race";
import { rulesStep } from "./steps/rules";
import { picksOf } from "./engine/context";

export function evaluate(doc: CharacterDocument, content: ContentIndex): Evaluation {
  const ctx = newContext(doc, content);
  // ① + ② Each step collects its sources and expands their effects into the tally (③). The rules come first.
  rulesStep(ctx);
  raceStep(ctx);
  const base = abilitiesStep(ctx);
  classStep(ctx);
  backgroundStep(ctx);
  equipmentStep(ctx);
  spellsStep(ctx, base);
  detailsStep(ctx);
  // Any skill given twice by fixed effects is swapped for another of the character's choice.
  replaceDuplicateSkills(ctx);
  // ④
  // Items by local id, for proficiency names: the first loaded pack that has the id names it.
  const items = new Map<string, string>();
  for (const e of content.list("items")) if (!items.has(e.id)) items.set(e.id, e.name);
  const { derived, lists, scores } = derive(ctx.tally, base, (id) => items.get(id), { encumbrance: ctx.rules.encumbrance });
  // ⑤
  check(ctx, scores);
  checkMulticlass(ctx, scores);
  checkEquipment(ctx, scores);
  return { steps: stepReports(ctx), derived, lists, issues: ctx.issues, unused: unusedChoices(ctx) };
}

export const dnd5e2014: SystemModule = {
  id: SYSTEM_ID,
  version: 1,
  title: "D&D 5e (2014 rules)",
  packSchema,
  summary: [
    {
      kind: "tiles",
      label: "Ability scores",
      items: [
        { key: "ability.str", short: "Str" }, { key: "ability.dex", short: "Dex" }, { key: "ability.con", short: "Con" },
        { key: "ability.int", short: "Int" }, { key: "ability.wis", short: "Wis" }, { key: "ability.cha", short: "Cha" },
      ],
    },
    {
      kind: "rows",
      label: "At a glance",
      items: [
        { key: "hp" }, { key: "ac" }, { key: "hit-dice" }, { key: "speed.walk", format: "feet" }, { key: "initiative", format: "signed" },
        { key: "passive.perception" }, { key: "proficiency-bonus", format: "signed" },
        { key: "coins", format: "coins" }, { key: "weight", format: "pounds" },
      ],
    },
    { kind: "rows", label: "Attacks", items: [], prefix: { key: "attack." } },
    { kind: "rows", label: "Spellcasting", items: [], prefix: { key: "spell." } },
    { kind: "list", label: "Saving throws", list: "saving-throws" },
    { kind: "list", label: "Skills", list: "skills" },
    { kind: "list", label: "Armour, weapons and tools", list: "other-proficiencies" },
    { kind: "list", label: "Senses", list: "senses" },
    { kind: "list", label: "Languages", list: "languages" },
    { kind: "list", label: "Resistances", list: "resistances" },
    { kind: "list", label: "Feats", list: "feats" },
    { kind: "list", label: "Cantrips", list: "cantrips" },
    { kind: "list", label: "Spells", list: "spells" },
  ],
  stepLists: {
    class: [{ label: "What you get", list: "gains.class" }],
    background: [{ label: "What you get", list: "gains.background" }],
    equipment: [{ label: "Inventory", list: "inventory" }],
    spells: [{ label: "Your spells", list: "spell-list" }],
  },
  initialChoices: () => ({}),
  evaluate,
  migrate: (doc) => doc,
  describe,
  levelUp,
};

/** One more level, given to the first class; the Class step shows where it can be moved to another class. */
export function levelUp(doc: CharacterDocument, content: ContentIndex): LevelUp {
  const classRef = picksOf(doc.choices[CLASS_KEY])[0];
  if (!classRef || !content.get("classes", classRef)) return { ok: false, reason: "Choose a class first." };
  const level = levelOf(doc.choices);
  if (level >= MAX_LEVEL) return { ok: false, reason: `This character is already level ${MAX_LEVEL}, the highest.` };
  return { ok: true, label: `Level up to ${level + 1}`, choices: { [LEVEL_KEY]: level + 1 }, step: "class" };
}

/**
 * "Hill Dwarf Cleric 1", "Human Fighter 4 / Wizard 1" (the subrace or race, then each class and its level; whichever
 * are chosen) and the portrait.
 */
export function describe(doc: CharacterDocument, content: ContentIndex): CharacterBlurb {
  const raceRef = picksOf(doc.choices[RACE_KEY])[0];
  const race = raceRef ? content.get("races", raceRef) : undefined;
  const subRef = raceRef ? picksOf(doc.choices[`race.${raceRef}.subrace`])[0] : undefined;
  const sub = subRef ? content.get("subraces", subRef) : undefined;
  const classRef = picksOf(doc.choices[CLASS_KEY])[0];
  const cls = classRef ? content.get("classes", classRef) : undefined;
  let classes = "";
  if (cls) {
    const others = storedOtherLevels(doc.choices)
      .filter(([r]) => r !== classRef)
      .map(([r, n]) => [content.get("classes", r)?.name, n] as const)
      .filter((x): x is readonly [string, number] => Boolean(x[0]));
    const given = others.reduce((t, [, n]) => t + n, 0);
    classes = [`${cls.name} ${Math.max(1, levelOf(doc.choices) - given)}`, ...others.map(([name, n]) => `${name} ${n}`)].join(" / ");
  }
  const text = [sub?.name ?? race?.name, classes].filter(Boolean).join(" ");
  const picture = goodPortrait(doc.choices[PORTRAIT_KEY]);
  return picture ? { text, picture } : { text };
}
