// The Tome & Tile export, through the real SRD 5.1 pack: the numbers, resources and abilities of real characters; the
// file reads back through Tome & Tile's own types; warnings for unfinished characters; and the copied contract files
// still match the version recorded when they were copied.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fromJsonString, toJsonString } from "@bufbuild/protobuf";
import { createContentIndex, newCharacterDocument, readPack, setChoice, type ChoiceValue } from "../../../core";
import { describe as blurb, dnd5e2014, runPipeline } from "../module";
import { CLASS_KEY, LEVEL_KEY, MULTI_KEY } from "../steps/class";
import { ARMOR_KEY, METHOD_KEY, GOLD_KEY, SHIELD_KEY, SHOP_KEY } from "../steps/equipment";
import { standardArray } from "../testing/abilities";
import { toCreature } from "./tomeandtile";
import { ActionCost, CreatureKind, CreatureSchema, DamageType, TargetShape, type Creature } from "./tomeandtile/gen/creature_pb";
import { AbilityScore, RulesEdition } from "./tomeandtile/gen/common_pb";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../../..");
const srdFile = JSON.parse(readFileSync(join(ROOT, "frontend/public/packs/srd-5.1.pack.json"), "utf8"));
const srd = readPack(srdFile, dnd5e2014, []);
if (!srd.ok) throw new Error(srd.errors.join("\n"));
const content = createContentIndex([srd.pack]);
const T = "2026-11-24T10:00:00Z";

function doc(choices: Record<string, ChoiceValue>, name = "Test") {
  let d = newCharacterDocument({ id: "anvil-id-1", system: { id: "dnd5e-2014", version: 1 }, packs: [{ id: "srd-5.1", version: srdFile.version }], now: T });
  d = { ...d, name };
  for (const [k, v] of Object.entries(choices)) d = setChoice(d, k, v, T);
  return d;
}
const creatureOf = (choices: Record<string, ChoiceValue>) => toCreature(doc(choices), content, runPipeline, blurb);
const ability = (c: Creature, id: string) => c.abilities.find((a) => a.abilityId === id);
const resource = (c: Creature, key: string) => c.resources.find((r) => r.key === key);

// A human: Str 16, Dex 14, Con 15, Int 13, Wis 11, Cha 9.
const human = { race: "srd-5.1:human", ...standardArray({ str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8 }) };
const fighter = {
  ...human, [CLASS_KEY]: "srd-5.1:fighter", "class.srd-5.1:fighter.skills": ["athletics", "perception"], "class.srd-5.1:fighter.fighting-style": "defense",
  [METHOD_KEY]: "gold", [GOLD_KEY]: 100, [SHOP_KEY]: { "srd-5.1:longsword": 1, "srd-5.1:chain-mail": 1, "srd-5.1:shortbow": 1 }, [ARMOR_KEY]: "srd-5.1:chain-mail", [SHIELD_KEY]: "none",
};

