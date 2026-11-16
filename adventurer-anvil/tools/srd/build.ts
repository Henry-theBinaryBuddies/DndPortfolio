// Turns the 5e-bits SRD 5.1 files into an Adventurer Anvil pack (2014 format). Pure: data in, pack and notes out.
// The script that reads and writes the files is tools/import-srd.ts.
import type { PackFile } from "../../frontend/src/core";
import type { Effect, Language, Race, Subrace } from "../../frontend/src/systems/dnd5e-2014/packFormat";
import type { Ability } from "../../frontend/src/systems/dnd5e-2014/vocabulary";
import { KIT_CORRECTIONS, TEXT_CORRECTIONS } from "../../data/srd-5.1/corrections";
import { buildItems } from "./items";
import { buildSpells } from "./spells";
import { buildBackgrounds } from "./backgrounds";
import { buildClasses, type FeatureNote } from "./classes";
import type { RawLanguage, RawRace, RawSrd, RawSubrace, RawTrait } from "./raw";

export const SRD_ATTRIBUTION =
  "This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and " +
  "available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative " +
  "Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.";

export const PACK_VERSION = "0.5.0";

/** How each trait was brought in, for the import report. */
export type How = "calculated" | "calculated, with text" | "text" | "text for now" | "folded in";
export interface TraitNote {
  trait: string;
  name: string;
  how: How;
  note?: string;
}

export interface BuildResult {
  pack: PackFile;
  traits: TraitNote[];
  features: FeatureNote[];
  corrections: { trait: string; reason: string }[];
}

const SKILL_PREFIX = "skill-";
const feature = (t: RawTrait, text: string): Effect => ({ type: "feature", name: t.name, description: text });
/** "longswords" → "longsword": the SRD equipment ids are singular, and items will use them. */
const singular = (id: string) => id.replace(/s$/, "");

