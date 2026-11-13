// The Race step: pick a race, then a subrace if the loaded packs have any for it. Both become sources,
// and their choice effects open further choices on this step.
import type { ContentIndex } from "../../../core";
import { fullRef, picksOf, type Context, type Source } from "../engine/context";
import { expandSource } from "../engine/expand";
import type { Effect } from "../packFormat";

export const RACE_STEP = { id: "race", label: "Race" };

/** Subraces in the loaded packs that belong to a race. */
export function subracesOf(content: ContentIndex, raceRef: string) {
  return content.list("subraces").filter((s) => typeof s.race === "string" && fullRef(s.race, s.pack) === raceRef);
}

export function raceStep(ctx: Context): void {
  ctx.steps.push(RACE_STEP);
  const racePicks = picksOf(ctx.doc.choices["race"]);
  ctx.open.push({
    spec: {
      key: "race", step: "race", label: "Choose a race", kind: "pick-one", required: true,
      options: ctx.content.list("races").map((r) => ({ value: r.ref, name: r.name, summary: r.summary as string | undefined })),
    },
    picks: racePicks,
    collection: "races",
  });

  const raceRef = racePicks[0];
  const race = raceRef ? ctx.content.get("races", raceRef) : undefined;
  if (!raceRef || !race) return;

  const subraces = subracesOf(ctx.content, raceRef);
  let subrace: Source | undefined;
  if (subraces.length) {
    const key = `race.${raceRef}.subrace`;
    const picks = picksOf(ctx.doc.choices[key]);
    ctx.open.push({
      spec: {
        key, step: "race", label: `Choose a subrace of ${race.name}`, source: race.name, kind: "pick-one", required: true,
        options: subraces.map((s) => ({ value: s.ref, name: s.name, summary: s.summary as string | undefined })),
      },
      picks,
      collection: "subraces",
    });
    // Only a subrace of this race applies; any other pick is reported by the check stage.
    const picked = subraces.find((s) => s.ref === picks[0]);
    if (picked) subrace = { key: `race.${picked.ref}`, name: picked.name, step: "race", pack: picked.pack, effects: picked.effects as Effect[] };
  }

  expandSource(ctx, { key: `race.${raceRef}`, name: race.name, step: "race", pack: race.pack, effects: race.effects as Effect[] });
  if (subrace) expandSource(ctx, subrace);
}
