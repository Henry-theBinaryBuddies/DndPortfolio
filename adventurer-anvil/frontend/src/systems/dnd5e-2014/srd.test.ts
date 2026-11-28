// The built-in SRD 5.1 pack: it is what the importer makes from the pinned files, it matches the hand-made check table,
// and real SRD races come out right through the rules engine.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createContentIndex, newCharacterDocument, readPack, setChoice, viewCharacter, type ChoiceValue } from "../../core";
import { dnd5e2014 } from "./module";
import { pointBuy, standardArray } from "./testing/abilities";
import { buildSrdPack } from "../../../../tools/srd/build";
import { BACKGROUNDS, CASTERS, CLASSES, KITS, LANGUAGES, RACES, SUBRACES, type KitFacts } from "../../../../data/srd-5.1/check-table";
import type { EquipmentLine, StartingEquipment } from "./packFormat";

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

/** A package as the check table puts it. */
function kitFacts(kit: StartingEquipment): KitFacts {
  const lines: EquipmentLine[] = kit.items ?? [];
  const items: Record<string, number> = {};
  for (const l of lines) if ("item" in l) items[l.item] = (items[l.item] ?? 0) + (l.qty ?? 1);
  const named = lines.flatMap((l) => ("name" in l ? [l.qty && l.qty > 1 ? `${l.name} × ${l.qty}` : l.name] : []));
  const any = lines.flatMap((l) => ("any" in l ? [l.label] : []));
  return {
    items, ...(named.length ? { named } : {}), ...(any.length ? { any } : {}), choices: kit.choices?.length ?? 0,
    ...(kit.gold ? { gold: `${kit.gold.amount} ${kit.gold.unit}` } : {}),
  };
}
const entry = (collection: string, id: string) => (committed.collections[collection] as { id: string; startingEquipment?: StartingEquipment }[]).find((e) => e.id === id)!;

describe("the SRD 5.1 pack", () => {
  it("is exactly what the importer makes from the pinned files (run npm run import:srd if not)", () => {
    const raw = {
      races: json("data/srd-5.1/raw/5e-SRD-Races.json"),
      subraces: json("data/srd-5.1/raw/5e-SRD-Subraces.json"),
      traits: json("data/srd-5.1/raw/5e-SRD-Traits.json"),
      languages: json("data/srd-5.1/raw/5e-SRD-Languages.json"),
      classes: json("data/srd-5.1/raw/5e-SRD-Classes.json"),
      subclasses: json("data/srd-5.1/raw/5e-SRD-Subclasses.json"),
      features: json("data/srd-5.1/raw/5e-SRD-Features.json"),
      levels: json("data/srd-5.1/raw/5e-SRD-Levels.json"),
      proficiencies: json("data/srd-5.1/raw/5e-SRD-Proficiencies.json"),
      backgrounds: json("data/srd-5.1/raw/5e-SRD-Backgrounds.json"),
      equipment: json("data/srd-5.1/raw/5e-SRD-Equipment.json"),
      spells: json("data/srd-5.1/raw/5e-SRD-Spells.json"),
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
      const v = view({ race: `srd-5.1:${id}`, ...pointBuy(TENS) });
      expect(content.get("races", `srd-5.1:${id}`)?.size).toBe(facts.size);
      for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
        expect(v.derived[`ability.${ability}`].value, ability).toBe(10 + (facts.bonuses[ability] ?? 0));
      }
      expect(v.derived["speed.walk"].value).toBe(facts.speed);
      expect(names(v, "senses")).toEqual(facts.darkvision ? [`Darkvision ${facts.darkvision} ft`] : []);
      expect(names(v, "languages")).toEqual(facts.languages);
      const languageChoice = v.steps.find((s) => s.id === "race")!.choices.find((c) => c.key === `race.srd-5.1:${id}.language`);
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
      const race = view({ race: `srd-5.1:${facts.race}`, ...pointBuy(TENS) });
      const sub = view({ race: `srd-5.1:${facts.race}`, [`race.srd-5.1:${facts.race}.subrace`]: `srd-5.1:${id}`, ...pointBuy(TENS) });
      for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
        const added = Number(sub.derived[`ability.${ability}`].value) - Number(race.derived[`ability.${ability}`].value);
        expect(added, ability).toBe(facts.bonuses[ability] ?? 0);
      }
      const newOnes = (list: string, detail: string) =>
        names(sub, list, detail).filter((n) => !names(race, list, detail).includes(n));
      expect(newOnes("proficiencies", "weapon")).toEqual(facts.weapons ?? []);
      expect(newOnes("proficiencies", "tool")).toEqual(facts.tools ?? []);
      expect(sub.steps.find((s) => s.id === "race")!.choices.some((c) => c.key === `race.srd-5.1:${id}.language`) ? 1 : 0).toBe(facts.extraLanguages ?? 0);
    });
  }

  it("every race with a subrace in the SRD offers it, and no other race asks for one", () => {
    const withSubrace = (race: string) => view({ race: `srd-5.1:${race}` }).steps.find((s) => s.id === "race")!.choices.some((c) => c.key.endsWith(".subrace"));
    expect(Object.keys(RACES).filter(withSubrace)).toEqual(["dwarf", "elf", "halfling", "gnome"]);
  });
});

