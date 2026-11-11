// Saving and loading maps: a JSON file the user owns, plus an autosave copy in the browser.

import {
  FLOORS,
  LAYERS,
  LIMITS,
  clampInt,
  defaultLayers,
  type Asset,
  type FloorId,
  type GridType,
  type LayerId,
  type LayerState,
  type MapDoc,
  type Opening,
  type Point,
  type Room,
  type Stamp,
  type Stroke,
} from "./model";
import { isValidOutline } from "./rooms";

export const FILE_EXTENSION = ".scenic.json";
export const AUTOSAVE_KEY = "scenic-sorcerer.autosave";
const APP_ID = "scenic-sorcerer";
const GRID_TYPES: GridType[] = ["square", "hex-flat", "hex-pointy"];
const TINT = /^#[0-9a-f]{6}$/i;
/** A data URL is about a third longer than the picture it holds. */
const MAX_DATA_URL = Math.ceil(LIMITS.maxAssetBytes * 1.4);

/**
 * The map as text. Pass the pictures its stamps use to make a file that opens on any computer;
 * leave them out for the autosave, where the pictures are already in the browser's library.
 */
export function serialize(doc: MapDoc, assets: Asset[] = []): string {
  const pictures = assets.map(({ id, name, dataUrl, width, height }) => ({ id, name, dataUrl, width, height }));
  return JSON.stringify({ app: APP_ID, ...doc, ...(pictures.length ? { assets: pictures } : {}) }, null, 2);
}

/** Read a saved map. Throws an Error with a message fit to show the user. */
export function parse(text: string): MapDoc {
  return parseFile(text).doc;
}

/** Read a saved map and the stamp pictures packed inside it. */
export function parseFile(text: string): { doc: MapDoc; assets: Asset[] } {
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
  const doc: MapDoc = {
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
    strokes: parseStrokes(raw.strokes),
    stamps: parseStamps(raw.stamps),
    layers: parseLayers(raw.layers),
    showGrid: raw.showGrid !== false,
  };
  return { doc, assets: parseAssets(raw.assets) };
}

// Damaged items are skipped so the rest of the map still opens.

function parseRooms(raw: unknown): Room[] {
  if (!Array.isArray(raw)) return [];
  const rooms: Room[] = [];
  for (const item of raw.slice(0, LIMITS.maxRooms)) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const points = parsePoints(item.points, LIMITS.maxRoomPoints);
    if (!points || !isValidOutline(points)) continue;
    rooms.push({ id: item.id, points, floor: parseFloor(item.floor), walls: item.walls !== false });
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

function parseStrokes(raw: unknown): Stroke[] {
  if (!Array.isArray(raw)) return [];
  const strokes: Stroke[] = [];
  for (const item of raw.slice(0, LIMITS.maxStrokes)) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const points = parsePoints(item.points, LIMITS.maxStrokePoints);
    if (!points || points.length === 0 || !isPositive(item.size)) continue;
    const opacity = isPositive(item.opacity) ? Math.min(1, item.opacity) : 1;
    strokes.push({ id: item.id, texture: parseFloor(item.texture), size: item.size, opacity, points });
  }
  return strokes;
}

function parseStamps(raw: unknown): Stamp[] {
  if (!Array.isArray(raw)) return [];
  const stamps: Stamp[] = [];
  for (const item of raw.slice(0, LIMITS.maxStamps)) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.assetId !== "string") continue;
    const centre = parsePoint(item);
    if (!centre || !isPositive(item.width) || !isPositive(item.height)) continue;
    stamps.push({
      id: item.id,
      assetId: item.assetId,
      x: centre.x,
      y: centre.y,
      width: item.width,
      height: item.height,
      rotation: typeof item.rotation === "number" && Number.isFinite(item.rotation) ? item.rotation : 0,
      flip: item.flip === true,
      tint: typeof item.tint === "string" && TINT.test(item.tint) ? item.tint : null,
      shadow: item.shadow === true,
    });
  }
  return stamps;
}

function parseLayers(raw: unknown): Record<LayerId, LayerState> {
  const layers = defaultLayers();
  if (!isRecord(raw)) return layers;
  for (const { id } of LAYERS) {
    const item = raw[id];
    if (isRecord(item)) layers[id] = { visible: item.visible !== false, locked: item.locked === true };
  }
  return layers;
}

function parseAssets(raw: unknown): Asset[] {
  if (!Array.isArray(raw)) return [];
  const assets: Asset[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length > 64) continue;
    if (typeof item.dataUrl !== "string" || !item.dataUrl.startsWith("data:image/")) continue;
    if (item.dataUrl.length > MAX_DATA_URL || !isPositive(item.width) || !isPositive(item.height)) continue;
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 60) : "Untitled";
    assets.push({ id: item.id, name, dataUrl: item.dataUrl, width: item.width, height: item.height, favourite: false });
  }
  return assets;
}

function parseFloor(raw: unknown): FloorId {
  return FLOORS.some((f) => f.id === raw) ? (raw as FloorId) : "stone";
}

function parsePoints(raw: unknown, max: number): Point[] | null {
  if (!Array.isArray(raw)) return null;
  const points = raw.slice(0, max).map(parsePoint);
  return points.includes(null) ? null : (points as Point[]);
}

function parsePoint(raw: unknown): Point | null {
  if (!isRecord(raw) || typeof raw.x !== "number" || typeof raw.y !== "number") return null;
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
  return { x: raw.x, y: raw.y };
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
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
