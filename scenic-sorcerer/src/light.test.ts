import { describe, expect, it } from "vitest";
import { LightCache, blockingSegments, visibilityPolygon } from "./lighting";
import { addLevel, contentOf, levelDoc, removeLevel, renameLevel, switchLevel } from "./levels";
import { LIGHT_PRESETS, newMap, type MapDoc, type Opening, type Room } from "./model";
import { addLight, itemKind, lightAt, makeLight, makeStamp, moveItem, removeById, updateLight, usedAssetIds, addStamps } from "./objects";
import { addOpening, addRoom, nearestWall, openingOnWall, pointInPolygon, rectPoints } from "./rooms";
import { parse, parseFile, serialize } from "./storage";

const at = (x: number, y: number) => ({ x, y });
const grid = newMap().grid; // 70 px cells
const box = (id: string, x0: number, y0: number, x1: number, y1: number, walls = true): Room => ({
  id,
  points: rectPoints(at(x0, y0), at(x1, y1))!,
  floor: "stone",
  walls,
});
const withRooms = (...rooms: Room[]): MapDoc => rooms.reduce(addRoom, newMap());
const windowOn = (doc: MapDoc, x: number, y: number, id = "w"): Opening => {
  const hit = nearestWall(doc.rooms, at(x, y), 10)!;
  return { ...openingOnWall(grid, hit, "window", "off", id), kind: "window" };
};
const doorOn = (doc: MapDoc, x: number, y: number, id = "d"): Opening =>
  openingOnWall(grid, nearestWall(doc.rooms, at(x, y), 10)!, "door", "off", id);

function area(points: { x: number; y: number }[]): number {
  let sum = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  });
  return Math.abs(sum) / 2;
}

describe("what stops light", () => {
  it("counts every edge of a walled room, and nothing for a room without walls", () => {
    expect(blockingSegments(withRooms(box("a", 0, 0, 140, 140)))).toHaveLength(4);
    expect(blockingSegments(withRooms(box("a", 0, 0, 140, 140, false)))).toEqual([]);
  });

  it("lets light through a window, but not a door", () => {
    let doc = withRooms(box("a", 0, 0, 280, 140));
    doc = addOpening(doc, windowOn(doc, 140, 1));
    const segments = blockingSegments(doc);
    expect(segments).toHaveLength(5); // the top wall is in two pieces
    const top = segments.filter((s) => s.a.y === 0 && s.b.y === 0);
    const covered = top.reduce((sum, s) => sum + Math.abs(s.b.x - s.a.x), 0);
    expect(covered).toBeCloseTo(280 - 70, 6);

    const door = withRooms(box("a", 0, 0, 280, 140));
    expect(blockingSegments(addOpening(door, doorOn(door, 140, 1)))).toHaveLength(4);
  });

  it("opens a window at the end of a wall without leaving a sliver", () => {
    let doc = withRooms(box("a", 0, 0, 280, 140));
    doc = addOpening(doc, windowOn(doc, 275, 1));
    const top = blockingSegments(doc).filter((s) => s.a.y === 0 && s.b.y === 0);
    expect(top).toHaveLength(1);
    expect(top[0].b.x - top[0].a.x).toBeCloseTo(210, 6);
  });
});

describe("what a light can see", () => {
  it("sees the whole square round it when nothing is in the way", () => {
    const area100 = visibilityPolygon(at(0, 0), 100, []);
    expect(area(area100)).toBeCloseTo(200 * 200, 0);
  });

  it("is stopped by a wall, so the space behind it is dark", () => {
    const wall = [{ a: at(40, -500), b: at(40, 500) }];
    const seen = visibilityPolygon(at(0, 0), 100, wall);
    expect(pointInPolygon(at(20, 5), seen)).toBe(true);
    expect(pointInPolygon(at(70, 5), seen)).toBe(false);
    expect(pointInPolygon(at(-70, 5), seen)).toBe(true);
    expect(area(seen)).toBeCloseTo(140 * 200, -1);
  });

  it("stays inside a closed room", () => {
    const doc = withRooms(box("a", 0, 0, 280, 280));
    const seen = visibilityPolygon(at(140, 140), 700, blockingSegments(doc));
    expect(area(seen)).toBeCloseTo(280 * 280, 0);
    expect(pointInPolygon(at(300, 140), seen)).toBe(false);
  });

  it("shines out through a window, and out through nothing else", () => {
    let doc = withRooms(box("a", 0, 0, 280, 280));
    const closed = visibilityPolygon(at(140, 140), 400, blockingSegments(doc));
    doc = addOpening(doc, windowOn(doc, 140, 1));
    const open = visibilityPolygon(at(140, 140), 400, blockingSegments(doc));
    expect(pointInPolygon(at(140, -60), closed)).toBe(false);
    expect(pointInPolygon(at(140, -60), open)).toBe(true);
    expect(pointInPolygon(at(40, -60), open)).toBe(false); // only through the gap
  });

  it("lights a round room evenly", () => {
    const doc = withRooms({ id: "c", points: Array.from({ length: 48 }, (_, i) => at(140 + 100 * Math.cos((i * Math.PI) / 24), 140 + 100 * Math.sin((i * Math.PI) / 24))), floor: "stone", walls: true });
    const seen = visibilityPolygon(at(140, 140), 500, blockingSegments(doc));
    expect(Math.abs(area(seen) - area(doc.rooms[0].points)) / area(doc.rooms[0].points)).toBeLessThan(0.01);
  });

  it("is not blocked by a wall it is sitting on", () => {
    const doc = withRooms(box("a", 0, 0, 280, 280));
    const seen = visibilityPolygon(at(0, 140), 100, blockingSegments(doc));
    expect(pointInPolygon(at(40, 140), seen)).toBe(true);
    expect(pointInPolygon(at(-40, 140), seen)).toBe(true);
  });

  it("remembers a light's area until the walls or the light change", () => {
    const cache = new LightCache();
    const doc = addLight(withRooms(box("a", 0, 0, 280, 280)), makeLight("l", at(140, 140), 200, "#ffb454"));
    const first = cache.polygonFor(doc, doc.lights[0]);
    expect(cache.polygonFor({ ...doc, ambient: 0.2 }, doc.lights[0])).toBe(first); // same walls
    expect(cache.polygonFor(doc, { ...doc.lights[0], radius: 100 })).not.toBe(first); // a different light
    const moved = { ...doc, rooms: [box("a", 0, 0, 140, 140)] };
    expect(cache.polygonFor(moved, moved.lights[0])).not.toBe(first); // different walls
  });
});

