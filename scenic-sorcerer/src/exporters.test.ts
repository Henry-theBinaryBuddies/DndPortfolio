import { describe, expect, it } from "vitest";
import {
  MAX_EXPORT_SIDE,
  MIN_PIXELS_PER_CELL,
  clampPixelsPerCell,
  foundryScene,
  imageSize,
  joinSegments,
  maxPixelsPerCell,
  safeFileBase,
  universalVtt,
} from "./exporters";
import { cellCenter, cellPolygon } from "./grid";
import { wallPieces } from "./lighting";
import { newMap, type GridType, type MapDoc, type Opening, type Room } from "./model";
import { addLight, makeLight } from "./objects";
import { addOpening, addRoom, nearestWall, openingOnWall, rectPoints } from "./rooms";

const at = (x: number, y: number) => ({ x, y });
const room = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id,
  points: rectPoints(at(x0, y0), at(x1, y1))!,
  floor: "stone",
  walls: true,
});
const onWall = (doc: MapDoc, x: number, y: number, kind: "door" | "window", id: string): Opening => {
  const o = openingOnWall(doc.grid, nearestWall(doc.rooms, at(x, y), 10)!, kind, "off", id);
  return { ...o, kind };
};
const withGrid = (type: GridType, cols: number, rows: number, cellPx = 70): MapDoc => ({ ...newMap(), grid: { type, cols, rows, cellPx } });

/** A 4 x 2 cell room with a door in the top wall and a window in the bottom wall, one light inside. */
function sample(): MapDoc {
  let doc = addRoom(newMap(), room("r", 70, 70, 350, 210));
  doc = addOpening(doc, onWall(doc, 210, 71, "door", "d"));
  doc = addOpening(doc, onWall(doc, 140, 209, "window", "w"));
  return addLight({ ...doc, ambient: 0.5 }, makeLight("l", at(210, 140), 280, "#ffb454"));
}

describe("picture size", () => {
  it("is exact for a square grid", () => {
    expect(imageSize(withGrid("square", 30, 20), 70)).toEqual({ width: 2100, height: 1400 });
    expect(imageSize(withGrid("square", 30, 20), 100)).toEqual({ width: 3000, height: 2000 });
  });

  it("fits hex grids to the cell, so the grid lines up without nudging", () => {
    const pointy = imageSize(withGrid("hex-pointy", 10, 8), 100); // rows are shifted, so half a cell wider
    expect(pointy.width).toBe(1050);
    expect(pointy.height).toBe(Math.ceil(1.5 * (100 / Math.sqrt(3)) * 7 + 2 * (100 / Math.sqrt(3))));
    const flat = imageSize(withGrid("hex-flat", 10, 8), 100);
    expect(flat.height).toBe(850);
  });

  it("limits the largest side", () => {
    const big = withGrid("square", 100, 100);
    expect(maxPixelsPerCell(big)).toBe(81);
    expect(clampPixelsPerCell(big, 500)).toBe(81);
    expect(clampPixelsPerCell(big, 5)).toBe(MIN_PIXELS_PER_CELL);
    expect(clampPixelsPerCell(big, Number.NaN)).toBe(70);
    expect(imageSize(big, 81).width).toBeLessThanOrEqual(MAX_EXPORT_SIDE);
    expect(maxPixelsPerCell(withGrid("square", 10, 10))).toBe(819);
  });

  it("makes a file name that a computer will accept", () => {
    expect(safeFileBase('Goblin: "Cave"/1')).toBe("Goblin Cave1");
    expect(safeFileBase("   ")).toBe("map");
  });
});

describe("joining walls into lines", () => {
  it("joins a closed room into one line that returns to its start", () => {
    const lines = joinSegments(wallPieces(addRoom(newMap(), room("r", 0, 0, 140, 70)), []));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(5);
    expect(lines[0][0]).toEqual(lines[0][4]);
  });

  it("keeps separate rooms apart", () => {
    const doc = addRoom(addRoom(newMap(), room("a", 0, 0, 70, 70)), room("b", 500, 500, 570, 570));
    expect(joinSegments(wallPieces(doc, []))).toHaveLength(2);
  });

  it("leaves a gap where a door is", () => {
    const doc = sample();
    const lines = joinSegments(wallPieces(doc, ["door", "window"]));
    expect(lines).toHaveLength(2); // the window and the door each break the ring
  });
});

