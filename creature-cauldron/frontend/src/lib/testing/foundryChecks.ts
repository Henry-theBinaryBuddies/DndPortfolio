// Test-only helpers for checking Foundry files. The app never imports this file.
import type { JsonValue } from "../foundryJson";

/** Keys that are ids (items and activities are stored under their own id), treated as one "*" key. */
const ID_KEY = /^([A-Za-z0-9]{16}|dnd5eactivity\d+)$/;

/**
 * Every path to every value in a JSON structure, as text: "system.attributes.hp.max",
 * "items[].system.activities.*.type". Array positions become "[]" and id keys become "*", so
 * two different monsters can be compared by shape alone.
 */
export function keyPaths(value: JsonValue | undefined, prefix = "", out: Set<string> = new Set()): Set<string> {
  if (prefix !== "") out.add(prefix);
  if (Array.isArray(value)) {
    // Only objects and arrays inside a list add paths of their own; plain values are the list itself.
    for (const item of value) if (item !== null && typeof item === "object") keyPaths(item, `${prefix}[]`, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keyPaths(item, prefix === "" ? key : `${prefix}.${ID_KEY.test(key) ? "*" : key}`, out);
    }
  }
  return out;
}

/** The first `undefined` found anywhere in a structure (JSON would silently drop it), or null. */
export function findUndefined(value: unknown, path = "root"): string | null {
  if (value === undefined) return path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findUndefined(value[i], `${path}[${i}]`);
      if (found) return found;
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const found = findUndefined(item, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
}

/** Foundry's item and activity ids: exactly 16 letters and digits. */
export const FOUNDRY_ID = /^[A-Za-z0-9]{16}$/;
