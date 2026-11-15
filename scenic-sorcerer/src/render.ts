// Draws the map onto a canvas. Reads the document and view; changes nothing.

import { cellPolygon, mapSize } from "./grid";
import { FONTS, WALL_RATIO, type Label, type Light, type Room, type MapDoc, type Marker, type Opening, type Point, type Stamp, type Stroke } from "./model";
import type { LightCache } from "./lighting";
import { labelCorners, stampCorners, type Box } from "./objects";
import { HANDLE_PAD_PX, boundsOf, scaleHandles, vertexHandles } from "./rooms";
import { drawStairs } from "./stairs";
import { floorFill } from "./textures";
import type { View } from "./view";

const COLORS = {
  backdrop: "#1d1f24",
  paper: "#efe6d2",
  paperEdge: "#3a3327",
  grid: "rgba(40, 34, 24, 0.34)",
  wall: "#2b2620",
  door: "#b9833f",
  windowFrame: "#e9e2d0",
  windowGlass: "#7fc4e4",
  accent: "#e0803a",
  gmKey: "#b3261e",
  gmTrap: "#c77700",
  gmSecret: "#6a3ea1",
  gmNote: "#1f6aa5",
  draftFill: "rgba(224, 128, 58, 0.18)",
};

/** Multiplies the opacity of everything drawn, so a level can be shown faintly. */
let dim = 1;

export interface Scene {
  doc: MapDoc;
  view: View;
  /** Snapped cursor position in map pixels, or null when there is nothing to show. */
  snapPoint: Point | null;
  selectedId: string | null;
  /** Outline being drawn right now (a rectangle mid-drag, or a shape room so far). */
  draft: Point[] | null;
  /** Door or window that a click would place. */
  ghost: Opening | null;
  /** Paint stroke being drawn right now. */
  draftStroke: Stroke | null;
  /** Stamp that a click would place. */
  ghostStamp: Stamp | null;
  /** GM marker that a click would place. */
  ghostMarker: Marker | null;
  /** Outline of the brush under the cursor. */
  brushRing: { x: number; y: number; radius: number } | null;
  /** Show the map as it looks by light, with darkness where no light reaches. */
  lighting: boolean;
  lightCache: LightCache;
  /** The level underneath, to show faintly behind this one, or null. */
  below: MapDoc | null;
  /** Light that a click would place. */
  ghostLight: Light | null;
  /** How big a label is on the map, so its selection box can be drawn. */
  measure: (label: Label) => Box;
  /** The picture for a stamp, or null while it loads or if it is missing from the library. */
  image: (assetId: string, tint: string | null) => CanvasImageSource | null;
}

export function render(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number, scene: Scene): void {
  const { doc, view } = scene;
  const px = 1 / view.scale; // one screen pixel, in map pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.backdrop;
  ctx.fillRect(0, 0, width, height);

  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);

  const size = mapSize(doc.grid);
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, size.width, size.height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size.width, size.height);
  ctx.clip();
  const layers = doc.layers;
  if (scene.below) drawBelow(ctx, scene, dpr, px);
  if (layers.floors.visible) drawFloors(ctx, doc);
  if (layers.paint.visible) {
    for (const stroke of doc.strokes) drawStroke(ctx, doc, stroke);
    if (scene.draftStroke) drawStroke(ctx, doc, scene.draftStroke);
  }
  if (layers.walls.visible) {
    drawWalls(ctx, doc);
    for (const opening of doc.openings) drawOpening(ctx, doc, opening, 1);
    if (scene.ghost) drawOpening(ctx, doc, scene.ghost, 0.6);
  }
  if (layers.objects.visible) {
    // Shadow sizes are in screen pixels, so scale them with the zoom.
    const shadowScale = doc.grid.cellPx * view.scale * dpr;
    for (const stamp of doc.stamps) drawStamp(ctx, scene, stamp, 1, shadowScale, px, doc.grid.cellPx);
    if (scene.ghostStamp) drawStamp(ctx, scene, scene.ghostStamp, 0.6, shadowScale, px, doc.grid.cellPx);
  }
  if (doc.showGrid) drawGrid(ctx, doc, px);
  if (layers.labels.visible) {
    for (const label of doc.labels) drawLabel(ctx, label);
  }
  if (scene.lighting) drawLighting(ctx, scene, width, height, dpr);
  if (layers.lights.visible) {
    for (const light of doc.lights) drawLightIcon(ctx, doc, light, 1, px);
    if (scene.ghostLight) drawLightIcon(ctx, doc, scene.ghostLight, 0.6, px);
  }
  if (layers.gm.visible) {
    for (const marker of doc.markers) drawMarker(ctx, doc, marker, 1);
    if (scene.ghostMarker) drawMarker(ctx, doc, scene.ghostMarker, 0.6);
  }
  ctx.restore();

  ctx.lineWidth = 2 * px;
  ctx.strokeStyle = COLORS.paperEdge;
  ctx.strokeRect(0, 0, size.width, size.height);

  drawSelection(ctx, scene, px);
  drawDraft(ctx, scene, px);

  if (scene.brushRing) {
    ctx.beginPath();
    ctx.arc(scene.brushRing.x, scene.brushRing.y, scene.brushRing.radius, 0, Math.PI * 2);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = COLORS.accent;
    ctx.stroke();
  }

  if (scene.snapPoint) {
    ctx.beginPath();
    ctx.arc(scene.snapPoint.x, scene.snapPoint.y, 4.5 * px, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.accent;
    ctx.fill();
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }
}

