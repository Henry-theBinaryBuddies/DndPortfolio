// The 2014 system module: the pipeline from step 5 (sources → expand → tally → derive → check), assembled
// into the SystemModule the core expects.
import type { CharacterBlurb, CharacterDocument, ContentIndex, Evaluation, LevelUp, SheetPage, SystemModule } from "../../core";
import { check, stepReports, unusedChoices } from "./engine/check";
import { newContext } from "./engine/context";
import { derive } from "./engine/derive";
import { packSchema, SYSTEM_ID } from "./packFormat";
import { abilitiesStep } from "./steps/abilities";
import { backgroundStep } from "./steps/background";
import { CLASS_KEY, checkMulticlass, classStep, LEVEL_KEY, levelOf, MAX_LEVEL, storedOtherLevels } from "./steps/class";
import { checkEquipment, equipmentStep } from "./steps/equipment";
import { spellsStep } from "./steps/spells";
import { ALIGNMENT_KEY, detailsStep, goodPortrait, PORTRAIT_KEY } from "./steps/details";
import { BACKGROUND_KEY } from "./steps/background";
import { replaceDuplicateSkills } from "./engine/duplicates";
import { RACE_KEY, raceStep } from "./steps/race";
import { rulesStep } from "./steps/rules";
import { makeTomeAndTileExporter } from "./export/tomeandtile";
import { picksOf } from "./engine/context";

export function evaluate(doc: CharacterDocument, content: ContentIndex): Evaluation {
  const { ctx, derived, lists } = runPipeline(doc, content);
  return { steps: stepReports(ctx), derived, lists, issues: ctx.issues, unused: unusedChoices(ctx) };
}

/** The whole pipeline, keeping its working state: for exporters, which need more than the evaluation shows. */
export function runPipeline(doc: CharacterDocument, content: ContentIndex) {
  const ctx = newContext(doc, content);
  // ① + ② Each step collects its sources and expands their effects into the tally (③). The rules come first.
  rulesStep(ctx);
  raceStep(ctx);
  const base = abilitiesStep(ctx);
  classStep(ctx);
  backgroundStep(ctx);
  equipmentStep(ctx);
  spellsStep(ctx, base);
  detailsStep(ctx);
  // Any skill given twice by fixed effects is swapped for another of the character's choice.
  replaceDuplicateSkills(ctx);
  // ④
  // Items by local id, for proficiency names: the first loaded pack that has the id names it.
  const items = new Map<string, string>();
  for (const e of content.list("items")) if (!items.has(e.id)) items.set(e.id, e.name);
  const { derived, lists, scores } = derive(ctx.tally, base, (id) => items.get(id), { encumbrance: ctx.rules.encumbrance });
  // ⑤
  check(ctx, scores);
  checkMulticlass(ctx, scores);
  checkEquipment(ctx, scores);
  return { ctx, base, derived, lists, scores };
}

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;

const ABILITY_NAMES_SHORT = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" } as const;
const COIN_BOXES = [
  { key: "coins.cp", label: "CP" }, { key: "coins.sp", label: "SP" }, { key: "coins.ep", label: "EP" }, { key: "coins.gp", label: "GP" }, { key: "coins.pp", label: "PP" },
];
const SPELL_LEVELS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/**
 * The character sheet, laid out like the classic three-column paper sheet (our own lettering and boxes, not its
 * artwork): page 1 the character and its numbers, with boxes to fill in by hand at the table; page 2 everything
 * carried, and the money; page 3 the story; page 4 the spells, for spellcasters only.
 */
