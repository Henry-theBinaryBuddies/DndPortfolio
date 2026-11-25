// Sample characters: complete SRD 5.1 builds, saved as Anvil character files and exported for Tome & Tile with the
// real exporter. They go in adventurer-anvil/samples/. A character with anything left to do or a rule problem isn't
// written. A test (samples.test.ts) checks the saved exports still match what the exporter makes now.
//
// Run from adventurer-anvil/frontend: npm run samples          (writes the files)
//                                     npm run samples -- --todo (lists what each character still needs)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContentIndex, newCharacterDocument, readPack, setChoice, viewCharacter, type CharacterDocument, type ChoiceValue, type ContentIndex } from "../frontend/src/core";
import { dnd5e2014 } from "../frontend/src/systems/dnd5e-2014";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SAMPLES_DIR = join(ROOT, "samples");
/** A fixed time, so the files don't change each time they're made. */
const AT = "2026-11-24T12:00:00.000Z";

const standard = (scores: Record<string, number>) => ({ "abilities.method": "standard-array", "abilities.standard-array": scores });
const acolyte = (languages: [string, string]) => ({
  background: "srd-5.1:acolyte", "background.srd-5.1:acolyte.languages": languages.map((l) => `srd-5.1:${l}`), "equipment.method": "packages",
  "equipment.background.srd-5.1:acolyte.items.0": "srd-5.1:amulet", "equipment.background.srd-5.1:acolyte.prayer-book-or-prayer-wheel": "a",
});
const F = "equipment.class.srd-5.1:";

export interface Sample {
  id: string;
  file: string;
  name: string;
  choices: Record<string, ChoiceValue>;
}

