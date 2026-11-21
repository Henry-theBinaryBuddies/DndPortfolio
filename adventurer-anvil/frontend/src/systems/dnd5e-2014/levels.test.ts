// Levels 1 to 20 and multiclassing, through the real SRD 5.1 pack: hit points, proficiencies from a second class,
// prerequisites, Ability Score Improvements, subclasses at their level, multiclass spell slots, Eldritch Invocations,
// Mystic Arcanum, Magical Secrets, every class at level 20, the list's words, and levelling up.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createContentIndex, newCharacterDocument, readPack, setChoice, viewCharacter, type ChoiceValue } from "../../core";
import { describe as blurb, dnd5e2014, levelUp } from "./module";
import { CLASS_KEY, LEVEL_KEY, MULTI_KEY } from "./steps/class";
import { casterLevels, MULTICLASS_SLOTS } from "./steps/spells";
import { standardArray } from "./testing/abilities";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const committed = JSON.parse(readFileSync(join(ROOT, "frontend/public/packs/srd-5.1.pack.json"), "utf8"));
const result = readPack(committed, dnd5e2014, []);
if (!result.ok) throw new Error(result.errors.join("\n"));
const content = createContentIndex([result.pack]);
const T = "2026-11-21T10:00:00Z";

function doc(choices: Record<string, ChoiceValue>) {
  let d = newCharacterDocument({ id: "c", system: { id: "dnd5e-2014", version: 1 }, packs: [{ id: "srd-5.1", version: committed.version }], now: T });
  for (const [k, v] of Object.entries(choices)) d = setChoice(d, k, v, T);
  return d;
}
const view = (choices: Record<string, ChoiceValue>) => viewCharacter(dnd5e2014, doc(choices), content);
type View = ReturnType<typeof view>;
const allChoices = (v: View) => v.steps.flatMap((s) => s.choices);
const choice = (v: View, key: string) => allChoices(v).find((c) => c.key === key);
const ids = (v: View) => v.issues.map((i) => i.id);
const issue = (v: View, id: string) => v.issues.find((i) => i.id === id);
const names = (v: View, list: string) => (v.lists[list] ?? []).map((i) => i.name);

// A human (+1 to every score): Str 16, Dex 14, Con 15, Int 13, Wis 11, Cha 9.
const human = { race: "srd-5.1:human", ...standardArray({ str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8 }) };
const F = "srd-5.1:fighter";
const W = "srd-5.1:wizard";
const fighterWizard = { ...human, [CLASS_KEY]: F, [LEVEL_KEY]: 5, [MULTI_KEY]: { [W]: 1 } };

describe("levels and hit points", () => {
  it("a Fighter 4 / Wizard 1: the first class has the levels left over; hit points take the average after level 1", () => {
    const v = view(fighterWizard);
    expect(v.derived.level.breakdown).toEqual([{ label: "Fighter", amount: 4 }, { label: "Wizard", amount: 1 }]);
    expect(v.derived["proficiency-bonus"].value).toBe(3);
    expect(v.derived.hp).toEqual({
      value: 42, label: "Hit points",
      breakdown: [
        { label: "Fighter level 1 (d10, highest)", amount: 10 },
        { label: "Fighter levels 2–4 (d10, average 6 each)", amount: 18 },
        { label: "Wizard level 1 (d6, average 4)", amount: 4 },
        { label: "Constitution × 5", amount: 10 },
      ],
    });
    expect(v.derived["hit-dice"].value).toBe("4d10 + 1d6");
  });

  it("a class's per-level hit points count its own levels; a race's count every level", () => {
    const v = view({
      race: "srd-5.1:dwarf", "race.srd-5.1:dwarf.subrace": "srd-5.1:hill-dwarf", ...standardArray({ str: 10, dex: 12, con: 13, int: 8, wis: 14, cha: 15 }),
      [CLASS_KEY]: "srd-5.1:sorcerer", [LEVEL_KEY]: 4, [MULTI_KEY]: { [F]: 1 }, "class.srd-5.1:sorcerer.subclass": "srd-5.1:draconic",
    });
    const lines = v.derived.hp.breakdown;
    expect(lines).toContainEqual({ label: "Hill Dwarf × 4", amount: 4 });
    expect(lines).toContainEqual({ label: "Draconic × 3", amount: 3 });
  });

  it("the level is a whole number from 1 to 20, and other classes can't take every level", () => {
    expect(issue(view({ ...human, [CLASS_KEY]: F, [LEVEL_KEY]: 25 }), "level-range")?.message).toBe("Level: a whole number from 1 to 20. Counted as 1 for now.");
    const v = view({ ...human, [CLASS_KEY]: F, [LEVEL_KEY]: 2, [MULTI_KEY]: { [W]: 2 } });
    expect(issue(v, "multiclass-levels")?.message).toBe("Other classes: 2 levels given, but at level 2 only 1 can be (your Fighter keeps at least 1).");
    expect(v.derived.level.breakdown).toEqual([{ label: "Fighter", amount: 1 }, { label: "Wizard", amount: 2 }]);
  });

  it("other classes are offered as steppers with their prerequisites, sharing all but one level", () => {
    const multi = choice(view(fighterWizard), MULTI_KEY)!;
    expect(multi).toMatchObject({ kind: "quantities", presentation: "steppers", budget: { total: 4 } });
    expect(multi.options?.find((o) => o.value === W)).toMatchObject({ summary: "Needs Int 13" });
    expect(multi.options?.find((o) => o.value === "srd-5.1:bard")?.unavailable).toBe("Needs Cha 13 (you have Charisma 9)");
    expect(multi.options?.some((o) => o.value === F)).toBe(false);
  });
});

