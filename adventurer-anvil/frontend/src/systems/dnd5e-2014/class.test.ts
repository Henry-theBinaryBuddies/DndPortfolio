// The Class step, end to end with the sample pack's Fighter and Rogue: the class cards, level-1 choices,
// hit points, Armor Class, expertise, what the class gives, and the format checks for classes.
import { describe, expect, it } from "vitest";
import { createContentIndex, newCharacterDocument, readPack, setChoice, viewCharacter, type ChoiceValue, type SystemModule } from "../../core";
import { dnd5e2014 } from "./module";
import { CLASS_KEY, columnsAt } from "./steps/class";
import { standardArray } from "./testing/abilities";
import sample from "./testing/elf-sample.pack.json";

const T = "2026-11-13T10:00:00.000Z";
const pack = (() => {
  const result = readPack(sample, dnd5e2014, []);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.pack;
})();
const content = createContentIndex([pack]);

function view(choices: Record<string, ChoiceValue>) {
  let doc = newCharacterDocument({ id: "c", system: { id: "dnd5e-2014", version: 1 }, packs: [{ id: "sample-srd", version: "0.1.0" }], now: T });
  for (const [key, value] of Object.entries(choices)) doc = setChoice(doc, key, value, T);
  return viewCharacter(dnd5e2014, doc, content);
}
const classStep = (v: ReturnType<typeof view>) => v.steps.find((s) => s.id === "class")!;
const choice = (v: ReturnType<typeof view>, key: string) => classStep(v).choices.find((c) => c.key === key)!;
const names = (v: ReturnType<typeof view>, list: string) => (v.lists[list] ?? []).map((i) => i.name);

// A High Elf: Str 8, Dex 16, Con 13, Int 16, Wis 12, Cha 10 (proficient in Perception from Elf).
const highElf = {
  race: "sample-srd:elf",
  "race.sample-srd:elf.subrace": "sample-srd:high-elf",
  "race.sample-srd:high-elf.language": "sample-srd:dwarvish",
  ...standardArray({ str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }),
};
const fighter = { ...highElf, [CLASS_KEY]: "sample-srd:fighter" };
const rogue = { ...highElf, [CLASS_KEY]: "sample-srd:rogue" };

describe("choosing a class", () => {
  it("offers each class as a card: hit die, key abilities, saving throws", () => {
    const options = choice(view(highElf), CLASS_KEY).options!;
    expect(options.map((o) => [o.name, o.tags])).toEqual([
      ["Fighter", ["d10 hit die", "Str or Dex", "Saves: Str, Con"]],
      ["Rogue", ["d8 hit die", "Dex", "Saves: Dex, Int"]],
      ["Wizard", ["d6 hit die", "Int", "Saves: Int, Wis"]],
      ["Cleric", ["d8 hit die", "Wis", "Saves: Wis, Cha"]],
      ["Paladin", ["d10 hit die", "Str and Cha"]],
    ]);
  });

  it("before a class: level 1, no hit points yet, and the step to do", () => {
    const v = view(highElf);
    expect(v.derived.level.breakdown).toEqual([{ label: "No class yet", amount: 1 }]);
    expect(v.derived.hp).toBeUndefined();
    expect(classStep(v).status).toBe("todo");
  });

  it("a Fighter: full hit die plus Con at level 1, 1d10 hit dice, Str and Con saves, armour and weapons", () => {
    const v = view(fighter);
    expect(v.derived.hp).toEqual({
      value: 11, label: "Hit points",
      breakdown: [{ label: "Fighter hit die (d10, highest at level 1)", amount: 10 }, { label: "Constitution", amount: 1 }],
    });
    expect(v.derived["hit-dice"].value).toBe("1d10");
    expect(v.derived.level.breakdown).toEqual([{ label: "Fighter", amount: 1 }]);
    expect(names(v, "saving-throws")).toEqual(["Strength", "Constitution"]);
    expect(v.derived["save.str"].breakdown).toEqual([{ label: "Strength", amount: -1 }, { label: "Proficient (Fighter)", amount: 2 }]);
    expect(v.lists["other-proficiencies"].filter((i) => i.source === "Fighter").map((i) => i.name)).toEqual(["Light armor", "Medium armor", "Heavy armor", "Shields", "Simple weapons", "Martial weapons"]);
  });

  it("only level-1 features apply: Second Wind with its uses, not Action Surge (level 2)", () => {
    const v = view(fighter);
    expect(v.lists["gains.class"]).toEqual([
      { name: "Second Wind", source: "Fighter", detail: "1 per short rest", description: undefined },
    ]);
    expect(names(v, "resources")).toEqual(["Second Wind"]);
  });

  it("marks a skill you already have, and reports picking it anyway", () => {
    const skills = choice(view(fighter), "class.sample-srd:fighter.skills");
    expect(skills.options!.find((o) => o.value === "perception")?.unavailable).toBe("Already proficient (Elf)");
    const v = view({ ...fighter, "class.sample-srd:fighter.skills": ["perception", "athletics"] });
    expect(v.issues.map((i) => i.id)).toContain("already-have:class.sample-srd:fighter.skills:perception");
  });

  it("a fighting style is a written-in option; Defense adds nothing unarmoured", () => {
    const style = choice(view(fighter), "class.sample-srd:fighter.fighting-style");
    expect(style.options!.map((o) => [o.name, o.tags])).toEqual([["Defense", ["+1 AC in armour"]], ["Dueling", []]]);
    const v = view({ ...fighter, "class.sample-srd:fighter.fighting-style": "defense" });
    expect(v.derived.ac.value).toBe(13);
  });

  it("is done once the class's choices are made", () => {
    const v = view({ ...fighter, "class.sample-srd:fighter.skills": ["athletics", "survival"], "class.sample-srd:fighter.fighting-style": "defense" });
    expect(classStep(v).status).toBe("done");
    expect(v.issues.filter((i) => i.step === "class")).toEqual([]);
  });

  it("switching class keeps the other class's picks, listed as unused", () => {
    const v = view({ ...rogue, "class.sample-srd:fighter.fighting-style": "defense" });
    expect(v.unused).toEqual(["class.sample-srd:fighter.fighting-style"]);
    expect(v.derived["hit-dice"].value).toBe("1d8");
  });
});