function outline(ctx: CanvasRenderingContext2D, points: Point[], close: boolean): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}

function drawFloors(ctx: CanvasRenderingContext2D, doc: MapDoc): void {
  for (const room of doc.rooms) {
    outline(ctx, room.points, true);
    ctx.fillStyle = floorFill(ctx, room.floor, doc.grid.cellPx);
    ctx.fill();
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, doc: MapDoc, stroke: Stroke): void {
  const fill = floorFill(ctx, stroke.texture, doc.grid.cellPx);
  ctx.save();
  ctx.globalAlpha = stroke.opacity * dim;
  if (stroke.points.length === 1) {
    ctx.beginPath();
    ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  } else {
    outline(ctx, stroke.points, false);
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = fill;
    ctx.stroke();
  }
  ctx.restore();
}

function drawStamp(ctx: CanvasRenderingContext2D, scene: Scene, stamp: Stamp, alpha: number, shadowScale: number, px: number, cellPx: number): void {
  const image = stamp.stairs ? null : scene.image(stamp.assetId, stamp.tint);
  ctx.save();
  ctx.globalAlpha = alpha * dim;
  ctx.translate(stamp.x, stamp.y);
  ctx.rotate(stamp.rotation);
  if (stamp.stairs) {
    if (stamp.flip) ctx.scale(-1, 1);
    drawStairs(ctx, stamp.stairs, stamp.width, stamp.height, cellPx, floorFill(ctx, stamp.stairs.material, cellPx));
  } else if (image) {
    if (stamp.flip) ctx.scale(-1, 1);
    if (stamp.shadow) {
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = shadowScale * 0.1;
      ctx.shadowOffsetX = shadowScale * 0.05;
      ctx.shadowOffsetY = shadowScale * 0.07;
    }
    ctx.drawImage(image, -stamp.width / 2, -stamp.height / 2, stamp.width, stamp.height);
  } else {
    // The picture is still loading, or is not in this browser's library.
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = COLORS.wall;
    ctx.fillStyle = "rgba(43, 38, 32, 0.12)";
    ctx.fillRect(-stamp.width / 2, -stamp.height / 2, stamp.width, stamp.height);
    ctx.strokeRect(-stamp.width / 2, -stamp.height / 2, stamp.width, stamp.height);
  }
  ctx.restore();
}

/** The canvas font string for a label. */
function labelFont(label: Label): string {
  const stack = FONTS.find((f) => f.id === label.font)?.stack ?? "serif";
  const weight = label.font === "bold" ? "" : "600 ";
  return `${label.italic ? "italic " : ""}${weight}${Math.round(label.size)}px ${stack}`;
}

function setLabelText(ctx: CanvasRenderingContext2D, label: Label): void {
  ctx.font = labelFont(label);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = `${(label.spacing * label.size).toFixed(2)}px`;
}

/** How big a label is on the map, text and spacing included. */
export function measureLabel(ctx: CanvasRenderingContext2D, label: Label): Box {
  ctx.save();
  setLabelText(ctx, label);
  const width = ctx.measureText(label.text || " ").width;
  ctx.restore();
  return { width, height: label.size * 1.25 };
}

/** A halo colour that contrasts with the text: light round dark text, dark round light text. */
function haloFor(color: string): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "rgba(30, 24, 16, 0.85)" : "rgba(246, 240, 224, 0.9)";
}

function drawLabel(ctx: CanvasRenderingContext2D, label: Label): void {
  if (!label.text) return;
  ctx.save();
  ctx.translate(label.x, label.y);
  ctx.rotate(label.rotation);
  setLabelText(ctx, label);
  if (label.outline) {
    ctx.lineWidth = label.size * 0.2;
    ctx.lineJoin = "round";
    ctx.strokeStyle = haloFor(label.color);
    ctx.strokeText(label.text, 0, 0);
  }
  ctx.fillStyle = label.color;
  ctx.fillText(label.text, 0, 0);
  ctx.restore();
}

