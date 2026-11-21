// The optional rules, through the real SRD 5.1 pack and a small test pack of entries that belong in private packs
// (a Variant Human, a custom lineage, some feats): the Rules step's defaults, multiclassing off, feats in place of
// Ability Score Improvements, rolled hit points, variant encumbrance, and moving a race's increases.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addRolls, createContentIndex, newCharacterDocument, readPack, setChoice, viewCharacter, type ChoiceValue, type RollRecord } from "../../core";
import { dnd5e2014 } from "./module";
import { CLASS_KEY, LEVEL_KEY, MULTI_KEY } from "./steps/class";
import { GOLD_KEY, METHOD_KEY, SHOP_KEY } from "./steps/equipment";
import { RULE_KEYS } from "./steps/rules";
import { standardArray } from "./testing/abilities";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const srd = readPack(JSON.parse(readFileSync(join(ROOT, "frontend/public/packs/srd-5.1.pack.json"), "utf8")), dnd5e2014, []);
if (!srd.ok) throw new Error(srd.errors.join("\n"));

/** Entries of the kind a private pack would hold, in our own words, for testing. */
const extra = readPack({
  format: "adventurer-anvil-pack", formatVersion: 1, id: "extra", version: "0.1.0", system: "dnd5e-2014", title: "Test extras", requires: [],
  collections: {
    races: [
      {
        id: "variant-human", name: "Human (variant)", size: "medium", rule: "feats",
        effects: [
          { type: "speed", walk: 30 },
          { type: "choice", id: "abilities", label: "Choose two abilities", pick: 2, from: { list: "abilities" }, each: { type: "ability-bonus", amount: 1 } },
          { type: "choice", id: "feat", label: "Choose a feat", pick: 1, from: { collection: "feats" } },
        ],
      },
      {
        id: "custom-lineage", name: "Custom lineage", size: ["small", "medium"],
        effects: [
          { type: "speed", walk: 30 },
          { type: "choice", id: "ability", label: "Choose an ability", pick: 1, from: { list: "abilities" }, each: { type: "ability-bonus", amount: 2 } },
        ],
      },
    ],
    feats: [
      { id: "sharp-mind", name: "Sharp Mind", effects: [{ type: "ability-bonus", ability: "int", amount: 1 }] },
      { id: "steady", name: "Steady", repeatable: true, effects: [] },
      { id: "armoured", name: "Armoured", requires: { proficiency: { kind: "armor", id: "medium" } }, effects: [] },
      { id: "spell-shaper", name: "Spell Shaper", requires: { spellcasting: true }, effects: [] },
    ],
  },
}, dnd5e2014, []);
if (!extra.ok) throw new Error(extra.errors.join("\n"));
const content = createContentIndex([srd.pack, extra.pack]);
const T = "2026-11-21T10:00:00Z";

function view(choices: Record<string, ChoiceValue>, rolls: { for: string; total: number }[] = []) {
  let d = newCharacterDocument({ id: "c", system: { id: "dnd5e-2014", version: 1 }, packs: [{ id: "srd-5.1", version: srd.ok ? srd.pack.version : "" }], now: T });
  for (const [k, v] of Object.entries(choices)) d = setChoice(d, k, v, T);
  const records: RollRecord[] = rolls.map((r, i) => ({ id: `r${i}`, set: `s${i}`, expression: "1d10", dice: [r.total], kept: [r.total], total: r.total, for: r.for, at: T }));
  d = addRolls(d, records, T);
  return viewCharacter(dnd5e2014, d, content);
}
type View = ReturnType<typeof view>;
const choice = (v: View, key: string) => v.steps.flatMap((s) => s.choices).find((c) => c.key === key);
const ids = (v: View) => v.issues.map((i) => i.id);
const issue = (v: View, id: string) => v.issues.find((i) => i.id === id);
const names = (v: View, list: string) => (v.lists[list] ?? []).map((i) => i.name);

// A human: Str 16, Dex 14, Con 15, Int 13, Wis 11, Cha 9.
const human = { race: "srd-5.1:human", ...standardArray({ str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8 }) };
const F = "srd-5.1:fighter";
const feats = { [RULE_KEYS.feats]: "on" };
const ASI = "class.srd-5.1:fighter.asi-4";

