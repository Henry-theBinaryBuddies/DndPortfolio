// The 2014 pack format: what each collection's entries look like, the effects they can carry, and the
// checks that run when a pack is read (field shapes first, then that every reference points at something).
// One definition gives the TypeScript types, the load-time checks and the published JSON Schema (schema.ts).
import { z } from "zod";
import type { IndexedPack, PackFile, PackSchema } from "../../core";
import { PACK_FORMAT, PACK_FORMAT_VERSION } from "../../core";
import {
  ABILITIES, CHOICE_LISTS, choiceListValues, COLLECTIONS, DAMAGE_TYPES, MOVEMENT, PROFICIENCY_KINDS, RECHARGE, SENSES, SIZES,
  SKILL_IDS, type ChoiceList, type Collection,
} from "./vocabulary";

export const SYSTEM_ID = "dnd5e-2014";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PACK_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
/** "elf" (this pack) or "srd-5.1:elf" (another pack, which must be in `requires`). */
const REF = new RegExp(`^(?:${PACK_ID.source.slice(1, -1)}:)?${ID.source.slice(1, -1)}$`);

const id = z.string().regex(ID, "lower-case words joined by hyphens, e.g. \"high-elf\"");
const ref = z.string().regex(REF, "an id in this pack (\"elf\") or pack:id for another pack (\"srd-5.1:elf\")");

export const sourceSchema = z.strictObject({
  book: z.string().min(1),
  page: z.int().positive().optional(),
});

// ---- Effects: typed statements the rules module knows how to apply ----

const abilityBonus = z.strictObject({ type: z.literal("ability-bonus"), ability: z.enum(ABILITIES), amount: z.int().min(-10).max(10) });
const feet = z.int().min(0).optional();
const speed = z
  .strictObject({ type: z.literal("speed"), walk: feet, fly: feet, swim: feet, climb: feet, burrow: feet })
  .refine((e) => MOVEMENT.some((m) => e[m] !== undefined), "give at least one speed (walk, fly, ...)");
const sense = z.strictObject({ type: z.literal("sense"), sense: z.enum(SENSES), range: z.int().positive() });
const proficiency = z.strictObject({ type: z.literal("proficiency"), kind: z.enum(PROFICIENCY_KINDS), id });
const language = z.strictObject({ type: z.literal("language"), id: ref });
const resistance = z.strictObject({ type: z.literal("resistance"), damage: z.enum(DAMAGE_TYPES) });
const grant = z.strictObject({ type: z.literal("grant"), collection: z.enum(COLLECTIONS), id: ref });
/** Another way to work out Armor Class without armour (Unarmored Defense): base + the abilities' modifiers. The best one counts. */
const armorClass = z.strictObject({
  type: z.literal("armor-class"),
  base: z.int().min(0).max(30),
  abilities: z.array(z.enum(ABILITIES)).max(3),
  /** False if a shield is not allowed with it (a monk's). */
  shield: z.boolean().optional(),
});
/** A flat bonus to Armor Class, perhaps only while armoured (the Defense fighting style) or unarmoured. */
const armorClassBonus = z.strictObject({
  type: z.literal("armor-class-bonus"),
  amount: z.int().min(-10).max(10),
  while: z.enum(["armored", "unarmored"]).optional(),
});
/** Extra hit points for every character level (Dwarven Toughness, Draconic Resilience). */
const hitPoints = z.strictObject({ type: z.literal("hit-points"), perLevel: z.int().min(-5).max(10) });
/** Double the proficiency bonus for a skill or tool you are proficient in. */
const expertise = z.strictObject({ type: z.literal("expertise"), kind: z.enum(["skill", "tool"]), id });
/** Pick entries from a collection; each pick is granted (a language known, a cantrip known...). */
const collectionChoiceFrom = z.strictObject({
  collection: z.enum(COLLECTIONS),
  /** Only entries whose fields match: a list field matches if it contains the value. */
  where: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
/** Pick from one of the module's fixed lists; `each` says what every pick gives. */
const listChoiceFrom = z.strictObject({
  list: z.enum(Object.keys(CHOICE_LISTS) as [ChoiceList, ...ChoiceList[]]),
  only: z.array(z.string()).optional(),
  except: z.array(z.string()).optional(),
});
/** An effect with one field left blank, which each pick fills in (the ability, the skill, the damage type). */
/** Pick from proficiencies the character already has: "skill" (any skill), "tool:thieves-tools" (that tool). */
const proficientChoiceFrom = z.strictObject({
  proficient: z
    .array(z.string().regex(/^(skill|tool)(:[a-z0-9]+(-[a-z0-9]+)*)?$/, '"skill", "tool", or one by id, e.g. "tool:thieves-tools"'))
    .min(1),
});
export const eachSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ability-bonus"), amount: z.int().min(-10).max(10) }),
  z.strictObject({ type: z.literal("proficiency"), kind: z.literal("skill") }),
  z.strictObject({ type: z.literal("resistance") }),
  z.strictObject({ type: z.literal("expertise") }),
]);
export type EachTemplate = z.infer<typeof eachSchema>;

