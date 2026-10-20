import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PARTY } from "./party";
import { MAX_FAVORITES, MAX_ID_LENGTH, parseFavorites, parseParty, readStoredJson, writeStoredJson } from "./storage";

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
