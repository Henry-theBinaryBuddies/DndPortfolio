import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Monster } from "../types/monster";
import { MOVE_GROUPS, REMIX_MOVES, SURPRISE, movesFor } from "./remixMoves";

const library = sample as unknown as Monster[];
const named = (name: string) => library.find((m) => m.name === name)!;

describe("the remix move menu", () => {
  it("has moves with unique keys, each in a known group", () => {
    expect(new Set(REMIX_MOVES.map((m) => m.key)).size).toBe(REMIX_MOVES.length);
    for (const move of REMIX_MOVES) expect(MOVE_GROUPS).toContain(move.group);
  });

  it("does not use the word that means a server decision as a move key", () => {
    expect(REMIX_MOVES.map((m) => m.key)).not.toContain(SURPRISE);
  });

  it("offers every move to a monster that deals damage", () => {
    const attacker = library.find((m) => m.size !== "tiny" && m.actions.some((a) => a.kind === "attack"))!;
    expect(movesFor(attacker)).toHaveLength(REMIX_MOVES.length);
  });

  it("keeps the moves that move creatures around away from a Tiny monster", () => {
    const tiny = { ...named("Stormhide Drake"), size: "tiny" } as Monster;
    const keys = movesFor(tiny).map((m) => m.key);
    expect(keys).not.toContain("pull");
    expect(keys).not.toContain("leap");
    expect(keys).toContain("burst");
  });

  it("offers a monster that deals no damage only the moves that need none", () => {
    const harmless = { ...named("Stormhide Drake"), actions: [], bonus_actions: [], reactions: [], legendary_actions: null } as unknown as Monster;
    expect(movesFor(harmless).every((m) => !m.needsDamage)).toBe(true);
    expect(movesFor(harmless).length).toBeGreaterThan(0);
  });
});
