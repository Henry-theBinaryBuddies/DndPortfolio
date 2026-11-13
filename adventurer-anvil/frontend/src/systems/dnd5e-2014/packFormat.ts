// The 2014 pack format: what each collection's entries look like, the effects they can carry, and the
// checks that run when a pack is read (field shapes first, then that every reference points at something).
// One definition gives the TypeScript types, the load-time checks and the published JSON Schema (schema.ts).
import { z } from "zod";
import type { IndexedPack, PackFile, PackSchema } from "../../core";
import { PACK_FORMAT, PACK_FORMAT_VERSION } from "../../core";
import {
  ABILITIES, COLLECTIONS, DAMAGE_TYPES, MOVEMENT, PROFICIENCY_KINDS, RECHARGE, SENSES, SIZES, SKILL_IDS,
  type Collection,
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
const speed = z
  .strictObject({ type: z.literal("speed"), ...Object.fromEntries(MOVEMENT.map((m) => [m, z.int().min(0).optional()])) })
  .refine((e) => MOVEMENT.some((m) => (e as Record<string, unknown>)[m] !== undefined), "give at least one speed (walk, fly, ...)");
const sense = z.strictObject({ type: z.literal("sense"), sense: z.enum(SENSES), range: z.int().positive() });
const proficiency = z.strictObject({ type: z.literal("proficiency"), kind: z.enum(PROFICIENCY_KINDS), id });
const language = z.strictObject({ type: z.literal("language"), id: ref });
const resistance = z.strictObject({ type: z.literal("resistance"), damage: z.enum(DAMAGE_TYPES) });
const grant = z.strictObject({ type: z.literal("grant"), collection: z.enum(COLLECTIONS), id: ref });
const choice = z.strictObject({
  type: z.literal("choice"),
  id,
  label: z.string().min(1),
  pick: z.int().positive(),
  from: z.strictObject({
    collection: z.enum(COLLECTIONS),
    /** Only entries whose fields match: a list field matches if it contains the value. */
    where: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
});
const resource = z.strictObject({
  type: z.literal("resource"), id, name: z.string().min(1).optional(), uses: z.int().positive(), recharge: z.enum(RECHARGE),
});
const feature = z.strictObject({
  type: z.literal("feature"),
  name: z.string().min(1),
  summary: z.string().optional(),
  description: z.string().optional(),
  source: sourceSchema.optional(),
});

export const EFFECT_TYPES = [
  "ability-bonus", "speed", "sense", "proficiency", "language", "resistance", "grant", "choice", "resource", "feature",
] as const;

export const effectSchema = z.discriminatedUnion("type", [
  abilityBonus, speed, sense, proficiency, language, resistance, grant, choice, resource, feature,
]);
export type Effect = z.infer<typeof effectSchema>;

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

export type Race = z.infer<typeof raceSchema>;
export type Subrace = z.infer<typeof subraceSchema>;
export type Language = z.infer<typeof languageSchema>;

/** Collections whose format exists so far. The others are named in vocabulary.ts and arrive with later steps. */
export const COLLECTION_SCHEMAS = {
  races: raceSchema,
  subraces: subraceSchema,
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

  const checkEffects = (effects: Effect[], where: string) =>
    effects.forEach((effect, i) => {
      const at = `${where}.effects[${i}]`;
      if (effect.type === "language") resolves(effect.id, "languages", at);
      if (effect.type === "grant") resolves(effect.id, effect.collection, at);
      if (effect.type === "proficiency" && effect.kind === "skill" && !SKILL_IDS.includes(effect.id as (typeof SKILL_IDS)[number])) {
        errors.push(`${at}: no skill "${effect.id}".`);
      }
    });

  const races = (pack.collections.races ?? []) as Race[];
  const subraces = (pack.collections.subraces ?? []) as Subrace[];
  races.forEach((race, i) => checkEffects(race.effects, `collections.races[${i}]`));
  subraces.forEach((sub, i) => {
    resolves(sub.race, "races", `collections.subraces[${i}].race`);
    checkEffects(sub.effects, `collections.subraces[${i}]`);
  });

  return errors;
}

export const packSchema: PackSchema = { validate: validatePack };
