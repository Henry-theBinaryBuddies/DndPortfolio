// The built-in SRD 5.1 pack: it is what the importer makes from the pinned files, it matches the hand-made check table,
// and real SRD races come out right through the rules engine.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createContentIndex, newCharacterDocument, readPack, setChoice, viewCharacter, type ChoiceValue } from "../../core";
import { dnd5e2014 } from "./module";
import { buildSrdPack } from "../../../../tools/srd/build";
import { LANGUAGES, RACES, SUBRACES } from "../../../../data/srd-5.1/check-table";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const json = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const committed = json("frontend/public/packs/srd-5.1.pack.json");

const result = readPack(committed, dnd5e2014, []);
if (!result.ok) throw new Error(result.errors.join("\n"));
const content = createContentIndex([result.pack]);

function view(choices: Record<string, ChoiceValue>) {
  let doc = newCharacterDocument({ id: "c", system: { id: "dnd5e-2014", version: 1 }, packs: [{ id: "srd-5.1", version: committed.version }], now: "2026-11-12T00:00:00Z" });
  for (const [k, v] of Object.entries(choices)) doc = setChoice(doc, k, v, "2026-11-12T00:00:00Z");
  return viewCharacter(dnd5e2014, doc, content);
}
const names = (v: ReturnType<typeof view>, list: string, detail?: string) =>
  (v.lists[list] ?? []).filter((i) => detail === undefined || i.detail === detail).map((i) => i.name);
const TENS = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

describe("the SRD 5.1 pack", () => {
  it("is exactly what the importer makes from the pinned files (run npm run import:srd if not)", () => {
    const raw = {
      races: json("data/srd-5.1/raw/5e-SRD-Races.json"),
      subraces: json("data/srd-5.1/raw/5e-SRD-Subraces.json"),
      traits: json("data/srd-5.1/raw/5e-SRD-Traits.json"),
      languages: json("data/srd-5.1/raw/5e-SRD-Languages.json"),
    };
    expect(JSON.parse(JSON.stringify(buildSrdPack(raw).pack))).toEqual(committed);
  });

  it("carries the SRD's CC-BY-4.0 credit", () => {
    expect(committed.attribution).toMatch(/System Reference Document 5\.1.*Creative Commons Attribution 4\.0/);
  });

  it("has the 16 SRD languages, standard and exotic", () => {
    const languages = content.list("languages");
    expect(languages.filter((l) => !l.exotic).map((l) => l.name)).toEqual(LANGUAGES.standard);
    expect(languages.filter((l) => l.exotic).map((l) => l.name)).toEqual(LANGUAGES.exotic);
  });
});

describe("each race matches the check table", () => {
  for (const [id, facts] of Object.entries(RACES)) {
    it(facts.name, () => {
      const v = view({ race: `srd-5.1:${id}`, "abilities.scores": TENS });
      expect(content.get("races", `srd-5.1:${id}`)?.size).toBe(facts.size);
      for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
        expect(v.derived[`ability.${ability}`].value, ability).toBe(10 + (facts.bonuses[ability] ?? 0));
      }
      expect(v.derived["speed.walk"].value).toBe(facts.speed);
      expect(names(v, "senses")).toEqual(facts.darkvision ? [`Darkvision ${facts.darkvision} ft`] : []);
      expect(names(v, "languages")).toEqual(facts.languages);
      const languageChoice = v.steps[0].choices.find((c) => c.key === `race.srd-5.1:${id}.language`);
      expect(languageChoice ? 1 : 0).toBe(facts.extraLanguages ?? 0);
      expect(names(v, "proficiencies", "skill")).toEqual(facts.skills ?? []);
      expect(names(v, "proficiencies", "weapon")).toEqual(facts.weapons ?? []);
      expect(names(v, "resistances")).toEqual(facts.resistances ?? []);
    });
  }
});

describe("each subrace matches the check table", () => {
  for (const [id, facts] of Object.entries(SUBRACES)) {
    it(facts.name, () => {
      const race = view({ race: `srd-5.1:${facts.race}`, "abilities.scores": TENS });
      const sub = view({ race: `srd-5.1:${facts.race}`, [`race.srd-5.1:${facts.race}.subrace`]: `srd-5.1:${id}`, "abilities.scores": TENS });
      for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
        const added = Number(sub.derived[`ability.${ability}`].value) - Number(race.derived[`ability.${ability}`].value);
        expect(added, ability).toBe(facts.bonuses[ability] ?? 0);
      }
      const newOnes = (list: string, detail: string) =>
        names(sub, list, detail).filter((n) => !names(race, list, detail).includes(n));
      expect(newOnes("proficiencies", "weapon")).toEqual(facts.weapons ?? []);
      expect(newOnes("proficiencies", "tool")).toEqual(facts.tools ?? []);
      expect(sub.steps[0].choices.some((c) => c.key === `race.srd-5.1:${id}.language`) ? 1 : 0).toBe(facts.extraLanguages ?? 0);
    });
  }

  it("every race with a subrace in the SRD offers it, and no other race asks for one", () => {
    const withSubrace = (race: string) => view({ race: `srd-5.1:${race}` }).steps[0].choices.some((c) => c.key.endsWith(".subrace"));
    expect(Object.keys(RACES).filter(withSubrace)).toEqual(["dwarf", "elf", "halfling", "gnome"]);
  });
});

