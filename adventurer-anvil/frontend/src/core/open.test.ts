// Opening character files: what is refused (and how it is explained), what is brought up to date, and the notes
// about packs that are missing or a different version.
import { describe, expect, it } from "vitest";
import { newCharacterDocument, setChoice, type CharacterDocument } from "./character";
import { readCharacter, readCharacterText } from "./open";
import { toyGarden, toyGardenContent, toyGardenPack } from "./testing/toyGarden";

const T = "2026-11-20T10:00:00.000Z";
const LOADED = [{ id: toyGardenPack.id, version: toyGardenPack.version }];

function saved(): CharacterDocument {
  const doc = newCharacterDocument({ id: "c1", system: { id: toyGarden.id, version: toyGarden.version }, packs: LOADED, now: T, name: "Fern patch" });
  return setChoice(doc, "plant", "garden-basics:fern", T);
}
const asFile = (doc: unknown) => JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
const open = (data: unknown) => readCharacter(data, toyGarden, LOADED);
const error = (data: unknown) => { const r = open(data); return r.ok ? undefined : r.error; };

describe("opening a character file", () => {
  it("reads back exactly what was saved, with nothing to note", () => {
    expect(open(asFile(saved()))).toEqual({ ok: true, doc: saved(), notes: [] });
    expect(readCharacterText(JSON.stringify(saved(), null, 2), toyGarden, LOADED)).toEqual({ ok: true, doc: saved(), notes: [] });
  });

  it("refuses what isn't a character file, in words", () => {
    expect(readCharacterText("{ not json", toyGarden, LOADED)).toEqual({ ok: false, error: "This file isn't readable: it isn't JSON." });
    for (const bad of [null, [], "text", { format: "adventurer-anvil-pack", formatVersion: 1 }, { ...asFile(saved()), formatVersion: "1" }]) {
      expect(error(bad)).toBe("This isn't an Adventurer Anvil character file.");
    }
  });

  it("refuses a file from a newer app or newer rules, rather than reading it wrongly", () => {
    expect(error({ ...asFile(saved()), formatVersion: 2 })).toMatch(/newer version of Adventurer Anvil/);
    expect(error({ ...asFile(saved()), system: { id: toyGarden.id, version: 5 } })).toMatch(/newer Garden rules|newer .* rules/);
  });

  it("refuses a character for another game", () => {
    expect(error({ ...asFile(saved()), system: { id: "dnd5e-2014", version: 1 } })).toMatch(/^This character is for another game \("dnd5e-2014"\)/);
  });

  it("refuses a damaged file", () => {
    for (const field of ["id", "name", "packs", "choices", "overrides", "rolls", "createdAt"]) {
      const file = asFile(saved());
      delete file[field];
      expect(error(file), field).toMatch(/damaged/);
    }
    expect(error({ ...asFile(saved()), overrides: [{ issueId: "x" }] })).toMatch(/damaged/);
  });

  it("fills in the play state if an older file has none", () => {
    const file = asFile(saved());
    delete file.state;
    const r = open(file);
    expect(r.ok && r.doc.state).toEqual({});
  });

  it("brings a file from older rules up to date", () => {
    const newer = { ...toyGarden, version: 2, migrate: (d: CharacterDocument) => ({ ...d, system: { ...d.system, version: 2 }, name: `${d.name}, upgraded` }) };
    const r = readCharacter(asFile(saved()), newer, LOADED);
    expect(r.ok && [r.doc.system.version, r.doc.name]).toEqual([2, "Fern patch, upgraded"]);
  });

  it("opens a file whose packs are missing or a different version, and says so", () => {
    const file = { ...asFile(saved()), packs: [{ id: "garden-basics", version: "0.9" }, { id: "rare-orchids", version: "2.0.0" }] };
    const r = open(file);
    expect(r.ok).toBe(true);
    expect(r.ok && r.notes).toEqual([
      `Made with the pack "garden-basics" 0.9; 1.0 is loaded. Check that its choices still look right.`,
      `Made with the pack "rare-orchids" 2.0.0, which isn't loaded. Choices from it won't show.`,
    ]);
  });

  it("the system describes a character in a few words", () => {
    expect(toyGarden.describe(saved(), toyGardenContent)).toEqual({ text: "Fern garden" });
  });
});
