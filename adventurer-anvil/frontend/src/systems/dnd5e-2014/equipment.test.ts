// The Equipment step with the sample pack: packages (lettered choices, "any martial weapon" picks, packs opened),
// starting gold (rolled, or given by the DM) and the shop, what is worn and the Armor Class it gives, attacks,
// weight and the warnings.
import { describe, expect, it } from "vitest";
import {
  addRolls, createContentIndex, newCharacterDocument, readPack, rollSet, setChoice, viewCharacter, type ChoiceValue, type IndexedPack,
} from "../../core";
import { dnd5e2014 } from "./module";
import { BACKGROUND_KEY } from "./steps/background";
import { CLASS_KEY } from "./steps/class";
import { ARMOR_KEY, GOLD_KEY, METHOD_KEY, SHIELD_KEY, SHOP_KEY, WEALTH_KEY } from "./steps/equipment";
import { standardArray } from "./testing/abilities";
import sample from "./testing/elf-sample.pack.json";

const T = "2026-11-14T12:00:00.000Z";
function load(file: unknown, required: IndexedPack[] = []): IndexedPack {
  const result = readPack(file, dnd5e2014, required);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.pack;
}
const pack = load(sample);

function view(choices: Record<string, ChoiceValue>, opts: { rolls?: number[]; packs?: IndexedPack[] } = {}) {
  let doc = newCharacterDocument({ id: "c", system: { id: "dnd5e-2014", version: 1 }, packs: [{ id: "sample-srd", version: "0.1.0" }], now: T });
  for (const [key, value] of Object.entries(choices)) doc = setChoice(doc, key, value, T);
  if (opts.rolls) {
    let i = 0;
    const faces = opts.rolls;
    doc = addRolls(doc, rollSet({ expression: "5d4x10", times: 1, for: WEALTH_KEY, now: T, newId: () => `r${i}`, random: () => (faces[i++] - 0.5) / 4 }), T);
  }
  return viewCharacter(dnd5e2014, doc, createContentIndex(opts.packs ?? [pack]));
}
const step = (v: ReturnType<typeof view>) => v.steps.find((s) => s.id === "equipment")!;
const choice = (v: ReturnType<typeof view>, key: string) => step(v).choices.find((c) => c.key === key);
const names = (v: ReturnType<typeof view>, list: string) => (v.lists[list] ?? []).map((i) => i.name);
const issues = (v: ReturnType<typeof view>) => v.issues.filter((i) => i.step === "equipment").map((i) => i.id);

const F = "equipment.class.sample-srd:fighter";
const scores = standardArray({ str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 });
const fighter = { ...scores, [CLASS_KEY]: "sample-srd:fighter", [BACKGROUND_KEY]: "sample-srd:sentry", [METHOD_KEY]: "packages" };
const chainAndSword = { ...fighter, [`${F}.armor`]: "a", [`${F}.weapon`]: "a", [`${F}.weapon.a.0`]: "sample-srd:longsword" };

describe("packages", () => {
  it("offer the class's lettered choices, named by what they give, and take the fixed items and gold", () => {
    const v = view(fighter);
    expect(choice(v, `${F}.armor`)?.options?.map((o) => [o.value, o.name])).toEqual([
      ["a", "Chain Mail"],
      ["b", "Leather Armor + Longbow + Arrow × 20"],
    ]);
    // The Explorer's Pack is opened; the Sentry gives a thing no pack has, a dagger and 10 gp.
    expect(names(v, "inventory")).toEqual(["Backpack", "Torch × 10", "Watch horn", "Dagger"]);
    expect(v.lists.inventory[0]).toMatchObject({ source: "Fighter", detail: "in Explorer's Pack" });
    expect(v.derived.coins).toMatchObject({ value: 1000, breakdown: [{ label: "Sentry", amount: 1000 }] });
  });

  it("open a pick for 'a martial weapon', and two separate picks for two (so two of the same is fine)", () => {
    const a = view({ ...fighter, [`${F}.weapon`]: "a" });
    expect(choice(a, `${F}.weapon.a.0`)).toMatchObject({ label: "Choose a martial weapon", source: "Fighter", kind: "pick-one" });
    expect(choice(a, `${F}.weapon.a.0`)?.options?.map((o) => o.name)).toEqual(["Longsword", "Rapier", "Net", "Longbow"]);
    expect(choice(a, `${F}.weapon.a.0`)?.options?.[0].tags).toEqual(["1d8 slashing", "15 gp"]);

    const b = view({ ...fighter, [`${F}.weapon`]: "b", [`${F}.weapon.b.0.1`]: "sample-srd:rapier", [`${F}.weapon.b.0.2`]: "sample-srd:rapier" });
    expect(choice(b, `${F}.weapon.b.0.2`)?.label).toBe("Choose a martial weapon (2 of 2)");
    expect(names(b, "inventory")).toContain("Rapier × 2");
    expect(issues(b)).toEqual([]);
  });

  it("are to do until every choice and pick is made, and armour and shield are decided", () => {
    expect(step(view(fighter)).status).toBe("todo");
    expect(step(view(chainAndSword)).status).toBe("todo"); // what to wear
    const v = view({ ...chainAndSword, [ARMOR_KEY]: "sample-srd:chain-mail", [SHIELD_KEY]: "shield" });
    expect(step(v).status).toBe("done");
  });

  it("ask you to choose a class and background first", () => {
    const v = view({ ...scores, [METHOD_KEY]: "packages" });
    expect(v.issues.find((i) => i.id === "equipment-needs-choices")?.message).toBe("Choose a class and a background first: their packages appear here.");
  });
});

