import { describe, expect, it } from "vitest";
import { newMap, type MapDoc, type Room } from "./model";
import {
  ELLIPSE_SEGMENTS,
  addOpening,
  addRoom,
  boundsOf,
  distance,
  draftOutline,
  edgeAt,
  ellipsePoints,
  insertVertex,
  isValidOutline,
  moveRoom,
  moveVertex,
  nearestWall,
  openingOnCurve,
  openingOnWall,
  polygonArea,
  pruneOpenings,
  removeVertex,
  replaceRoom,
  scaleHandles,
  scaleRoom,
  vertexHandles,
} from "./rooms";
import { parse, serialize } from "./storage";

const at = (x: number, y: number) => ({ x, y });
const grid = newMap().grid; // 70 px cells

function roomFrom(id: string, outline: ReturnType<typeof draftOutline>): Room {
  return { id, ...outline!, floor: "stone", walls: true };
}
const circle = roomFrom("c", draftOutline("circle", at(300, 300), at(400, 300)));
const triangle = roomFrom("t", draftOutline("triangle", at(0, 0), at(140, -50)));
const square = roomFrom("s", draftOutline("rect", at(0, 0), at(140, 140)));
const docWith = (...rooms: Room[]): MapDoc => rooms.reduce(addRoom, newMap());

describe("circles and ovals", () => {
  it("draws a circle from its centre outwards, with the extremes as points", () => {
    expect(circle.ellipse).toEqual({ x0: 200, y0: 200, x1: 400, y1: 400 });
    expect(circle.points).toHaveLength(ELLIPSE_SEGMENTS);
    expect(circle.points[0]).toEqual(at(300, 200)); // the top
    expect(circle.points[12].x).toBeCloseTo(400, 6); // right
    expect(circle.points[24].y).toBeCloseTo(400, 6); // bottom
    expect(circle.points[36].x).toBeCloseTo(200, 6); // left
  });

  it("has an area close to a true circle", () => {
    const exact = Math.PI * 100 * 100;
    expect(Math.abs(polygonArea(circle.points) - exact) / exact).toBeLessThan(0.01);
  });

  it("refuses a circle with no size", () => {
    expect(draftOutline("circle", at(5, 5), at(5, 5))).toBeNull();
  });

  it("has round dots for no corners, and eight stretch handles", () => {
    expect(vertexHandles(circle)).toEqual([]);
    expect(scaleHandles(circle, 12)).toHaveLength(8);
  });
});

describe("triangles", () => {
  it("is equilateral, with its base where the drag began", () => {
    const [a, b, c] = triangle.points;
    expect(a).toEqual(at(0, 0));
    expect(b).toEqual(at(140, 0));
    expect(distance(a, c)).toBeCloseTo(140, 6);
    expect(distance(b, c)).toBeCloseTo(140, 6);
    expect(c.y).toBeLessThan(0); // dragged up, so it points up
  });

  it("points down when dragged down, and works from right to left", () => {
    const down = draftOutline("triangle", at(140, 0), at(0, 30))!;
    expect(down.points[2].y).toBeGreaterThan(0);
    expect(down.points[0].x).toBe(0);
    expect(draftOutline("triangle", at(0, 0), at(0.3, 50))).toBeNull();
  });
});