describe("the Rules step", () => {
  it("comes first, is done from the start, and shows each rule's default", () => {
    const v = view({});
    const rules = v.steps[0];
    expect(rules).toMatchObject({ id: "rules", label: "Rules", status: "done" });
    expect(rules.choices.map((c) => [c.key, c.defaultValue])).toEqual([
      ["rules.multiclassing", "on"], ["rules.feats", "off"], ["rules.hit-points", "average"], ["rules.encumbrance", "standard"], ["rules.origin", "standard"],
    ]);
    expect(issue(view({ [RULE_KEYS.feats]: "maybe" }), "rule:rules.feats")?.message).toBe("Feats: not one of the choices, so the default is used.");
  });

  it("with multiclassing off, other classes aren't offered and their levels stop counting", () => {
    const v = view({ ...human, [CLASS_KEY]: F, [LEVEL_KEY]: 5, [MULTI_KEY]: { "srd-5.1:wizard": 1 }, [RULE_KEYS.multiclassing]: "off" });
    expect(choice(v, MULTI_KEY)).toBeUndefined();
    expect(v.derived.level.breakdown).toEqual([{ label: "Fighter", amount: 5 }]);
    expect(v.unused).toContain(MULTI_KEY);
  });
});

describe("feats", () => {
  it("without the feats rule, an improvement is just scores, and feat-only races aren't offered", () => {
    const v = view({ ...human, [CLASS_KEY]: F, [LEVEL_KEY]: 4 });
    expect(choice(v, `${ASI}.take`)).toBeUndefined();
    expect(choice(v, ASI)?.label).toBe("Ability Score Improvement");
    expect(choice(v, "race")?.options?.map((o) => o.name)).not.toContain("Human (variant)");
    expect(view({ ...feats }).steps.find((s) => s.id === "race")!.choices[0].options?.map((o) => o.name)).toContain("Human (variant)");
  });

  it("with it, each improvement can be a feat instead; the scores are kept for switching back", () => {
    const base = { ...human, ...feats, [CLASS_KEY]: F, [LEVEL_KEY]: 4, [ASI]: { str: 2 } };
    const scores = view(base);
    expect(choice(scores, `${ASI}.take`)).toMatchObject({ kind: "pick-one", presentation: "segmented", defaultValue: "scores", source: "Fighter 4" });
    expect(choice(scores, ASI)?.label).toBe("Increase your scores");
    expect(scores.derived["ability.str"].value).toBe(18);

    const feat = view({ ...base, [`${ASI}.take`]: "feat", [`${ASI}.feat`]: "srd-5.1:grappler" });
    expect(choice(feat, ASI)).toBeUndefined();
    expect(feat.derived["ability.str"].value).toBe(16);
    expect(choice(feat, `${ASI}.feat`)).toMatchObject({ label: "Choose a feat", source: "Fighter 4" });
    expect(names(feat, "feats")).toEqual(["Grappler"]);
    expect(feat.lists["gains.class"].find((g) => g.name === "Grappler")?.source).toBe("Grappler (Fighter 4)");
    expect(feat.unused).toContain(ASI);

    // Feats off again: the feat stops counting and the scores count again.
    const off = view({ ...base, [`${ASI}.take`]: "feat", [`${ASI}.feat`]: "srd-5.1:grappler", [RULE_KEYS.feats]: "off" });
    expect(off.derived["ability.str"].value).toBe(18);
    expect(off.unused).toEqual(expect.arrayContaining([`${ASI}.take`, `${ASI}.feat`]));
  });

  it("checks a feat's prerequisites, as problems a DM can allow", () => {
    const weak = { race: "srd-5.1:human", ...standardArray({ str: 10, dex: 15, con: 14, int: 13, wis: 12, cha: 8 }) }; // Str 11
    const take = { ...feats, [CLASS_KEY]: "srd-5.1:wizard", [LEVEL_KEY]: 4, "class.srd-5.1:wizard.asi-4.take": "feat" };
    const v = view({ ...weak, ...take, "class.srd-5.1:wizard.asi-4.feat": "srd-5.1:grappler" });
    const options = choice(v, "class.srd-5.1:wizard.asi-4.feat")!.options!;
    expect(options.find((o) => o.name === "Grappler")?.unavailable).toBe("Needs Strength 13 (you have 11)");
    expect(options.find((o) => o.name === "Armoured")?.unavailable).toBe("Needs proficiency with medium armour");
    expect(options.find((o) => o.name === "Spell Shaper")?.unavailable).toBeUndefined(); // a wizard casts, even before picking spells
    const fighter = view({ ...human, ...feats, [CLASS_KEY]: F, [LEVEL_KEY]: 4, [`${ASI}.take`]: "feat" });
    expect(choice(fighter, `${ASI}.feat`)?.options?.find((o) => o.name === "Spell Shaper")?.unavailable).toBe("Needs the ability to cast at least one spell");
    expect(issue(v, "needs:class.srd-5.1:wizard.asi-4.feat:srd-5.1:grappler")).toMatchObject({ overridable: true });
  });

  it("a feat isn't taken twice unless it's repeatable; a feat's increase stops at 20", () => {
    const at6 = { ...human, ...feats, [CLASS_KEY]: F, [LEVEL_KEY]: 6, [`${ASI}.take`]: "feat", "class.srd-5.1:fighter.asi-6.take": "feat" };
    const twice = view({ ...at6, [`${ASI}.feat`]: "srd-5.1:grappler", "class.srd-5.1:fighter.asi-6.feat": "srd-5.1:grappler" });
    expect(ids(twice).some((i) => i.startsWith("already-have:") && i.includes("grappler"))).toBe(true);
    const steady = view({ ...at6, [`${ASI}.feat`]: "extra:steady", "class.srd-5.1:fighter.asi-6.feat": "extra:steady" });
    expect(ids(steady).filter((i) => i.startsWith("already-have:"))).toEqual([]);

    const clever = { race: "srd-5.1:human", ...standardArray({ str: 14, dex: 13, con: 12, int: 15, wis: 10, cha: 8 }) }; // Int 16
    const capped = view({
      ...clever, ...feats, [CLASS_KEY]: F, [LEVEL_KEY]: 8, [ASI]: { int: 2 }, "class.srd-5.1:fighter.asi-6.take": "feat",
      "class.srd-5.1:fighter.asi-6.feat": "extra:sharp-mind", "class.srd-5.1:fighter.asi-8": { int: 2 },
    });
    expect(capped.derived["ability.int"].value).toBe(21);
    expect(ids(capped).some((i) => i.startsWith("above-cap:"))).toBe(true);
  });

  it("a Variant Human from a pack, offered only with feats: two increases and a feat", () => {
    const v = view({
      ...feats, race: "extra:variant-human", ...standardArray({ str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8 }),
      "race.extra:variant-human.abilities": ["str", "con"], "race.extra:variant-human.feat": "srd-5.1:grappler",
    });
    expect(v.derived["ability.str"].value).toBe(16);
    expect(names(v, "feats")).toEqual(["Grappler"]);
    expect(ids(view({ race: "extra:variant-human" }))).toContain("invalid-pick:race:extra:variant-human");
  });
});

