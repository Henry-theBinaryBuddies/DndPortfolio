import { describe, expect, it } from "vitest";
import { THEME_KEY, loadChoice, resolveTheme, saveChoice, type ThemeStorage } from "./theme";

function memory(initial: Record<string, string> = {}): ThemeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

const broken: ThemeStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("resolveTheme", () => {
  it("follows the device for auto", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
  });

  it("ignores the device when a theme is chosen", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("remembering the choice", () => {
  it("defaults to auto with nothing stored, junk stored, or no storage", () => {
    expect(loadChoice(memory())).toBe("auto");
    expect(loadChoice(memory({ [THEME_KEY]: "purple" }))).toBe("auto");
    expect(loadChoice(null)).toBe("auto");
  });

  it("returns what was saved", () => {
    const store = memory();
    saveChoice(store, "dark");
    expect(store.data[THEME_KEY]).toBe("dark");
    expect(loadChoice(store)).toBe("dark");
  });

  it("copes with storage that throws", () => {
    expect(loadChoice(broken)).toBe("auto");
    expect(() => saveChoice(broken, "light")).not.toThrow();
  });
});