export const SAMPLES: Sample[] = [
  {
    id: "7b1f0c0e-0001-4000-8000-000000000001", file: "aldric-thorne-fighter-3", name: "Aldric Thorne",
    choices: {
      race: "srd-5.1:human", "race.srd-5.1:human.language": "srd-5.1:dwarvish",
      ...standard({ str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }),
      "class.class": "srd-5.1:fighter", "class.level": 3,
      "class.srd-5.1:fighter.skills": ["athletics", "perception"], "class.srd-5.1:fighter.fighting-style": "defense",
      "class.srd-5.1:fighter.subclass": "srd-5.1:champion",
      ...acolyte(["elvish", "halfling"]),
      [`${F}fighter.chain-mail-or-leather-armor`]: "a", [`${F}fighter.martial-weapons-and-shield-or-martial-weapons`]: "a",
      [`${F}fighter.crossbow-light-or-handaxe`]: "a", [`${F}fighter.dungeoneers-pack-or-explorers-pack`]: "b",
      [`${F}fighter.martial-weapons-and-shield-or-martial-weapons.a.0`]: "srd-5.1:longsword",
      "equipment.armor": "srd-5.1:chain-mail", "equipment.shield": "shield",
      "details.alignment": "lawful-good", "details.age": "29",
      "background.traits": "I stand between danger and anyone who can't stand alone.",
      "details.backstory": "A temple guard who left the gate to follow a pilgrim road.",
    },
  },
  {
    id: "7b1f0c0e-0002-4000-8000-000000000002", file: "seraphine-vael-wizard-3", name: "Seraphine Vael",
    choices: {
      race: "srd-5.1:elf", "race.srd-5.1:elf.subrace": "srd-5.1:high-elf", "race.srd-5.1:high-elf.language": "srd-5.1:draconic",
      "race.srd-5.1:high-elf.cantrip": "srd-5.1:prestidigitation",
      ...standard({ str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }),
      "class.class": "srd-5.1:wizard", "class.level": 3,
      "class.srd-5.1:wizard.skills": ["arcana", "investigation"], "class.srd-5.1:wizard.subclass": "srd-5.1:evocation",
      ...acolyte(["dwarvish", "giant"]),
      [`${F}wizard.quarterstaff-or-dagger`]: "a", [`${F}wizard.component-pouch-or-arcane-foci`]: "a", [`${F}wizard.scholars-pack-or-explorers-pack`]: "a",
      "spells.srd-5.1:wizard.cantrips": ["srd-5.1:fire-bolt", "srd-5.1:light", "srd-5.1:mage-hand"],
      "spells.srd-5.1:wizard.spellbook": ["srd-5.1:magic-missile", "srd-5.1:shield", "srd-5.1:burning-hands", "srd-5.1:sleep", "srd-5.1:detect-magic", "srd-5.1:mage-armor", "srd-5.1:scorching-ray", "srd-5.1:misty-step", "srd-5.1:thunderwave", "srd-5.1:comprehend-languages"],
      "spells.srd-5.1:wizard.prepared": ["srd-5.1:magic-missile", "srd-5.1:shield", "srd-5.1:burning-hands", "srd-5.1:scorching-ray", "srd-5.1:misty-step"],
      "details.alignment": "neutral-good", "details.age": "140",
      "background.traits": "I collect the true names of small fires.",
      "details.backstory": "Raised in a temple library, she learned magic from its oldest books.",
    },
  },
  {
    id: "7b1f0c0e-0003-4000-8000-000000000003", file: "bronna-ironhearth-cleric-3", name: "Bronna Ironhearth",
    choices: {
      race: "srd-5.1:dwarf", "race.srd-5.1:dwarf.subrace": "srd-5.1:hill-dwarf", "race.srd-5.1:dwarf.tools": "masons-tools",
      ...standard({ str: 14, dex: 10, con: 13, int: 8, wis: 15, cha: 12 }),
      "class.class": "srd-5.1:cleric", "class.level": 3,
      "class.srd-5.1:cleric.skills": ["medicine", "persuasion"], "class.srd-5.1:cleric.subclass": "srd-5.1:life",
      ...acolyte(["elvish", "giant"]),
      [`${F}cleric.items.1`]: "srd-5.1:emblem", [`${F}cleric.mace-or-warhammer`]: "a", [`${F}cleric.scale-mail-or-leather-armor-or-chain-mail`]: "c",
      [`${F}cleric.crossbow-light-or-simple-weapons`]: "a", [`${F}cleric.priests-pack-or-explorers-pack`]: "a",
      "equipment.armor": "srd-5.1:chain-mail", "equipment.shield": "shield",
      "spells.srd-5.1:cleric.cantrips": ["srd-5.1:sacred-flame", "srd-5.1:guidance", "srd-5.1:light"],
      "spells.srd-5.1:cleric.prepared": ["srd-5.1:healing-word", "srd-5.1:shield-of-faith", "srd-5.1:sanctuary", "srd-5.1:aid", "srd-5.1:guiding-bolt"],
      "details.alignment": "lawful-good", "details.age": "96",
      "background.traits": "Nobody leaves my table hungry or my care hurt.",
      "details.backstory": "A forge-priest who carries her clan's hearth-blessing on the road.",
    },
  },
  {
    id: "7b1f0c0e-0004-4000-8000-000000000004", file: "pip-underbough-rogue-3", name: "Pip Underbough",
    choices: {
      race: "srd-5.1:halfling", "race.srd-5.1:halfling.subrace": "srd-5.1:lightfoot-halfling",
      ...standard({ str: 8, dex: 15, con: 14, int: 13, wis: 12, cha: 10 }),
      "class.class": "srd-5.1:rogue", "class.level": 3,
      "class.srd-5.1:rogue.skills": ["stealth", "acrobatics", "sleight-of-hand", "perception"],
      "class.srd-5.1:rogue.expertise-1": ["skill:stealth", "tool:thieves-tools"],
      "class.srd-5.1:rogue.subclass": "srd-5.1:thief",
      ...acolyte(["dwarvish", "elvish"]),
      [`${F}rogue.rapier-or-shortsword`]: "a", [`${F}rogue.shortbow-or-shortsword`]: "a", [`${F}rogue.burglars-pack-or-dungeoneers-pack-or-explorers-pack`]: "a",
      "equipment.armor": "srd-5.1:leather-armor",
      "details.alignment": "chaotic-good", "details.age": "31",
      "background.traits": "I give back half of what I take, to someone who needs it more.",
      "details.backstory": "A temple's errand runner who learned that locks are only suggestions.",
    },
  },
  {
    id: "7b1f0c0e-0005-4000-8000-000000000005", file: "kael-wren-ranger-3", name: "Kael Wren",
    choices: {
      race: "srd-5.1:half-elf", "race.srd-5.1:half-elf.abilities": ["dex", "wis"], "race.srd-5.1:half-elf.skills": ["survival", "nature"], "race.srd-5.1:half-elf.language": "srd-5.1:sylvan",
      ...standard({ str: 12, dex: 15, con: 14, int: 8, wis: 13, cha: 10 }),
      "class.class": "srd-5.1:ranger", "class.level": 3,
      "class.srd-5.1:ranger.skills": ["stealth", "perception", "athletics"],
      "class.srd-5.1:ranger.fighting-style": "archery", "class.srd-5.1:ranger.subclass": "srd-5.1:hunter",
      "class.srd-5.1:ranger.favored-enemy-1-type": "beasts", "class.srd-5.1:ranger.natural-explorer-1-terrain-type": "forest",
      "class.srd-5.1:hunter.hunters-prey": "colossus-slayer",
      ...acolyte(["dwarvish", "orc"]),
      [`${F}ranger.scale-mail-or-leather-armor`]: "b", [`${F}ranger.shortsword-or-simple-melee-weapons`]: "a", [`${F}ranger.dungeoneers-pack-or-explorers-pack`]: "b",
      "equipment.armor": "srd-5.1:leather-armor",
      "spells.srd-5.1:ranger.known": ["srd-5.1:hunters-mark", "srd-5.1:cure-wounds", "srd-5.1:fog-cloud"],
      "details.alignment": "neutral-good", "details.age": "34",
      "background.traits": "I'd rather sleep under trees than under a roof.",
      "details.backstory": "A shrine-keeper's child who tracks what threatens the old forest roads.",
    },
  },
  {
    id: "7b1f0c0e-0006-4000-8000-000000000006", file: "mordecai-ash-warlock-3", name: "Mordecai Ash",
    choices: {
      race: "srd-5.1:tiefling",
      ...standard({ str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 }),
      "class.class": "srd-5.1:warlock", "class.level": 3,
      "class.srd-5.1:warlock.skills": ["deception", "arcana"], "class.srd-5.1:warlock.subclass": "srd-5.1:fiend",
      "class.srd-5.1:warlock.eldritch-invocations": ["agonizing-blast", "armor-of-shadows"], "class.srd-5.1:warlock.pact-boon": "tome",
      ...acolyte(["dwarvish", "elvish"]),
      [`${F}warlock.items.2`]: "srd-5.1:dagger", [`${F}warlock.crossbow-light-or-simple-weapons`]: "a", [`${F}warlock.component-pouch-or-arcane-foci`]: "a",
      [`${F}warlock.scholars-pack-or-dungeoneers-pack`]: "a", "equipment.armor": "srd-5.1:leather-armor",
      "spells.srd-5.1:warlock.cantrips": ["srd-5.1:eldritch-blast", "srd-5.1:minor-illusion"],
      "spells.srd-5.1:warlock.known": ["srd-5.1:charm-person", "srd-5.1:burning-hands", "srd-5.1:hold-person", "srd-5.1:scorching-ray"],
      "details.alignment": "chaotic-neutral", "details.age": "26",
      "background.traits": "I always read the small print, especially on contracts.",
      "details.backstory": "A temple scribe who signed the wrong page of a very old book.",
    },
  },
  {
    id: "7b1f0c0e-0007-4000-8000-000000000007", file: "borin-stonehelm-fighter-4-wizard-1", name: "Borin Stonehelm",
    choices: {
      race: "srd-5.1:dwarf", "race.srd-5.1:dwarf.subrace": "srd-5.1:hill-dwarf", "race.srd-5.1:dwarf.tools": "smiths-tools",
      ...standard({ str: 15, dex: 12, con: 14, int: 13, wis: 10, cha: 8 }),
      "class.class": "srd-5.1:fighter", "class.level": 5, "class.multi": { "srd-5.1:wizard": 1 },
      "class.srd-5.1:fighter.skills": ["athletics", "perception"], "class.srd-5.1:fighter.fighting-style": "defense",
      "class.srd-5.1:fighter.subclass": "srd-5.1:champion", "class.srd-5.1:fighter.asi-4": { str: 2 },
      ...acolyte(["elvish", "giant"]),
      [`${F}fighter.chain-mail-or-leather-armor`]: "a", [`${F}fighter.martial-weapons-and-shield-or-martial-weapons`]: "a",
      [`${F}fighter.crossbow-light-or-handaxe`]: "a", [`${F}fighter.dungeoneers-pack-or-explorers-pack`]: "b",
      [`${F}fighter.martial-weapons-and-shield-or-martial-weapons.a.0`]: "srd-5.1:warhammer",
      "equipment.armor": "srd-5.1:chain-mail", "equipment.shield": "shield",
      "spells.srd-5.1:wizard.cantrips": ["srd-5.1:fire-bolt", "srd-5.1:light", "srd-5.1:mage-hand"],
      "spells.srd-5.1:wizard.spellbook": ["srd-5.1:magic-missile", "srd-5.1:shield", "srd-5.1:sleep", "srd-5.1:detect-magic", "srd-5.1:burning-hands", "srd-5.1:thunderwave"],
      "spells.srd-5.1:wizard.prepared": ["srd-5.1:magic-missile", "srd-5.1:shield"],
      "details.alignment": "lawful-good", "details.age": "87",
      "background.traits": "I quote old sagas at every meal.",
      "details.backstory": "Grew up in the Iron Hills, then left to see what lies past the mountains.",
    },
  },
];

