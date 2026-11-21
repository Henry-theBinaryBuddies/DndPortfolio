// The Spells step with the sample pack: a wizard's cantrips, spellbook and prepared spells; a cleric's domain spells,
// always prepared; spells from a race; save DC, attack bonus and slots; casters who start later, and non-casters.
import { describe, expect, it } from "vitest";
import { createContentIndex, newCharacterDocument, readPack, setChoice, viewCharacter, type ChoiceValue, type IndexedPack } from "../../core";
import { dnd5e2014 } from "./module";
import { CLASS_KEY } from "./steps/class";
import { GOLD_KEY, METHOD_KEY, SHOP_KEY } from "./steps/equipment";
import { standardArray } from "./testing/abilities";
import sample from "./testing/elf-sample.pack.json";

const T = "2026-11-14T12:00:00.000Z";
function load(file: unknown, required: IndexedPack[] = []): IndexedPack {
  const result = readPack(file, dnd5e2014, required);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.pack;
}
const pack = load(sample);
/** A private pack on top of the sample: a race with a spell of its own and an expanded list, and an arcane focus. */
const extra = load({
  format: "adventurer-anvil-pack", formatVersion: 1, id: "extra", version: "0.1.0", system: "dnd5e-2014", title: "Extra", requires: ["sample-srd"],
  collections: {
    races: [{
      id: "tiefling", name: "Tiefling", size: "medium",
      effects: [{ type: "spell", id: "sample-srd:thaumaturgy", ability: "cha" }, { type: "expanded-spells", ids: ["sample-srd:sacred-flame"] }],
    }],
    items: [{ id: "crystal", name: "Crystal", categories: ["arcane-foci"], cost: { amount: 10, unit: "gp" }, weight: 1 }],
  },
}, [pack]);

function view(choices: Record<string, ChoiceValue>) {
  let doc = newCharacterDocument({ id: "c", system: { id: "dnd5e-2014", version: 1 }, packs: [{ id: "sample-srd", version: "0.1.0" }], now: T });
  for (const [key, value] of Object.entries(choices)) doc = setChoice(doc, key, value, T);
  return viewCharacter(dnd5e2014, doc, createContentIndex([pack, extra]));
}
const step = (v: ReturnType<typeof view>) => v.steps.find((s) => s.id === "spells")!;
const choice = (v: ReturnType<typeof view>, key: string) => step(v).choices.find((c) => c.key === key);
const names = (v: ReturnType<typeof view>, list: string) => (v.lists[list] ?? []).map((i) => i.name);

const scores = standardArray({ str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 });
const W = "spells.sample-srd:wizard";
const wizard = { ...scores, [CLASS_KEY]: "sample-srd:wizard" };
const book = ["sample-srd:magic-missile", "sample-srd:shield", "sample-srd:detect-magic", "sample-srd:burning-hands", "sample-srd:sleep", "sample-srd:comprehend-languages"];
const readyWizard = { ...wizard, [`${W}.cantrips`]: ["sample-srd:fire-bolt", "sample-srd:light", "sample-srd:prestidigitation"], [`${W}.spellbook`]: book };

