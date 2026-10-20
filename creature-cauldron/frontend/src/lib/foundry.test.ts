import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Ability, Monster } from "../types/monster";
import { abilityModifier, averageDice } from "./dice";
import { exportFoundryActor } from "./foundry";
import banditCaptain from "./fixtures/foundry-dnd5e-5.3.3/bandit-captain.json";
import dragonFixture from "./fixtures/foundry-dnd5e-5.3.3/adult-red-dragon.json";
import giantSpider from "./fixtures/foundry-dnd5e-5.3.3/giant-spider.json";
import hillGiant from "./fixtures/foundry-dnd5e-5.3.3/hill-giant.json";
import mage from "./fixtures/foundry-dnd5e-5.3.3/mage.json";
import spy from "./fixtures/foundry-dnd5e-5.3.3/spy.json";
import type { JsonObject } from "./foundryJson";
import { FOUNDRY_TARGET, STATS_STAMP, foundryProficiency, skillFor } from "./foundryMaps";
import { FOUNDRY_ID, findUndefined, keyPaths } from "./testing/foundryChecks";
import { redDragon } from "./testing/srdMonsters";

const monsters = sample as unknown as Monster[];
const fixtures = [dragonFixture, hillGiant, giantSpider, banditCaptain, spy, mage] as unknown as JsonObject[];
const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

const byName = (name: string): Monster => {
  const found = monsters.find((m) => m.name === name);
  if (!found) throw new Error(`No sample monster named ${name}`);
  return found;
};

// Small readers so the tests can look inside the loosely typed Foundry objects.
const obj = (value: unknown): JsonObject => value as JsonObject;
const list = (value: unknown): JsonObject[] => value as JsonObject[];
const items = (actor: JsonObject): JsonObject[] => list(actor.items);
const sys = (item: JsonObject): JsonObject => obj(item.system);
const activitiesOf = (item: JsonObject): JsonObject[] => Object.values(obj(sys(item).activities)) as JsonObject[];
const itemNamed = (actor: JsonObject, name: string): JsonObject => {
  const found = items(actor).find((i) => i.name === name);
  if (!found) throw new Error(`No item named ${name}`);
  return found;
};

/** What the real SRD files contain, as shapes, plus the few native fields they predate. */
const REAL_PATHS = new Set<string>();
for (const fixture of fixtures) keyPaths(fixture, "", REAL_PATHS);
const EXTRA_PATHS = new Set([
  // Written in the newer form alongside the long-standing one (see foundry.ts).
  "system.attributes.senses.ranges",
  "system.attributes.senses.ranges.darkvision",
  "system.attributes.senses.ranges.blindsight",
  "system.attributes.senses.ranges.tremorsense",
  "system.attributes.senses.ranges.truesight",
  "system.details.habitat",
  "system.details.habitat.value",
  "system.details.habitat.custom",
  "system.resources.legact.spent",
  "system.resources.legres.spent",
  // Empty containers the fixtures had trimmed away.
  "flags",
  "items[].flags",
]);

describe("the shape matches real SRD actors", () => {
  it("only writes fields that exist in a real 5.3.3 SRD file (or are listed as native extras)", () => {
    for (const monster of monsters) {
      const { actor } = exportFoundryActor(monster);
      const unknown = [...keyPaths(actor)].filter((p) => !REAL_PATHS.has(p) && !EXTRA_PATHS.has(p));
      expect(unknown, monster.name).toEqual([]);
    }
  });

  it("has exactly the expected top-level keys and no ids or file references", () => {
    const { actor } = exportFoundryActor(monsters[0]);
    expect(Object.keys(actor).sort()).toEqual(["_stats", "effects", "flags", "items", "name", "prototypeToken", "system", "type"]);
    expect(actor.type).toBe("npc");
    expect(actor).not.toHaveProperty("_id");
    expect(actor).not.toHaveProperty("img");
  });

  it("stamps the actor and every item with the target version", () => {
    const { actor } = exportFoundryActor(byName("Stormhide Drake"));
    expect(actor._stats).toEqual({ ...STATS_STAMP });
    for (const item of items(actor)) expect(item._stats).toEqual({ ...STATS_STAMP });
    expect(FOUNDRY_TARGET.systemVersion).toBe("5.3.3");
  });

  it("marks everything as 2014 rules", () => {
    const { actor } = exportFoundryActor(byName("Voidbloom Seer"));
    expect(sys(actor as JsonObject).source).toMatchObject({ rules: "2014" });
    for (const item of items(actor)) expect(sys(item).source).toMatchObject({ rules: "2014" });
  });

  it("contains no undefined values and survives a JSON round trip unchanged", () => {
    for (const monster of monsters) {
      const { actor } = exportFoundryActor(monster);
      expect(findUndefined(actor), monster.name).toBeNull();
      expect(JSON.parse(JSON.stringify(actor))).toEqual(actor);
    }
  });

  it("gives the same file every time", () => {
    for (const monster of monsters) {
      expect(exportFoundryActor(monster)).toEqual(exportFoundryActor(monster));
    }
  });
});

