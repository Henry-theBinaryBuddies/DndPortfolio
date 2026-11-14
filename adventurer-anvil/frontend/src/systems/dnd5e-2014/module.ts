// The 2014 system module: the pipeline from step 5 (sources → expand → tally → derive → check), assembled
// into the SystemModule the core expects.
import type { CharacterDocument, ContentIndex, Evaluation, SystemModule } from "../../core";
import { check, stepReports, unusedChoices } from "./engine/check";
import { newContext } from "./engine/context";
import { derive } from "./engine/derive";
import { packSchema, SYSTEM_ID } from "./packFormat";
import { abilitiesStep } from "./steps/abilities";
import { backgroundStep } from "./steps/background";
import { classStep } from "./steps/class";
import { replaceDuplicateSkills } from "./engine/duplicates";
import { raceStep } from "./steps/race";

export function evaluate(doc: CharacterDocument, content: ContentIndex): Evaluation {
  const ctx = newContext(doc, content);
  // ① + ② Each step collects its sources and expands their effects into the tally (③).
  raceStep(ctx);
  const base = abilitiesStep(ctx);
  classStep(ctx);
  backgroundStep(ctx);
  // Any skill given twice by fixed effects is swapped for another of the character's choice.
  replaceDuplicateSkills(ctx);
  // ④
  const { derived, lists, scores } = derive(ctx.tally, base);
  // ⑤
  check(ctx, scores);
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
      ],
    },
    { kind: "list", label: "Saving throws", list: "saving-throws" },
    { kind: "list", label: "Skills", list: "skills" },
    { kind: "list", label: "Armour, weapons and tools", list: "other-proficiencies" },
    { kind: "list", label: "Senses", list: "senses" },
    { kind: "list", label: "Languages", list: "languages" },
    { kind: "list", label: "Resistances", list: "resistances" },
  ],
  stepLists: {
    class: [{ label: "What you get at level 1", list: "gains.class" }],
    background: [{ label: "What you get", list: "gains.background" }],
  },
  initialChoices: () => ({}),
  evaluate,
  migrate: (doc) => doc,
};