export function buildSrdPack(raw: RawSrd): BuildResult {
  const corrections: BuildResult["corrections"] = [];
  const traitText = new Map<string, string>();
  for (const t of raw.traits) traitText.set(t.index, t.desc.join("\n\n"));
  for (const c of TEXT_CORRECTIONS) {
    const text = traitText.get(c.trait);
    if (!text?.includes(c.wrong)) throw new Error(`Correction for "${c.trait}" no longer matches the source: update corrections.ts.`);
    traitText.set(c.trait, text.replace(c.wrong, c.right));
    corrections.push({ trait: c.trait, reason: c.reason });
  }

  const traitsByIndex = new Map(raw.traits.map((t) => [t.index, t]));
  const notes = new Map<string, TraitNote>();
  const note = (t: RawTrait, how: How, why?: string) => notes.set(t.index, { trait: t.index, name: t.name, how, note: why });

  // Draconic Ancestry: the ten dragon colours give five damage types (and breath shapes), read from the colour traits.
  const ancestries = raw.traits.filter((t) => t.parent?.index === "draconic-ancestry");
  for (const a of ancestries) note(a, "folded in", "Its row is in the Draconic Ancestry table in that trait's text.");
  const ancestryTypes = [...new Set(ancestries.map((a) => a.trait_specific!.damage_type!.index))].sort();
  const ancestryTable = ancestries
    .map((a) => {
      const bw = a.trait_specific!.breath_weapon!;
      const colour = a.name.replace(/^.*\((.*)\)$/, "$1");
      const save = bw.dc?.dc_type.name ?? "";
      return `${colour}: ${a.trait_specific!.damage_type!.name}, ${bw.area_of_effect.size} ft. ${bw.area_of_effect.type} (${save} save)`;
    })
    .join("\n");

  function traitEffects(index: string): Effect[] {
    const t = traitsByIndex.get(index);
    if (!t) throw new Error(`Unknown trait "${index}".`);
    const text = traitText.get(index)!;
    switch (index) {
      case "darkvision": {
        const range = Number(/within (\d+) feet/.exec(text)?.[1]);
        if (!range) throw new Error("Could not read the darkvision range.");
        note(t, "calculated");
        return [{ type: "sense", sense: "darkvision", range }];
      }
      case "dwarven-combat-training":
      case "elf-weapon-training":
        note(t, "calculated");
        return t.proficiencies.map((p) => ({ type: "proficiency", kind: "weapon", id: singular(p.index) }));
      case "keen-senses":
      case "menacing":
        note(t, "calculated");
        return t.proficiencies.map((p) => ({ type: "proficiency", kind: "skill", id: p.index.slice(SKILL_PREFIX.length) }));
      case "skill-versatility":
        note(t, "calculated");
        return [{ type: "choice", id: "skills", label: `${t.name}: two skills of your choice`, pick: t.proficiency_choices!.choose,
          from: { list: "skills" }, each: { type: "proficiency", kind: "skill" } }];
      case "extra-language":
        note(t, "calculated");
        return [{ type: "choice", id: "language", label: "Choose one extra language", pick: t.language_options!.choose, from: { collection: "languages" } }];
      case "high-elf-cantrip":
        note(t, "calculated, with text", "The cantrip is a choice (on the Spells step), cast with Intelligence.");
        return [
          { type: "choice", id: "cantrip", label: "Choose a wizard cantrip", pick: 1, from: { collection: "spells", where: { classes: "wizard", level: 0 } }, ability: "int" },
          feature(t, text),
        ];
      case "hellish-resistance":
        note(t, "calculated");
        return [{ type: "resistance", damage: "fire" }];
      case "dwarven-resilience":
        note(t, "calculated, with text", "Poison resistance is calculated; advantage on saves against poison is described.");
        return [{ type: "resistance", damage: "poison" }, feature(t, text)];
      case "tinker":
        note(t, "calculated, with text", "The tool proficiency is calculated; building clockwork devices is described.");
        return [{ type: "proficiency", kind: "tool", id: t.proficiencies[0].index }, feature(t, text)];
      case "relentless-endurance":
        note(t, "calculated, with text", "Tracked as 1 use per long rest.");
        return [{ type: "resource", id: "relentless-endurance", name: t.name, uses: 1, recharge: "long" }, feature(t, text)];
      case "breath-weapon":
        note(t, "calculated, with text", "Tracked as 1 use per short rest; its damage and DC are described until the sheet calculates them.");
        return [{ type: "resource", id: "breath-weapon", name: t.name, uses: 1, recharge: "short" }, feature(t, text)];
      case "draconic-ancestry":
        note(t, "calculated, with text", "A choice of damage type gives the resistance; the dragon's colour is not stored, only its damage type.");
        return [
          { type: "choice", id: "ancestry", label: "Draconic Ancestry: your dragon's damage type", pick: 1,
            from: { list: "damage-types", only: ancestryTypes }, each: { type: "resistance" } },
          feature(t, `${text}\n\n${ancestryTable}`),
        ];
      case "damage-resistance":
        note(t, "folded in", "The resistance is given by the Draconic Ancestry choice.");
        return [];
      case "tool-proficiency":
        note(t, "calculated, with text", "A choice of one of the three artisan's tools.");
        return [
          { type: "choice", id: "tools", label: "Tool Proficiency: choose artisan's tools", pick: t.proficiency_choices!.choose,
            from: { options: t.proficiency_choices!.from.options.map((o) => ({ id: o.item.index, name: o.item.name, effects: [{ type: "proficiency", kind: "tool", id: o.item.index }] })) } },
          feature(t, text),
        ];
      case "dwarven-toughness":
        note(t, "calculated, with text", "+1 hit point per level.");
        return [{ type: "hit-points", perLevel: 1 }, feature(t, text)];
      case "infernal-legacy":
        note(t, "calculated, with text", "Thaumaturgy, cast with Charisma; Hellish Rebuke (level 3) and Darkness (level 5) wait for levelling up.");
        return [{ type: "spell", id: "thaumaturgy", ability: "cha" }, feature(t, text)];
      default:
        note(t, "text", "Nothing to calculate.");
        return [feature(t, text)];
    }
  }

  const abilityBonuses = (bonuses: RawRace["ability_bonuses"]): Effect[] =>
    bonuses.map((b) => ({ type: "ability-bonus", ability: b.ability_score.index as Ability, amount: b.bonus }));

  const race = (r: RawRace): Race => {
    const effects: Effect[] = [...abilityBonuses(r.ability_bonuses)];
    if (r.ability_bonus_options) {
      const options = r.ability_bonus_options.from.options;
      const amounts = new Set(options.map((o) => o.bonus));
      if (amounts.size !== 1) throw new Error(`${r.name}: ability bonus options of different sizes are not supported.`);
      effects.push({
        type: "choice", id: "abilities", label: `+${options[0].bonus} to ${r.ability_bonus_options.choose === 2 ? "two" : r.ability_bonus_options.choose} abilities of your choice`,
        pick: r.ability_bonus_options.choose,
        from: { list: "abilities", only: options.map((o) => o.ability_score.index) },
        each: { type: "ability-bonus", amount: options[0].bonus },
      });
    }
    effects.push({ type: "speed", walk: r.speed });
    for (const l of r.languages) effects.push({ type: "language", id: l.index });
    if (r.language_options) {
      effects.push({ type: "choice", id: "language", label: "Choose one extra language", pick: r.language_options.choose, from: { collection: "languages" } });
    }
    for (const t of r.traits) effects.push(...traitEffects(t.index));
    return {
      id: r.index,
      name: r.name,
      size: r.size.toLowerCase() as Race["size"],
      description: [`Age. ${r.age}`, `Alignment. ${r.alignment}`, `Size. ${r.size_description}`, `Languages. ${r.language_desc}`].join("\n\n"),
      effects,
    };
  };

  const subrace = (s: RawSubrace): Subrace => ({
    id: s.index,
    name: s.name,
    race: s.race.index,
    summary: s.desc,
    effects: [...abilityBonuses(s.ability_bonuses), ...s.racial_traits.flatMap((t) => traitEffects(t.index))],
  });

  const language = (l: RawLanguage): Language => ({
    id: l.index,
    name: l.name,
    ...(l.script ? { script: l.script } : {}),
    ...(l.type === "Exotic" ? { exotic: true } : {}),
    ...(l.typical_speakers?.length ? { summary: `Typical speakers: ${l.typical_speakers.join(", ")}.` } : {}),
    ...(l.desc ? { description: l.desc } : {}),
  });

  const { classes, subclasses, notes: features } = buildClasses(raw);
  const backgrounds = buildBackgrounds(raw.backgrounds);
  for (const k of KIT_CORRECTIONS) {
    const entry = (k.collection === "classes" ? classes : backgrounds).find((e) => e.id === k.id);
    if (!entry?.startingEquipment) throw new Error(`Kit correction for ${k.collection} "${k.id}": no such entry with equipment. Update corrections.ts.`);
    const fixed = k.fix(entry.startingEquipment);
    if (JSON.stringify(fixed) === JSON.stringify(entry.startingEquipment)) throw new Error(`Kit correction for "${k.id}" changes nothing: the source may be fixed. Update corrections.ts.`);
    entry.startingEquipment = fixed;
    corrections.push({ trait: `${k.id} (equipment)`, reason: k.reason });
  }

  const pack: PackFile = {
    $schema: "../schemas/dnd5e-2014-pack.schema.json",
    format: "adventurer-anvil-pack",
    formatVersion: 1,
    id: "srd-5.1",
    version: PACK_VERSION,
    system: "dnd5e-2014",
    title: "System Reference Document 5.1",
    attribution: SRD_ATTRIBUTION,
    requires: [],
    collections: {
      races: raw.races.map(race),
      subraces: raw.subraces.map(subrace),
      classes,
      subclasses,
      backgrounds,
      items: buildItems(raw.equipment),
      spells: buildSpells(raw.spells),
      languages: raw.languages.map(language),
    },
  };

  const unused = raw.traits.filter((t) => !notes.has(t.index)).map((t) => t.index);
  if (unused.length) throw new Error(`Traits not used by any race or subrace: ${unused.join(", ")}`);
  return { pack, traits: [...notes.values()], features, corrections };
}
