// The Background step with the sample pack's Sentry: the background as a source, its choices, characteristics as
// free text with suggestions, and the rule that a duplicated skill is swapped for another.
import { describe, expect, it } from "vitest";
import { createContentIndex, newCharacterDocument, readPack, setChoice, viewCharacter, type ChoiceValue } from "../../core";
import { dnd5e2014 } from "./module";
import { BACKGROUND_KEY } from "./steps/background";
import { standardArray } from "./testing/abilities";
import sample from "./testing/elf-sample.pack.json";

const T = "2026-11-13T12:00:00.000Z";
const pack = (() => {
  const result = readPack(sample, dnd5e2014, []);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.pack;
})();
const content = createContentIndex([pack]);

function view(choices: Record<string, ChoiceValue>) {
  let doc = newCharacterDocument({ id: "c", system: { id: "dnd5e-2014", version: 1 }, packs: [{ id: "sample-srd", version: "0.1.0" }], now: T });
  for (const [key, value] of Object.entries(choices)) doc = setChoice(doc, key, value, T);
  return viewCharacter(dnd5e2014, doc, content);
}
const step = (v: ReturnType<typeof view>) => v.steps.find((s) => s.id === "background")!;
const choice = (v: ReturnType<typeof view>, key: string) => step(v).choices.find((c) => c.key === key);

const scores = standardArray({ str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 });
const sentry = { ...scores, [BACKGROUND_KEY]: "sample-srd:sentry" };
const elfSentry = { ...sentry, race: "sample-srd:elf" }; // the Elf already has Perception

describe("choosing a background", () => {
  it("offers each background as a card, with what it gives", () => {
    expect(choice(view({}), BACKGROUND_KEY)?.options?.map((o) => [o.name, o.tags])).toEqual([
      ["Sentry", ["Perception", "Athletics", "+1 language", "Watchword"]],
    ]);
  });

  it("gives its skills and feature, and opens its language choice", () => {
    const v = view({ ...sentry, "background.sample-srd:sentry.languages": "sample-srd:elvish" });
    expect(v.derived["skill.athletics"].breakdown).toEqual([{ label: "Strength", amount: -1 }, { label: "Proficient (Sentry)", amount: 2 }]);
    expect(v.lists["gains.background"]).toEqual([{ name: "Watchword", source: "Sentry", detail: "Guards everywhere let you pass with a word.", description: undefined }]);
    expect(step(v).status).toBe("done");
  });

  it("is to do until a background and its choices are picked; characteristics are never required", () => {
    expect(step(view({})).status).toBe("todo");
    expect(step(view(sentry)).status).toBe("todo"); // the language
    expect(step(view({ ...sentry, "background.sample-srd:sentry.languages": "sample-srd:elvish" })).status).toBe("done");
  });
});

describe("characteristics", () => {
  it("are free text, with the background's tables as suggestions (traits want two lines)", () => {
    const v = view(sentry);
    const traits = choice(v, "background.traits")!;
    expect(traits).toMatchObject({ kind: "long-text", required: false, source: "Sentry", count: { min: 2, max: 2 } });
    expect(traits.suggestions?.map((s) => s.text)).toEqual(["I never sit with my back to a door.", "I count everything.", "I speak only when I must."]);
    expect(choice(v, "background.ideal")?.suggestions).toEqual([{ text: "Duty. The wall stands because I stand.", note: "Lawful" }]);
  });

  it("stay offered without a background, with no suggestions, and keep what was written when it changes", () => {
    const v = view({ "background.bond": "My sister, lost at sea." });
    expect(choice(v, "background.bond")).toMatchObject({ suggestions: [], answered: true });
    expect(v.unused).toEqual([]);
  });
});

describe("a skill given twice is swapped for another", () => {
  it("the Elf's Perception, then the Sentry's: the Sentry's is replaced by a choice on the Background step", () => {
    const v = view(elfSentry);
    const replace = choice(v, "background.replace.perception")!;
    expect(replace.label).toBe("Sentry gives Perception, which you already have from Elf: choose another skill");
    expect(replace.options?.find((o) => o.value === "athletics")?.unavailable).toBe("Already proficient (Sentry)");
    expect(replace.options?.find((o) => o.value === "perception")?.unavailable).toBe("Already proficient (Elf)");
  });

  it("the pick counts as the background's, and the step waits for it", () => {
    const base = { ...elfSentry, "background.sample-srd:sentry.languages": "sample-srd:dwarvish" };
    expect(step(view(base)).status).toBe("todo");
    const v = view({ ...base, "background.replace.perception": "stealth" });
    expect(v.derived["skill.stealth"].breakdown).toEqual([{ label: "Dexterity", amount: 3 }, { label: "Proficient (Sentry)", amount: 2 }]);
    expect(v.derived["skill.perception"].breakdown).toEqual([{ label: "Wisdom", amount: 1 }, { label: "Proficient (Elf)", amount: 2 }]);
    expect(step(v).status).toBe("done");
  });

  it("no duplicate, no extra choice", () => {
    expect(choice(view(sentry), "background.replace.perception")).toBeUndefined();
  });
});
