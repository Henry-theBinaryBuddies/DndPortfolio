import { describe, expect, it } from "vitest";
import type { Monster } from "../types/monster";
import { countAvailableFavorites, onlyFavorites } from "./favorites";

// Only the id and the name matter to these functions.
const monster = (id: string, name: string) => ({ id, name }) as Monster;
const kite = monster("kite-1", "Kite");
const drake = monster("drake-2", "Drake");
const worm = monster("worm-3", "Worm");
const monsters = [kite, drake, worm];

describe("onlyFavorites", () => {
  it("keeps only favorites, in the original order", () => {
    expect(onlyFavorites(monsters, new Set(["worm-3", "kite-1"])).map((m) => m.name)).toEqual(["Kite", "Worm"]);
  });

  it("ignores ids the library does not have", () => {
    expect(onlyFavorites(monsters, new Set(["kite-1", "long-gone-0000"])).map((m) => m.name)).toEqual(["Kite"]);
  });

  it("returns an empty list when there are no favorites", () => {
    expect(onlyFavorites(monsters, new Set())).toEqual([]);
  });

  it("does not change the list it was given", () => {
    const before = monsters.map((m) => m.id);
    onlyFavorites(monsters, new Set(["kite-1"]));
    expect(monsters.map((m) => m.id)).toEqual(before);
  });
});

describe("countAvailableFavorites", () => {
  it("counts only favorites the library has", () => {
    expect(countAvailableFavorites(monsters, new Set(["kite-1", "drake-2", "long-gone-0000"]))).toBe(2);
  });

  it("is zero for an empty set or an empty library", () => {
    expect(countAvailableFavorites(monsters, new Set())).toBe(0);
    expect(countAvailableFavorites([], new Set(["kite-1"]))).toBe(0);
  });
});