export const SHEET: SheetPage[] = [
  {
    label: "Character",
    header: [
      {
        kind: "identity", label: "Character", banner: true,
        fields: [
          { derived: "class-levels", label: "Class and level" }, { choice: BACKGROUND_KEY, label: "Background" }, { blank: "Player name" },
          { choice: RACE_KEY, label: "Race" }, { choice: ALIGNMENT_KEY, label: "Alignment" }, { blank: "Experience points" },
        ],
      },
    ],
    columns: [
      [
        {
          kind: "split", label: "Abilities, saving throws and skills",
          columns: [
            [{ kind: "tiles", label: "Ability scores", tall: true, items: ABILITY_KEYS.map((a) => ({ key: `ability.${a}`, short: ABILITY_NAMES_SHORT[a], note: `ability.${a}.mod` })) }],
            [
              { kind: "ticks", label: "Inspiration", rows: [{ label: "Inspiration", count: 1 }] },
              { kind: "stats", label: "Proficiency bonus", inline: true, items: [{ key: "proficiency-bonus", label: "Proficiency bonus", format: "signed" }] },
              { kind: "checklist", label: "Saving throws", items: ABILITY_KEYS.map((a) => ({ key: `save.${a}` })), unmarked: "Not proficient", trim: " saving throw" },
              { kind: "checklist", label: "Skills", items: [], prefix: { key: "skill." }, unmarked: "Not proficient" },
            ],
          ],
        },
        { kind: "stats", label: "Passive Perception", inline: true, items: [{ key: "passive.perception", label: "Passive Wisdom (Perception)" }] },
        { kind: "list", label: "Armour, weapons and tools", list: "other-proficiencies", inline: true },
        { kind: "list", label: "Languages", list: "languages", inline: true },
      ],
      [
        {
          kind: "stats", label: "Combat",
          items: [{ key: "ac", label: "Armor Class", shape: "shield" }, { key: "initiative", label: "Initiative", format: "signed" }, { key: "speed.walk", label: "Speed", format: "feet" }],
        },
        { kind: "blanks", label: "Hit points", items: [{ label: "Current hit points", above: { key: "hp", label: "Hit point maximum" } }, { label: "Temporary hit points" }] },
        { kind: "blanks", label: "Hit dice", items: [{ label: "Hit dice", above: { key: "hit-dice", label: "Total" } }] },
        { kind: "ticks", label: "Death saves", rows: [{ label: "Successes", count: 3 }, { label: "Failures", count: 3 }] },
        { kind: "rows", label: "Attacks", items: [], prefix: { key: "attack." }, table: { columns: ["Name", "Attack bonus", "Damage and type"], separator: " to hit, " } },
        { kind: "stats", label: "Money", small: true, blankZero: true, items: COIN_BOXES },
        { kind: "stats", label: "Weight", inline: true, items: [{ key: "weight", label: "Total weight", format: "pounds" }] },
      ],
      [
        { kind: "text", label: "Personality", boxes: true, keys: ["background.traits", "background.ideal", "background.bond", "background.flaw"] },
        { kind: "list", label: "Limited uses", list: "resources", ticks: true },
        { kind: "list", label: "Features and traits", list: "features", full: true },
      ],
    ],
  },
  {
    label: "Equipment and money",
    sections: [
      {
        kind: "ledger", label: "Equipment", list: "inventory", columns: ["Qty", "Item", "lb"], sideAcross: true, split: 2, lines: 34,
        checks: [{ flag: "equipped", short: "E", name: "Equipped" }, { flag: "attuned", short: "A", name: "Attuned" }],
        side: [
          ...COIN_BOXES, { key: "weight", label: "Total weight", format: "pounds" },
          { key: "carrying-capacity", label: "Carrying capacity", format: "pounds" }, { key: "attunement", label: "Attuned" },
        ],
      },
      { kind: "blanks", label: "Treasure and notes", items: [{ label: "Treasure and notes", large: true }] },
    ],
  },
  {
    label: "Story",
    columns: [
      [
        { kind: "portrait", label: "Portrait" },
        { kind: "text", label: "Appearance", keys: ["details.age", "details.height", "details.weight", "details.eyes", "details.skin", "details.hair"] },
      ],
      [{ kind: "text", label: "Story", boxes: true, keys: ["details.backstory", "details.allies", "details.notes"] }],
      [
        { kind: "list", label: "Feats", list: "feats" },
        { kind: "list", label: "Senses", list: "senses" },
        { kind: "list", label: "Resistances", list: "resistances" },
      ],
    ],
    sections: [{ kind: "records", label: "Session journal", key: "details.journal", newestFirst: true, print: "full-only" }],
  },
  {
    label: "Spells",
    onlyWithList: "spell-list",
    sections: [
      { kind: "rows", label: "Spellcasting", items: [], prefix: { key: "spell." } },
      {
        kind: "list", label: "Spells", list: "spell-list", full: true, flow: "columns",
        groupTicks: Object.fromEntries(SPELL_LEVELS.map((l, i) => [`${l} level`, `spell-slots.${i + 1}`])),
      },
    ],
  },
];