describe("multiclassing", () => {
  it("only the first class gives saving throws; a later class gives its multiclass proficiencies", () => {
    const v = view({ ...human, [CLASS_KEY]: W, [LEVEL_KEY]: 2, [MULTI_KEY]: { "srd-5.1:rogue": 1 } });
    expect(names(v, "saving-throws")).toEqual(["Intelligence", "Wisdom"]);
    expect(v.lists["other-proficiencies"].filter((p) => p.source === "Rogue").map((p) => p.name)).toEqual(["Light armor", "Thieves' Tools"]);
    expect(choice(v, "class.srd-5.1:rogue.multiclass-skills")).toMatchObject({ source: "Rogue 1", kind: "pick-one", label: "Choose one skill" });
  });

  it("needs the new class's scores and the first class's, as problems a DM can allow", () => {
    const low = { race: "srd-5.1:human", ...standardArray({ str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 }) }; // Int 11
    const v = view({ ...low, [CLASS_KEY]: F, [LEVEL_KEY]: 2, [MULTI_KEY]: { [W]: 1 } });
    expect(issue(v, `multiclass-prerequisite:${W}`)).toMatchObject({ overridable: true, message: "Multiclassing into Wizard needs Int 13; you have Intelligence 11." });

    const weakWizard = { race: "srd-5.1:human", ...standardArray({ str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }) }; // Int 9
    const w = view({ ...weakWizard, [CLASS_KEY]: W, [LEVEL_KEY]: 2, [MULTI_KEY]: { [F]: 1 } });
    expect(issue(w, "multiclass-prerequisite:first")?.message).toBe("Leaving Wizard for another class needs Int 13; you have Intelligence 9.");
    expect(ids(w)).not.toContain(`multiclass-prerequisite:${F}`);
  });

  it("the list says each class and its level", () => {
    expect(blurb(doc(fighterWizard), content).text).toBe("Human Fighter 4 / Wizard 1");
    expect(blurb(doc({ ...human, [CLASS_KEY]: "srd-5.1:cleric" }), content).text).toBe("Human Cleric 1");
  });
});

