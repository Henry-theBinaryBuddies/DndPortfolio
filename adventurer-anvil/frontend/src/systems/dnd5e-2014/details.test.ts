// The Details step: the name (the one required choice, kept in the file's name field), suggestions from the race
// (names from lists or syllables, ages, heights and weights in its ranges), alignment, personality moved here from
// Background, and the portrait.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createContentIndex, NAME_KEY, newCharacterDocument, readPack, setChoice, setName, viewCharacter, type ChoiceValue, type IndexedPack } from "../../core";
import { RANGES } from "../../../../tools/srd/details";
import { makeNames, seeded } from "./engine/suggest";
import { dnd5e2014 } from "./module";
import { BACKGROUND_KEY } from "./steps/background";
import { ALIGNMENT_KEY, PORTRAIT_KEY } from "./steps/details";
import sample from "./testing/elf-sample.pack.json";

const T = "2026-11-16T12:00:00.000Z";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
function load(file: unknown): IndexedPack {
  const result = readPack(file, dnd5e2014, []);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.pack;
}
const samplePack = load(sample);
const srd = load(JSON.parse(readFileSync(join(ROOT, "frontend/public/packs/srd-5.1.pack.json"), "utf8")));

function view(choices: Record<string, ChoiceValue>, opts: { name?: string; id?: string; pack?: IndexedPack } = {}) {
  let doc = newCharacterDocument({ id: opts.id ?? "c", system: { id: "dnd5e-2014", version: 1 }, packs: [], now: T });
  if (opts.name) doc = setName(doc, opts.name, T);
  for (const [key, value] of Object.entries(choices)) doc = setChoice(doc, key, value, T);
  return viewCharacter(dnd5e2014, doc, createContentIndex([opts.pack ?? samplePack]));
}
const step = (v: ReturnType<typeof view>) => v.steps.find((s) => s.id === "details")!;
const choice = (v: ReturnType<typeof view>, key: string) => step(v).choices.find((c) => c.key === key);
const inches = (text: string) => { const [, f, i] = /(\d+) ft (\d+) in/.exec(text)!; return Number(f) * 12 + Number(i); };

describe("the name", () => {
  it("is the step's one required choice, and lives in the file's name field", () => {
    expect(step(view({})).status).toBe("todo");
    expect(choice(view({}), NAME_KEY)).toMatchObject({ kind: "text", required: true, answered: false });
    const named = view({}, { name: "Ilvaren Ashveil" });
    expect(step(named).status).toBe("done");
    expect(named.unused).toEqual([]);
  });

  it("is suggested from a pack's lists, each given name paired with a family name", () => {
    const names = choice(view({ race: "sample-srd:elf" }), NAME_KEY)!.suggestions!.map((s) => s.text);
    expect(names.length).toBe(6); // 3 given × 2 family
    for (const n of names) expect(n).toMatch(/^(Ilvaren|Saelith|Tarnis) (Ashveil|Dawnreach)$/);
  });

  it("is built from the SRD race's syllables, the same list for the same character, another for another", () => {
    const a = choice(view({ race: "srd-5.1:dwarf" }, { pack: srd }), NAME_KEY)!.suggestions!.map((s) => s.text);
    expect(a.length).toBe(12);
    expect(new Set(a).size).toBe(12);
    for (const n of a) expect(n).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(choice(view({ race: "srd-5.1:dwarf" }, { pack: srd }), NAME_KEY)!.suggestions!.map((s) => s.text)).toEqual(a);
    expect(choice(view({ race: "srd-5.1:dwarf" }, { pack: srd, id: "other" }), NAME_KEY)!.suggestions!.map((s) => s.text)).not.toEqual(a);
    expect(choice(view({ race: "srd-5.1:dwarf" }, { pack: srd }), NAME_KEY)?.source).toBe("Dwarf");
  });

  it("says so when the race has nothing to suggest", () => {
    const pack = load({ ...structuredClone(sample), collections: { ...structuredClone(sample).collections, races: [{ id: "elf", name: "Elf", size: "medium", effects: [] }] } });
    expect(choice(view({ race: "sample-srd:elf" }, { pack }), NAME_KEY)).toMatchObject({ suggestions: [], hint: "The loaded packs have no elf names to suggest." });
  });

  it("generator: a start, sometimes a middle, an end, and a family name", () => {
    const names = makeNames({ start: ["Ka"], middle: ["ri"], end: ["th"], family: { start: ["Stone"], end: ["helm"] } }, seeded("x"), 2);
    expect(names.sort()).toEqual(["Karith Stonehelm", "Kath Stonehelm"]);
  });
});