describe("lights as items", () => {
  const doc = () => addLight(addLight(newMap(), makeLight("l1", at(100, 100), 280, "#ffb454")), makeLight("l2", at(105, 100), 140, "#7fb2ff"));

  it("finds the topmost light under a point", () => {
    expect(lightAt(doc().lights, at(102, 100), 14)?.id).toBe("l2");
    expect(lightAt(doc().lights, at(300, 300), 14)).toBeNull();
    expect(itemKind(doc(), "l1")).toBe("light");
  });

  it("edits, moves and deletes one light without touching the original", () => {
    const d = doc();
    const frozen = JSON.stringify(d);
    expect(updateLight(d, "l1", (l) => ({ ...l, color: "#ffffff" })).lights[0].color).toBe("#ffffff");
    expect(moveItem(d, "l1", 70, -10).lights[0]).toMatchObject({ x: 170, y: 90 });
    expect(removeById(d, "l1").lights.map((l) => l.id)).toEqual(["l2"]);
    expect(JSON.stringify(d)).toBe(frozen);
  });

  it("has ready-made lights", () => {
    expect(LIGHT_PRESETS.map((p) => p.id)).toContain("torch");
  });
});

describe("levels", () => {
  const ground = (): MapDoc => addLight(withRooms(box("g", 0, 0, 140, 140)), makeLight("lg", at(70, 70), 140, "#ffb454"));

  it("starts with one level that holds the map's own lists", () => {
    expect(newMap().levels).toEqual([{ id: "level-1", name: "Level 1", content: null }]);
    expect(newMap().level).toBe(0);
  });

  it("adds an empty level above and starts editing it, keeping the old one safe", () => {
    const before = ground();
    const two = addLevel(before, "up", "Upstairs")!;
    expect(two.level).toBe(1);
    expect(two.rooms).toEqual([]);
    expect(two.lights).toEqual([]);
    expect(two.levels.map((l) => [l.name, l.content === null])).toEqual([["Level 1", false], ["Upstairs", true]]);
    expect(two.levels[0].content!.rooms).toEqual(before.rooms);
    expect(before.rooms).toHaveLength(1); // the original is untouched
  });

  it("switches back and forth without losing anything", () => {
    const two = addLevel(ground(), "up", "Upstairs")!;
    const drawn = addRoom(two, box("u", 70, 70, 280, 280));
    const down = switchLevel(drawn, 0);
    expect(down.rooms.map((r) => r.id)).toEqual(["g"]);
    expect(down.lights.map((l) => l.id)).toEqual(["lg"]);
    const up = switchLevel(down, 1);
    expect(up.rooms.map((r) => r.id)).toEqual(["u"]);
    expect(switchLevel(up, 1)).toBe(up);
    expect(switchLevel(up, 5)).toBe(up);
    expect(switchLevel(up, -1)).toBe(up);
  });

  it("shows any level as if it were being edited", () => {
    const two = addRoom(addLevel(ground(), "up", "Upstairs")!, box("u", 0, 0, 70, 70));
    expect(levelDoc(two, 0).rooms.map((r) => r.id)).toEqual(["g"]);
    expect(levelDoc(two, 1)).toBe(two);
  });

  it("removes a level, whether or not it is the one being edited, and keeps at least one", () => {
    let doc = addLevel(addLevel(ground(), "b", "B")!, "c", "C")!; // levels: Level 1, B, C; editing C
    doc = addRoom(doc, box("c-room", 0, 0, 70, 70));
    const withoutMiddle = removeLevel(doc, 1);
    expect(withoutMiddle.levels.map((l) => l.name)).toEqual(["Level 1", "C"]);
    expect(withoutMiddle.level).toBe(1);
    expect(withoutMiddle.rooms.map((r) => r.id)).toEqual(["c-room"]);

    const withoutCurrent = removeLevel(doc, 2);
    expect(withoutCurrent.levels.map((l) => l.name)).toEqual(["Level 1", "B"]);
    expect(withoutCurrent.level).toBe(1);
    expect(withoutCurrent.levels[1].content).toBeNull();

    const withoutBottom = removeLevel(switchLevel(doc, 0), 0);
    expect(withoutBottom.levels.map((l) => l.name)).toEqual(["B", "C"]);
    expect(withoutBottom.level).toBe(0);

    expect(removeLevel(newMap(), 0)).toEqual(newMap());
  });

  it("renames a level, ignoring empty names", () => {
    const doc = ground();
    expect(renameLevel(doc, 0, "  Cellar ").levels[0].name).toBe("Cellar");
    expect(renameLevel(doc, 0, "   ")).toBe(doc);
    expect(renameLevel(doc, 0, "Level 1")).toBe(doc);
    expect(renameLevel(doc, 0, "x".repeat(100)).levels[0].name).toHaveLength(40);
  });

  it("stops at twenty levels", () => {
    let doc: MapDoc | null = newMap();
    for (let i = 0; i < 19; i++) doc = addLevel(doc!, `l${i}`, `L${i}`);
    expect(doc!.levels).toHaveLength(20);
    expect(addLevel(doc!, "x", "X")).toBeNull();
  });

  it("lists the content of the level being edited", () => {
    expect(Object.keys(contentOf(ground())).sort()).toEqual(["labels", "lights", "markers", "openings", "rooms", "stamps", "strokes"]);
  });

  it("counts pictures used on every level", () => {
    const pic = { id: "tree", width: 10, height: 10 };
    const doc = addStamps(addLevel(addStamps(ground(), [makeStamp("s", pic, at(0, 0), 70, 0, false)]), "up", "Up")!, [
      makeStamp("t", { ...pic, id: "rock" }, at(0, 0), 70, 0, false),
    ]);
    expect([...usedAssetIds(doc)].sort()).toEqual(["rock", "tree"]);
  });
});