describe("rolled hit points", () => {
  const rolled = { ...human, [RULE_KEYS.hitPoints]: "rolled", [CLASS_KEY]: F, [LEVEL_KEY]: 4 };
  it("one roll for each level after the first; the average until rolled", () => {
    const v = view(rolled, [{ for: "class.srd-5.1:fighter.hp-2", total: 7 }, { for: "class.srd-5.1:fighter.hp-3", total: 3 }]);
    expect(choice(v, "class.srd-5.1:fighter.hp-2")).toMatchObject({ kind: "roll", presentation: "compact", dice: "1d10", group: "Hit points (rolled)", label: "Fighter 2", answered: true });
    expect(choice(v, "class.srd-5.1:fighter.hp-4")?.answered).toBe(false);
    expect(v.derived.hp.breakdown).toEqual([
      { label: "Fighter level 1 (d10, highest)", amount: 10 },
      { label: "Fighter levels 2–4 rolled (d10: 7, 3)", amount: 10 },
      { label: "Fighter: 1 level not rolled yet (average 6)", amount: 6 },
      { label: "Constitution × 4", amount: 8 },
    ]);
    expect(v.steps.find((s) => s.id === "class")!.status).toBe("todo");
  });

  it("the latest roll counts, a reroll is noted, and each level adds at least 1", () => {
    const v = view(rolled, [{ for: "class.srd-5.1:fighter.hp-2", total: 2 }, { for: "class.srd-5.1:fighter.hp-2", total: 9 }]);
    expect(v.derived.hp.breakdown[1]).toEqual({ label: "Fighter levels 2–4 rolled (d10: 9)", amount: 9 });
    expect(issue(v, "rerolled:class.srd-5.1:fighter.hp-2")?.message).toBe("Hit points: Fighter 2 was rolled 2 times; the latest counts.");

    const frail = { race: "srd-5.1:human", ...standardArray({ str: 15, dex: 14, con: 8, int: 13, wis: 12, cha: 10 }) }; // Con 9: −1
    const low = view({ ...frail, [RULE_KEYS.hitPoints]: "rolled", [CLASS_KEY]: "srd-5.1:wizard", [LEVEL_KEY]: 2 }, [{ for: "class.srd-5.1:wizard.hp-2", total: 1 }]);
    expect(low.derived.hp.breakdown[1]).toEqual({ label: "Wizard level 2 rolled (d6: 1; each at least 2)", amount: 2 });
  });
});

