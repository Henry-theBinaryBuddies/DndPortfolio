import { describe, expect, it } from "vitest";
import { cellAt, cellCenter, cellPolygon, hexRadius, mapSize, snap } from "./grid";
import { History } from "./history";
import { newMap, type Grid, type GridType, type MapDoc } from "./model";
import { AUTOSAVE_KEY, fileName, loadAutosave, parse, saveAutosave, serialize } from "./storage";
import { fit, mapToScreen, screenToMap, zoomAt } from "./view";

const grid = (type: GridType, cols = 6, rows = 5, cellPx = 70): Grid => ({ type, cols, rows, cellPx });
const TYPES: GridType[] = ["square", "hex-flat", "hex-pointy"];

describe("grid", () => {
  it("sizes a square map as cells times cell size", () => {
    expect(mapSize(grid("square"))).toEqual({ width: 420, height: 350 });
  });

  it("sizes hex maps so every hex fits exactly inside", () => {
    for (const type of ["hex-flat", "hex-pointy"] as const) {
      const g = grid(type);
      const size = mapSize(g);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let row = 0; row < g.rows; row++) {
        for (let col = 0; col < g.cols; col++) {
          for (const p of cellPolygon(g, col, row)) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
        }
      }
      expect(minX).toBeCloseTo(0, 6);
      expect(minY).toBeCloseTo(0, 6);
      expect(maxX).toBeCloseTo(size.width, 6);
      expect(maxY).toBeCloseTo(size.height, 6);
    }
  });

  it("keeps neighbouring hex centres exactly one cell apart", () => {
    const pointy = grid("hex-pointy");
    const a = cellCenter(pointy, 2, 2);
    for (const [col, row] of [[3, 2], [2, 1], [2, 3], [1, 1]]) {
      const b = cellCenter(pointy, col, row);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(70, 6);
    }
    const flat = grid("hex-flat");
    const c = cellCenter(flat, 2, 2);
    for (const [col, row] of [[2, 3], [1, 2], [3, 2], [1, 1]]) {
      const d = cellCenter(flat, col, row);
      expect(Math.hypot(c.x - d.x, c.y - d.y)).toBeCloseTo(70, 6);
    }
  });

  it("finds the cell under its own centre and under points near its corners", () => {
    for (const type of TYPES) {
      const g = grid(type);
      for (let row = 0; row < g.rows; row++) {
        for (let col = 0; col < g.cols; col++) {
          const c = cellCenter(g, col, row);
          expect(cellAt(g, c)).toEqual({ col, row });
          for (const corner of cellPolygon(g, col, row)) {
            const inside = { x: c.x + (corner.x - c.x) * 0.95, y: c.y + (corner.y - c.y) * 0.95 };
            expect(cellAt(g, inside)).toEqual({ col, row });
          }
        }
      }
    }
  });

  it("returns null off the map", () => {
    for (const type of TYPES) {
      const g = grid(type);
      expect(cellAt(g, { x: -5, y: 100 })).toBeNull();
      expect(cellAt(g, { x: 100, y: 5000 })).toBeNull();
    }
  });

  it("snaps on a square grid to corners, or to half cells", () => {
    const g = grid("square");
    expect(snap(g, { x: 80, y: 130 }, "cell")).toEqual({ x: 70, y: 140 });
    expect(snap(g, { x: 80, y: 130 }, "half")).toEqual({ x: 70, y: 140 });
    expect(snap(g, { x: 100, y: 30 }, "half")).toEqual({ x: 105, y: 35 });
    expect(snap(g, { x: 80.3, y: 130.7 }, "off")).toEqual({ x: 80.3, y: 130.7 });
  });

  it("snaps on a hex grid to centres, or to centres and corners", () => {
    for (const type of ["hex-flat", "hex-pointy"] as const) {
      const g = grid(type);
      const c = cellCenter(g, 2, 2);
      const corner = cellPolygon(g, 2, 2)[0];
      const nearCentre = { x: c.x + 3, y: c.y - 4 };
      const nearCorner = { x: c.x + (corner.x - c.x) * 0.9, y: c.y + (corner.y - c.y) * 0.9 };
      expect(snap(g, nearCentre, "cell")).toEqual(c);
      expect(snap(g, nearCorner, "cell")).toEqual(c);
      expect(snap(g, nearCentre, "half")).toEqual(c);
      const snapped = snap(g, nearCorner, "half");
      expect(snapped.x).toBeCloseTo(corner.x, 6);
      expect(snapped.y).toBeCloseTo(corner.y, 6);
    }
    expect(hexRadius(70)).toBeCloseTo(40.4145, 3);
  });
});

