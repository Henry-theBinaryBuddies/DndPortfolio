// The Race step: pick a race, then a subrace if the loaded packs have any for it. Both become sources,
// and their choice effects open further choices on this step.
import type { ContentEntry, ContentIndex, Option } from "../../../core";
import { allowedByRules, fullRef, picksOf, type Context, type Source } from "../engine/context";
import { describeEffects } from "../engine/describe";
import { expandSource } from "../engine/expand";
import type { Effect } from "../packFormat";
import { ABILITIES, ABILITY_NAMES, type Ability } from "../vocabulary";

const SHORT: Record<Ability, string> = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const RACE_STEP = { id: "race", label: "Race" };
export const RACE_KEY = "race";

/** An option card for a race or subrace: its name, one line, the full text, and chips for what it gives. */
function optionFor(entry: ContentEntry & { ref: string }): Option {
  const tags = describeEffects((entry.effects ?? []) as Effect[]);
  if (typeof entry.size === "string" || Array.isArray(entry.size)) {
    // Size goes just after the speed chip ("30 ft", "Medium", or "Small or Medium" when it's a choice).
    const speedAt = tags.findIndex((t) => /^\d+ ft$/.test(t));
    const size = Array.isArray(entry.size) ? entry.size.map((s) => capital(String(s))).join(" or ") : capital(entry.size);
    tags.splice(speedAt >= 0 ? speedAt + 1 : tags.length, 0, size);
  }
  return {
    value: entry.ref,
    name: entry.name,
    summary: typeof entry.summary === "string" ? entry.summary : undefined,
    description: typeof entry.description === "string" ? entry.description : undefined,
    tags,
  };
}

/** Subraces in the loaded packs that belong to a race. */
export function subracesOf(content: ContentIndex, raceRef: string) {
  return content.list("subraces").filter((s) => typeof s.race === "string" && fullRef(s.race, s.pack) === raceRef);
}

export function raceStep(ctx: Context): void {
  ctx.steps.push(RACE_STEP);
  const racePicks = picksOf(ctx.doc.choices[RACE_KEY]);
  ctx.open.push({
    spec: {
      key: RACE_KEY, step: "race", label: "Choose a race", kind: "pick-one", required: true,
      options: ctx.content.list("races").filter((r) => allowedByRules(r, ctx.rules)).map(optionFor),
    },
    picks: racePicks,
    collection: "races",
  });

  const raceRef = racePicks[0];
  const race = raceRef ? ctx.content.get("races", raceRef) : undefined;
  if (!raceRef || !race) return;

  const subraces = subracesOf(ctx.content, raceRef).filter((s) => allowedByRules(s, ctx.rules));
  let subrace: Source | undefined;
  if (subraces.length) {
    const key = `race.${raceRef}.subrace`;
    const picks = picksOf(ctx.doc.choices[key]);
    ctx.open.push({
      spec: {
        key, step: "race", label: `Choose a subrace of ${race.name}`, source: race.name, kind: "pick-one", required: true,
        options: subraces.map(optionFor),
      },
      picks,
      collection: "subraces",
    });
    // Only a subrace of this race applies; any other pick is reported by the check stage.
    const picked = subraces.find((s) => s.ref === picks[0]);
    if (picked) subrace = { key: `race.${picked.ref}`, name: picked.name, step: "race", pack: picked.pack, effects: picked.effects as Effect[] };
  }

  // A race that lets you choose your size (a custom lineage).
  if (Array.isArray(race.size)) {
    const key = `race.${raceRef}.size`;
    ctx.open.push({
      spec: {
        key, step: "race", label: "Choose your size", source: race.name, kind: "pick-one", presentation: "segmented", required: true,
        options: race.size.map((s) => ({ value: String(s), name: capital(String(s)) })),
      },
      picks: picksOf(ctx.doc.choices[key]),
    });
  }

  expandSource(ctx, { key: `race.${raceRef}`, name: race.name, step: "race", pack: race.pack, effects: race.effects as Effect[] });
  if (subrace) expandSource(ctx, subrace);
  if (ctx.rules.origin === "custom") moveIncreases(ctx);
}

/**
 * A custom origin: each fixed ability score increase from the race or subrace may go to another score, each to a
 * different one. (Increases already chosen, such as a half-elf's, are the player's to place anyway.)
 *
 *   race.origin.con    "dex"     the Constitution increase goes to Dexterity
 */
function moveIncreases(ctx: Context): void {
  const fixed = ctx.tally.abilityBonuses.filter((b) => b.from.step === "race" && !b.from.choice);
  const from = [...new Set(fixed.map((b) => b.ability))];
  const targets = new Map<Ability, Ability>();
  for (const a of from) {
    const key = `race.origin.${a}`;
    const stored = picksOf(ctx.doc.choices[key])[0];
    const amount = fixed.filter((b) => b.ability === a).reduce((t, b) => t + b.amount, 0);
    const named = [...new Set(fixed.filter((b) => b.ability === a).map((b) => b.from.name))].join(" and ");
    ctx.open.push({
      spec: {
        key, step: "race", label: `${amount >= 0 ? "+" : ""}${amount} ${ABILITY_NAMES[a]} (${named}) goes to`, kind: "pick-one", presentation: "segmented",
        required: false, defaultValue: a, group: "Move your race's increases",
        options: ABILITIES.map((x) => ({ value: x, name: SHORT[x] })),
      },
      picks: stored ? [stored] : [],
      answered: true,
    });
    targets.set(a, (ABILITIES as readonly string[]).includes(stored ?? "") ? (stored as Ability) : a);
  }
  for (const b of fixed) {
    const to = targets.get(b.ability)!;
    if (to !== b.ability) {
      b.from = { ...b.from, name: `${b.from.name} (moved from ${SHORT[b.ability]})` };
      b.ability = to;
    }
  }
  const landed = [...targets.values()];
  if (new Set(landed).size !== landed.length) {
    ctx.issues.push({
      id: "origin-same-score", severity: "error", step: "race", key: `race.origin.${from.at(-1)}`, overridable: true,
      message: "Your race's increases each go to a different score.",
    });
  }
}
