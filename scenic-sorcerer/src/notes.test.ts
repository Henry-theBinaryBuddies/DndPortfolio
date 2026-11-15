import { describe, expect, it } from "vitest";
import { LABEL_PRESETS, newMap, type Label, type LabelStyle, type MapDoc } from "./model";
import {
  addLabel,
  addMarker,
  itemKind,
  labelAt,
  labelCorners,
  makeLabel,
  makeMarker,
  markerAt,
  moveItem,
  nextKeyNumber,
  removeById,
  renumberKeys,
  reorder,
  updateLabel,
  updateMarker,
  type Measure,
} from "./objects";
import { parse, serialize } from "./storage";

const style: LabelStyle = { ...LABEL_PRESETS[0].style, size: 30 };
const measure: Measure = (l) => ({ width: l.text.length * 10, height: l.size * 1.25 });
const at = (x: number, y: number) => ({ x, y });

function sample(): MapDoc {
  let doc = newMap(); // square, 70 px cells
  doc = addLabel(doc, makeLabel("l1", "Throne Room", at(300, 300), style)); // 110 x 37.5 box
  doc = addLabel(doc, makeLabel("l2", "Hall", at(310, 300), style));
  doc = addMarker(doc, makeMarker("k1", "key", at(700, 140), doc.markers));
  doc = addMarker(doc, makeMarker("k2", "key", at(100, 140), doc.markers));
  doc = addMarker(doc, makeMarker("t1", "trap", at(400, 400), doc.markers));
  return doc;
}

describe("text labels", () => {
  it("takes the look it is given and starts upright", () => {
    const l = makeLabel("a", "Hi", at(5, 6), style);
    expect(l).toMatchObject({ id: "a", text: "Hi", x: 5, y: 6, rotation: 0, font: "book", size: 30 });
  });

  it("finds the topmost label under a point, with a little extra reach", () => {
    const doc = sample();
    expect(labelAt(doc.labels, at(300, 300), measure, 0)?.id).toBe("l2"); // drawn later, so on top
    expect(labelAt(doc.labels, at(260, 300), measure, 0)?.id).toBe("l1"); // only the long label reaches here
    expect(labelAt(doc.labels, at(300, 330), measure, 0)).toBeNull(); // below the box
    expect(labelAt(doc.labels, at(300, 330), measure, 20)?.id).toBe("l2");
  });

  it("finds a turned label by its turned box", () => {
    const l: Label = { ...makeLabel("a", "Long label here", at(0, 0), style), rotation: Math.PI / 2 };
    expect(labelAt([l], at(0, 60), measure, 0)?.id).toBe("a"); // 150 wide, now pointing down
    expect(labelAt([l], at(60, 0), measure, 0)).toBeNull();
    const corners = labelCorners(l, measure(l));
    expect(corners[0].x).toBeCloseTo(18.75, 6);
    expect(corners[0].y).toBeCloseTo(-75, 6);
  });

  it("edits one label and leaves the rest", () => {
    const doc = sample();
    const next = updateLabel(doc, "l1", (l) => ({ ...l, text: "Vault", color: "#aa0000" }));
    expect(next.labels[0]).toMatchObject({ text: "Vault", color: "#aa0000" });
    expect(next.labels[1]).toBe(doc.labels[1]);
    expect(updateLabel(doc, "nope", (l) => l)).toBe(doc);
  });
});