describe("a Fighter 1", () => {
  const { creature: c } = creatureOf(fighter);
  it("carries the worked-out numbers", () => {
    expect(c).toMatchObject({
      kind: CreatureKind.PLAYER_CHARACTER, edition: RulesEdition.RULES_EDITION_2014, name: "Test", summary: "Human Fighter 1",
      scores: { strength: 16, dexterity: 14, constitution: 15, intelligence: 13, wisdom: 11, charisma: 9 },
      proficiencyBonus: 2, armorClass: 17, hpMax: 12, hpCurrent: 12, speedFeet: 30, initiativeBonus: 2, passivePerception: 12,
    });
    expect(c.saveProficiencies).toEqual([AbilityScore.STRENGTH, AbilityScore.CONSTITUTION]);
    expect(c.skills.map((s) => [s.skill, s.bonus])).toEqual([["athletics", 5], ["perception", 2]]);
    expect(c.creatureId).toBe(""); // Tome & Tile's server makes ids
  });

  it("resources start full: Second Wind and hit dice", () => {
    expect(resource(c, "second_wind")).toMatchObject({ label: "Second Wind", current: 1, max: 1 });
    expect(resource(c, "hit_dice_d10")).toMatchObject({ current: 1, max: 1 });
  });

  it("each weapon is an attack with its to-hit bonus, damage and reach or range; a versatile one has a two-handed grip", () => {
    const sword = ability(c, "weapon-longsword")!;
    expect(sword.cost).toBe(ActionCost.ACTION);
    expect(sword.targeting).toMatchObject({ shape: TargetShape.CREATURES, rangeFeet: 5, maxTargets: 1 });
    expect(sword.steps[0].step).toMatchObject({ case: "attack", value: { toHitBonus: 5, damage: [{ dice: "1d8+3", type: DamageType.SLASHING }] } });
    expect(ability(c, "weapon-longsword-two-handed")!.steps[0].step).toMatchObject({ value: { damage: [{ dice: "1d10+3" }] } });
    expect(ability(c, "weapon-shortbow")!.targeting).toMatchObject({ rangeFeet: 80, longRangeFeet: 320 });
    expect(ability(c, "weapon-shortbow")!.steps[0].step).toMatchObject({ value: { toHitBonus: 4, damage: [{ dice: "1d6+2", type: DamageType.PIERCING }] } });
  });

  it("features are passive cards with their text, credited to the SRD", () => {
    const wind = ability(c, "feature-second-wind")!;
    expect(wind).toMatchObject({ cost: ActionCost.PASSIVE, steps: [] });
    expect(wind.description).toMatch(/regain hit points/);
    expect(wind.provenance?.source).toBe("srd-5.1");
  });

  it("says where it came from, so a re-import can replace the earlier copy", () => {
    expect(c.provenance).toMatchObject({ source: "adventurers-anvil", externalId: "anvil-id-1" });
    expect(c.provenance?.attribution).toMatch(/^This work includes material taken from the System Reference Document 5\.1/);
  });
});

describe("spellcasters", () => {
  const book = ["srd-5.1:magic-missile", "srd-5.1:shield", "srd-5.1:sleep", "srd-5.1:detect-magic", "srd-5.1:burning-hands", "srd-5.1:thunderwave", "srd-5.1:fireball", "srd-5.1:counterspell"];
  const wizard = (level: number, prepared: string[]) => creatureOf({
    race: "srd-5.1:human", ...standardArray({ str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }), [CLASS_KEY]: "srd-5.1:wizard", [LEVEL_KEY]: level,
    "spells.srd-5.1:wizard.cantrips": ["srd-5.1:fire-bolt", "srd-5.1:light", "srd-5.1:mage-hand"], "spells.srd-5.1:wizard.spellbook": book, "spells.srd-5.1:wizard.prepared": prepared,
  }).creature;

  it("cantrips and prepared spells become abilities; the rest of the spellbook doesn't", () => {
    const c = wizard(5, ["srd-5.1:magic-missile", "srd-5.1:shield", "srd-5.1:fireball"]);
    expect(c.abilities.filter((a) => a.abilityId.startsWith("spell-")).map((a) => a.name)).toEqual(["Fire Bolt", "Light", "Mage Hand", "Magic Missile", "Shield", "Fireball"]);
    expect(resource(c, "spell_slot_1")).toMatchObject({ current: 4, max: 4 });
    expect(resource(c, "spell_slot_3")).toMatchObject({ current: 2, max: 2 });
  });

  it("an attack cantrip scales with level; a save spell has its DC, area and slot; plain damage is a flat step; a reaction costs one", () => {
    const c = wizard(5, ["srd-5.1:magic-missile", "srd-5.1:shield", "srd-5.1:fireball"]); // Int 16 (+3), proficiency +3
    expect(ability(c, "spell-fire-bolt")!.steps[0].step).toMatchObject({ case: "attack", value: { toHitBonus: 6, damage: [{ dice: "2d10", type: DamageType.FIRE }] } });
    expect(ability(c, "spell-fire-bolt")!.resourceKey).toBe("");
    const fireball = ability(c, "spell-fireball")!;
    expect(fireball).toMatchObject({ resourceKey: "spell_slot_3", resourceAmount: 1, targeting: { shape: TargetShape.SPHERE, rangeFeet: 150, sizeFeet: 20 } });
    expect(fireball.steps[0].step).toMatchObject({ case: "save", value: { ability: AbilityScore.DEXTERITY, dc: 14, halfOnSuccess: true, damage: [{ dice: "8d6", type: DamageType.FIRE }] } });
    expect(ability(c, "spell-magic-missile")!.steps[0].step).toMatchObject({ case: "flat", value: { damage: [{ dice: "3d4+3", type: DamageType.FORCE }] } });
    expect(ability(c, "spell-shield")!.cost).toBe(ActionCost.REACTION);
    expect(ability(c, "spell-mage-hand")!.steps).toEqual([]); // nothing to automate: a card with its text
  });

  it("a Life cleric's healing fills in the modifier; a warlock's spells spend pact slots", () => {
    const cleric = creatureOf({
      race: "srd-5.1:human", ...standardArray({ str: 14, dex: 10, con: 13, int: 8, wis: 15, cha: 12 }), [CLASS_KEY]: "srd-5.1:cleric", "class.srd-5.1:cleric.subclass": "srd-5.1:life",
      "spells.srd-5.1:cleric.cantrips": ["srd-5.1:sacred-flame", "srd-5.1:light", "srd-5.1:guidance"],
    }).creature;
    expect(ability(cleric, "spell-cure-wounds")!.steps[0].step).toMatchObject({ case: "flat", value: { healingDice: "1d8+3" } });
    expect(ability(cleric, "spell-sacred-flame")!.steps[0].step).toMatchObject({ case: "save", value: { ability: AbilityScore.DEXTERITY, dc: 13, halfOnSuccess: false } });

    const warlock = creatureOf({
      race: "srd-5.1:human", ...standardArray({ str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 }), [CLASS_KEY]: "srd-5.1:warlock", [LEVEL_KEY]: 3,
      "spells.srd-5.1:warlock.cantrips": ["srd-5.1:eldritch-blast", "srd-5.1:minor-illusion"],
      "spells.srd-5.1:warlock.known": ["srd-5.1:hellish-rebuke", "srd-5.1:charm-person", "srd-5.1:hold-person", "srd-5.1:misty-step"],
    }).creature;
    expect(resource(warlock, "pact_slot_2")).toMatchObject({ current: 2, max: 2 });
    expect(ability(warlock, "spell-hellish-rebuke")!.resourceKey).toBe("pact_slot_2");
  });

  it("a multiclass character's shared slots", () => {
    const c = creatureOf({ ...human, [CLASS_KEY]: "srd-5.1:fighter", [LEVEL_KEY]: 5, [MULTI_KEY]: { "srd-5.1:wizard": 1 } }).creature;
    expect(c.summary).toBe("Human Fighter 4 / Wizard 1");
    expect(resource(c, "spell_slot_1")).toMatchObject({ current: 2, max: 2 });
    expect(resource(c, "hit_dice_d10")?.max).toBe(4);
    expect(resource(c, "hit_dice_d6")?.max).toBe(1);
  });
});

