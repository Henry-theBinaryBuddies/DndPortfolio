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
  const spec: StairsSpec = { steps: clampSteps(Number(item.steps)), material: material.id, dir };
  if (item.shape === "spiral") {
    spec.shape = "spiral";
    if (item.turn === "ccw") spec.turn = "ccw";
  }
  return spec;
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

const spiral = (id: string, name: string, cells: number, steps: number, material: FloorId, dir: StairsSpec["dir"], turn: "cw" | "ccw"): StairsPreset => ({
  id: `stairs-${id}`,
  name,
  widthCells: cells,
  lengthCells: cells,
  spec: { steps, material, dir, shape: "spiral", ...(turn === "ccw" ? { turn } : {}) },
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
  spiral("spiral-stone-up", "Spiral stairs, up", 2, 12, "stone", "up", "cw"),
  spiral("spiral-stone-down", "Spiral stairs, down", 2, 12, "stone", "down", "ccw"),
  spiral("spiral-stone-wide", "Wide spiral stairs", 3, 16, "stone", "up", "cw"),
  spiral("spiral-wood", "Wooden spiral stairs", 2, 12, "wood", "up", "cw"),
  spiral("spiral-metal", "Metal spiral stairs", 2, 12, "metal", "up", "ccw"),
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
  if (spec.shape === "spiral") {
    drawSpiral(ctx, spec, Math.min(width, length) / 2, cellPx, fill);
    return;
  }
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
    const tone = (height - 0.5) * 0.85;
    ctx.fillStyle = tone > 0 ? `rgba(255, 255, 255, ${tone})` : `rgba(0, 0, 0, ${-tone})`;
    ctx.fillRect(left, y, width, step + 0.5);

    // The higher end is the top for stairs going up, the bottom for stairs going down. Each step is in the shadow of the
    // higher step next to it, so the shade falls from that edge across the tread.
    const highIsTop = spec.dir !== "down";
    const hasHigherNeighbour = highIsTop ? i > 0 : i < n - 1;
    if (hasHigherNeighbour) {
      const edge = highIsTop ? y : y + step;
      const shade = ctx.createLinearGradient(0, edge, 0, edge + (highIsTop ? 1 : -1) * step * 0.7);
      shade.addColorStop(0, "rgba(8, 5, 2, 0.6)");
      shade.addColorStop(1, "rgba(8, 5, 2, 0)");
      ctx.fillStyle = shade;
      ctx.fillRect(left, highIsTop ? y : y + step * 0.3, width, step * 0.7);
    }

    // The nosing, where the tread turns down to the next step: a bright lip, then the dark joint under it.
    const nosing = highIsTop ? y + step : y;
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.fillRect(left, highIsTop ? nosing - line * 1.8 : nosing, width, line * 1.8);
    ctx.fillStyle = "rgba(15, 10, 5, 0.7)";
    ctx.fillRect(left, nosing - line / 2, width, line);
  }

  // Side walls.
  ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
  ctx.fillRect(left, top, rail, length);
  ctx.fillRect(left + width - rail, top, rail, length);
  const inner = ctx.createLinearGradient(left + rail, 0, left + rail + rail * 1.5, 0);
  inner.addColorStop(0, "rgba(0, 0, 0, 0.3)");
  inner.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = inner;
  ctx.fillRect(left + rail, top, rail * 1.5, length);
  const innerRight = ctx.createLinearGradient(left + width - rail, 0, left + width - rail * 2.5, 0);
  innerRight.addColorStop(0, "rgba(0, 0, 0, 0.3)");
  innerRight.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = innerRight;
  ctx.fillRect(left + width - rail * 2.5, top, rail * 1.5, length);
  ctx.restore();

  ctx.save();
  ctx.lineWidth = Math.max(1.5, cellPx * 0.045);
  ctx.strokeStyle = "rgba(30, 24, 18, 0.9)";
  ctx.lineJoin = "round";
  ctx.strokeRect(left, top, width, length);
  ctx.restore();

  if (spec.dir !== "none") drawArrow(ctx, width, length, cellPx);
}

/**
 * Spiral stairs centred on the origin: wedge-shaped steps round a pillar, the first one starting at the top and
 * winding clockwise (or not). Going up, each step is higher than the one before it along the turn; going down, lower.
 */
