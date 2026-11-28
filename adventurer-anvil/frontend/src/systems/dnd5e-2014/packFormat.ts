// The 2014 pack format: what each collection's entries look like, the effects they can carry, and the
// checks that run when a pack is read (field shapes first, then that every reference points at something).
// One definition gives the TypeScript types, the load-time checks and the published JSON Schema (schema.ts).
import { z } from "zod";

// Zod normally speeds up checks by building functions from strings, which the site's Content-Security-Policy forbids
// (no 'unsafe-eval'); it would fall back by itself, but only after a blocked attempt the browser reports as a violation.
z.config({ jitless: true });
import type { IndexedPack, PackFile, PackSchema } from "../../core";
import { PACK_FORMAT, PACK_FORMAT_VERSION } from "../../core";
import {
  ABILITIES, ARMOR_CLASSES, CHOICE_LISTS, choiceListValues, COIN_UNITS, COLLECTIONS, DAMAGE_TYPES, MOVEMENT, PROFICIENCY_KINDS,
  RECHARGE, CASTING_KINDS, SCHOOLS, SENSES, SIZES, SKILL_IDS, WEAPON_PROPERTIES, type ChoiceList, type Collection,
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
/**
 * Extra hit points for every level: every character level (Dwarven Toughness), or every level in the class when a
 * class or subclass gives it (Draconic Resilience).
 */
const hitPoints = z.strictObject({ type: z.literal("hit-points"), perLevel: z.int().min(-5).max(10) });
/** Double the proficiency bonus for a skill or tool you are proficient in. */
const expertise = z.strictObject({ type: z.literal("expertise"), kind: z.enum(["skill", "tool"]), id });
const whereValue = z.union([z.string(), z.number(), z.boolean()]);
/** Pick entries from a collection; each pick is granted (a language known, a cantrip known...). */
const collectionChoiceFrom = z.strictObject({
  collection: z.enum(COLLECTIONS),
  /**
   * Only entries whose fields match: a list field matches if it contains the value. A list of values matches any of
   * them (spells of level 0 to 5: "level": [0, 1, 2, 3, 4, 5]).
   */
  where: z.record(z.string(), z.union([whereValue, z.array(whereValue).min(1)])).optional(),
  /** Spells picked here count among the class's spells known (a bard's Magical Secrets). */
  known: z.boolean().optional(),
  /** Only spells already in the class's spellbook: the picks are marked there, not learnt again (Spell Mastery). */
  spellbook: z.boolean().optional(),
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

/** A spell you always have: known (a tiefling's Thaumaturgy, cast with Charisma) or always prepared (a Life cleric's domain spells). */
const spell = z.strictObject({
  type: z.literal("spell"),
  id: ref,
  /** The ability it is cast with; a class's own spells use the class's. */
  ability: z.enum(ABILITIES).optional(),
  /** Always prepared, and not counted against the spells you prepare. */
  always: z.boolean().optional(),
  /** For a spell a class or subclass gives through a choice (a land's circle spells): the class level it comes at. */
  level: z.int().min(1).max(20).optional(),
  /** Cast at will, without a spell slot (an Eldritch Invocation's Mage Armor). */
  atWill: z.literal(true).optional(),
});
/** Spells added to a class's list for you (a Fiend warlock's expanded list): they become options in that class's spell choices. */
const expandedSpells = z.strictObject({ type: z.literal("expanded-spells"), ids: z.array(ref).min(1) });

const SIMPLE_EFFECTS = [
  abilityBonus, speed, sense, proficiency, language, resistance, grant, armorClass, armorClassBonus, hitPoints, expertise, resource, feature,
  spell, expandedSpells,
] as const;
/** Every effect but a choice: what an option written into a choice can give. */
const simpleEffectSchema = z.discriminatedUnion("type", [...SIMPLE_EFFECTS]);

/**
 * What an option needs before it can be picked (an Eldritch Invocation's): a level in the class, an option picked in
 * another of the same class's choices (Pact of the Blade, from "pact-boon"), or a spell known (Eldritch Blast).
 */
const optionRequires = z
  .strictObject({ level: z.int().min(1).max(20).optional(), option: z.strictObject({ choice: id, id }).optional(), spell: ref.optional() })
  .refine((r) => r.level !== undefined || r.option || r.spell, 'give "level", "option" or "spell"');

/** An option written into the choice itself (a fighting style), with what it gives. */
const inlineOption = z.strictObject({
  id,
  name: z.string().min(1),
  summary: z.string().optional(),
  description: z.string().optional(),
  requires: optionRequires.optional(),
  effects: z.array(simpleEffectSchema),
});
const optionsChoiceFrom = z.strictObject({ options: z.array(inlineOption).min(1) });

const choice = z.strictObject({
  type: z.literal("choice"),
  id,
  label: z.string().min(1),
  /** How many to pick: a number, or a column of the class table (Invocations Known), so it grows with level. */
  pick: z.union([z.int().positive(), z.strictObject({ column: id })]),
  from: z.union([collectionChoiceFrom, listChoiceFrom, optionsChoiceFrom, proficientChoiceFrom]),
  each: eachSchema.optional(),
  /** For picks from spells: the ability they are cast with (a high elf's wizard cantrip: Intelligence). */
  ability: z.enum(ABILITIES).optional(),
  /** For picks from spells: words shown beside each pick ("Spell Mastery"), and whether they are always prepared. */
  note: z.string().min(1).optional(),
  always: z.boolean().optional(),
});

/**
 * An Ability Score Improvement: the character adds 2 to one score, or 1 to two, none above 20. `id` names its choice
 * (unique within the class, like a choice's id).
 */
const abilityScoreImprovement = z.strictObject({ type: z.literal("ability-score-improvement"), id });

export const EFFECT_TYPES = [
  "ability-bonus", "speed", "sense", "proficiency", "language", "resistance", "grant", "armor-class", "armor-class-bonus",
  "hit-points", "expertise", "choice", "resource", "feature", "spell", "expanded-spells", "ability-score-improvement",
] as const;

export const effectSchema = z.discriminatedUnion("type", [...SIMPLE_EFFECTS, choice, abilityScoreImprovement]);
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

const range = z.strictObject({ min: z.number().positive(), max: z.number().positive() }).refine((r) => r.min <= r.max, "min must not be above max");
const syllables = z.array(z.string().min(1)).min(1);

/** An optional rule an entry belongs to: it is offered only while the character uses that rule (Variant Human: "feats"). */
const ruleField = { rule: z.enum(["feats"]).optional() };

export const raceSchema = z.strictObject({
  ...entryBase,
  ...ruleField,
  /** One size, or the sizes to choose from (a custom lineage: small or medium). */
  size: z.union([z.enum(SIZES), z.array(z.enum(SIZES)).min(2)]),
  effects: z.array(effectSchema),
  /** Feeds suggestions on the Details step: ages, a height range in inches, a weight range in pounds, and names. */
  suggestions: z
    .strictObject({
      ageAdult: z.int().positive().optional(),
      ageMax: z.int().positive().optional(),
      height: range.optional(),
      weight: range.optional(),
      /** Lists of names to suggest from, by kind (e.g. "given", "family"); used instead of nameParts when present. */
      names: z.record(z.string(), z.array(z.string().min(1)).min(1)).optional(),
      /** Syllables a name is built from: a start, sometimes a middle, an end; and a family name's own parts. */
      nameParts: z
        .strictObject({
          start: syllables,
          middle: syllables.optional(),
          end: syllables,
          family: z.strictObject({ start: syllables, end: syllables }).optional(),
        })
        .optional(),
    })
    .refine((s) => s.ageAdult === undefined || s.ageMax === undefined || s.ageAdult < s.ageMax, "ageAdult must be below ageMax")
    .optional(),
});

export const subraceSchema = z.strictObject({ ...entryBase, ...ruleField, race: ref, effects: z.array(effectSchema) });

/**
 * A feat, taken in place of an Ability Score Improvement (with the feats rule) or given by a race. `requires`: scores
 * it needs (all of them), a proficiency, or being able to cast at least one spell. `repeatable`: may be taken again.
 */
export const featSchema = z.strictObject({
  ...entryBase,
  requires: z
    .strictObject({
      abilities: z.array(z.strictObject({ ability: z.enum(ABILITIES), min: z.int().min(1).max(30) })).min(1).optional(),
      proficiency: z.strictObject({ kind: z.enum(PROFICIENCY_KINDS), id }).optional(),
      spellcasting: z.literal(true).optional(),
    })
    .refine((r) => r.abilities || r.proficiency || r.spellcasting, 'give "abilities", "proficiency" or "spellcasting"')
    .optional(),
  repeatable: z.boolean().optional(),
  effects: z.array(effectSchema),
});

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
  /** What a character who takes this class first starts with (see startingEquipmentSchema below). */
  startingEquipment: z.lazy(() => startingEquipmentSchema).optional(),
  /** Gold to buy equipment with instead, e.g. "5d4x10". Not in SRD 5.1. */
  startingWealth: z.lazy(() => wealthDice).optional(),
  spellcasting: z.lazy(() => spellcastingSchema).optional(),
});

/**
 * How a class casts spells. Counts come from its table's columns (by column id), so they grow with level:
 * cantrips known, spells known (known and pact casters), and slots by spell level ("1": "slots-1").
 */
export const spellcastingSchema = z.strictObject({
  ability: z.enum(ABILITIES),
  /** The class level it starts at (2 for paladins and rangers). */
  level,
  kind: z.enum(CASTING_KINDS),
  /**
   * How its levels count towards a multiclass character's spell slots: all of them ("full", the default), half
   * ("half": paladins and rangers), a third ("third"), or not at all ("pact": a warlock's Pact Magic is separate).
   */
  progression: z.enum(["full", "half", "third", "pact"]).optional(),
  /** Whose spell list: this class's id by default. */
  list: id.optional(),
  cantrips: id.optional(),
  known: id.optional(),
  slots: z.record(z.string().regex(/^[1-9]$/, "a spell level from 1 to 9"), id),
  /** Prepared and spellbook casters prepare their ability modifier plus their level (half their level for paladins), at least 1. */
  prepare: z.enum(["level", "half-level"]).optional(),
  /** Spellbook casters: spells in the book at the start, and how many are added each level. */
  spellbook: z.strictObject({ start: z.int().positive(), perLevel: z.int().min(0) }).optional(),
  ritual: z.boolean().optional(),
  /** Item categories that can be a spellcasting focus (a component pouch always can). */
  focus: z.array(id).optional(),
});
export type Spellcasting = z.infer<typeof spellcastingSchema>;

export const subclassSchema = z.strictObject({ ...entryBase, class: ref, columns: columnsSchema.optional(), levels: levelsSchema });

/** Suggestions for a character's personality, from a background's tables: each list is rolled or picked from. */
const characteristicsSchema = z.strictObject({
  traits: z.array(z.string().min(1)).optional(),
  ideals: z.array(z.strictObject({ text: z.string().min(1), alignment: z.string().min(1).optional() })).optional(),
  bonds: z.array(z.string().min(1)).optional(),
  flaws: z.array(z.string().min(1)).optional(),
});

// ---- Items and starting equipment ----

export const coinsSchema = z.strictObject({ amount: z.number().positive(), unit: z.enum(COIN_UNITS) });
const damageDice = z.string().regex(/^(?:\d+d\d+|\d+)$/, 'dice such as "1d8", or a flat number such as "1"');

export const itemSchema = z.strictObject({
  ...entryBase,
  /** What kinds of item it is, e.g. ["weapon", "martial-weapons", "melee-weapons"]: starting equipment picks "any" item by these. */
  categories: z.array(id).optional(),
  cost: coinsSchema.optional(),
  /** In pounds, for the whole bundle if it is sold in one. */
  weight: z.number().min(0).optional(),
  /** Sold in bundles (arrows, 20 to a purchase): cost and weight are for the bundle. */
  bundle: z.int().min(2).optional(),
  /** Needs attunement to use; words say by whom ("by a cleric"). */
  attunement: z.union([z.literal(true), z.string().min(1)]).optional(),
  weapon: z
    .strictObject({
      class: z.enum(["simple", "martial"]),
      range: z.enum(["melee", "ranged"]),
      damage: z.strictObject({ dice: damageDice, type: z.enum(DAMAGE_TYPES) }).optional(),
      /** Damage when used with two hands. */
      versatile: damageDice.optional(),
      properties: z.array(z.enum(WEAPON_PROPERTIES)),
      /** Range in feet: normal and long (thrown and ranged weapons). */
      normal: z.int().positive().optional(),
      long: z.int().positive().optional(),
    })
    .optional(),
  armor: z
    .strictObject({
      class: z.enum(ARMOR_CLASSES),
      /** Armour Class it gives (a shield's is the bonus, 2). */
      base: z.int().min(0).max(30),
      /** How much of the Dexterity modifier counts: all of it, none, or up to a maximum. */
      dex: z.union([z.literal("full"), z.literal("none"), z.strictObject({ max: z.int().min(0) })]),
      /** Strength needed; below it, speed drops by 10 feet. */
      strength: z.int().min(1).max(30).optional(),
      stealthDisadvantage: z.boolean().optional(),
    })
    .optional(),
  /** An equipment pack's contents: opened into the inventory. */
  contents: z.array(z.strictObject({ item: ref, qty: z.int().positive() })).optional(),
});
export type Item = z.infer<typeof itemSchema>;

/** Dice by level: "3d4+3", "1d8+MOD" (MOD: the caster's spellcasting modifier), or a flat number. Keys are levels. */
const diceByLevel = z.record(
  z.string().regex(/^(?:[1-9]|1\d|20)$/, "a level from 1 to 20"),
  z.string().regex(/^(?:\d+d\d+|\d+)(?:[+-](?:\d+d\d+|\d+|MOD))*$/, 'dice such as "8d6", "3d4+3" or "1d8+MOD"'),
);

export const spellSchema = z.strictObject({
  ...entryBase,
  /** 0 for a cantrip. */
  level: z.int().min(0).max(9),
  school: z.enum(SCHOOLS),
  /** The classes whose lists have it, by id ("wizard"): spell choices filter on these. */
  classes: z.array(id),
  castingTime: z.string().min(1),
  range: z.string().min(1),
  components: z.strictObject({ verbal: z.boolean().optional(), somatic: z.boolean().optional(), material: z.string().min(1).optional() }),
  duration: z.string().min(1),
  concentration: z.boolean().optional(),
  ritual: z.boolean().optional(),
  /** "At Higher Levels". */
  higherLevels: z.string().optional(),
  // What a virtual table can automate (the Tome & Tile export): an attack roll, or a saving throw with what a success
  // does; damage by the slot level it's cast at or by the caster's character level (cantrips); healing by slot level;
  // and the area it fills.
  attack: z.enum(["melee", "ranged"]).optional(),
  /** How many attack rolls it makes (Scorching Ray's three rays); one if not given. */
  attacks: z.int().min(2).max(10).optional(),
  /** Its damage needs no attack roll and no save (Magic Missile). Damage on a spell with neither, and without this, is extra damage in some cases only (Divine Favor), so it isn't applied automatically. */
  automatic: z.literal(true).optional(),
  save: z.strictObject({ ability: z.enum(ABILITIES), onSuccess: z.enum(["half", "none", "other"]) }).optional(),
  damage: z
    .array(z.strictObject({ type: z.enum(DAMAGE_TYPES), atSlotLevel: diceByLevel.optional(), atCharacterLevel: diceByLevel.optional() }))
    .optional(),
  healing: z.strictObject({ atSlotLevel: diceByLevel }).optional(),
  area: z.strictObject({ shape: z.enum(["sphere", "cone", "line", "cube", "cylinder"]), size: z.int().positive() }).optional(),
});
export type Spell = z.infer<typeof spellSchema>;

/** One line of starting equipment: an item, any item of some categories (picked by the player), or a thing named only here. */
const equipmentLine = z.union([
  z.strictObject({ item: ref, qty: z.int().positive().optional() }),
  z.strictObject({
    any: z.strictObject({ categories: z.array(id).min(1) }),
    /** How many to pick (each picked separately, so two of the same is fine). */
    qty: z.int().positive().optional(),
    /** How the book puts it, e.g. "a martial weapon". */
    label: z.string().min(1),
  }),
  z.strictObject({ name: z.string().min(1), qty: z.int().positive().optional(), weight: z.number().min(0).optional() }),
]);
export type EquipmentLine = z.infer<typeof equipmentLine>;

export const startingEquipmentSchema = z.strictObject({
  items: z.array(equipmentLine).optional(),
  /** "(a) chain mail or (b) leather armor, longbow and 20 arrows": one option is taken. */
  choices: z
    .array(
      z.strictObject({
        id,
        label: z.string().min(1),
        options: z.array(z.strictObject({ id, items: z.array(equipmentLine).min(1) })).min(2),
      }),
    )
    .optional(),
  gold: coinsSchema.optional(),
});
export type StartingEquipment = z.infer<typeof startingEquipmentSchema>;

/** Starting wealth instead of equipment: dice times a number of gold pieces, e.g. "5d4x10". */
const wealthDice = z.string().regex(/^\d+d\d+(?:x\d+)?$/, 'dice and an optional multiplier, e.g. "5d4x10" (in gold pieces)');

export const backgroundSchema = z.strictObject({
  ...entryBase,
  effects: z.array(effectSchema),
  characteristics: characteristicsSchema.optional(),
  startingEquipment: startingEquipmentSchema.optional(),
});

export type Race = z.infer<typeof raceSchema>;
export type Background = z.infer<typeof backgroundSchema>;
export type Class = z.infer<typeof classSchema>;
export type Subclass = z.infer<typeof subclassSchema>;
export type Subrace = z.infer<typeof subraceSchema>;
export type Feat = z.infer<typeof featSchema>;
export type Language = z.infer<typeof languageSchema>;
export type ClassStartingEquipment = NonNullable<Class["startingEquipment"]>;

/** Collections whose format exists so far. The others are named in vocabulary.ts and arrive with later steps. */
export const COLLECTION_SCHEMAS = {
  races: raceSchema,
  subraces: subraceSchema,
  classes: classSchema,
  subclasses: subclassSchema,
  backgrounds: backgroundSchema,
  feats: featSchema,
  items: itemSchema,
  spells: spellSchema,
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
      if (effect.type === "spell") resolves(effect.id, "spells", at);
      if (effect.type === "expanded-spells") effect.ids.forEach((s, j) => resolves(s, "spells", `${at}.ids[${j}]`));
      if ((effect.type === "proficiency" || effect.type === "expertise") && effect.kind === "skill" && !isSkill(effect.id)) {
        errors.push(`${at}: no skill "${effect.id}".`);
      }
      if (effect.type === "resource" && typeof effect.uses === "object" && ("column" in effect.uses || "perLevel" in effect.uses)) {
        if (!columns) errors.push(`${at}.uses: only classes and subclasses have levels and table columns to count from.`);
        else if ("column" in effect.uses && !columns.has(effect.uses.column)) errors.push(`${at}.uses: no column "${effect.uses.column}" in the class table.`);
      }
      if (effect.type !== "choice") return;
      const from = effect.from;
      if (typeof effect.pick === "object") {
        if (!columns) errors.push(`${at}.pick: only classes and subclasses have table columns to count from.`);
        else if (!columns.has(effect.pick.column)) errors.push(`${at}.pick: no column "${effect.pick.column}" in the class table.`);
      }
      if ("collection" in from && from.known && from.collection !== "spells") errors.push(`${at}.from.known: only choices of spells count among the spells known.`);
      if ("collection" in from && from.spellbook && from.collection !== "spells") errors.push(`${at}.from.spellbook: only choices of spells come from a spellbook.`);
      if ((effect.note || effect.always) && !("collection" in from && from.collection === "spells")) errors.push(`${at}: only choices of spells have a note or are always prepared.`);
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
      } else if (effect.ability && !("collection" in from && from.collection === "spells")) {
        errors.push(`${at}.ability: only choices of spells say which ability they are cast with.`);
      } else if (effect.each) {
        errors.push(`${at}.each: only choices from a fixed list or from your proficiencies use "each"; ${"options" in from ? "options carry their own effects" : "picks from a collection are granted"}.`);
      }
      if ("options" in from) {
        const seen = new Set<string>();
        from.options.forEach((o, j) => {
          if (seen.has(o.id)) errors.push(`${at}.from.options[${j}]: the id "${o.id}" is used twice.`);
          seen.add(o.id);
          if (o.requires?.spell) resolves(o.requires.spell, "spells", `${at}.from.options[${j}].requires.spell`);
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
        if (e.type !== "choice" && e.type !== "ability-score-improvement") return;
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

  /** Starting equipment: its items resolve, and its choices' ids (which name choice keys) are unique. */
  const checkKit = (kit: StartingEquipment | undefined, where: string) => {
    if (!kit) return;
    const lines = (list: EquipmentLine[], at: string) =>
      list.forEach((line, i) => {
        if ("item" in line) resolves(line.item, "items", `${at}[${i}].item`);
      });
    lines(kit.items ?? [], `${where}.items`);
    const seen = new Set<string>();
    kit.choices?.forEach((c, i) => {
      if (seen.has(c.id)) errors.push(`${where}.choices[${i}]: the id "${c.id}" is used twice.`);
      if (c.id === "items") errors.push(`${where}.choices[${i}]: the choice id "items" is kept for the fixed items' picks.`);
      seen.add(c.id);
      const ids = new Set<string>();
      c.options.forEach((o, j) => {
        if (ids.has(o.id)) errors.push(`${where}.choices[${i}].options[${j}]: the id "${o.id}" is used twice.`);
        ids.add(o.id);
        lines(o.items, `${where}.choices[${i}].options[${j}].items`);
      });
    });
  };

  const items = (pack.collections.items ?? []) as Item[];
  items.forEach((item, i) => {
    const at = `collections.items[${i}]`;
    item.contents?.forEach((c, j) => resolves(c.item, "items", `${at}.contents[${j}].item`));
    if (item.weapon && item.armor) errors.push(`${at}: an item is a weapon or armour, not both.`);
  });

  const races = (pack.collections.races ?? []) as Race[];
  const subraces = (pack.collections.subraces ?? []) as Subrace[];
  const classes = (pack.collections.classes ?? []) as Class[];
  const subclasses = (pack.collections.subclasses ?? []) as Subclass[];
  const backgrounds = (pack.collections.backgrounds ?? []) as Background[];
  backgrounds.forEach((bg, i) => {
    checkEffects(bg.effects, `collections.backgrounds[${i}].effects`);
    checkKit(bg.startingEquipment, `collections.backgrounds[${i}].startingEquipment`);
  });
  races.forEach((race, i) => checkEffects(race.effects, `collections.races[${i}].effects`));
  ((pack.collections.feats ?? []) as Feat[]).forEach((feat, i) => checkEffects(feat.effects, `collections.feats[${i}].effects`));
  subraces.forEach((sub, i) => {
    resolves(sub.race, "races", `collections.subraces[${i}].race`);
    checkEffects(sub.effects, `collections.subraces[${i}].effects`);
  });
  const columnIds = (entry: { columns?: { id: string }[] }) => new Set((entry.columns ?? []).map((c) => c.id));
  classes.forEach((cls, i) => {
    const at = `collections.classes[${i}]`;
    checkLeveled(cls, at, columnIds(cls), [[cls.proficiencies, `${at}.proficiencies`], [cls.multiclass.proficiencies, `${at}.multiclass.proficiencies`]]);
    checkKit(cls.startingEquipment, `${at}.startingEquipment`);
    const sc = cls.spellcasting;
    if (sc) {
      const cols = columnIds(cls);
      for (const [what, col] of [["cantrips", sc.cantrips], ["known", sc.known], ...Object.entries(sc.slots).map(([l, c]) => [`slots.${l}`, c])] as [string, string | undefined][]) {
        if (col && !cols.has(col)) errors.push(`${at}.spellcasting.${what}: no column "${col}" in the class table.`);
      }
      if ((sc.kind === "known" || sc.kind === "pact") && !sc.known) errors.push(`${at}.spellcasting: a ${sc.kind} caster needs "known", the column of spells known.`);
      if ((sc.kind === "prepared" || sc.kind === "spellbook") && !sc.prepare) errors.push(`${at}.spellcasting: a ${sc.kind} caster needs "prepare" ("level" or "half-level").`);
      if ((sc.kind === "spellbook") !== Boolean(sc.spellbook)) errors.push(`${at}.spellcasting: "spellbook" goes with the kind "spellbook", and only with it.`);
      if (sc.progression !== undefined && (sc.kind === "pact") !== (sc.progression === "pact")) {
        errors.push(`${at}.spellcasting.progression: "pact" goes with the kind "pact", and only with it.`);
      }
    }
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
