// Turns the 5e-bits SRD 5.1 spells into the 2014 spell format, and says how each class casts. Pure: data in, entries out.
import type { Spell, Spellcasting } from "../../frontend/src/systems/dnd5e-2014/packFormat";
import type { Ability, SCHOOLS } from "../../frontend/src/systems/dnd5e-2014/vocabulary";
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
    };
  });
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
    ...(columns.has("cantrips-known") ? { cantrips: "cantrips-known" } : {}),
    ...(columns.has("spells-known") ? { known: "spells-known" } : {}),
    slots,
    ...(how.prepare ? { prepare: how.prepare } : {}),
    ...(how.spellbook ? { spellbook: how.spellbook } : {}),
    ...(how.ritual ? { ritual: true } : {}),
    ...(how.focus ? { focus: how.focus } : {}),
  };
}
