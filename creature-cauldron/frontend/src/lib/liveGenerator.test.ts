import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Monster } from "../types/monster";
import { OFFLINE_MESSAGE, type GenerateRequest, type ReskinRequest } from "./generatorApi";
import { apiUrl, createLiveGenerator, retryAfterMessage } from "./liveGenerator";

const drake = (sample as unknown as Monster[]).find((m) => m.name === "Stormhide Drake")!;

const REQUEST: GenerateRequest = {
  crMin: 4,
  crMax: 4,
  types: ["dragon"],
  sizes: [],
  environments: [],
  roles: [],
  damageThemes: [],
  features: [],
};

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

/** A fetch that records what it was asked and answers with a prepared Response. */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn: typeof fetch = async (input, init) => {
    const call: Call = { url: String(input), init: init ?? {}, body: init?.body ? JSON.parse(String(init.body)) : {} };
    calls.push(call);
    return respond(call);
  };
  return { fn, calls };
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

describe("apiUrl", () => {
  it("joins the server address and the path without doubling slashes", () => {
    expect(apiUrl("http://localhost:8000", "/health")).toBe("http://localhost:8000/api/v1/health");
    expect(apiUrl("http://localhost:8000/", "/health")).toBe("http://localhost:8000/api/v1/health");
    expect(apiUrl("https://forge.example.com//", "/generate")).toBe("https://forge.example.com/api/v1/generate");
  });
});

describe("retryAfterMessage", () => {
  it("says how long to wait when the server said", () => {
    expect(retryAfterMessage("45")).toBe("Slow down a little: try again in about 45 seconds.");
    expect(retryAfterMessage("1")).toBe("Slow down a little: try again in about 1 second.");
  });

  it("rounds long waits to minutes", () => {
    expect(retryAfterMessage("600")).toBe("Slow down a little: try again in about 10 minutes.");
  });

  it("falls back to a general message for a missing or odd value", () => {
    for (const bad of [null, "", "soon", "-5", "0"]) expect(retryAfterMessage(bad)).toBe("Slow down a little: try again in a minute.");
  });
});

describe("the live generator: generating", () => {
  it("posts the filters, plus the ids to leave out, to the generate endpoint", async () => {
    const { fn, calls } = fakeFetch(() => json({ ok: true, monster: drake, notes: [] }));
    await createLiveGenerator("http://localhost:8000", { fetchFn: fn }).generate({ ...REQUEST, excludeIds: ["a", "b"] });
    const [call] = calls;
    expect(call.url).toBe("http://localhost:8000/api/v1/generate");
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(call.body).toEqual({ ...REQUEST, excludeIds: ["a", "b"] });
  });

  it("sends an empty exclude list when there is none", async () => {
    const { fn, calls } = fakeFetch(() => json({ ok: true, monster: drake, notes: [] }));
    await createLiveGenerator("http://x.test", { fetchFn: fn }).generate(REQUEST);
    expect(calls[0].body.excludeIds).toEqual([]);
  });

  it("is in live mode", () => {
    expect(createLiveGenerator("http://x.test", { fetchFn: fakeFetch(() => json({})).fn }).mode).toBe("live");
  });

  it("returns the monster and the notes from a success", async () => {
    const { fn } = fakeFetch(() => json({ ok: true, monster: drake, notes: ["Fixed a number."] }));
    const result = await createLiveGenerator("http://x.test", { fetchFn: fn }).generate(REQUEST);
    expect(result).toEqual({ ok: true, monster: drake, notes: ["Fixed a number."] });
  });

  it("treats a missing or odd notes list as no notes", async () => {
    const { fn } = fakeFetch(() => json({ ok: true, monster: drake, notes: [5, null, "kept"] }));
    const result = await createLiveGenerator("http://x.test", { fetchFn: fn }).generate(REQUEST);
    expect(result).toMatchObject({ ok: true, notes: ["kept"] });
    const { fn: second } = fakeFetch(() => json({ ok: true, monster: drake }));
    expect(await createLiveGenerator("http://x.test", { fetchFn: second }).generate(REQUEST)).toMatchObject({ ok: true, notes: [] });
  });

  it("refuses a monster that the page could not show", async () => {
    const { fn } = fakeFetch(() => json({ ok: true, monster: { name: "Broken" }, notes: [] }));
    const result = await createLiveGenerator("http://x.test", { fetchFn: fn }).generate(REQUEST);
    expect(result).toMatchObject({ ok: false, reason: "error" });
  });

  it.each(["resting", "invalid", "error", "offline"] as const)("passes on the failure reason %s and its message", async (reason) => {
    const { fn } = fakeFetch(() => json({ ok: false, reason, message: "From the server." }, 422));
    const result = await createLiveGenerator("http://x.test", { fetchFn: fn }).generate(REQUEST);
    expect(result).toEqual({ ok: false, reason, message: "From the server." });
  });

  it("turns a rate limit into a message with the wait time", async () => {
    const { fn } = fakeFetch(() => json({ ok: false, reason: "rate-limited", message: "Slow down a little: try again in a minute." }, 429, { "retry-after": "30" }));
    const result = await createLiveGenerator("http://x.test", { fetchFn: fn }).generate(REQUEST);
    expect(result).toEqual({ ok: false, reason: "rate-limited", message: "Slow down a little: try again in about 30 seconds." });
  });

  it("treats a reason it does not know as an error", async () => {
    const { fn } = fakeFetch(() => json({ ok: false, reason: "on-fire", message: "?" }, 500));
    expect(await createLiveGenerator("http://x.test", { fetchFn: fn }).generate(REQUEST)).toMatchObject({ ok: false, reason: "error" });
  });

  it.each([
    [429, "rate-limited"],
    [503, "resting"],
    [422, "invalid"],
    [502, "error"],
    [500, "error"],
  ] as const)("falls back to the status %i when the body cannot be read (%s)", async (status, reason) => {
    const { fn } = fakeFetch(() => new Response("<html>Bad gateway</html>", { status, headers: { "content-type": "text/html" } }));
    expect(await createLiveGenerator("http://x.test", { fetchFn: fn }).generate(REQUEST)).toMatchObject({ ok: false, reason });
  });

  it("says the generator is offline when the server cannot be reached", async () => {
    const fn: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await createLiveGenerator("http://x.test", { fetchFn: fn }).generate(REQUEST)).toEqual({ ok: false, reason: "offline", message: OFFLINE_MESSAGE });
  });

  it("gives up and says offline when the server takes too long", async () => {
    const fn: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    const result = await createLiveGenerator("http://x.test", { fetchFn: fn, timeoutMs: 20 }).generate(REQUEST);
    expect(result).toMatchObject({ ok: false, reason: "offline" });
  });
});

