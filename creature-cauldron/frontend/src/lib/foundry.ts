import type { Ability, Monster } from "../types/monster";
import { abilityModifier } from "./dice";
import { escapeHtml } from "./exportCommon";
import type { JsonObject, JsonValue } from "./foundryJson";
import { buildItems } from "./foundryItems";
import {
  SIZE_KEYS,
  SKILLS,
  STATS_STAMP,
  TOKEN_SIZES,
  foundryProficiency,
  normalizeHpFormula,
  parseConditions,
  parseLanguages,
  skillFor,
  splitBonus,
} from "./foundryMaps";
import { ACTOR_SYSTEM_TEMPLATE, PROTOTYPE_TOKEN_TEMPLATE } from "./foundryTemplates";
import { label } from "./options";
import { casterLevel } from "./spellcastingText";

// Builds a Foundry VTT (dnd5e system) NPC actor from a Monster. The result is a plain object to be
// saved as JSON and loaded with "Import Data" on a blank NPC actor. Pure: no browser, no randomness.
//
// The actor starts as a copy of a real SRD monster (foundryTemplates.ts) and we overwrite every field
// our Monster provides. Where we cannot convert something faithfully we add a note instead of guessing.

export interface FoundryExport {
  actor: JsonObject;
  notes: string[];
}

const ABILITY_ORDER: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** Gets (or makes) a child object so we can fill it in. */
function child(parent: JsonObject, key: string): JsonObject {
  const existing = parent[key];
  if (existing !== null && typeof existing === "object" && !Array.isArray(existing)) return existing;
  const made: JsonObject = {};
  parent[key] = made;
  return made;
}

function clone<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Resistances, immunities and vulnerabilities share one shape in Foundry. */
function damageTrait(values: string[]): JsonObject {
  return { value: [...values], bypasses: [], custom: "" };
}

function biographyHtml(monster: Monster): string {
  const parts: string[] = [];
  if (monster.armor_class.note) {
    parts.push(`<p>Armor Class: ${monster.armor_class.value} (${escapeHtml(monster.armor_class.note)})</p>`);
  }
  if (monster.description) parts.push(`<p>${escapeHtml(monster.description)}</p>`);
  if (monster.attribution) parts.push(`<p>${escapeHtml(monster.attribution)}</p>`);
  return parts.join("");
}

