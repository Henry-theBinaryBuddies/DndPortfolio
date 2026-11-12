// Paint strokes, stamps and the stamp library. Pure logic: every edit returns a new MapDoc.

import { snap } from "./grid";
import { LIMITS, type Asset, type Grid, type Label, type LabelStyle, type Light, type MapDoc, type Marker, type MarkerKind, type Opening, type Point, type Room, type SnapMode, type Stamp, type Stroke } from "./model";
import { boundsOf, closestOnSegment, distance, isOnRoom, moveRoom, removeItem } from "./rooms";

export type ItemKind = "room" | "opening" | "stamp" | "stroke" | "label" | "marker" | "light";

export function itemKind(doc: MapDoc, id: string | null): ItemKind | null {
  if (!id) return null;
  if (doc.markers.some((m) => m.id === id)) return "marker";
  if (doc.lights.some((l) => l.id === id)) return "light";
  if (doc.labels.some((l) => l.id === id)) return "label";
  if (doc.stamps.some((s) => s.id === id)) return "stamp";
  if (doc.openings.some((o) => o.id === id)) return "opening";
  if (doc.strokes.some((s) => s.id === id)) return "stroke";
  if (doc.rooms.some((r) => r.id === id)) return "room";
  return null;
}

// ---- stamps -----------------------------------------------------------

/** A stamp whose longest side is `longest` map pixels, keeping the picture's proportions. */
export function makeStamp(
  id: string,
  asset: Pick<Asset, "id" | "width" | "height">,
  centre: Point,
  longest: number,
  rotation: number,
  shadow: boolean,
): Stamp {
  const size = sized(asset.width, asset.height, longest);
  return { id, assetId: asset.id, x: centre.x, y: centre.y, ...size, rotation, flip: false, tint: null, shadow };
}

function sized(width: number, height: number, longest: number): { width: number; height: number } {
  const scale = longest / Math.max(width, height);
  return { width: width * scale, height: height * scale };
}

export function stampLongest(stamp: Stamp): number {
  return Math.max(stamp.width, stamp.height);
}

/** The same stamp scaled so its longest side is `longest`. */
export function resizeStamp(stamp: Stamp, longest: number): Stamp {
  return { ...stamp, ...sized(stamp.width, stamp.height, longest) };
}

/** Corners of the stamp's box on the map, after rotation. */
export function stampCorners(stamp: Stamp): Point[] {
  const cos = Math.cos(stamp.rotation);
  const sin = Math.sin(stamp.rotation);
  const hw = stamp.width / 2;
  const hh = stamp.height / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({
    x: stamp.x + x * cos - y * sin,
    y: stamp.y + x * sin + y * cos,
  }));
}

/** Is p inside the box of the given size centred on (cx, cy) and turned by `rotation`? */
function inTurnedBox(cx: number, cy: number, width: number, height: number, rotation: number, p: Point): boolean {
  const dx = p.x - cx;
  const dy = p.y - cy;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  return Math.abs(dx * cos - dy * sin) <= width / 2 && Math.abs(dx * sin + dy * cos) <= height / 2;
}

export function pointInStamp(stamp: Stamp, p: Point): boolean {
  return inTurnedBox(stamp.x, stamp.y, stamp.width, stamp.height, stamp.rotation, p);
}

/** The topmost stamp under p, or null. */
export function stampAt(stamps: Stamp[], p: Point): Stamp | null {
  for (let i = stamps.length - 1; i >= 0; i--) {
    if (pointInStamp(stamps[i], p)) return stamps[i];
  }
  return null;
}

/**
 * Where a stamp's centre snaps. Unlike walls, a full-cell snap puts it in the middle of a cell,
 * so a table or a tree sits in its square.
 */
export function stampSnap(grid: Grid, p: Point, mode: SnapMode): Point {
  if (mode === "cell" && grid.type === "square") {
    const d = grid.cellPx;
    return { x: (Math.floor(p.x / d) + 0.5) * d, y: (Math.floor(p.y / d) + 0.5) * d };
  }
  return snap(grid, p, mode);
}

export function addStamps(doc: MapDoc, stamps: Stamp[]): MapDoc {
  return stamps.length === 0 ? doc : { ...doc, stamps: [...doc.stamps, ...stamps] };
}

export function updateStamp(doc: MapDoc, id: string, change: (stamp: Stamp) => Stamp): MapDoc {
  const stamp = doc.stamps.find((s) => s.id === id);
  if (!stamp) return doc;
  return { ...doc, stamps: doc.stamps.map((s) => (s === stamp ? change(s) : s)) };
}

