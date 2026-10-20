import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Monster } from "../types/monster";
import {
  CR_LADDER,
  EMPTY_FILTERS,
  countActiveFilters,
  filterMonsters,
  sortMonsters,
  toggle,
  type FilterState,
} from "./filters";
import { CREATURE_TYPES, ENVIRONMENTS, FEATURES, ROLES, SIZES, DAMAGE_THEMES } from "./options";

const monsters = sample as unknown as Monster[];

function names(list: Monster[]): string[] {
  return list.map((m) => m.name);
}

function withFilters(changes: Partial<FilterState>): FilterState {
  return { ...EMPTY_FILTERS, ...changes };
}

describe("filterMonsters", () => {
  it("returns everything when no filter is set", () => {
    expect(filterMonsters(monsters, EMPTY_FILTERS)).toHaveLength(monsters.length);
  });

  it("searches names case-insensitively", () => {
    expect(names(filterMonsters(monsters, withFilters({ search: "  DRAKE " })))).toEqual([
      "Stormhide Drake",
      "Hoarfrost Drakeling",
    ]);
  });

  it("filters by type, treating several picks as OR", () => {
    const result = filterMonsters(monsters, withFilters({ types: ["undead", "ooze"] }));
    expect(names(result).sort()).toEqual(["Gloamslick Ooze", "Gravewick Stalker"]);
  });

  it("filters by size", () => {
    const result = filterMonsters(monsters, withFilters({ sizes: ["tiny"] }));
    expect(names(result).sort()).toEqual(["Cellar Scrabbler", "Dustmote Sprite"]);
  });

  it("matches a monster living in any picked environment", () => {
    const result = filterMonsters(monsters, withFilters({ environments: ["desert"] }));
    expect(names(result).sort()).toEqual(["Cinderkite", "Dune Leviathan", "Emberwhirl"]);
  });

  it("filters by role and damage theme", () => {
    expect(names(filterMonsters(monsters, withFilters({ roles: ["leader"] })))).toEqual(["Brightwing Sentinel"]);
    expect(names(filterMonsters(monsters, withFilters({ damageThemes: ["psychic"] })))).toEqual(["Voidbloom Seer"]);
  });

  it("requires every picked feature (AND within features)", () => {
    const flying = filterMonsters(monsters, withFilters({ features: ["flying"] }));
    const flyingBreath = filterMonsters(monsters, withFilters({ features: ["flying", "breath-weapon"] }));
    expect(flying.length).toBeGreaterThan(flyingBreath.length);
    expect(names(flyingBreath).sort()).toEqual(["Hoarfrost Drakeling", "Stormhide Drake"]);
  });

  it("treats CR bounds as inclusive and understands fractions", () => {
    const result = filterMonsters(monsters, withFilters({ crMin: 0.25, crMax: 0.5 }));
    expect(result.every((m) => m.challenge.cr_value >= 0.25 && m.challenge.cr_value <= 0.5)).toBe(true);
    expect(names(result)).toContain("Gloomcap Shambler"); // CR 1/4
    expect(names(result)).toContain("Murkmaw Lurker"); // CR 1/2
    expect(names(result)).not.toContain("Cinderkite"); // CR 1/8
  });

  it("supports a one-sided CR range", () => {
    const high = filterMonsters(monsters, withFilters({ crMin: 7 }));
    expect(names(high).sort()).toEqual(["Dune Leviathan", "Voidbloom Seer"]);
  });

  it("combines different filters with AND", () => {
    const result = filterMonsters(monsters, withFilters({ types: ["dragon"], environments: ["arctic"] }));
    expect(names(result)).toEqual(["Hoarfrost Drakeling"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterMonsters(monsters, withFilters({ types: ["ooze"], sizes: ["tiny"] }))).toEqual([]);
  });
});

describe("countActiveFilters", () => {
  it("counts groups, not individual picks", () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    expect(countActiveFilters(withFilters({ types: ["beast", "fey"], crMin: 1, crMax: 3 }))).toBe(2);
  });

  it("ignores a blank search", () => {
    expect(countActiveFilters(withFilters({ search: "   " }))).toBe(0);
  });
});

describe("toggle", () => {
  it("adds a missing value and removes a present one without mutating", () => {
    const original = ["a", "b"];
    expect(toggle(original, "c")).toEqual(["a", "b", "c"]);
    expect(toggle(original, "a")).toEqual(["b"]);
    expect(original).toEqual(["a", "b"]);
  });
});

describe("sortMonsters", () => {
  it("sorts by name in both directions", () => {
    const asc = names(sortMonsters(monsters, "name", "asc"));
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b)));
    expect(names(sortMonsters(monsters, "name", "desc"))).toEqual([...asc].reverse());
  });

  it("sorts by CR, breaking ties by name", () => {
    const sorted = sortMonsters(monsters, "cr", "asc");
    expect(sorted[0].name).toBe("Cellar Scrabbler"); // CR 0
    expect(sorted[sorted.length - 1].name).toBe("Dune Leviathan"); // CR 12
    const crTwo = sorted.filter((m) => m.challenge.cr_value === 2).map((m) => m.name);
    expect(crTwo).toEqual([...crTwo].sort((a, b) => a.localeCompare(b)));
  });

  it("sorts by type", () => {
    const types = sortMonsters(monsters, "type", "asc").map((m) => m.type);
    expect(types).toEqual([...types].sort((a, b) => a.localeCompare(b)));
  });

  it("does not change the original list", () => {
    const before = names(monsters);
    sortMonsters(monsters, "cr", "desc");
    expect(names(monsters)).toEqual(before);
  });
});

describe("CR_LADDER", () => {
  it("runs 0, 1/8, 1/4, 1/2, then 1 to 30 in ascending order", () => {
    expect(CR_LADDER.slice(0, 5).map((c) => c.label)).toEqual(["0", "1/8", "1/4", "1/2", "1"]);
    expect(CR_LADDER[CR_LADDER.length - 1]).toEqual({ label: "30", value: 30 });
    const values = CR_LADDER.map((c) => c.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });
});

// The JSON is only cast to Monster[], so TypeScript can't catch a misspelt
// tag there. These tests do, and keep every filter option demonstrable.
describe("sample monsters and option lists", () => {
  it("only use values from the option lists", () => {
    for (const m of monsters) {
      expect(CREATURE_TYPES).toContain(m.type);
      expect(SIZES).toContain(m.size);
      expect(ROLES).toContain(m.role);
      m.environments.forEach((e) => expect(ENVIRONMENTS).toContain(e));
      m.damage_themes.forEach((d) => expect(DAMAGE_THEMES).toContain(d));
      m.features.forEach((f) => expect(FEATURES).toContain(f));
    }
  });

  it("cover every creature type, size, environment, role and feature at least once", () => {
    const has = <T>(all: readonly T[], used: T[]) => all.filter((v) => !used.includes(v));
    expect(has(CREATURE_TYPES, monsters.map((m) => m.type))).toEqual([]);
    expect(has(SIZES, monsters.map((m) => m.size))).toEqual([]);
    expect(has(ROLES, monsters.map((m) => m.role))).toEqual([]);
    expect(has(ENVIRONMENTS, monsters.flatMap((m) => m.environments))).toEqual([]);
    expect(has(FEATURES, monsters.flatMap((m) => m.features))).toEqual([]);
  });
});