// An Adult Red Dragon written in our format, compared with the real one from the SRD pack.
describe("a dragon written in our format reproduces the real SRD dragon", () => {
  const real = dragonFixture as unknown as JsonObject;
  const realSystem = obj(real.system);
  const dragon = redDragon;
  const { actor } = exportFoundryActor(dragon);
  const ours = obj(actor.system);

  it("matches the real ability scores and saving throw proficiencies", () => {
    for (const a of ABILITIES) {
      expect(obj(obj(ours.abilities)[a]).value, a).toBe(obj(obj(realSystem.abilities)[a]).value);
      expect(obj(obj(ours.abilities)[a]).proficient, a).toBe(obj(obj(realSystem.abilities)[a]).proficient);
      expect(obj(obj(obj(ours.abilities)[a]).bonuses).save, a).toBe("");
    }
  });

  it("matches the real skills, including Perception expertise", () => {
    const realSkills = obj(realSystem.skills);
    const ourSkills = obj(ours.skills);
    expect(obj(ourSkills.prc).value).toBe(obj(realSkills.prc).value); // 2: expertise
    expect(obj(ourSkills.ste).value).toBe(obj(realSkills.ste).value); // 1: proficient
    expect(obj(ourSkills.acr).value).toBe(obj(realSkills.acr).value); // 0
    for (const id of Object.keys(realSkills)) expect(obj(ourSkills[id]).ability, id).toBe(obj(realSkills[id]).ability);
  });

  it("matches hit points, armor, movement, senses and size", () => {
    const a = obj(ours.attributes);
    const r = obj(realSystem.attributes);
    expect(a.hp).toEqual(r.hp);
    expect(obj(a.ac).flat).toBe(obj(r.ac).flat);
    expect(obj(a.ac).calc).toBe(obj(r.ac).calc);
    expect(a.movement).toEqual(r.movement);
    for (const sense of ["darkvision", "blindsight", "tremorsense", "truesight"]) {
      expect(obj(a.senses)[sense], sense).toBe(obj(r.senses)[sense]);
    }
    expect(obj(ours.traits).size).toBe(obj(realSystem.traits).size);
    expect(obj(obj(ours.traits).di).value).toEqual(obj(obj(realSystem.traits).di).value);
    expect(obj(obj(ours.traits).languages).value).toEqual(obj(obj(realSystem.traits).languages).value);
    expect(obj(ours.details).cr).toBe(obj(realSystem.details).cr);
    expect(obj(obj(ours.details).type).value).toBe(obj(obj(realSystem.details).type).value);
  });

  it("matches the real legendary action pool and token", () => {
    expect(obj(obj(ours.resources).legact).max).toBe(obj(obj(realSystem.resources).legact).max);
    expect(obj(obj(actor.prototypeToken).bar2).attribute).toBe(obj(obj(real.prototypeToken).bar2).attribute);
    expect(obj(actor.prototypeToken).width).toBe(obj(real.prototypeToken).width);
  });

  it.each([
    ["Bite", "Bite"],
    ["Claw", "Claw"],
    ["Tail", "Tail"],
  ])("builds the %s weapon like the real one", (name, realName) => {
    const realItem = list(real.items).find((i) => i.name === realName)!;
    const ourItem = itemNamed(actor, name);
    expect(ourItem.type).toBe("weapon");
    const realBase = obj(obj(sys(realItem).damage).base);
    const ourBase = obj(obj(sys(ourItem).damage).base);
    expect(ourBase.number).toBe(realBase.number);
    expect(ourBase.denomination).toBe(realBase.denomination);
    expect(ourBase.types).toEqual(realBase.types);
    // (a few real items, like the Claw, leave reach empty and rely on a default)
    const realReach = obj(sys(realItem).range).reach;
    if (realReach !== null) expect(obj(sys(ourItem).range).reach).toBe(realReach);
    expect(sys(ourItem).type).toEqual(sys(realItem).type);
    const realActivity = activitiesOf(realItem)[0];
    const ourActivity = activitiesOf(ourItem)[0];
    expect(obj(ourActivity.attack).ability).toBe(obj(realActivity.attack).ability);
    expect(obj(ourActivity.attack).bonus).toBe(obj(realActivity.attack).bonus); // to-hit is derived, no extra bonus
    expect(obj(ourActivity.damage).parts).toEqual(obj(realActivity.damage).parts);
  });

  it("builds Fire Breath like the real one", () => {
    const realBreath = list(real.items).find((i) => i.name === "Fire Breath")!;
    const ourBreath = itemNamed(actor, "Fire Breath");
    expect(sys(ourBreath).uses).toEqual(sys(realBreath).uses);
    const r = activitiesOf(realBreath)[0];
    const o = activitiesOf(ourBreath)[0];
    expect(o.type).toBe("save");
    expect(obj(o.save).dc).toEqual(obj(r.save).dc);
    expect(obj(o.damage).parts).toEqual(obj(r.damage).parts);
    expect(obj(o.damage).onSave).toBe(obj(r.damage).onSave);
    expect(obj(obj(o.target).template)).toMatchObject({ type: "cone", size: "60", units: "ft" });
    expect(o.consumption).toEqual(r.consumption);
    expect(obj(o.range).units).toBe(obj(r.range).units);
  });

  it("builds the legendary actions like the real ones", () => {
    const realTailAttack = list(real.items).find((i) => i.name === "Tail Attack")!;
    const ourDetect = itemNamed(actor, "Detect");
    expect(obj(activitiesOf(ourDetect)[0].activation).type).toBe(obj(activitiesOf(realTailAttack)[0].activation).type);
    expect(obj(activitiesOf(itemNamed(actor, "Wing Attack"))[0].activation).value).toBe(2);
    expect(itemNamed(actor, "Legendary Actions")).toBeDefined();
  });

  it("writes traits as passive features, like the real Legendary Resistance", () => {
    const realResistance = list(real.items).find((i) => i.name === "Legendary Resistance")!;
    const ours = itemNamed(actor, "Legendary Resistance (3/Day)");
    expect(sys(ours).properties).toEqual(sys(realResistance).properties);
    expect(ours.type).toBe("feat");
  });
});

