// What leaves the editor: picture sizes, and the files that carry walls, doors and lights to a virtual tabletop.
// Pure functions; the picture itself is drawn elsewhere.

import { mapSize } from "./grid";
import { wallPieces, type Segment } from "./lighting";
import type { GridType, MapDoc, Point } from "./model";

/** The longest side a picture may have, in pixels. Bigger than this and many browsers cannot make it. */
export const MAX_EXPORT_SIDE = 8192;
export const MIN_PIXELS_PER_CELL = 20;

/** Distance of one grid cell in the tabletop, for lights. Five feet is the usual for tabletop games. */
const FEET_PER_CELL = 5;

/** The size of a picture of the map with each cell `ppc` pixels across. Hex maps are not whole cells, so round up. */
export function imageSize(doc: MapDoc, ppc: number): { width: number; height: number } {
  const size = mapSize(doc.grid);
  const factor = ppc / doc.grid.cellPx;
  return { width: Math.ceil(size.width * factor - 1e-6), height: Math.ceil(size.height * factor - 1e-6) };
}

/** The most pixels per cell that keep the picture within the size limit. */
export function maxPixelsPerCell(doc: MapDoc): number {
  const size = mapSize(doc.grid);
  const longest = Math.max(size.width, size.height) / doc.grid.cellPx; // in cells
  return Math.max(MIN_PIXELS_PER_CELL, Math.floor(MAX_EXPORT_SIDE / longest));
}

/** Keep a pixels-per-cell choice within what is allowed. */
export function clampPixelsPerCell(doc: MapDoc, ppc: number): number {
  if (!Number.isFinite(ppc)) return Math.min(doc.grid.cellPx, maxPixelsPerCell(doc));
  return Math.min(maxPixelsPerCell(doc), Math.max(MIN_PIXELS_PER_CELL, Math.round(ppc)));
}

/** A file name from a map or level name, without characters a computer will not accept. */
export function safeFileBase(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "map";
}

// ---- walls as lines ---------------------------------------------------

/** Join pieces of wall that meet end to end into longer lines. */
export function joinSegments(segments: Segment[], tolerance = 0.5): Point[][] {
  const same = (p: Point, q: Point) => Math.abs(p.x - q.x) <= tolerance && Math.abs(p.y - q.y) <= tolerance;
  const rest = [...segments];
  const lines: Point[][] = [];
  while (rest.length > 0) {
    const first = rest.pop()!;
    const line = [first.a, first.b];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < rest.length; i++) {
        const { a, b } = rest[i];
        const head = line[0];
        const tail = line[line.length - 1];
        if (same(a, tail)) line.push(b);
        else if (same(b, tail)) line.push(a);
        else if (same(b, head)) line.unshift(a);
        else if (same(a, head)) line.unshift(b);
        else continue;
        rest.splice(i, 1);
        grew = true;
        break;
      }
    }
    lines.push(line);
  }
  return lines;
}

// ---- Universal VTT ----------------------------------------------------

/** The Universal VTT file: one picture plus walls, doors and lights, read by Foundry, Fantasy Grounds, Owlbear and others. */
export interface UniversalVtt {
  format: number;
  resolution: { map_origin: Point; map_size: Point; pixels_per_grid: number };
  line_of_sight: Point[][];
  objects_line_of_sight: Point[][];
  portals: { position: Point; bounds: Point[]; rotation: number; closed: boolean; freestanding: boolean }[];
  environment: { baked_lighting: boolean; ambient_light: string };
  lights: { position: Point; range: number; intensity: number; color: string; shadows: boolean }[];
  image: string;
}

/** A colour as the Universal VTT writes it: alpha first, then red, green, blue. */
function argb(hex: string): string {
  return `ff${hex.replace("#", "").toLowerCase()}`;
}

/**
 * Walls, doors and lights are given in grid cells, not pixels. Walls are cut open at doors and windows, so
 * sight and light pass; each door is a portal the tabletop can open. `imageBase64` is the picture, without a data prefix.
 */