describe("choices at higher levels", () => {
  it("a Fighter 3 chooses a Martial Archetype; its features say the level they come at", () => {
    const v = view({ ...human, [CLASS_KEY]: F, [LEVEL_KEY]: 3, "class.srd-5.1:fighter.subclass": "srd-5.1:champion" });
    expect(choice(v, "class.srd-5.1:fighter.subclass")).toMatchObject({ label: "Choose your Martial Archetype", source: "Fighter 3" });
    expect(v.lists["gains.class"].find((g) => g.name === "Improved Critical")?.source).toBe("Champion (Fighter 3)");
    expect(v.lists["gains.class"].find((g) => g.name === "Action Surge (1 use)")?.source).toBe("Fighter 2");
  });

  it("an Ability Score Improvement: 2 points on the scores, at most 2 to one, none above 20", () => {
    const key = "class.srd-5.1:fighter.asi-4";
    const at4 = view({ ...human, [CLASS_KEY]: F, [LEVEL_KEY]: 4 });
    expect(choice(at4, key)).toMatchObject({ kind: "allocate", label: "Ability Score Improvement", source: "Fighter 4", range: { min: 0, max: 2 }, answered: false });
    const plus2 = view({ ...human, [CLASS_KEY]: F, [LEVEL_KEY]: 4, [key]: { str: 2 } });
    expect(plus2.derived["ability.str"]).toMatchObject({ value: 18 });
    expect(plus2.derived["ability.str"].breakdown.at(-1)).toEqual({ label: "Ability Score Improvement (Fighter 4)", amount: 2 });
    expect(choice(plus2, key)?.answered).toBe(true);
    expect(ids(view({ ...human, [CLASS_KEY]: F, [LEVEL_KEY]: 4, [key]: { str: 3 } }))).toContain(`improvement:${key}`);
    expect(ids(view({ ...human, [CLASS_KEY]: F, [LEVEL_KEY]: 4, [key]: { str: 2, dex: 1 } }))).toContain(`improvement:${key}`);

    // A half-orc's Str 17, + 2 at Fighter 4 = 19, + 2 at Fighter 6 = 21: over the cap, which a DM can allow.
    const big = view({ race: "srd-5.1:half-orc", ...standardArray({ str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8 }), [CLASS_KEY]: F, [LEVEL_KEY]: 8, [key]: { str: 2 }, "class.srd-5.1:fighter.asi-6": { str: 2 } });
    expect(big.derived["ability.str"].value).toBe(21);
    expect(issue(big, "above-cap:class.srd-5.1:fighter.asi-6:str")).toMatchObject({ step: "class", overridable: true, message: "Ability Score Improvement (Fighter 6): Strength would be 21, but this can't raise a score above 20." });
    expect(ids(big)).not.toContain("score-above-20:str");
  });

  it("a written-in option already chosen elsewhere can't be chosen again (a second Fighting Style)", () => {
    const v = view({
      ...human, [CLASS_KEY]: F, [LEVEL_KEY]: 10, "class.srd-5.1:fighter.subclass": "srd-5.1:champion",
      "class.srd-5.1:fighter.fighting-style": "defense", "class.srd-5.1:champion.additional-fighting-style": "defense",
    });
    expect(choice(v, "class.srd-5.1:champion.additional-fighting-style")?.options?.find((o) => o.value === "defense")?.unavailable).toBe("Already chosen (Fighter 1)");
    expect(ids(v)).toContain("already-have:class.srd-5.1:champion.additional-fighting-style:defense");
  });

  it("every SRD class reaches level 20 with every choice offering something", () => {
    for (const cls of content.list("classes")) {
      // The class's skills first, so Expertise has proficiencies to choose from.
      const base = { ...human, [CLASS_KEY]: cls.ref, [LEVEL_KEY]: 20 };
      const skills = choice(view(base), `class.${cls.ref}.skills`)!;
      const v = view({ ...base, [skills.key]: skills.options!.filter((o) => !o.unavailable).slice(0, skills.count!.max).map((o) => String(o.value)) });
      expect(v.derived.level.value, cls.name).toBe(20);
      expect(v.derived["proficiency-bonus"].value).toBe(6);
      expect(ids(v).filter((i) => i.startsWith("no-options:")), cls.name).toEqual([]);
      const improvements = allChoices(v).filter((c) => c.label === "Ability Score Improvement").length;
      expect(improvements, cls.name).toBe(cls.id === "fighter" ? 7 : cls.id === "rogue" ? 6 : 5);
    }
  });
});

describe("spellcasting across classes", () => {
  it("the multiclass table: full levels, half a half caster's (rounded down)", () => {
    expect(casterLevels("full", 3) + casterLevels("half", 3)).toBe(4);
    expect(casterLevels("third", 8)).toBe(2);
    expect(casterLevels("pact", 5)).toBe(0);
    expect(MULTICLASS_SLOTS[4]).toEqual([4, 3]);
    expect(MULTICLASS_SLOTS[20]).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  });

  it("a Paladin 3 / Sorcerer 3 shares caster level 4's slots; each class learns from its own table", () => {
    const charming = { race: "srd-5.1:human", ...standardArray({ str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 }) };
    const v = view({ ...charming, [CLASS_KEY]: "srd-5.1:paladin", [LEVEL_KEY]: 6, [MULTI_KEY]: { "srd-5.1:sorcerer": 3 } });
    expect(v.derived["spell.slots"].breakdown).toEqual([
      { label: "Multiclass spellcaster (caster level 4)", amount: "1st: 4, 2nd: 3" },
    ]);
    expect(choice(v, "spells.srd-5.1:sorcerer.known")).toMatchObject({ label: "Sorcerer spells known (4)", hint: "1st- to 2nd-level spells from the sorcerer spell list." });
    expect(choice(v, "spells.srd-5.1:paladin.prepared")).toMatchObject({ label: "Paladin: prepared today (optional)", source: "Paladin 3" });
    // A paladin 3 learns only 1st-level spells.
    expect(choice(v, "spells.srd-5.1:paladin.prepared")?.options?.every((o) => o.summary?.startsWith("1st-level"))).toBe(true);
  });

  it("Pact Magic stays separate from another class's slots", () => {
    const charming = { race: "srd-5.1:human", ...standardArray({ str: 8, dex: 12, con: 13, int: 14, wis: 10, cha: 15 }) };
    const v = view({ ...charming, [CLASS_KEY]: "srd-5.1:warlock", [LEVEL_KEY]: 5, [MULTI_KEY]: { [W]: 3 } });
    expect(v.derived["spell.slots"].breakdown).toEqual([
      { label: "Warlock", amount: "1st: 2 (short rest)" },
      { label: "Wizard", amount: "1st: 4, 2nd: 2" },
    ]);
  });
});

