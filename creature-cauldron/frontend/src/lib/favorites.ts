import type { Monster } from "../types/monster";

// Favorites are stored as a list of monster ids. The list can mention ids the
// library no longer has (it changes between visits), so these helpers always
// look ids up in the live library and quietly ignore the ones that are gone.

/** The monsters that are favorites, in the order given. Ids the library lacks are ignored. */
export function onlyFavorites(monsters: Monster[], favorites: ReadonlySet<string>): Monster[] {
  return monsters.filter((m) => favorites.has(m.id));
}

/** How many of the favorite ids the library actually has. */
export function countAvailableFavorites(monsters: Monster[], favorites: ReadonlySet<string>): number {
  return monsters.reduce((count, m) => (favorites.has(m.id) ? count + 1 : count), 0);
}
