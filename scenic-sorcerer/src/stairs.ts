// Stairs: a stamp the editor draws itself. A run of steps in a floor material, shaded so you can see which way it
// climbs, with an optional arrow. Drawing only; the stamp's position, turn and size come from the Stamp it belongs to.

import { FLOORS, type FloorId, type StairsSpec } from "./model";

export const MIN_STEPS = 2;
export const MAX_STEPS = 24;

export function clampSteps(value: number): number {
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.round(Number.isFinite(value) ? value : 8)));
}

/** A stairs description read from saved data, or null if it cannot be trusted. */
export function parseStairs(raw: unknown): StairsSpec | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const material = FLOORS.find((f) => f.id === item.material);
  if (!material || material.id === "plain") return null;
  const dir = item.dir === "down" || item.dir === "none" ? item.dir : "up";
  return { steps: clampSteps(Number(item.steps)), material: material.id, dir };
}

/** Ready-made stairs for the stamp list. Sizes are in cells: the steps run along the length. */
export interface StairsPreset {
  id: string;
  name: string;
  widthCells: number;
  lengthCells: number;
  spec: StairsSpec;
}

const preset = (id: string, name: string, widthCells: number, lengthCells: number, steps: number, material: FloorId, dir: StairsSpec["dir"]): StairsPreset => ({
  id: `stairs-${id}`,
  name,
  widthCells,
  lengthCells,
  spec: { steps, material, dir },
});

export const STAIRS_PRESETS: StairsPreset[] = [
  preset("stone-up", "Stone stairs, up", 2, 3, 8, "stone", "up"),
  preset("stone-down", "Stone stairs, down", 2, 3, 8, "stone", "down"),
  preset("stone-wide", "Wide stone stairs", 4, 3, 8, "stone", "up"),
  preset("stone-narrow", "Narrow stone steps", 1, 2, 5, "stone", "up"),
  preset("wood", "Wooden stairs", 1, 3, 10, "wood", "up"),
  preset("wood-wide", "Wide wooden steps", 2, 2, 6, "wood", "none"),
  preset("metal", "Metal stairs", 1, 3, 12, "metal", "up"),
  preset("rock-down", "Rocky steps, down", 2, 3, 7, "rock", "down"),
  preset("moss-down", "Mossy stairs, down", 2, 3, 8, "moss", "down"),
  preset("ice", "Icy stairs", 2, 3, 8, "ice", "up"),
  preset("snow", "Snowy steps", 2, 2, 6, "snow", "none"),
  preset("dirt", "Dirt steps", 2, 2, 5, "dirt", "none"),
];

/**
 * Draw stairs centred on the origin, `width` across and `length` long, with the steps running along the length.
 * The top end is the one the arrow points to. When going up, that end is the high one (lit); going down, it is the low one.
 */
export function drawStairs(
  ctx: CanvasRenderingContext2D,
  spec: StairsSpec,
  width: number,
  length: number,
  cellPx: number,
  fill: CanvasPattern | string,
): void {
  const n = clampSteps(spec.steps);
  const left = -width / 2;
  const top = -length / 2;
  const step = length / n;
  const line = Math.max(1, cellPx * 0.03);
  const rail = Math.min(width * 0.12, cellPx * 0.1);

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, length);
  ctx.clip();

  for (let i = 0; i < n; i++) {
    const y = top + i * step;
    // How high this step is, from 0 (lowest) to 1 (highest).
    const height = spec.dir === "down" ? (n === 1 ? 0.5 : i / (n - 1)) : n === 1 ? 0.5 : 1 - i / (n - 1);
    ctx.fillStyle = fill;
    ctx.fillRect(left, y, width, step + 0.5);
    const tone = (height - 0.5) * 0.55;
    ctx.fillStyle = tone > 0 ? `rgba(255, 255, 255, ${tone})` : `rgba(0, 0, 0, ${-tone})`;
    ctx.fillRect(left, y, width, step + 0.5);

    // The riser casts a shadow onto the step below it, whichever way the stairs climb.
    const lowEdgeIsBottom = spec.dir !== "down";
    const edgeY = lowEdgeIsBottom ? y + step : y;
    const shade = ctx.createLinearGradient(0, edgeY, 0, edgeY + (lowEdgeIsBottom ? -1 : 1) * step * 0.45);
    shade.addColorStop(0, "rgba(10, 6, 2, 0.42)");
    shade.addColorStop(1, "rgba(10, 6, 2, 0)");
    ctx.fillStyle = shade;
    ctx.fillRect(left, lowEdgeIsBottom ? y + step * 0.55 : y, width, step * 0.45);

    // A bright lip on the nosing and a dark line along the joint.
    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    ctx.fillRect(left, lowEdgeIsBottom ? y : y + step - line, width, line);
    ctx.fillStyle = "rgba(15, 10, 5, 0.55)";
    ctx.fillRect(left, y + step - line / 2, width, line);
  }

  // Side walls.
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fillRect(left, top, rail, length);
  ctx.fillRect(left + width - rail, top, rail, length);
  ctx.restore();

  ctx.save();
  ctx.lineWidth = Math.max(1.5, cellPx * 0.045);
  ctx.strokeStyle = "rgba(30, 24, 18, 0.9)";
  ctx.lineJoin = "round";
  ctx.strokeRect(left, top, width, length);
  ctx.restore();

  if (spec.dir !== "none") drawArrow(ctx, width, length, cellPx);
}

/** An arrow along the middle pointing to the top end. */
function drawArrow(ctx: CanvasRenderingContext2D, width: number, length: number, cellPx: number): void {
  const head = Math.min(width * 0.55, cellPx * 0.55);
  const reach = Math.min(length * 0.5, cellPx * 1.7);
  const tail = reach / 2;
  const tipY = -reach / 2;
  const stem = Math.max(2, head * 0.22);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-stem / 2, tail);
  ctx.lineTo(-stem / 2, tipY + head * 0.7);
  ctx.lineTo(-head / 2, tipY + head * 0.7);
  ctx.lineTo(0, tipY);
  ctx.lineTo(head / 2, tipY + head * 0.7);
  ctx.lineTo(stem / 2, tipY + head * 0.7);
  ctx.lineTo(stem / 2, tail);
  ctx.closePath();
  ctx.fillStyle = "rgba(246, 238, 220, 0.72)";
  ctx.strokeStyle = "rgba(30, 24, 18, 0.7)";
  ctx.lineWidth = Math.max(1, cellPx * 0.03);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
