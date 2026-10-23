import type { Action, Monster } from "../types/monster";
import { formatSigned } from "./dice";
import type { JsonObject, JsonValue } from "./foundryJson";
import { normalizeHpFormula, skillFor } from "./foundryMaps";
import type { Size } from "./options";
import { fiveToolsDamageEntries } from "./damageLines";
import { buildSpellcastingBlock } from "./fiveToolsSpells";
import { spellcastingToText } from "./spellcastingText";
import { tagProse } from "./fiveToolsTags";
import { renderAction, segmentsToText } from "./renderAction";

// Exports monsters as a "5etools homebrew" file: a `_meta` block plus a `monster` list, using the
// 5etools inline tags ({@atk mw}, {@hit 6}, {@damage 2d6 + 3}, {@dc 13}, {@recharge 5}). Plutonium
// (Foundry) reads this format. Everything is a pure function.
//
// The shapes follow the real 5etools schema and the SRD monsters in its data files (see
// src/lib/fixtures/5etools-mm). We only write fields that exist there, because the schema forbids unknown ones.

/**
 * The homebrew source our monsters belong to. Importers sort a file as "homebrew" by this id, so it
 * must be unique and must not look like an official book code or a prerelease source.
 */
export const FIVETOOLS_SOURCE = {
  json: "CreatureCauldronHB",
  abbreviation: "CCHB",
  full: "Creature Cauldron Homebrew",
  version: "1.0.0",
  authors: ["The Binary Buddies"],
} as const;

// Re-exported so callers and tests can keep importing it from here.
export { tagProse };

const SIZE_LETTERS: Record<Size, string> = {
  tiny: "T",
  small: "S",
  medium: "M",
  large: "L",
  huge: "H",
  gargantuan: "G",
};

/** Our environment names that 5etools spells differently. Anything missing from both is dropped with a note. */
const ENVIRONMENTS: Record<string, string | null> = {
  arctic: "arctic",
  coast: "coastal",
  desert: "desert",
  forest: "forest",
  grassland: "grassland",
  hill: "hill",
  mountain: "mountain",
  swamp: "swamp",
  underdark: "underdark",
  underwater: "underwater",
  urban: "urban",
  planar: "planar",
  dungeon: null, // 5etools has no dungeon environment
};

const ALIGNMENT_WORDS: Record<string, string> = { lawful: "L", neutral: "N", chaotic: "C", good: "G", evil: "E" };

/**
 * "chaotic evil" becomes ["C","E"], "neutral" ["N"], "unaligned" ["U"], "any alignment" ["A"].
 * Text that doesn't fit (for example "any non-lawful alignment") is kept word for word as a
 * {special} entry, which 5etools displays as written.
 */
export function alignmentLetters(text: string): (string | { special: string })[] {
  const clean = text.trim().toLowerCase();
  if (clean === "unaligned") return ["U"];
  if (clean === "any alignment" || clean === "any") return ["A"];
  const words = clean.split(/\s+/);
  const letters = words.map((w) => ALIGNMENT_WORDS[w]);
  const known = words.length >= 1 && words.length <= 2 && letters.every((l) => l !== undefined);
  return known ? letters : [{ special: text.trim() }];
}

const ATTACK_TAGS: [RegExp, string][] = [
  [/^Melee Weapon Attack: /, "{@atk mw} "],
  [/^Ranged Weapon Attack: /, "{@atk rw} "],
  [/^Melee Spell Attack: /, "{@atk ms} "],
  [/^Ranged Spell Attack: /, "{@atk rs} "],
];

/** Our rendered attack sentence in 5etools form: "{@atk mw} {@hit 14} to hit, ... {@h}19 ({@damage 2d10 + 8}) piercing damage." */
function tagAttack(text: string): string {
  let out = text;
  for (const [pattern, tag] of ATTACK_TAGS) out = out.replace(pattern, tag);
  return tagProse(out.replace("Hit: ", "{@h}"));
}

function recharge(min: number): string {
  return min >= 6 ? " {@recharge}" : ` {@recharge ${min}}`;
}

/** One action as a 5etools {name, entries} object. */
function convertAction(monster: Monster, action: Action): JsonObject {
  switch (action.kind) {
    case "attack":
      return { name: action.name, entries: [tagAttack(segmentsToText(renderAction(action, monster.name)))] };
    case "save": {
      const suffix = action.recharge ? recharge(action.recharge.min) : "";
      return { name: `${action.name}${suffix}`, entries: [tagProse(segmentsToText(renderAction(action, monster.name)))] };
    }
    case "multiattack":
      return { name: action.name, entries: [segmentsToText(renderAction(action, monster.name))] };
    case "text": {
      const suffix = action.recharge ? recharge(action.recharge.min) : "";
      return { name: `${action.name}${suffix}`, entries: [tagProse(action.text)] };
    }
  }
}

