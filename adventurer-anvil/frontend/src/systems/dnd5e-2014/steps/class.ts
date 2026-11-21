// The Class step: your first class, your character level, any levels in other classes (multiclassing), then each
// class's choices level by level (skills, a fighting style, its subclass, Ability Score Improvements...). Each class
// and subclass becomes a source like a race, with its effects up to its own level.
//
//   class.class                        "srd-5.1:fighter"            your first class
//   class.level                        5                            your character level, 1 to 20 (1 if not set)
//   class.multi                        { "srd-5.1:wizard": 1 }      levels in other classes; the first class has the rest
//   class.srd-5.1:fighter.skills       ["athletics", ...]           a class's choices, kept per class
//   class.srd-5.1:fighter.asi-4        { "str": 2 }                 an Ability Score Improvement, by the class level it comes at
//   class.srd-5.1:fighter.subclass     "srd-5.1:champion"           its subclass, once its level is reached
//   class.srd-5.1:champion.<choice>    ...                          the subclass's own choices
import type { ContentEntry, Option } from "../../../core";
import { fullRef, picksOf, type Context, type Source } from "../engine/context";
import { expandSource } from "../engine/expand";
import type { Class, Effect, Subclass } from "../packFormat";
import { ABILITIES, ABILITY_NAMES, type Ability } from "../vocabulary";

export const CLASS_STEP = { id: "class", label: "Class" };
export const CLASS_KEY = "class.class";
export const LEVEL_KEY = "class.level";
export const MULTI_KEY = "class.multi";
export const MAX_LEVEL = 20;

const SHORT: Record<Ability, string> = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };

type Columns = { id: string; values: Record<string, number | string> }[] | undefined;
type ClassEntry = Class & { ref: string; pack: string };
type SubclassEntry = Subclass & { ref: string; pack: string };
type Levels = { level: number; effects: Effect[] }[];

/** Each column's value at a level: the value given at that level or the nearest one below it. */
export function columnsAt(columns: Columns, level: number): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const c of columns ?? []) {
    const at = Object.keys(c.values).map(Number).filter((l) => l <= level).sort((a, b) => b - a)[0];
    if (at !== undefined) out[c.id] = c.values[String(at)];
  }
  return out;
}

/** The character level stored, or 1 when it isn't set or isn't a whole number from 1 to 20. */
export function levelOf(choices: Record<string, unknown>): number {
  const v = choices[LEVEL_KEY];
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_LEVEL ? v : 1;
}

/** The stored levels in other classes: whole numbers above 0, by class reference. */
export function storedOtherLevels(choices: Record<string, unknown>): [string, number][] {
  const v = choices[MULTI_KEY];
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isInteger(e[1]) && e[1] > 0);
}

/** A class's multiclass prerequisites in words: "Str 13 or Dex 13", "Dex 13 and Wis 13". */
export function prerequisiteText(cls: Class): string {
  const r = cls.multiclass.requires;
  if (r.all) return r.all.map((p) => `${SHORT[p.ability]} ${p.min}`).join(" and ");
  return (r.any ?? []).map((p) => `${SHORT[p.ability]} ${p.min}`).join(" or ");
}

/** Whether scores meet a class's multiclass prerequisites. */
export function meetsPrerequisites(cls: Class, scores: Record<Ability, number>): boolean {
  const r = cls.multiclass.requires;
  const ok = (p: { ability: Ability; min: number }) => scores[p.ability] >= p.min;
  return (r.all ? r.all.every(ok) : true) && (r.any ? r.any.some(ok) : true);
}

/** "Str or Dex" (either will do) or "Dex and Wis" (both needed): the scores the class leans on, from its multiclass prerequisites. */
function keyAbilities(cls: Class): string | undefined {
  const r = cls.multiclass.requires;
  if (r.all) return r.all.map((p) => SHORT[p.ability]).join(" and ");
  if (r.any) return r.any.map((p) => SHORT[p.ability]).join(" or ");
  return undefined;
}