describe("real SRD races through the engine", () => {
  const STANDARD = { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 };

  it("a Hill Dwarf: Con and Wis bonuses, 25 ft, poison resistance, dwarven weapons, Toughness as text for now", () => {
    const v = view({ race: "srd-5.1:dwarf", "race.srd-5.1:dwarf.subrace": "srd-5.1:hill-dwarf", "abilities.scores": STANDARD });
    expect(v.derived["ability.con"].breakdown).toEqual([{ label: "Base", amount: 13 }, { label: "Dwarf", amount: 2 }]);
    expect(v.derived["ability.wis"].breakdown).toEqual([{ label: "Base", amount: 12 }, { label: "Hill Dwarf", amount: 1 }]);
    expect(v.derived["speed.walk"].value).toBe(25);
    expect(names(v, "features")).toEqual(["Dwarven Resilience", "Stonecunning", "Tool Proficiency", "Dwarven Toughness"]);
    expect(v.steps[0].status).toBe("done");
  });

  it("a Dragonborn: the ancestry choice gives the resistance, and Breath Weapon is tracked per short rest", () => {
    const choice = view({ race: "srd-5.1:dragonborn" }).steps[0].choices.find((c) => c.key === "race.srd-5.1:dragonborn.ancestry")!;
    expect(choice.options?.map((o) => o.name)).toEqual(["Acid", "Cold", "Fire", "Lightning", "Poison"]);

    const v = view({ race: "srd-5.1:dragonborn", "race.srd-5.1:dragonborn.ancestry": "fire", "abilities.scores": STANDARD });
    expect(v.lists.resistances).toEqual([{ name: "Fire", source: "Dragonborn" }]);
    expect(v.lists.resources).toEqual([{ name: "Breath Weapon", source: "Dragonborn", detail: "1 per short rest" }]);
    const effects = content.get("races", "srd-5.1:dragonborn")?.effects as { name?: string; description?: string }[];
    const ancestry = effects.find((e) => e.name === "Draconic Ancestry")?.description ?? "";
    expect(ancestry).toContain("Red: Fire, 15 ft. cone (DEX save)");
    expect(ancestry).toContain("Black: Acid, 30 ft. line (DEX save)");
  });

  it("a Human: +1 to every score and a choice of one extra language", () => {
    const v = view({ race: "srd-5.1:human", "race.srd-5.1:human.language": "srd-5.1:dwarvish", "abilities.scores": STANDARD });
    expect(["str", "dex", "con", "int", "wis", "cha"].map((a) => v.derived[`ability.${a}`].value)).toEqual([9, 15, 14, 16, 13, 11]);
    expect(names(v, "languages")).toEqual(["Common", "Dwarvish"]);
  });

  it("a Half-Orc: Intimidation proficiency from Menacing, and Relentless Endurance per long rest", () => {
    const v = view({ race: "srd-5.1:half-orc", "abilities.scores": STANDARD });
    expect(v.derived["skill.intimidation"].breakdown).toEqual([{ label: "Charisma", amount: 0 }, { label: "Proficient (Half-Orc)", amount: 2 }]);
    expect(v.lists.resources).toEqual([{ name: "Relentless Endurance", source: "Half-Orc", detail: "1 per long rest" }]);
  });

  it("keeps the corrected SRD text", () => {
    const brave = (content.get("races", "srd-5.1:halfling")?.effects as { name?: string; description?: string }[]).find((e) => e.name === "Brave");
    expect(brave?.description).toBe("You have advantage on saving throws against being frightened.");
  });
});

describe("option cards for SRD races", () => {
  const card = (name: string) => view({}).steps[0].choices[0].options!.find((o) => o.name === name)!;

  it("lead with the main bonus, then speed and size", () => {
    expect(card("Tiefling").tags?.slice(0, 4)).toEqual(["+2 Cha", "+1 Int", "30 ft", "Medium"]);
    expect(card("Human").tags?.slice(0, 3)).toEqual(["+1 all", "30 ft", "Medium"]);
    expect(card("Half-Elf").tags?.slice(0, 4)).toEqual(["+2 Cha", "+1 to 2 of your choice", "30 ft", "Medium"]);
  });

  it("carry the full SRD text behind Read more", () => {
    expect(card("Dwarf").description).toMatch(/^Age\. Dwarves mature at the same rate as humans/);
  });
});