export function universalVtt(doc: MapDoc, ppc: number, imageBase64: string): UniversalVtt {
  const cell = doc.grid.cellPx;
  const toCells = (p: Point): Point => ({ x: p.x / cell, y: p.y / cell });
  const size = imageSize(doc, ppc);
  const doors = doc.openings.filter((o) => o.kind === "door");
  const light = Math.round(255 * (1 - doc.ambient))
    .toString(16)
    .padStart(2, "0");
  return {
    format: 0.3,
    resolution: {
      map_origin: { x: 0, y: 0 },
      map_size: { x: size.width / ppc, y: size.height / ppc },
      pixels_per_grid: ppc,
    },
    line_of_sight: joinSegments(wallPieces(doc, ["door", "window"])).map((line) => line.map(toCells)),
    objects_line_of_sight: [],
    portals: doors.map((d) => ({
      position: toCells({ x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 }),
      bounds: [toCells(d.a), toCells(d.b)],
      rotation: Math.atan2(d.b.y - d.a.y, d.b.x - d.a.x),
      closed: true,
      freestanding: false,
    })),
    environment: { baked_lighting: false, ambient_light: `ff${light}${light}${light}` },
    lights: doc.lights.map((l) => ({
      position: toCells(l),
      range: l.radius / cell,
      intensity: 1,
      color: argb(l.color),
      shadows: true,
    })),
    image: imageBase64,
  };
}

// ---- Foundry ----------------------------------------------------------

/** Foundry's numbers for grids. Our pointy hexes shift odd rows, and our flat hexes shift odd columns, which Foundry calls odd-r and odd-q. */
const FOUNDRY_GRID: Record<GridType, number> = { square: 1, "hex-pointy": 2, "hex-flat": 4 };

/**
 * A Foundry scene that matches the picture: its grid, walls, doors, windows and lights, in pixels of the picture.
 * `imageName` is the file name the scene will look for; it has to be uploaded to Foundry and the path adjusted.
 */
export function foundryScene(doc: MapDoc, ppc: number, imageName: string, name: string): Record<string, unknown> {
  const factor = ppc / doc.grid.cellPx;
  const size = imageSize(doc, ppc);
  const px = (v: number) => Math.round(v * factor * 100) / 100;
  const wall = (a: Point, b: Point, kind: "wall" | "door" | "window") => ({
    c: [px(a.x), px(a.y), px(b.x), px(b.y)],
    move: 20,
    sense: kind === "window" ? 10 : 20,
    light: kind === "window" ? 10 : 20,
    sight: kind === "window" ? 10 : 20,
    sound: 20,
    dir: 0,
    door: kind === "door" ? 1 : 0,
    ds: 0,
    flags: {},
  });
  const walls = [
    ...wallPieces(doc, ["door", "window"]).map((s) => wall(s.a, s.b, "wall")),
    ...doc.openings.map((o) => wall(o.a, o.b, o.kind)),
  ];
  const lights = doc.lights.map((l) => {
    const dim = (l.radius / doc.grid.cellPx) * FEET_PER_CELL;
    return {
      x: px(l.x),
      y: px(l.y),
      rotation: 0,
      walls: true,
      vision: false,
      hidden: false,
      config: { dim, bright: dim / 2, color: l.color, alpha: 0.5, angle: 360, animation: { type: null, speed: 5, intensity: 5 } },
      flags: {},
    };
  });
  return {
    name,
    active: false,
    navigation: true,
    width: size.width,
    height: size.height,
    padding: 0,
    shiftX: 0,
    shiftY: 0,
    background: { src: imageName },
    grid: { type: FOUNDRY_GRID[doc.grid.type], size: ppc, distance: FEET_PER_CELL, units: "ft", color: "#000000", alpha: 0.2 },
    tokenVision: true,
    fog: { exploration: true },
    darkness: doc.ambient,
    environment: { darknessLevel: doc.ambient },
    walls,
    lights,
    tokens: [],
    notes: [],
    flags: { "scenic-sorcerer": { levelName: name } },
  };
}