/** Radius of a GM marker, in map pixels. */
export function markerRadius(doc: MapDoc): number {
  return doc.grid.cellPx * 0.3;
}

function drawMarker(ctx: CanvasRenderingContext2D, doc: MapDoc, marker: Marker, alpha: number): void {
  const r = markerRadius(doc);
  const color = { key: COLORS.gmKey, trap: COLORS.gmTrap, secret: COLORS.gmSecret, note: COLORS.gmNote }[marker.kind];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(marker.x, marker.y);
  ctx.beginPath();
  if (marker.kind === "trap") {
    ctx.moveTo(0, -r * 1.15);
    ctx.lineTo(r * 1.05, r * 0.85);
    ctx.lineTo(-r * 1.05, r * 0.85);
    ctx.closePath();
  } else if (marker.kind === "note") {
    ctx.roundRect(-r, -r, r * 2, r * 2, r * 0.3);
  } else {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = r * 0.14;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  const glyph = { key: String(marker.number), trap: "!", secret: "S", note: "i" }[marker.kind];
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(r * (glyph.length > 2 ? 0.85 : 1.15))}px system-ui, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "0px";
  ctx.fillText(glyph, 0, marker.kind === "trap" ? r * 0.2 : r * 0.04);
  ctx.restore();
}

function drawWalls(ctx: CanvasRenderingContext2D, doc: MapDoc): void {
  ctx.lineWidth = doc.grid.cellPx * WALL_RATIO;
  ctx.lineJoin = "miter";
  ctx.miterLimit = 3; // sharp corners are cut off instead of growing long spikes
  ctx.strokeStyle = COLORS.wall;
  for (const room of doc.rooms) {
    if (!room.walls) continue;
    outline(ctx, room.points, true);
    ctx.stroke();
  }
}

function drawOpening(ctx: CanvasRenderingContext2D, doc: MapDoc, o: Opening, alpha: number): void {
  const wall = doc.grid.cellPx * WALL_RATIO;
  const length = Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y);
  if (length === 0) return;
  ctx.save();
  ctx.globalAlpha = alpha * dim;
  ctx.translate(o.a.x, o.a.y);
  ctx.rotate(Math.atan2(o.b.y - o.a.y, o.b.x - o.a.x));
  ctx.lineWidth = wall * 0.18;
  ctx.strokeStyle = COLORS.wall;
  if (o.kind === "door") {
    const t = wall * 1.25;
    ctx.fillStyle = COLORS.door;
    ctx.fillRect(0, -t / 2, length, t);
    ctx.strokeRect(0, -t / 2, length, t);
  } else {
    ctx.fillStyle = COLORS.windowFrame;
    ctx.fillRect(0, -wall / 2, length, wall);
    ctx.strokeRect(0, -wall / 2, length, wall);
    ctx.fillStyle = COLORS.windowGlass;
    ctx.fillRect(0, -wall * 0.18, length, wall * 0.36);
  }
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, doc: MapDoc, px: number): void {
  const g = doc.grid;
  ctx.lineWidth = px;
  ctx.strokeStyle = COLORS.grid;
  ctx.beginPath();
  if (g.type === "square") {
    const w = g.cols * g.cellPx;
    const h = g.rows * g.cellPx;
    for (let c = 1; c < g.cols; c++) {
      ctx.moveTo(c * g.cellPx, 0);
      ctx.lineTo(c * g.cellPx, h);
    }
    for (let r = 1; r < g.rows; r++) {
      ctx.moveTo(0, r * g.cellPx);
      ctx.lineTo(w, r * g.cellPx);
    }
  } else {
    for (let row = 0; row < g.rows; row++) {
      for (let col = 0; col < g.cols; col++) {
        const pts = cellPolygon(g, col, row);
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
      }
    }
  }
  ctx.stroke();
}

