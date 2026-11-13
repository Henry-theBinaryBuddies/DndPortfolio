import { describe, expect, it } from "vitest";
import { readPack, type IndexedPack, type SystemModule } from "../../core";
import { packSchema, SYSTEM_ID } from "./packFormat";
import sample from "./testing/elf-sample.pack.json";

// The rules module's evaluate arrives in step 5; reading packs needs only its id and pack check.
const dnd: SystemModule = {
  id: SYSTEM_ID,
  version: 1,
  title: "D&D 5e (2014)",
  packSchema,
  initialChoices: () => ({}),
  evaluate: () => ({ steps: [], derived: {}, issues: [], unused: [] }),
  migrate: (doc) => doc,
};

/** A deep copy of the sample, changed by `edit`. */
function variant(edit: (pack: any) => void): unknown {
  const copy = structuredClone(sample);
  edit(copy);
  return copy;
}

function errorsFor(data: unknown, loaded: IndexedPack[] = []): string[] {
  const result = readPack(data, dnd, loaded);
  return result.ok ? [] : result.errors;
}

describe("2014 pack format", () => {
  it("reads the Elf and High Elf sample", () => {
    const result = readPack(sample, dnd, []);
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (result.ok) {
      expect(result.pack.id).toBe("sample-srd");
      expect(result.pack.collections.subraces.map((s) => s.name)).toEqual(["High Elf"]);
    }
  });

  it("names the place and the problem for a misspelled effect type", () => {
    const data = variant((p) => (p.collections.races[0].effects[2].type = "darkvison"));
    expect(errorsFor(data)).toEqual([
      'collections.races[0].effects[2]: unknown effect type "darkvison" (known: ability-bonus, speed, sense, proficiency, language, resistance, grant, choice, resource, feature)',
    ]);
  });

  it("catches a misspelled field and a value outside the vocabulary", () => {
    expect(errorsFor(variant((p) => (p.collections.races[0].effects[0].abilty = "dex")))[0]).toMatch(
      /^collections\.races\[0\]\.effects\[0\]: /,
    );
    expect(errorsFor(variant((p) => (p.collections.races[0].sise = "medium")))).toContain('collections.races[0]: unknown field "sise"');
    expect(errorsFor(variant((p) => (p.collections.races[0].size = "enormous")))[0]).toMatch(/^collections\.races\[0\]\.size: /);
  });

  it("catches a subrace pointing at a race that does not exist", () => {
    expect(errorsFor(variant((p) => (p.collections.subraces[0].race = "elff")))).toEqual([
      'collections.subraces[0].race: no races entry "elff" in this pack.',
    ]);
  });

  it("catches a language or skill that does not exist", () => {
    expect(errorsFor(variant((p) => (p.collections.races[0].effects[7].id = "elven")))).toEqual([
      'collections.races[0].effects[7]: no languages entry "elven" in this pack.',
    ]);
    expect(errorsFor(variant((p) => (p.collections.races[0].effects[3].id = "spotting")))).toEqual([
      'collections.races[0].effects[3]: no skill "spotting".',
    ]);
  });

  it("catches an id used twice", () => {
    const data = variant((p) => p.collections.languages.push({ id: "elvish", name: "Elvish again" }));
    expect(errorsFor(data)).toEqual(['collections.languages[4]: the id "elvish" is used twice.']);
  });

  it("refuses collections that are not 2014 ones, and ones whose format is not written yet", () => {
    expect(errorsFor(variant((p) => (p.collections.monsters = []))))
      .toEqual([expect.stringMatching(/^collections\.monsters: not a 2014 collection/)]);
    expect(errorsFor(variant((p) => (p.collections.classes = [{ id: "fighter", name: "Fighter" }]))))
      .toEqual(["collections.classes: the format for classes arrives in a later step."]);
  });

  it("checks the wrapper and the system", () => {
    expect(errorsFor(variant((p) => (p.system = "kids-on-bikes")))).toEqual([
      'system: this pack is for "kids-on-bikes", not "dnd5e-2014".',
    ]);
    expect(errorsFor(variant((p) => (p.version = "1")))).toEqual(['version: three numbers, e.g. "1.0.0".']);
    expect(errorsFor("not a pack")).toEqual(["A pack must be a JSON object."]);
  });
});

describe("a private pack building on another", () => {
  const srd = (() => {
    const result = readPack(sample, dnd, []);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    return result.pack;
  })();

  const woodElf = {
    format: "adventurer-anvil-pack",
    formatVersion: 1,
    id: "henry-phb",
    version: "0.1.0",
    system: "dnd5e-2014",
    title: "My PHB notes",
    requires: ["sample-srd"],
    collections: {
      subraces: [
        {
          id: "wood-elf",
          name: "Wood Elf",
          race: "sample-srd:elf",
          summary: "Swift and stealthy forest elves.",
          source: { book: "PHB", page: 24 },
          effects: [
            { type: "ability-bonus", ability: "wis", amount: 1 },
            { type: "speed", walk: 35 },
            { type: "feature", name: "Mask of the Wild", summary: "Can try to hide when only lightly obscured by nature.", source: { book: "PHB", page: 24 } },
          ],
        },
      ],
    },
  };

  it("extends a race from the pack it requires", () => {
    expect(errorsFor(woodElf, [srd])).toEqual([]);
  });

  it("refuses to load before the pack it requires", () => {
    expect(errorsFor(woodElf, [])).toEqual(['requires: the pack "sample-srd" must be loaded first.']);
  });

  it("refuses references into a pack it does not list in requires", () => {
    expect(errorsFor({ ...woodElf, requires: [] }, [srd])).toEqual([
      'collections.subraces[0].race: "sample-srd:elf" points into the pack "sample-srd", which is not in this pack\'s requires.',
    ]);
  });

  it("refuses a second pack with the same id", () => {
    expect(errorsFor(sample, [srd])).toEqual(['id: a pack called "sample-srd" is already loaded.']);
  });
});