describe("reshaping with the round dots", () => {
  it("makes an obtuse triangle by dragging the apex sideways", () => {
    const stretched = moveVertex(triangle, 2, at(-120, -40))!;
    expect(stretched.points[2]).toEqual(at(-120, -40));
    expect(stretched.points[0]).toEqual(at(0, 0));
    const [a, b, c] = stretched.points;
    const angleAtA = Math.acos(((b.x - a.x) * (c.x - a.x) + (b.y - a.y) * (c.y - a.y)) / (distance(a, b) * distance(a, c)));
    expect(angleAtA).toBeGreaterThan(Math.PI / 2);
  });

  it("will not collapse a room to a line, or touch an oval's points", () => {
    expect(moveVertex(triangle, 2, at(70, 0))).toBeNull();
    expect(moveVertex(circle, 0, at(0, 0))).toBeNull();
    expect(moveVertex(triangle, 9, at(0, 0))).toBeNull();
  });

  it("adds a dot on an edge and takes one away, never below three", () => {
    const edge = edgeAt(square, at(70, 3), 8)!;
    expect(edge.index).toBe(0);
    expect(edge.point).toEqual(at(70, 0));
    const five = insertVertex(square, edge.index, edge.point)!;
    expect(five.points).toHaveLength(5);
    expect(five.points[1]).toEqual(at(70, 0));
    expect(removeVertex(five, 1)!.points).toHaveLength(4);
    expect(removeVertex(triangle, 0)).toBeNull();
    expect(insertVertex(circle, 0, at(0, 0))).toBeNull();
    expect(edgeAt(square, at(70, 60), 8)).toBeNull();
  });

  it("drops doors that were on a wall that moved, and keeps the rest", () => {
    let doc = docWith(square);
    const top = nearestWall(doc.rooms, at(70, 2), 10)!;
    const bottom = nearestWall(doc.rooms, at(70, 138), 10)!;
    doc = addOpening(doc, openingOnWall(grid, top, "door", "cell", "top"));
    doc = addOpening(doc, openingOnWall(grid, bottom, "door", "cell", "bottom"));
    const moved = replaceRoom(doc, moveVertex(square, 0, at(-30, -30))!);
    expect(moved.openings.map((o) => o.id)).toEqual(["bottom"]);
    expect(replaceRoom(doc, { ...square, id: "missing" })).toBe(doc);
  });
});

describe("stretching with the square handles", () => {
  const handle = (room: Room, index: number) => scaleHandles(room, 0)[index].p;
  const E = 3;
  const SE = 4;
  const N = 1;

  it("keeps eight handles outside the box, corners and middles", () => {
    const handles = scaleHandles(square, 12);
    expect(handles[0].p).toEqual(at(-12, -12));
    expect(handles[4].p).toEqual(at(152, 152));
    expect(handles[1].p).toEqual(at(70, -12));
    expect(handles[3].p).toEqual(at(152, 70));
  });

  it("stretches one way from an edge handle", () => {
    const doc = docWith(square);
    const next = scaleRoom(doc, "s", E, at(280, 999), false)!;
    expect(boundsOf(next.rooms[0].points)).toEqual({ x0: 0, y0: 0, x1: 280, y1: 140 });
    expect(doc.rooms[0]).toBe(square); // the original is untouched
  });

  it("stretches both ways from a corner, or keeps proportions with Shift", () => {
    const doc = docWith(square);
    expect(boundsOf(scaleRoom(doc, "s", SE, at(280, 210), false)!.rooms[0].points)).toEqual({ x0: 0, y0: 0, x1: 280, y1: 210 });
    expect(boundsOf(scaleRoom(doc, "s", SE, at(280, 210), true)!.rooms[0].points)).toEqual({ x0: 0, y0: 0, x1: 280, y1: 280 });
  });

  it("stretches a triangle's shape with it", () => {
    const doc = docWith(triangle);
    const next = scaleRoom(doc, "t", E, at(280, 0), false)!.rooms[0];
    expect(next.points[1]).toEqual(at(280, 0));
    expect(next.points[2].x).toBeCloseTo(140, 6); // the apex stays over the middle of the base
    expect(next.points[2].y).toBeCloseTo(triangle.points[2].y, 6);
  });

  it("turns a circle into an oval, rebuilt from its new box", () => {
    const doc = docWith(circle);
    const oval = scaleRoom(doc, "c", E, at(600, 300), false)!.rooms[0];
    expect(oval.ellipse).toEqual({ x0: 200, y0: 200, x1: 600, y1: 400 });
    expect(oval.points).toEqual(ellipsePoints(oval.ellipse!));
    expect(boundsOf(oval.points).x1).toBeCloseTo(600, 6);
    expect(handle(oval, 3).x).toBe(600);
  });

  it("carries doors along, and moves a circle's box when the room moves", () => {
    let doc = docWith(square);
    doc = addOpening(doc, openingOnWall(grid, nearestWall(doc.rooms, at(70, 2), 10)!, "door", "cell", "d"));
    const wider = scaleRoom(doc, "s", E, at(280, 70), false)!;
    expect(wider.openings[0].a.x).toBeCloseTo(2 * doc.openings[0].a.x, 6);
    expect(pruneOpenings(wider)).toBe(wider); // still on the wall

    const shifted = moveRoom(docWith(circle), "c", 50, -20).rooms[0];
    expect(shifted.ellipse).toEqual({ x0: 250, y0: 180, x1: 450, y1: 380 });
    expect(shifted.points[0]).toEqual(at(350, 180));
  });

  it("refuses to shrink a room away, or to change nothing", () => {
    const doc = docWith(square);
    const tiny = scaleRoom(doc, "s", E, at(-500, 70), false)!.rooms[0];
    expect(boundsOf(tiny.points).x1 - boundsOf(tiny.points).x0).toBeGreaterThanOrEqual(10);
    expect(scaleRoom(doc, "s", E, at(140, 70), false)).toBeNull();
    expect(scaleRoom(doc, "s", 12, at(0, 0), false)).toBeNull();
    expect(scaleRoom(doc, "nope", E, at(0, 0), false)).toBeNull();
    expect(isValidOutline(scaleRoom(doc, "s", N, at(70, 138), false)!.rooms[0].points)).toBe(true);
  });
});