/** How many uses a resource has: a number, a class table column, an ability modifier (plus add, at least min), or so many per class level. */
const uses = z.union([
  z.int().min(0),
  z.strictObject({ column: id }),
  z.strictObject({ ability: z.enum(ABILITIES), add: z.int().optional(), min: z.int().min(0).optional() }),
  z.strictObject({ perLevel: z.int().positive() }),
]);
const resource = z.strictObject({
  type: z.literal("resource"), id, name: z.string().min(1).optional(), uses, recharge: z.enum(RECHARGE),
});
const feature = z.strictObject({
  type: z.literal("feature"),
  name: z.string().min(1),
  summary: z.string().optional(),
  description: z.string().optional(),
  source: sourceSchema.optional(),
});

const SIMPLE_EFFECTS = [
  abilityBonus, speed, sense, proficiency, language, resistance, grant, armorClass, armorClassBonus, hitPoints, expertise, resource, feature,
] as const;
/** Every effect but a choice: what an option written into a choice can give. */
const simpleEffectSchema = z.discriminatedUnion("type", [...SIMPLE_EFFECTS]);

/** An option written into the choice itself (a fighting style), with what it gives. */
const inlineOption = z.strictObject({
  id,
  name: z.string().min(1),
  summary: z.string().optional(),
  description: z.string().optional(),
  effects: z.array(simpleEffectSchema),
});
const optionsChoiceFrom = z.strictObject({ options: z.array(inlineOption).min(1) });

const choice = z.strictObject({
  type: z.literal("choice"),
  id,
  label: z.string().min(1),
  pick: z.int().positive(),
  from: z.union([collectionChoiceFrom, listChoiceFrom, optionsChoiceFrom, proficientChoiceFrom]),
  each: eachSchema.optional(),
});

export const EFFECT_TYPES = [
  "ability-bonus", "speed", "sense", "proficiency", "language", "resistance", "grant", "armor-class", "armor-class-bonus",
  "hit-points", "expertise", "choice", "resource", "feature",
] as const;

export const effectSchema = z.discriminatedUnion("type", [...SIMPLE_EFFECTS, choice]);
export type Effect = z.infer<typeof effectSchema>;
export type ChoiceEffect = Extract<Effect, { type: "choice" }>;

// ---- Entries ----

const entryBase = {
  id,
  name: z.string().min(1),
  /** One line, in your own words for private packs. */
  summary: z.string().optional(),
  /** Full text: meant for openly licensed material such as the SRD. */
  description: z.string().optional(),
  /** Where the full text is, e.g. { "book": "PHB", "page": 24 }. */
  source: sourceSchema.optional(),
};

export const raceSchema = z.strictObject({
  ...entryBase,
  size: z.enum(SIZES),
  effects: z.array(effectSchema),
  /** Feeds random suggestions on the Details step. */
  suggestions: z
    .strictObject({
      ageAdult: z.int().positive().optional(),
      ageMax: z.int().positive().optional(),
      height: z.string().optional(),
      weight: z.string().optional(),
      names: z.record(z.string(), z.array(z.string())).optional(),
    })
    .optional(),
});

export const subraceSchema = z.strictObject({ ...entryBase, race: ref, effects: z.array(effectSchema) });

export const languageSchema = z.strictObject({ ...entryBase, exotic: z.boolean().optional(), script: z.string().optional() });

