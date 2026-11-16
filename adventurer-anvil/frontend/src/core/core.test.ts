import { describe, expect, it } from "vitest";
import {
  addOverride,
  clearChoices,
  newCharacterDocument,
  removeOverride,
  setChoice,
  type CharacterDocument,
} from "./character";
import { createContentIndex, parseContentRef } from "./content";
import { viewCharacter } from "./system";
import { toyGarden, toyGardenContent, toyGardenPack } from "./testing/toyGarden";

const T0 = "2026-11-09T10:00:00.000Z";
const T1 = "2026-11-09T10:05:00.000Z";

function fresh(): CharacterDocument {
  return newCharacterDocument({
    id: "c1",
    system: { id: toyGarden.id, version: toyGarden.version },
    packs: [{ id: toyGardenPack.id, version: toyGardenPack.version }],
    now: T0,
    choices: toyGarden.initialChoices(),
  });
}

describe("character document", () => {
  it("starts empty, with the core's format and the system's version", () => {
    const doc = fresh();
    expect(doc.format).toBe("adventurer-anvil-character");
    expect(doc.formatVersion).toBe(1);
    expect(doc.system).toEqual({ id: "toy-garden", version: 1 });
    expect(doc).toMatchObject({ choices: {}, overrides: [], rolls: [], state: {}, createdAt: T0, updatedAt: T0 });
  });

  it("returns a new document on each change and leaves the old one alone", () => {
    const before = fresh();
    const after = setChoice(before, "plant", "garden-basics:fern", T1);
    expect(before.choices).toEqual({});
    expect(after.choices).toEqual({ plant: "garden-basics:fern" });
    expect(after.updatedAt).toBe(T1);
  });

  it("keeps one ruling per issue", () => {
    let doc = addOverride(fresh(), "x", "first", T0);
    doc = addOverride(doc, "x", "second", T1);
    expect(doc.overrides).toEqual([{ issueId: "x", note: "second", at: T1 }]);
    expect(removeOverride(doc, "x", T1).overrides).toEqual([]);
  });

  it("survives a round trip through JSON unchanged", () => {
    const doc = setChoice(setChoice(fresh(), "plant", "garden-basics:cactus", T1), "care", { sun: 3, water: 1 }, T1);
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});

describe("content", () => {
  it("reads pack:entry references", () => {
    expect(parseContentRef("garden-basics:fern")).toEqual({ pack: "garden-basics", entry: "fern" });
    expect(parseContentRef("pack:entry:with:colons")).toEqual({ pack: "pack", entry: "entry:with:colons" });
    expect(parseContentRef("no-colon")).toBeNull();
    expect(parseContentRef(":entry")).toBeNull();
  });

  it("looks entries up by reference and by collection, across packs", () => {
    const index = createContentIndex([
      toyGardenPack,
      { id: "more", version: "0.1", collections: { plants: [{ id: "fern", name: "Tree fern" }] } },
    ]);
    expect(index.get("plants", "garden-basics:fern")?.name).toBe("Fern");
    expect(index.get("plants", "more:fern")?.name).toBe("Tree fern");
    expect(index.list("plants").map((p) => p.ref)).toEqual(["garden-basics:cactus", "garden-basics:fern", "more:fern"]);
    expect(index.list("nothing")).toEqual([]);
  });

  it("keeps entries with the same id in different collections apart", () => {
    // SRD 5.1 has both a race and a language called "halfling".
    const index = createContentIndex([
      { id: "p", version: "1", collections: { kinds: [{ id: "halfling", name: "Halfling (kind)" }], tongues: [{ id: "halfling", name: "Halfling (tongue)" }] } },
    ]);
    expect(index.get("kinds", "p:halfling")?.name).toBe("Halfling (kind)");
    expect(index.get("tongues", "p:halfling")?.name).toBe("Halfling (tongue)");
    expect(index.get("nothing", "p:halfling")).toBeUndefined();
  });
});

describe("a second system (the toy garden) through the core", () => {
  it("shows open steps for a new character", () => {
    const view = viewCharacter(toyGarden, fresh(), toyGardenContent);
    expect(view.steps.map((s) => [s.id, s.status])).toEqual([["seed", "todo"], ["care", "todo"]]);
    expect(view.steps[0].choices[0].options?.map((o) => o.name)).toEqual(["Cactus", "Fern"]);
  });

  it("opens a choice granted by an earlier pick", () => {
    const doc = setChoice(fresh(), "plant", "garden-basics:cactus", T1);
    const seed = viewCharacter(toyGarden, doc, toyGardenContent).steps[0];
    expect(seed.choices.map((c) => c.key)).toEqual(["plant", "plant.garden-basics:cactus.pot"]);
    expect(seed.choices[1].source).toBe("Cactus");
  });

  it("explains every derived value", () => {
    let doc = setChoice(fresh(), "plant", "garden-basics:cactus", T1);
    doc = setChoice(doc, "care", { sun: 3, water: 1 }, T1);
    expect(viewCharacter(toyGarden, doc, toyGardenContent).derived.sun).toEqual({
      value: 4,
      label: "Sun",
      breakdown: [{ label: "Care", amount: 3 }, { label: "Cactus", amount: 1 }],
    });
  });

  it("reports a broken rule, makes its step a problem, and lets a ruling stand without hiding it", () => {
    let doc = setChoice(fresh(), "plant", "garden-basics:cactus", T1);
    doc = setChoice(doc, "plant.garden-basics:cactus.pot", "stone", T1);
    doc = setChoice(doc, "care", { sun: 1, water: 3 }, T1);

    const broken = viewCharacter(toyGarden, doc, toyGardenContent);
    expect(broken.issues.map((i) => i.id)).toEqual(["too-much-water:garden-basics:cactus"]);
    expect(broken.steps.find((s) => s.id === "care")?.status).toBe("problem");

    const ruled = viewCharacter(toyGarden, addOverride(doc, "too-much-water:garden-basics:cactus", "DM allows it", T1), toyGardenContent);
    expect(ruled.issues[0].override).toEqual({ note: "DM allows it", at: T1 });
    expect(ruled.steps.find((s) => s.id === "care")?.status).toBe("done");
  });

  it("does not let a ruling mark an unfinished step done", () => {
    let doc = setChoice(fresh(), "plant", "garden-basics:cactus", T1); // no pot chosen yet
    doc = setChoice(doc, "care", { sun: 1, water: 3 }, T1);
    doc = addOverride(doc, "too-much-water:garden-basics:cactus", "DM allows it", T1);
    expect(viewCharacter(toyGarden, doc, toyGardenContent).steps.find((s) => s.id === "seed")?.status).toBe("todo");
  });

  it("keeps choices left behind by a change, until they are cleared", () => {
    let doc = setChoice(fresh(), "plant", "garden-basics:cactus", T1);
    doc = setChoice(doc, "plant.garden-basics:cactus.pot", "stone", T1);
    doc = setChoice(doc, "plant", "garden-basics:fern", T1);

    const view = viewCharacter(toyGarden, doc, toyGardenContent);
    expect(view.unused).toEqual(["plant.garden-basics:cactus.pot"]);

    // Switching back finds the pot still chosen.
    const back = setChoice(doc, "plant", "garden-basics:cactus", T1);
    expect(viewCharacter(toyGarden, back, toyGardenContent).unused).toEqual([]);
    expect(back.choices["plant.garden-basics:cactus.pot"]).toBe("stone");

    // Clearing removes it for good.
    expect(viewCharacter(toyGarden, clearChoices(doc, view.unused, T1), toyGardenContent).unused).toEqual([]);
  });

  it("passes a system's lists through", () => {
    const doc = setChoice(fresh(), "plant", "garden-basics:fern", T1);
    expect(viewCharacter(toyGarden, doc, toyGardenContent).lists).toEqual({ companions: [{ name: "Pot: none", source: "Fern" }] });
  });

  it("lists rulings whose problem has gone away", () => {
    const doc = addOverride(fresh(), "too-much-water:garden-basics:cactus", "old ruling", T1);
    expect(viewCharacter(toyGarden, doc, toyGardenContent).staleOverrides).toEqual(["too-much-water:garden-basics:cactus"]);
  });

  it("refuses a character from another system", () => {
    const other = { ...fresh(), system: { id: "some-other-game", version: 1 } };
    expect(() => viewCharacter(toyGarden, other, toyGardenContent)).toThrow(/some-other-game/);
  });

  it("brings an older file up to the system's version before evaluating", () => {
    let migrated = false;
    const system = { ...toyGarden, version: 2, migrate: (d: CharacterDocument) => ((migrated = true), { ...d, system: { ...d.system, version: 2 } }) };
    viewCharacter(system, fresh(), toyGardenContent);
    expect(migrated).toBe(true);
  });
});
