import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Monster } from "../types/monster";
import { filterMonsters, EMPTY_FILTERS } from "./filters";
import {
  XP_BY_CR,
  adjustedXp,
  crLabelsInBand,
  describeBand,
  describeParty,
  encounterMultiplier,
  partyThresholds,
  rateEncounter,
  soloBand,
} from "./party";

const monsters = sample as unknown as Monster[];

const four = (level: number) => ({ levels: [level, level, level, level] });

describe("partyThresholds", () => {
  it("adds up each character's thresholds", () => {
    expect(partyThresholds(four(5))).toEqual({ easy: 1000, medium: 2000, hard: 3000, deadly: 4400 });
  });

  it("handles mixed levels", () => {
    expect(partyThresholds({ levels: [1, 2, 3] })).toEqual({ easy: 150, medium: 300, hard: 450, deadly: 700 });
  });

  it("has the right values at level 1 and level 20", () => {
    expect(partyThresholds({ levels: [1] })).toEqual({ easy: 25, medium: 50, hard: 75, deadly: 100 });
    expect(partyThresholds({ levels: [20] })).toEqual({ easy: 2800, medium: 5700, hard: 8500, deadly: 12700 });
  });

  it("clamps out-of-range levels instead of crashing", () => {
    expect(partyThresholds({ levels: [0] })).toEqual(partyThresholds({ levels: [1] }));
    expect(partyThresholds({ levels: [99] })).toEqual(partyThresholds({ levels: [20] }));
  });
});

describe("encounterMultiplier", () => {
  it.each([
    [1, 1],
    [2, 1.5],
    [3, 2],
    [6, 2],
    [7, 2.5],
    [10, 2.5],
    [11, 3],
    [14, 3],
    [15, 4],
  ])("%i monsters against a normal party is x%s", (count, multiplier) => {
    expect(encounterMultiplier(count, 4)).toBe(multiplier);
  });

  it("uses the next higher multiplier for a party under 3", () => {
    expect(encounterMultiplier(1, 2)).toBe(1.5);
    expect(encounterMultiplier(2, 2)).toBe(2);
    expect(encounterMultiplier(3, 1)).toBe(2.5);
  });

  it("does not go past x4 for a small party", () => {
    expect(encounterMultiplier(15, 2)).toBe(4);
  });

  it("uses the next lower multiplier for a party of 6 or more, with x0.5 for a lone monster", () => {
    expect(encounterMultiplier(1, 6)).toBe(0.5);
    expect(encounterMultiplier(2, 6)).toBe(1);
    expect(encounterMultiplier(3, 8)).toBe(1.5);
    expect(encounterMultiplier(7, 6)).toBe(2);
  });

  it("treats a party of exactly 3 as normal", () => {
    expect(encounterMultiplier(2, 3)).toBe(1.5);
  });
});

describe("adjustedXp", () => {
  it("multiplies the total by the multiplier for the monster count", () => {
    expect(adjustedXp([200, 200, 200], 4)).toBe(1200); // 600 x 2
    expect(adjustedXp([700], 4)).toBe(700);
    expect(adjustedXp([450, 450], 4)).toBe(1350); // 900 x 1.5
  });

  it("applies the party-size shift", () => {
    expect(adjustedXp([450], 2)).toBe(675); // x1.5
    expect(adjustedXp([450], 6)).toBe(225); // x0.5
  });

  it("is zero for an empty encounter", () => {
    expect(adjustedXp([], 4)).toBe(0);
  });
});

describe("rateEncounter", () => {
  const thresholds = partyThresholds(four(5)); // 1000 / 2000 / 3000 / 4400

  it.each([
    [0, "trivial"],
    [999, "trivial"],
    [1000, "easy"],
    [1999, "easy"],
    [2000, "medium"],
    [2999, "medium"],
    [3000, "hard"],
    [4399, "hard"],
    [4400, "deadly"],
    [99999, "deadly"],
  ])("%i adjusted XP is %s", (adjusted, rating) => {
    expect(rateEncounter(adjusted, thresholds)).toBe(rating);
  });
});

