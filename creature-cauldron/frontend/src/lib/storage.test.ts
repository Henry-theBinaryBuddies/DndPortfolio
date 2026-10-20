import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PARTY } from "./party";
import { MAX_ENTRIES, MAX_NAME_LENGTH, MAX_SAVED } from "./encounter";
import {
  MAX_FAVORITES,
  MAX_ID_LENGTH,
  parseEntries,
  parseFavorites,
  parseParty,
  parseSavedEncounters,
  parseWorkingEncounter,
  readStoredJson,
  writeStoredJson,
} from "./storage";

describe("parseParty", () => {
  it("accepts a valid party", () => {
    expect(parseParty({ levels: [2, 4, 4, 5] })).toEqual({ levels: [2, 4, 4, 5] });
  });

  it("clamps levels to 1-20 and rounds fractions", () => {
    expect(parseParty({ levels: [0, 99, 3.6, -5] })).toEqual({ levels: [1, 20, 4, 1] });
  });

  it("caps the party at 10 members", () => {
    const result = parseParty({ levels: Array(15).fill(5) });
    expect(result.levels).toHaveLength(10);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "hello"],
    ["a number", 4],
    ["an empty object", {}],
    ["levels that isn't an array", { levels: "5,5,5" }],
    ["an empty party", { levels: [] }],
    ["non-numeric levels", { levels: [3, "four", 5] }],
    ["NaN or Infinity", { levels: [3, Number.NaN, Infinity] }],
  ])("falls back to the default party for %s", (_label, value) => {
    expect(parseParty(value)).toEqual(DEFAULT_PARTY);
  });
});

