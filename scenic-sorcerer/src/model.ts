// The map document: everything that is saved, loaded and undone.

export type GridType = "square" | "hex-flat" | "hex-pointy";
export type SnapMode = "cell" | "half" | "off";

export interface Grid {
  type: GridType;
  cols: number;
  rows: number;
  /** Distance in map pixels between the centres of two neighbouring cells. */
  cellPx: number;
}

export interface MapDoc {
  version: 1;
  name: string;
  grid: Grid;
}

export const LIMITS = {
  minCells: 1,
  maxCells: 100,
  minCellPx: 20,
  maxCellPx: 300,
  maxNameLength: 80,
} as const;

export function newMap(): MapDoc {
  return {
    version: 1,
    name: "Untitled map",
    grid: { type: "square", cols: 30, rows: 20, cellPx: 70 },
  };
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
