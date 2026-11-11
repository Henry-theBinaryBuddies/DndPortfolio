// The map document: everything that is saved, loaded and undone.

export type GridType = "square" | "hex-flat" | "hex-pointy";
export type SnapMode = "cell" | "half" | "off";

export interface Point {
  x: number;
  y: number;
}

export interface Grid {
  type: GridType;
  cols: number;
  rows: number;
  /** Distance in map pixels between the centres of two neighbouring cells. */
  cellPx: number;
}

export const FLOORS = [
  { id: "stone", label: "Stone", color: "#8d8a84" },
  { id: "wood", label: "Wood", color: "#9a6b3f" },
  { id: "dirt", label: "Dirt", color: "#8a6b4a" },
  { id: "grass", label: "Grass", color: "#6f9a4d" },
  { id: "water", label: "Water", color: "#5b9bc4" },
  { id: "plain", label: "Plain", color: "#e2d6ba" },
] as const;
export type FloorId = (typeof FLOORS)[number]["id"];

/** A room is a closed outline in map pixels. With walls on, every edge of the outline is a wall. */
export interface Room {
  id: string;
  points: Point[];
  floor: FloorId;
  /** False for an open area such as a pond or a patch of grass: floor only, no outline, no doors. */
  walls: boolean;
}

export type OpeningKind = "door" | "window";

/** A door or window: a stretch of wall from a to b, in map pixels. */
export interface Opening {
  id: string;
  kind: OpeningKind;
  a: Point;
  b: Point;
}

export interface MapDoc {
  version: 1;
  name: string;
  grid: Grid;
  rooms: Room[];
  openings: Opening[];
}

export const LIMITS = {
  minCells: 1,
  maxCells: 100,
  minCellPx: 20,
  maxCellPx: 300,
  maxNameLength: 80,
  maxRooms: 5000,
  maxOpenings: 10000,
  maxRoomPoints: 500,
} as const;

/** Wall thickness as a fraction of a cell. */
export const WALL_RATIO = 0.16;

export function newMap(): MapDoc {
  return {
    version: 1,
    name: "Untitled map",
    grid: { type: "square", cols: 30, rows: 20, cellPx: 70 },
    rooms: [],
    openings: [],
  };
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
