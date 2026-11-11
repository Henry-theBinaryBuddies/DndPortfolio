// Saving and loading maps: a JSON file the user owns, plus an autosave copy in the browser.

import {
  FLOORS,
  LAYERS,
  LIMITS,
  clampInt,
  defaultLayers,
  FONTS,
  MARKER_KINDS,
  type Asset,
  type FloorId,
  type FontId,
  type GridType,
  type Label,
  type LevelContent,
  type LevelInfo,
  type Light,
  type LayerId,
  type LayerState,
  type MapDoc,
  type Marker,
  type MarkerKind,
  type Opening,
  type Point,
  type Rect,
  type Room,
  type Stamp,
  type Stroke,
} from "./model";
import { ellipsePoints, isValidOutline, isValidRect } from "./rooms";

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
    labels: parseLabels(raw.labels),
    markers: parseMarkers(raw.markers),
    lights: parseLights(raw.lights),
    ambient: typeof raw.ambient === "number" && Number.isFinite(raw.ambient) ? Math.min(0.95, Math.max(0, raw.ambient)) : 0.7,
    ...parseLevels(raw.levels, raw.level),
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
    const ellipse = parseRect(item.ellipse);
    // A circle or oval is rebuilt from its box, so its points can never disagree with it.
    const points = ellipse ? ellipsePoints(ellipse) : parsePoints(item.points, LIMITS.maxRoomPoints);
    if (!points || !isValidOutline(points)) continue;
    rooms.push({
      id: item.id,
      points,
      ...(ellipse ? { ellipse } : {}),
      floor: parseFloor(item.floor),
      walls: item.walls !== false,
    });
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

function parseLabels(raw: unknown): Label[] {
  if (!Array.isArray(raw)) return [];
  const labels: Label[] = [];
  for (const item of raw.slice(0, LIMITS.maxLabels)) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.text !== "string") continue;
    const centre = parsePoint(item);
    if (!centre || !isPositive(item.size)) continue;
    labels.push({
      id: item.id,
      text: item.text.slice(0, LIMITS.maxLabelText),
      x: centre.x,
      y: centre.y,
      rotation: typeof item.rotation === "number" && Number.isFinite(item.rotation) ? item.rotation : 0,
      font: FONTS.some((f) => f.id === item.font) ? (item.font as FontId) : "classic",
      size: item.size,
      color: typeof item.color === "string" && TINT.test(item.color) ? item.color : "#2b2620",
      outline: item.outline !== false,
      italic: item.italic === true,
      spacing: typeof item.spacing === "number" && item.spacing >= 0 && item.spacing <= 1 ? item.spacing : 0,
    });
  }
  return labels;
}

function parseMarkers(raw: unknown): Marker[] {
  if (!Array.isArray(raw)) return [];
  const markers: Marker[] = [];
  for (const item of raw.slice(0, LIMITS.maxMarkers)) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const centre = parsePoint(item);
    if (!centre || !MARKER_KINDS.some((k) => k.id === item.kind)) continue;
    const kind = item.kind as MarkerKind;
    const number = typeof item.number === "number" && Number.isInteger(item.number) ? Math.min(999, Math.max(0, item.number)) : 0;
    markers.push({
      id: item.id,
      kind,
      x: centre.x,
      y: centre.y,
      number: kind === "key" ? number : 0,
      text: typeof item.text === "string" ? item.text.slice(0, LIMITS.maxMarkerText) : "",
    });
  }
  return markers;
}

function parseLights(raw: unknown): Light[] {
  if (!Array.isArray(raw)) return [];
  const lights: Light[] = [];
  for (const item of raw.slice(0, LIMITS.maxLights)) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const centre = parsePoint(item);
    if (!centre || !isPositive(item.radius)) continue;
    lights.push({
      id: item.id,
      x: centre.x,
      y: centre.y,
      radius: Math.min(5000, item.radius),
      color: typeof item.color === "string" && TINT.test(item.color) ? item.color : "#ffb454",
    });
  }
  return lights;
}

function parseContent(raw: Record<string, unknown>): LevelContent {
  return {
    rooms: parseRooms(raw.rooms),
    openings: parseOpenings(raw.openings),
    strokes: parseStrokes(raw.strokes),
    stamps: parseStamps(raw.stamps),
    labels: parseLabels(raw.labels),
    markers: parseMarkers(raw.markers),
    lights: parseLights(raw.lights),
  };
}

/** The list of levels, and which one the map's own lists belong to. A map without levels has one. */
function parseLevels(raw: unknown, rawLevel: unknown): { levels: LevelInfo[]; level: number } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { levels: [{ id: "level-1", name: "Level 1", content: null }], level: 0 };
  }
  const items = raw.slice(0, LIMITS.maxLevels);
  const level = typeof rawLevel === "number" && Number.isInteger(rawLevel) && rawLevel >= 0 && rawLevel < items.length ? rawLevel : 0;
  const levels = items.map((item, i): LevelInfo => {
    const entry = isRecord(item) ? item : {};
    const id = typeof entry.id === "string" && entry.id ? entry.id.slice(0, 64) : `level-${i + 1}`;
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, LIMITS.maxLevelName) : `Level ${i + 1}`;
    return { id, name, content: i === level ? null : parseContent(isRecord(entry.content) ? entry.content : {}) };
  });
  return { levels, level };
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

function parseRect(raw: unknown): Rect | null {
  if (!isRecord(raw)) return null;
  const rect = { x0: Number(raw.x0), y0: Number(raw.y0), x1: Number(raw.x1), y1: Number(raw.y1) };
  return isValidRect(rect) ? rect : null;
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
