import { describe, expect, it } from "vitest";
import { builtinAssets } from "./assets";
import { filterAssets } from "./objects";
import type { Asset } from "./model";

const entry = { id: "tc-barrel", name: "Barrel", group: "Containers", file: "tc-barrel.webp", width: 200, height: 200, ppc: 200 };

describe("builtinAssets", () => {
  it("builds entries served from the stamps folder, marked as bundled", () => {
    const [a] = builtinAssets([entry], "https://example.test/stamps/", new Set());
    expect(a).toMatchObject({ id: "tc-barrel", builtin: true, group: "Containers", ppc: 200, dataUrl: "", favourite: false });
    expect(a.url).toBe("https://example.test/stamps/tc-barrel.webp");
  });

  it("marks remembered favourites", () => {
    const [a] = builtinAssets([entry], "https://example.test/stamps/", new Set(["tc-barrel"]));
    expect(a.favourite).toBe(true);
  });

  it("skips entries that could point outside the folder or have no size", () => {
    const bad = [
      { ...entry, file: "../secret.webp" },
      { ...entry, file: "https://evil.test/x.webp" },
      { ...entry, file: "a/b.webp" },
      { ...entry, width: 0 },
      { ...entry, ppc: -1 },
      { name: "no id" },
      null,
    ];
    expect(builtinAssets(bad, "https://example.test/stamps/", new Set())).toEqual([]);
    expect(builtinAssets("nonsense", "https://example.test/stamps/", new Set())).toEqual([]);
  });
});

describe("filterAssets with groups", () => {
  const make = (name: string, group?: string): Asset => ({ id: name, name, dataUrl: "", width: 1, height: 1, favourite: false, group });
  const all = [make("Oak", "Nature"), make("Barrel", "Containers"), make("Mine")];

  it("limits to a group", () => {
    expect(filterAssets(all, "", false, "Nature").map((a) => a.name)).toEqual(["Oak"]);
  });
  it("searches the group name too", () => {
    expect(filterAssets(all, "contain", false).map((a) => a.name)).toEqual(["Barrel"]);
  });
});
