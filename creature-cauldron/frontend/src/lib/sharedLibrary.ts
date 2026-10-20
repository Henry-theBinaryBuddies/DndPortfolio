import type { Monster } from "../types/monster";
import { looksLikeMonster } from "./generatedStore";
import { apiUrl, fetchWithTimeout, type HttpOptions } from "./liveGenerator";

// The server keeps every monster it has generated, and shares them with everyone (requirement F-21). The page asks for
// that list once when it loads and adds it to its own library. The list comes from a server, so each entry is checked
// and anything the page could not show is dropped.

/** Shown when the server is configured but its shared library could not be fetched. */
export const SHARED_LIBRARY_NOTE = "Shared library unavailable: showing the built-in monsters.";

const MAX_SHARED = 5000;
const LIBRARY_TIMEOUT_MS = 15_000;

export type SharedLibraryResult = { ok: true; monsters: Monster[] } | { ok: false };

export async function fetchSharedLibrary(baseUrl: string, options: HttpOptions = {}): Promise<SharedLibraryResult> {
  try {
    const response = await fetchWithTimeout(apiUrl(baseUrl, "/library"), { method: "GET" }, { ...options, timeoutMs: options.timeoutMs ?? LIBRARY_TIMEOUT_MS });
    if (!response.ok) return { ok: false };
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return { ok: false };
    return { ok: true, monsters: data.slice(0, MAX_SHARED).filter((entry): entry is Monster => looksLikeMonster(entry)) };
  } catch {
    return { ok: false };
  }
}

/** The lists joined in order, with each id kept once (the first copy wins). The lists given are not changed. */
export function mergeLibrary(...lists: Monster[][]): Monster[] {
  const seen = new Set<string>();
  const merged: Monster[] = [];
  for (const list of lists) {
    for (const monster of list) {
      if (!seen.has(monster.id)) {
        seen.add(monster.id);
        merged.push(monster);
      }
    }
  }
  return merged;
}