describe("real SRD races through the engine", () => {
  const STANDARD = { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 };

  it("a Hill Dwarf: Con and Wis bonuses, 25 ft, poison resistance, dwarven weapons, Dwarven Toughness", () => {
    const v = view({ race: "srd-5.1:dwarf", "race.srd-5.1:dwarf.subrace": "srd-5.1:hill-dwarf", ...standardArray(STANDARD) });
    expect(v.derived["ability.con"].breakdown).toEqual([{ label: "Base", amount: 13 }, { label: "Dwarf", amount: 2 }]);
    expect(v.derived["ability.wis"].breakdown).toEqual([{ label: "Base", amount: 12 }, { label: "Hill Dwarf", amount: 1 }]);
    expect(v.derived["speed.walk"].value).toBe(25);
    expect(names(v, "features")).toEqual(["Dwarven Resilience", "Stonecunning", "Tool Proficiency", "Dwarven Toughness"]);
    expect(v.steps.find((s) => s.id === "race")!.status).toBe("todo"); // the artisan's tools
    const tools = v.steps.find((s) => s.id === "race")!.choices.find((c) => c.key === "race.srd-5.1:dwarf.tools")!;
    expect(tools.options?.map((o) => o.name)).toEqual(["Smith's Tools", "Brewer's Supplies", "Mason's Tools"]);
    const done = view({ race: "srd-5.1:dwarf", "race.srd-5.1:dwarf.subrace": "srd-5.1:hill-dwarf", "race.srd-5.1:dwarf.tools": "brewers-supplies", ...standardArray(STANDARD) });
    expect(done.steps.find((s) => s.id === "race")!.status).toBe("done");
    expect(names(done, "proficiencies", "tool")).toEqual(["Brewer's Supplies"]);
  });

  it("a Dragonborn: the ancestry choice gives the resistance, and Breath Weapon is tracked per short rest", () => {
    const choice = view({ race: "srd-5.1:dragonborn" }).steps.find((s) => s.id === "race")!.choices.find((c) => c.key === "race.srd-5.1:dragonborn.ancestry")!;
    expect(choice.options?.map((o) => o.name)).toEqual(["Acid", "Cold", "Fire", "Lightning", "Poison"]);

    const v = view({ race: "srd-5.1:dragonborn", "race.srd-5.1:dragonborn.ancestry": "fire", ...standardArray(STANDARD) });
    expect(v.lists.resistances).toEqual([{ name: "Fire", source: "Dragonborn" }]);
    expect(v.lists.resources).toEqual([{ name: "Breath Weapon", source: "Dragonborn", detail: "1 per short rest", uses: 1 }]);
    const effects = content.get("races", "srd-5.1:dragonborn")?.effects as { name?: string; description?: string }[];
    const ancestry = effects.find((e) => e.name === "Draconic Ancestry")?.description ?? "";
    expect(ancestry).toContain("Red: Fire, 15 ft. cone (DEX save)");
    expect(ancestry).toContain("Black: Acid, 30 ft. line (DEX save)");
  });

  it("a Human: +1 to every score and a choice of one extra language", () => {
    const v = view({ race: "srd-5.1:human", "race.srd-5.1:human.language": "srd-5.1:dwarvish", ...standardArray(STANDARD) });
    expect(["str", "dex", "con", "int", "wis", "cha"].map((a) => v.derived[`ability.${a}`].value)).toEqual([9, 15, 14, 16, 13, 11]);
    expect(names(v, "languages")).toEqual(["Common", "Dwarvish"]);
  });

  it("a Half-Orc: Intimidation proficiency from Menacing, and Relentless Endurance per long rest", () => {
    const v = view({ race: "srd-5.1:half-orc", ...standardArray(STANDARD) });
    expect(v.derived["skill.intimidation"].breakdown).toEqual([{ label: "Charisma", amount: 0 }, { label: "Proficient (Half-Orc)", amount: 2 }]);
    expect(v.lists.resources).toEqual([{ name: "Relentless Endurance", source: "Half-Orc", detail: "1 per long rest", uses: 1 }]);
  });

  it("keeps the corrected SRD text", () => {
    const brave = (content.get("races", "srd-5.1:halfling")?.effects as { name?: string; description?: string }[]).find((e) => e.name === "Brave");
    expect(brave?.description).toBe("You have advantage on saving throws against being frightened.");
  });
});