describe("the live generator: reskinning", () => {
  const reskin: ReskinRequest = { base: drake, damageSwap: { from: "lightning", to: "cold" }, template: "elite" };

  it("sends only the id of the monster, never the monster", async () => {
    const { fn, calls } = fakeFetch(() => json({ ok: true, monster: drake, notes: [] }));
    await createLiveGenerator("http://x.test", { fetchFn: fn }).reskin(reskin);
    expect(calls[0].url).toBe("http://x.test/api/v1/reskin");
    expect(calls[0].body).toEqual({ baseId: drake.id, damageSwap: { from: "lightning", to: "cold" }, template: "elite" });
    expect(JSON.stringify(calls[0].body)).not.toContain(drake.name);
  });

  it("sends null for the parts that were not chosen", async () => {
    const { fn, calls } = fakeFetch(() => json({ ok: true, monster: drake, notes: [] }));
    await createLiveGenerator("http://x.test", { fetchFn: fn }).reskin({ base: drake, damageSwap: null, template: "elite" });
    expect(calls[0].body).toEqual({ baseId: drake.id, damageSwap: null, template: "elite" });
  });

  it("maps answers the same way as generating", async () => {
    const { fn } = fakeFetch(() => json({ ok: false, reason: "invalid", message: "That monster is not known to the forge." }, 422));
    expect(await createLiveGenerator("http://x.test", { fetchFn: fn }).reskin(reskin)).toEqual({
      ok: false,
      reason: "invalid",
      message: "That monster is not known to the forge.",
    });
  });
});

describe("the live generator: status", () => {
  const status = async (respond: () => Response | Promise<Response>) => {
    const { fn } = fakeFetch(respond);
    return createLiveGenerator("http://x.test", { fetchFn: fn }).status!();
  };

  it("reads ok and resting from the health endpoint", async () => {
    expect(await status(() => json({ status: "ok" }))).toBe("ok");
    expect(await status(() => json({ status: "resting" }))).toBe("resting");
  });

  it("calls the health endpoint with GET", async () => {
    const { fn, calls } = fakeFetch(() => json({ status: "ok" }));
    await createLiveGenerator("http://x.test/", { fetchFn: fn }).status!();
    expect(calls[0].url).toBe("http://x.test/api/v1/health");
    expect(calls[0].init.method ?? "GET").toBe("GET");
  });

  it("says offline when the server cannot be reached or answers oddly", async () => {
    const down: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await createLiveGenerator("http://x.test", { fetchFn: down }).status!()).toBe("offline");
    expect(await status(() => new Response("nope", { status: 500 }))).toBe("offline");
    expect(await status(() => json({ status: "weird" }))).toBe("offline");
  });
});
