import { describe, expect, it } from "vitest";
import { newMap, type MapDoc, type Opening, type Room } from "./model";
import {
  addOpening,
  addRoom,
  isValidOutline,
  moveRoom,
  nearestWall,
  openingAt,
  openingOnWall,
  pointInPolygon,
  polygonArea,
  pruneOpenings,
  rectPoints,
  removeItem,
  roomAt,
  setRoomFloor,
  setRoomWalls,
  walledRooms,
} from "./rooms";
import { parse, serialize } from "./storage";

// A 70 px grid. Room A covers cells (1,1)-(4,3); room B sits against A's right wall.
const roomA: Room = { id: "a", points: rectPoints({ x: 70, y: 70 }, { x: 350, y: 280 })!, floor: "stone", walls: true };
const roomB: Room = { id: "b", points: rectPoints({ x: 350, y: 70 }, { x: 560, y: 210 })!, floor: "wood", walls: true };
const base = (): MapDoc => ({ ...newMap(), rooms: [roomA, roomB] });
const grid = newMap().grid;

function doorOn(doc: MapDoc, x: number, y: number, id = "d1", snapMode: "cell" | "half" | "off" = "cell"): Opening {
  const hit = nearestWall(doc.rooms, { x, y }, 20);
  if (!hit) throw new Error("no wall there");
  return openingOnWall(grid, hit, "door", snapMode, id);
}