describe("option cards for SRD races", () => {
  const card = (name: string) => view({}).steps.find((s) => s.id === "race")!.choices[0].options!.find((o) => o.name === name)!;

  it("lead with the main bonus, then speed and size", () => {
    expect(card("Tiefling").tags?.slice(0, 4)).toEqual(["+2 Cha", "+1 Int", "30 ft", "Medium"]);
    expect(card("Human").tags?.slice(0, 3)).toEqual(["+1 all", "30 ft", "Medium"]);
    expect(card("Half-Elf").tags?.slice(0, 4)).toEqual(["+2 Cha", "+1 to 2 of your choice", "30 ft", "Medium"]);
  });

  it("carry the full SRD text behind Read more", () => {
    expect(card("Dwarf").description).toMatch(/^Age\. Dwarves mature at the same rate as humans/);
  });
});

describe("each class matches the check table", () => {
  for (const [id, facts] of Object.entries(CLASSES)) {
    it(facts.name, () => {
      const ref = `srd-5.1:${id}`;
      const v = view({ race: "srd-5.1:human", ...pointBuy(TENS), "class.class": ref });
      const step = v.steps.find((s) => s.id === "class")!;
      expect(v.derived["hit-dice"].value).toBe(`1d${facts.hitDie}`);
      expect(v.derived.hp.value).toBe(facts.hitDie); // Con 11 with the human's +1: modifier 0
      expect(names(v, "saving-throws")).toEqual(facts.saves);
      const skills = step.choices.find((c) => c.key === `class.${ref}.skills`)!;
      expect([skills.count?.min, skills.options?.length]).toEqual(facts.skills);
      const cls = content.get("classes", ref) as unknown as { subclass: { name: string; level: number } };
      expect(cls.subclass).toEqual(facts.subclass);
      // The subclass choice is on this step only when the subclass comes at level 1.
      expect(step.choices.some((c) => c.key === `class.${ref}.subclass`)).toBe(facts.subclass.level === 1);
      const gained = (v.lists["gains.class"] ?? []).filter((g) => g.source === `${facts.name} 1`).map((g) => g.name.replace(/[:(].*$/, "").trim());
      for (const f of facts.level1) expect(gained, f).toContain(f);
    });
  }

  it("every class has its one SRD subclass", () => {
    expect(content.list("subclasses").map((s) => `${s.name} (${String(s.class)})`)).toEqual([
      "Berserker (barbarian)", "Lore (bard)", "Life (cleric)", "Land (druid)", "Champion (fighter)", "Open Hand (monk)",
      "Devotion (paladin)", "Hunter (ranger)", "Thief (rogue)", "Draconic (sorcerer)", "Fiend (warlock)", "Evocation (wizard)",
    ]);
  });
});

describe("real SRD classes through the engine", () => {
  const STANDARD = { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 };

  it("a Hill Dwarf Barbarian: d12 + Con + Dwarven Toughness, Unarmored Defense, two rages", () => {
    const v = view({ race: "srd-5.1:dwarf", "race.srd-5.1:dwarf.subrace": "srd-5.1:hill-dwarf", ...standardArray(STANDARD), "class.class": "srd-5.1:barbarian" });
    expect(v.derived.hp.breakdown).toEqual([
      { label: "Barbarian level 1 (d12, highest)", amount: 12 }, { label: "Constitution", amount: 2 }, { label: "Hill Dwarf", amount: 1 },
    ]);
    expect(v.derived.ac.breakdown).toEqual([{ label: "Barbarian (unarmoured)", amount: 10 }, { label: "Dexterity", amount: 2 }, { label: "Constitution", amount: 2 }]);
    expect(v.lists["gains.class"].find((g) => g.name === "Rage")?.detail).toBe("2 per long rest");
  });

  it("a Monk: AC 10 + Dex + Wis, and a choice of artisan's tools or an instrument", () => {
    const v = view({ race: "srd-5.1:human", ...standardArray({ str: 8, dex: 15, con: 13, int: 10, wis: 14, cha: 12 }), "class.class": "srd-5.1:monk" });
    expect(v.derived.ac.value).toBe(10 + 3 + 2);
    const tools = v.steps.find((s) => s.id === "class")!.choices.find((c) => c.key === "class.srd-5.1:monk.tools")!;
    expect(tools.options).toHaveLength(29);
    expect(tools.options?.map((o) => o.name)).toContain("Lute");
  });

  it("a Draconic Sorcerer: the origin at level 1, +1 HP per level, AC 13 + Dex, and Draconic", () => {
    const base = { race: "srd-5.1:human", "race.srd-5.1:human.language": "srd-5.1:elvish", ...standardArray(STANDARD), "class.class": "srd-5.1:sorcerer" };
    const origin = view(base).steps.find((s) => s.id === "class")!.choices.find((c) => c.key === "class.srd-5.1:sorcerer.subclass")!;
    expect(origin.label).toBe("Choose your Sorcerous Origin");
    const v = view({ ...base, "class.srd-5.1:sorcerer.subclass": "srd-5.1:draconic", "class.srd-5.1:draconic.dragon-ancestor": "red-fire-damage" });
    expect(v.derived.hp.value).toBe(6 + 2 + 1); // d6, Con 14 (+2), Draconic Resilience
    expect(v.derived.ac.value).toBe(13 + 2);
    expect(names(v, "languages")).toEqual(["Common", "Elvish", "Draconic"]);
  });

  it("a Life Cleric gets heavy armour; a Bard's inspiration counts Charisma", () => {
    const cleric = view({ race: "srd-5.1:human", ...standardArray(STANDARD), "class.class": "srd-5.1:cleric", "class.srd-5.1:cleric.subclass": "srd-5.1:life" });
    expect(names(cleric, "other-proficiencies")).toContain("Heavy armor");
    const bard = view({ race: "srd-5.1:half-elf", ...standardArray(STANDARD), "class.class": "srd-5.1:bard" });
    expect(bard.lists["gains.class"].find((g) => g.name === "Bardic Inspiration (d6)")?.detail).toBe("1 per long rest"); // Cha 12: +1
  });

  it("a Rogue's expertise can go to thieves' tools", () => {
    const v = view({ race: "srd-5.1:human", ...standardArray(STANDARD), "class.class": "srd-5.1:rogue" });
    const expertise = v.steps.find((s) => s.id === "class")!.choices.find((c) => c.key === "class.srd-5.1:rogue.expertise-1")!;
    expect(expertise.options?.map((o) => o.value)).toEqual(["tool:thieves-tools"]);
  });
});

describe("each background matches the check table", () => {
  for (const [id, facts] of Object.entries(BACKGROUNDS)) {
    it(facts.name, () => {
      const ref = `srd-5.1:${id}`;
      const v = view({ race: "srd-5.1:human", ...pointBuy(TENS), background: ref });
      const step = v.steps.find((s) => s.id === "background")!;
      expect(names(v, "proficiencies", "skill")).toEqual(facts.skills);
      expect(step.choices.find((c) => c.key === `background.${ref}.languages`)?.count?.min).toBe(facts.languages);
      expect((v.lists["gains.background"] ?? []).map((g) => g.name)).toEqual([facts.feature]);
      const details = v.steps.find((s) => s.id === "details")!; // personality is written on the Details step
      const traits = details.choices.find((c) => c.key === "background.traits")!;
      const ideal = details.choices.find((c) => c.key === "background.ideal")!;
      const bond = details.choices.find((c) => c.key === "background.bond")!;
      const flaw = details.choices.find((c) => c.key === "background.flaw")!;
      expect([traits, ideal, bond, flaw].map((c) => c.suggestions?.length)).toEqual([facts.tables.traits, facts.tables.ideals, facts.tables.bonds, facts.tables.flaws]);
      expect(kitFacts(entry("backgrounds", id).startingEquipment!)).toEqual(facts.kit);
    });
  }

  it("the Acolyte's ideals carry the SRD's one-word alignments", () => {
    const v = view({ background: "srd-5.1:acolyte" });
    const ideal = v.steps.find((s) => s.id === "details")!.choices.find((c) => c.key === "background.ideal")!;
    expect(ideal.suggestions?.map((s) => s.note)).toEqual(["Lawful", "Good", "Chaotic", "Lawful", "Lawful", "Any"]);
  });

  it("a Half-Elf who chose Insight, then the Acolyte: the Acolyte's Insight is swapped for another skill", () => {
    const v = view({ race: "srd-5.1:half-elf", "race.srd-5.1:half-elf.skills": ["insight", "stealth"], background: "srd-5.1:acolyte" });
    const replace = v.steps.find((s) => s.id === "background")!.choices.find((c) => c.key === "background.replace.insight")!;
    expect(replace.label).toBe("Acolyte gives Insight, which you already have from Half-Elf: choose another skill");
    expect(v.issues.filter((i) => i.key === "race.srd-5.1:half-elf.skills")).toEqual([]);
  });
});

describe("each class's starting equipment matches the check table", () => {
  for (const [id, facts] of Object.entries(KITS)) {
    it(id, () => expect(kitFacts(entry("classes", id).startingEquipment!)).toEqual(facts));
  }

  it("every 'any' line, in every class and background, has items to pick from", () => {
    const kits = [...committed.collections.classes, ...committed.collections.backgrounds].map((e: { startingEquipment: StartingEquipment }) => e.startingEquipment);
    const lines = kits.flatMap((k: StartingEquipment) => [...(k.items ?? []), ...(k.choices ?? []).flatMap((c) => c.options.flatMap((o) => o.items))]);
    const items = committed.collections.items as { categories: string[] }[];
    for (const l of lines.filter((l: EquipmentLine) => "any" in l) as Extract<EquipmentLine, { any: unknown }>[]) {
      expect(items.filter((i) => l.any.categories.every((c) => i.categories.includes(c))).length, l.label).toBeGreaterThan(0);
    }
  });

  it("no class has starting-wealth dice: SRD 5.1 has no such table", () => {
    expect(committed.collections.classes.filter((c: { startingWealth?: string }) => c.startingWealth)).toEqual([]);
  });
});

describe("real SRD equipment through the engine", () => {
  const C = "equipment.class.srd-5.1:fighter";
  const A = "equipment.background.srd-5.1:acolyte";
  const fighterAcolyte = {
    race: "srd-5.1:human", "race.srd-5.1:human.language": "srd-5.1:elvish", ...standardArray({ str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }),
    "class.class": "srd-5.1:fighter", background: "srd-5.1:acolyte", "equipment.method": "packages",
    [`${C}.chain-mail-or-leather-armor`]: "a",
    [`${C}.martial-weapons-and-shield-or-martial-weapons`]: "a", [`${C}.martial-weapons-and-shield-or-martial-weapons.a.0`]: "srd-5.1:longsword",
    [`${C}.crossbow-light-or-handaxe`]: "a", [`${C}.dungeoneers-pack-or-explorers-pack`]: "b",
    [`${A}.items.0`]: "srd-5.1:amulet", [`${A}.prayer-book-or-prayer-wheel`]: "a",
    "equipment.armor": "srd-5.1:chain-mail", "equipment.shield": "shield",
  };

  it("a Fighter Acolyte in chain mail with a shield and a longsword", () => {
    const v = view(fighterAcolyte);
    expect(v.steps.find((s) => s.id === "equipment")?.status).toBe("done");
    expect(v.derived.ac).toMatchObject({ value: 18, breakdown: [{ label: "Chain Mail", amount: 16 }, { label: "Shield", amount: 2 }] });
    // Human Str 16 (+3), proficient with martial weapons; the light crossbow uses Dex 14 (+2).
    expect(v.derived["attack.srd-5.1:longsword"].value).toBe("+5 to hit, 1d8+3 slashing (1d10+3 two-handed)");
    expect(v.derived["attack.srd-5.1:crossbow-light"].value).toBe("+4 to hit, 1d8+2 piercing");
    expect(v.derived.coins).toMatchObject({ value: 1500 });
    const inventory = names(v, "inventory");
    for (const thing of ["Chain Mail", "Shield", "Longsword", "Crossbow, light", "Crossbow bolt × 20", "Backpack", "Torch × 10", "Amulet", "Prayer book", "Sticks of incense × 5", "Vestments"]) {
      expect(inventory).toContain(thing);
    }
    expect(v.issues.filter((i) => i.step === "equipment")).toEqual([]);
  });

  it("starting gold: SRD classes have no wealth dice, so the DM's amount is entered, and the whole SRD is for sale", () => {
    const v = view({ "class.class": "srd-5.1:wizard", "equipment.method": "gold", "equipment.gold": 80, "equipment.shop": { "srd-5.1:quarterstaff": 1, "srd-5.1:spellbook": 1 } });
    const step = v.steps.find((s) => s.id === "equipment")!;
    expect(step.choices.find((c) => c.key === "equipment.gold")?.kind).toBe("number");
    expect(step.choices.find((c) => c.key === "equipment.shop")?.options?.length).toBe(230); // every item with a price
    expect(v.derived.coins.value).toBe(8000 - 20 - 5000);
  });
});

describe("each caster matches the check table at level 1", () => {
  for (const [id, facts] of Object.entries(CASTERS)) {
    it(id, () => {
      const ref = `srd-5.1:${id}`;
      const v = view({ ...pointBuy(TENS), "class.class": ref });
      const step = v.steps.find((s) => s.id === "spells")!;
      const c = (what: string) => step.choices.find((x) => x.key === `spells.${ref}.${what}`);
      const cls = committed.collections.classes.find((x: { id: string }) => x.id === id);
      expect(cls.spellcasting).toMatchObject({ ability: facts.ability, level: facts.starts });
      if (facts.starts > 1) {
        expect(step.choices).toEqual([]);
        return;
      }
      expect(c("cantrips")?.count?.min).toBe(facts.cantrips);
      expect(c("cantrips")?.options?.map((o) => o.name)).toEqual(facts.cantripList);
      expect(c("known")?.count?.min).toBe(facts.known);
      expect(c("spellbook")?.count?.min).toBe(facts.spellbook);
      expect(v.derived["spell.slots"].value).toBe(`1st: ${facts.slots1}${id === "warlock" ? " (short rest)" : ""}`);
    });
  }
});

describe("real SRD spells through the engine", () => {
  it("319 spells, each on at least one class list, with the SRD's eight schools", () => {
    const spells = committed.collections.spells as { classes: string[]; school: string }[];
    expect(spells.length).toBe(319);
    expect(spells.filter((s) => s.classes.length === 0)).toEqual([]);
    expect(new Set(spells.map((s) => s.school)).size).toBe(8);
  });

  it("a Life Domain cleric always has Bless and Cure Wounds; a High Elf wizard's cantrip is cast with Int; a tiefling's Thaumaturgy with Cha", () => {
    const life = view({ ...pointBuy(TENS), "class.class": "srd-5.1:cleric", "class.srd-5.1:cleric.subclass": "srd-5.1:life" });
    expect(names(life, "spells")).toEqual(["Bless (always prepared)", "Cure Wounds (always prepared)"]);
    const elf = view({ race: "srd-5.1:elf", "race.srd-5.1:elf.subrace": "srd-5.1:high-elf", "race.srd-5.1:high-elf.cantrip": "srd-5.1:fire-bolt" });
    expect(elf.lists["spell-list"]).toEqual([{ name: "Fire Bolt", source: "High Elf", detail: "Cantrip · cast with Intelligence", description: expect.stringMatching(/^You hurl a mote of fire/), group: "Cantrips" }]);
    const tiefling = view({ race: "srd-5.1:tiefling", "class.class": "srd-5.1:wizard" });
    expect(tiefling.derived["spell.dc.cha"].label).toBe("Spell save DC (Charisma)");
  });

  it("a Fiend warlock's expanded spells join its choices", () => {
    // The Fiend is chosen at level 1 in the SRD (Otherworldly Patron).
    const v = view({ "class.class": "srd-5.1:warlock", "class.srd-5.1:warlock.subclass": "srd-5.1:fiend" });
    const known = v.steps.find((s) => s.id === "spells")!.choices.find((c) => c.key === "spells.srd-5.1:warlock.known")!;
    expect(known.options?.map((o) => o.name)).toEqual(expect.arrayContaining(["Burning Hands", "Command"]));
  });
});
