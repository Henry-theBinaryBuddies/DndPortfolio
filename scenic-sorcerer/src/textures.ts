// Floor textures, painted by code so the editor needs no image files.
// Each texture is a seamless tile two cells wide, cached and used as a canvas pattern.

import { FLOORS, type FloorId } from "./model";

const DETAIL = 2; // tile pixels per map pixel, so floors stay crisp when zoomed in
const cache = new Map<string, CanvasPattern | string>();

/** A fill style for a floor. Patterns are in map pixels, so they scale with the map. */
export function floorFill(ctx: CanvasRenderingContext2D, id: FloorId, cellPx: number): CanvasPattern | string {
  const key = `${id}:${cellPx}`;
  let fill = cache.get(key);
  if (!fill) {
    fill = makeFill(ctx, id, cellPx);
    cache.set(key, fill);
  }
  return fill;
}

function makeFill(ctx: CanvasRenderingContext2D, id: FloorId, cellPx: number): CanvasPattern | string {
  const base = FLOORS.find((f) => f.id === id)?.color ?? "#888";
  if (id === "plain") return base;
  const size = cellPx * 2;
  const tile = document.createElement("canvas");
  tile.width = tile.height = size * DETAIL;
  const t = tile.getContext("2d")!;
  t.scale(DETAIL, DETAIL);
  t.fillStyle = base;
  t.fillRect(0, 0, size, size);
  const random = seeded(id.length * 7919 + id.charCodeAt(0));
  PAINTERS[id](t, size, cellPx, random);
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return base;
  pattern.setTransform(new DOMMatrix().scale(1 / DETAIL));
  return pattern;
}

type Painter = (t: CanvasRenderingContext2D, size: number, cell: number, random: () => number) => void;

const PAINTERS: Record<Exclude<FloorId, "plain">, Painter> = {
  stone(t, size, cell, random) {
    const slab = cell / 2;
    for (let y = 0; y < size; y += slab) {
      for (let x = 0; x < size; x += slab) {
        t.fillStyle = shade(random() * 0.1 - 0.05);
        t.fillRect(x, y, slab, slab);
      }
    }
    speckle(t, size, random, 1400, 1.6);
    t.strokeStyle = "rgba(40, 36, 30, 0.45)";
    t.lineWidth = 1.2;
    t.beginPath();
    for (let v = 0; v <= size; v += slab) {
      t.moveTo(v, 0);
      t.lineTo(v, size);
      t.moveTo(0, v);
      t.lineTo(size, v);
    }
    t.stroke();
  },

  wood(t, size, cell, random) {
    const plank = cell / 4;
    for (let y = 0; y < size; y += plank) {
      // Two planks per row; the second wraps round the tile edge so the pattern is seamless.
      const cut1 = random() * size;
      const cut2 = (cut1 + size * (0.35 + random() * 0.3)) % size;
      const [lo, hi] = cut1 < cut2 ? [cut1, cut2] : [cut2, cut1];
      const inner = shade(random() * 0.2 - 0.1);
      const outer = shade(random() * 0.2 - 0.1);
      t.fillStyle = outer;
      t.fillRect(0, y, size, plank);
      t.fillStyle = inner;
      t.fillRect(lo, y, hi - lo, plank);
      t.strokeStyle = "rgba(60, 35, 15, 0.18)";
      t.lineWidth = 0.6;
      for (let g = 0; g < 3; g++) {
        const gy = y + 2 + random() * (plank - 4);
        t.beginPath();
        t.moveTo(0, gy);
        t.lineTo(size, gy);
        t.stroke();
      }
      t.strokeStyle = "rgba(40, 22, 8, 0.55)";
      t.lineWidth = 1;
      t.beginPath();
      t.moveTo(0, y);
      t.lineTo(size, y);
      t.moveTo(lo, y);
      t.lineTo(lo, y + plank);
      t.moveTo(hi, y);
      t.lineTo(hi, y + plank);
      t.stroke();
    }
  },

  dirt(t, size, _cell, random) {
    for (let i = 0; i < 60; i++) {
      const dark = random() < 0.5;
      t.fillStyle = dark ? "rgba(50, 32, 15, 0.07)" : "rgba(255, 235, 200, 0.06)";
      const radius = 4 + (i % 9) * 1.5;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.arc(x, y, radius, 0, Math.PI * 2);
        t.fill();
      });
    }
    speckle(t, size, random, 1800, 1.8);
  },

  grass(t, size, _cell, random) {
    speckle(t, size, random, 900, 2.2);
    t.lineWidth = 1;
    for (let i = 0; i < 500; i++) {
      t.strokeStyle = random() < 0.5 ? "rgba(40, 80, 25, 0.35)" : "rgba(190, 225, 130, 0.3)";
      const lean = random() * 3 - 1.5;
      const height = 3 + random() * 4;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.moveTo(x, y);
        t.lineTo(x + lean, y - height);
        t.stroke();
      });
    }
  },

  water(t, size, _cell, random) {
    t.lineWidth = 1.4;
    t.lineCap = "round";
    for (let i = 0; i < 46; i++) {
      t.strokeStyle = random() < 0.7 ? "rgba(225, 245, 255, 0.3)" : "rgba(20, 60, 100, 0.2)";
      const length = 10 + random() * 16;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.moveTo(x, y);
        t.quadraticCurveTo(x + length / 2, y - 3, x + length, y);
        t.stroke();
      });
    }
  },
};

/** Draw something near the tile edge again on the far side, so it carries across the seam. */
function wrapped(size: number, x: number, y: number, drawAt: (x: number, y: number) => void): void {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) drawAt(x + ox, y + oy);
  }
}

function speckle(t: CanvasRenderingContext2D, size: number, random: () => number, count: number, maxSize: number): void {
  for (let i = 0; i < count; i++) {
    t.fillStyle = random() < 0.5 ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.08)";
    const s = 0.6 + random() * maxSize;
    t.fillRect(random() * size, random() * size, s, s);
  }
}

/** A translucent black or white wash: negative darkens, positive lightens. */
function shade(amount: number): string {
  return amount < 0 ? `rgba(0, 0, 0, ${-amount})` : `rgba(255, 255, 255, ${amount})`;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
