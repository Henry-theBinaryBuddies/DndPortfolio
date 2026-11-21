// The rules engine, end to end: character file + sample pack → the full picture, through the core.
import { describe, expect, it } from "vitest";
import {
  addOverride, createContentIndex, newCharacterDocument, readPack, setChoice, viewCharacter,
  type CharacterDocument, type ChoiceValue,
} from "../../core";
import { dnd5e2014 } from "./module";
import { pointBuy, standardArray } from "./testing/abilities";
import sample from "./testing/elf-sample.pack.json";

const T = "2026-11-12T10:00:00.000Z";
const pack = (() => {
  const result = readPack(sample, dnd5e2014, []);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.pack;
})();
const content = createContentIndex([pack]);

const STANDARD = { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 };

function character(choices: Record<string, ChoiceValue>): CharacterDocument {
  let doc = newCharacterDocument({ id: "c", system: { id: "dnd5e-2014", version: 1 }, packs: [{ id: "sample-srd", version: "0.1.0" }], now: T });
  for (const [key, value] of Object.entries(choices)) doc = setChoice(doc, key, value, T);
  return doc;
}
const view = (choices: Record<string, ChoiceValue>) => viewCharacter(dnd5e2014, character(choices), content);
const value = (v: ReturnType<typeof view>, key: string) => v.derived[key]?.value;
const names = (v: ReturnType<typeof view>, list: string) => (v.lists[list] ?? []).map((i) => i.name);

const highElf = {
  race: "sample-srd:elf",
  "race.sample-srd:elf.subrace": "sample-srd:high-elf",
  ...standardArray(STANDARD),
};

describe("a new character", () => {
  it("has Race, Abilities, Class, Background and Equipment steps to do, Spells with nothing yet, and Details waiting for a name, with 10s until scores are set", () => {
    const v = view({});
    expect(v.steps.map((s) => [s.id, s.status])).toEqual([["race", "todo"], ["abilities", "todo"], ["class", "todo"], ["background", "todo"], ["equipment", "todo"], ["spells", "done"], ["details", "todo"]]);
    expect(v.steps[0].choices[0].options?.map((o) => o.name)).toEqual(["Elf", "Half-Elf"]);
    expect(value(v, "ability.str")).toBe(10);
    expect(value(v, "ac")).toBe(10);
  });
});

describe("the worked example: a High Elf with the standard array", () => {
  const v = view(highElf);

  it("adds racial bonuses to the base scores, with breakdowns", () => {
    expect(v.derived["ability.dex"]).toEqual({ value: 16, label: "Dexterity", breakdown: [{ label: "Base", amount: 14 }, { label: "Elf", amount: 2 }] });
    expect(v.derived["ability.int"].breakdown).toEqual([{ label: "Base", amount: 15 }, { label: "High Elf", amount: 1 }]);
    expect(value(v, "ability.dex.mod")).toBe(3);
    expect(value(v, "ability.int.mod")).toBe(3);
  });

  it("works out Perception, passive Perception, AC, initiative, speed and proficiency bonus", () => {
    expect(v.derived["skill.perception"]).toEqual({
      value: 3, label: "Perception", breakdown: [{ label: "Wisdom", amount: 1 }, { label: "Proficient (Elf)", amount: 2 }],
    });
    expect(value(v, "passive.perception")).toBe(13);
    expect(value(v, "ac")).toBe(13);
    expect(value(v, "initiative")).toBe(3);
    expect(value(v, "speed.walk")).toBe(30);
    expect(value(v, "proficiency-bonus")).toBe(2);
    expect(value(v, "skill.stealth")).toBe(3); // Dex +3, not proficient
  });

  it("lists senses, languages, proficiencies and features with their sources", () => {
    expect(v.lists.senses).toEqual([{ name: "Darkvision 60 ft", source: "Elf" }]);
    expect(names(v, "languages")).toEqual(["Common", "Elvish"]);
    expect(v.lists.proficiencies.filter((p) => p.detail === "weapon").map((p) => p.name)).toEqual(["Longsword", "Shortsword", "Shortbow", "Longbow"]);
    expect(names(v, "features")).toEqual(["Fey Ancestry", "Trance"]);
  });

  it("opens the High Elf's choices keyed by their source: the cantrip on the Spells step, drawn as a spell list", () => {
    const keys = v.steps[0].choices.map((c) => c.key);
    expect(keys).toEqual(["race", "race.sample-srd:elf.subrace", "race.sample-srd:high-elf.language"]);
    const spells = v.steps.find((s) => s.id === "spells")!;
    expect(spells.choices.map((c) => [c.key, c.source, c.presentation])).toEqual([["race.sample-srd:high-elf.cantrip", "High Elf", "list"]]);
  });

  it("marks languages already known, with the reason", () => {
    const language = v.steps[0].choices.find((c) => c.key === "race.sample-srd:high-elf.language")!;
    expect(language.options?.map((o) => [o.name, o.unavailable])).toEqual([
      ["Common", "Already known (Elf)"],
      ["Dwarvish", undefined],
      ["Elvish", "Already known (Elf)"],
      ["Draconic", undefined],
    ]);
  });

  it("offers wizard cantrips for the High Elf's cantrip, on the Spells step, which waits for it", () => {
    const cantrip = v.steps.find((s) => s.id === "spells")!.choices[0];
    expect(cantrip.options?.map((o) => o.name)).toEqual(["Fire Bolt", "Light", "Prestidigitation"]);
    const done = view({ ...highElf, "race.sample-srd:high-elf.language": "sample-srd:draconic" });
    expect(done.steps.slice(0, 2).map((s) => s.status)).toEqual(["done", "done"]);
    expect(done.steps.find((s) => s.id === "spells")?.status).toBe("todo");
    expect(names(done, "languages")).toEqual(["Common", "Elvish", "Draconic"]);
  });
});

