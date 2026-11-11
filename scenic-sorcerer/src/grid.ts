// Grid geometry for square and hex maps. All functions are pure.
//
// Hex layout is "offset" style, the one Foundry and Roll20 use:
//   hex-pointy: rows are straight, odd rows are shifted right by half a cell.
//   hex-flat:   columns are straight, odd columns are shifted down by half a cell.
// cellPx is the distance between neighbouring centres, i.e. the hex measured flat side to flat side.

import type { Grid, SnapMode } from "./model";

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Cell {
  col: number;
  row: number;
}

const SQRT3 = Math.sqrt(3);

/** Centre-to-corner distance of a hex whose flat-to-flat size is cellPx. */
export function hexRadius(cellPx: number): number {
  return cellPx / SQRT3;
}

export function mapSize(g: Grid): Size {
  const d = g.cellPx;
  const r = hexRadius(d);
  switch (g.type) {
    case "square":
      return { width: g.cols * d, height: g.rows * d };
    case "hex-pointy":
      return { width: g.cols * d + (g.rows > 1 ? d / 2 : 0), height: 1.5 * r * (g.rows - 1) + 2 * r };
    case "hex-flat":
      return { width: 1.5 * r * (g.cols - 1) + 2 * r, height: g.rows * d + (g.cols > 1 ? d / 2 : 0) };
  }
}

export function cellCenter(g: Grid, col: number, row: number): Point {
  const d = g.cellPx;
  const r = hexRadius(d);
  switch (g.type) {
    case "square":
      return { x: (col + 0.5) * d, y: (row + 0.5) * d };
    case "hex-pointy":
      return { x: d / 2 + col * d + (isOdd(row) ? d / 2 : 0), y: r + row * 1.5 * r };
    case "hex-flat":
      return { x: r + col * 1.5 * r, y: d / 2 + row * d + (isOdd(col) ? d / 2 : 0) };
  }
}

/** Corner points of a cell, in drawing order. */
export function cellPolygon(g: Grid, col: number, row: number): Point[] {
  const c = cellCenter(g, col, row);
  if (g.type === "square") {
    const h = g.cellPx / 2;
    return [
      { x: c.x - h, y: c.y - h },
      { x: c.x + h, y: c.y - h },
      { x: c.x + h, y: c.y + h },
      { x: c.x - h, y: c.y + h },
    ];
  }
  const r = hexRadius(g.cellPx);
  const start = g.type === "hex-pointy" ? -Math.PI / 2 : 0;
  const points: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const a = start + (i * Math.PI) / 3;
    points.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return points;
}

/** The cell under a point, ignoring the map's edges (col/row may be negative or past the end). */
export function nearestCell(g: Grid, p: Point): Cell {
  const d = g.cellPx;
  if (g.type === "square") {
    return { col: Math.floor(p.x / d), row: Math.floor(p.y / d) };
  }
  // A hex is exactly the set of points closest to its centre, so check the few candidate centres.
  const r = hexRadius(d);
  const pointy = g.type === "hex-pointy";
  const along = pointy ? p.x : p.y; // axis where cells sit d apart
  const across = pointy ? p.y : p.x; // axis where lines sit 1.5 r apart
  const lineGuess = Math.round((across - r) / (1.5 * r));
  let best: Cell = { col: 0, row: 0 };
  let bestDist = Infinity;
  for (let line = lineGuess - 1; line <= lineGuess + 1; line++) {
    const shift = isOdd(line) ? d / 2 : 0;
    const indexGuess = Math.round((along - d / 2 - shift) / d);
    for (let index = indexGuess - 1; index <= indexGuess + 1; index++) {
      const cell = pointy ? { col: index, row: line } : { col: line, row: index };
      const c = cellCenter(g, cell.col, cell.row);
      const dist = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = cell;
      }
    }
  }
  return best;
}

/** The cell under a point, or null when the point is off the map. */
export function cellAt(g: Grid, p: Point): Cell | null {
  const cell = nearestCell(g, p);
  const inside = cell.col >= 0 && cell.col < g.cols && cell.row >= 0 && cell.row < g.rows;
  return inside ? cell : null;
}

/**
 * Snap a point to the grid.
 *   square: "cell" = grid corners, "half" = corners, edge midpoints and cell centres.
 *   hex:    "cell" = cell centres, "half" = cell centres and corners.
 */
export function snap(g: Grid, p: Point, mode: SnapMode): Point {
  if (mode === "off") return p;
  if (g.type === "square") {
    const step = mode === "cell" ? g.cellPx : g.cellPx / 2;
    return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
  }
  const cell = nearestCell(g, p);
  const center = cellCenter(g, cell.col, cell.row);
  if (mode === "cell") return center;
  let best = center;
  let bestDist = (center.x - p.x) ** 2 + (center.y - p.y) ** 2;
  for (const corner of cellPolygon(g, cell.col, cell.row)) {
    const dist = (corner.x - p.x) ** 2 + (corner.y - p.y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = corner;
    }
  }
  return best;
}

function isOdd(n: number): boolean {
  return (n & 1) === 1;
}