describe("saving lights, darkness and levels", () => {
  const picture = { id: "tree", name: "Tree", dataUrl: "data:image/png;base64,iVBORw0KGgo=", width: 10, height: 10, favourite: false };

  it("round-trips a map with several levels", () => {
    let doc = addLight(withRooms(box("g", 0, 0, 140, 140)), makeLight("lg", at(70, 70), 140, "#ffb454"));
    doc = addLevel(doc, "up", "Upstairs")!;
    doc = addLight(addRoom(doc, box("u", 0, 0, 70, 70)), makeLight("lu", at(35, 35), 70, "#7fb2ff"));
    doc = { ...doc, ambient: 0.4 };
    expect(parse(serialize(doc))).toEqual(doc);
    expect(parse(serialize(switchLevel(doc, 0))).level).toBe(0);
  });

  it("packs pictures used on other levels into the file", () => {
    const doc = addLevel(addStamps(newMap(), [makeStamp("s", picture, at(0, 0), 70, 0, false)]), "up", "Up")!;
    expect(parseFile(serialize(doc, [picture])).assets).toHaveLength(1);
  });

  it("opens an older map as a single level with the default darkness", () => {
    const old = JSON.stringify({ app: "scenic-sorcerer", version: 1, name: "Old", grid });
    expect(parse(old)).toMatchObject({ lights: [], ambient: 0.7, level: 0, levels: [{ id: "level-1", name: "Level 1", content: null }] });
  });

  it("tidies damaged levels, lights and darkness", () => {
    const base = addLevel(withRooms(box("g", 0, 0, 140, 140)), "up", "Up")!;
    const raw = JSON.parse(serialize(base));
    raw.level = 9;
    raw.ambient = 7;
    raw.levels[0].content.rooms[0].points = "nonsense";
    raw.levels.push({ name: "   " }, "junk");
    raw.lights = [
      { id: "ok", x: 1, y: 2, radius: 99999, color: "red" },
      { id: "bad", x: 1, y: 2, radius: 0, color: "#ffffff" },
    ];
    const opened = parse(JSON.stringify(raw));
    expect(opened.level).toBe(0);
    expect(opened.levels[0].content).toBeNull();
    expect(opened.levels.map((l) => l.name)).toEqual(["Level 1", "Up", "Level 3", "Level 4"]);
    expect(opened.levels[1].content).toEqual(expect.objectContaining({ rooms: [] }));
    expect(opened.ambient).toBe(0.95);
    expect(opened.lights).toEqual([{ id: "ok", x: 1, y: 2, radius: 5000, color: "#ffb454" }]);
  });
});