describe("parseFavorites", () => {
  it("accepts a list of ids and keeps their order", () => {
    expect(parseFavorites(["b-1", "a-2", "c-3"])).toEqual(["b-1", "a-2", "c-3"]);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "cinderkite-3a1f"],
    ["a number", 7],
    ["an object", { 0: "cinderkite-3a1f" }],
  ])("gives an empty list for %s", (_label, value) => {
    expect(parseFavorites(value)).toEqual([]);
  });

  it("drops bad items but keeps the good ones", () => {
    const stored = ["good-1", 42, null, "", { id: "x" }, ["nested"], "good-2", "x".repeat(MAX_ID_LENGTH + 1)];
    expect(parseFavorites(stored)).toEqual(["good-1", "good-2"]);
  });

  it("removes duplicates, keeping the first occurrence", () => {
    expect(parseFavorites(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("treats ids that look like object keys as ordinary strings", () => {
    expect(parseFavorites(["__proto__", "constructor", "toString"])).toEqual(["__proto__", "constructor", "toString"]);
  });

  it("accepts an id exactly at the length limit", () => {
    const id = "x".repeat(MAX_ID_LENGTH);
    expect(parseFavorites([id])).toEqual([id]);
  });

  it("caps the list after removing duplicates", () => {
    const many = Array.from({ length: MAX_FAVORITES + 50 }, (_, i) => `monster-${i}`);
    const result = parseFavorites([...many, ...many]);
    expect(result).toHaveLength(MAX_FAVORITES);
    expect(result[0]).toBe("monster-0");
  });
});

describe("parseEntries", () => {
  it("accepts valid rows and keeps their order and names", () => {
    const stored = [
      { monsterId: "b", count: 2, name: "Bee" },
      { monsterId: "a", count: 1 },
    ];
    expect(parseEntries(stored)).toEqual([
      { monsterId: "b", count: 2, name: "Bee" },
      { monsterId: "a", count: 1 },
    ]);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "abc"],
    ["an object", { monsterId: "a", count: 1 }],
  ])("gives an empty list for %s", (_label, value) => {
    expect(parseEntries(value)).toEqual([]);
  });

  it("drops bad rows but keeps the good ones", () => {
    const stored = [
      null,
      "text",
      ["nested"],
      {},
      { monsterId: "", count: 1 },
      { monsterId: 7, count: 1 },
      { monsterId: "no-count" },
      { monsterId: "string-count", count: "3" },
      { monsterId: "x".repeat(MAX_ID_LENGTH + 1), count: 1 },
      { monsterId: "good", count: 2 },
    ];
    expect(parseEntries(stored)).toEqual([{ monsterId: "good", count: 2 }]);
  });

  it("accepts an id exactly at the length limit", () => {
    const id = "x".repeat(MAX_ID_LENGTH);
    expect(parseEntries([{ monsterId: id, count: 1 }])).toEqual([{ monsterId: id, count: 1 }]);
  });

  it("drops a count that is not a finite number, including 1e999 which JSON turns into Infinity", () => {
    const stored = JSON.parse('[{"monsterId":"huge","count":1e999},{"monsterId":"ok","count":2}]');
    expect(parseEntries(stored)).toEqual([{ monsterId: "ok", count: 2 }]);
    expect(parseEntries([{ monsterId: "nan", count: Number.NaN }])).toEqual([]);
  });

  it("rounds and clamps counts to 1-99", () => {
    const stored = [
      { monsterId: "zero", count: 0 },
      { monsterId: "big", count: 500 },
      { monsterId: "frac", count: 2.6 },
      { monsterId: "neg", count: -4 },
    ];
    expect(parseEntries(stored).map((e) => e.count)).toEqual([1, 99, 3, 1]);
  });

  it("merges repeated monsters, adding the counts and clamping the total", () => {
    const stored = [
      { monsterId: "a", count: 2, name: "First" },
      { monsterId: "b", count: 1 },
      { monsterId: "a", count: 3, name: "Second" },
      { monsterId: "c", count: 60 },
      { monsterId: "c", count: 60 },
    ];
    expect(parseEntries(stored)).toEqual([
      { monsterId: "a", count: 5, name: "First" },
      { monsterId: "b", count: 1 },
      { monsterId: "c", count: 99 },
    ]);
  });

  it("treats ids that look like object keys as ordinary ids", () => {
    const result = parseEntries([
      { monsterId: "__proto__", count: 2 },
      { monsterId: "constructor", count: 1 },
    ]);
    expect(result.map((e) => e.monsterId)).toEqual(["__proto__", "constructor"]);
  });

  it("cleans names and omits blank or non-text ones", () => {
    const stored = [
      { monsterId: "a", count: 1, name: "  Spaced  " },
      { monsterId: "b", count: 1, name: "   " },
      { monsterId: "c", count: 1, name: 42 },
      { monsterId: "d", count: 1, name: "n".repeat(MAX_NAME_LENGTH + 30) },
    ];
    const result = parseEntries(stored);
    expect(result[0].name).toBe("Spaced");
    expect("name" in result[1]).toBe(false);
    expect("name" in result[2]).toBe(false);
    expect(result[3].name).toHaveLength(MAX_NAME_LENGTH);
  });

  it("keeps only the first rows when there are too many different monsters", () => {
    const stored = Array.from({ length: MAX_ENTRIES + 10 }, (_, i) => ({ monsterId: `m-${i}`, count: 1 }));
    const result = parseEntries(stored);
    expect(result).toHaveLength(MAX_ENTRIES);
    expect(result[0].monsterId).toBe("m-0");
    expect(result[MAX_ENTRIES - 1].monsterId).toBe(`m-${MAX_ENTRIES - 1}`);
  });

  it("drops unknown fields and builds fresh objects", () => {
    const stored = [{ monsterId: "a", count: 1, extra: "ignored", __proto__: { evil: true } }];
    const [entry] = parseEntries(stored);
    expect(Object.keys(entry)).toEqual(["monsterId", "count"]);
    expect(entry).not.toBe(stored[0]);
  });
});

describe("parseSavedEncounters", () => {
  const rows = [{ monsterId: "a", count: 2 }];

  it("accepts valid saved encounters, including ids and stars", () => {
    const stored = [
      { id: "id-1", name: "Crypt ambush", favorite: true, entries: rows },
      { id: "id-2", name: "Boss", favorite: false, entries: [{ monsterId: "b", count: 1, name: "Big" }] },
    ];
    expect(parseSavedEncounters(stored)).toEqual(stored);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "Crypt"],
    ["an object", { id: "x", name: "Crypt", entries: rows }],
  ])("gives an empty list for %s", (_label, value) => {
    expect(parseSavedEncounters(value)).toEqual([]);
  });

  it("gives older saves, which had no id or star, a stable id from their position", () => {
    const stored = [
      { name: "Old one", entries: rows },
      { name: "Old two", entries: rows },
    ];
    const result = parseSavedEncounters(stored);
    expect(result.map((s) => s.id)).toEqual(["legacy-0", "legacy-1"]);
    expect(result.every((s) => s.favorite === false)).toBe(true);
    expect(parseSavedEncounters(stored)).toEqual(result); // same input, same ids
  });

  it("gives a replacement id to a duplicate or unusable id", () => {
    const stored = [
      { id: "same", name: "First", entries: rows },
      { id: "same", name: "Second", entries: rows },
      { id: "", name: "Third", entries: rows },
      { id: 7, name: "Fourth", entries: rows },
      { id: "x".repeat(MAX_ID_LENGTH + 1), name: "Fifth", entries: rows },
    ];
    const ids = parseSavedEncounters(stored).map((s) => s.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids[0]).toBe("same");
  });

  it("only treats a real true as starred", () => {
    const stored = [
      { id: "a", name: "A", favorite: true, entries: rows },
      { id: "b", name: "B", favorite: "yes", entries: rows },
      { id: "c", name: "C", favorite: 1, entries: rows },
    ];
    expect(parseSavedEncounters(stored).map((s) => s.favorite)).toEqual([true, false, false]);
  });

  it("drops bad items but keeps the good ones", () => {
    const stored = [
      null,
      "text",
      { entries: rows },
      { name: 5, entries: rows },
      { name: "   ", entries: rows },
      { name: "No rows" },
      { name: "Bad rows", entries: [{ monsterId: "", count: 1 }] },
      { id: "good", name: "Good", entries: rows },
    ];
    expect(parseSavedEncounters(stored)).toEqual([{ id: "good", name: "Good", favorite: false, entries: rows }]);
  });

  it("keeps the first of two names that match ignoring capitals, since names are unique", () => {
    const stored = [
      { id: "1", name: "Crypt", entries: [{ monsterId: "a", count: 1 }] },
      { id: "2", name: " crypt ", entries: [{ monsterId: "b", count: 1 }] },
    ];
    const result = parseSavedEncounters(stored);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("counts names that differ only in inner spacing as duplicates", () => {
    const stored = [
      { id: "1", name: "Boss fight", entries: rows },
      { id: "2", name: "Boss   Fight", entries: rows },
    ];
    expect(parseSavedEncounters(stored).map((s) => s.id)).toEqual(["1"]);
  });

  it("numbers legacy ids by the items kept, so a dropped item does not use up a number", () => {
    const stored = [{ name: "", entries: rows }, { name: "First kept", entries: rows }];
    expect(parseSavedEncounters(stored).map((s) => s.id)).toEqual(["legacy-0"]);
  });

  it("cleans names and the rows inside", () => {
    const stored = [{ id: "1", name: "  Spaced  ", entries: [{ monsterId: "a", count: 500 }] }];
    expect(parseSavedEncounters(stored)).toEqual([
      { id: "1", name: "Spaced", favorite: false, entries: [{ monsterId: "a", count: 99 }] },
    ]);
  });

  it("keeps at most the maximum number of saves", () => {
    const stored = Array.from({ length: MAX_SAVED + 20 }, (_, i) => ({ id: `id-${i}`, name: `Save ${i}`, entries: rows }));
    const result = parseSavedEncounters(stored);
    expect(result).toHaveLength(MAX_SAVED);
    expect(result[0].name).toBe("Save 0");
  });
});

describe("parseWorkingEncounter", () => {
  it("accepts a valid working encounter", () => {
    const stored = { id: "id-1", name: "Crypt ambush", favorite: true, entries: [{ monsterId: "a", count: 2 }] };
    expect(parseWorkingEncounter(stored)).toEqual(stored);
  });

  it("accepts the older format, a bare list of rows, as an unsaved encounter with no name", () => {
    expect(parseWorkingEncounter([{ monsterId: "a", count: 2 }, { monsterId: "", count: 1 }])).toEqual({
      id: null,
      name: "",
      favorite: false,
      entries: [{ monsterId: "a", count: 2 }],
    });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "hello"],
    ["a number", 4],
  ])("gives an empty encounter for %s", (_label, value) => {
    expect(parseWorkingEncounter(value)).toEqual({ id: null, name: "", favorite: false, entries: [] });
  });

  it("repairs each field on its own", () => {
    const stored = { id: 99, name: ["x"], favorite: "true", entries: [{ monsterId: "a", count: 500 }, 5] };
    expect(parseWorkingEncounter(stored)).toEqual({
      id: null,
      name: "",
      favorite: false,
      entries: [{ monsterId: "a", count: 99 }],
    });
  });

  it("cleans the name", () => {
    expect(parseWorkingEncounter({ name: "  Spaced  ", entries: [] }).name).toBe("Spaced");
  });

  it("gives back a fresh object each time, never a shared one", () => {
    const first = parseWorkingEncounter(undefined);
    first.entries.push({ monsterId: "a", count: 1 });
    expect(parseWorkingEncounter(undefined).entries).toEqual([]);
  });
});

// Storage can be missing, blocked, full or corrupt. These tests replace
// `window` with a fake (vi.stubGlobal) so each failure can be caused on demand;
// afterEach puts the real thing back so tests never leak into each other.
describe("readStoredJson and writeStoredJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A tiny in-memory stand-in for localStorage. */
  function memoryStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
  }

  it("does not crash when there is no window at all", () => {
    expect(readStoredJson("k")).toBeUndefined();
    expect(() => writeStoredJson("k", [1])).not.toThrow();
  });

  it("round-trips a value", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    writeStoredJson("k", { a: [1, 2, 3] });
    expect(readStoredJson("k")).toEqual({ a: [1, 2, 3] });
  });

  it("returns undefined for a key that was never saved", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    expect(readStoredJson("missing")).toBeUndefined();
  });

  it("returns undefined for corrupt JSON", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage({ k: "{not json" }) });
    expect(readStoredJson("k")).toBeUndefined();
  });

  it("returns undefined when getItem throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {},
      },
    });
    expect(readStoredJson("k")).toBeUndefined();
  });

  it("returns undefined when merely touching localStorage throws", () => {
    vi.stubGlobal("window", {
      get localStorage(): never {
        throw new Error("storage disabled");
      },
    });
    expect(readStoredJson("k")).toBeUndefined();
    expect(() => writeStoredJson("k", 1)).not.toThrow();
  });

  it("does not throw when setItem fails, for example when storage is full", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(() => writeStoredJson("k", { big: "value" })).not.toThrow();
  });
});
