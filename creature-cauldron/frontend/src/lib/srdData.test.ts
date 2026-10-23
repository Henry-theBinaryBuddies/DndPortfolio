import { describe, expect, it } from "vitest";
import srd from "../../public/data/srd-monsters.json";
import type { Monster } from "../types/monster";
import { SRD_ATTRIBUTION } from "./attribution";
import { foundryDamageTrait, fiveToolsDamageEntries, splitQualified, typesIn } from "./damageLines";
import { damageDealtBy } from "./demoGenerator";
import { buildFiveToolsFile } from "./fiveTools";
import { exportFoundryActor } from "./foundry";
import type { JsonObject } from "./foundryJson";
import { looksLikeMonster } from "./generatedStore";

// The SRD file is written by the Python importer. These tests check that the web page agrees with it.

const monsters = srd as unknown as Monster[];
const byId = (id: string): Monster => monsters.find((m) => m.id === id)!;
const NOW = "2026-10-20T12:00:00.000Z";

describe("the SRD data file", () => {
  it("has 333 monsters with unique ids and names", () => {
    expect(monsters).toHaveLength(333);
    expect(new Set(monsters.map((m) => m.id)).size).toBe(333);
    expect(new Set(monsters.map((m) => m.name.toLowerCase())).size).toBe(333);
  });

  it("carries exactly the attribution the page shows in its footer", () => {
    for (const m of monsters) expect(m.attribution, m.name).toBe(SRD_ATTRIBUTION);
  });

  it("is marked as SRD and validated", () => {
    for (const m of monsters) {
      expect(m.source).toBe("srd");
      expect(m.validated).toBe(true);
    }
  });

  it("is accepted by the same checks stored monsters go through", () => {
    for (const m of monsters) expect(looksLikeMonster(JSON.parse(JSON.stringify(m))), m.name).toBe(true);
  });

  it("keeps the exact damage wording for the qualified lines", () => {
    const withText = monsters.filter((m) => m.damage_text);
    expect(withText.length).toBeGreaterThanOrEqual(65);
    expect(byId("srd-werewolf-hybrid").damage_text?.immunities).toContain("nonmagical");
  });

  it("every monster can be exported to both formats without throwing", () => {
    expect(() => buildFiveToolsFile(monsters, NOW)).not.toThrow();
    for (const m of monsters) expect(() => exportFoundryActor(m), m.name).not.toThrow();
  });
});

describe("the damage a reskin can swap", () => {
  it("is only damage the monster deals: the zombie is immune to poison but deals only bludgeoning", () => {
    const zombie = byId("srd-zombie");
    expect(zombie.immunities).toContain("poison");
    expect(damageDealtBy(zombie)).toEqual(["bludgeoning"]);
  });

  it("includes damage written in the text of an action, such as a breath weapon", () => {
    expect(damageDealtBy(byId("srd-adult-red-dragon"))).toEqual(expect.arrayContaining(["fire", "piercing", "slashing", "bludgeoning"]));
  });

  it("does not count what a monster resists or is vulnerable to", () => {
    const dealt = damageDealtBy(byId("srd-werewolf-hybrid"));
    expect(dealt).not.toContain("poison");
  });

  it("does not count damage mentioned only in a trait, which is usually damage the monster takes", () => {
    const vampire = byId("srd-vampire-vampire");
    expect(damageDealtBy(vampire)).not.toContain("radiant"); // Sunlight Hypersensitivity: the vampire takes radiant damage
  });
});

describe("damage lines", () => {
  it("finds the types in a phrase", () => {
    expect(typesIn("bludgeoning, piercing, and slashing")).toEqual(["bludgeoning", "piercing", "slashing"]);
    expect(typesIn("damage from spells")).toEqual([]);
  });

  it("splits a qualifier off", () => {
    expect(splitQualified("piercing from magic weapons wielded by good creatures")).toEqual({
      types: ["piercing"],
      qualifier: "from magic weapons wielded by good creatures",
    });
    expect(splitQualified("fire")).toEqual({ types: ["fire"], qualifier: null });
  });

  it("writes plain lines as plain lists for 5etools", () => {
    expect(fiveToolsDamageEntries("immune", ["fire", "cold"], null)).toEqual(["fire", "cold"]);
  });

  it("writes qualified parts as conditional objects, and keeps plain parts plain", () => {
    expect(fiveToolsDamageEntries("immune", ["poison", "slashing"], "poison; slashing from nonmagical weapons that aren't silvered")).toEqual([
      "poison",
      { immune: ["slashing"], note: "from nonmagical weapons that aren't silvered", cond: true },
    ]);
    expect(fiveToolsDamageEntries("resist", [], "damage from spells")).toEqual([{ special: "damage from spells" }]);
  });

  it("maps nonmagical qualifiers to Foundry's bypass flags", () => {
    expect(foundryDamageTrait(null)).toEqual({ bypasses: [], custom: "", textOnlyTypes: [] });
    expect(foundryDamageTrait("bludgeoning, piercing, and slashing from nonmagical weapons").bypasses).toEqual(["mgc"]);
    expect(foundryDamageTrait("slashing from nonmagical weapons that aren't silvered").bypasses).toEqual(["mgc", "sil"]);
    expect(foundryDamageTrait("slashing from nonmagical weapons that aren't adamantine").bypasses).toEqual(["mgc", "ada"]);
  });

  it("keeps wording Foundry cannot model as custom text", () => {
    expect(foundryDamageTrait("damage from spells")).toEqual({ bypasses: [], custom: "damage from spells", textOnlyTypes: [] });
    expect(foundryDamageTrait("piercing from magic weapons wielded by good creatures").custom).toContain("good creatures");
  });

  it("names the types that exist only in wording Foundry cannot model", () => {
    expect(foundryDamageTrait("piercing from magic weapons wielded by good creatures").textOnlyTypes).toEqual(["piercing"]);
    // a type that also appears plainly, or in a modellable part, stays a real Foundry type
    expect(foundryDamageTrait("piercing; piercing from magic weapons wielded by good creatures").textOnlyTypes).toEqual([]);
    expect(foundryDamageTrait("damage from spells").textOnlyTypes).toEqual([]);
  });
});

describe("qualified damage in the exports", () => {
  const werewolf = byId("srd-werewolf-hybrid");

  it("5etools gets a conditional immunity, not a blanket one", () => {
    const [entry] = buildFiveToolsFile([werewolf], NOW).file.monster as JsonObject[];
    const immune = entry.immune as unknown[];
    expect(immune.some((e) => typeof e === "object" && (e as JsonObject).cond === true)).toBe(true);
  });

  it("Foundry gets the types with the weapon bypass flags", () => {
    const { actor } = exportFoundryActor(werewolf);
    const di = ((actor.system as JsonObject).traits as JsonObject).di as JsonObject;
    expect(di.value).toContain("slashing");
    expect(di.bypasses).toEqual(expect.arrayContaining(["mgc", "sil"]));
  });
});
