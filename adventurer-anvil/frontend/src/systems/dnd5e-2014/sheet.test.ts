// The character sheet's layout, through the real SRD 5.1 pack: every value and list it names exists for real
// characters (a level 1 fighter, a level 20 wizard, a multiclass caster with gear and a feat), saving throws and skills
// carry their marks, and spells are grouped by level.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createContentIndex, newCharacterDocument, readPack, setChoice, sheetSections, viewCharacter, type ChoiceValue } from "../../core";
import { dnd5e2014, SHEET } from "./module";
import { CLASS_KEY, LEVEL_KEY, MULTI_KEY } from "./steps/class";
import { CUSTOM_KEY, GOLD_KEY, METHOD_KEY, SHOP_KEY } from "./steps/equipment";
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
    [METHOD_KEY]: "gold", [GOLD_KEY]: 100, [SHOP_KEY]: { "srd-5.1:longsword": 1, "srd-5.1:chain-mail": 1 }, "equipment.armor": "srd-5.1:chain-mail",
    [`${W}.cantrips`]: ["srd-5.1:fire-bolt", "srd-5.1:light", "srd-5.1:mage-hand"], [`${W}.spellbook`]: ["srd-5.1:magic-missile", "srd-5.1:shield"],
    background: "srd-5.1:acolyte",
  },
};

/** The derived values and lists a sheet section names. */
function named(v: View) {
  const keys: string[] = [];
  const lists: string[] = [];
  for (const page of SHEET) {
    for (const s of sheetSections(page)) {
      if (s.kind === "tiles") keys.push(...s.items.flatMap((i) => [i.key, ...(i.note ? [i.note] : [])]));
      if (s.kind === "stats" || s.kind === "checklist") keys.push(...s.items.map((i) => i.key));
      if (s.kind === "identity") keys.push(...s.fields.flatMap((f) => ("derived" in f ? [f.derived] : [])));
      if (s.kind === "blanks") keys.push(...s.items.flatMap((b) => (b.above ? [b.above.key] : [])));
      if (s.kind === "list") lists.push(s.list);
    }
  }
  return { keys, lists, missingKeys: keys.filter((k) => !(k in v.derived)) };
}