function drawSpiral(ctx: CanvasRenderingContext2D, spec: StairsSpec, radius: number, cellPx: number, fill: CanvasPattern | string): void {
  const n = clampSteps(spec.steps);
  const cw = spec.turn !== "ccw";
  const sign = cw ? 1 : -1;
  const sweep = (Math.PI * 2) / n;
  const start = -Math.PI / 2;
  const pillar = Math.max(radius * 0.16, cellPx * 0.1);
  const line = Math.max(1, cellPx * 0.03);
  const radial = (angle: number, from: number, to: number): void => {
    ctx.moveTo(Math.cos(angle) * from, Math.sin(angle) * from);
    ctx.lineTo(Math.cos(angle) * to, Math.sin(angle) * to);
  };

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();
  for (let i = 0; i < n; i++) {
    const a0 = start + sign * i * sweep;
    const a1 = a0 + sign * sweep;
    const wedge = (): void => {
      ctx.beginPath();
      ctx.arc(0, 0, radius, a0, a1, !cw);
      ctx.arc(0, 0, pillar, a1, a0, cw);
      ctx.closePath();
    };
    // 0 is the lowest step and 1 the highest.
    const along = n === 1 ? 0.5 : i / (n - 1);
    const height = spec.dir === "down" ? 1 - along : along;
    wedge();
    ctx.fillStyle = fill;
    ctx.fill();
    const tone = (height - 0.5) * 0.85;
    ctx.fillStyle = tone > 0 ? `rgba(255, 255, 255, ${tone})` : `rgba(0, 0, 0, ${-tone})`;
    ctx.fill();

    // Going up the next step's riser shades this one at its far edge; going down it is the near edge.
    ctx.save();
    wedge();
    ctx.clip();
    const shadeAt = spec.dir === "down" ? a0 : a1;
    ctx.lineCap = "butt";
    ctx.strokeStyle = "rgba(8, 5, 2, 0.4)";
    ctx.lineWidth = Math.max(2, radius * sweep * 0.55);
    ctx.beginPath();
    radial(shadeAt, pillar, radius);
    ctx.stroke();
    ctx.restore();

    // A bright lip on the near edge and a dark joint along the far one.
    ctx.lineWidth = line;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.beginPath();
    radial(a0, pillar, radius);
    ctx.stroke();
    ctx.strokeStyle = "rgba(15, 10, 5, 0.7)";
    ctx.beginPath();
    radial(a1, pillar, radius);
    ctx.stroke();
  }

  // The wall round the edge shades the treads beside it, and the post casts a shadow across the ones near it.
  const wall = ctx.createRadialGradient(0, 0, radius * 0.78, 0, 0, radius);
  wall.addColorStop(0, "rgba(0, 0, 0, 0)");
  wall.addColorStop(1, "rgba(0, 0, 0, 0.4)");
  ctx.fillStyle = wall;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  const cast = ctx.createRadialGradient(pillar * 0.35, pillar * 0.45, pillar * 0.8, pillar * 0.35, pillar * 0.45, pillar * 2.4);
  cast.addColorStop(0, "rgba(0, 0, 0, 0.45)");
  cast.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = cast;
  ctx.beginPath();
  ctx.arc(pillar * 0.35, pillar * 0.45, pillar * 2.4, 0, Math.PI * 2);
  ctx.fill();

  // The post in the middle.
  const post = ctx.createRadialGradient(-pillar * 0.3, -pillar * 0.3, pillar * 0.1, 0, 0, pillar);
  post.addColorStop(0, "rgba(150, 142, 130, 1)");
  post.addColorStop(1, "rgba(60, 54, 46, 1)");
  ctx.fillStyle = post;
  ctx.beginPath();
  ctx.arc(0, 0, pillar, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, cellPx * 0.03);
  ctx.strokeStyle = "rgba(20, 15, 10, 0.8)";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.lineWidth = Math.max(1.5, cellPx * 0.045);
  ctx.strokeStyle = "rgba(30, 24, 18, 0.9)";
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  if (spec.dir !== "none") drawCurvedArrow(ctx, (radius + pillar) / 2, sign, cellPx);
}

/** An arrow bending round the stairs in the direction they wind, centred on the top. */
function drawCurvedArrow(ctx: CanvasRenderingContext2D, radius: number, sign: number, cellPx: number): void {
  const span = 0.95;
  const t0 = -Math.PI / 2 - sign * span;
  const t1 = -Math.PI / 2 + sign * span;
  const width = Math.max(2, Math.min(cellPx * 0.12, radius * 0.18));
  const head = width * 3.2;
  // Stop the shaft short of the head, so the head's point is where the arrow ends.
  const shaftEnd = t1 - sign * (head * 0.6) / radius;
  ctx.save();
  ctx.lineCap = "round";
  for (const [color, w] of [["rgba(30, 24, 18, 0.7)", width + Math.max(1.5, cellPx * 0.05)], ["rgba(246, 238, 220, 0.78)", width]] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, radius, t0, shaftEnd, sign < 0);
    ctx.stroke();
  }
  const tipX = Math.cos(t1) * radius;
  const tipY = Math.sin(t1) * radius;
  const tx = -Math.sin(t1) * sign;
  const ty = Math.cos(t1) * sign;
  const nx = Math.cos(t1);
  const ny = Math.sin(t1);
  ctx.beginPath();
  ctx.moveTo(tipX + tx * head * 0.5, tipY + ty * head * 0.5);
  ctx.lineTo(tipX - tx * head * 0.5 + nx * head * 0.7, tipY - ty * head * 0.5 + ny * head * 0.7);
  ctx.lineTo(tipX - tx * head * 0.5 - nx * head * 0.7, tipY - ty * head * 0.5 - ny * head * 0.7);
  ctx.closePath();
  ctx.fillStyle = "rgba(246, 238, 220, 0.8)";
  ctx.strokeStyle = "rgba(30, 24, 18, 0.75)";
  ctx.lineWidth = Math.max(1, cellPx * 0.03);
  ctx.lineJoin = "round";
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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
