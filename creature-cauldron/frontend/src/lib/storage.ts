import {
  MAX_ENTRIES,
  MAX_SAVED,
  cleanName,
  clampCount,
  sameName,
  emptyWorking,
  type EncounterEntry,
  type SavedEncounter,
  type WorkingEncounter,
} from "./encounter";
import { DEFAULT_PARTY, MAX_PARTY_SIZE, clampLevel, type Party } from "./party";

// Anything read back from localStorage is untrusted: it may be stale, hand-edited,
// or missing, and storage itself can throw (private windows, blocked site data).
// So every read validates, and every access is wrapped in try/catch.

export const PARTY_STORAGE_KEY = "creature-cauldron:party";
export const FAVORITES_STORAGE_KEY = "creature-cauldron:favorites";
export const ENCOUNTER_STORAGE_KEY = "creature-cauldron:encounter";
export const SAVED_ENCOUNTERS_STORAGE_KEY = "creature-cauldron:saved-encounters";

/** Loose on purpose: ids of future AI-generated monsters may look different from today's. */
export const MAX_ID_LENGTH = 100;

/** An id the page will keep: a string of 1 to MAX_ID_LENGTH characters. */
export function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_ID_LENGTH;
}
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
      .map(clampLevel),
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
    if (isValidId(item)) {
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
    if (!isValidId(monsterId)) continue;
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

/**
 * Turns whatever was stored into saved encounters. One bad item never costs the others.
 * An item with no usable id (older saves, or a missing, over-long or duplicate id) gets
 * "legacy-N", where N counts the saved encounters kept so far (skipped items are not
 * counted). The same stored data always gives the same ids, and they become permanent
 * once usePersistentState writes the parsed list back on first load. Duplicate names
 * are dropped (the first wins), since names are unique. Never throws.
 */
export function parseSavedEncounters(value: unknown): SavedEncounter[] {
  if (!Array.isArray(value)) return [];

  const saved: SavedEncounter[] = [];
  const usedIds = new Set<string>();
  for (const item of value) {
    if (saved.length >= MAX_SAVED) break;
    if (typeof item !== "object" || item === null) continue;
    const { id, name, favorite, entries } = item as Record<string, unknown>;
    if (typeof name !== "string") continue;

    const cleaned = cleanName(name);
    if (cleaned === "" || saved.some((s) => sameName(s.name, cleaned))) continue;
    const rows = parseEntries(entries);
    if (rows.length === 0) continue;

    let finalId = isValidId(id) ? id : "";
    if (finalId === "" || usedIds.has(finalId)) {
      let n = saved.length;
      while (usedIds.has(`legacy-${n}`)) n++;
      finalId = `legacy-${n}`;
    }
    usedIds.add(finalId);
    saved.push({ id: finalId, name: cleaned, favorite: favorite === true, entries: rows });
  }
  return saved;
}

/**
 * Turns whatever was stored into the encounter on the card. Before the card had a name
 * the stored value was just a list of rows, so a bare list is accepted and becomes an
 * unsaved encounter with no name. Never throws.
 */
export function parseWorkingEncounter(value: unknown): WorkingEncounter {
  if (Array.isArray(value)) return { ...emptyWorking(), entries: parseEntries(value) };
  if (typeof value !== "object" || value === null) return emptyWorking();

  const { id, name, favorite, entries } = value as Record<string, unknown>;
  return {
    id: isValidId(id) ? id : null,
    name: typeof name === "string" ? cleanName(name) : "",
    favorite: favorite === true,
    entries: parseEntries(entries),
  };
}
