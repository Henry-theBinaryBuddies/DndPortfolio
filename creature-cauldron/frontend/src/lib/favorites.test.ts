import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Monster } from "../types/monster";
import { countAvailableFavorites, onlyFavorites } from "./favorites";

const monsters = sample as unknown as Monster[];

describe("onlyFavorites", () => {
  it("keeps only favorites, in the original order", () => {
    const favorites = new Set(["stormhide-drake-2f77", "cinderkite-3a1f"]);
    expect(onlyFavorites(monsters, favorites).map((m) => m.name)).toEqual(["Cinderkite", "Stormhide Drake"]);
  });

  it("ignores ids the library does not have", () => {
    const favorites = new Set(["cinderkite-3a1f", "long-gone-monster-0000"]);
    expect(onlyFavorites(monsters, favorites).map((m) => m.name)).toEqual(["Cinderkite"]);
  });

  it("returns an empty list when there are no favorites", () => {
    expect(onlyFavorites(monsters, new Set())).toEqual([]);
  });

  it("does not change the list it was given", () => {
    const before = monsters.map((m) => m.id);
    onlyFavorites(monsters, new Set(["cinderkite-3a1f"]));
    expect(monsters.map((m) => m.id)).toEqual(before);
  });
});

describe("countAvailableFavorites", () => {
  it("counts only favorites the library has", () => {
    const favorites = new Set(["cinderkite-3a1f", "stormhide-drake-2f77", "long-gone-monster-0000"]);
    expect(countAvailableFavorites(monsters, favorites)).toBe(2);
  });

  it("is zero for an empty set or an empty library", () => {
    expect(countAvailableFavorites(monsters, new Set())).toBe(0);
    expect(countAvailableFavorites([], new Set(["cinderkite-3a1f"]))).toBe(0);
  });
});