export function sampleContent(): ContentIndex {
  const file = JSON.parse(readFileSync(join(ROOT, "frontend/public/packs/srd-5.1.pack.json"), "utf8"));
  const pack = readPack(file, dnd5e2014, []);
  if (!pack.ok) throw new Error(pack.errors.join("\n"));
  return createContentIndex([pack.pack]);
}

export function sampleDoc(s: Sample, content: ContentIndex): CharacterDocument {
  let doc = newCharacterDocument({ id: s.id, system: { id: dnd5e2014.id, version: dnd5e2014.version }, packs: content.packs().map((p) => ({ id: p.id, version: p.version })), now: AT });
  doc = { ...doc, name: s.name };
  for (const [k, v] of Object.entries(s.choices)) doc = setChoice(doc, k, v, AT);
  return { ...doc, updatedAt: AT };
}

/** What a character still needs: unanswered required choices (with their options) and rule problems not allowed. */
export function todo(doc: CharacterDocument, content: ContentIndex): string[] {
  const view = viewCharacter(dnd5e2014, doc, content);
  const out: string[] = [];
  for (const step of view.steps) {
    for (const c of step.choices) {
      const empty = c.options !== undefined && c.options.length === 0;
      if (c.required && !(c.answered ?? doc.choices[c.key] !== undefined) && !empty) {
        out.push(`${step.label}: ${c.label} [${c.key}]${c.count ? ` pick ${c.count.max}` : ""}: ${(c.options ?? []).filter((o) => !o.unavailable).slice(0, 12).map((o) => String(o.value)).join(", ")}`);
      }
    }
  }
  for (const i of view.issues) if (i.severity === "error" && !i.override) out.push(`Problem (${i.step}): ${i.message}`);
  return out;
}