// ---- text -------------------------------------------------------------

export interface Box {
  width: number;
  height: number;
}
/** How big a label is on the map. Needs a canvas, so the caller supplies it. */
export type Measure = (label: Label) => Box;

export function makeLabel(id: string, text: string, centre: Point, style: LabelStyle): Label {
  return { ...style, id, text, x: centre.x, y: centre.y, rotation: 0 };
}

/** Corners of a label's box on the map, after rotation. */
export function labelCorners(label: Label, box: Box): Point[] {
  const cos = Math.cos(label.rotation);
  const sin = Math.sin(label.rotation);
  const hw = box.width / 2;
  const hh = box.height / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({
    x: label.x + x * cos - y * sin,
    y: label.y + x * sin + y * cos,
  }));
}

/** The topmost label under p, or null. `reach` widens the target so small text is easy to grab. */
export function labelAt(labels: Label[], p: Point, measure: Measure, reach: number): Label | null {
  for (let i = labels.length - 1; i >= 0; i--) {
    const label = labels[i];
    const box = measure(label);
    if (inTurnedBox(label.x, label.y, box.width + reach * 2, box.height + reach * 2, label.rotation, p)) return label;
  }
  return null;
}

export function addLabel(doc: MapDoc, label: Label): MapDoc {
  return { ...doc, labels: [...doc.labels, label] };
}

export function updateLabel(doc: MapDoc, id: string, change: (label: Label) => Label): MapDoc {
  const label = doc.labels.find((l) => l.id === id);
  if (!label) return doc;
  return { ...doc, labels: doc.labels.map((l) => (l === label ? change(l) : l)) };
}

// ---- lights -----------------------------------------------------------

export function makeLight(id: string, centre: Point, radius: number, color: string): Light {
  return { id, x: centre.x, y: centre.y, radius, color };
}

export function addLight(doc: MapDoc, light: Light): MapDoc {
  return { ...doc, lights: [...doc.lights, light] };
}

export function updateLight(doc: MapDoc, id: string, change: (light: Light) => Light): MapDoc {
  const light = doc.lights.find((l) => l.id === id);
  if (!light) return doc;
  return { ...doc, lights: doc.lights.map((l) => (l === light ? change(l) : l)) };
}

/** The topmost light whose icon (radius `reach`) contains p, or null. */
export function lightAt(lights: Light[], p: Point, reach: number): Light | null {
  for (let i = lights.length - 1; i >= 0; i--) {
    if (distance(p, lights[i]) <= reach) return lights[i];
  }
  return null;
}

// ---- GM markers -------------------------------------------------------

/** The number the next room-number marker should get. */
export function nextKeyNumber(markers: Marker[]): number {
  return markers.reduce((top, m) => (m.kind === "key" ? Math.max(top, m.number) : top), 0) + 1;
}

export function makeMarker(id: string, kind: MarkerKind, centre: Point, markers: Marker[]): Marker {
  return { id, kind, x: centre.x, y: centre.y, number: kind === "key" ? nextKeyNumber(markers) : 0, text: "" };
}

export function addMarker(doc: MapDoc, marker: Marker): MapDoc {
  return { ...doc, markers: [...doc.markers, marker] };
}

/** The topmost marker whose circle (radius `radius`) contains p, or null. */
export function markerAt(markers: Marker[], p: Point, radius: number): Marker | null {
  for (let i = markers.length - 1; i >= 0; i--) {
    if (distance(p, markers[i]) <= radius) return markers[i];
  }
  return null;
}

export function updateMarker(doc: MapDoc, id: string, change: (marker: Marker) => Marker): MapDoc {
  const marker = doc.markers.find((m) => m.id === id);
  if (!marker) return doc;
  return { ...doc, markers: doc.markers.map((m) => (m === marker ? change(m) : m)) };
}

/** Number the room markers 1, 2, 3... in reading order: top row first, left to right. */
export function renumberKeys(doc: MapDoc): MapDoc {
  const cell = doc.grid.cellPx;
  const keys = doc.markers
    .filter((m) => m.kind === "key")
    .sort((a, b) => Math.round(a.y / cell) - Math.round(b.y / cell) || a.x - b.x);
  const numbers = new Map(keys.map((m, i) => [m.id, i + 1]));
  const changed = keys.some((m) => m.number !== numbers.get(m.id));
  if (!changed) return doc;
  return { ...doc, markers: doc.markers.map((m) => (numbers.has(m.id) ? { ...m, number: numbers.get(m.id)! } : m)) };
}

