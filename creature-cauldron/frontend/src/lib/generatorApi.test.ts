import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Monster } from "../types/monster";
import { createDemoGenerator, createGenerator, damageTypesIn, swapDamageType } from "./demoGenerator";
import { EMPTY_FILTERS } from "./filters";
import { buildGenerateRequest } from "./generateRequest";
import { OFFLINE_MESSAGE, failureMessage, offlineGenerator } from "./generatorApi";
import { looksLikeMonster } from "./generatedStore";

const library = sample as unknown as Monster[];
const anyRequest = buildGenerateRequest(EMPTY_FILTERS, null).request!;

describe("offlineGenerator", () => {
  it("fails every call with the offline message and no network", async () => {
    const generated = await offlineGenerator.generate(anyRequest);
    const reskinned = await offlineGenerator.reskin({ base: library[0], damageSwap: null, template: null });
    for (const result of [generated, reskinned]) {
      expect(result).toEqual({ ok: false, reason: "offline", message: OFFLINE_MESSAGE });
    }
  });
});

describe("failureMessage", () => {
  it("has app wording for each reason", () => {
    expect(failureMessage("offline", "")).toBe(OFFLINE_MESSAGE);
    expect(failureMessage("resting", "")).toMatch(/forge is resting, back tomorrow/);
    expect(failureMessage("rate-limited", "")).toMatch(/Slow down/);
  });

  it("prefers the server's message for invalid and error, with a fallback", () => {
    expect(failureMessage("invalid", "Bad CR")).toBe("Bad CR");
    expect(failureMessage("error", "")).toMatch(/Something went wrong/);
  });
});

describe("createGenerator", () => {
  it("gives the demo generator only for ?generator=demo", () => {
    expect(createGenerator("?generator=demo", library).mode).toBe("demo");
    expect(createGenerator("?x=1&generator=demo", library).mode).toBe("demo");
  });

  it("falls back to offline otherwise", () => {
    for (const search of ["", "?generator=live", "?generator=", "?demo=1"]) {
      expect(createGenerator(search, library)).toBe(offlineGenerator);
    }
  });
});

describe("demo generate", () => {
  it("makes an unvalidated copy of a matching monster with a fresh id", async () => {
    const generator = createDemoGenerator(library);
    const request = buildGenerateRequest({ ...EMPTY_FILTERS, types: ["undead"] }, null).request!;
    const result = await generator.generate(request);
    if (!result.ok) throw new Error("expected success");
    expect(result.monster).toMatchObject({ source: "ai", validated: false, generator: "demo", type: "undead" });
    expect(library.some((m) => m.id === result.monster.id)).toBe(false);
    expect(library.some((m) => m.id === result.monster.parent_id)).toBe(true);
    expect(looksLikeMonster(JSON.parse(JSON.stringify(result.monster)))).toBe(true);
  });

  it("gives a different id every time", async () => {
    const generator = createDemoGenerator(library);
    const a = await generator.generate(anyRequest);
    const b = await generator.generate(anyRequest);
    if (!a.ok || !b.ok) throw new Error("expected success");
    expect(a.monster.id).not.toBe(b.monster.id);
  });

  it("copies any monster and says so when nothing matches", async () => {
    const generator = createDemoGenerator(library);
    const result = await generator.generate({ ...anyRequest, crMin: 99 });
    if (!result.ok) throw new Error("expected success");
    expect(result.notes.join(" ")).toMatch(/Nothing in the library matched/);
  });

  it("fails cleanly with an empty library", async () => {
    const result = await createDemoGenerator([]).generate(anyRequest);
    expect(result).toMatchObject({ ok: false, reason: "error" });
  });
});

describe("damage swaps", () => {
  const withFire = library.find((m) => damageTypesIn(m).includes("fire"))!;

  it("lists the damage types a monster uses", () => {
    expect(damageTypesIn(withFire)).toContain("fire");
    expect(damageTypesIn(withFire)).toEqual([...damageTypesIn(withFire)].sort());
  });

  it("replaces every use of a type and leaves the original alone", () => {
    const before = JSON.stringify(withFire);
    const swapped = swapDamageType(withFire, "fire", "cold");
    expect(damageTypesIn(swapped)).not.toContain("fire");
    expect(damageTypesIn(swapped)).toContain("cold");
    expect(JSON.stringify(withFire)).toBe(before);
  });

  it("does not leave duplicate resistances after a swap", () => {
    const m = { ...withFire, resistances: ["fire", "cold"] as Monster["resistances"] };
    expect(swapDamageType(m, "fire", "cold").resistances).toEqual(["cold"]);
  });

  it("drops a damage theme that the new type cannot be", () => {
    const m = { ...withFire, damage_themes: ["fire"] as Monster["damage_themes"] };
    expect(swapDamageType(m, "fire", "slashing").damage_themes).toEqual([]);
  });
});

describe("demo reskin", () => {
  it("makes a new unvalidated reskin that names its parent", async () => {
    const base = library.find((m) => damageTypesIn(m).includes("fire"))!;
    const result = await createDemoGenerator(library).reskin({ base, damageSwap: { from: "fire", to: "cold" }, template: "elite" });
    if (!result.ok) throw new Error("expected success");
    expect(result.monster).toMatchObject({ source: "reskin", validated: false, parent_id: base.id });
    expect(result.monster.name).toBe(`${base.name} (cold elite)`);
    expect(damageTypesIn(result.monster)).not.toContain("fire");
    expect(result.notes.join(" ")).toMatch(/not applied/);
  });
});
