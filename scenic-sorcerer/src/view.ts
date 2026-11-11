// The viewport: how map pixels are placed on screen. Pure functions over an immutable View.

import type { Point, Size } from "./grid";

export interface View {
  /** Screen position of the map's top-left corner, in CSS pixels. */
  x: number;
  y: number;
  /** Screen pixels per map pixel. */
  scale: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

export function screenToMap(v: View, p: Point): Point {
  return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}

export function mapToScreen(v: View, p: Point): Point {
  return { x: p.x * v.scale + v.x, y: p.y * v.scale + v.y };
}

/** Zoom by a factor while keeping the map point under `anchor` (a screen point) fixed. */
export function zoomAt(v: View, anchor: Point, factor: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const applied = scale / v.scale;
  return { scale, x: anchor.x - (anchor.x - v.x) * applied, y: anchor.y - (anchor.y - v.y) * applied };
}

export function pan(v: View, dx: number, dy: number): View {
  return { ...v, x: v.x + dx, y: v.y + dy };
}

/** Centre the whole map in the screen with a margin around it. */
export function fit(map: Size, screen: Size, margin = 40): View {
  const availW = Math.max(1, screen.width - margin * 2);
  const availH = Math.max(1, screen.height - margin * 2);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(availW / map.width, availH / map.height)));
  return {
    scale,
    x: (screen.width - map.width * scale) / 2,
    y: (screen.height - map.height * scale) / 2,
  };
}
