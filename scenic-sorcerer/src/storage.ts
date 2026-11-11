// Saving and loading maps: a JSON file the user owns, plus an autosave copy in the browser.

import { FLOORS, LIMITS, clampInt, type FloorId, type GridType, type MapDoc, type Opening, type Point, type Room } from "./model";
import { isValidOutline } from "./rooms";

export const FILE_EXTENSION = ".scenic.json";
export const AUTOSAVE_KEY = "scenic-sorcerer.autosave";
const APP_ID = "scenic-sorcerer";
const GRID_TYPES: GridType[] = ["square", "hex-flat", "hex-pointy"];

export function serialize(doc: MapDoc): string {
  return JSON.stringify({ app: APP_ID, ...doc }, null, 2);
}

/** Read a saved map. Throws an Error with a message fit to show the user. */
export function parse(text: string): MapDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This file is not a Scenic Sorcerer map.");
  }
  if (!isRecord(raw) || raw.app !== APP_ID || !isRecord(raw.grid)) {
    throw new Error("This file is not a Scenic Sorcerer map.");
  }
  if (raw.version !== 1) {
    throw new Error("This map was saved by a newer version of Scenic Sorcerer.");
  }
  const grid = raw.grid;
  if (!GRID_TYPES.includes(grid.type as GridType)) {
    throw new Error("This map uses a grid type that is not supported.");
  }
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, LIMITS.maxNameLength) : "";
  return {
    version: 1,
    name: name || "Untitled map",
    grid: {
      type: grid.type as GridType,
      cols: clampInt(Number(grid.cols), LIMITS.minCells, LIMITS.maxCells),
      rows: clampInt(Number(grid.rows), LIMITS.minCells, LIMITS.maxCells),
      cellPx: clampInt(Number(grid.cellPx), LIMITS.minCellPx, LIMITS.maxCellPx),
    },
    rooms: parseRooms(raw.rooms),
    openings: parseOpenings(raw.openings),
  };
}

// Damaged rooms, doors and windows are skipped so the rest of the map still opens.

function parseRooms(raw: unknown): Room[] {
  if (!Array.isArray(raw)) return [];
  const rooms: Room[] = [];
  for (const item of raw.slice(0, LIMITS.maxRooms)) {
    if (!isRecord(item) || typeof item.id !== "string" || !Array.isArray(item.points)) continue;
    const points = item.points.slice(0, LIMITS.maxRoomPoints).map(parsePoint);
    if (points.includes(null) || !isValidOutline(points as Point[])) continue;
    const floor = FLOORS.some((f) => f.id === item.floor) ? (item.floor as FloorId) : "stone";
    rooms.push({ id: item.id, points: points as Point[], floor });
  }
  return rooms;
}

function parseOpenings(raw: unknown): Opening[] {
  if (!Array.isArray(raw)) return [];
  const openings: Opening[] = [];
  for (const item of raw.slice(0, LIMITS.maxOpenings)) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const a = parsePoint(item.a);
    const b = parsePoint(item.b);
    if (!a || !b || (item.kind !== "door" && item.kind !== "window")) continue;
    openings.push({ id: item.id, kind: item.kind, a, b });
  }
  return openings;
}

function parsePoint(raw: unknown): Point | null {
  if (!isRecord(raw) || typeof raw.x !== "number" || typeof raw.y !== "number") return null;
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
  return { x: raw.x, y: raw.y };
}

/** A safe file name for a map, e.g. "Goblin Cave" -> "Goblin Cave.scenic.json". */
export function fileName(doc: MapDoc): string {
  const base = doc.name.replace(/[\\/:*?"<>|]/g, "").trim() || "map";
  return base + FILE_EXTENSION;
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

/** Returns false when the browser refuses (private window, storage full). */
export function saveAutosave(store: KeyValueStore, doc: MapDoc): boolean {
  try {
    store.setItem(AUTOSAVE_KEY, serialize(doc));
    return true;
  } catch {
    return false;
  }
}

export function loadAutosave(store: KeyValueStore): MapDoc | null {
  try {
    const text = store.getItem(AUTOSAVE_KEY);
    return text ? parse(text) : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
