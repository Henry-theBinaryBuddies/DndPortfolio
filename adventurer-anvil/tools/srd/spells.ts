// Turns the 5e-bits SRD 5.1 spells into the 2014 spell format, and says how each class casts. Pure: data in, entries out.
import type { Spell, Spellcasting } from "../../frontend/src/systems/dnd5e-2014/packFormat";
import type { Ability, DAMAGE_TYPES, SCHOOLS } from "../../frontend/src/systems/dnd5e-2014/vocabulary";
import type { RawClass, RawSpell } from "./raw";

export function buildSpells(raw: RawSpell[]): Spell[] {
  return raw.map((s) => {
    const has = (c: string) => s.components.includes(c as "V" | "S" | "M");
    const description = s.desc.join("\n\n");
    return {
      id: s.index,
      name: s.name,
      level: s.level,
      school: s.school.index as (typeof SCHOOLS)[number],
      classes: s.classes.map((c) => c.index),
      castingTime: s.casting_time,
      range: s.range,
      components: {
        ...(has("V") ? { verbal: true } : {}),
        ...(has("S") ? { somatic: true } : {}),
        // A few spells mark M without saying what it is; "a material component" keeps the M.
        ...(has("M") ? { material: (s.material ?? "a material component").replace(/\.$/, "") } : {}),
      },
      duration: s.duration,
      ...(s.concentration ? { concentration: true } : {}),
      ...(s.ritual ? { ritual: true } : {}),
      description,
      ...(s.higher_level?.length ? { higherLevels: s.higher_level.join("\n\n") } : {}),
      ...automation(s),
    };
  });
}

/** "3d4 + 3" → "3d4+3"; a choice of dice ("4d6 OR 5d6") can't be automated, so it's left out. */
const dice = (text: string) => (/ OR /.test(text) ? undefined : text.replace(/\s+/g, ""));
function byLevel(table: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!table) return undefined;
  const out = Object.fromEntries(Object.entries(table).flatMap(([l, d]) => (dice(d) ? [[l, dice(d)!]] : [])));
  return Object.keys(out).length ? out : undefined;
}

/**
 * Healing spells whose numbers restore hit points. Aid raises the hit point maximum and False Life gives temporary
 * hit points, so their numbers aren't healing and aren't automated.
 */
const NOT_HEALING = new Set(["aid", "false-life"]);

/** What a virtual table can automate, from the files' attack, save, damage, healing and area fields. */
function automation(s: RawSpell): Partial<Spell> {
  const out: Partial<Spell> = {};
  if (s.attack_type) out.attack = s.attack_type;
  if (s.dc) out.save = { ability: s.dc.dc_type.index as Ability, onSuccess: s.dc.dc_success };
  const damage = (s.damage ?? [])
    .filter((d) => d.damage_type)
    .map((d) => ({
      type: d.damage_type!.index as (typeof DAMAGE_TYPES)[number],
      ...(byLevel(d.damage_at_slot_level) ? { atSlotLevel: byLevel(d.damage_at_slot_level) } : {}),
      ...(byLevel(d.damage_at_character_level) ? { atCharacterLevel: byLevel(d.damage_at_character_level) } : {}),
    }))
    .filter((d) => d.atSlotLevel || d.atCharacterLevel);
  if (damage.length) out.damage = damage;
  const heal = byLevel(s.heal_at_slot_level);
  if (heal && !NOT_HEALING.has(s.index)) out.healing = { atSlotLevel: heal };
  if (s.area_of_effect) out.area = { shape: s.area_of_effect.type, size: s.area_of_effect.size };
  return out;
}

/**
 * How each SRD class casts, entered by hand where the community files don't say (the kind, what it prepares, its focus),
 * from the SRD's class text. The ability and starting level come from the files.
 */
const CASTING: Record<string, Pick<Spellcasting, "kind" | "prepare" | "spellbook" | "ritual" | "focus">> = {
  bard: { kind: "known", ritual: true, focus: ["musical-instruments"] },
  cleric: { kind: "prepared", prepare: "level", ritual: true, focus: ["holy-symbols"] },
  druid: { kind: "prepared", prepare: "level", ritual: true, focus: ["druidic-foci"] },
  paladin: { kind: "prepared", prepare: "half-level", focus: ["holy-symbols"] },
  ranger: { kind: "known" },
  sorcerer: { kind: "known", focus: ["arcane-foci"] },
  warlock: { kind: "pact", focus: ["arcane-foci"] },
  wizard: { kind: "spellbook", prepare: "level", spellbook: { start: 6, perLevel: 2 }, ritual: true, focus: ["arcane-foci"] },
};

/** A class's spellcasting, given the ids of its table's columns. */
export function spellcastingFor(c: RawClass, columns: Set<string>): Spellcasting | undefined {
  if (!c.spellcasting) return undefined;
  const how = CASTING[c.index];
  if (!how) throw new Error(`No casting kind for the class "${c.index}": add it to CASTING in spells.ts.`);
  const slots: Record<string, string> = {};
  for (let l = 1; l <= 9; l++) if (columns.has(`spell-slots-level-${l}`)) slots[String(l)] = `spell-slots-level-${l}`;
  return {
    ability: c.spellcasting.spellcasting_ability.index as Ability,
    level: c.spellcasting.level,
    kind: how.kind,
    progression: how.kind === "pact" ? "pact" : c.index === "paladin" || c.index === "ranger" ? "half" : "full",
    ...(columns.has("cantrips-known") ? { cantrips: "cantrips-known" } : {}),
    ...(columns.has("spells-known") ? { known: "spells-known" } : {}),
    slots,
    ...(how.prepare ? { prepare: how.prepare } : {}),
    ...(how.spellbook ? { spellbook: how.spellbook } : {}),
    ...(how.ritual ? { ritual: true } : {}),
    ...(how.focus ? { focus: how.focus } : {}),
  };
}
