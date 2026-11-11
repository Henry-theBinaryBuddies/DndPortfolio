// Draws the map onto a canvas. Reads the document and view; changes nothing.

import { cellPolygon, mapSize } from "./grid";
import { WALL_RATIO, type MapDoc, type Opening, type Point } from "./model";
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
  draftFill: "rgba(224, 128, 58, 0.18)",
};

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
  drawFloors(ctx, doc);
  drawGrid(ctx, doc, px);
  drawWalls(ctx, doc);
  for (const opening of doc.openings) drawOpening(ctx, doc, opening, 1);
  if (scene.ghost) drawOpening(ctx, doc, scene.ghost, 0.6);
  ctx.restore();

  ctx.lineWidth = 2 * px;
  ctx.strokeStyle = COLORS.paperEdge;
  ctx.strokeRect(0, 0, size.width, size.height);

  drawSelection(ctx, scene, px);
  drawDraft(ctx, scene, px);

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
  ctx.globalAlpha = alpha;
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
  if (room) {
    outline(ctx, room.points, true);
    ctx.stroke();
  } else if (opening) {
    ctx.lineWidth = 5 * px;
    outline(ctx, [opening.a, opening.b], false);
    ctx.stroke();
  }
  ctx.setLineDash([]);
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
