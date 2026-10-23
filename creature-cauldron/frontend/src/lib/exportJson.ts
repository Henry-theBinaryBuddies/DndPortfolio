import type { Monster } from "../types/monster";
import type { EncounterSummary } from "./encounter";
import type { Party, Rating } from "./party";

// Our own export format: a small versioned envelope around the data. The keys are snake_case,
// like the Monster schema, because a file is an outside-facing contract. The builders are pure:
// the time is passed in, so the same input always gives the same file.
//
// No import feature exists yet. The envelope is designed so a later one can check "app", "kind"
// and "format_version" before trusting anything else in the file.

export const APP_NAME = "Creature Cauldron";

/** Bump when a field is changed or removed. Adding an optional field does not need a bump. */
export const FORMAT_VERSION = 1;

export interface MonsterFile {
  app: typeof APP_NAME;
  kind: "monster";
  format_version: number;
  exported_at: string;
  monster: Monster;
}

export interface EncounterFileEntry {
  monster_id: string;
  count: number;
  name: string;
  /** The library has this monster. */
  in_library: boolean;
  /** Its XP was usable, so it was part of the maths. A monster can be in the library but not counted. */
  counted: boolean;
}

export interface EncounterFile {
  app: typeof APP_NAME;
  kind: "encounter";
  format_version: number;
  exported_at: string;
  name: string;
  party: { levels: number[] };
  entries: EncounterFileEntry[];
  /** Informational. A future importer must recompute it and ignore these numbers. */
  summary: {
    monster_count: number;
    missing_count: number;
    total_xp: number;
    multiplier: number | null;
    adjusted_xp: number;
    rating: Rating | null;
    party_size: number;
    party_shift: "up" | "down" | null;
  };
  /** One full stat block per monster the library has, so the file works without the library. */
  monsters: Monster[];
}

/** One monster, exactly as stored, inside the envelope. */
export function buildMonsterFile(monster: Monster, exportedAt: string): MonsterFile {
  return { app: APP_NAME, kind: "monster", format_version: FORMAT_VERSION, exported_at: exportedAt, monster };
}

/**
 * The encounter on the card. `name` should be what the user typed, or the plain word "Encounter":
 * the "Encounter N" default depends on how many are saved, so it does not belong in a file.
 * Rows come from the same summary the panel shows, so the file always matches the screen.
 */
export function buildEncounterFile(
  name: string,
  summary: EncounterSummary,
  party: Party,
  exportedAt: string,
): EncounterFile {
  const monsters: Monster[] = [];
  const entries = summary.lines.map(({ entry, monster, xp }) => {
    if (monster && !monsters.some((m) => m.id === monster.id)) monsters.push(monster);
    return {
      monster_id: entry.monsterId,
      count: entry.count,
      name: monster?.name ?? entry.name ?? "Unknown monster",
      in_library: monster !== undefined,
      counted: xp !== null,
    };
  });

  return {
    app: APP_NAME,
    kind: "encounter",
    format_version: FORMAT_VERSION,
    exported_at: exportedAt,
    name,
    party: { levels: [...party.levels] },
    entries,
    summary: {
      monster_count: summary.monsterCount,
      missing_count: summary.missingCount,
      total_xp: summary.totalXp,
      multiplier: summary.multiplier,
      adjusted_xp: summary.adjustedXp,
      rating: summary.rating,
      party_size: summary.partySize,
      party_shift: summary.partyShift,
    },
    monsters,
  };
}
