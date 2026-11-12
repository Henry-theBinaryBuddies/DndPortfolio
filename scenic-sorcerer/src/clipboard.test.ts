import { describe, expect, it } from "vitest";
import { newMap, type MapDoc, type Room, type Stamp } from "./model";
import { clipCentre, copyItem, pasteClip, reorder } from "./objects";
import { draftOutline, openingOnWall, nearestWall, rectPoints } from "./rooms";
import { parse, serialize } from "./storage";

let counter = 0;
const nextId = () => `n${++counter}`;
const stamp = (id: string, x: number, y: number): Stamp => ({ id, assetId: "a", x, y, width: 70, height: 70, rotation: 0.5, flip: true, tint: "#aa3311", shadow: true });

function withStamps(): MapDoc {
  return { ...newMap(), stamps: [stamp("s1", 100, 100), stamp("s2", 200, 100), stamp("s3", 300, 100)] };
}

describe("copy and paste", () => {
  it("pastes a stamp with its middle at the target, keeping everything else", () => {
    const doc = withStamps();
    const clip = copyItem(doc, "s1")!;
    const pasted = pasteClip(doc, clip, nextId, { x: 500, y: 420 })!;
    const copy = pasted.doc.stamps.find((s) => s.id === pasted.id)!;
    expect(copy).toMatchObject({ x: 500, y: 420, rotation: 0.5, flip: true, tint: "#aa3311", assetId: "a" });
    expect(pasted.id).not.toBe("s1");
    expect(pasted.doc.stamps).toHaveLength(4);
    expect(doc.stamps).toHaveLength(3); // the original map is untouched
  });

  it("makes a separate copy every time", () => {
    const doc = withStamps();
    const clip = copyItem(doc, "s1")!;
    const a = pasteClip(doc, clip, nextId, { x: 10, y: 10 })!;
    const b = pasteClip(a.doc, clip, nextId, { x: 10, y: 10 })!;
    expect(new Set(b.doc.stamps.map((s) => s.id)).size).toBe(5);
  });

  it("still pastes after the original is deleted", () => {
    const doc = withStamps();
    const clip = copyItem(doc, "s2")!;
    const gone = { ...doc, stamps: doc.stamps.filter((s) => s.id !== "s2") };
    expect(pasteClip(gone, clip, nextId, { x: 0, y: 0 })!.doc.stamps).toHaveLength(3);
  });

  it("copies a room with its doors, moved together", () => {
    const grid = newMap().grid;
    const room: Room = { id: "r1", points: rectPoints({ x: 0, y: 0 }, { x: 140, y: 140 })!, floor: "lava", walls: true };
    const base: MapDoc = { ...newMap(), rooms: [room] };
    const hit = nearestWall(base.rooms, { x: 70, y: 0 }, 20)!;
    const door = openingOnWall(grid, hit, "door", "cell", "d1")!;
    const doc: MapDoc = { ...base, openings: [door] };
    const clip = copyItem(doc, "r1")!;
    expect(clip.kind === "room" && clip.openings).toHaveLength(1);
    const centre = clipCentre(clip);
    expect(centre).toEqual({ x: 70, y: 70 });
    const pasted = pasteClip(doc, clip, nextId, { x: 570, y: 70 })!;
    expect(pasted.doc.rooms).toHaveLength(2);
    expect(pasted.doc.openings).toHaveLength(2);
    const copy = pasted.doc.rooms.find((r) => r.id === pasted.id)!;
    expect(copy.floor).toBe("lava");
    expect(copy.points[0]).toEqual({ x: 500, y: 0 });
    const newDoor = pasted.doc.openings.find((o) => o.id !== "d1")!;
    expect(newDoor.a.x - door.a.x).toBe(500);
  });

  it("moves a circle's box with it", () => {
    const room: Room = { id: "c1", ...draftOutline("circle", { x: 100, y: 100 }, { x: 170, y: 100 })!, floor: "stone", walls: true };
    const doc: MapDoc = { ...newMap(), rooms: [room] };
    const pasted = pasteClip(doc, copyItem(doc, "c1")!, nextId, { x: 400, y: 400 })!;
    const copy = pasted.doc.rooms.find((r) => r.id === pasted.id)!;
    expect(copy.ellipse).toEqual({ x0: 330, y0: 330, x1: 470, y1: 470 });
  });

  it("cannot copy a door or window on its own", () => {
    const grid = newMap().grid;
    const room: Room = { id: "r1", points: rectPoints({ x: 0, y: 0 }, { x: 140, y: 140 })!, floor: "stone", walls: true };
    const hit = nearestWall([room], { x: 70, y: 0 }, 20)!;
    const door = openingOnWall(grid, hit, "door", "cell", "d1");
    expect(copyItem({ ...newMap(), rooms: [room], openings: [door] }, "d1")).toBeNull();
    expect(copyItem(newMap(), "nothing")).toBeNull();
  });
});

describe("one-step layer order", () => {
  const ids = (d: MapDoc) => d.stamps.map((s) => s.id).join();
  it("moves a stamp up or down one place", () => {
    const doc = withStamps();
    expect(ids(reorder(doc, "s2", "down"))).toBe("s2,s1,s3");
    expect(ids(reorder(doc, "s2", "up"))).toBe("s1,s3,s2");
  });
  it("stops at the ends", () => {
    const doc = withStamps();
    expect(reorder(doc, "s1", "down")).toBe(doc);
    expect(reorder(doc, "s3", "up")).toBe(doc);
  });
  it("still sends all the way to the front or back", () => {
    const doc = withStamps();
    expect(ids(reorder(doc, "s1", "front"))).toBe("s2,s3,s1");
    expect(ids(reorder(doc, "s3", "back"))).toBe("s3,s1,s2");
  });
});

describe("new floors", () => {
  it("keep their floor when saved and opened", () => {
    for (const floor of ["snow", "ice", "moss", "rock", "forest", "magic", "lava", "metal"] as const) {
      const room: Room = { id: "r", points: rectPoints({ x: 0, y: 0 }, { x: 140, y: 140 })!, floor, walls: true };
      expect(parse(serialize({ ...newMap(), rooms: [room] })).rooms[0].floor).toBe(floor);
    }
  });
});
