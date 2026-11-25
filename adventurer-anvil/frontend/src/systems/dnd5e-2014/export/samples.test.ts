// The sample characters in adventurer-anvil/samples/: every one is complete, the saved files match what the exporter
// makes now (run `npm run samples` if not), and the spells the source files describe incompletely export correctly.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCharacterText } from "../../../core";
import { dnd5e2014 } from "../module";
import { SAMPLES, SAMPLES_DIR, sampleContent, sampleDoc, sampleExport, todo } from "../../../../../tools/samples";

const content = sampleContent();
const saved = (dir: string, file: string) => readFileSync(join(SAMPLES_DIR, dir, file), "utf8").replace(/\r\n/g, "\n");
const creature = (file: string) => JSON.parse(saved("tomeandtile", `${file}.creature.json`));
const ability = (file: string, name: string) => creature(file).abilities.find((a: { name: string }) => a.name === name);

describe("the sample characters", () => {
  for (const s of SAMPLES) {
    it(`${s.name} is complete, and its saved files are current`, () => {
      expect(todo(sampleDoc(s, content), content)).toEqual([]);
      expect(saved("characters", `${s.file}.anvil.json`)).toBe(`${JSON.stringify(sampleDoc(s, content), null, 2)}\n`);
      expect(readCharacterText(saved("characters", `${s.file}.anvil.json`), dnd5e2014, content.packs())).toMatchObject({ ok: true, notes: [] });
      const out = sampleExport(s, content);
      expect(out.warnings).toEqual([]);
      expect(saved("tomeandtile", `${s.file}.creature.json`)).toBe(out.text);
    });
  }
});

describe("spells the source files describe incompletely", () => {
  it("Scorching Ray: three ranged spell attacks; Magic Missile: automatic damage", () => {
    const ray = ability("seraphine-vael-wizard-3", "Scorching Ray");
    expect(ray.steps).toHaveLength(3);
    expect(ray.steps[0].attack).toMatchObject({ toHitBonus: 5, damage: [{ dice: "2d6", type: "DAMAGE_TYPE_FIRE" }] });
    expect(ray.targeting.maxTargets).toBe(3);
    expect(ability("seraphine-vael-wizard-3", "Magic Missile").steps[0].flat.damage[0].dice).toBe("3d4+3");
  });

  it("Spiritual Weapon's damage has the modifier filled in", () => {
    expect(ability("bronna-ironhearth-cleric-3", "Spiritual Weapon").steps[0].attack.damage[0].dice).toBe("1d8+3");
  });

  it("Mage Armor from Armor of Shadows is cast at will, without a pact slot; the warlock's own spells spend one", () => {
    expect(ability("mordecai-ash-warlock-3", "Mage Armor").resourceKey).toBeUndefined();
    expect(ability("mordecai-ash-warlock-3", "Scorching Ray").resourceKey).toBe("pact_slot_2");
  });
});
