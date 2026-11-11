// Rooms, walls, doors and windows. Pure geometry and pure edits: every edit returns a new MapDoc.

import type { FloorId, Grid, MapDoc, Opening, OpeningKind, Point, Room, SnapMode } from "./model";

/** How far (map pixels) a door may sit from a wall and still count as on it. */
const ON_WALL_EPSILON = 0.5;

// ---- geometry ---------------------------------------------------------

/** Corners of the rectangle between two opposite corners, or null when it has no area. */
export function rectPoints(a: Point, b: Point): Point[] | null {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  if (x0 === x1 || y0 === y1) return null;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function isValidOutline(points: Point[]): boolean {
  return points.length >= 3 && polygonArea(points) > 1;
}

export function pointInPolygon(p: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Closest point to p on the segment a-b, with its distance along the segment. */
export function closestOnSegment(p: Point, a: Point, b: Point): { point: Point; along: number; length: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { point: a, along: 0, length: 0, dist: distance(p, a) };
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length)));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, along: t * length, length, dist: distance(p, point) };
}

// ---- finding things under the cursor ----------------------------------

export interface WallHit {
  roomId: string;
  /** The wall runs from a to b. */
  a: Point;
  b: Point;
  /** Distance from a to the closest point on the wall. */
  along: number;
  length: number;
  dist: number;
}

/** The wall nearest to p within maxDist, or null. */
export function nearestWall(rooms: Room[], p: Point, maxDist: number): WallHit | null {
  let best: WallHit | null = null;
  for (const room of rooms) {
    for (let i = 0; i < room.points.length; i++) {
      const a = room.points[i];
      const b = room.points[(i + 1) % room.points.length];
      const hit = closestOnSegment(p, a, b);
      if (hit.dist <= maxDist && (!best || hit.dist < best.dist)) {
        best = { roomId: room.id, a, b, along: hit.along, length: hit.length, dist: hit.dist };
      }
    }
  }
  return best;
}

/** The topmost room under p (inside it, or within tolerance of its walls), or null. */
export function roomAt(rooms: Room[], p: Point, tolerance: number): Room | null {
  for (let i = rooms.length - 1; i >= 0; i--) {
    const room = rooms[i];
    if (pointInPolygon(p, room.points) || nearestWall([room], p, tolerance)) return room;
  }
  return null;
}

export function openingAt(openings: Opening[], p: Point, tolerance: number): Opening | null {
  for (let i = openings.length - 1; i >= 0; i--) {
    if (closestOnSegment(p, openings[i].a, openings[i].b).dist <= tolerance) return openings[i];
  }
  return null;
}

// ---- doors and windows -------------------------------------------------

/**
 * A door or window one cell wide on the wall that was hit.
 * With snap on it lines up with the grid: "cell" centres it in a cell, "half" allows half-cell steps.
 * It never hangs off the end of the wall; on a wall shorter than a cell it fills the wall.
 */
export function openingOnWall(grid: Grid, hit: WallHit, kind: OpeningKind, snapMode: SnapMode, id: string): Opening {
  const cell = grid.cellPx;
  const width = Math.min(cell, hit.length);
  let centre = hit.along;
  if (snapMode === "cell") centre = (Math.floor(centre / cell) + 0.5) * cell;
  else if (snapMode === "half") centre = Math.round(centre / (cell / 2)) * (cell / 2);
  centre = Math.min(hit.length - width / 2, Math.max(width / 2, centre));
  const ux = (hit.b.x - hit.a.x) / hit.length;
  const uy = (hit.b.y - hit.a.y) / hit.length;
  const at = (d: number): Point => ({ x: hit.a.x + ux * d, y: hit.a.y + uy * d });
  return { id, kind, a: at(centre - width / 2), b: at(centre + width / 2) };
}

function isOnRoom(room: Room, o: Opening): boolean {
  for (let i = 0; i < room.points.length; i++) {
    const a = room.points[i];
    const b = room.points[(i + 1) % room.points.length];
    if (closestOnSegment(o.a, a, b).dist <= ON_WALL_EPSILON && closestOnSegment(o.b, a, b).dist <= ON_WALL_EPSILON) return true;
  }
  return false;
}

/** Drop doors and windows that are no longer on any wall. */
export function pruneOpenings(doc: MapDoc): MapDoc {
  const openings = doc.openings.filter((o) => doc.rooms.some((room) => isOnRoom(room, o)));
  return openings.length === doc.openings.length ? doc : { ...doc, openings };
}

// ---- edits ------------------------------------------------------------

export function addRoom(doc: MapDoc, room: Room): MapDoc {
  return { ...doc, rooms: [...doc.rooms, room] };
}

/** Add a door or window. One already in the same spot is replaced, so a door can be swapped for a window. */
export function addOpening(doc: MapDoc, opening: Opening): MapDoc {
  const mid = midpoint(opening);
  const others = doc.openings.filter((o) => distance(midpoint(o), mid) > ON_WALL_EPSILON);
  return { ...doc, openings: [...others, opening] };
}

/** Move a room, taking the doors and windows on its walls with it. */
export function moveRoom(doc: MapDoc, roomId: string, dx: number, dy: number): MapDoc {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room || (dx === 0 && dy === 0)) return doc;
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const rooms = doc.rooms.map((r) => (r === room ? { ...r, points: r.points.map(shift) } : r));
  const openings = doc.openings.map((o) => (isOnRoom(room, o) ? { ...o, a: shift(o.a), b: shift(o.b) } : o));
  return { ...doc, rooms, openings };
}

/** Delete a room, door or window by id. Deleting a room also deletes the doors and windows left without a wall. */
export function removeItem(doc: MapDoc, id: string): MapDoc {
  if (doc.openings.some((o) => o.id === id)) return { ...doc, openings: doc.openings.filter((o) => o.id !== id) };
  if (doc.rooms.some((r) => r.id === id)) return pruneOpenings({ ...doc, rooms: doc.rooms.filter((r) => r.id !== id) });
  return doc;
}

export function setRoomFloor(doc: MapDoc, roomId: string, floor: FloorId): MapDoc {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room || room.floor === floor) return doc;
  return { ...doc, rooms: doc.rooms.map((r) => (r === room ? { ...r, floor } : r)) };
}

function midpoint(o: Opening): Point {
  return { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
}