describe("Universal VTT", () => {
  const file = universalVtt(sample(), 70, "QUJD");

  it("describes the picture and its grid", () => {
    expect(file.format).toBe(0.3);
    expect(file.resolution).toEqual({ map_origin: at(0, 0), map_size: at(30, 20), pixels_per_grid: 70 });
    expect(file.image).toBe("QUJD");
  });

  it("measures everything in grid cells, whatever the picture's size", () => {
    const big = universalVtt(sample(), 140, "x");
    expect(big.resolution.map_size).toEqual(at(30, 20));
    expect(big.resolution.pixels_per_grid).toBe(140);
    expect(big.lights).toEqual(file.lights);
    expect(big.line_of_sight).toEqual(file.line_of_sight);
  });

  it("makes each door a portal, centred and turned the way the door lies", () => {
    expect(file.portals).toHaveLength(1);
    const portal = file.portals[0];
    expect(portal.position.x).toBeCloseTo(3, 6); // 210 px / 70
    expect(portal.position.y).toBeCloseTo(1, 6);
    expect(portal.rotation).toBeCloseTo(0, 6);
    expect(portal).toMatchObject({ closed: true, freestanding: false });
    expect(portal.bounds[1].x - portal.bounds[0].x).toBeCloseTo(1, 6); // one cell wide
  });

  it("cuts the walls open at doors and windows", () => {
    const covered = file.line_of_sight.reduce(
      (sum, line) => sum + line.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - line[i].x, p.y - line[i].y), 0),
      0,
    );
    expect(covered).toBeCloseTo(12 - 2, 6); // a 4 x 2 room is 12 cells round; the door and window take two
  });

  it("carries lights, and the darkness as an ambient colour", () => {
    expect(file.lights).toEqual([{ position: at(3, 2), range: 4, intensity: 1, color: "ffffb454", shadows: true }]);
    expect(file.environment).toEqual({ baked_lighting: false, ambient_light: "ff808080" });
    expect(universalVtt({ ...sample(), ambient: 0 }, 70, "").environment.ambient_light).toBe("ffffffff");
  });

  it("can be written as JSON and read back", () => {
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
  });
});

describe("Foundry scene", () => {
  const scene = foundryScene(sample(), 100, "cave.png", "Cave") as any;

  it("matches the picture, grid and name", () => {
    expect(scene).toMatchObject({ name: "Cave", width: 3000, height: 2000, padding: 0, shiftX: 0, shiftY: 0 });
    expect(scene.background).toEqual({ src: "cave.png" });
    expect(scene.grid).toMatchObject({ type: 1, size: 100, distance: 5, units: "ft" });
  });

  it("uses Foundry's hex grid types, which match our layouts", () => {
    const hex = (type: GridType) => (foundryScene(withGrid(type, 6, 6), 100, "a.png", "A") as any).grid.type;
    expect([hex("square"), hex("hex-pointy"), hex("hex-flat")]).toEqual([1, 2, 4]);
  });

  it("places hexes where Foundry will draw them: the picture's hex centres follow Foundry's row and column rules", () => {
    // Foundry's pointy hexes are `size` wide and step down by 0.75 of their height; odd rows sit half a cell right.
    const g = withGrid("hex-pointy", 6, 6, 100).grid;
    const a = cellCenter(g, 0, 0);
    const b = cellCenter(g, 0, 1);
    const height = 2 * (100 / Math.sqrt(3));
    expect(b.y - a.y).toBeCloseTo(height * 0.75, 6);
    expect(b.x - a.x).toBeCloseTo(50, 6);
    const corners = cellPolygon(g, 0, 0);
    expect(Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x))).toBeCloseTo(100, 6); // flat to flat
  });

  it("turns every wall, door and window into a wall in picture pixels", () => {
    const walls = scene.walls as { c: number[]; door: number; sense: number }[];
    expect(walls.filter((w) => w.door === 1)).toHaveLength(1);
    expect(walls.filter((w) => w.sense === 10)).toHaveLength(1); // the window, which light and sight pass through partly
    expect(walls.filter((w) => w.door === 0 && w.sense === 20).length).toBeGreaterThan(4);
    const door = walls.find((w) => w.door === 1)!;
    expect(door.c[1]).toBeCloseTo(100, 6); // y = 70 px * 100/70
    expect(Math.abs(door.c[2] - door.c[0])).toBeCloseTo(100, 6); // one cell wide
  });

  it("carries lights in feet, and the darkness", () => {
    expect(scene.lights).toHaveLength(1);
    expect(scene.lights[0]).toMatchObject({ x: 300, y: 200 });
    expect(scene.lights[0].config).toMatchObject({ dim: 20, bright: 10, color: "#ffb454" });
    expect(scene.darkness).toBe(0.5);
    expect(scene.environment.darknessLevel).toBe(0.5);
  });

  it("can be written as JSON and read back", () => {
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
  });
});
