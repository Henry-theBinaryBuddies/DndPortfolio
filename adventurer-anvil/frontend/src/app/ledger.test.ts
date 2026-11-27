// The equipment ledger's columns: rows run down one table and on into the next, a pack's contents stay with their
// heading, and every table is filled with blank lines to the same length.
import { describe, expect, it } from "vitest";
import type { ListItem } from "../core";
import { ledgerColumns } from "./Sheet";

const item = (name: string, detail?: string): ListItem => ({ name, source: "Test", ...(detail ? { detail } : {}) });
const shape = (tables: ReturnType<typeof ledgerColumns>) =>
  tables.map((t) => t.map((r) => (r.kind === "group" ? `[${r.text}]` : r.kind === "item" ? r.item.name : "_")).join(" "));

describe("the ledger's columns", () => {
  it("fills every table with blank lines to the length asked for", () => {
    expect(shape(ledgerColumns([item("a"), item("b")], 2, 3))).toEqual(["a b _", "_ _ _"]);
  });

  it("says a shared detail once, as a heading over its rows", () => {
    expect(shape(ledgerColumns([item("a"), item("b", "in Pack"), item("c", "in Pack"), item("d")], 1, 5))).toEqual(["a [in Pack] b c d _ _"]);
  });

  it("moves a cut back so a group starts the next table whole, when it fits there", () => {
    const items = [item("a"), item("b"), item("c", "in Pack"), item("d", "in Pack"), item("e", "in Pack")];
    expect(shape(ledgerColumns(items, 2, 4))).toEqual(["a b _ _", "[in Pack] c d e"]);
  });

  it("grows the tables when there is more than they hold, keeping two blank lines at the end", () => {
    const tables = ledgerColumns(Array.from({ length: 9 }, (_, i) => item(`i${i}`)), 2, 3);
    expect(tables.map((t) => t.length)).toEqual([6, 6]);
    expect(tables[1].filter((r) => r.kind === "blank")).toHaveLength(3);
  });
});