describe("the file", () => {
  const exporter = dnd5e2014.exporters![0];
  it("is Protobuf JSON that reads back through Tome & Tile's types, named after the character", () => {
    const out = exporter.build(doc(fighter, "Borin Stonehelm"), content);
    expect(out.fileName).toBe("borin-stonehelm.creature.json");
    const json = JSON.parse(out.text);
    expect(json).toMatchObject({ kind: "CREATURE_KIND_PLAYER_CHARACTER", edition: "RULES_EDITION_2014", name: "Borin Stonehelm", size: "CREATURE_SIZE_MEDIUM" });
    const back = fromJsonString(CreatureSchema, out.text);
    expect(toJsonString(CreatureSchema, back, { prettySpaces: 2 })).toBe(out.text.trimEnd());
  });

  it("warns before exporting an unfinished character", () => {
    expect(exporter.build(doc(fighter), content).warnings).toContainEqual(expect.stringMatching(/^Not finished: .*Background/));
    expect(exporter.build(doc({}), content).warnings[0]).toMatch(/^Not finished: Race, Abilities, Class/);
  });
});

describe("the copied contract files", () => {
  it("still match the hashes recorded when they were copied (copy them again; don't edit them)", () => {
    const gen = join(HERE, "tomeandtile/gen");
    const source = readFileSync(join(gen, "SOURCE.md"), "utf8");
    const rows = [...source.matchAll(/\| `([\w.]+\.ts)` \| `([0-9a-f]{64})` \|/g)];
    expect(rows.map((r) => r[1])).toEqual(["common_pb.ts", "scene_pb.ts", "creature_pb.ts"]);
    for (const [, file, hash] of rows) {
      const text = readFileSync(join(gen, file), "utf8").replace(/\r\n/g, "\n");
      expect(createHash("sha256").update(text).digest("hex"), file).toBe(hash);
    }
  });
});
