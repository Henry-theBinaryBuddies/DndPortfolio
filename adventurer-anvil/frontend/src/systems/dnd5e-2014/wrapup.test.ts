// Milestone 1's last pieces, through the real SRD 5.1 pack: the example pack in docs/ loads clean and works; the
// inventory editor (changes, added items, your own items, attunement, money); the session journal; and the last SRD
// gaps (Spell Mastery and Signature Spells, the Circle of the Land, class spell choices beside their class).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createContentIndex, newCharacterDocument, readPack, setChoice, sheetSections, viewCharacter, type ChoiceValue } from "../../core";
import { dnd5e2014, SHEET } from "./module";
import { CLASS_KEY, LEVEL_KEY } from "./steps/class";
import { JOURNAL_KEY } from "./steps/details";
import { ADDED_KEY, ADJUST_KEY, ATTUNED_KEY, CUSTOM_KEY, METHOD_KEY, PURSE_KEY, GOLD_KEY, SHOP_KEY } from "./steps/equipment";
import { RULE_KEYS } from "./steps/rules";
import { standardArray } from "./testing/abilities";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const json = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const srd = readPack(json("frontend/public/packs/srd-5.1.pack.json"), dnd5e2014, []);
if (!srd.ok) throw new Error(srd.errors.join("\n"));
const example = readPack(json("docs/examples/my-homebrew.pack.json"), dnd5e2014, [srd.pack]);
const content = createContentIndex(example.ok ? [srd.pack, example.pack] : [srd.pack]);
const T = "2026-11-24T10:00:00Z";

function view(choices: Record<string, ChoiceValue>) {
  let d = newCharacterDocument({ id: "c", system: { id: "dnd5e-2014", version: 1 }, packs: [{ id: "srd-5.1", version: srd.ok ? srd.pack.version : "" }], now: T });
  for (const [k, v] of Object.entries(choices)) d = setChoice(d, k, v, T);
  return viewCharacter(dnd5e2014, d, content);
}
type View = ReturnType<typeof view>;
const choice = (v: View, key: string) => v.steps.flatMap((s) => s.choices).find((c) => c.key === key);
const ids = (v: View) => v.issues.map((i) => i.id);
const inventory = (v: View) => (v.lists.inventory ?? []).map((i) => `${i.name} · ${i.source}`);
const human = { race: "srd-5.1:human", ...standardArray({ str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8 }) };
const fighterKit = { ...human, [CLASS_KEY]: "srd-5.1:fighter", [METHOD_KEY]: "gold", [GOLD_KEY]: 100, [SHOP_KEY]: { "srd-5.1:torch": 5, "srd-5.1:rope-hempen-50-feet": 1 } };

describe("the example pack in docs/", () => {
  it("loads clean beside SRD 5.1", () => {
    expect(example.ok ? [] : example.errors).toEqual([]);
  });

  it("its Variant Human needs the feats rule, and takes its feat (with the feat's prerequisite and increase)", () => {
    const v = view({
      [RULE_KEYS.feats]: "on", race: "my-homebrew:variant-human", ...standardArray({ str: 8, dex: 15, con: 14, int: 13, wis: 12, cha: 10 }),
      "race.my-homebrew:variant-human.abilities": ["dex", "con"], "race.my-homebrew:variant-human.feat": "my-homebrew:steady-hands",
    });
    expect(v.derived["ability.dex"].value).toBe(17);
    expect(v.lists.feats.map((f) => f.name)).toEqual(["Steady Hands"]);
    expect(choice(view({}), "race")?.options?.some((o) => o.value === "my-homebrew:variant-human")).toBe(false);
  });
});