describe("history", () => {
  it("undoes and redoes in order", () => {
    const h = new History("a");
    h.push("b");
    h.push("c");
    expect(h.undo()).toBe("b");
    expect(h.undo()).toBe("a");
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBe("a");
    expect(h.redo()).toBe("b");
    expect(h.redo()).toBe("c");
    expect(h.canRedo).toBe(false);
  });

  it("drops the redo list when a new change is made", () => {
    const h = new History(1);
    h.push(2);
    h.undo();
    h.push(3);
    expect(h.canRedo).toBe(false);
    expect(h.present).toBe(3);
    expect(h.undo()).toBe(1);
  });

  it("ignores a push of the same state", () => {
    const state = { n: 1 };
    const h = new History(state);
    h.push(state);
    expect(h.canUndo).toBe(false);
  });

  it("keeps hundreds of steps", () => {
    const h = new History(0);
    for (let i = 1; i <= 500; i++) h.push(i);
    for (let i = 0; i < 500; i++) h.undo();
    expect(h.present).toBe(0);
  });
});

describe("storage", () => {
  const sample: MapDoc = { version: 1, name: "Goblin Cave", grid: grid("hex-flat", 12, 9, 100) };

  it("round-trips a map", () => {
    expect(parse(serialize(sample))).toEqual(sample);
  });

  it("rejects files that are not maps, with a readable message", () => {
    expect(() => parse("not json")).toThrow("not a Scenic Sorcerer map");
    expect(() => parse('{"hello": 1}')).toThrow("not a Scenic Sorcerer map");
    expect(() => parse("[1,2]")).toThrow("not a Scenic Sorcerer map");
    expect(() => parse(serialize(sample).replace('"version": 1', '"version": 2'))).toThrow("newer version");
    expect(() => parse(serialize(sample).replace("hex-flat", "triangle"))).toThrow("grid type");
  });

  it("clamps out-of-range values instead of trusting the file", () => {
    const text = JSON.stringify({
      app: "scenic-sorcerer",
      version: 1,
      name: "   ",
      grid: { type: "square", cols: 99999, rows: -3, cellPx: "abc" },
    });
    expect(parse(text)).toEqual({ version: 1, name: "Untitled map", grid: grid("square", 100, 1, 20) });
  });

  it("makes a safe file name", () => {
    expect(fileName(sample)).toBe("Goblin Cave.scenic.json");
    expect(fileName({ ...sample, name: 'a/b:c*?"<>|' })).toBe("abc.scenic.json");
    expect(fileName({ ...sample, name: "///" })).toBe("map.scenic.json");
  });

  it("autosaves and restores, and survives a broken or full store", () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(loadAutosave(store)).toBeNull();
    expect(saveAutosave(store, sample)).toBe(true);
    expect(loadAutosave(store)).toEqual(sample);
    data.set(AUTOSAVE_KEY, "garbage");
    expect(loadAutosave(store)).toBeNull();
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(saveAutosave(full, sample)).toBe(false);
  });

  it("starts new maps as a valid document", () => {
    expect(parse(serialize(newMap()))).toEqual(newMap());
  });
});

describe("view", () => {
  it("converts between screen and map and back", () => {
    const v = { x: 30, y: -12, scale: 0.5 };
    const p = { x: 123, y: 456 };
    expect(screenToMap(v, mapToScreen(v, p))).toEqual(p);
  });

  it("keeps the point under the cursor fixed while zooming", () => {
    const v = { x: 30, y: -12, scale: 0.5 };
    const anchor = { x: 200, y: 150 };
    const before = screenToMap(v, anchor);
    const after = screenToMap(zoomAt(v, anchor, 1.7), anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("clamps zoom", () => {
    const v = { x: 0, y: 0, scale: 1 };
    expect(zoomAt(v, { x: 0, y: 0 }, 1000).scale).toBe(8);
    expect(zoomAt(v, { x: 0, y: 0 }, 0.0001).scale).toBe(0.05);
  });

  it("fits and centres the map", () => {
    const v = fit({ width: 1000, height: 500 }, { width: 580, height: 580 }, 40);
    expect(v.scale).toBeCloseTo(0.5, 6);
    expect(v.x).toBeCloseTo(40, 6);
    expect(v.y).toBeCloseTo(165, 6);
  });
});
