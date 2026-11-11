// Draws the map onto a canvas. Reads the document and view; changes nothing.

import { cellPolygon, mapSize, type Point } from "./grid";
import type { MapDoc } from "./model";
import type { View } from "./view";

const COLORS = {
  backdrop: "#1d1f24",
  paper: "#efe6d2",
  paperEdge: "#3a3327",
  grid: "rgba(58, 51, 39, 0.38)",
  snap: "#c2410c",
};

export interface Scene {
  doc: MapDoc;
  view: View;
  /** Snapped cursor position in map pixels, or null when the cursor is away. */
  snapPoint: Point | null;
}

export function render(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number, scene: Scene): void {
  const { doc, view } = scene;
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
  drawGrid(ctx, doc, view.scale);
  ctx.restore();

  ctx.lineWidth = 2 / view.scale;
  ctx.strokeStyle = COLORS.paperEdge;
  ctx.strokeRect(0, 0, size.width, size.height);

  if (scene.snapPoint) {
    ctx.beginPath();
    ctx.arc(scene.snapPoint.x, scene.snapPoint.y, 5 / view.scale, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.snap;
    ctx.fill();
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, doc: MapDoc, scale: number): void {
  const g = doc.grid;
  ctx.lineWidth = 1 / scale; // one screen pixel at any zoom
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