const level = z.int().min(1).max(20);
/** Each level's effects, in order: what a character gets on reaching that level in the class. */
const levelsSchema = z.array(z.strictObject({ level, effects: z.array(effectSchema) }));
/** A column of the class table (Rage count, Sneak Attack dice). Values are given at the levels they change and last until the next. */
const columnsSchema = z.array(
  z.strictObject({
    id,
    name: z.string().min(1),
    values: z.record(z.string().regex(/^(?:[1-9]|1\d|20)$/, "a level from 1 to 20"), z.union([z.number(), z.string().min(1)])),
  }),
);
const prerequisite = z.strictObject({ ability: z.enum(ABILITIES), min: z.int().min(1).max(30) });

export const classSchema = z.strictObject({
  ...entryBase,
  hitDie: z.literal([6, 8, 10, 12], { error: "a hit die of 6, 8, 10 or 12" }),
  /** What taking this class first gives: saving throws, armour, weapons, tools, skills. */
  proficiencies: z.array(effectSchema),
  multiclass: z.strictObject({
    /** Scores needed to take (or leave for) another class: every one of `all`, or at least one of `any`. */
    requires: z
      .strictObject({ all: z.array(prerequisite).min(1).optional(), any: z.array(prerequisite).min(1).optional() })
      .refine((r) => r.all || r.any, 'give "all" or "any"'),
    /** The smaller set of proficiencies for taking this class later. */
    proficiencies: z.array(effectSchema),
  }),
  /** What its subclasses are called and the level they are chosen at. */
  subclass: z.strictObject({ name: z.string().min(1), level }).optional(),
  columns: columnsSchema.optional(),
  levels: levelsSchema,
});

export const subclassSchema = z.strictObject({ ...entryBase, class: ref, columns: columnsSchema.optional(), levels: levelsSchema });

/** Suggestions for a character's personality, from a background's tables: each list is rolled or picked from. */
const characteristicsSchema = z.strictObject({
  traits: z.array(z.string().min(1)).optional(),
  ideals: z.array(z.strictObject({ text: z.string().min(1), alignment: z.string().min(1).optional() })).optional(),
  bonds: z.array(z.string().min(1)).optional(),
  flaws: z.array(z.string().min(1)).optional(),
});

export const backgroundSchema = z.strictObject({ ...entryBase, effects: z.array(effectSchema), characteristics: characteristicsSchema.optional() });

export type Race = z.infer<typeof raceSchema>;
export type Background = z.infer<typeof backgroundSchema>;
export type Class = z.infer<typeof classSchema>;
export type Subclass = z.infer<typeof subclassSchema>;
export type Subrace = z.infer<typeof subraceSchema>;
export type Language = z.infer<typeof languageSchema>;

/** Collections whose format exists so far. The others are named in vocabulary.ts and arrive with later steps. */
export const COLLECTION_SCHEMAS = {
  races: raceSchema,
  subraces: subraceSchema,
  classes: classSchema,
  subclasses: subclassSchema,
  backgrounds: backgroundSchema,
  languages: languageSchema,
} satisfies Partial<Record<Collection, z.ZodType>>;

/** The whole pack file, for the published JSON Schema. (The wrapper is also checked by the core, for any game.) */
export const packFileSchema = z.strictObject({
  $schema: z.string().optional(),
  format: z.literal(PACK_FORMAT),
  formatVersion: z.literal(PACK_FORMAT_VERSION),
  id: z.string().regex(PACK_ID),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  system: z.literal(SYSTEM_ID),
  title: z.string().min(1),
  attribution: z.string().optional(),
  requires: z.array(z.string().regex(PACK_ID)),
  collections: z.strictObject(
    Object.fromEntries(Object.entries(COLLECTION_SCHEMAS).map(([name, schema]) => [name, z.array(schema).optional()])),
  ),
});

// ---- Checking a pack ----

function pathText(path: PropertyKey[]): string {
  return path.reduce<string>((text, part) => (typeof part === "number" ? `${text}[${part}]` : text ? `${text}.${String(part)}` : String(part)), "");
}

function valueAt(root: unknown, path: PropertyKey[]): unknown {
  return path.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<PropertyKey, unknown>)[k] : undefined), root);
}

/** Zod's findings as readable lines, e.g. `collections.subraces[0].effects[2]: unknown effect type "darkvison"`. */
function describeIssues(error: z.ZodError, prefix: PropertyKey[], root: unknown): string[] {
  return error.issues.map((issue) => {
    const path = [...prefix, ...issue.path];
    if (issue.code === "invalid_union" && "discriminator" in issue && issue.discriminator === "type") {
      // Zod points at the "type" field itself; name the effect it belongs to.
      const effectPath = path.at(-1) === "type" ? path.slice(0, -1) : path;
      const type = valueAt(root, effectPath) as { type?: unknown } | undefined;
      return `${pathText(effectPath)}: unknown effect type ${JSON.stringify(type?.type)} (known: ${EFFECT_TYPES.join(", ")})`;
    }
    if (issue.code === "unrecognized_keys") return `${pathText(path)}: unknown field${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")}`;
    return `${pathText(path)}: ${issue.message}`;
  });
}