// ---- paint ------------------------------------------------------------

export function addStroke(doc: MapDoc, stroke: Stroke): MapDoc {
  return stroke.points.length === 0 ? doc : { ...doc, strokes: [...doc.strokes, stroke] };
}

/** The topmost paint stroke under p, or null. */
export function strokeAt(strokes: Stroke[], p: Point, tolerance: number): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    const reach = stroke.size / 2 + tolerance;
    if (stroke.points.length === 1) {
      if (distance(p, stroke.points[0]) <= reach) return stroke;
      continue;
    }
    for (let j = 1; j < stroke.points.length; j++) {
      if (closestOnSegment(p, stroke.points[j - 1], stroke.points[j]).dist <= reach) return stroke;
    }
  }
  return null;
}

// ---- edits that work on any kind of thing ------------------------------

export function moveItem(doc: MapDoc, id: string, dx: number, dy: number): MapDoc {
  if (dx === 0 && dy === 0) return doc;
  switch (itemKind(doc, id)) {
    case "room":
      return moveRoom(doc, id, dx, dy);
    case "stamp":
      return updateStamp(doc, id, (s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
    case "stroke":
      return {
        ...doc,
        strokes: doc.strokes.map((s) =>
          s.id === id ? { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : s,
        ),
      };
    case "label":
      return updateLabel(doc, id, (l) => ({ ...l, x: l.x + dx, y: l.y + dy }));
    case "marker":
      return updateMarker(doc, id, (m) => ({ ...m, x: m.x + dx, y: m.y + dy }));
    case "light":
      return updateLight(doc, id, (l) => ({ ...l, x: l.x + dx, y: l.y + dy }));
    default:
      return doc; // doors and windows stay on their wall
  }
}

export function removeById(doc: MapDoc, id: string): MapDoc {
  switch (itemKind(doc, id)) {
    case "stamp":
      return { ...doc, stamps: doc.stamps.filter((s) => s.id !== id) };
    case "stroke":
      return { ...doc, strokes: doc.strokes.filter((s) => s.id !== id) };
    case "label":
      return { ...doc, labels: doc.labels.filter((l) => l.id !== id) };
    case "marker":
      return { ...doc, markers: doc.markers.filter((m) => m.id !== id) };
    case "light":
      return { ...doc, lights: doc.lights.filter((l) => l.id !== id) };
    default:
      return removeItem(doc, id);
  }
}

/** Put a stamp, paint stroke or room above or below the others on its layer. */
export type Order = "front" | "back" | "up" | "down";

export function reorder(doc: MapDoc, id: string, to: Order): MapDoc {
  // "up" and "down" move one place among items of the same kind; "front" and "back" move all the way.
  const move = <T extends { id: string }>(items: T[]): T[] => {
    const from = items.findIndex((i) => i.id === id);
    const target = to === "front" ? items.length - 1 : to === "back" ? 0 : to === "up" ? Math.min(from + 1, items.length - 1) : Math.max(from - 1, 0);
    if (from < 0 || target === from) return items;
    const rest = items.filter((_, i) => i !== from);
    rest.splice(target, 0, items[from]);
    return rest;
  };
  switch (itemKind(doc, id)) {
    case "stamp": {
      const stamps = move(doc.stamps);
      return stamps === doc.stamps ? doc : { ...doc, stamps };
    }
    case "stroke": {
      const strokes = move(doc.strokes);
      return strokes === doc.strokes ? doc : { ...doc, strokes };
    }
    case "room": {
      const rooms = move(doc.rooms);
      return rooms === doc.rooms ? doc : { ...doc, rooms };
    }
    case "label": {
      const labels = move(doc.labels);
      return labels === doc.labels ? doc : { ...doc, labels };
    }
    default:
      return doc;
  }
}

// ---- copy and paste ---------------------------------------------------

/** A copy of one item, kept apart from the map so it can be pasted later, even after the original is gone. */
export type Clip =
  | { kind: "stamp"; item: Stamp }
  | { kind: "label"; item: Label }
  | { kind: "marker"; item: Marker }
  | { kind: "light"; item: Light }
  | { kind: "stroke"; item: Stroke }
  | { kind: "room"; item: Room; openings: Opening[] };

/** Copy an item (a room takes its doors and windows along). Doors and windows alone cannot be copied. */
export function copyItem(doc: MapDoc, id: string): Clip | null {
  switch (itemKind(doc, id)) {
    case "stamp":
      return { kind: "stamp", item: doc.stamps.find((s) => s.id === id)! };
    case "label":
      return { kind: "label", item: doc.labels.find((l) => l.id === id)! };
    case "marker":
      return { kind: "marker", item: doc.markers.find((m) => m.id === id)! };
    case "light":
      return { kind: "light", item: doc.lights.find((l) => l.id === id)! };
    case "stroke":
      return { kind: "stroke", item: doc.strokes.find((s) => s.id === id)! };
    case "room": {
      const room = doc.rooms.find((r) => r.id === id)!;
      return { kind: "room", item: room, openings: doc.openings.filter((o) => isOnRoom(room, o)) };
    }
    default:
      return null;
  }
}

/** The middle of a copied item, which is the point that lands on the paste position. */
export function clipCentre(clip: Clip): Point {
  switch (clip.kind) {
    case "stroke":
    case "room": {
      const b = boundsOf(clip.item.points);
      return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    }
    default:
      return { x: clip.item.x, y: clip.item.y };
  }
}

/**
 * Put a copy on the map with its middle at `to`. Returns the new map and the id of the copy,
 * or null when the map is already full of that kind of thing.
 * Every call makes new ids, so pasting twice gives two separate copies.
 */
export function pasteClip(doc: MapDoc, clip: Clip, newId: () => string, to: Point): { doc: MapDoc; id: string } | null {
  const from = clipCentre(clip);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const id = newId();
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  switch (clip.kind) {
    case "stamp":
      if (doc.stamps.length >= LIMITS.maxStamps) return null;
      return { doc: { ...doc, stamps: [...doc.stamps, { ...clip.item, id, x: clip.item.x + dx, y: clip.item.y + dy }] }, id };
    case "label":
      if (doc.labels.length >= LIMITS.maxLabels) return null;
      return { doc: { ...doc, labels: [...doc.labels, { ...clip.item, id, x: clip.item.x + dx, y: clip.item.y + dy }] }, id };
    case "marker":
      if (doc.markers.length >= LIMITS.maxMarkers) return null;
      return { doc: { ...doc, markers: [...doc.markers, { ...clip.item, id, x: clip.item.x + dx, y: clip.item.y + dy }] }, id };
    case "light":
      if (doc.lights.length >= LIMITS.maxLights) return null;
      return { doc: { ...doc, lights: [...doc.lights, { ...clip.item, id, x: clip.item.x + dx, y: clip.item.y + dy }] }, id };
    case "stroke":
      if (doc.strokes.length >= LIMITS.maxStrokes) return null;
      return { doc: { ...doc, strokes: [...doc.strokes, { ...clip.item, id, points: clip.item.points.map(shift) }] }, id };
    case "room": {
      if (doc.rooms.length >= LIMITS.maxRooms) return null;
      const room: Room = {
        ...clip.item,
        id,
        points: clip.item.points.map(shift),
        ...(clip.item.ellipse
          ? { ellipse: { x0: clip.item.ellipse.x0 + dx, y0: clip.item.ellipse.y0 + dy, x1: clip.item.ellipse.x1 + dx, y1: clip.item.ellipse.y1 + dy } }
          : {}),
      };
      const openings = clip.openings.map((o) => ({ ...o, id: newId(), a: shift(o.a), b: shift(o.b) }));
      return { doc: { ...doc, rooms: [...doc.rooms, room], openings: [...doc.openings, ...openings] }, id };
    }
  }
}

// ---- stamp library ----------------------------------------------------

/** A display name from a file name: "Oak_Table-02.png" -> "Oak Table 02". */
export function assetName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base.slice(0, 60) || "Untitled";
}

/** Library entries matching every word of the search (in the name or group), favourites first, then by name. A group limits it to that group. */
export function filterAssets(assets: Asset[], query: string, favouritesOnly: boolean, group = ""): Asset[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return assets
    .filter((a) => (!favouritesOnly || a.favourite) && (!group || a.group === group))
    .filter((a) => words.every((w) => `${a.name} ${a.group ?? ""}`.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.name.localeCompare(b.name));
}

/** The pictures used by stamps on any level. */
export function usedAssetIds(doc: MapDoc): Set<string> {
  const stamps = [...doc.stamps, ...doc.levels.flatMap((l) => l.content?.stamps ?? [])];
  return new Set(stamps.map((s) => s.assetId));
}