describe("the Warlock's and Bard's extras", () => {
  const charming = { race: "srd-5.1:human", ...standardArray({ str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 }) };
  const INV = "class.srd-5.1:warlock.eldritch-invocations";
  const warlock = (level: number, more: Record<string, ChoiceValue> = {}) => view({ ...charming, [CLASS_KEY]: "srd-5.1:warlock", [LEVEL_KEY]: level, ...more });

  it("Eldritch Invocations: as many as the table says, each with its prerequisites", () => {
    expect(choice(warlock(1), INV)).toBeUndefined();
    const at2 = choice(warlock(2), INV)!;
    expect(at2).toMatchObject({ kind: "pick-many", count: { min: 2, max: 2 }, source: "Warlock 2" });
    const option = (v: View, id: string) => choice(v, INV)?.options?.find((o) => o.value === id);
    expect(option(warlock(2), "agonizing-blast")?.unavailable).toBe("Needs the Eldritch Blast cantrip");
    expect(option(warlock(2), "thirsting-blade")?.unavailable).toBe("Needs Warlock level 5 and Pact of the Blade");
    expect(option(warlock(5, { "class.srd-5.1:warlock.pact-boon": "blade" }), "thirsting-blade")?.unavailable).toBeUndefined();
    expect(choice(warlock(5), INV)?.count).toEqual({ min: 3, max: 3 });

    const blast = warlock(2, { "spells.srd-5.1:warlock.cantrips": ["srd-5.1:eldritch-blast", "srd-5.1:minor-illusion"], [INV]: ["agonizing-blast", "beguiling-influence"] });
    expect(option(blast, "agonizing-blast")?.unavailable).toBeUndefined();
    expect(names(blast, "skills")).toEqual(expect.arrayContaining(["Deception", "Persuasion"]));
    const early = warlock(2, { [INV]: ["agonizing-blast", "armor-of-shadows"] });
    expect(issue(early, `needs:${INV}:agonizing-blast`)).toMatchObject({ overridable: true });
    expect(names(early, "spells")).toContain("Mage Armor");
  });

  it("Mystic Arcanum: one warlock spell of 6th level at Warlock 11", () => {
    const arcanum = choice(warlock(11), "class.srd-5.1:warlock.mystic-arcanum-6")!;
    expect(arcanum).toMatchObject({ step: "spells", source: "Warlock 11", kind: "pick-one" });
    expect(arcanum.options?.length).toBeGreaterThan(0);
    expect(arcanum.options?.every((o) => o.summary?.startsWith("6th-level"))).toBe(true);
    expect(choice(warlock(11), "class.srd-5.1:warlock.mystic-arcanum-7")).toBeUndefined();
  });

  it("Magical Secrets: two spells from any class at Bard 10, counted among the spells known", () => {
    const v = view({ ...charming, [CLASS_KEY]: "srd-5.1:bard", [LEVEL_KEY]: 10 });
    const secrets = choice(v, "class.srd-5.1:bard.magical-secrets-1")!;
    expect(secrets).toMatchObject({ step: "spells", count: { min: 2, max: 2 } });
    expect(secrets.options?.map((o) => o.name)).toEqual(expect.arrayContaining(["Fireball", "Fire Bolt"]));
    expect(secrets.options?.some((o) => o.summary?.startsWith("6th-level"))).toBe(false);
    expect(choice(v, "spells.srd-5.1:bard.known")).toMatchObject({ label: "Bard spells known (12)" });
  });
});

describe("levelling up", () => {
  it("adds a level to the character, for the Class step to share out", () => {
    expect(levelUp(doc(fighterWizard), content)).toEqual({ ok: true, label: "Level up to 6", choices: { [LEVEL_KEY]: 6 }, step: "class" });
    expect(levelUp(doc(human), content)).toEqual({ ok: false, reason: "Choose a class first." });
    expect(levelUp(doc({ ...human, [CLASS_KEY]: F, [LEVEL_KEY]: 20 }), content)).toEqual({ ok: false, reason: "This character is already level 20, the highest." });
  });
});
