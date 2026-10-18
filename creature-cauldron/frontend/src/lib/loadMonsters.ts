import type { Monster } from "../types/monster";

// The library is a static JSON file served next to the page. BASE_URL keeps
// the path correct when the site is hosted in a subfolder.
const LIBRARY_URL = `${import.meta.env.BASE_URL}data/sample-monsters.json`;

export async function loadMonsters(): Promise<Monster[]> {
  const response = await fetch(LIBRARY_URL);
  if (!response.ok) {
    throw new Error(`Could not load the monster library (HTTP ${response.status})`);
  }
  return (await response.json()) as Monster[];
}