export const dnd5e2014: SystemModule = {
  id: SYSTEM_ID,
  version: 1,
  title: "D&D 5e (2014 rules)",
  packSchema,
  summary: [
    {
      kind: "tiles",
      label: "Ability scores",
      items: [
        { key: "ability.str", short: "Str" }, { key: "ability.dex", short: "Dex" }, { key: "ability.con", short: "Con" },
        { key: "ability.int", short: "Int" }, { key: "ability.wis", short: "Wis" }, { key: "ability.cha", short: "Cha" },
      ],
    },
    {
      kind: "rows",
      label: "At a glance",
      items: [
        { key: "hp" }, { key: "ac" }, { key: "hit-dice" }, { key: "speed.walk", format: "feet" }, { key: "initiative", format: "signed" },
        { key: "passive.perception" }, { key: "proficiency-bonus", format: "signed" },
        { key: "coins", format: "coins" }, { key: "weight", format: "pounds" },
      ],
    },
    { kind: "rows", label: "Attacks", items: [], prefix: { key: "attack." } },
    { kind: "rows", label: "Spellcasting", items: [], prefix: { key: "spell." } },
    { kind: "list", label: "Saving throws", list: "saving-throws" },
    { kind: "list", label: "Skills", list: "skills" },
    { kind: "list", label: "Armour, weapons and tools", list: "other-proficiencies" },
    { kind: "list", label: "Senses", list: "senses" },
    { kind: "list", label: "Languages", list: "languages" },
    { kind: "list", label: "Resistances", list: "resistances" },
    { kind: "list", label: "Feats", list: "feats" },
    { kind: "list", label: "Cantrips", list: "cantrips" },
    { kind: "list", label: "Spells", list: "spells" },
  ],
  sheet: SHEET,
  exporters: [makeTomeAndTileExporter((doc, content) => runPipeline(doc, content), (doc, content) => describe(doc, content))],
  stepLists: {
    class: [{ label: "What you get", list: "gains.class" }],
    background: [{ label: "What you get", list: "gains.background" }],
    equipment: [{ label: "Inventory", list: "inventory" }],
    spells: [{ label: "Your spells", list: "spell-list" }],
  },
  initialChoices: () => ({}),
  evaluate,
  migrate: (doc) => doc,
  describe,
  levelUp,
};

/** One more level, given to the first class; the Class step shows where it can be moved to another class. */
export function levelUp(doc: CharacterDocument, content: ContentIndex): LevelUp {
  const classRef = picksOf(doc.choices[CLASS_KEY])[0];
  if (!classRef || !content.get("classes", classRef)) return { ok: false, reason: "Choose a class first." };
  const level = levelOf(doc.choices);
  if (level >= MAX_LEVEL) return { ok: false, reason: `This character is already level ${MAX_LEVEL}, the highest.` };
  return { ok: true, label: `Level up to ${level + 1}`, choices: { [LEVEL_KEY]: level + 1 }, step: "class" };
}

/**
 * "Hill Dwarf Cleric 1", "Human Fighter 4 / Wizard 1" (the subrace or race, then each class and its level; whichever
 * are chosen) and the portrait.
 */
export function describe(doc: CharacterDocument, content: ContentIndex): CharacterBlurb {
  const raceRef = picksOf(doc.choices[RACE_KEY])[0];
  const race = raceRef ? content.get("races", raceRef) : undefined;
  const subRef = raceRef ? picksOf(doc.choices[`race.${raceRef}.subrace`])[0] : undefined;
  const sub = subRef ? content.get("subraces", subRef) : undefined;
  const classRef = picksOf(doc.choices[CLASS_KEY])[0];
  const cls = classRef ? content.get("classes", classRef) : undefined;
  let classes = "";
  if (cls) {
    const others = storedOtherLevels(doc.choices)
      .filter(([r]) => r !== classRef)
      .map(([r, n]) => [content.get("classes", r)?.name, n] as const)
      .filter((x): x is readonly [string, number] => Boolean(x[0]));
    const given = others.reduce((t, [, n]) => t + n, 0);
    classes = [`${cls.name} ${Math.max(1, levelOf(doc.choices) - given)}`, ...others.map(([name, n]) => `${name} ${n}`)].join(" / ");
  }
  const text = [sub?.name ?? race?.name, classes].filter(Boolean).join(" ");
  const picture = goodPortrait(doc.choices[PORTRAIT_KEY]);
  return picture ? { text, picture } : { text };
}
