// The 2014 system module: the pipeline from step 5 (sources → expand → tally → derive → check), assembled
// into the SystemModule the core expects.
import type { CharacterDocument, ContentIndex, Evaluation, SystemModule } from "../../core";
import { check, stepReports, unusedChoices } from "./engine/check";
import { newContext } from "./engine/context";
import { derive } from "./engine/derive";
import { packSchema, SYSTEM_ID } from "./packFormat";
import { abilitiesStep } from "./steps/abilities";
import { raceStep } from "./steps/race";

export function evaluate(doc: CharacterDocument, content: ContentIndex): Evaluation {
  const ctx = newContext(doc, content);
  // ① + ② Each step collects its sources and expands their effects into the tally (③).
  raceStep(ctx);
  const base = abilitiesStep(ctx);
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
  initialChoices: () => ({}),
  evaluate,
  migrate: (doc) => doc,
};