function classOption(entry: ContentEntry & { ref: string }): Option {
  const cls = entry as unknown as ClassEntry;
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

/** The effects a class or subclass gives at exactly this level. */
const effectsAt = (levels: Levels, level: number) => levels.filter((l) => l.level === level).flatMap((l) => l.effects);

export function classStep(ctx: Context): void {
  ctx.steps.push(CLASS_STEP);
  const { doc, content } = ctx;
  const picks = picksOf(doc.choices[CLASS_KEY]);
  const classes = content.list("classes") as unknown as ClassEntry[];
  ctx.open.push({
    spec: { key: CLASS_KEY, step: "class", label: "Choose a class", kind: "pick-one", required: true, options: classes.map((c) => classOption(c as unknown as ContentEntry & { ref: string })) },
    picks,
    collection: "classes",
  });

  const ref = picks[0];
  const first = ref ? (content.get("classes", ref) as unknown as ClassEntry | undefined) : undefined;
  if (!ref || !first) return;

  // The level, then the other classes, which share out all but one of its levels.
  const level = levelOf(doc.choices);
  const stored = doc.choices[LEVEL_KEY];
  ctx.open.push({
    spec: {
      key: LEVEL_KEY, step: "class", label: "Level", kind: "number", range: { min: 1, max: MAX_LEVEL }, required: false,
      hint: `Your character level, from 1 to ${MAX_LEVEL}. Levels go to your ${first.name} unless you give some to other classes below.`,
    },
    picks: [],
    answered: true,
  });
  if (stored !== undefined && stored !== null && stored !== level) {
    ctx.issues.push({ id: "level-range", severity: "error", step: "class", key: LEVEL_KEY, overridable: false, message: `Level: a whole number from 1 to ${MAX_LEVEL}. Counted as 1 for now.` });
  }

  const spare = level - 1;
  const others = storedOtherLevels(doc.choices).filter(([r]) => r !== ref);
  ctx.open.push({
    spec: {
      key: MULTI_KEY, step: "class", label: "Other classes (multiclassing)", kind: "quantities", presentation: "steppers", required: false,
      hint: spare
        ? `Give some of your levels to other classes. Your ${first.name} keeps the rest, at least 1. Each class needs its scores, and so does your ${first.name}.`
        : "Raise your level to give levels to other classes.",
      options: classes.filter((c) => c.ref !== ref).map((c) => ({ value: c.ref, name: c.name, summary: `Needs ${prerequisiteText(c)}`, tags: [`d${c.hitDie} hit die`] })),
      budget: { total: spare, cost: Object.fromEntries(classes.map((c) => [c.ref, 1])) },
    },
    picks: others.map(([r]) => r),
    answered: true,
    collection: "classes",
  });
  const given = others.reduce((t, [, n]) => t + n, 0);
  if (given > spare) {
    ctx.issues.push({
      id: "multiclass-levels", severity: "error", step: "class", key: MULTI_KEY, overridable: false,
      message: `Other classes: ${given} level${given === 1 ? "" : "s"} given, but at level ${level} only ${spare} can be (your ${first.name} keeps at least 1).`,
    });
  }

  // Each class, the first first: its level, its subclass, and its effects level by level.
  const levels: [ClassEntry, number][] = [[first, Math.max(1, level - given)]];
  for (const [r, n] of others) {
    const cls = content.get("classes", r) as unknown as ClassEntry | undefined;
    if (cls) levels.push([cls, n]);
  }
  levels.forEach(([cls, classLevel], i) => expandClass(ctx, cls, classLevel, i === 0));
}

/** One class at its level: proficiencies (the full set for the first class, the multiclass set for others), then each level's effects, with the subclass's from the level it's chosen. */
function expandClass(ctx: Context, cls: ClassEntry, classLevel: number, isFirst: boolean): void {
  const columns = columnsAt(cls.columns, classLevel);
  const entry: (typeof ctx.tally.classes)[number] = { ref: cls.ref, name: cls.name, hitDie: cls.hitDie, level: classLevel };
  ctx.tally.classes.push(entry);
  const at = (l: number) => `${cls.name} ${l}`;
  const source = (l: number, effects: Effect[]): Source => ({ key: `class.${cls.ref}`, name: cls.name, step: "class", pack: cls.pack, classLevel, columns, at: at(l), effects });

  expandSource(ctx, source(1, (isFirst ? cls.proficiencies : cls.multiclass.proficiencies) as Effect[]));

  let sub: SubclassEntry | undefined;
  for (let l = 1; l <= classLevel; l++) {
    expandSource(ctx, source(l, effectsAt(cls.levels as Levels, l)));
    if (cls.subclass && cls.subclass.level === l) {
      const key = `class.${cls.ref}.subclass`;
      const subPicks = picksOf(ctx.doc.choices[key]);
      const subclasses = ctx.content.list("subclasses").filter((s) => typeof s.class === "string" && fullRef(s.class, s.pack) === cls.ref);
      ctx.open.push({
        spec: {
          key, step: "class", label: `Choose your ${cls.subclass.name}`, source: at(l), kind: "pick-one", required: true,
          options: subclasses.map((s) => ({ value: s.ref, name: s.name, summary: typeof s.summary === "string" ? s.summary : undefined, description: typeof s.description === "string" ? s.description : undefined })),
        },
        picks: subPicks,
        collection: "subclasses",
      });
      sub = subclasses.find((s) => s.ref === subPicks[0]) as unknown as SubclassEntry | undefined;
      if (sub) entry.subclass = sub.name;
    }
    if (sub) {
      expandSource(ctx, {
        key: `class.${sub.ref}`, name: sub.name, step: "class", pack: sub.pack, classLevel, at: at(l),
        columns: { ...columns, ...columnsAt(sub.columns, classLevel) },
        effects: effectsAt(sub.levels as Levels, l),
      });
    }
  }
}

/**
 * After the scores are known: multiclassing needs each added class's prerequisites and the first class's. Options
 * that can't be taken are marked; levels already given to one are a problem a DM can allow.
 */
export function checkMulticlass(ctx: Context, scores: Record<Ability, number>): void {
  const choice = ctx.open.find((c) => c.spec.key === MULTI_KEY);
  const first = ctx.tally.classes[0];
  if (!choice || !first) return;
  const firstClass = ctx.content.get("classes", first.ref) as unknown as ClassEntry | undefined;
  if (!firstClass) return;
  const have = (cls: Class) => {
    const abilities = [...new Set([...(cls.multiclass.requires.all ?? []), ...(cls.multiclass.requires.any ?? [])].map((p) => p.ability))];
    return abilities.map((a) => `${ABILITY_NAMES[a]} ${scores[a]}`).join(", ");
  };
  const firstOk = meetsPrerequisites(firstClass, scores);
  const leaving = `Leaving ${firstClass.name} for another class needs ${prerequisiteText(firstClass)}`;
  choice.spec.options = choice.spec.options?.map((o) => {
    const cls = ctx.content.get("classes", String(o.value)) as unknown as ClassEntry | undefined;
    if (!cls) return o;
    if (!firstOk) return { ...o, unavailable: `${leaving} (you have ${have(firstClass)})` };
    return meetsPrerequisites(cls, scores) ? o : { ...o, unavailable: `Needs ${prerequisiteText(cls)} (you have ${have(cls)})` };
  });
  if (choice.picks.length && !firstOk) {
    ctx.issues.push({
      id: "multiclass-prerequisite:first", severity: "error", step: "class", key: MULTI_KEY, overridable: true,
      message: `${leaving}; you have ${have(firstClass)}.`,
    });
  }
  for (const r of choice.picks) {
    const cls = ctx.content.get("classes", r) as unknown as ClassEntry | undefined;
    if (!cls) {
      ctx.issues.push({ id: `missing-content:${MULTI_KEY}:${r}`, severity: "error", step: "class", key: MULTI_KEY, overridable: false, message: `Other classes: "${r}" is not in any loaded pack.` });
    } else if (!meetsPrerequisites(cls, scores)) {
      ctx.issues.push({
        id: `multiclass-prerequisite:${r}`, severity: "error", step: "class", key: MULTI_KEY, overridable: true,
        message: `Multiclassing into ${cls.name} needs ${prerequisiteText(cls)}; you have ${have(cls)}.`,
      });
    }
  }
}
