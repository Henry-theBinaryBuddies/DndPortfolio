import { DEFAULT_PARTY, MAX_LEVEL, MAX_PARTY_SIZE, MIN_LEVEL, type Party } from "./party";

// Anything read back from localStorage is untrusted: it may be stale, hand-edited,
// or missing, and storage itself can throw (private windows, blocked site data).
// So every read validates, and every access is wrapped in try/catch.

export const PARTY_STORAGE_KEY = "creature-cauldron:party";
export const FAVORITES_STORAGE_KEY = "creature-cauldron:favorites";

/** Loose on purpose: ids of future AI-generated monsters may look different from today's. */
export const MAX_ID_LENGTH = 100;
export const MAX_FAVORITES = 5000;

/** Reads and parses a JSON value. Returns undefined if storage is unavailable, empty or not valid JSON. */
export function readStoredJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Saves a value as JSON. Failures are ignored: the app works the same without storage. */
export function writeStoredJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked; nothing useful to do.
  }
}

/**
 * Turns whatever was stored into a valid party. Levels are rounded and clamped
 * to 1-20, the party is capped at 10 members, and anything unusable becomes the default.
 */
export function parseParty(value: unknown): Party {
  // A fresh copy each time, so nobody can mutate the shared default.
  const fallback = (): Party => ({ levels: [...DEFAULT_PARTY.levels] });

  if (typeof value !== "object" || value === null || !("levels" in value)) return fallback();
  const { levels } = value as { levels: unknown };
  if (!Array.isArray(levels) || levels.length === 0) return fallback();
  if (!levels.every((level) => typeof level === "number" && Number.isFinite(level))) return fallback();

  return {
    levels: (levels as number[])
      .slice(0, MAX_PARTY_SIZE)
      .map((level) => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)))),
  };
}

/**
 * Turns whatever was stored into a list of favorite monster ids. Unlike
 * parseParty, which gives up on the whole value, this checks item by item, so
 * one bad entry never costs you the good ones. Never throws.
 */
export function parseFavorites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  // A Set keeps each id once (the first occurrence wins) and remembers insertion order.
  const ids = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.length >= 1 && item.length <= MAX_ID_LENGTH) {
      ids.add(item);
      if (ids.size >= MAX_FAVORITES) break;
    }
  }
  return [...ids];
}
