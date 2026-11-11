// Which parts of the map a light can reach. Walls stop light; windows let it through.
// Pure geometry: the renderer turns these shapes into the lit and dark areas.

import type { Light, MapDoc, Point } from "./model";
import { closestOnSegment, distance, walledRooms } from "./rooms";

export interface Segment {
  a: Point;
  b: Point;
}

/** A light closer than this to a wall counts as sitting on it, and is not stopped by that wall. */
const ON_WALL = 1.5;

/**
 * The pieces of wall that stop light: every edge of every room with walls, except where a window is.
 * Doors stop light too (they are shown closed), and rooms without walls stop nothing.
 */
export function blockingSegments(doc: MapDoc): Segment[] {
  const windows = doc.openings.filter((o) => o.kind === "window");
  const tolerance = Math.max(0.5, doc.grid.cellPx * 0.12);
  const segments: Segment[] = [];
  for (const room of walledRooms(doc.rooms)) {
    for (let i = 0; i < room.points.length; i++) {
      const a = room.points[i];
      const b = room.points[(i + 1) % room.points.length];
      const length = distance(a, b);
      if (length === 0) continue;

      const gaps: [number, number][] = [];
      let open = false;
      for (const w of windows) {
        const ha = closestOnSegment(w.a, a, b);
        const hb = closestOnSegment(w.b, a, b);
        if (ha.dist <= tolerance && hb.dist <= tolerance) {
          gaps.push([Math.min(ha.along, hb.along), Math.max(ha.along, hb.along)]);
        } else {
          // A window on a curved wall runs over several short edges, so a short edge lying along it is open.
          const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (length <= distance(w.a, w.b) && closestOnSegment(middle, w.a, w.b).dist <= tolerance) open = true;
        }
      }
      if (open) continue;

      const ux = (b.x - a.x) / length;
      const uy = (b.y - a.y) / length;
      const at = (d: number): Point => ({ x: a.x + ux * d, y: a.y + uy * d });
      const keep = (from: number, to: number) => {
        if (to - from > 0.5) segments.push({ a: at(from), b: at(to) });
      };
      let walked = 0;
      for (const [from, to] of gaps.sort((p, q) => p[0] - q[0])) {
        keep(walked, from);
        walked = Math.max(walked, to);
      }
      keep(walked, length);
    }
  }
  return segments;
}

/** How far along a ray from `origin` in direction (dx, dy) the first of the segments is hit, or Infinity. */
function rayHit(origin: Point, dx: number, dy: number, segments: Segment[]): number {
  let nearest = Infinity;
  for (const { a, b } of segments) {
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((a.x - origin.x) * sy - (a.y - origin.y) * sx) / denom;
    const u = ((a.x - origin.x) * dy - (a.y - origin.y) * dx) / denom;
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < nearest) nearest = t;
  }
  return nearest;
}

/** The part of a segment inside a box, or null when none of it is. (Liang-Barsky clipping.) */
function clipToBox(s: Segment, x0: number, y0: number, x1: number, y1: number): Segment | null {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [s.a.x - x0, x1 - s.a.x, s.a.y - y0, y1 - s.a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return null;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return null;
      t1 = Math.min(t1, r);
    }
  }
  return { a: { x: s.a.x + t0 * dx, y: s.a.y + t0 * dy }, b: { x: s.a.x + t1 * dx, y: s.a.y + t1 * dy } };
}

/**
 * The area a light at `origin` can see, out to a square of half-width `radius`: the outline of
 * everything not hidden behind a wall. The light itself fades out within `radius`; this only says where walls cut it.
 */
export function visibilityPolygon(origin: Point, radius: number, segments: Segment[]): Point[] {
  const { x, y } = origin;
  const corners = [
    { x: x - radius, y: y - radius },
    { x: x + radius, y: y - radius },
    { x: x + radius, y: y + radius },
    { x: x - radius, y: y + radius },
  ];
  const limits: Segment[] = corners.map((c, i) => ({ a: c, b: corners[(i + 1) % 4] }));
  // Walls are trimmed to the box, so a wall that crosses its edge gets a corner exactly there.
  const near = segments
    .filter((s) => {
      const dist = closestOnSegment(origin, s.a, s.b).dist;
      return dist >= ON_WALL && dist <= radius * Math.SQRT2;
    })
    .map((s) => clipToBox(s, x - radius, y - radius, x + radius, y + radius))
    .filter((s): s is Segment => s !== null);
  const all = [...near, ...limits];

  const angles: number[] = [];
  for (const { a, b } of all) {
    for (const p of [a, b]) {
      const base = Math.atan2(p.y - y, p.x - x);
      angles.push(base - 1e-4, base, base + 1e-4);
    }
  }
  angles.sort((p, q) => p - q);

  const points: Point[] = [];
  for (const angle of angles) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const t = rayHit(origin, dx, dy, all);
    if (Number.isFinite(t)) points.push({ x: x + dx * t, y: y + dy * t });
  }
  return points;
}

/**
 * Remembers each light's visible area, so moving the pointer or panning does not recompute it.
 * It starts over whenever the walls or windows change.
 */
export class LightCache {
  private rooms: unknown = null;
  private openings: unknown = null;
  private segments: Segment[] = [];
  private shapes = new Map<string, Point[]>();

  /** The area the light can see. The same array comes back until the light or the walls change. */
  polygonFor(doc: MapDoc, light: Light): Point[] {
    if (doc.rooms !== this.rooms || doc.openings !== this.openings) {
      this.rooms = doc.rooms;
      this.openings = doc.openings;
      this.segments = blockingSegments(doc);
      this.shapes.clear();
    }
    const key = `${light.x},${light.y},${light.radius}`;
    let shape = this.shapes.get(key);
    if (!shape) {
      shape = visibilityPolygon(light, light.radius, this.segments);
      this.shapes.set(key, shape);
    }
    return shape;
  }
}
