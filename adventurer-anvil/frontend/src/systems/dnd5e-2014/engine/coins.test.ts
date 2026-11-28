// The purse by coin: money coming in keeps its coin, and money going out is paid as a shopkeeper would take it.
import { describe, expect, it } from "vitest";
import { coinsHeld } from "./coins";

const none = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

describe("the coins in the purse", () => {
  it("keeps each income in its own coin, and splits a fractional amount into smaller coins", () => {
    expect(coinsHeld([{ cp: 1500, coin: "gp" }, { cp: 50, coin: "sp" }, { cp: 150, coin: "ep" }, { cp: 2000, coin: "pp" }]))
      .toEqual({ ...none, gp: 15, sp: 5, ep: 3, pp: 2 });
    expect(coinsHeld([{ cp: 250, coin: "gp" }])).toEqual({ ...none, gp: 2, sp: 5 });
  });

  it("pays from the smallest coins up, breaking a gold piece and giving the change in silver", () => {
    // 15 gp, then 13 gp 5 sp of shopping: 14 gp handed over, 5 sp back.
    expect(coinsHeld([{ cp: 1500, coin: "gp" }, { cp: -1350 }])).toEqual({ ...none, gp: 1, sp: 5 });
    // Copper and silver go first.
    expect(coinsHeld([{ cp: 1000, coin: "gp" }, { cp: 30, coin: "sp" }, { cp: 7, coin: "cp" }, { cp: -37 }])).toEqual({ ...none, gp: 10 });
  });

  it("pays in the coin named when there are enough of them; found silver stays silver", () => {
    expect(coinsHeld([{ cp: 1000, coin: "gp" }, { cp: 500, coin: "sp" }, { cp: -500, coin: "gp" }])).toEqual({ ...none, gp: 5, sp: 50 });
    // Not enough gold: the shopkeeper's way instead (the silver goes first).
    expect(coinsHeld([{ cp: 100, coin: "gp" }, { cp: 500, coin: "sp" }, { cp: -300, coin: "gp" }])).toEqual({ ...none, gp: 1, sp: 20 });
  });

  it("breaks platinum into gold, silver and copper, never electrum; a purse that can't pay goes below nothing in copper", () => {
    expect(coinsHeld([{ cp: 1000, coin: "pp" }, { cp: -1 }])).toEqual({ ...none, gp: 9, sp: 9, cp: 9 });
    expect(coinsHeld([{ cp: 100, coin: "gp" }, { cp: -150 }])).toEqual({ ...none, cp: -50 });
  });

  it("always adds up to the same money as the copper total", () => {
    const entries = [{ cp: 1234, coin: "gp" as const }, { cp: -987 }, { cp: 55, coin: "ep" as const }, { cp: -3, coin: "cp" as const }];
    const held = coinsHeld(entries);
    expect(held.cp + held.sp * 10 + held.ep * 50 + held.gp * 100 + held.pp * 1000).toBe(entries.reduce((t, e) => t + e.cp, 0));
  });
});