describe("outlines", () => {
  it("builds a rectangle from any two opposite corners", () => {
    expect(rectPoints({ x: 350, y: 280 }, { x: 70, y: 70 })).toEqual(roomA.points);
    expect(rectPoints({ x: 5, y: 5 }, { x: 5, y: 90 })).toBeNull();
  });

  it("measures area and rejects outlines with none", () => {
    expect(polygonArea(roomA.points)).toBe(280 * 210);
    expect(isValidOutline(roomA.points)).toBe(true);
    expect(isValidOutline([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(false);
    expect(isValidOutline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toBe(false);
  });

  it("tells inside from outside, including for an L shape", () => {
    const L = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 },
    ];
    expect(pointInPolygon({ x: 20, y: 80 }, L)).toBe(true);
    expect(pointInPolygon({ x: 80, y: 20 }, L)).toBe(true);
    expect(pointInPolygon({ x: 80, y: 80 }, L)).toBe(false);
  });
});

describe("finding things", () => {
  it("picks the topmost room, and grabs a room by its wall", () => {
    const doc = base();
    expect(roomAt(doc.rooms, { x: 100, y: 100 }, 5)?.id).toBe("a");
    expect(roomAt(doc.rooms, { x: 500, y: 100 }, 5)?.id).toBe("b");
    expect(roomAt(doc.rooms, { x: 67, y: 150 }, 5)?.id).toBe("a");
    expect(roomAt(doc.rooms, { x: 30, y: 30 }, 5)).toBeNull();
    const overlap: Room = { id: "top", points: rectPoints({ x: 70, y: 70 }, { x: 140, y: 140 })!, floor: "dirt", walls: true };
    expect(roomAt([...doc.rooms, overlap], { x: 100, y: 100 }, 5)?.id).toBe("top");
  });

  it("finds the nearest wall only within reach", () => {
    const doc = base();
    const hit = nearestWall(doc.rooms, { x: 200, y: 75 }, 10);
    expect(hit).toMatchObject({ roomId: "a", along: 130, length: 280, dist: 5 });
    expect(nearestWall(doc.rooms, { x: 200, y: 150 }, 10)).toBeNull();
  });
});

describe("doors and windows", () => {
  it("centres a door in a cell with full snap", () => {
    const door = doorOn(base(), 200, 72);
    expect(door).toMatchObject({ kind: "door", a: { x: 140, y: 70 }, b: { x: 210, y: 70 } });
  });

  it("allows half-cell steps with half snap, and any spot with snap off", () => {
    const half = doorOn(base(), 180, 72, "d", "half");
    expect(half.a.x).toBe(140);
    expect(half.b.x).toBe(210);
    const halfStep = doorOn(base(), 215, 72, "d", "half");
    expect(halfStep.a.x).toBe(175);
    const free = doorOn(base(), 203, 72, "d", "off");
    expect(free.a.x).toBeCloseTo(168, 6);
    expect(free.b.x).toBeCloseTo(238, 6);
  });

  it("keeps a door on the wall at its ends, and shrinks it to fit a short wall", () => {
    const atEnd = doorOn(base(), 349, 70, "d", "off");
    expect(atEnd.b.x).toBeCloseTo(350, 6);
    expect(atEnd.a.x).toBeCloseTo(280, 6);
    const tiny: Room = { id: "t", points: rectPoints({ x: 0, y: 0 }, { x: 35, y: 35 })!, floor: "stone", walls: true };
    const hit = nearestWall([tiny], { x: 10, y: 0 }, 5)!;
    const door = openingOnWall(grid, hit, "door", "cell", "d");
    expect(door.a.x).toBeCloseTo(0, 6);
    expect(door.b.x).toBeCloseTo(35, 6);
  });

  it("places doors on slanted walls", () => {
    const tri: Room = { id: "t", points: [{ x: 0, y: 0 }, { x: 300, y: 400 }, { x: 0, y: 400 }], floor: "stone", walls: true };
    const hit = nearestWall([tri], { x: 150, y: 200 }, 5)!;
    const door = openingOnWall(grid, hit, "door", "off", "d");
    expect(Math.hypot(door.b.x - door.a.x, door.b.y - door.a.y)).toBeCloseTo(70, 6);
    expect((door.a.x + door.b.x) / 2).toBeCloseTo(150, 6);
    expect((door.a.y + door.b.y) / 2).toBeCloseTo(200, 6);
  });

  it("replaces an opening in the same spot instead of stacking", () => {
    let doc = addOpening(base(), doorOn(base(), 200, 72, "d1"));
    doc = addOpening(doc, { ...doorOn(doc, 200, 72, "w1"), kind: "window" });
    expect(doc.openings.map((o) => [o.id, o.kind])).toEqual([["w1", "window"]]);
    doc = addOpening(doc, doorOn(doc, 290, 72, "d2"));
    expect(doc.openings).toHaveLength(2);
  });

  it("selects an opening near the cursor", () => {
    const doc = addOpening(base(), doorOn(base(), 200, 72));
    expect(openingAt(doc.openings, { x: 175, y: 76 }, 8)?.id).toBe("d1");
    expect(openingAt(doc.openings, { x: 260, y: 76 }, 8)).toBeNull();
  });
});

describe("edits", () => {
  it("never mutates the document it is given", () => {
    const doc = base();
    const frozen = JSON.stringify(doc);
    addRoom(doc, { ...roomA, id: "c" });
    moveRoom(doc, "a", 70, 0);
    removeItem(doc, "a");
    setRoomFloor(doc, "a", "water");
    addOpening(doc, doorOn(doc, 200, 72));
    expect(JSON.stringify(doc)).toBe(frozen);
  });

  it("moves a room with its doors, leaving other rooms' doors alone", () => {
    let doc = addOpening(base(), doorOn(base(), 200, 72, "onA"));
    doc = addOpening(doc, doorOn(doc, 500, 72, "onB"));
    const moved = moveRoom(doc, "a", -70, 140);
    expect(moved.rooms[0].points[0]).toEqual({ x: 0, y: 210 });
    expect(moved.rooms[1]).toBe(doc.rooms[1]);
    expect(moved.openings.find((o) => o.id === "onA")).toMatchObject({ a: { x: 70, y: 210 }, b: { x: 140, y: 210 } });
    expect(moved.openings.find((o) => o.id === "onB")).toEqual(doc.openings.find((o) => o.id === "onB"));
    expect(moveRoom(doc, "a", 0, 0)).toBe(doc);
    expect(moveRoom(doc, "missing", 5, 5)).toBe(doc);
  });

  it("deleting a room removes its doors but keeps a door on a wall shared with a neighbour", () => {
    let doc = addOpening(base(), doorOn(base(), 200, 72, "onlyA"));
    doc = addOpening(doc, doorOn(doc, 350, 120, "shared"));
    const without = removeItem(doc, "a");
    expect(without.rooms.map((r) => r.id)).toEqual(["b"]);
    expect(without.openings.map((o) => o.id)).toEqual(["shared"]);
  });

  it("deletes a single door by id and ignores unknown ids", () => {
    const doc = addOpening(base(), doorOn(base(), 200, 72));
    expect(removeItem(doc, "d1").openings).toEqual([]);
    expect(removeItem(doc, "d1").rooms).toHaveLength(2);
    expect(removeItem(doc, "nope")).toBe(doc);
  });

  it("prunes only openings that are off every wall", () => {
    const doc = addOpening(base(), doorOn(base(), 200, 72));
    expect(pruneOpenings(doc)).toBe(doc);
    const stray: Opening = { id: "s", kind: "window", a: { x: 600, y: 600 }, b: { x: 670, y: 600 } };
    expect(pruneOpenings({ ...doc, openings: [...doc.openings, stray] }).openings.map((o) => o.id)).toEqual(["d1"]);
  });

  it("changes a room's floor", () => {
    const doc = setRoomFloor(base(), "a", "water");
    expect(doc.rooms[0].floor).toBe("water");
    expect(setRoomFloor(doc, "a", "water")).toBe(doc);
  });
});

describe("rooms without walls", () => {
  it("turning walls off removes that room's doors but keeps a door on a neighbour's shared wall", () => {
    let doc = addOpening(base(), doorOn(base(), 200, 72, "onlyA"));
    doc = addOpening(doc, doorOn(doc, 350, 120, "shared"));
    const open = setRoomWalls(doc, "a", false);
    expect(open.rooms[0].walls).toBe(false);
    expect(open.openings.map((o) => o.id)).toEqual(["shared"]);
    expect(setRoomWalls(open, "a", false)).toBe(open);
    expect(setRoomWalls(open, "a", true).rooms[0].walls).toBe(true);
  });

  it("offers no wall to put a door on, but the room can still be selected", () => {
    const pond: Room = { ...roomA, walls: false };
    expect(nearestWall(walledRooms([pond]), { x: 200, y: 72 }, 20)).toBeNull();
    expect(roomAt([pond], { x: 100, y: 100 }, 5)?.id).toBe("a");
  });

  it("saves the setting, and treats older maps as walled", () => {
    const doc = setRoomWalls(base(), "b", false);
    expect(parse(serialize(doc)).rooms.map((r) => r.walls)).toEqual([true, false]);
    const raw = JSON.parse(serialize(base()));
    delete raw.rooms[0].walls;
    expect(parse(JSON.stringify(raw)).rooms[0].walls).toBe(true);
  });
});

describe("saving rooms", () => {
  it("round-trips rooms, doors and windows", () => {
    const doc = addOpening(base(), doorOn(base(), 200, 72));
    expect(parse(serialize(doc))).toEqual(doc);
  });

  it("opens a map saved before rooms existed", () => {
    const old = JSON.stringify({ app: "scenic-sorcerer", version: 1, name: "Old", grid });
    expect(parse(old)).toMatchObject({ rooms: [], openings: [] });
  });

  it("skips damaged rooms and openings but keeps the good ones", () => {
    const doc = addOpening(base(), doorOn(base(), 200, 72));
    const raw = JSON.parse(serialize(doc));
    raw.rooms.push({ id: "bad", points: [{ x: 0, y: 0 }, { x: 1, y: "two" }, { x: 5, y: 5 }], floor: "stone", walls: true });
    raw.rooms.push({ id: "flat", points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], floor: "stone", walls: true });
    raw.rooms.push("nonsense");
    raw.rooms[0].floor = "lava";
    raw.openings.push({ id: "x", kind: "portal", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } });
    raw.openings.push({ id: "y", kind: "door", a: { x: 0, y: null }, b: { x: 1, y: 1 } });
    const opened = parse(JSON.stringify(raw));
    expect(opened.rooms.map((r) => r.id)).toEqual(["a", "b"]);
    expect(opened.rooms[0].floor).toBe("stone");
    expect(opened.openings.map((o) => o.id)).toEqual(["d1"]);
  });
});
