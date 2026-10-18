import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Action, Monster } from "../types/monster";
import { abilityModifier, averageDice, parseDice } from "./dice";
import { actionName, renderAction, segmentsToText } from "./renderAction";

const monsters = sample as unknown as Monster[];

function byName(name: string): Monster {
  const found = monsters.find((m) => m.name === name);
  if (!found) throw new Error(`No sample monster named ${name}`);
  return found;
}

function action(monster: Monster, name: string): Action {
  const found = monster.actions.find((a) => a.name === name);
  if (!found) throw new Error(`${monster.name} has no action ${name}`);
  return found;
}

function text(monster: Monster, name: string): string {
  return segmentsToText(renderAction(action(monster, name), monster.name));
}

describe("renderAction: attacks", () => {
  it("renders a simple melee attack", () => {
    expect(text(byName("Brinewrack Cutthroat"), "Cutlass")).toBe(
      "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.",
    );
  });

  it("joins several damage types with 'plus'", () => {
    expect(text(byName("Gravewick Stalker"), "Claw")).toBe(
      "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 6 (1d6 + 3) slashing damage plus 3 (1d6) necrotic damage.",
    );
  });

  it("italicises the labels", () => {
    const segments = renderAction(action(byName("Cinderkite"), "Talons"), "Cinderkite");
    expect(segments.filter((s) => s.italic).map((s) => s.text)).toEqual(["Melee Weapon Attack:", "Hit:"]);
  });

  it("describes ranged attacks with a range", () => {
    const ranged: Action = {
      kind: "attack",
      name: "Shortbow",
      attack: { mode: "ranged_weapon", ability: "dex", to_hit: 4, range: { normal: 80, long: 320 }, targets: "one target" },
      damage: [{ dice: "1d6", bonus: 2, type: "piercing" }],
    };
    expect(segmentsToText(renderAction(ranged, "Archer"))).toBe(
      "Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.",
    );
  });
});

describe("renderAction: saves", () => {
  it("renders a cone with half damage on a success", () => {
    expect(text(byName("Gravewick Stalker"), "Lantern Glare")).toBe(
      "Each creature in a 15-foot cone must make a DC 11 Wisdom saving throw, taking 10 (3d6) necrotic damage on a failed save, or half as much damage on a successful one.",
    );
  });

  it("describes a line with its width", () => {
    expect(text(byName("Stormhide Drake"), "Stormbreath")).toContain("30-foot line that is 5 feet wide");
  });

  it("appends effect text after a no-damage-on-success save", () => {
    expect(text(byName("Gloomcap Shambler"), "Spore Burst")).toBe(
      "Each creature in a 10-foot radius must make a DC 12 Constitution saving throw, taking 4 (1d8) poison damage on a failed save. A creature that fails the save is also poisoned until the end of its next turn.",
    );
  });
});

describe("renderAction: multiattack and text", () => {
  it("renders a single repeated attack", () => {
    expect(text(byName("Brinewrack Cutthroat"), "Multiattack")).toBe(
      "The brinewrack cutthroat makes two cutlass attacks.",
    );
  });

  it("renders a mixed sequence", () => {
    expect(text(byName("Stormhide Drake"), "Multiattack")).toBe(
      "The stormhide drake makes three attacks: one with its bite and two with its claws.",
    );
  });

  it("passes text actions through unchanged", () => {
    const trait = byName("Cinderkite").traits[0];
    expect(segmentsToText(renderAction(trait, "Cinderkite"))).toBe(trait.text);
  });
});

describe("actionName", () => {
  it("adds the recharge to saves", () => {
    expect(actionName(action(byName("Stormhide Drake"), "Stormbreath"))).toBe("Stormbreath (Recharge 5–6)");
    expect(actionName(action(byName("Gloomcap Shambler"), "Spore Burst"))).toBe("Spore Burst (Recharge 6)");
  });

  it("leaves other actions alone", () => {
    expect(actionName(action(byName("Cinderkite"), "Talons"))).toBe("Talons");
  });
});

// These check the hand-written sample data against the rules, so a typo in
// the JSON shows up here instead of on a printed stat block.
describe("sample monster data", () => {
  it.each(monsters.map((m) => [m.name, m] as const))("%s renders every action without throwing", (_name, m) => {
    for (const a of [...m.traits, ...m.actions, ...m.bonus_actions, ...m.reactions]) {
      expect(() => renderAction(a, m.name)).not.toThrow();
    }
  });

  it.each(monsters.map((m) => [m.name, m] as const))("%s has hit points matching its dice", (_name, m) => {
    const { count, bonus } = parseDice(m.hit_points.dice);
    expect(bonus).toBe(count * abilityModifier(m.abilities.con));
    expect(m.hit_points.average).toBe(averageDice(m.hit_points.dice));
  });

  it.each(monsters.map((m) => [m.name, m] as const))("%s attack bonuses equal proficiency plus ability modifier", (_name, m) => {
    for (const a of m.actions) {
      if (a.kind !== "attack") continue;
      const expected = m.challenge.proficiency_bonus + abilityModifier(m.abilities[a.attack.ability]);
      expect(a.attack.to_hit).toBe(expected);
    }
  });
});
