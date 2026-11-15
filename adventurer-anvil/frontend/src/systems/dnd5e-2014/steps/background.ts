// The Background step: pick a background (it becomes a source like a race), then write the character's
// personality, with the background's tables as suggestions.
//
//   background                   "srd-5.1:acolyte"
//   background.srd-5.1:acolyte.languages   that background's own choices
//   background.traits / .ideal / .bond / .flaw    free text, kept if the background changes
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

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function backgroundStep(ctx: Context): void {
  ctx.steps.push(BACKGROUND_STEP);
  const picks = picksOf(ctx.doc.choices[BACKGROUND_KEY]);
  ctx.open.push({
    spec: {
      key: BACKGROUND_KEY, step: "background", label: "Choose a background", kind: "pick-one", required: true,
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

  // Characteristics: never required, and free text; the chosen background's tables are offered as suggestions.
  const c = bg?.characteristics;
  const text = (key: string, label: string, suggestions: { text: string; note?: string }[] | undefined, lines = 1) => {
    const value = ctx.doc.choices[key];
    ctx.open.push({
      spec: { key, step: "background", label, source: bg && suggestions?.length ? bg.name : undefined, kind: "long-text", required: false, suggestions: suggestions ?? [],
        ...(lines > 1 ? { count: { min: lines, max: lines } } : {}) },
      picks: [],
      answered: typeof value === "string" && value.trim() !== "",
    });
  };
  const plain = (list: string[] | undefined) => list?.map((t) => ({ text: t }));
  text("background.traits", "Personality traits (two)", plain(c?.traits), 2);
  text("background.ideal", "Ideal", c?.ideals?.map((i) => ({ text: i.text, note: i.alignment ? capital(i.alignment) : undefined })));
  text("background.bond", "Bond", plain(c?.bonds));
  text("background.flaw", "Flaw", plain(c?.flaws));
}