describe("variant encumbrance", () => {
  // Str 11: encumbered over 55 lb, heavily over 110 lb.
  const carrying = (n: number, rule = "variant") => view({
    race: "srd-5.1:human", ...standardArray({ str: 10, dex: 15, con: 14, int: 13, wis: 12, cha: 8 }), [CLASS_KEY]: F,
    [METHOD_KEY]: "gold", [GOLD_KEY]: 500, [SHOP_KEY]: { "srd-5.1:chain-mail": n }, [RULE_KEYS.encumbrance]: rule,
  });
  it("slows you over Strength × 5, and more over Strength × 10", () => {
    expect(carrying(1).derived["speed.walk"].value).toBe(30);
    const two = carrying(2);
    expect(two.derived["speed.walk"].breakdown.at(-1)).toEqual({ label: "Encumbered (over 55 lb)", amount: -10 });
    expect(ids(two)).toContain("encumbered");
    const three = carrying(3);
    expect(three.derived["speed.walk"].value).toBe(10);
    expect(issue(three, "heavily-encumbered")?.message).toMatch(/^Heavily encumbered: you carry 165 lb, over 110 lb \(Strength × 10\)/);
    expect(three.derived.weight.label).toBe("Weight carried (slower over 55 lb, of 165 lb)");
  });
  it("standard encumbrance doesn't slow you", () => {
    expect(carrying(3, "standard").derived["speed.walk"].value).toBe(30);
  });
});

describe("moving a race's increases", () => {
  const dwarf = { race: "srd-5.1:dwarf", "race.srd-5.1:dwarf.subrace": "srd-5.1:hill-dwarf", ...standardArray({ str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8 }), [RULE_KEYS.origin]: "custom" };
  it("each fixed increase can go to another score, each to a different one", () => {
    const v = view({ ...dwarf, "race.origin.con": "dex" });
    expect(choice(v, "race.origin.con")).toMatchObject({ label: "+2 Constitution (Dwarf) goes to", defaultValue: "con", group: "Move your race's increases" });
    expect(v.derived["ability.dex"].value).toBe(15);
    expect(v.derived["ability.con"].value).toBe(14);
    expect(v.derived["ability.dex"].breakdown.at(-1)).toEqual({ label: "Dwarf (moved from Con)", amount: 2 });
    expect(ids(view({ ...dwarf, "race.origin.con": "dex", "race.origin.wis": "dex" }))).toContain("origin-same-score");
  });
  it("not without the rule", () => {
    const v = view({ ...dwarf, [RULE_KEYS.origin]: "standard", "race.origin.con": "dex" });
    expect(choice(v, "race.origin.con")).toBeUndefined();
    expect(v.derived["ability.con"].value).toBe(16);
  });
  it("a race may offer a choice of size", () => {
    const v = view({ race: "extra:custom-lineage" });
    expect(choice(v, "race.extra:custom-lineage.size")).toMatchObject({ kind: "pick-one", options: [{ value: "small", name: "Small" }, { value: "medium", name: "Medium" }] });
    expect(choice(v, "race")?.options?.find((o) => o.name === "Custom lineage")?.tags).toContain("Small or Medium");
  });
});
