// The character sheet's layout, through the real SRD 5.1 pack: every value and list it names exists for real
// characters (a level 1 fighter, a level 20 wizard, a multiclass caster with gear and a feat), saving throws and skills
// carry their marks, and spells are grouped by level.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createContentIndex, newCharacterDocument, readPack, setChoice, viewCharacter, type ChoiceValue } from "../../core";
import { dnd5e2014, SHEET } from "./module";
import { CLASS_KEY, LEVEL_KEY, MULTI_KEY } from "./steps/class";
import { GOLD_KEY, METHOD_KEY, SHOP_KEY } from "./steps/equipment";
import { RULE_KEYS } from "./steps/rules";
import { standardArray } from "./testing/abilities";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const committed = JSON.parse(readFileSync(join(ROOT, "frontend/public/packs/srd-5.1.pack.json"), "utf8"));
const result = readPack(committed, dnd5e2014, []);
if (!result.ok) throw new Error(result.errors.join("\n"));
const content = createContentIndex([result.pack]);
const T = "2026-11-21T10:00:00Z";

function view(choices: Record<string, ChoiceValue>) {
  let d = newCharacterDocument({ id: "c", system: { id: "dnd5e-2014", version: 1 }, packs: [{ id: "srd-5.1", version: committed.version }], now: T });
  for (const [k, v] of Object.entries(choices)) d = setChoice(d, k, v, T);
  return viewCharacter(dnd5e2014, d, content);
}
type View = ReturnType<typeof view>;

const dwarf = { race: "srd-5.1:dwarf", "race.srd-5.1:dwarf.subrace": "srd-5.1:hill-dwarf", ...standardArray({ str: 15, dex: 12, con: 14, int: 13, wis: 10, cha: 8 }) };
const W = "spells.srd-5.1:wizard";
const characters: Record<string, Record<string, ChoiceValue>> = {
  "a level 1 fighter": { ...dwarf, [CLASS_KEY]: "srd-5.1:fighter" },
  "a level 20 wizard": { ...dwarf, [CLASS_KEY]: "srd-5.1:wizard", [LEVEL_KEY]: 20 },
  "a Fighter 4 / Wizard 1 with gear and a feat": {
    ...dwarf, [RULE_KEYS.feats]: "on", [CLASS_KEY]: "srd-5.1:fighter", [LEVEL_KEY]: 5, [MULTI_KEY]: { "srd-5.1:wizard": 1 },
    "class.srd-5.1:fighter.asi-4.take": "feat", "class.srd-5.1:fighter.asi-4.feat": "srd-5.1:grappler",
    [METHOD_KEY]: "gold", [GOLD_KEY]: 100, [SHOP_KEY]: { "srd-5.1:longsword": 1, "srd-5.1:chain-mail": 1 },
    [`${W}.cantrips`]: ["srd-5.1:fire-bolt", "srd-5.1:light", "srd-5.1:mage-hand"], [`${W}.spellbook`]: ["srd-5.1:magic-missile", "srd-5.1:shield"],
    background: "srd-5.1:acolyte",
  },
};

/** The derived values and lists a sheet section names. */
function named(v: View) {
  const keys: string[] = [];
  const lists: string[] = [];
  for (const page of SHEET) {
    for (const s of page.sections) {
      if (s.kind === "tiles") keys.push(...s.items.flatMap((i) => [i.key, ...(i.note ? [i.note] : [])]));
      if (s.kind === "stats" || s.kind === "checklist") keys.push(...s.items.map((i) => i.key));
      if (s.kind === "identity") keys.push(...s.fields.flatMap((f) => ("derived" in f ? [f.derived] : [])));
      if (s.kind === "list") lists.push(s.list);
    }
  }
  return { keys, lists, missingKeys: keys.filter((k) => !(k in v.derived)) };
}

describe("the sheet's layout", () => {
  for (const [who, choices] of Object.entries(characters)) {
    it(`names only values that exist, for ${who}`, () => {
      expect(named(view(choices)).missingKeys).toEqual([]);
    });
  }

  it("names only lists and choices that exist; a multiclass character with gear and a feat fills every list", () => {
    const v = view(characters["a Fighter 4 / Wizard 1 with gear and a feat"]);
    const { lists } = named(v);
    expect(lists.filter((l) => !(l in v.lists))).toEqual([]);
    const choicesNamed = SHEET.flatMap((p) => p.sections).flatMap((s) => (s.kind === "identity" ? s.fields.flatMap((f) => ("choice" in f ? [f.choice] : [])) : s.kind === "text" ? s.keys : []));
    const offered = new Set(v.steps.flatMap((s) => s.choices).map((c) => c.key));
    expect(choicesNamed.filter((k) => !offered.has(k))).toEqual([]);
    expect(Object.keys(v.derived).some((k) => k.startsWith("attack."))).toBe(true);
    expect(Object.keys(v.derived).some((k) => k.startsWith("spell."))).toBe(true);
  });

  it("saving throws and skills carry their marks", () => {
    const v = view({ ...characters["a level 1 fighter"], "class.srd-5.1:fighter.skills": ["athletics", "perception"] });
    expect(v.derived["save.str"].mark).toEqual({ level: 1, label: "Proficient" });
    expect(v.derived["save.dex"].mark).toBeUndefined();
    expect(v.derived["skill.athletics"].mark).toEqual({ level: 1, label: "Proficient" });
    const rogue = view({ ...dwarf, [CLASS_KEY]: "srd-5.1:rogue", "class.srd-5.1:rogue.skills": ["stealth", "acrobatics", "insight", "deception"], "class.srd-5.1:rogue.expertise-1": ["skill:stealth", "tool:thieves-tools"] });
    expect(rogue.derived["skill.stealth"].mark).toEqual({ level: 2, label: "Expertise" });
  });

  it("spells are grouped by level, with their text", () => {
    const list = view(characters["a Fighter 4 / Wizard 1 with gear and a feat"]).lists["spell-list"];
    expect(list.map((s) => [s.name, s.group])).toEqual([
      ["Fire Bolt", "Cantrips"], ["Light", "Cantrips"], ["Mage Hand", "Cantrips"], ["Magic Missile", "1st level"], ["Shield", "1st level"],
    ]);
    expect(list[3].description).toMatch(/^You create three glowing darts/);
  });
});