describe("fixed-list choices: the Half-Elf", () => {
  const halfElf = { race: "sample-srd:half-elf", ...standardArray(STANDARD) };

  it("offers abilities except Charisma, and every skill", () => {
    const v = view(halfElf);
    const abilities = v.steps[0].choices.find((c) => c.key === "race.sample-srd:half-elf.abilities")!;
    expect(abilities.kind).toBe("pick-many");
    expect(abilities.count).toEqual({ min: 2, max: 2 });
    expect(abilities.options?.map((o) => o.value)).toEqual(["str", "dex", "con", "int", "wis"]);
    expect(v.steps[0].choices.find((c) => c.key === "race.sample-srd:half-elf.skills")!.options).toHaveLength(18);
  });

  it("fills each pick into the effect it names", () => {
    const v = view({
      ...halfElf,
      "race.sample-srd:half-elf.abilities": ["dex", "con"],
      "race.sample-srd:half-elf.skills": ["stealth", "persuasion"],
    });
    expect(v.derived["ability.dex"].breakdown).toEqual([{ label: "Base", amount: 14 }, { label: "Half-Elf", amount: 1 }]);
    expect(value(v, "ability.con")).toBe(14);
    expect(value(v, "ability.cha")).toBe(12);
    expect(v.derived["skill.stealth"].breakdown).toEqual([{ label: "Dexterity", amount: 2 }, { label: "Proficient (Half-Elf)", amount: 2 }]);
    expect(value(v, "skill.persuasion")).toBe(3);
  });

  it("reports the wrong number of picks, duplicates, and picks outside the list", () => {
    const issues = (picks: string[]) => view({ ...halfElf, "race.sample-srd:half-elf.abilities": picks }).issues.map((i) => i.id);
    expect(issues(["dex"])).toContain("pick-count:race.sample-srd:half-elf.abilities");
    expect(issues(["dex", "dex"])).toContain("duplicate-pick:race.sample-srd:half-elf.abilities");
    expect(issues(["dex", "cha"])).toContain("invalid-pick:race.sample-srd:half-elf.abilities:cha");
  });
});

describe("rule problems and rulings", () => {
  it("flags a language picked twice over, and a ruling lets it stand", () => {
    const doc = character({ ...highElf, "race.sample-srd:high-elf.language": "sample-srd:elvish" });
    const v = viewCharacter(dnd5e2014, doc, content);
    const issue = v.issues.find((i) => i.id === "already-have:race.sample-srd:high-elf.language:sample-srd:elvish")!;
    expect(issue.message).toBe("Choose one extra language: Elvish: already known (Elf).");
    expect(v.steps[0].status).toBe("problem");

    const ruled = viewCharacter(dnd5e2014, addOverride(doc, issue.id, "DM allows it", T), content);
    expect(ruled.steps[0].status).toBe("done");
  });

  it("reports content from a pack that is not loaded, and that cannot be overridden", () => {
    const v = view({ race: "henry-phb:tiefling" });
    const issue = v.issues.find((i) => i.id === "missing-content:race:henry-phb:tiefling")!;
    expect(issue.overridable).toBe(false);
    expect(issue.message).toBe('Choose a race: "henry-phb:tiefling" is not in any loaded pack.');
  });

  it("warns about a score above 20", () => {
    const v = view({ ...highElf, ...pointBuy({ ...STANDARD, dex: 20 }) });
    expect(value(v, "ability.dex")).toBe(22);
    expect(v.issues.find((i) => i.id === "score-above-20:dex")?.severity).toBe("warning");
  });

  it("refuses scores that are not six whole numbers from 1 to 30", () => {
    expect(view(standardArray({ str: 8.5 })).issues.map((i) => i.id)).toContain("bad-scores");
    expect(view(standardArray({ strength: 8 })).issues.map((i) => i.id)).toContain("bad-scores");
  });
});

describe("switching race", () => {
  it("leaves the old race's choices behind, and finds them again on switching back", () => {
    const asHighElf = { ...highElf, "race.sample-srd:high-elf.language": "sample-srd:draconic" };
    const switched = view({ ...asHighElf, race: "sample-srd:half-elf" });
    expect(switched.unused).toEqual(["race.sample-srd:elf.subrace", "race.sample-srd:high-elf.language"]);
    expect(value(switched, "ability.int")).toBe(15); // the High Elf's +1 is gone

    const back = view(asHighElf);
    expect(back.unused).toEqual([]);
    expect(names(back, "languages")).toContain("Draconic");
  });
});
