// The colour theme: light or dark. Until the visitor flips the switch the choice is "auto", which follows the device. The visitor's choice is remembered in the browser. Every
// function here is plain and takes what it needs, so it can be tested without a browser.

export type ThemeChoice = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "creature-cauldron:theme";
const CHOICES: readonly ThemeChoice[] = ["auto", "light", "dark"];

/** The part of window.localStorage this file uses, so a test can pass a stand-in. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** What to show: the choice itself, or, for "auto", what the device prefers. */
export function resolveTheme(choice: ThemeChoice, deviceIsDark: boolean): Theme {
  if (choice === "auto") return deviceIsDark ? "dark" : "light";
  return choice;
}

/** The remembered choice, or "auto" when there is none, it is not one of ours, or storage is unavailable (private windows). */
export function loadChoice(storage: ThemeStorage | null): ThemeChoice {
  try {
    const stored = storage?.getItem(THEME_KEY) ?? null;
    return CHOICES.find((c) => c === stored) ?? "auto";
  } catch {
    return "auto";
  }
}

/** Remembers the choice. Silently does nothing if storage is unavailable: the theme still changes for this visit. */
export function saveChoice(storage: ThemeStorage | null, choice: ThemeChoice): void {
  try {
    storage?.setItem(THEME_KEY, choice);
  } catch {
    // not remembered; that is fine
  }
}

/** The browser's storage, or null where it cannot be reached at all. */
export function browserStorage(): ThemeStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Puts the theme on the page: the stylesheet switches colours on the `data-theme` attribute. */
export function applyTheme(choice: ThemeChoice): void {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = resolveTheme(choice, dark);
}
