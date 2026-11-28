// The coins in a character's purse, by kind, from the money coming in and going out in order. Money coming in keeps
// its coin (a fractional amount is split: 2.5 gp is 2 gp and 5 sp). Money going out is paid as a shopkeeper would
// take it: in the coin named, when there are enough of them (a purse line of −5 gp); otherwise from the smallest coins
// up, breaking the smallest coin left that covers the rest, with the change given back in smaller coins (never
// electrum). A purse that can't pay goes below nothing in copper. Coins are never exchanged otherwise.
import { COINS, type Coin } from "../vocabulary";

/** Smallest first. */
const ORDER: Coin[] = ["cp", "sp", "ep", "gp", "pp"];
/** The coins change is given in, largest first. */
const CHANGE: Coin[] = ["pp", "gp", "sp", "cp"];

export type CoinsHeld = Record<Coin, number>;

/** Each entry is an amount in copper pieces (below 0 for money going out) and, for money coming in, its coin. */
export function coinsHeld(entries: { cp: number; coin?: Coin }[]): CoinsHeld {
  const held: CoinsHeld = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const give = (cp: number, below = Infinity) => {
    let left = cp;
    for (const c of CHANGE) {
      if (COINS[c] >= below) continue;
      const n = Math.floor(left / COINS[c]);
      held[c] += n;
      left -= n * COINS[c];
    }
  };
  for (const e of entries) {
    if (e.cp > 0) {
      // In its own coin (gold when none is named), the rest of a fractional amount in smaller coins.
      const coin = e.coin ?? "gp";
      const n = Math.floor(e.cp / COINS[coin]);
      held[coin] += n;
      give(e.cp - n * COINS[coin], COINS[coin]);
    }
    if (e.cp < 0) pay(-e.cp, e.coin);
  }
  return held;

  function pay(cp: number, named?: Coin) {
    if (named && cp % COINS[named] === 0 && held[named] * COINS[named] >= cp) {
      held[named] -= cp / COINS[named];
      return;
    }
    let need = cp;
    for (const c of ORDER) {
      const n = Math.min(held[c], Math.floor(need / COINS[c]));
      held[c] -= n;
      need -= n * COINS[c];
    }
    if (need === 0) return;
    // Every coin left is worth more than what's still owed: break the smallest one.
    const coin = ORDER.find((c) => held[c] > 0);
    if (!coin) {
      held.cp -= need;
      return;
    }
    held[coin] -= 1;
    give(COINS[coin] - need, COINS[coin]);
  }
}
