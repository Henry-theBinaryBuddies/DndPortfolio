// The Background step: pick a background; it becomes a source like a race. Its personality tables are offered as
// suggestions on the Details step (details.ts), where the traits, ideal, bond and flaw are written.
//
//   background                   "srd-5.1:acolyte"
//   background.srd-5.1:acolyte.languages   that background's own choices
import type { ContentEntry, Option } from "../../../core";
import { picksOf, type Context } from "../engine/context";
import { describeEffects } from "../engine/describe";
import { expandSource } from "../engine/expand";
import type { Background, Effect } from "../packFormat";

export const BACKGROUND_STEP = { id: "background", label: "Background" };
export const BACKGROUND_KEY = "background";

function backgroundOption(entry: ContentEntry & { ref: string }): Option {
  const bg = entry as unknown as Background;
  return { value: entry.ref, name: bg.name, summary: bg.summary, description: bg.description, tags: describeEffects(bg.effects as Effect[]) };
}


export function backgroundStep(ctx: Context): void {
  ctx.steps.push(BACKGROUND_STEP);
  const picks = picksOf(ctx.doc.choices[BACKGROUND_KEY]);
  ctx.open.push({
    spec: {
      key: BACKGROUND_KEY, step: "background", label: "Choose a background", kind: "pick-one", required: true,
      hint: "Its personality tables are offered as suggestions on the Details step.",
      options: ctx.content.list("backgrounds").map(backgroundOption),
    },
    picks,
    collection: "backgrounds",
  });

  const ref = picks[0];
  const entry = ref ? ctx.content.get("backgrounds", ref) : undefined;
  const bg = entry as unknown as (Background & { pack: string }) | undefined;
  if (ref && bg) {
    expandSource(ctx, { key: `background.${ref}`, name: bg.name, step: "background", pack: bg.pack, effects: bg.effects as Effect[] });
  }
}
