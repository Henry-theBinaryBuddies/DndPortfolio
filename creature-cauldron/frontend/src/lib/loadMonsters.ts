import type { Monster } from "../types/monster";

// The library is two static JSON files served next to the page: our own sample monsters, and the SRD 5.1 monsters
// made by the back end's importer (backend/src/cauldron/seed). BASE_URL keeps the paths correct when the site is
// hosted in a subfolder.
const LIBRARY_FILES = ["sample-monsters.json", "srd-monsters.json"];

async function loadFile(name: string): Promise<Monster[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!response.ok) {
    throw new Error(`Could not load the monster library (${name}, HTTP ${response.status})`);
  }
  return (await response.json()) as Monster[];
}

/** Loads every library file. If one fails, the others are still used; it only throws when none could be loaded. */
export async function loadMonsters(): Promise<Monster[]> {
  const results = await Promise.allSettled(LIBRARY_FILES.map(loadFile));
  const loaded = results.filter((r): r is PromiseFulfilledResult<Monster[]> => r.status === "fulfilled");
  if (loaded.length === 0) {
    const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw first?.reason instanceof Error ? first.reason : new Error("Could not load the monster library");
  }
  return loaded.flatMap((r) => r.value);
}
