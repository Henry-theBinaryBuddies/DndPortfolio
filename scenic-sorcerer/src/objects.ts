// Paint strokes, stamps and the stamp library. Pure logic: every edit returns a new MapDoc.

import { snap } from "./grid";
import type { Asset, Grid, MapDoc, Point, SnapMode, Stamp, Stroke } from "./model";
import { closestOnSegment, distance, moveRoom, removeItem } from "./rooms";

export type ItemKind = "room" | "opening" | "stamp" | "stroke";

export function itemKind(doc: MapDoc, id: string | null): ItemKind | null {
  if (!id) return null;
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

export function pointInStamp(stamp: Stamp, p: Point): boolean {
  const dx = p.x - stamp.x;
  const dy = p.y - stamp.y;
  const cos = Math.cos(-stamp.rotation);
  const sin = Math.sin(-stamp.rotation);
  return Math.abs(dx * cos - dy * sin) <= stamp.width / 2 && Math.abs(dx * sin + dy * cos) <= stamp.height / 2;
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
    default:
      return removeItem(doc, id);
  }
}

/** Put a stamp, paint stroke or room above or below the others on its layer. */
export function reorder(doc: MapDoc, id: string, to: "front" | "back"): MapDoc {
  const move = <T extends { id: string }>(items: T[]): T[] => {
    const item = items.find((i) => i.id === id)!;
    const rest = items.filter((i) => i !== item);
    const already = to === "front" ? items[items.length - 1] === item : items[0] === item;
    return already ? items : to === "front" ? [...rest, item] : [item, ...rest];
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
    default:
      return doc;
  }
}

// ---- stamp library ----------------------------------------------------

/** A display name from a file name: "Oak_Table-02.png" -> "Oak Table 02". */
export function assetName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base.slice(0, 60) || "Untitled";
}

/** Library entries matching every word of the search, favourites first, then by name. */
export function filterAssets(assets: Asset[], query: string, favouritesOnly: boolean): Asset[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return assets
    .filter((a) => (!favouritesOnly || a.favourite) && words.every((w) => a.name.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.name.localeCompare(b.name));
}

export function usedAssetIds(doc: MapDoc): Set<string> {
  return new Set(doc.stamps.map((s) => s.assetId));
}