describe("appearance", () => {
  it("suggests ages from adulthood into the first part of a life, and heights and weights inside the race's ranges", () => {
    const v = view({ race: "sample-srd:elf" });
    const ages = choice(v, "details.age")!.suggestions!.map((s) => Number(s.text));
    for (const a of ages) expect(a).toBeGreaterThanOrEqual(100), expect(a).toBeLessThanOrEqual(100 + 650 * 0.4);
    for (const h of choice(v, "details.height")!.suggestions!) expect(inches(h.text)).toBeGreaterThanOrEqual(56), expect(inches(h.text)).toBeLessThanOrEqual(74);
    for (const w of choice(v, "details.weight")!.suggestions!) expect(w.text).toMatch(/^(9\d|1[0-4]\d|145) lb$/);
    expect(["details.age", "details.eyes", "details.hair"].map((k) => choice(v, k)?.group)).toEqual(["Appearance", "Appearance", "Appearance"]);
  });

  it("an SRD race without a stated weight gets no weight suggestion, rather than an invented one", () => {
    const elf = view({ race: "srd-5.1:elf" }, { pack: srd });
    expect(choice(elf, "details.weight")?.suggestions).toBeUndefined();
    expect(choice(elf, "details.height")?.suggestions?.length).toBe(6);
  });
});

describe("alignment", () => {
  it("is a 3 × 3 grid, optional, with a note where the ideal leans one way", () => {
    const v = view({ [BACKGROUND_KEY]: "sample-srd:sentry", "background.ideal": "Duty. The wall stands because I stand." });
    const a = choice(v, ALIGNMENT_KEY)!;
    expect(a).toMatchObject({ kind: "pick-one", required: false, columns: 3, hint: "Your ideal (Duty) leans Lawful." });
    expect(a.options?.map((o) => o.name)).toEqual([
      "Lawful good", "Neutral good", "Chaotic good", "Lawful neutral", "Neutral", "Chaotic neutral", "Lawful evil", "Neutral evil", "Chaotic evil",
    ]);
    expect(choice(view({}), ALIGNMENT_KEY)?.hint).toBeUndefined();
  });
});

describe("personality, moved here from Background", () => {
  it("keeps its keys and the background's suggestions, and the Background step points here", () => {
    const v = view({ [BACKGROUND_KEY]: "sample-srd:sentry" });
    expect(choice(v, "background.traits")).toMatchObject({ kind: "long-text", source: "Sentry", count: { min: 2, max: 2 } });
    expect(v.steps.find((s) => s.id === "background")!.choices.map((c) => c.key)).not.toContain("background.traits");
    expect(v.steps.find((s) => s.id === "background")!.choices[0].hint).toBe("Its personality tables are offered as suggestions on the Details step.");
  });
});

describe("the portrait", () => {
  it("is a small picture kept in the file; anything else is reported", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(choice(view({ [PORTRAIT_KEY]: png }), PORTRAIT_KEY)).toMatchObject({ kind: "image", answered: true });
    expect(view({ [PORTRAIT_KEY]: "data:text/html;base64,PGI+" }).issues.map((i) => i.id)).toContain("bad-portrait");
    expect(view({ [PORTRAIT_KEY]: `data:image/png;base64,${"A".repeat(400_000)}` }).issues.map((i) => i.id)).toContain("bad-portrait");
    expect(view({ [PORTRAIT_KEY]: null }).issues.map((i) => i.id)).not.toContain("bad-portrait"); // removed
  });
});

describe("the SRD races' suggestions match their own text", () => {
  for (const [id, r] of Object.entries(RANGES)) {
    it(id, () => {
      const race = srd.collections.races.find((x) => x.id === id) as unknown as { description: string; suggestions: { ageAdult: number; ageMax: number } };
      expect(race.suggestions).toMatchObject({ ageAdult: r.ageAdult, ageMax: r.ageMax });
      // Where the SRD states an age as a number, that number is the one used.
      const stated = [...race.description.split("\n\n")[0].matchAll(/\b(\d+)\b/g)].map((m) => Number(m[1]));
      for (const n of stated.filter((n) => n !== 3 && n !== 10)) expect([r.ageAdult, r.ageMax, 350, 500]).toContain(n);
    });
  }
});

describe("how a saved character is described in lists", () => {
  const blurb = (choices: Record<string, ChoiceValue>) => {
    let doc = newCharacterDocument({ id: "c", system: { id: "dnd5e-2014", version: 1 }, packs: [], now: T });
    for (const [key, value] of Object.entries(choices)) doc = setChoice(doc, key, value, T);
    return dnd5e2014.describe(doc, createContentIndex([srd]));
  };
  it("the subrace (or race), then the class and level, and the portrait", () => {
    expect(blurb({})).toEqual({ text: "" });
    expect(blurb({ race: "srd-5.1:dwarf" })).toEqual({ text: "Dwarf" });
    expect(blurb({ race: "srd-5.1:dwarf", "race.srd-5.1:dwarf.subrace": "srd-5.1:hill-dwarf", "class.class": "srd-5.1:cleric" })).toEqual({ text: "Hill Dwarf Cleric 1" });
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(blurb({ "class.class": "srd-5.1:wizard", [PORTRAIT_KEY]: png })).toEqual({ text: "Wizard 1", picture: png });
    expect(blurb({ [PORTRAIT_KEY]: "data:text/html;base64,PGI+" })).toEqual({ text: "" });
  });
});
