import {
  MAX_ENTRIES,
  MAX_SAVED,
  cleanName,
  clampCount,
  sameName,
  type EncounterEntry,
  type SavedEncounter,
} from "./encounter";
import { DEFAULT_PARTY, MAX_LEVEL, MAX_PARTY_SIZE, MIN_LEVEL, type Party } from "./party";

// Anything read back from localStorage is untrusted: it may be stale, hand-edited,
// or missing, and storage itself can throw (private windows, blocked site data).
// So every read validates, and every access is wrapped in try/catch.

export const PARTY_STORAGE_KEY = "creature-cauldron:party";
export const FAVORITES_STORAGE_KEY = "creature-cauldron:favorites";
export const ENCOUNTER_STORAGE_KEY = "creature-cauldron:encounter";
export const SAVED_ENCOUNTERS_STORAGE_KEY = "creature-cauldron:saved-encounters";

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

/**
 * Turns whatever was stored into encounter rows. Checks item by item, so a bad row
 * never costs the good ones. A count must be a finite number (JSON like 1e999 gives
 * Infinity, which typeof still calls a number), then it is rounded and clamped.
 * Repeated monsters are merged. Never throws.
 */
export function parseEntries(value: unknown): EncounterEntry[] {
  if (!Array.isArray(value)) return [];

  // A Map, not a plain object: an id like "__proto__" is an ordinary Map key but misbehaves as an object key.
  const merged = new Map<string, EncounterEntry>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { monsterId, count, name } = item as Record<string, unknown>;
    if (typeof monsterId !== "string" || monsterId.length < 1 || monsterId.length > MAX_ID_LENGTH) continue;
    if (typeof count !== "number" || !Number.isFinite(count)) continue;

    const existing = merged.get(monsterId);
    if (existing) {
      existing.count = clampCount(existing.count + clampCount(count)); // our own fresh object, safe to update
      continue;
    }
    if (merged.size >= MAX_ENTRIES) continue;

    const entry: EncounterEntry = { monsterId, count: clampCount(count) };
    if (typeof name === "string") {
      const cleaned = cleanName(name);
      if (cleaned !== "") entry.name = cleaned;
    }
    merged.set(monsterId, entry);
  }
  return [...merged.values()];
}

/** Turns whatever was stored into saved encounters. One bad item never costs the others. Never throws. */
export function parseSavedEncounters(value: unknown): SavedEncounter[] {
  if (!Array.isArray(value)) return [];

  const saved: SavedEncounter[] = [];
  for (const item of value) {
    if (saved.length >= MAX_SAVED) break;
    if (typeof item !== "object" || item === null) continue;
    const { name, entries } = item as Record<string, unknown>;
    if (typeof name !== "string") continue;

    const cleaned = cleanName(name);
    if (cleaned === "" || saved.some((s) => sameName(s.name, cleaned))) continue;
    const rows = parseEntries(entries);
    if (rows.length === 0) continue;
    saved.push({ name: cleaned, entries: rows });
  }
  return saved;
}