describe("a wizard", () => {
  it("chooses three cantrips and six 1st-level spells for the book (no 2nd-level ones: no slots for them yet)", () => {
    const v = view(wizard);
    expect(choice(v, `${W}.cantrips`)).toMatchObject({ label: "Wizard cantrips (3)", kind: "pick-many", presentation: "list", count: { min: 3, max: 3 }, required: true });
    expect(choice(v, `${W}.spellbook`)?.label).toBe("Spellbook: 1st-level wizard spells (6)");
    expect(choice(v, `${W}.spellbook`)?.options?.map((o) => o.name)).toEqual(["Burning Hands", "Comprehend Languages", "Detect Magic", "Magic Missile", "Shield", "Sleep"]);
    expect(choice(v, `${W}.cantrips`)?.options?.[0]).toMatchObject({
      name: "Fire Bolt", summary: "Evocation cantrip · 1 action · 120 feet · Instantaneous", tags: ["Evocation"],
    });
    expect(choice(v, `${W}.spellbook`)?.options?.find((o) => o.name === "Detect Magic")?.tags).toEqual(["Divination", "Concentration", "Ritual"]);
    expect(step(v).status).toBe("todo");
    expect(step(view(readyWizard)).status).toBe("done"); // preparing is optional
  });

  it("prepares up to Int modifier + level from the spellbook, optionally", () => {
    const v = view(readyWizard);
    expect(choice(v, `${W}.prepared`)).toMatchObject({
      required: false, count: { min: 0, max: 3 },
      hint: "Intelligence modifier (+2) + your Wizard level (1) = 3, at least 1. You can change these after each long rest. Choose from your spellbook.",
    });
    expect(choice(v, `${W}.prepared`)?.options?.length).toBe(6);
    const prepared = view({ ...readyWizard, [`${W}.prepared`]: ["sample-srd:magic-missile", "sample-srd:shield"] });
    expect(names(prepared, "spells")).toEqual([
      "Burning Hands", "Comprehend Languages", "Detect Magic", "Magic Missile (prepared)", "Shield (prepared)", "Sleep",
    ]);
    const tooMany = view({ ...readyWizard, [`${W}.prepared`]: book.slice(0, 4) });
    expect(tooMany.issues.find((i) => i.id === `pick-count:${W}.prepared`)?.message).toBe("Prepared today (optional): choose up to 3 (4 chosen).");
  });

  it("has a save DC and attack bonus from Intelligence, and two 1st-level slots", () => {
    const v = view(readyWizard);
    expect(v.derived["spell.dc.int"]).toEqual({
      value: 12, label: "Spell save DC",
      breakdown: [{ label: "Base", amount: 8 }, { label: "Proficiency bonus", amount: 2 }, { label: "Intelligence", amount: 2 }],
    });
    expect(v.derived["spell.attack.int"].value).toBe("+4");
    expect(v.derived["spell.slots"]).toMatchObject({ value: "1st: 2", breakdown: [{ label: "Wizard", amount: "1st: 2" }] });
    expect(names(v, "cantrips")).toEqual(["Fire Bolt", "Light", "Prestidigitation"]);
    expect(v.lists["spell-list"][0]).toMatchObject({ name: "Fire Bolt", source: "Wizard", detail: "Cantrip · cast with Intelligence" });
  });

  it("a High Elf wizard: the race's cantrip is on this step, and can't be taken again as a class cantrip", () => {
    const v = view({ ...wizard, race: "sample-srd:elf", "race.sample-srd:elf.subrace": "sample-srd:high-elf", "race.sample-srd:high-elf.cantrip": "sample-srd:fire-bolt" });
    // Prepared spells come from the spellbook, so they're asked for once it has some.
    expect(step(v).choices.map((c) => c.key)).toEqual(["race.sample-srd:high-elf.cantrip", `${W}.cantrips`, `${W}.spellbook`]);
    expect(choice(v, `${W}.cantrips`)?.options?.find((o) => o.name === "Fire Bolt")?.unavailable).toBe("Already known (High Elf)");
  });

  it("warns once equipment is chosen without a component pouch or focus; a crystal will do", () => {
    const gold = { ...readyWizard, [METHOD_KEY]: "gold", [GOLD_KEY]: 20 };
    expect(view(readyWizard).issues.map((i) => i.id)).not.toContain("no-focus");
    expect(view(gold).issues.find((i) => i.id === "no-focus")?.message).toBe("For Wizard spells with material components, carry a component pouch or a spellcasting focus (see Equipment).");
    expect(view({ ...gold, [SHOP_KEY]: { "extra:crystal": 1 } }).issues.map((i) => i.id)).not.toContain("no-focus");
  });
});

describe("a cleric of the Life Domain", () => {
  const C = "spells.sample-srd:cleric";
  const cleric = { ...standardArray({ str: 14, dex: 8, con: 13, int: 10, wis: 15, cha: 12 }), [CLASS_KEY]: "sample-srd:cleric", "class.sample-srd:cleric.subclass": "sample-srd:life" };

  it("always has Bless and Cure Wounds prepared, and prepares Wis modifier + level others from the whole list", () => {
    const v = view({ ...cleric, [`${C}.prepared`]: ["sample-srd:detect-magic"] });
    expect(choice(v, `${C}.prepared`)?.options?.map((o) => o.name)).toEqual(["Detect Magic", "Guiding Bolt"]); // the domain spells don't count
    expect(choice(v, `${C}.prepared`)?.count).toEqual({ min: 0, max: 3 });
    expect(names(v, "spells")).toEqual(["Bless (always prepared)", "Cure Wounds (always prepared)", "Detect Magic (prepared)"]);
    expect(v.lists["spell-list"].find((s) => s.name === "Bless")).toMatchObject({ source: "Life Domain", detail: "1st level · cast with Wisdom · always prepared" });
    expect(v.derived["spell.dc.wis"].value).toBe(12);
  });
});

describe("spells from elsewhere", () => {
  it("a tiefling wizard: Thaumaturgy is cast with Charisma, so each ability has its own DC; an expanded list adds options", () => {
    const v = view({ ...readyWizard, race: "extra:tiefling" });
    expect(names(v, "cantrips")).toEqual(["Fire Bolt", "Light", "Prestidigitation", "Thaumaturgy"]);
    expect(v.derived["spell.dc.int"].label).toBe("Spell save DC (Intelligence)");
    expect(v.derived["spell.dc.cha"]).toMatchObject({ value: 10, label: "Spell save DC (Charisma)" });
    expect(choice(v, `${W}.cantrips`)?.options?.map((o) => o.name)).toContain("Sacred Flame");
  });
});

describe("classes without spells yet", () => {
  it("a paladin starts casting at level 2; a fighter doesn't cast at all: the step says so and is done", () => {
    const paladin = view({ ...scores, [CLASS_KEY]: "sample-srd:paladin" });
    expect(paladin.issues.find((i) => i.step === "spells")?.message).toBe("The Paladin starts casting spells at level 2.");
    expect(step(paladin)).toMatchObject({ status: "done", choices: [] });
    expect(paladin.derived["spell.slots"]).toBeUndefined();
    const fighter = view({ ...scores, [CLASS_KEY]: "sample-srd:fighter" });
    expect(fighter.issues.find((i) => i.step === "spells")?.message).toBe("The Fighter doesn't cast spells at level 1.");
  });
});