describe("soloBand", () => {
  it("gives the solo XP range for each difficulty (four level-5 characters)", () => {
    const party = four(5);
    expect(soloBand(party, "easy")).toEqual({ min: 1000, max: 2000 });
    expect(soloBand(party, "medium")).toEqual({ min: 2000, max: 3000 });
    expect(soloBand(party, "hard")).toEqual({ min: 3000, max: 4400 });
    expect(soloBand(party, "deadly")).toEqual({ min: 4400, max: null });
  });

  it("names the matching challenge ratings", () => {
    const party = four(5);
    expect(describeBand(soloBand(party, "easy"))).toBe("CR 4–5");
    expect(describeBand(soloBand(party, "medium"))).toBe("CR 6–7");
    expect(describeBand(soloBand(party, "hard"))).toBe("CR 8");
    expect(describeBand(soloBand(party, "deadly"))).toBe("CR 9+");
  });

  it("agrees with rateEncounter for every CR", () => {
    const party = four(5);
    const thresholds = partyThresholds(party);
    for (const difficulty of ["easy", "medium", "hard", "deadly"] as const) {
      for (const label of crLabelsInBand(soloBand(party, difficulty))) {
        expect(rateEncounter(adjustedXp([XP_BY_CR[label]], 4), thresholds)).toBe(difficulty);
      }
    }
  });

  it("shifts for a small party, where a lone monster counts x1.5", () => {
    const pair = { levels: [5, 5] }; // budgets 500 / 1000 / 1500 / 2200
    expect(soloBand(pair, "easy").min).toBeCloseTo(500 / 1.5);
    expect(describeBand(soloBand(pair, "easy"))).toBe("CR 2");
    expect(describeBand(soloBand(pair, "medium"))).toBe("CR 3");
    expect(describeBand(soloBand(pair, "hard"))).toBe("CR 4");
    expect(describeBand(soloBand(pair, "deadly"))).toBe("CR 5+");
  });

  it("shifts the other way for a large party, where a lone monster counts x0.5", () => {
    const six = { levels: [5, 5, 5, 5, 5, 5] }; // budgets 1500 / 3000 / 4500 / 6600, lone monster x0.5
    expect(soloBand(six, "easy")).toEqual({ min: 3000, max: 6000 });
    expect(describeBand(soloBand(six, "easy"))).toBe("CR 8–10"); // CR 7 (2900 XP) is below 3000; CR 10 (5900) is under 6000
  });

  it("reports when a difficulty falls between two ratings", () => {
    // A lone level-1 character: medium solo band is 33.3 to under 50 XP, and no CR is worth that.
    expect(describeBand(soloBand({ levels: [1] }, "medium"))).toBe("no CR fits");
  });
});

describe("describeParty", () => {
  it("describes a uniform party", () => {
    expect(describeParty(four(5))).toBe("4 level-5 characters");
    expect(describeParty({ levels: [1] })).toBe("1 level-1 character");
  });

  it("describes a mixed party", () => {
    expect(describeParty({ levels: [2, 4, 3] })).toBe("3 characters (levels 2–4)");
  });
});

describe("XP_BY_CR", () => {
  it("covers every sample monster's XP", () => {
    for (const m of monsters) {
      expect(XP_BY_CR[m.challenge.cr]).toBe(m.challenge.xp);
    }
  });
});

describe("filtering by difficulty band", () => {
  it("keeps only monsters inside the solo XP range", () => {
    // Four level-3 characters: budgets 300 / 600 / 900 / 1600. Medium solo band is 600 to under 900 XP: CR 3 (700).
    const band = soloBand(four(3), "medium");
    const names = filterMonsters(monsters, EMPTY_FILTERS, band).map((m) => m.name);
    expect(names.sort()).toEqual(["Emberwhirl", "Rimehide Prowler", "Thornwarden"]);
  });

  it("includes monsters exactly at the lower bound and excludes the upper bound", () => {
    // Easy band is 300 up to, but not including, 600: CR 2 (450) is in, CR 3 (700) is out.
    const band = soloBand(four(3), "easy");
    const crs = new Set(filterMonsters(monsters, EMPTY_FILTERS, band).map((m) => m.challenge.cr));
    expect([...crs]).toEqual(["2"]);
  });

  it("returns everything when there is no band", () => {
    expect(filterMonsters(monsters, EMPTY_FILTERS, null)).toHaveLength(monsters.length);
  });
});
