import { describe, expect, it } from "vitest";
import { characterFile, History, readCharacter, type Character } from "./character";
import { defaultPaint } from "./paint";
import { applyRace, defaultParams, randomParams } from "./params";

const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

describe("the character file", () => {
  it("reads back exactly what it saved", () => {
    for (let k = 1; k <= 20; k++) {
      const params = randomParams(seeded(k));
      const character: Character = { params, paint: { ...defaultPaint(params.race), skin: "#123abc", grime: 0.7 } };
      expect(readCharacter(characterFile(character))).toEqual(character);
    }
  });

  it("fills in what a file leaves out, and keeps numbers inside their sliders", () => {
    const read = readCharacter(JSON.stringify({ format: "effigy-character", version: 1, params: { race: "dwarf", age: 7, weight: "heavy" }, paint: { skin: "not a colour", grime: -3 } }));
    expect(read.params.race).toBe("dwarf");
    expect(read.params.age).toBe(1);
    expect(read.params.weight).toBe(defaultParams().weight);
    expect(read.paint.skin).toBe(defaultPaint("dwarf").skin);
    expect(read.paint.grime).toBe(0);
  });

  it("says plainly when a file is not a character, or is from a newer version", () => {
    expect(() => readCharacter("{")).toThrow(/not JSON/);
    expect(() => readCharacter(JSON.stringify({ params: {} }))).toThrow(/not an Effigy Engine character file/);
    expect(() => readCharacter(JSON.stringify({ format: "effigy-character", version: 99 }))).toThrow(/newer version/);
    expect(() => readCharacter(JSON.stringify({ format: "effigy-character", version: 1, params: { race: "dragon" } }))).toThrow(/unknown race/);
  });
});

describe("undo and redo", () => {
  const at = (age: number): Character => ({ params: { ...defaultParams(), age }, paint: defaultPaint("human") });

  it("goes back and forward through what was recorded, and an edit after an undo drops what was undone", () => {
    const history = new History(at(0.1));
    expect(history.canUndo).toBe(false);
    history.record(at(0.2));
    history.record(at(0.2)); // (no change: not a step)
    history.record(at(0.3));
    expect(history.undo()!.params.age).toBe(0.2);
    expect(history.undo()!.params.age).toBe(0.1);
    expect(history.undo()).toBeNull();
    expect(history.redo()!.params.age).toBe(0.2);
    history.record({ params: applyRace(defaultParams(), "elf"), paint: defaultPaint("elf") });
    expect(history.canRedo).toBe(false);
    expect(history.undo()!.params.age).toBe(0.2);
  });
});