describe("GM markers", () => {
  it("numbers room markers one after another, and gives other kinds no number", () => {
    const doc = sample();
    expect(doc.markers.map((m) => [m.id, m.number])).toEqual([["k1", 1], ["k2", 2], ["t1", 0]]);
    expect(nextKeyNumber(doc.markers)).toBe(3);
    expect(nextKeyNumber([])).toBe(1);
  });

  it("carries on from the highest number, even after a gap", () => {
    const doc = removeById(sample(), "k1");
    expect(nextKeyNumber(doc.markers)).toBe(3);
  });

  it("renumbers in reading order, rows first", () => {
    const doc = sample(); // k1 is on the right, k2 on the left, same row
    const fixed = renumberKeys(doc);
    expect(fixed.markers.map((m) => [m.id, m.number])).toEqual([["k1", 2], ["k2", 1], ["t1", 0]]);
    expect(renumberKeys(fixed)).toBe(fixed);
    const lower = addMarker(fixed, makeMarker("k3", "key", at(20, 700), fixed.markers));
    expect(renumberKeys(lower).markers.find((m) => m.id === "k3")?.number).toBe(3);
  });

  it("finds the topmost marker under a point", () => {
    const doc = sample();
    expect(markerAt(doc.markers, at(405, 395), 21)?.id).toBe("t1");
    expect(markerAt(doc.markers, at(450, 450), 21)).toBeNull();
  });

  it("edits one marker", () => {
    const doc = updateMarker(sample(), "k1", (m) => ({ ...m, text: "Goblin barracks" }));
    expect(doc.markers[0].text).toBe("Goblin barracks");
    expect(updateMarker(doc, "nope", (m) => m)).toBe(doc);
  });
});

describe("text and markers as items", () => {
  it("knows what an id belongs to", () => {
    const doc = sample();
    expect([itemKind(doc, "l1"), itemKind(doc, "k1"), itemKind(doc, "t1")]).toEqual(["label", "marker", "marker"]);
  });

  it("moves, deletes and reorders them without touching the original", () => {
    const doc = sample();
    const frozen = JSON.stringify(doc);
    expect(moveItem(doc, "l1", 10, -5).labels[0]).toMatchObject({ x: 310, y: 295 });
    expect(moveItem(doc, "t1", 70, 0).markers[2]).toMatchObject({ x: 470, y: 400 });
    expect(removeById(doc, "l1").labels.map((l) => l.id)).toEqual(["l2"]);
    expect(removeById(doc, "k1").markers.map((m) => m.id)).toEqual(["k2", "t1"]);
    expect(reorder(doc, "l1", "front").labels.map((l) => l.id)).toEqual(["l2", "l1"]);
    expect(reorder(doc, "l2", "front")).toBe(doc);
    expect(JSON.stringify(doc)).toBe(frozen);
  });
});

describe("saving text and markers", () => {
  it("round-trips them", () => {
    let doc = updateMarker(sample(), "k1", (m) => ({ ...m, text: "Goblin barracks" }));
    doc = updateLabel(doc, "l1", (l) => ({ ...l, italic: true, spacing: 0.2, rotation: 0.5, outline: false }));
    expect(parse(serialize(doc))).toEqual(doc);
  });

  it("opens an older map with no text or markers, and the new layers on", () => {
    const old = JSON.stringify({ app: "scenic-sorcerer", version: 1, name: "Old", grid: newMap().grid });
    expect(parse(old)).toMatchObject({ labels: [], markers: [], layers: newMap().layers });
  });

  it("skips damaged ones and tidies the rest", () => {
    const raw = JSON.parse(serialize(sample()));
    raw.labels.push({ id: "x", text: "no size", x: 0, y: 0, size: 0 });
    raw.labels.push({ id: "y", text: 5, x: 0, y: 0, size: 20 });
    raw.labels.push({ id: "z", text: "z".repeat(500), x: 0, y: 0, size: 20, font: "comic", color: "red", spacing: 9 });
    raw.markers.push({ id: "m1", kind: "dragon", x: 0, y: 0 });
    raw.markers.push({ id: "m2", kind: "trap", x: 0, y: "far" });
    raw.markers.push({ id: "m3", kind: "trap", x: 1, y: 1, number: 7, text: 42 });
    raw.markers[0].number = 5000;
    const opened = parse(JSON.stringify(raw));
    expect(opened.labels.map((l) => l.id)).toEqual(["l1", "l2", "z"]);
    expect(opened.labels[2]).toMatchObject({ font: "classic", color: "#2b2620", spacing: 0 });
    expect(opened.labels[2].text).toHaveLength(120);
    expect(opened.markers.map((m) => m.id)).toEqual(["k1", "k2", "t1", "m3"]);
    expect(opened.markers[0].number).toBe(999);
    expect(opened.markers[3]).toMatchObject({ number: 0, text: "" });
  });
});
