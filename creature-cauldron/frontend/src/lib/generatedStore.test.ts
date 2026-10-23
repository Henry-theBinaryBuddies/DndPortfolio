import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Monster } from "../types/monster";
import { MAX_GENERATED, looksLikeMonster, parseGenerated } from "./generatedStore";

const monsters = sample as unknown as Monster[];
const clone = (m: Monster): Record<string, unknown> => JSON.parse(JSON.stringify(m));

describe("looksLikeMonster", () => {
  it("accepts every sample monster", () => {
    for (const m of monsters) expect(looksLikeMonster(clone(m)), m.name).toBe(true);
  });

  it("rejects things that are not monsters", () => {
    for (const bad of [null, undefined, 5, "x", [], {}]) expect(looksLikeMonster(bad)).toBe(false);
  });

  it("rejects a monster missing a field the stat block reads", () => {
    for (const key of ["abilities", "hit_points", "challenge", "actions", "senses", "traits"]) {
      const broken = clone(monsters[0]);
      delete broken[key];
      expect(looksLikeMonster(broken), key).toBe(false);
    }
  });

  it("rejects wrong types, unknown enum values and bad dice", () => {
    expect(looksLikeMonster({ ...clone(monsters[0]), size: "Gigantic" })).toBe(false);
    expect(looksLikeMonster({ ...clone(monsters[0]), type: "robot" })).toBe(false);
    expect(looksLikeMonster({ ...clone(monsters[0]), id: "" })).toBe(false);
    expect(looksLikeMonster({ ...clone(monsters[0]), changes: "abc" })).toBe(false);
    expect(looksLikeMonster({ ...clone(monsters[0]), attribution: {} })).toBe(false);
    expect(looksLikeMonster({ ...clone(monsters[0]), changes: ["Main damage: fire \u2192 cold"] })).toBe(true);
    expect(looksLikeMonster({ ...clone(monsters[0]), actions: [{ kind: "attack", name: "x" }] })).toBe(false);
    const withBadDice = clone(monsters[0]) as { actions: { damage?: { dice: string }[] }[] };
    const attack = withBadDice.actions.find((a) => a.damage);
    if (attack?.damage) {
      attack.damage[0].dice = "lots";
      expect(looksLikeMonster(withBadDice)).toBe(false);
    }
  });
});

describe("parseGenerated", () => {
  it("returns an empty list for anything that is not a list", () => {
    for (const bad of [null, undefined, "x", 5, {}]) expect(parseGenerated(bad)).toEqual([]);
  });

  it("keeps good monsters and drops bad ones", () => {
    const kept = parseGenerated([clone(monsters[0]), { nope: true }, clone(monsters[1])]);
    expect(kept.map((m) => m.id)).toEqual([monsters[0].id, monsters[1].id]);
  });

  it("drops a repeated id", () => {
    expect(parseGenerated([clone(monsters[0]), clone(monsters[0])])).toHaveLength(1);
  });

  it("fills in missing legendary actions and spellcasting as null", () => {
    const m = clone(monsters[0]);
    delete m.legendary_actions;
    delete m.spellcasting;
    const [result] = parseGenerated([m]);
    expect(result.legendary_actions).toBeNull();
    expect(result.spellcasting).toBeNull();
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_GENERATED + 20 }, (_, i) => ({ ...clone(monsters[0]), id: `g-${i}` }));
    expect(parseGenerated(many)).toHaveLength(MAX_GENERATED);
  });
});
