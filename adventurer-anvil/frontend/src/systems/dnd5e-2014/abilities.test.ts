// The Abilities step: each method's own choice, the rules checked for it, and rolling with the roll log.
import { describe, expect, it } from "vitest";
import {
  addRolls, createContentIndex, newCharacterDocument, readPack, rollSet, rollSets, setChoice, viewCharacter,
  type CharacterDocument, type ChoiceValue,
} from "../../core";
import { dnd5e2014 } from "./module";
import { METHOD_KEY, POINT_BUY_KEY, ROLL_KEY, ROLLED_KEY, STANDARD_KEY } from "./steps/abilities";
import { pointBuy, standardArray } from "./testing/abilities";
import sample from "./testing/elf-sample.pack.json";

const T = "2026-11-13T10:00:00.000Z";
const result = readPack(sample, dnd5e2014, []);
if (!result.ok) throw new Error(result.errors.join("\n"));
const content = createContentIndex([result.pack]);

function doc(choices: Record<string, ChoiceValue>): CharacterDocument {
  let d = newCharacterDocument({ id: "c", system: { id: "dnd5e-2014", version: 1 }, packs: [], now: T });
  for (const [k, v] of Object.entries(choices)) d = setChoice(d, k, v, T);
  return d;
}
const view = (d: CharacterDocument) => viewCharacter(dnd5e2014, d, content);
const abilities = (d: CharacterDocument) => view(d).steps.find((s) => s.id === "abilities")!;
const issueIds = (d: CharacterDocument) => view(d).issues.map((i) => i.id);
const score = (d: CharacterDocument, a: string) => view(d).derived[`ability.${a}`].value;

/** Dice that come up in the given order, for a known roll. */
function dice(...faces: number[]) {
  let i = 0;
  return () => (faces[i++ % faces.length] - 0.5) / 6;
}
let n = 0;
const newId = () => `id-${n++}`;

describe("choosing a method", () => {
  it("starts with only the method to choose, shown as a switch", () => {
    const step = abilities(doc({}));
    expect(step.status).toBe("todo");
    expect(step.choices.map((c) => c.key)).toEqual([METHOD_KEY]);
    expect(step.choices[0].presentation).toBe("segmented");
    expect(step.choices[0].options?.map((o) => o.name)).toEqual(["Standard array", "Point buy", "Roll"]);
  });

  it("keeps each method's work, so switching and back loses nothing", () => {
    const array = { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 };
    let d = doc({ ...standardArray(array), [POINT_BUY_KEY]: { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 } });
    expect(view(d).unused).toEqual([POINT_BUY_KEY]);
    expect(score(d, "int")).toBe(15);

    d = setChoice(d, METHOD_KEY, "point-buy", T);
    expect(view(d).unused).toEqual([STANDARD_KEY]);
    expect(score(d, "str")).toBe(15);

    d = setChoice(d, METHOD_KEY, "standard-array", T);
    expect(score(d, "str")).toBe(8);
  });
});

describe("standard array", () => {
  it("offers the six values for the six abilities, each linked to its final score and modifier", () => {
    const spec = abilities(doc({ [METHOD_KEY]: "standard-array" })).choices[1];
    expect(spec).toMatchObject({ key: STANDARD_KEY, kind: "assign", values: [15, 14, 13, 12, 10, 8], answered: false });
    expect(spec.slots?.[1]).toEqual({ id: "dex", name: "Dexterity", derived: "ability.dex", derivedNote: "ability.dex.mod" });
  });

  it("is to do until all six are given, using 10 for the rest", () => {
    const d = doc(standardArray({ str: 15, dex: 14 }));
    expect(abilities(d).status).toBe("todo");
    expect(score(d, "str")).toBe(15);
    expect(score(d, "con")).toBe(10);
    expect(issueIds(d)).toEqual([]);
  });

  it("is done with the array used once each", () => {
    expect(abilities(doc(standardArray({ str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }))).status).toBe("done");
  });

  it("reports a value used twice or not in the array", () => {
    expect(issueIds(doc(standardArray({ str: 15, dex: 15 })))).toContain("standard-array");
    expect(issueIds(doc(standardArray({ str: 16 })))).toContain("standard-array");
  });
});