describe("the sheet's layout", () => {
  it("page 1 is a band and three columns, then everything carried, the story, and spells only for characters with them", () => {
    expect(SHEET.map((p) => [p.label, p.header?.length ?? 0, p.columns?.length ?? 0, p.onlyWithList])).toEqual([
      ["Character", 1, 3, undefined], ["Equipment and money", 0, 0, undefined], ["Story", 0, 3, undefined], ["Spells", 0, 0, "spell-list"],
    ]);
    // Page 1 has no list that grows with what's carried, only the money and the weight.
    expect(sheetSections(SHEET[0]).filter((s) => s.kind === "ledger" || (s.kind === "list" && s.list === "inventory"))).toEqual([]);
    // Sections inside the abilities' split are found too.
    expect(sheetSections(SHEET[0]).map((s) => s.label)).toContain("Skills");
    expect(view(characters["a level 1 fighter"]).lists["spell-list"] ?? []).toEqual([]);
  });

  it("the band names the classes and their levels", () => {
    expect(view(characters["a Fighter 4 / Wizard 1 with gear and a feat"]).derived["class-levels"].value).toBe("Fighter 4 / Wizard 1");
  });

  it("every spell level on the list has its slots to tick, as numbers", () => {
    const section = SHEET.flatMap(sheetSections).find((s) => s.kind === "list" && s.groupTicks);
    if (section?.kind !== "list" || !section.groupTicks) throw new Error("no spell list with slots");
    const wizard = view({ ...characters["a level 20 wizard"], [`${W}.spellbook`]: ["srd-5.1:magic-missile", "srd-5.1:wish"] });
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => wizard.derived[`spell-slots.${l}`]?.value)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
    for (const group of new Set(wizard.lists["spell-list"].map((s) => s.group).filter((g) => g !== "Cantrips"))) {
      expect(section.groupTicks[group!], group).toBeDefined();
      expect(wizard.derived[section.groupTicks[group!]], group).toBeDefined();
    }
    expect(view(characters["a level 1 fighter"]).derived["spell-slots.1"]).toBeUndefined();
  });

  it("the equipment ledger: coins by kind that add up to the money, and each line's count and weight", () => {
    const v = view(characters["a Fighter 4 / Wizard 1 with gear and a feat"]);
    const ledger = SHEET.flatMap(sheetSections).find((s) => s.kind === "ledger");
    if (ledger?.kind !== "ledger") throw new Error("no equipment ledger");
    const coin = (c: string) => Number(v.derived[`coins.${c}`].value);
    expect(coin("cp") + coin("sp") * 10 + coin("ep") * 50 + coin("gp") * 100 + coin("pp") * 1000).toBe(v.derived.coins.value);
    for (const s of ledger.side) expect(v.derived[s.key], s.key).toBeDefined();
    const mail = v.lists[ledger.list].find((i) => i.count?.name === "Chain Mail");
    expect(mail).toMatchObject({ count: { qty: 1, name: "Chain Mail" }, weight: 55 });
    // Worn armour is ticked as equipped; the sword in its sheath isn't (the app doesn't know what's in hand).
    expect(v.lists.inventory.find((i) => i.count?.name === "Chain Mail")?.flags).toEqual(["equipped"]);
    expect(v.lists.inventory.find((i) => i.count?.name === "Longsword")?.flags).toBeUndefined();
    expect(v.derived.attunement.value).toBe("0 / 3");
    expect(ledger.checks?.map((c) => c.flag)).toEqual(["equipped", "attuned"]);
    // Your own item, attuned to: ticked as attuned, counted, and the name doesn't repeat it.
    const ring = view({ ...characters["a level 1 fighter"], [CUSTOM_KEY]: [{ id: "r", name: "Ring of Warmth", qty: 1, weight: 0, attunement: true, attuned: true, note: "" }] });
    const line = ring.lists.inventory.find((i) => i.count?.name === "Ring of Warmth");
    expect(line?.flags).toEqual(["attuned"]);
    expect(ring.derived.attunement.value).toBe("1 / 3");
    const lines = v.lists[ledger.list];
    expect(lines.reduce((t, i) => t + (i.weight ?? 0), 0)).toBeCloseTo(Number(v.derived.weight.value));
  });

  it("attacks split into the table's columns, and limited uses say how many boxes to tick", () => {
    const v = view(characters["a Fighter 4 / Wizard 1 with gear and a feat"]);
    const attacks = sheetSections(SHEET[0]).find((s) => s.kind === "rows" && s.table);
    if (attacks?.kind !== "rows" || !attacks.table) throw new Error("no attacks table");
    const values = Object.keys(v.derived).filter((k) => k.startsWith("attack.")).map((k) => String(v.derived[k].value));
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value.split(attacks.table.separator)).toHaveLength(2);
    expect(v.lists.resources.find((r) => r.name === "Second Wind")?.uses).toBe(1);
  });

  for (const [who, choices] of Object.entries(characters)) {
    it(`names only values that exist, for ${who}`, () => {
      const v = view(choices);
      // The weight carried exists once something is carried; the sheet shows a dash until then.
      const carrying = (v.lists.inventory ?? []).length > 0;
      expect(named(v).missingKeys.filter((k) => carrying || k !== "weight")).toEqual([]);
    });
  }

  it("names only lists and choices that exist; a multiclass character with gear and a feat fills every list", () => {
    const v = view(characters["a Fighter 4 / Wizard 1 with gear and a feat"]);
    const { lists } = named(v);
    expect(lists.filter((l) => !(l in v.lists))).toEqual([]);
    const choicesNamed = SHEET.flatMap(sheetSections).flatMap((s) => (s.kind === "identity" ? s.fields.flatMap((f) => ("choice" in f ? [f.choice] : [])) : s.kind === "text" ? s.keys : []));
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