describe("the arithmetic always adds up, for every sample monster", () => {
  /** What Foundry would show for a weapon's to-hit: ability modifier + proficiency + the extra bonus. */
  const derivedToHit = (item: JsonObject, mods: Record<Ability, number>, pb: number) => {
    const attack = obj(activitiesOf(item)[0].attack);
    return mods[attack.ability as Ability] + pb + Number(attack.bonus === "" ? 0 : attack.bonus);
  };

  it("saves, skills and hit points add up to the printed numbers", () => {
    for (const monster of monsters) {
      const { actor } = exportFoundryActor(monster);
      const system = obj(actor.system);
      const pb = foundryProficiency(monster.challenge.cr_value);
      const mods = Object.fromEntries(ABILITIES.map((a) => [a, abilityModifier(monster.abilities[a])])) as Record<Ability, number>;

      for (const a of ABILITIES) {
        const entry = obj(obj(system.abilities)[a]);
        expect(entry.value).toBe(monster.abilities[a]);
        const flat = obj(entry.bonuses).save === "" ? 0 : Number(obj(entry.bonuses).save);
        const total = mods[a] + (entry.proficient as number) * pb + flat;
        expect(total, `${monster.name} ${a} save`).toBe(monster.saves[a] ?? mods[a]);
      }

      for (const [name, printed] of Object.entries(monster.skills)) {
        const entry = obj(obj(system.skills)[skillFor(name)!.id]);
        const flat = obj(entry.bonuses).check === "" ? 0 : Number(obj(entry.bonuses).check);
        const total = mods[entry.ability as Ability] + (entry.value as number) * pb + flat;
        expect(total, `${monster.name} ${name}`).toBe(printed);
      }

      const hp = obj(obj(system.attributes).hp);
      expect(hp.value).toBe(monster.hit_points.average);
      expect(hp.max).toBe(monster.hit_points.average);
      expect(averageDice(hp.formula as string), `${monster.name} hit point formula`).toBe(monster.hit_points.average);
    }
  });

  it("weapon attacks have the printed to-hit and damage", () => {
    for (const monster of monsters) {
      const { actor } = exportFoundryActor(monster);
      const pb = foundryProficiency(monster.challenge.cr_value);
      const mods = Object.fromEntries(ABILITIES.map((a) => [a, abilityModifier(monster.abilities[a])])) as Record<Ability, number>;
      for (const action of monster.actions) {
        if (action.kind !== "attack" || !action.attack.mode.endsWith("weapon")) continue;
        const item = itemNamed(actor, action.name);
        expect(item.type).toBe("weapon");
        expect(derivedToHit(item, mods, pb), `${monster.name} ${action.name} to-hit`).toBe(action.attack.to_hit);

        const damage = obj(sys(item).damage);
        const base = obj(damage.base);
        const first = action.damage[0];
        expect(`${base.number}d${base.denomination}`).toBe(first.dice);
        expect(base.types).toEqual([first.type]);
        // "@mod" stands for the ability modifier, so "@mod + 2" is a printed bonus of modifier + 2.
        const bonus = String(base.bonus);
        const mod = mods[obj(activitiesOf(item)[0].attack).ability as Ability];
        const resolved = bonus === "@mod" ? mod : bonus.startsWith("@mod + ") ? mod + Number(bonus.slice(7)) : mod - Number(bonus.slice(7));
        expect(resolved, `${monster.name} ${action.name} damage bonus`).toBe(first.bonus);
        expect(obj(activitiesOf(item)[0].damage).parts).toHaveLength(action.damage.length - 1);
      }
    }
  });

  it("save abilities have the printed DC, damage, area and recharge", () => {
    for (const monster of monsters) {
      const { actor } = exportFoundryActor(monster);
      for (const action of monster.actions) {
        if (action.kind !== "save") continue;
        const item = itemNamed(actor, action.name);
        const activity = activitiesOf(item)[0];
        expect(activity.type).toBe("save");
        expect(obj(activity.save).ability).toEqual([action.save.ability]);
        expect(obj(obj(activity.save).dc).formula).toBe(String(action.save.dc));
        expect(obj(activity.damage).onSave).toBe(action.on_success);
        expect(obj(activity.damage).parts).toHaveLength(action.on_fail.length);
        if (action.area) expect(obj(obj(activity.target).template).size).toBe(String(action.area.size));
        const recovery = list(obj(sys(item).uses).recovery);
        if (action.recharge) expect(recovery[0].formula).toBe(String(action.recharge.min));
        else expect(recovery).toEqual([]);
      }
    }
  });

  it("every ability becomes exactly one item, with valid and unique ids", () => {
    for (const monster of monsters) {
      const { actor } = exportFoundryActor(monster);
      const list_ = items(actor);
      const expected =
        monster.traits.length +
        (monster.spellcasting ? 1 : 0) +
        monster.actions.length +
        monster.bonus_actions.length +
        monster.reactions.length +
        (monster.legendary_actions ? 1 + monster.legendary_actions.options.length : 0);
      expect(list_, monster.name).toHaveLength(expected);
      const ids = list_.map((i) => i._id as string);
      expect(new Set(ids).size).toBe(ids.length);
      for (const item of list_) {
        expect(item._id as string).toMatch(FOUNDRY_ID);
        for (const [key, activity] of Object.entries(obj(sys(item).activities))) {
          expect(obj(activity)._id).toBe(key);
        }
      }
      const identifiers = list_.map((i) => sys(i).identifier as string);
      expect(new Set(identifiers).size, `${monster.name} identifiers`).toBe(identifiers.length);
      for (const id of identifiers) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("only writes safe damage bonus text", () => {
    for (const monster of monsters) {
      const { actor } = exportFoundryActor(monster);
      const bonuses: string[] = [];
      for (const item of items(actor)) {
        const damage = sys(item).damage as JsonObject | undefined;
        if (damage?.base) bonuses.push(String(obj(damage.base).bonus));
        for (const activity of activitiesOf(item)) {
          for (const part of list(obj(activity.damage ?? {}).parts ?? [])) bonuses.push(String(part.bonus));
        }
      }
      for (const bonus of bonuses) expect(bonus, monster.name).toMatch(/^(|@mod( [+-] \d+)?|-?\d+)$/);
    }
  });
});

describe("special cases", () => {
  it("writes spell attacks with a flat to-hit and no base damage", () => {
    const { actor } = exportFoundryActor(byName("Voidbloom Seer"));
    const lash = itemNamed(actor, "Mind Lash");
    expect(lash.type).toBe("feat");
    const activity = activitiesOf(lash)[0];
    expect(obj(activity.attack)).toMatchObject({ flat: true, bonus: "8", type: { value: "ranged", classification: "spell" } });
    expect(obj(activity.damage).includeBase).toBe(false);
    expect(obj(activity.damage).parts).toEqual([
      expect.objectContaining({ number: 3, denomination: 8, bonus: "5", types: ["psychic"] }),
    ]);
  });

  it("writes spellcasting as a trait, sets the casting ability, and says it is text only", () => {
    const { actor, notes } = exportFoundryActor(byName("Hollowvale Hexer"));
    expect(obj(sys(actor as JsonObject).attributes).spellcasting).toBe("cha");
    const feature = itemNamed(actor, "Spellcasting");
    expect(sys(feature).properties).toEqual(["trait"]);
    expect(notes.some((n) => n.includes("Spellcasting is text only"))).toBe(true);
  });

  it("handles a save with no area and no damage (an effect only)", () => {
    const { actor } = exportFoundryActor(byName("Dustmote Sprite"));
    const dust = activitiesOf(itemNamed(actor, "Blinding Dust"))[0];
    expect(obj(dust.damage).parts).toEqual([]);
    expect(obj(obj(dust.target).template).type).toBe("");
  });

  it("keeps a line's width and an area's shape", () => {
    const { actor } = exportFoundryActor(byName("Stormhide Drake"));
    const breath = activitiesOf(itemNamed(actor, "Stormbreath"))[0];
    expect(obj(obj(breath.target).template)).toMatchObject({ type: "line", size: "30", width: "5" });
  });

  it("sets the legendary pool and token bar only for monsters that have legendary actions", () => {
    const seer = exportFoundryActor(byName("Voidbloom Seer")).actor;
    expect(obj(obj(sys(seer).resources).legact)).toMatchObject({ value: 3, max: 3 });
    expect(obj(obj(seer.prototypeToken).bar2).attribute).toBe("resources.legact");
    const kite = exportFoundryActor(byName("Cinderkite")).actor;
    expect(obj(obj(sys(kite).resources).legact)).toMatchObject({ value: 0, max: 0 });
    expect(obj(obj(kite.prototypeToken).bar2).attribute).toBeNull();
  });

  it("sizes the token from the creature size", () => {
    expect(obj(exportFoundryActor(byName("Cinderkite")).actor.prototypeToken).width).toBe(1);
    expect(obj(exportFoundryActor(byName("Dustmote Sprite")).actor.prototypeToken).width).toBe(0.5);
    expect(obj(exportFoundryActor(byName("Dune Leviathan")).actor.prototypeToken).width).toBe(4);
    expect(obj(sys(exportFoundryActor(byName("Dune Leviathan")).actor).traits).size).toBe("grg");
  });

  it("records the armor note in the biography", () => {
    const { actor } = exportFoundryActor(byName("Brinewrack Cutthroat"));
    expect(obj(obj(sys(actor).details).biography).value).toContain("Armor Class: 14 (studded leather)");
  });

  it("explains differences Foundry will compute for itself", () => {
    const hexer = byName("Hollowvale Hexer");
    const odd: Monster = { ...hexer, senses: { ...hexer.senses, passive_perception: 99 }, spellcasting: { ...hexer.spellcasting!, dc: 20 } };
    const { notes } = exportFoundryActor(odd);
    expect(notes.some((n) => n.includes("passive Perception"))).toBe(true);
    expect(notes.some((n) => n.includes("spell save DC"))).toBe(true);
    expect(exportFoundryActor(hexer).notes.some((n) => n.includes("passive Perception"))).toBe(false);
  });

  it("legendary resistance sets the sheet counter and says it is not linked", () => {
    const seer = byName("Voidbloom Seer");
    const withResistance: Monster = {
      ...seer,
      traits: [{ kind: "text", name: "Legendary Resistance (2/Day)", text: "It succeeds instead." }],
    };
    const { actor, notes } = exportFoundryActor(withResistance);
    expect(obj(obj(sys(actor).resources).legres)).toMatchObject({ value: 2, max: 2 });
    expect(notes.some((n) => n.includes("Legendary Resistance is text only"))).toBe(true);
  });
});

describe("it never throws, and says so when it leaves something out", () => {
  const base = byName("Cinderkite");

  it("escapes HTML in names and descriptions", () => {
    const evil: Monster = {
      ...base,
      description: "<img src=x onerror=alert(1)>",
      traits: [{ kind: "text", name: "<b>Bold</b>", text: "5 < 6 & 7 > 3" }],
    };
    const { actor } = exportFoundryActor(evil);
    const html = JSON.stringify(actor);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Bold</b>".replace("<b>Bold</b>", "<b>Bold</b></p>"));
    const feature = items(actor).find((i) => sys(i).identifier === "b-bold-b")!;
    expect(obj(sys(feature).description).value).toBe("<p>5 &lt; 6 &amp; 7 &gt; 3</p>");
  });

  it("copes with an empty name, odd skills, bad dice and no abilities", () => {
    const strange: Monster = {
      ...base,
      name: "   ",
      skills: { "Basket Weaving": 5, Stealth: 3 },
      hit_points: { average: 10, dice: "lots" },
      actions: [
        {
          kind: "attack",
          name: "Weird Bite",
          attack: { mode: "melee_weapon", ability: "str", to_hit: 4, reach: 5, targets: "one target" },
          damage: [{ dice: "banana", bonus: 2, type: "piercing" }],
        },
      ],
      traits: [],
      senses: { passive_perception: 10 },
      languages: "",
    };
    const { actor, notes } = exportFoundryActor(strange);
    expect(actor.name).toBe("Unnamed monster");
    expect(notes.some((n) => n.includes("Basket Weaving"))).toBe(true);
    expect(notes.some((n) => n.includes("hit point formula"))).toBe(true);
    expect(notes.some((n) => n.includes("banana"))).toBe(true);
    expect(obj(obj(sys(actor).attributes).hp).formula).toBe("");
  });

  it("copes with a monster that has nothing but a name", () => {
    const minimal: Monster = {
      ...base,
      traits: [],
      actions: [],
      bonus_actions: [],
      reactions: [],
      legendary_actions: null,
      spellcasting: null,
      skills: {},
      saves: {},
    };
    const { actor } = exportFoundryActor(minimal);
    expect(items(actor)).toEqual([]);
  });

  it("gives two abilities with the same name different identifiers and ids", () => {
    const twins: Monster = {
      ...base,
      actions: [
        { kind: "text", name: "Slam", text: "One." },
        { kind: "text", name: "Slam", text: "Two." },
      ],
    };
    const { actor } = exportFoundryActor(twins);
    const found = items(actor).filter((i) => i.name === "Slam");
    expect(found).toHaveLength(2);
    expect(sys(found[0]).identifier).not.toBe(sys(found[1]).identifier);
    expect(found[0]._id).not.toBe(found[1]._id);
  });
});

describe("golden files: our exported actors, written to disk so any change is visible in review", () => {
  it.each(["Cinderkite", "Stormhide Drake", "Voidbloom Seer"])("%s", async (name) => {
    const { actor } = exportFoundryActor(byName(name));
    const slug = name.toLowerCase().replace(/ /g, "-");
    await expect(`${JSON.stringify(actor, null, 2)}\n`).toMatchFileSnapshot(`./goldens/fvtt-Actor-${slug}.json`);
  });
});
