import type { Monster } from "../types/monster";
import type { CreatureType, DamageTheme, Environment, Feature, Role, Size } from "./options";

// Pure filtering and sorting. The visible list is always computed from the full
// library plus these settings, never stored, so the two can't drift apart.

/** Every CR a monster can have, in order, for the min/max pickers. */
export const CR_LADDER: { label: string; value: number }[] = [
  { label: "0", value: 0 },
  { label: "1/8", value: 0.125 },
  { label: "1/4", value: 0.25 },
  { label: "1/2", value: 0.5 },
  ...Array.from({ length: 30 }, (_, i) => ({ label: String(i + 1), value: i + 1 })),
];

export interface FilterState {
  search: string;
  types: CreatureType[];
  sizes: Size[];
  environments: Environment[];
  roles: Role[];
  damageThemes: DamageTheme[];
  features: Feature[];
  /** Inclusive bounds on challenge rating; null means no bound. */
  crMin: number | null;
  crMax: number | null;
}

export const EMPTY_FILTERS: FilterState = {
  search: "",
  types: [],
  sizes: [],
  environments: [],
  roles: [],
  damageThemes: [],
  features: [],
  crMin: null,
  crMax: null,
};

/** Empty selection means "don't filter"; otherwise the monster's value must be among the picks (OR). */
function matchesOne<T>(picked: readonly T[], value: T): boolean {
  return picked.length === 0 || picked.includes(value);
}

/** Matches when the monster has at least one of the picked tags (OR within the group). */
function matchesAny<T>(picked: readonly T[], tags: readonly T[]): boolean {
  return picked.length === 0 || picked.some((p) => tags.includes(p));
}

/** Matches only when the monster has every picked tag (AND within the group). */
function matchesAll<T>(picked: readonly T[], tags: readonly T[]): boolean {
  return picked.every((p) => tags.includes(p));
}

/** A band of monster XP: `min` is inclusive, `max` is exclusive, and null means no upper limit. */
export interface XpRange {
  min: number;
  max: number | null;
}

/**
 * All active filters must pass (AND between groups). Features use AND inside their group; the rest use OR.
 * `xpRange` is optional and comes from the party's difficulty pick rather than from FilterState.
 */
export function matchesFilters(monster: Monster, filters: FilterState, xpRange: XpRange | null = null): boolean {
  const search = filters.search.trim().toLowerCase();
  const cr = monster.challenge.cr_value;
  const xp = monster.challenge.xp;
  return (
    (xpRange === null || (xp >= xpRange.min && (xpRange.max === null || xp < xpRange.max))) &&
    (search === "" || monster.name.toLowerCase().includes(search)) &&
    matchesOne(filters.types, monster.type) &&
    matchesOne(filters.sizes, monster.size) &&
    matchesOne(filters.roles, monster.role) &&
    matchesAny(filters.environments, monster.environments) &&
    matchesAny(filters.damageThemes, monster.damage_themes) &&
    matchesAll(filters.features, monster.features) &&
    (filters.crMin === null || cr >= filters.crMin) &&
    (filters.crMax === null || cr <= filters.crMax)
  );
}

export function filterMonsters(monsters: Monster[], filters: FilterState, xpRange: XpRange | null = null): Monster[] {
  return monsters.filter((m) => matchesFilters(m, filters, xpRange));
}

/** How many groups are narrowing the list (the search box and CR range each count once). */
export function countActiveFilters(filters: FilterState): number {
  const groups = [
    filters.search.trim() !== "",
    filters.types.length > 0,
    filters.sizes.length > 0,
    filters.environments.length > 0,
    filters.roles.length > 0,
    filters.damageThemes.length > 0,
    filters.features.length > 0,
    filters.crMin !== null || filters.crMax !== null,
  ];
  return groups.filter(Boolean).length;
}

/** Returns a new list with `value` added, or removed if it was already there. */
export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export type SortKey = "name" | "cr" | "type";
export type SortDirection = "asc" | "desc";

/** Sorts a copy of the list. Ties always fall back to name, A to Z. */
export function sortMonsters(monsters: Monster[], key: SortKey, direction: SortDirection): Monster[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...monsters].sort((a, b) => {
    let primary = 0;
    if (key === "cr") primary = a.challenge.cr_value - b.challenge.cr_value;
    else if (key === "type") primary = a.type.localeCompare(b.type);
    else primary = a.name.localeCompare(b.name);
    return primary !== 0 ? sign * primary : a.name.localeCompare(b.name);
  });
}