/** Checks the collections' fields, then that ids are unique and every reference resolves. */
export function validatePack(pack: PackFile, required: IndexedPack[]): string[] {
  const errors: string[] = [];
  const known = new Set<string>(COLLECTIONS);

  for (const [name, list] of Object.entries(pack.collections)) {
    if (!known.has(name)) {
      errors.push(`collections.${name}: not a 2014 collection (known: ${COLLECTIONS.join(", ")}).`);
    } else if (!(name in COLLECTION_SCHEMAS)) {
      if (list.length) errors.push(`collections.${name}: the format for ${name} arrives in a later step.`);
    } else {
      const result = z.array(COLLECTION_SCHEMAS[name as keyof typeof COLLECTION_SCHEMAS]).safeParse(list);
      if (!result.success) errors.push(...describeIssues(result.error, ["collections", name], pack));
    }
  }
  if (errors.length) return errors;

  // Unique ids within each collection.
  for (const [name, list] of Object.entries(pack.collections)) {
    const seen = new Set<string>();
    list.forEach((entry, i) => {
      if (seen.has(entry.id)) errors.push(`collections.${name}[${i}]: the id "${entry.id}" is used twice.`);
      seen.add(entry.id);
    });
  }

  const isSkill = (s: string) => SKILL_IDS.includes(s as (typeof SKILL_IDS)[number]);

  // References: local ids resolve in this pack; pack:id in a required pack.
  const resolves = (target: string, collection: string, where: string) => {
    const colon = target.indexOf(":");
    if (colon < 0) {
      if (!(pack.collections[collection] ?? []).some((e) => e.id === target)) {
        errors.push(`${where}: no ${collection} entry "${target}" in this pack.`);
      }
      return;
    }
    const packId = target.slice(0, colon);
    const entryId = target.slice(colon + 1);
    const other = required.find((p) => p.id === packId);
    if (!other) {
      errors.push(`${where}: "${target}" points into the pack "${packId}", which is not in this pack's requires.`);
    } else if (!(other.collections[collection] ?? []).some((e) => e.id === entryId)) {
      errors.push(`${where}: no ${collection} entry "${entryId}" in the pack "${packId}".`);
    }
  };

  /** `columns`: the class table columns a resource may count from (undefined outside classes and subclasses). */
  const checkEffects = (effects: Effect[], where: string, columns?: Set<string>) =>
    effects.forEach((effect, i) => {
      const at = `${where}[${i}]`;
      if (effect.type === "language") resolves(effect.id, "languages", at);
      if (effect.type === "grant") resolves(effect.id, effect.collection, at);
      if ((effect.type === "proficiency" || effect.type === "expertise") && effect.kind === "skill" && !isSkill(effect.id)) {
        errors.push(`${at}: no skill "${effect.id}".`);
      }
      if (effect.type === "resource" && typeof effect.uses === "object" && ("column" in effect.uses || "perLevel" in effect.uses)) {
        if (!columns) errors.push(`${at}.uses: only classes and subclasses have levels and table columns to count from.`);
        else if ("column" in effect.uses && !columns.has(effect.uses.column)) errors.push(`${at}.uses: no column "${effect.uses.column}" in the class table.`);
      }
      if (effect.type !== "choice") return;
      const from = effect.from;
      if ("list" in from) {
        const expected = CHOICE_LISTS[from.list];
        if (!effect.each) errors.push(`${at}: a choice from the list "${from.list}" needs "each" (a ${expected} effect).`);
        else if (effect.each.type !== expected) errors.push(`${at}.each: picks from "${from.list}" fill in a ${expected} effect, not ${effect.each.type}.`);
        const values = choiceListValues(from.list);
        for (const v of [...(from.only ?? []), ...(from.except ?? [])]) {
          if (!values.includes(v)) errors.push(`${at}.from: "${v}" is not in the list "${from.list}".`);
        }
      } else if ("proficient" in from) {
        if (effect.each?.type !== "expertise") errors.push(`${at}.each: picks from your proficiencies fill in an expertise effect: give "each": { "type": "expertise" }.`);
        for (const p of from.proficient) {
          const [kind, pid] = p.split(":");
          if (kind === "skill" && pid && !isSkill(pid)) errors.push(`${at}.from: no skill "${pid}".`);
        }
      } else if (effect.each) {
        errors.push(`${at}.each: only choices from a fixed list or from your proficiencies use "each"; ${"options" in from ? "options carry their own effects" : "picks from a collection are granted"}.`);
      }
      if ("options" in from) {
        const seen = new Set<string>();
        from.options.forEach((o, j) => {
          if (seen.has(o.id)) errors.push(`${at}.from.options[${j}]: the id "${o.id}" is used twice.`);
          seen.add(o.id);
          checkEffects(o.effects as Effect[], `${at}.from.options[${j}].effects`, columns);
        });
      }
    });

  /** Levels in rising order; choice ids unique within the entry (they name its choice keys); column ids unique. */
  const checkLeveled = (
    entry: { levels: { level: number; effects: Effect[] }[]; columns?: { id: string }[] },
    where: string,
    columns: Set<string>,
    more: [Effect[], string][] = [],
  ) => {
    entry.levels.forEach((l, i) => {
      if (i > 0 && l.level <= entry.levels[i - 1].level) {
        errors.push(`${where}.levels[${i}]: levels must rise (level ${l.level} comes after level ${entry.levels[i - 1].level}).`);
      }
    });
    const ids = new Map<string, string>();
    const lists: [Effect[], string][] = [...more, ...entry.levels.map((l, i): [Effect[], string] => [l.effects, `${where}.levels[${i}].effects`])];
    for (const [effects, at] of lists) {
      checkEffects(effects, at, columns);
      effects.forEach((e, i) => {
        if (e.type !== "choice") return;
        if (e.id === "subclass") errors.push(`${at}[${i}]: the choice id "subclass" is kept for choosing the subclass.`);
        else if (ids.has(e.id)) errors.push(`${at}[${i}]: the choice id "${e.id}" is also used at ${ids.get(e.id)}.`);
        ids.set(e.id, `${at}[${i}]`);
      });
    }
    const seen = new Set<string>();
    entry.columns?.forEach((c, i) => {
      if (seen.has(c.id)) errors.push(`${where}.columns[${i}]: the id "${c.id}" is used twice.`);
      seen.add(c.id);
    });
  };

  const races = (pack.collections.races ?? []) as Race[];
  const subraces = (pack.collections.subraces ?? []) as Subrace[];
  const classes = (pack.collections.classes ?? []) as Class[];
  const subclasses = (pack.collections.subclasses ?? []) as Subclass[];
  const backgrounds = (pack.collections.backgrounds ?? []) as Background[];
  backgrounds.forEach((bg, i) => checkEffects(bg.effects, `collections.backgrounds[${i}].effects`));
  races.forEach((race, i) => checkEffects(race.effects, `collections.races[${i}].effects`));
  subraces.forEach((sub, i) => {
    resolves(sub.race, "races", `collections.subraces[${i}].race`);
    checkEffects(sub.effects, `collections.subraces[${i}].effects`);
  });
  const columnIds = (entry: { columns?: { id: string }[] }) => new Set((entry.columns ?? []).map((c) => c.id));
  classes.forEach((cls, i) => {
    const at = `collections.classes[${i}]`;
    checkLeveled(cls, at, columnIds(cls), [[cls.proficiencies, `${at}.proficiencies`], [cls.multiclass.proficiencies, `${at}.multiclass.proficiencies`]]);
  });
  subclasses.forEach((sub, i) => {
    const at = `collections.subclasses[${i}]`;
    resolves(sub.class, "classes", `${at}.class`);
    // A subclass may count from its own columns or its class's. (A class in another pack: its columns are checked when the character is built.)
    const parent = sub.class.includes(":")
      ? (required.find((p) => p.id === sub.class.split(":")[0])?.collections.classes ?? []).find((c) => c.id === sub.class.split(":")[1])
      : classes.find((c) => c.id === sub.class);
    const columns = new Set([...columnIds(sub), ...columnIds((parent ?? {}) as { columns?: { id: string }[] })]);
    checkLeveled(sub, at, columns);
  });

  return errors;
}

export const packSchema: PackSchema = { validate: validatePack };
