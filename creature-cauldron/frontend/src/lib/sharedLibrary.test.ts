import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Monster } from "../types/monster";
import { fetchSharedLibrary, mergeLibrary } from "./sharedLibrary";

const monsters = sample as unknown as Monster[];
const [one, two, three] = monsters;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

describe("fetchSharedLibrary", () => {
  it("returns the monsters the server has generated", async () => {
    const fetchFn: typeof fetch = async () => json([one, two]);
    expect(await fetchSharedLibrary("http://x.test", { fetchFn })).toEqual({ ok: true, monsters: [one, two] });
  });

  it("asks the library endpoint", async () => {
    let asked = "";
    const fetchFn: typeof fetch = async (input) => {
      asked = String(input);
      return json([]);
    };
    await fetchSharedLibrary("http://x.test/", { fetchFn });
    expect(asked).toBe("http://x.test/api/v1/library");
  });

  it("drops entries the page could not show and keeps the rest", async () => {
    const fetchFn: typeof fetch = async () => json([one, { name: "Broken" }, null, 5, two]);
    expect(await fetchSharedLibrary("http://x.test", { fetchFn })).toEqual({ ok: true, monsters: [one, two] });
  });

  it("fails quietly when the server cannot be reached", async () => {
    const fetchFn: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await fetchSharedLibrary("http://x.test", { fetchFn })).toEqual({ ok: false });
  });

  it("fails when the answer is not a list, or not OK, or not JSON", async () => {
    for (const response of [json({ not: "a list" }), json([], 500), new Response("<html>", { status: 200 })]) {
      const fetchFn: typeof fetch = async () => response;
      expect(await fetchSharedLibrary("http://x.test", { fetchFn })).toEqual({ ok: false });
    }
  });

  it("gives up on a server that never answers", async () => {
    const fetchFn: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    expect(await fetchSharedLibrary("http://x.test", { fetchFn, timeoutMs: 20 })).toEqual({ ok: false });
  });

  it("ignores an absurdly long list", async () => {
    const fetchFn: typeof fetch = async () => json(Array.from({ length: 6000 }, () => one));
    const result = await fetchSharedLibrary("http://x.test", { fetchFn });
    expect(result.ok && result.monsters.length).toBeLessThanOrEqual(5000);
  });
});

describe("mergeLibrary", () => {
  it("joins the lists in order", () => {
    expect(mergeLibrary([one], [two], [three]).map((m) => m.id)).toEqual([one.id, two.id, three.id]);
  });

  it("keeps the first copy when an id repeats", () => {
    const changed = { ...one, name: "Changed" };
    const merged = mergeLibrary([one], [changed, two]);
    expect(merged.map((m) => m.name)).toEqual([one.name, two.name]);
  });

  it("handles empty lists", () => {
    expect(mergeLibrary([], [])).toEqual([]);
    expect(mergeLibrary([one], [])).toEqual([one]);
  });

  it("does not change the lists it is given", () => {
    const first = [one];
    mergeLibrary(first, [two]);
    expect(first).toEqual([one]);
  });
});
