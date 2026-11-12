// Rooms, walls, doors and windows. Pure geometry and pure edits: every edit returns a new MapDoc.

import type { FloorId, Grid, MapDoc, Opening, OpeningKind, Point, Rect, Room, SnapMode } from "./model";

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

function nearOutline(room: Room, p: Point): boolean {
  for (let i = 0; i < room.points.length; i++) {
    const a = room.points[i];
    const b = room.points[(i + 1) % room.points.length];
    if (closestOnSegment(p, a, b).dist <= ON_WALL_EPSILON) return true;
  }
  return false;
}

/** A door or window is on a room when both its ends sit on the room's outline. */
export function isOnRoom(room: Room, o: Opening): boolean {
  return nearOutline(room, o.a) && nearOutline(room, o.b);
}

/** The rooms that have walls. Doors and windows can only sit on these. */
export function walledRooms(rooms: Room[]): Room[] {
  return rooms.filter((room) => room.walls);
}

/** Drop doors and windows that are no longer on any wall. */
export function pruneOpenings(doc: MapDoc): MapDoc {
  const walled = walledRooms(doc.rooms);
  const openings = doc.openings.filter((o) => walled.some((room) => isOnRoom(room, o)));
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
  const rooms = doc.rooms.map((r) =>
    r === room
      ? { ...r, points: r.points.map(shift), ...(r.ellipse ? { ellipse: shiftRect(r.ellipse, dx, dy) } : {}) }
      : r,
  );
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

/** Turn a room's walls on or off. Turning them off removes the doors and windows left without a wall. */
export function setRoomWalls(doc: MapDoc, roomId: string, walls: boolean): MapDoc {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (!room || room.walls === walls) return doc;
  return pruneOpenings({ ...doc, rooms: doc.rooms.map((r) => (r === room ? { ...r, walls } : r)) });
}

function midpoint(o: Opening): Point {
  return { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
}

function shiftRect(r: Rect, dx: number, dy: number): Rect {
  return { x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy };
}

// ---- circles, ovals and triangles -------------------------------------

/** How many points make up a circle or oval outline. Divisible by 4, so the four extremes are points. */
export const ELLIPSE_SEGMENTS = 48;
/** The smallest a room may be made by stretching it, in map pixels. */
const MIN_ROOM_SIZE = 10;

/** The outline of the oval that fits inside a box, starting at the top and going clockwise. */
export function ellipsePoints(r: Rect): Point[] {
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const rx = (r.x1 - r.x0) / 2;
  const ry = (r.y1 - r.y0) / 2;
  const points: Point[] = [];
  for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / ELLIPSE_SEGMENTS;
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return points;
}

export function isValidRect(r: Rect): boolean {
  return [r.x0, r.y0, r.x1, r.y1].every(Number.isFinite) && r.x1 - r.x0 >= 1 && r.y1 - r.y0 >= 1;
}

export type DraftShape = "rect" | "circle" | "triangle";
export interface Outline {
  points: Point[];
  ellipse?: Rect;
}

/**
 * The outline a drag makes, from where it started (a) to where it is now (b).
 *   rect:     a and b are opposite corners.
 *   circle:   a is the centre and b is a point on the edge.
 *   triangle: an equilateral triangle whose base runs from a, as wide as the drag. Dragging up points it up.
 */
export function draftOutline(shape: DraftShape, a: Point, b: Point): Outline | null {
  if (shape === "rect") {
    const points = rectPoints(a, b);
    return points ? { points } : null;
  }
  if (shape === "circle") {
    const r = distance(a, b);
    const ellipse = { x0: a.x - r, y0: a.y - r, x1: a.x + r, y1: a.y + r };
    return isValidRect(ellipse) ? { points: ellipsePoints(ellipse), ellipse } : null;
  }
  const width = Math.abs(b.x - a.x);
  if (width < 1) return null;
  const left = Math.min(a.x, b.x);
  const rise = (width * Math.sqrt(3)) / 2 * (b.y < a.y ? -1 : 1);
  return {
    points: [
      { x: left, y: a.y },
      { x: left + width, y: a.y },
      { x: left + width / 2, y: a.y + rise },
    ],
  };
}

// ---- reshaping and stretching -----------------------------------------

/** Distance (screen pixels) that the square stretch handles sit outside a room's bounding box. */
export const HANDLE_PAD_PX = 12;

export function boundsOf(points: Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** The round reshape handles: the corners of a polygon room. A circle or oval has none; it is stretched instead. */
export function vertexHandles(room: Room): Point[] {
  return room.ellipse ? [] : room.points;
}

/** Which way each stretch handle pulls: -1 is the low side, 1 the high side, 0 leaves that direction alone. */
export const SCALE_DIRECTIONS = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
] as const;

/** The eight square stretch handles, on a box `pad` map pixels outside the room's bounding box. */
export function scaleHandles(room: Room, pad: number): { index: number; p: Point }[] {
  const b = room.ellipse ?? boundsOf(room.points);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return SCALE_DIRECTIONS.map(([hx, hy], index) => ({
    index,
    p: {
      x: hx < 0 ? b.x0 - pad : hx > 0 ? b.x1 + pad : cx,
      y: hy < 0 ? b.y0 - pad : hy > 0 ? b.y1 + pad : cy,
    },
  }));
}

/** Drag one corner of a polygon room somewhere else. Null when that would spoil the shape. */
export function moveVertex(room: Room, index: number, to: Point): Room | null {
  if (room.ellipse || index < 0 || index >= room.points.length) return null;
  const points = room.points.map((p, i) => (i === index ? to : p));
  return isValidOutline(points) ? { ...room, points } : null;
}

/** Add a corner on an edge, after corner `edge`. Only polygon rooms can gain corners. */
export function insertVertex(room: Room, edge: number, p: Point, maxPoints = 500): Room | null {
  if (room.ellipse || edge < 0 || edge >= room.points.length || room.points.length >= maxPoints) return null;
  const points = [...room.points.slice(0, edge + 1), p, ...room.points.slice(edge + 1)];
  return { ...room, points };
}

/** Take a corner away. A room keeps at least three. */
export function removeVertex(room: Room, index: number): Room | null {
  if (room.ellipse || room.points.length <= 3 || index < 0 || index >= room.points.length) return null;
  const points = room.points.filter((_, i) => i !== index);
  return isValidOutline(points) ? { ...room, points } : null;
}

/** The edge of a room nearest p, within maxDist: the corner it starts at, and the closest point on it. */
export function edgeAt(room: Room, p: Point, maxDist: number): { index: number; point: Point } | null {
  let best: { index: number; point: Point; dist: number } | null = null;
  for (let i = 0; i < room.points.length; i++) {
    const hit = closestOnSegment(p, room.points[i], room.points[(i + 1) % room.points.length]);
    if (hit.dist <= maxDist && (!best || hit.dist < best.dist)) best = { index: i, point: hit.point, dist: hit.dist };
  }
  return best && { index: best.index, point: best.point };
}

/** Swap in a changed room. Doors and windows that no longer sit on a wall are dropped. */
export function replaceRoom(doc: MapDoc, room: Room): MapDoc {
  if (!doc.rooms.some((r) => r.id === room.id)) return doc;
  return pruneOpenings({ ...doc, rooms: doc.rooms.map((r) => (r.id === room.id ? room : r)) });
}

/**
 * Stretch a room by dragging one of its eight square handles to `to` (the handle's own position, not the padded one).
 * Corner handles stretch both ways; with keepRatio the shape keeps its proportions. Edge handles stretch one way.
 * The room's doors and windows are stretched with it. Null when nothing would change or the room would get too small.
 */
export function scaleRoom(doc: MapDoc, roomId: string, handle: number, to: Point, keepRatio: boolean): MapDoc | null {
  const room = doc.rooms.find((r) => r.id === roomId);
  const direction = SCALE_DIRECTIONS[handle];
  if (!room || !direction) return null;
  const [hx, hy] = direction;
  const b = room.ellipse ?? boundsOf(room.points);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  if (w <= 0 || h <= 0) return null;

  let x0 = hx < 0 ? Math.min(to.x, b.x1 - MIN_ROOM_SIZE) : b.x0;
  let x1 = hx > 0 ? Math.max(to.x, b.x0 + MIN_ROOM_SIZE) : b.x1;
  let y0 = hy < 0 ? Math.min(to.y, b.y1 - MIN_ROOM_SIZE) : b.y0;
  let y1 = hy > 0 ? Math.max(to.y, b.y0 + MIN_ROOM_SIZE) : b.y1;
  if (keepRatio && hx !== 0 && hy !== 0) {
    const factor = Math.max((x1 - x0) / w, (y1 - y0) / h);
    if (hx < 0) x0 = b.x1 - w * factor;
    else x1 = b.x0 + w * factor;
    if (hy < 0) y0 = b.y1 - h * factor;
    else y1 = b.y0 + h * factor;
  }
  const next: Rect = { x0, y0, x1, y1 };
  if (next.x0 === b.x0 && next.x1 === b.x1 && next.y0 === b.y0 && next.y1 === b.y1) return null;

  const sx = (x1 - x0) / w;
  const sy = (y1 - y0) / h;
  const map = (p: Point): Point => ({ x: x0 + (p.x - b.x0) * sx, y: y0 + (p.y - b.y0) * sy });
  const stretched: Room = room.ellipse
    ? { ...room, ellipse: next, points: ellipsePoints(next) }
    : { ...room, points: room.points.map(map) };
  const rooms = doc.rooms.map((r) => (r === room ? stretched : r));
  const openings = doc.openings.map((o) => (isOnRoom(room, o) ? { ...o, a: map(o.a), b: map(o.b) } : o));
  return { ...doc, rooms, openings };
}

// ---- doors and windows on curved walls ---------------------------------

function perimeterLength(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += distance(points[i], points[(i + 1) % points.length]);
  return total;
}

/** The point `s` along a closed outline, going round from its first point. `s` may be negative or past the end. */
export function pointAtPerimeter(points: Point[], s: number): Point {
  const total = perimeterLength(points);
  let rest = ((s % total) + total) % total;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = distance(a, b);
    if (rest <= length) {
      const t = length === 0 ? 0 : rest / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    rest -= length;
  }
  return points[0];
}

/** How far round a closed outline the point nearest p is. */
export function perimeterPosition(points: Point[], p: Point): number {
  let best = { dist: Infinity, s: 0 };
  let walked = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const hit = closestOnSegment(p, a, b);
    if (hit.dist < best.dist) best = { dist: hit.dist, s: walked + hit.along };
    walked += distance(a, b);
  }
  return best.s;
}

/**
 * A door or window on a curved wall. A curve is made of many short edges, so it runs round them:
 * the door is a straight piece between two points on the wall, up to one cell wide.
 */
export function openingOnCurve(grid: Grid, room: Room, p: Point, kind: OpeningKind, id: string): Opening {
  const total = perimeterLength(room.points);
  const width = Math.min(grid.cellPx, total / 4);
  const centre = perimeterPosition(room.points, p);
  return {
    id,
    kind,
    a: pointAtPerimeter(room.points, centre - width / 2),
    b: pointAtPerimeter(room.points, centre + width / 2),
  };
}