function convertMonster(monster: Monster, notes: string[]): JsonObject {
  const out: JsonObject = {
    name: monster.name,
    source: FIVETOOLS_SOURCE.json,
    size: [SIZE_LETTERS[monster.size]],
    type: monster.subtypes.length > 0 ? { type: monster.type, tags: [...monster.subtypes] } : monster.type,
    alignment: alignmentLetters(monster.alignment),
  };

  const ac = monster.armor_class;
  out.ac = [ac.note ? { ac: ac.value, from: [ac.note] } : ac.value];

  const formula = normalizeHpFormula(monster.hit_points.dice);
  out.hp = formula ? { average: monster.hit_points.average, formula } : { special: String(monster.hit_points.average) };

  const speeds = monster.speeds;
  const speed: JsonObject = {};
  for (const mode of ["walk", "burrow", "climb", "fly", "swim"] as const) {
    const feet = speeds[mode];
    if (feet === undefined) continue;
    speed[mode] = mode === "fly" && speeds.hover ? { number: feet, condition: "(hover)" } : feet;
  }
  if (speeds.hover) speed.canHover = true;
  out.speed = Object.keys(speed).length > 0 ? speed : { walk: 0 };

  for (const ability of ["str", "dex", "con", "int", "wis", "cha"] as const) out[ability] = monster.abilities[ability];

  const saves = Object.entries(monster.saves);
  if (saves.length > 0) out.save = Object.fromEntries(saves.map(([ability, bonus]) => [ability, formatSigned(bonus)]));

  const skills: JsonObject = {};
  for (const [name, bonus] of Object.entries(monster.skills)) {
    const skill = skillFor(name);
    if (skill) skills[skill.name.toLowerCase()] = formatSigned(bonus);
    else notes.push(`Left out the skill "${name}": 5etools has no skill with that name.`);
  }
  if (Object.keys(skills).length > 0) out.skill = skills;

  const senses: string[] = [];
  for (const sense of ["blindsight", "darkvision", "tremorsense", "truesight"] as const) {
    const feet = monster.senses[sense];
    if (feet !== undefined) senses.push(`${sense} ${feet} ft.`);
  }
  if (senses.length > 0) out.senses = senses;
  out.passive = monster.senses.passive_perception;

  const text = monster.damage_text;
  if (monster.vulnerabilities.length > 0 || text?.vulnerabilities) out.vulnerable = fiveToolsDamageEntries("vulnerable", monster.vulnerabilities, text?.vulnerabilities) as JsonValue[];
  if (monster.resistances.length > 0 || text?.resistances) out.resist = fiveToolsDamageEntries("resist", monster.resistances, text?.resistances) as JsonValue[];
  if (monster.immunities.length > 0 || text?.immunities) out.immune = fiveToolsDamageEntries("immune", monster.immunities, text?.immunities) as JsonValue[];
  if (monster.condition_immunities.length > 0) out.conditionImmune = monster.condition_immunities.map((c) => c.toLowerCase());

  const languages = monster.languages
    .split(",")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !/^[-–—]$/.test(l));
  if (languages.length > 0) out.languages = languages;

  out.cr = monster.challenge.cr;

  const traits: JsonObject[] = monster.traits.map((t) => ({ name: t.name, entries: [tagProse(t.text)] }));
  if (monster.spellcasting) {
    const block = buildSpellcastingBlock(monster.spellcasting);
    if (block) {
      out.spellcasting = [block];
    } else {
      // There are no spell lists, only text, so keep it as a plain trait: nothing is lost.
      traits.push({ name: "Spellcasting", entries: [tagProse(spellcastingToText(monster.spellcasting))] });
      notes.push("Spellcasting is a plain trait: it has no spell lists, so tools cannot link the spells.");
    }
  }
  if (traits.length > 0) out.trait = traits;

  if (monster.actions.length > 0) out.action = monster.actions.map((a) => convertAction(monster, a));
  if (monster.bonus_actions.length > 0) out.bonus = monster.bonus_actions.map((a) => convertAction(monster, a));
  if (monster.reactions.length > 0) out.reaction = monster.reactions.map((a) => convertAction(monster, a));

  const legendary = monster.legendary_actions;
  if (legendary) {
    out.legendaryActions = legendary.per_round;
    out.legendary = legendary.options.map((o) => ({
      // 5etools writes the cost in the name; a cost of 1 is the default and is not mentioned.
      name: o.cost > 1 ? `${o.name} (Costs ${o.cost} Actions)` : o.name,
      entries: [tagProse(o.text)],
    }));
  }

  const environment: string[] = [];
  for (const env of monster.environments) {
    const mapped = ENVIRONMENTS[env];
    if (mapped) environment.push(mapped);
    else notes.push(`Left out the environment "${env}": 5etools has no environment with that name.`);
  }
  if (environment.length > 0) out.environment = environment;

  return out;
}

export interface FiveToolsExport {
  file: JsonObject;
  notes: string[];
}

/**
 * A homebrew file holding these monsters. `exportedAt` is an ISO time passed in by the caller, so this
 * stays pure. Monsters with the same name would clash in 5etools, so only the first of each name is kept.
 */
export function buildFiveToolsFile(monsters: Monster[], exportedAt: string): FiveToolsExport {
  const notes: string[] = [];
  const seen = new Set<string>();
  const unique = monsters.filter((m) => {
    const key = m.name.toLowerCase();
    if (seen.has(key)) {
      notes.push(`Left out a second monster named "${m.name}": 5etools needs each name once.`);
      return false;
    }
    seen.add(key);
    return true;
  });

  const parsed = Date.parse(exportedAt);
  const seconds = Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  const file: JsonObject = {
    _meta: {
      sources: [{ ...FIVETOOLS_SOURCE, authors: [...FIVETOOLS_SOURCE.authors] }],
      edition: "classic", // 5etools' word for the 2014 rules
      dateAdded: seconds,
      dateLastModified: seconds,
    },
    monster: unique.map((m) => convertMonster(m, notes)),
  };
  // The credit an SRD or A5E monster must carry goes with it, as its fluff (5etools shows it on the monster's Info tab).
  const credits = unique.filter((m) => m.attribution).map((m) => ({ name: m.name, source: FIVETOOLS_SOURCE.json, entries: [m.attribution as string] }));
  if (credits.length > 0) file.monsterFluff = credits;
  return { file, notes: [...new Set(notes)] };
}