describe("the inventory editor", () => {
  it("changes what's carried, never below 0, and the weight follows", () => {
    const before = view(fighterKit);
    const adjust = choice(before, ADJUST_KEY)!;
    expect(adjust).toMatchObject({ kind: "quantities", presentation: "adjust", base: { "srd-5.1:torch": 5, "srd-5.1:rope-hempen-50-feet": 1 } });
    const after = view({ ...fighterKit, [ADJUST_KEY]: { "srd-5.1:torch": -3, "srd-5.1:rope-hempen-50-feet": -5 } });
    expect(inventory(after)).toEqual(["Torch × 2 · Bought"]);
    expect(Number(after.derived.weight.value)).toBe(Number(before.derived.weight.value) - 3 - 10);
  });

  it("adds items free, and your own items with their weight", () => {
    const v = view({
      ...fighterKit, [ADDED_KEY]: { "srd-5.1:longsword": 1 },
      [CUSTOM_KEY]: [{ id: "a", name: "Dragon's tooth", qty: 2, weight: 0.5, note: "", attunement: false, attuned: false }, { id: "b", name: "", qty: 1 }],
    });
    expect(inventory(v)).toEqual(expect.arrayContaining(["Longsword · Added", "Dragon's tooth × 2 · Your own"]));
    expect(v.derived["attack.srd-5.1:longsword"]).toBeDefined();
    expect(v.derived.coins.value).toBe(10000 - 5 - 100); // what was bought still costs; added items don't
    expect(ids(v)).toContain("custom-unnamed:b");
  });

  it("attunement: items that need it can be attuned, at most three", () => {
    const ring = { ...fighterKit, [ADDED_KEY]: { "my-homebrew:ember-ring": 1 } };
    expect(choice(view(ring), ATTUNED_KEY)?.options?.map((o) => o.name)).toEqual(["Ember Ring"]);
    const own = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Charm ${i + 1}`, qty: 1, weight: 0, attunement: true, attuned: true }));
    const v = view({ ...ring, [ATTUNED_KEY]: ["my-homebrew:ember-ring"], [CUSTOM_KEY]: own(3) });
    expect(inventory(v)).toEqual(expect.arrayContaining(["Ember Ring (attuned) · Added", "Charm 1 (attuned) · Your own"]));
    expect(v.issues.find((i) => i.id === "too-many-attuned")).toMatchObject({ overridable: true, message: "You're attuned to 4 items; the most is 3." });
    expect(ids(view({ ...ring, [CUSTOM_KEY]: own(3) }))).not.toContain("too-many-attuned");
  });

  it("money: changes in any coin, and a note when it goes below nothing", () => {
    const v = view({ ...fighterKit, [PURSE_KEY]: [{ id: "a", amount: 50, unit: "gp", note: "Crypt loot" }, { id: "b", amount: -5, unit: "sp", note: "" }] });
    expect(v.derived.coins.breakdown.slice(-2)).toEqual([{ label: "Crypt loot", amount: 5000 }, { label: "Spent", amount: -50 }]);
    expect(ids(view({ ...fighterKit, [PURSE_KEY]: [{ id: "a", amount: -200, unit: "gp", note: "" }] }))).toContain("purse-below-zero");
  });
});

describe("the session journal", () => {
  it("is a list of dated entries on the Details step, and a records section on the sheet that prints only with full text", () => {
    const v = view({ [JOURNAL_KEY]: [{ id: "a", date: "2026-11-20", title: "Session 1", text: "We met in a tavern." }] });
    expect(choice(v, JOURNAL_KEY)).toMatchObject({ kind: "records", step: "details", newestFirst: true, recordName: { one: "entry", many: "entries" } });
    expect(choice(v, JOURNAL_KEY)?.fields?.find((f) => f.id === "date")?.today).toBe(true);
    expect(SHEET.flatMap(sheetSections).find((s) => s.kind === "records")).toMatchObject({ key: JOURNAL_KEY, print: "full-only" });
  });
});

describe("the last SRD gaps", () => {
  const wizard = (level: number, more: Record<string, ChoiceValue> = {}) => view({
    race: "srd-5.1:human", ...standardArray({ str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }), [CLASS_KEY]: "srd-5.1:wizard", [LEVEL_KEY]: level, ...more,
  });
  const book = ["srd-5.1:magic-missile", "srd-5.1:shield", "srd-5.1:misty-step", "srd-5.1:fireball", "srd-5.1:counterspell", "srd-5.1:fly"];

  it("Spell Mastery and Signature Spells choose from the spellbook, and mark the spells there", () => {
    expect(choice(wizard(20), "class.srd-5.1:wizard.spell-mastery-1")).toBeUndefined(); // an empty book: nothing to choose yet
    const v = wizard(20, {
      "spells.srd-5.1:wizard.spellbook": book, "class.srd-5.1:wizard.spell-mastery-1": "srd-5.1:shield",
      "class.srd-5.1:wizard.signature-spells": ["srd-5.1:fireball", "srd-5.1:counterspell"],
    });
    expect(choice(v, "class.srd-5.1:wizard.spell-mastery-1")?.options?.map((o) => o.name)).toEqual(["Magic Missile", "Shield"]);
    const list = v.lists["spell-list"];
    expect(list.find((s) => s.name === "Shield")?.detail).toMatch(/Spell Mastery$/);
    expect(list.find((s) => s.name === "Fireball")?.detail).toMatch(/always prepared · Signature spell$/);
    expect(ids(v).filter((i) => i.startsWith("already-have:"))).toEqual([]);
  });

  it("class spell choices sit with their class on the Spells step, after its own", () => {
    const keys = wizard(18, { "spells.srd-5.1:wizard.spellbook": book }).steps.find((s) => s.id === "spells")!.choices.map((c) => c.key);
    expect(keys.indexOf("class.srd-5.1:wizard.spell-mastery-1")).toBeGreaterThan(keys.indexOf("spells.srd-5.1:wizard.spellbook"));
  });

  it("the Circle of the Land: a land at Druid 2, its spells always prepared from the level each comes at, and a bonus cantrip", () => {
    const druid = (level: number) => view({
      race: "srd-5.1:human", ...standardArray({ str: 8, dex: 14, con: 13, int: 10, wis: 15, cha: 12 }), [CLASS_KEY]: "srd-5.1:druid", [LEVEL_KEY]: level,
      "class.srd-5.1:druid.subclass": "srd-5.1:land", "class.srd-5.1:land.land": "arctic", "class.srd-5.1:land.bonus-cantrip": "srd-5.1:shillelagh",
    });
    expect(choice(druid(2), "class.srd-5.1:land.land")?.options?.map((o) => o.name)).toEqual(["Arctic", "Coast", "Desert", "Forest", "Grassland", "Mountain", "Swamp"]);
    const always = (v: View) => (v.lists.spells ?? []).filter((s) => s.name.endsWith("(always prepared)")).map((s) => s.name.replace(" (always prepared)", ""));
    expect(always(druid(2))).toEqual([]);
    expect(always(druid(3))).toEqual(["Hold Person", "Spike Growth"]);
    expect(always(druid(9))).toHaveLength(8);
    expect(druid(2).lists.cantrips.map((c) => c.name)).toContain("Shillelagh");
  });
});
