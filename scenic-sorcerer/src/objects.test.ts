import { describe, expect, it } from "vitest";
import { newMap, type Asset, type MapDoc, type Room, type Stroke } from "./model";
import {
  addStamps,
  addStroke,
  assetName,
  filterAssets,
  itemKind,
  makeStamp,
  moveItem,
  pointInStamp,
  removeById,
  reorder,
  resizeStamp,
  stampAt,
  stampCorners,
  stampSnap,
  strokeAt,
  updateStamp,
  usedAssetIds,
} from "./objects";
import { rectPoints } from "./rooms";
import { parse, parseFile, serialize } from "./storage";

const grid = newMap().grid; // square, 70 px cells
const tall = { id: "tree", width: 100, height: 200 };
const room: Room = { id: "r", points: rectPoints({ x: 0, y: 0 }, { x: 140, y: 140 })!, floor: "stone", walls: true };
const stroke = (id: string, points: { x: number; y: number }[]): Stroke => ({ id, texture: "grass", size: 40, opacity: 1, points });

function sample(): MapDoc {
  let doc: MapDoc = { ...newMap(), rooms: [room] };
  doc = addStamps(doc, [makeStamp("s1", tall, { x: 300, y: 300 }, 70, 0, true), makeStamp("s2", tall, { x: 320, y: 300 }, 70, 0, false)]);
  return addStroke(doc, stroke("p1", [{ x: 500, y: 500 }, { x: 600, y: 500 }]));
}

describe("stamps", () => {
  it("fits the picture inside the requested size and keeps its proportions", () => {
    const s = makeStamp("a", tall, { x: 10, y: 20 }, 70, 0, false);
    expect(s).toMatchObject({ x: 10, y: 20, width: 35, height: 70, flip: false, tint: null });
    expect(resizeStamp(s, 140)).toMatchObject({ width: 70, height: 140 });
  });

  it("finds a point inside a turned stamp, and rejects one outside", () => {
    const s = { ...makeStamp("a", { id: "x", width: 200, height: 100 }, { x: 0, y: 0 }, 200, Math.PI / 2, false) };
    expect(pointInStamp(s, { x: 0, y: 90 })).toBe(true); // the long side now points down
    expect(pointInStamp(s, { x: 90, y: 0 })).toBe(false);
    const corners = stampCorners(s);
    expect(corners[0].x).toBeCloseTo(50, 6);
    expect(corners[0].y).toBeCloseTo(-100, 6);
  });

  it("picks the topmost stamp", () => {
    const doc = sample();
    expect(stampAt(doc.stamps, { x: 310, y: 300 })?.id).toBe("s2");
    expect(stampAt(doc.stamps, { x: 295, y: 300 })?.id).toBe("s1");
    expect(stampAt(doc.stamps, { x: 0, y: 0 })).toBeNull();
  });

  it("puts a stamp in the middle of its square at full snap, and on grid lines at half snap", () => {
    expect(stampSnap(grid, { x: 80, y: 130 }, "cell")).toEqual({ x: 105, y: 105 });
    expect(stampSnap(grid, { x: 80, y: 130 }, "half")).toEqual({ x: 70, y: 140 });
    expect(stampSnap(grid, { x: 81.5, y: 130.2 }, "off")).toEqual({ x: 81.5, y: 130.2 });
  });

  it("edits one stamp and leaves the rest alone", () => {
    const doc = sample();
    const next = updateStamp(doc, "s1", (s) => ({ ...s, tint: "#aa3311" }));
    expect(next.stamps[0].tint).toBe("#aa3311");
    expect(next.stamps[1]).toBe(doc.stamps[1]);
    expect(updateStamp(doc, "nope", (s) => s)).toBe(doc);
  });
});

describe("paint", () => {
  it("grabs a stroke within its width, and not outside it", () => {
    const strokes = [stroke("p1", [{ x: 500, y: 500 }, { x: 600, y: 500 }]), stroke("dot", [{ x: 100, y: 400 }])];
    expect(strokeAt(strokes, { x: 550, y: 515 }, 2)?.id).toBe("p1");
    expect(strokeAt(strokes, { x: 550, y: 530 }, 2)).toBeNull();
    expect(strokeAt(strokes, { x: 110, y: 410 }, 2)?.id).toBe("dot");
  });

  it("ignores a stroke with no points", () => {
    const doc = newMap();
    expect(addStroke(doc, stroke("e", []))).toBe(doc);
  });
});