describe("point buy", () => {
  it("offers 8 to 15 with the 27-point cost table", () => {
    const spec = abilities(doc({ [METHOD_KEY]: "point-buy" })).choices[1];
    expect(spec).toMatchObject({ kind: "allocate", range: { min: 8, max: 15 } });
    expect(spec.budget?.total).toBe(27);
    expect(spec.budget?.cost).toMatchObject({ 8: 0, 13: 5, 14: 7, 15: 9 });
  });

  it("accepts exactly 27 points", () => {
    const d = doc(pointBuy({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }));
    expect(issueIds(d)).toEqual([]);
    expect(abilities(d).status).toBe("done");
  });

  it("reports spending more than 27, and scores outside 8 to 15", () => {
    const over = doc(pointBuy({ str: 15, dex: 15, con: 15, int: 9, wis: 8, cha: 8 }));
    expect(view(over).issues.find((i) => i.id === "point-buy-over")?.message).toBe("Point buy allows 27 points; these cost 28.");
    expect(issueIds(doc(pointBuy({ str: 16 })))).toContain("point-buy-range");
    expect(issueIds(doc(pointBuy({ str: 7 })))).toContain("point-buy-range");
  });
});

describe("rolling", () => {
  it("asks for a roll first, then offers the latest set's totals", () => {
    let d = doc({ [METHOD_KEY]: "roll" });
    expect(abilities(d).choices.map((c) => c.key)).toEqual([METHOD_KEY, ROLL_KEY]);
    expect(abilities(d).choices[1]).toMatchObject({ kind: "roll", dice: "4d6kh3", times: 6, answered: false });

    // 6,5,4,(2)=15  6,6,2,(1)=14  5,4,4,(3)=13  6,3,2,(1)=11  4,3,3,(2)=10  5,2,1,(1)=8
    const rolls = rollSet({ expression: "4d6kh3", times: 6, for: ROLL_KEY, now: T, newId, random: dice(6, 5, 4, 2, 6, 6, 2, 1, 5, 4, 4, 3, 6, 3, 2, 1, 4, 3, 3, 2, 5, 2, 1, 1) });
    expect(rolls.map((r) => r.total)).toEqual([15, 14, 13, 11, 10, 8]);
    expect(new Set(rolls.map((r) => r.set)).size).toBe(1);
    d = addRolls(d, rolls, T);

    const spec = abilities(d).choices.find((c) => c.key === ROLLED_KEY)!;
    expect(spec.values).toEqual([15, 14, 13, 11, 10, 8]);
    d = setChoice(d, ROLLED_KEY, { str: 8, dex: 15, con: 13, int: 14, wis: 11, cha: 10 }, T);
    expect(abilities(d).status).toBe("done");
    expect(score(d, "dex")).toBe(15);
  });

  it("keeps every set in the roll log, counts only the latest, and says when scores no longer match it", () => {
    let d = doc({ [METHOD_KEY]: "roll" });
    d = addRolls(d, rollSet({ expression: "4d6kh3", times: 6, for: ROLL_KEY, now: T, newId, random: dice(6) }), T); // six 18s
    d = setChoice(d, ROLLED_KEY, { str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 }, T);
    expect(issueIds(d)).toEqual([]);

    d = addRolls(d, rollSet({ expression: "4d6kh3", times: 6, for: ROLL_KEY, now: T, newId, random: dice(1) }), T); // six 3s
    expect(rollSets(d, ROLL_KEY)).toHaveLength(2);
    expect(issueIds(d)).toContain("rolled-mismatch");
  });
});