describe("what you wear, and Armor Class", () => {
  it("chain mail and a shield: 16 + 2, and the Defense style adds 1 while armoured", () => {
    const v = view({ ...chainAndSword, [ARMOR_KEY]: "sample-srd:chain-mail", [SHIELD_KEY]: "shield", "class.sample-srd:fighter.fighting-style": "defense" });
    expect(choice(v, ARMOR_KEY)?.options?.map((o) => [o.name, o.tags])).toEqual([
      ["No armour", ["Unarmoured"]],
      ["Chain Mail", ["AC 16", "Needs Str 13", "Stealth disadvantage"]],
    ]);
    expect(v.derived.ac).toEqual({ value: 19, label: "Armor Class", breakdown: [{ label: "Chain Mail", amount: 16 }, { label: "Shield", amount: 2 }, { label: "Fighter", amount: 1 }] });
  });

  it("no armour: 10 + Dex (Defense doesn't count), and a shield still adds 2", () => {
    const v = view({ ...chainAndSword, [ARMOR_KEY]: "none", [SHIELD_KEY]: "shield", "class.sample-srd:fighter.fighting-style": "defense" });
    expect(v.derived.ac.breakdown).toEqual([{ label: "Unarmored", amount: 10 }, { label: "Dexterity", amount: 2 }, { label: "Shield", amount: 2 }]);
  });

  it("heavy armour without the Strength: speed drops 10 feet, with a warning", () => {
    const weak = { ...chainAndSword, ...standardArray({ str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }), race: "sample-srd:elf", [ARMOR_KEY]: "sample-srd:chain-mail" };
    const v = view(weak);
    expect(v.derived["speed.walk"]).toMatchObject({ value: 20, breakdown: [{ label: "Elf", amount: 30 }, { label: "Chain Mail (Strength 8, needs 13)", amount: -10 }] });
    expect(v.issues.find((i) => i.id === "armor-strength:sample-srd:chain-mail")?.message).toBe("Chain Mail needs Strength 13 (yours is 8): your speed drops by 10 feet.");
  });

  it("a monk's Unarmored Defense doesn't work with a shield; armour you aren't proficient with is a warning", () => {
    const monkPack = load({
      format: "adventurer-anvil-pack", formatVersion: 1, id: "monk-test", version: "0.1.0", system: "dnd5e-2014", title: "Monk test", requires: ["sample-srd"],
      collections: {
        classes: [{
          id: "monk", name: "Monk", hitDie: 8, proficiencies: [], multiclass: { requires: { all: [{ ability: "dex", min: 13 }] }, proficiencies: [] },
          levels: [{ level: 1, effects: [{ type: "armor-class", base: 10, abilities: ["dex", "wis"], shield: false }] }],
          startingEquipment: { items: [{ item: "sample-srd:shield" }, { item: "sample-srd:scale-mail" }] },
        }],
      },
    }, [pack]);
    const monk = { ...standardArray({ str: 8, dex: 15, con: 13, int: 10, wis: 14, cha: 12 }), [CLASS_KEY]: "monk-test:monk", [METHOD_KEY]: "packages", [ARMOR_KEY]: "none" };
    const packs = [pack, monkPack];
    expect(view({ ...monk, [SHIELD_KEY]: "none" }, { packs }).derived.ac.value).toBe(14); // 10 + Dex 2 + Wis 2
    const shielded = view({ ...monk, [SHIELD_KEY]: "shield" }, { packs });
    expect(shielded.derived.ac.breakdown).toEqual([{ label: "Unarmored", amount: 10 }, { label: "Dexterity", amount: 2 }, { label: "Shield", amount: 2 }]);
    expect(shielded.issues.find((i) => i.id === "shield-untrained:sample-srd:shield")?.severity).toBe("warning");
    // Scale mail: 14 + Dex, at most 2.
    const armoured = view({ ...monk, [ARMOR_KEY]: "sample-srd:scale-mail", [SHIELD_KEY]: "none" }, { packs });
    expect(armoured.derived.ac.breakdown).toEqual([{ label: "Scale Mail", amount: 14 }, { label: "Dexterity (max 2)", amount: 2 }]);
    expect(armoured.issues.find((i) => i.id === "armor-untrained:sample-srd:scale-mail")?.message).toMatch(/^You aren't proficient with medium armour, so Scale Mail gives you disadvantage/);
  });
});

describe("attacks", () => {
  it("one per weapon: Strength for melee, the better of Str and Dex for finesse, proficiency from the class", () => {
    const v = view({ ...fighter, [`${F}.armor`]: "b", [`${F}.weapon`]: "b", [`${F}.weapon.b.0.1`]: "sample-srd:longsword", [`${F}.weapon.b.0.2`]: "sample-srd:net" });
    expect(v.derived["attack.sample-srd:longsword"]).toEqual({
      value: "+4 to hit, 1d8+2 slashing (1d10+2 two-handed)", label: "Longsword",
      breakdown: [{ label: "Strength", amount: 2 }, { label: "Proficient (Fighter)", amount: 2 }],
    });
    expect(v.derived["attack.sample-srd:longbow"].value).toBe("+4 to hit, 1d8+2 piercing"); // Dex 14
    expect(v.derived["attack.sample-srd:net"].value).toBe("+4 to hit, no damage (special)");
    expect(v.derived["attack.sample-srd:dagger"].breakdown[0]).toEqual({ label: "Strength", amount: 2 }); // finesse, Str 15 = Dex 14 + 1
  });

  it("without proficiency, only the ability counts", () => {
    const rogue = { ...standardArray({ str: 8, dex: 15, con: 13, int: 12, wis: 10, cha: 14 }), [CLASS_KEY]: "sample-srd:rogue", [METHOD_KEY]: "packages" };
    const v = view(rogue);
    expect(v.derived["attack.sample-srd:rapier"]).toMatchObject({ value: "+2 to hit, 1d8+2 piercing", breakdown: [{ label: "Dexterity", amount: 2 }] });
  });
});

describe("starting gold and the shop", () => {
  it("rolls the class's wealth dice (logged), and buying spends it", () => {
    const gold = { ...fighter, [METHOD_KEY]: "gold" };
    expect(choice(view(gold), WEALTH_KEY)).toMatchObject({ kind: "roll", dice: "5d4x10", label: "Roll your starting gold: 5d4 × 10 gp", answered: false });
    const v = view({ ...gold, [SHOP_KEY]: { "sample-srd:longsword": 1, "sample-srd:arrow": 1 } }, { rolls: [3, 4, 2, 1, 2] });
    expect(v.derived.coins).toEqual({ value: 12000 - 1600, label: "Money", breakdown: [{ label: "Rolled (5d4 × 10)", amount: 12000 }, { label: "Spent", amount: -1600 }] });
    expect(names(v, "inventory")).toEqual(["Longsword", "Arrow × 20"]); // the packages are gone: gold replaces them
    expect(choice(v, SHOP_KEY)?.budget).toMatchObject({ total: 12000, format: "coins" });
    expect(choice(v, SHOP_KEY)?.budget?.cost["sample-srd:torch"]).toBe(1);
  });

  it("without wealth dice, asks for the gold the DM gives; overspending is an error a DM may allow", () => {
    const rogue = { ...scores, [CLASS_KEY]: "sample-srd:rogue", [METHOD_KEY]: "gold" };
    expect(choice(view(rogue), GOLD_KEY)).toMatchObject({ kind: "number", hint: "The loaded packs give no starting-wealth dice for the Rogue: enter the gold your DM gives you." });
    const v = view({ ...rogue, [GOLD_KEY]: 60, [SHOP_KEY]: { "sample-srd:chain-mail": 1 } });
    expect(v.issues.find((i) => i.id === "overspent")).toMatchObject({ severity: "error", overridable: true, message: "This costs more than your starting gold (75 gp of 60 gp)." });
    expect(issues(view({ ...rogue, [GOLD_KEY]: 60, [SHOP_KEY]: { "sample-srd:nothing": 1 } }))).toContain("invalid-pick:equipment.shop:sample-srd:nothing");
  });

  it("switching to gold leaves the package choices unused, not lost", () => {
    const v = view({ ...chainAndSword, [METHOD_KEY]: "gold" });
    expect(v.unused).toEqual([`${F}.armor`, `${F}.weapon`, `${F}.weapon.a.0`]);
  });
});

describe("weight", () => {
  it("adds up what's carried (a bundle's weight shared out), against Strength × 15", () => {
    const v = view({ ...fighter, [`${F}.armor`]: "b", [`${F}.weapon`]: "a", [`${F}.weapon.a.0`]: "sample-srd:longsword" });
    // Leather 10, torches 10, shield 6, backpack 5, longsword 3, longbow 2, dagger 1, 20 arrows 1.
    expect(v.derived.weight.value).toBe(38);
    expect(v.derived.weight.label).toBe("Weight carried (of 225 lb)");
    expect(v.derived.weight.breakdown.slice(0, 2)).toEqual([{ label: "Leather Armor", amount: 10 }, { label: "Torch", amount: 10 }]);
  });

  it("warns past the carrying capacity", () => {
    const weak = standardArray({ str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 });
    const v = view({ ...weak, [CLASS_KEY]: "sample-srd:rogue", [METHOD_KEY]: "gold", [GOLD_KEY]: 200, [SHOP_KEY]: { "sample-srd:chain-mail": 2, "sample-srd:shield": 2 } });
    expect(v.issues.find((i) => i.id === "over-capacity")).toMatchObject({
      severity: "warning", message: "You carry 122 lb, more than your carrying capacity of 120 lb (Strength × 15).",
    });
  });
});