describe("any kind of thing", () => {
  it("knows what an id belongs to", () => {
    const doc = sample();
    expect([itemKind(doc, "s1"), itemKind(doc, "p1"), itemKind(doc, "r"), itemKind(doc, "?"), itemKind(doc, null)]).toEqual([
      "stamp",
      "stroke",
      "room",
      null,
      null,
    ]);
  });

  it("moves a stamp, a stroke and a room, and never changes the original", () => {
    const doc = sample();
    const frozen = JSON.stringify(doc);
    expect(moveItem(doc, "s1", 10, -5).stamps[0]).toMatchObject({ x: 310, y: 295 });
    expect(moveItem(doc, "p1", 7, 0).strokes[0].points).toEqual([{ x: 507, y: 500 }, { x: 607, y: 500 }]);
    expect(moveItem(doc, "r", 70, 0).rooms[0].points[0]).toEqual({ x: 70, y: 0 });
    expect(moveItem(doc, "s1", 0, 0)).toBe(doc);
    expect(moveItem(doc, "missing", 5, 5)).toBe(doc);
    expect(JSON.stringify(doc)).toBe(frozen);
  });

  it("deletes each kind by id", () => {
    const doc = sample();
    expect(removeById(doc, "s1").stamps.map((s) => s.id)).toEqual(["s2"]);
    expect(removeById(doc, "p1").strokes).toEqual([]);
    expect(removeById(doc, "r").rooms).toEqual([]);
    expect(removeById(doc, "missing")).toBe(doc);
  });

  it("brings a stamp to the front and sends it to the back", () => {
    const doc = sample();
    expect(reorder(doc, "s1", "front").stamps.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(reorder(doc, "s2", "back").stamps.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(reorder(doc, "s2", "front")).toBe(doc);
    expect(reorder(doc, "s1", "back")).toBe(doc);
    expect(reorder(doc, "p1", "back")).toBe(doc);
  });
});

describe("stamp library", () => {
  const asset = (name: string, favourite = false): Asset => ({ id: name, name, dataUrl: "data:image/png;base64,AA", width: 10, height: 10, favourite });
  const library = [asset("Oak Tree"), asset("Round Table", true), asset("Pine Tree"), asset("Barrel")];

  it("makes a readable name from a file name", () => {
    expect(assetName("Oak_Table-02.png")).toBe("Oak Table 02");
    expect(assetName("  .png")).toBe("Untitled");
    expect(assetName("a".repeat(100) + ".svg")).toHaveLength(60);
  });

  it("searches by every word, favourites first", () => {
    expect(filterAssets(library, "", false).map((a) => a.name)).toEqual(["Round Table", "Barrel", "Oak Tree", "Pine Tree"]);
    expect(filterAssets(library, "tree", false).map((a) => a.name)).toEqual(["Oak Tree", "Pine Tree"]);
    expect(filterAssets(library, "TREE oak", false).map((a) => a.name)).toEqual(["Oak Tree"]);
    expect(filterAssets(library, "", true).map((a) => a.name)).toEqual(["Round Table"]);
    expect(filterAssets(library, "dragon", false)).toEqual([]);
  });

  it("lists the pictures a map uses", () => {
    expect([...usedAssetIds(sample())]).toEqual(["tree"]);
  });
});

describe("saving paint, stamps and layers", () => {
  const picture: Asset = { id: "tree", name: "Tree", dataUrl: "data:image/png;base64,iVBORw0KGgo=", width: 100, height: 200, favourite: true };

  it("round-trips everything", () => {
    let doc = sample();
    doc = { ...doc, showGrid: false, layers: { ...doc.layers, paint: { visible: false, locked: true } } };
    doc = updateStamp(doc, "s1", (s) => ({ ...s, tint: "#aa3311", flip: true, rotation: 1.5 }));
    expect(parse(serialize(doc))).toEqual(doc);
  });

  it("packs pictures into the file and reads them back, without the favourite mark", () => {
    const opened = parseFile(serialize(sample(), [picture]));
    expect(opened.assets).toEqual([{ ...picture, favourite: false }]);
    expect(parseFile(serialize(sample())).assets).toEqual([]);
  });

  it("opens an older map that had no paint, stamps or layers", () => {
    const old = JSON.stringify({ app: "scenic-sorcerer", version: 1, name: "Old", grid, rooms: [], openings: [] });
    expect(parse(old)).toMatchObject({ strokes: [], stamps: [], showGrid: true, layers: newMap().layers });
  });

  it("skips damaged strokes, stamps and pictures but keeps the good ones", () => {
    const raw = JSON.parse(serialize(sample(), [picture]));
    raw.strokes.push({ id: "x", texture: "grass", size: -4, points: [{ x: 0, y: 0 }] });
    raw.strokes.push({ id: "y", texture: "grass", size: 10, points: [] });
    raw.strokes.push({ id: "z", texture: "obsidian", size: 10, opacity: 7, points: [{ x: 1, y: 1 }] });
    raw.stamps.push({ id: "bad", assetId: "tree", x: 0, y: 0, width: 0, height: 5 });
    raw.stamps.push({ id: "bad2", x: 0, y: 0, width: 5, height: 5 });
    raw.stamps[0].tint = "red; background:url(x)";
    raw.assets.push({ id: "evil", name: "x", dataUrl: "javascript:alert(1)", width: 5, height: 5 });
    raw.assets.push({ id: "huge", name: "x", dataUrl: "data:image/png;base64," + "A".repeat(12_000_000), width: 5, height: 5 });
    raw.layers = { objects: { visible: false }, paint: "nonsense" };
    const opened = parseFile(JSON.stringify(raw));
    expect(opened.doc.strokes.map((s) => s.id)).toEqual(["p1", "z"]);
    expect(opened.doc.strokes[1]).toMatchObject({ texture: "stone", opacity: 1 });
    expect(opened.doc.stamps.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(opened.doc.stamps[0].tint).toBeNull();
    expect(opened.assets.map((a) => a.id)).toEqual(["tree"]);
    expect(opened.doc.layers.objects).toEqual({ visible: false, locked: false });
    expect(opened.doc.layers.paint).toEqual({ visible: true, locked: false });
  });
});