describe("expertise: the Rogue", () => {
  const withSkills = { ...rogue, "class.sample-srd:rogue.skills": ["stealth", "acrobatics", "deception", "insight"] };

  it("offers your proficient skills and thieves' tools, whichever step gave them", () => {
    const options = choice(view(withSkills), "class.sample-srd:rogue.expertise").options!;
    expect(options.map((o) => o.value)).toEqual(["skill:acrobatics", "skill:deception", "skill:insight", "skill:perception", "skill:stealth", "tool:thieves-tools"]);
    expect(options.find((o) => o.value === "skill:perception")?.summary).toBe("Proficient (Elf)");
  });

  it("doubles the proficiency bonus, and marks it in the lists", () => {
    const v = view({ ...withSkills, "class.sample-srd:rogue.expertise": ["skill:stealth", "tool:thieves-tools"] });
    expect(v.derived["skill.stealth"].breakdown).toEqual([
      { label: "Dexterity", amount: 3 }, { label: "Proficient (Rogue)", amount: 2 }, { label: "Expertise (Rogue)", amount: 2 },
    ]);
    expect(names(v, "skills")).toContain("Stealth (expertise)");
    expect(names(v, "other-proficiencies")).toContain("Thieves Tools (expertise)");
    expect(classStep(v).status).toBe("done");
  });

  it("refuses expertise in a skill you are not proficient in", () => {
    const v = view({ ...withSkills, "class.sample-srd:rogue.expertise": ["skill:athletics", "skill:stealth"] });
    expect(v.issues.map((i) => i.id)).toContain("invalid-pick:class.sample-srd:rogue.expertise:skill:athletics");
    expect(v.derived["skill.athletics"].breakdown).toEqual([{ label: "Strength", amount: -1 }]);
  });
});

describe("class table columns", () => {
  it("a value lasts until the next level that gives one", () => {
    const columns = [{ id: "dice", values: { "1": "1d6", "3": "2d6" } }];
    expect([1, 2, 3, 4].map((l) => columnsAt(columns, l).dice)).toEqual(["1d6", "1d6", "2d6", "2d6"]);
    expect(columnsAt([{ id: "surges", values: { "2": 1 } }], 1)).toEqual({});
  });
});

describe("the class format's checks", () => {
  const dnd: SystemModule = { ...dnd5e2014 };
  const errorsFor = (edit: (p: any) => void) => {
    const copy = structuredClone(sample) as any;
    edit(copy);
    const result = readPack(copy, dnd, []);
    return result.ok ? [] : result.errors;
  };
  const fighterAt = "collections.classes[0]";

  it("accepts the sample", () => expect(errorsFor(() => {})).toEqual([]));

  it("a resource counting from a column the class table doesn't have", () => {
    expect(errorsFor((p) => (p.collections.classes[0].levels[1].effects[0].uses = { column: "action-surge" }))).toEqual([
      `${fighterAt}.levels[1].effects[0].uses: no column "action-surge" in the class table.`,
    ]);
  });

  it("a race counting uses per level", () => {
    expect(errorsFor((p) => p.collections.races[0].effects.push({ type: "resource", id: "x", uses: { perLevel: 2 }, recharge: "long" }))).toEqual([
      "collections.races[0].effects[8].uses: only classes and subclasses have levels and table columns to count from.",
    ]);
  });

  it("levels out of order, and a choice id used twice in one class", () => {
    expect(errorsFor((p) => (p.collections.classes[0].levels[1].level = 1))).toEqual([
      `${fighterAt}.levels[1]: levels must rise (level 1 comes after level 1).`,
    ]);
    expect(errorsFor((p) => (p.collections.classes[0].levels[0].effects[0].id = "skills"))).toEqual([
      `${fighterAt}.levels[0].effects[0]: the choice id "skills" is also used at ${fighterAt}.proficiencies[8].`,
    ]);
  });

  it("a pick among your proficiencies without its expertise template", () => {
    expect(errorsFor((p) => delete p.collections.classes[1].levels[0].effects[0].each)).toEqual([
      'collections.classes[1].levels[0].effects[0].each: picks from your proficiencies fill in an expertise effect: give "each": { "type": "expertise" }.',
    ]);
  });

  it("a hit die that isn't one, and a subclass of a class that doesn't exist", () => {
    expect(errorsFor((p) => (p.collections.classes[0].hitDie = 7))).toEqual([`${fighterAt}.hitDie: a hit die of 6, 8, 10 or 12`]);
    expect(errorsFor((p) => (p.collections.subclasses[0].class = "figher"))).toEqual([
      'collections.subclasses[0].class: no classes entry "figher" in this pack.',
    ]);
  });
});