function drawSelection(ctx: CanvasRenderingContext2D, scene: Scene, px: number): void {
  if (!scene.selectedId) return;
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 3 * px;
  ctx.lineJoin = "round";
  ctx.setLineDash([8 * px, 5 * px]);
  const room = scene.doc.rooms.find((r) => r.id === scene.selectedId);
  const opening = scene.doc.openings.find((o) => o.id === scene.selectedId);
  const stamp = scene.doc.stamps.find((s) => s.id === scene.selectedId);
  const stroke = scene.doc.strokes.find((s) => s.id === scene.selectedId);
  const label = scene.doc.labels.find((l) => l.id === scene.selectedId);
  const marker = scene.doc.markers.find((m) => m.id === scene.selectedId);
  const light = scene.doc.lights.find((l) => l.id === scene.selectedId);
  if (light) {
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(light.x, light.y, light.radius, 0, Math.PI * 2);
    ctx.stroke();
  } else if (label) {
    ctx.lineWidth = 2 * px;
    outline(ctx, labelCorners(label, scene.measure(label)), true);
    ctx.stroke();
  } else if (marker) {
    ctx.lineWidth = 3 * px;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, markerRadius(scene.doc) * 1.35, 0, Math.PI * 2);
    ctx.stroke();
  } else if (room) {
    outline(ctx, room.points, true);
    ctx.stroke();
  } else if (stamp) {
    ctx.lineWidth = 2 * px;
    outline(ctx, stampCorners(stamp), true);
    ctx.stroke();
  } else if (stroke) {
    if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
    } else {
      outline(ctx, stroke.points, false);
    }
    ctx.stroke();
  } else if (opening) {
    ctx.lineWidth = 5 * px;
    outline(ctx, [opening.a, opening.b], false);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (room) drawHandles(ctx, room, px);
}

/** Round dots reshape a room; square handles, on a box round it, stretch it. */
function drawHandles(ctx: CanvasRenderingContext2D, room: Room, px: number): void {
  const pad = HANDLE_PAD_PX * px;
  const b = room.ellipse ?? boundsOf(room.points);
  ctx.lineWidth = px;
  ctx.strokeStyle = "rgba(224, 128, 58, 0.6)";
  ctx.setLineDash([4 * px, 4 * px]);
  ctx.strokeRect(b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + pad * 2, b.y1 - b.y0 + pad * 2);
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = COLORS.accent;
  ctx.fillStyle = "#fff";
  const half = 4.5 * px;
  for (const { p } of scaleHandles(room, pad)) {
    ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
    ctx.strokeRect(p.x - half, p.y - half, half * 2, half * 2);
  }
  for (const p of vertexHandles(room)) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawDraft(ctx: CanvasRenderingContext2D, scene: Scene, px: number): void {
  const draft = scene.draft;
  if (!draft || draft.length === 0) return;
  ctx.lineJoin = "round";
  if (draft.length >= 3) {
    outline(ctx, draft, true);
    ctx.fillStyle = COLORS.draftFill;
    ctx.fill();
  }
  outline(ctx, draft, false);
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 2.5 * px;
  ctx.stroke();
  for (const p of draft.slice(0, -1)) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 * px, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
  }
}

/** The level underneath, drawn faintly so rooms can be lined up with it. */
function drawBelow(ctx: CanvasRenderingContext2D, scene: Scene, dpr: number, px: number): void {
  const below = scene.below!;
  const shadowScale = below.grid.cellPx * scene.view.scale * dpr;
  dim = 0.28;
  ctx.save();
  ctx.globalAlpha = dim;
  drawFloors(ctx, below);
  for (const stroke of below.strokes) drawStroke(ctx, below, stroke);
  drawWalls(ctx, below);
  for (const opening of below.openings) drawOpening(ctx, below, opening, 1);
  for (const stamp of below.stamps) drawStamp(ctx, scene, stamp, 1, shadowScale, px, below.grid.cellPx);
  ctx.restore();
  dim = 1;
}

/** Radius of a light's icon, in map pixels. */
export function lightIconRadius(doc: MapDoc): number {
  return doc.grid.cellPx * 0.2;
}

function drawLightIcon(ctx: CanvasRenderingContext2D, doc: MapDoc, light: Light, alpha: number, px: number): void {
  const r = lightIconRadius(doc);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(light.x, light.y);
  ctx.lineCap = "round";
  ctx.strokeStyle = light.color;
  ctx.lineWidth = Math.max(r * 0.22, 1.5 * px);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.moveTo(Math.cos(a) * r * 1.45, Math.sin(a) * r * 1.45);
    ctx.lineTo(Math.cos(a) * r * 2, Math.sin(a) * r * 2);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = light.color;
  ctx.fill();
  ctx.lineWidth = Math.max(r * 0.18, 1.5 * px);
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.restore();
}

function pathPolygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

function rgba(hex: string, alpha: number): string {
  return `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${alpha})`;
}

let darkness: HTMLCanvasElement | null = null;

/**
 * Show the map by lamplight. A warm glow is added round each light; then a dark sheet is laid over the map
 * with a hole cut for each light, shaped by the walls it cannot see through.
 */