export function exportFoundryActor(monster: Monster): FoundryExport {
  const notes: string[] = [];
  const pb = foundryProficiency(monster.challenge.cr_value);
  const mods = Object.fromEntries(ABILITY_ORDER.map((a) => [a, abilityModifier(monster.abilities[a])])) as Record<Ability, number>;
  const system = clone(ACTOR_SYSTEM_TEMPLATE);

  // Abilities and saving throws. Foundry builds a save from "proficient" (0 or 1) plus a flat bonus.
  const abilities = child(system, "abilities");
  for (const a of ABILITY_ORDER) {
    const entry = child(abilities, a);
    entry.value = monster.abilities[a];
    entry.max = null;
    const total = monster.saves[a];
    const bonuses = child(entry, "bonuses");
    bonuses.check = "";
    if (total === undefined) {
      entry.proficient = 0;
      bonuses.save = "";
    } else {
      const { multiplier, flat } = splitBonus(total, mods[a], pb, 1);
      entry.proficient = multiplier;
      bonuses.save = flat === 0 ? "" : String(flat);
    }
  }

  // Skills: all 18 are written, each with a proficiency multiplier (0, 1 or 2) plus a flat bonus.
  const skills = child(system, "skills");
  const known = new Set<string>();
  for (const skill of SKILLS) {
    const entry = child(skills, skill.id);
    const bonuses = child(entry, "bonuses");
    entry.ability = skill.ability;
    bonuses.check = "";
    bonuses.passive = "";
    const total = Object.entries(monster.skills).find(([name]) => skillFor(name)?.id === skill.id)?.[1];
    if (total === undefined) {
      entry.value = 0;
    } else {
      known.add(skill.id);
      const { multiplier, flat } = splitBonus(total, mods[skill.ability], pb, 2);
      entry.value = multiplier;
      bonuses.check = flat === 0 ? "" : String(flat);
    }
  }
  for (const name of Object.keys(monster.skills)) {
    if (!skillFor(name)) notes.push(`Left out the skill "${name}": Foundry has no skill with that name.`);
  }

  // Hit points, armor class, movement and senses.
  const attributes = child(system, "attributes");
  const formula = normalizeHpFormula(monster.hit_points.dice);
  if (formula === "" && monster.hit_points.dice.trim() !== "") {
    notes.push(`Left out the hit point formula "${monster.hit_points.dice}" because it is not plain dice.`);
  }
  attributes.hp = {
    value: monster.hit_points.average,
    max: monster.hit_points.average,
    temp: null,
    tempmax: null,
    formula,
  };
  attributes.ac = { flat: monster.armor_class.value, calc: "natural", formula: "" };
  const speeds = monster.speeds;
  attributes.movement = {
    burrow: speeds.burrow ?? 0,
    climb: speeds.climb ?? 0,
    fly: speeds.fly ?? 0,
    swim: speeds.swim ?? 0,
    walk: speeds.walk ?? 0,
    units: "ft",
    hover: speeds.hover === true,
  };
  // Senses are written in both the long-standing flat form and the newer "ranges" form. The two hold the
  // same numbers, so whichever one the installed system version reads gives the same result.
  const sense = {
    darkvision: monster.senses.darkvision ?? 0,
    blindsight: monster.senses.blindsight ?? 0,
    tremorsense: monster.senses.tremorsense ?? 0,
    truesight: monster.senses.truesight ?? 0,
  };
  attributes.senses = { ...sense, units: "ft", special: "", ranges: { ...sense } };
  attributes.spellcasting = monster.spellcasting?.ability ?? "";

  // Foundry works out passive Perception and the spell save DC itself. Tell the user if ours differ.
  const perception = Object.entries(monster.skills).find(([name]) => skillFor(name)?.id === "prc")?.[1];
  const passive = 10 + (perception ?? mods.wis);
  if (passive !== monster.senses.passive_perception) {
    notes.push(`Foundry will show passive Perception ${passive}; the stat block says ${monster.senses.passive_perception}.`);
  }
  if (monster.spellcasting) {
    const expected = 8 + pb + mods[monster.spellcasting.ability];
    if (expected !== monster.spellcasting.dc) {
      notes.push(`Foundry will use spell save DC ${expected}; the stat block says ${monster.spellcasting.dc}.`);
    }
  }

  // Details and traits.
  const details = child(system, "details");
  const environments = monster.environments.map(label).join(", ");
  details.alignment = monster.alignment;
  details.type = { value: monster.type, subtype: monster.subtypes.join(", "), swarm: "", custom: "" };
  details.cr = monster.challenge.cr_value;
  // Written both as plain text and in the newer "habitat" form, like the senses above.
  details.environment = environments;
  details.habitat = { value: [], custom: environments };
  details.biography = { value: biographyHtml(monster), public: "" };

  // Spell slots and caster level are real fields on the sheet, so they are filled in. The spells themselves
  // stay in the Spellcasting feature as text: see the note below.
  if (monster.spellcasting) {
    const spells = child(system, "spells");
    for (const { level, slots } of monster.spellcasting.slots) {
      if (level >= 1 && level <= 9) spells[`spell${level}`] = { value: slots, override: null };
    }
    const level = casterLevel(monster.spellcasting);
    if (level !== null) details.spellLevel = level;
  }

  const traits = child(system, "traits");
  traits.size = SIZE_KEYS[monster.size] ?? "med";
  traits.di = damageTrait(monster.immunities);
  traits.dr = damageTrait(monster.resistances);
  traits.dv = damageTrait(monster.vulnerabilities);
  traits.ci = parseConditions(monster.condition_immunities);
  traits.languages = parseLanguages(monster.languages);

  // Legendary actions, and the Legendary Resistance counter (shown on the sheet, but not linked to the trait).
  const legendaryActions = monster.legendary_actions?.per_round ?? 0;
  const resistanceMatch = monster.traits
    .map((t) => /^Legendary Resistance \((\d+)\/Day\)/i.exec(t.name))
    .find((m) => m !== null);
  const resistance = resistanceMatch ? Number(resistanceMatch[1]) : 0;
  system.resources = {
    legact: { value: legendaryActions, max: legendaryActions, spent: 0 },
    legres: { value: resistance, max: resistance, spent: 0 },
    lair: { value: false, initiative: null },
  };
  if (resistance > 0) notes.push("Legendary Resistance is text only: use the counter on the sheet by hand.");

  system.source = {
    custom: monster.attribution ?? "Creature Cauldron",
    book: "",
    page: "",
    license: monster.source === "srd" ? "CC-BY-4.0" : "",
    revision: 1,
    rules: "2014",
  };

  // The token that appears on the map.
  const token = clone(PROTOTYPE_TOKEN_TEMPLATE);
  const name = monster.name.trim() === "" ? "Unnamed monster" : monster.name;
  if (name !== monster.name) notes.push('The monster had no name, so it was called "Unnamed monster".');
  const size = TOKEN_SIZES[monster.size] ?? 1;
  token.name = name;
  token.width = size;
  token.height = size;
  token.actorLink = false;
  token.disposition = -1;
  token.displayName = 20;
  token.displayBars = 20;
  token.bar1 = { attribute: "attributes.hp" };
  token.bar2 = { attribute: legendaryActions > 0 ? "resources.legact" : null };
  const sight = child(token, "sight");
  sight.enabled = false;
  sight.range = monster.senses.darkvision ?? 0;

  if (monster.spellcasting) {
    notes.push(
      "Spell slots and caster level are set, but the spells are listed as text in the Spellcasting feature, because Foundry cannot link spells to its compendium from an imported file. Drag the spells onto the sheet from your compendium, or use the 5etools export with Plutonium.",
    );
  }
  const items = buildItems({ monster, pb, mods, notes, slugs: new Set() });

  const actor: JsonObject = {
    name,
    type: "npc",
    system,
    prototypeToken: token,
    items,
    effects: [],
    flags: {},
    _stats: { ...STATS_STAMP },
  };
  return { actor, notes: [...new Set(notes)] };
}