describe("doors on curved walls", () => {
  it("puts a one-cell door on a circle, with both ends on the wall", () => {
    const door = openingOnCurve(grid, circle, at(398, 300), "door", "d");
    expect(distance(door.a, door.b)).toBeGreaterThan(60);
    expect(distance(door.a, door.b)).toBeLessThanOrEqual(70);
    for (const end of [door.a, door.b]) expect(distance(end, at(300, 300))).toBeCloseTo(100, 0);
    expect((door.a.x + door.b.x) / 2).toBeGreaterThan(390);
    const doc = addOpening(docWith(circle), door);
    expect(pruneOpenings(doc).openings).toHaveLength(1);
  });

  it("moves with the circle, and goes when the circle is stretched past it", () => {
    const door = openingOnCurve(grid, circle, at(398, 300), "door", "d");
    const doc = addOpening(docWith(circle), door);
    expect(moveRoom(doc, "c", 70, 0).openings[0].a.x).toBeCloseTo(door.a.x + 70, 6);
    const stretched = scaleRoom(doc, "c", 3, at(600, 300), false)!;
    expect(stretched.openings[0].a.x).toBeGreaterThan(door.a.x); // carried with the wall
    expect(pruneOpenings(stretched).openings).toHaveLength(1);
  });

  it("fits a small round room", () => {
    const tiny = roomFrom("tiny", draftOutline("circle", at(0, 0), at(20, 0)));
    const door = openingOnCurve(grid, tiny, at(20, 0), "window", "w");
    // A door is at most a quarter of the way round, so it can never wrap a small room.
    expect(distance(door.a, door.b)).toBeLessThanOrEqual((2 * Math.PI * 20) / 4 + 1);
    expect(distance(door.a, door.b)).toBeGreaterThan(20);
  });
});

describe("saving circles and triangles", () => {
  it("round-trips them", () => {
    const doc = docWith(circle, triangle);
    expect(parse(serialize(doc))).toEqual(doc);
  });

  it("rebuilds an oval's points from its box, so they cannot disagree", () => {
    const raw = JSON.parse(serialize(docWith(circle)));
    raw.rooms[0].points = [at(0, 0), at(5, 0), at(5, 5)]; // stale points
    expect(parse(JSON.stringify(raw)).rooms[0].points).toEqual(circle.points);
  });

  it("ignores a damaged box and falls back to the points", () => {
    const raw = JSON.parse(serialize(docWith(circle)));
    raw.rooms[0].ellipse = { x0: 5, y0: 5, x1: 5, y1: 9 };
    const opened = parse(JSON.stringify(raw)).rooms[0];
    expect(opened.ellipse).toBeUndefined();
    expect(opened.points).toEqual(circle.points);
  });
});