function drawLighting(ctx: CanvasRenderingContext2D, scene: Scene, width: number, height: number, dpr: number): void {
  const { doc, view } = scene;
  const size = mapSize(doc.grid);
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (!darkness || darkness.width !== w || darkness.height !== h) {
    darkness = document.createElement("canvas");
    darkness.width = w;
    darkness.height = h;
  }
  const sheet = darkness.getContext("2d")!;
  sheet.setTransform(1, 0, 0, 1, 0, 0);
  sheet.globalCompositeOperation = "source-over";
  sheet.clearRect(0, 0, w, h);
  sheet.setTransform(dpr, 0, 0, dpr, 0, 0);
  sheet.translate(view.x, view.y);
  sheet.scale(view.scale, view.scale);
  sheet.fillStyle = `rgba(8, 10, 28, ${doc.ambient})`;
  sheet.fillRect(0, 0, size.width, size.height);

  for (const light of doc.lights) {
    const area = scene.lightCache.polygonFor(doc, light);
    if (area.length < 3) continue;
    const reach = light.radius;

    ctx.save();
    pathPolygon(ctx, area);
    ctx.clip();
    const glow = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, reach);
    glow.addColorStop(0, rgba(light.color, 0.42));
    glow.addColorStop(1, rgba(light.color, 0)); // a plain tint: it colours the floor without washing it out
    ctx.fillStyle = glow;
    ctx.fillRect(light.x - reach, light.y - reach, reach * 2, reach * 2);
    ctx.restore();

    sheet.save();
    pathPolygon(sheet, area);
    sheet.clip();
    sheet.globalCompositeOperation = "destination-out";
    const hole = sheet.createRadialGradient(light.x, light.y, 0, light.x, light.y, reach);
    hole.addColorStop(0, "rgba(0, 0, 0, 1)");
    hole.addColorStop(0.55, "rgba(0, 0, 0, 0.9)");
    hole.addColorStop(1, "rgba(0, 0, 0, 0)");
    sheet.fillStyle = hole;
    sheet.fillRect(light.x - reach, light.y - reach, reach * 2, reach * 2);
    sheet.restore();
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(darkness, 0, 0);
  ctx.restore();
}

export interface ExportRender {
  /** Output pixels per map pixel. */
  scale: number;
  /** Draw the grid lines. */
  grid: boolean;
  /** Draw the GM notes and the light icons. */
  gm: boolean;
  /** Bake the darkness and light into the picture. */
  lighting: boolean;
}

/**
 * Draw the finished map, with none of the editor's handles, onto a canvas sized to the whole map at `opts.scale`.
 * Layers that are hidden stay hidden. The level below is never drawn.
 */
export function renderExport(
  ctx: CanvasRenderingContext2D,
  doc: MapDoc,
  opts: ExportRender,
  image: Scene["image"],
  lightCache: LightCache,
): void {
  const size = mapSize(doc.grid);
  const px = 1 / opts.scale;
  const scene: Scene = {
    doc,
    view: { x: 0, y: 0, scale: 1 },
    snapPoint: null,
    selectedId: null,
    draft: null,
    ghost: null,
    draftStroke: null,
    ghostStamp: null,
    ghostMarker: null,
    ghostLight: null,
    brushRing: null,
    lighting: opts.lighting,
    lightCache,
    below: null,
    measure: () => ({ width: 0, height: 0 }),
    image,
  };
  ctx.setTransform(opts.scale, 0, 0, opts.scale, 0, 0);
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size.width, size.height);
  ctx.clip();
  const layers = doc.layers;
  if (layers.floors.visible) drawFloors(ctx, doc);
  if (layers.paint.visible) for (const stroke of doc.strokes) drawStroke(ctx, doc, stroke);
  if (layers.walls.visible) {
    drawWalls(ctx, doc);
    for (const opening of doc.openings) drawOpening(ctx, doc, opening, 1);
  }
  if (layers.objects.visible) {
    const shadowScale = doc.grid.cellPx * opts.scale;
    for (const stamp of doc.stamps) drawStamp(ctx, scene, stamp, 1, shadowScale, px, doc.grid.cellPx);
  }
  if (opts.grid) drawGrid(ctx, doc, px);
  if (layers.labels.visible) for (const label of doc.labels) drawLabel(ctx, label);
  if (opts.lighting) drawLighting(ctx, scene, size.width, size.height, opts.scale);
  if (opts.gm && layers.lights.visible) for (const light of doc.lights) drawLightIcon(ctx, doc, light, 1, px);
  if (opts.gm && layers.gm.visible) for (const marker of doc.markers) drawMarker(ctx, doc, marker, 1);
  ctx.restore();
}