/** The export of one sample, as the exporter makes it now. */
export function sampleExport(s: Sample, content: ContentIndex) {
  return dnd5e2014.exporters![0].build(sampleDoc(s, content), content);
}

function main() {
  const content = sampleContent();
  const listOnly = process.argv.includes("--todo");
  let bad = 0;
  for (const s of SAMPLES) {
    const doc = sampleDoc(s, content);
    const left = todo(doc, content);
    if (left.length) {
      bad++;
      console.log(`\n${s.name} still needs:\n  ${left.join("\n  ")}`);
      continue;
    }
    if (listOnly) {
      console.log(`${s.name}: complete.`);
      continue;
    }
    const out = sampleExport(s, content);
    mkdirSync(join(SAMPLES_DIR, "characters"), { recursive: true });
    mkdirSync(join(SAMPLES_DIR, "tomeandtile"), { recursive: true });
    writeFileSync(join(SAMPLES_DIR, "characters", `${s.file}.anvil.json`), `${JSON.stringify(doc, null, 2)}\n`);
    writeFileSync(join(SAMPLES_DIR, "tomeandtile", `${s.file}.creature.json`), out.text);
    console.log(`Wrote ${s.file}`);
  }
  if (bad) {
    console.error(`\n${bad} character${bad > 1 ? "s" : ""} not complete: nothing written for ${bad > 1 ? "them" : "it"}.`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
