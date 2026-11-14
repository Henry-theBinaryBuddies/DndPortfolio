// The Class step: pick your first class, then its level-1 choices (skills, a fighting style...), and its
// subclass if it is chosen at level 1. The class and subclass become sources like a race.
//
//   class.class                        "srd-5.1:fighter"     your first class
//   class.srd-5.1:fighter.skills       ["athletics", ...]    that class's choices, kept per class
//   class.srd-5.1:sorcerer.subclass    "srd-5.1:draconic"    its subclass, when chosen at this level
//   class.srd-5.1:draconic.<choice>    ...                   the subclass's own choices
//
// Levelling up (levels 2 to 20, multiclassing) arrives in a later step; the character is level 1 for now.
import type { ContentEntry, Option } from "../../../core";
import { fullRef, picksOf, type Context, type Source } from "../engine/context";
import { expandSource } from "../engine/expand";
import type { Class, Effect, Subclass } from "../packFormat";
import { ABILITIES, type Ability } from "../vocabulary";

export const CLASS_STEP = { id: "class", label: "Class" };
export const CLASS_KEY = "class.class";
/** Until levelling up arrives. */
export const STARTING_LEVEL = 1;

const SHORT: Record<Ability, string> = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };

type Columns = { id: string; values: Record<string, number | string> }[] | undefined;

/** Each column's value at a level: the value given at that level or the nearest one below it. */
export function columnsAt(columns: Columns, level: number): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const c of columns ?? []) {
    const at = Object.keys(c.values).map(Number).filter((l) => l <= level).sort((a, b) => b - a)[0];
    if (at !== undefined) out[c.id] = c.values[String(at)];
  }
  return out;
}

/** "Str or Dex" (either will do) or "Dex and Wis" (both needed): the scores the class leans on, from its multiclass prerequisites. */
function keyAbilities(cls: Class): string | undefined {
  const r = cls.multiclass.requires;
  if (r.all) return r.all.map((p) => SHORT[p.ability]).join(" and ");
  if (r.any) return r.any.map((p) => SHORT[p.ability]).join(" or ");
  return undefined;
}

function classOption(entry: ContentEntry & { ref: string }): Option {
  const cls = entry as unknown as Class & { ref: string };
  const saves = ABILITIES.filter((a) => cls.proficiencies.some((e) => e.type === "proficiency" && e.kind === "saving-throw" && e.id === a));
  const tags = [`d${cls.hitDie} hit die`];
  const key = keyAbilities(cls);
  if (key) tags.push(key);
  if (saves.length) tags.push(`Saves: ${saves.map((a) => SHORT[a]).join(", ")}`);
  return {
    value: entry.ref,
    name: cls.name,
    summary: cls.summary,
    description: cls.description,
    tags,
  };
}

const effectsUpTo = (levels: { level: number; effects: Effect[] }[], level: number) =>
  levels.filter((l) => l.level <= level).flatMap((l) => l.effects as Effect[]);

export function classStep(ctx: Context): void {
  ctx.steps.push(CLASS_STEP);
  const picks = picksOf(ctx.doc.choices[CLASS_KEY]);
  ctx.open.push({
    spec: { key: CLASS_KEY, step: "class", label: "Choose a class", kind: "pick-one", required: true, options: ctx.content.list("classes").map(classOption) },
    picks,
    collection: "classes",
  });

  const ref = picks[0];
  const entry = ref ? ctx.content.get("classes", ref) : undefined;
  if (!ref || !entry) return;
  const cls = entry as unknown as Class & { ref: string; pack: string };
  const level = STARTING_LEVEL;
  ctx.tally.classes.push({ ref, name: cls.name, hitDie: cls.hitDie, level });

  // The subclass first, when it's chosen at this level: its choice sits just under the class.
  let subSource: Source | undefined;
  if (cls.subclass && cls.subclass.level <= level) {
    const key = `class.${ref}.subclass`;
    const subPicks = picksOf(ctx.doc.choices[key]);
    const subclasses = ctx.content.list("subclasses").filter((s) => typeof s.class === "string" && fullRef(s.class, s.pack) === ref);
    ctx.open.push({
      spec: {
        key, step: "class", label: `Choose your ${cls.subclass.name}`, source: cls.name, kind: "pick-one", required: true,
        options: subclasses.map((s) => ({ value: s.ref, name: s.name, summary: typeof s.summary === "string" ? s.summary : undefined, description: typeof s.description === "string" ? s.description : undefined })),
      },
      picks: subPicks,
      collection: "subclasses",
    });
    const picked = subclasses.find((s) => s.ref === subPicks[0]) as unknown as (Subclass & { ref: string; pack: string }) | undefined;
    if (picked) {
      subSource = {
        key: `class.${picked.ref}`, name: picked.name, step: "class", pack: picked.pack, classLevel: level,
        columns: { ...columnsAt(cls.columns, level), ...columnsAt(picked.columns, level) },
        effects: effectsUpTo(picked.levels as { level: number; effects: Effect[] }[], level),
      };
    }
  }

  expandSource(ctx, {
    key: `class.${ref}`, name: cls.name, step: "class", pack: cls.pack, classLevel: level, columns: columnsAt(cls.columns, level),
    effects: [...(cls.proficiencies as Effect[]), ...effectsUpTo(cls.levels as { level: number; effects: Effect[] }[], level)],
  });
  if (subSource) expandSource(ctx, subSource);
}
