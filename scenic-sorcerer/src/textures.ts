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

  snow(t, size, _cell, random) {
    // Soft drifts, a few blue shadows, and glints.
    for (let i = 0; i < 40; i++) {
      t.fillStyle = random() < 0.6 ? "rgba(255, 255, 255, 0.35)" : "rgba(150, 175, 205, 0.16)";
      const radius = 6 + random() * 16;
      const tilt = random() * 0.6 - 0.3;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.ellipse(x, y, radius * 1.6, radius, tilt, 0, Math.PI * 2);
        t.fill();
      });
    }
    for (let i = 0; i < 160; i++) {
      t.fillStyle = random() < 0.7 ? "rgba(255, 255, 255, 0.9)" : "rgba(130, 160, 200, 0.35)";
      const s = 0.6 + random() * 1.2;
      t.fillRect(random() * size, random() * size, s, s);
    }
  },

  ice(t, size, _cell, random) {
    // Pale sheen, then cracks that wander across the tile and carry over its edge.
    for (let i = 0; i < 14; i++) {
      t.fillStyle = random() < 0.5 ? "rgba(255, 255, 255, 0.16)" : "rgba(60, 130, 175, 0.1)";
      const radius = 14 + random() * 26;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.arc(x, y, radius, 0, Math.PI * 2);
        t.fill();
      });
    }
    t.lineCap = "round";
    for (let i = 0; i < 18; i++) {
      const x0 = random() * size;
      const y0 = random() * size;
      let angle = random() * Math.PI * 2;
      const steps = 3 + Math.floor(random() * 4);
      const points: [number, number][] = [[0, 0]];
      let px = 0;
      let py = 0;
      for (let s = 0; s < steps; s++) {
        angle += random() * 1.2 - 0.6;
        px += Math.cos(angle) * (8 + random() * 14);
        py += Math.sin(angle) * (8 + random() * 14);
        points.push([px, py]);
      }
      for (const [color, width] of [["rgba(40, 100, 150, 0.35)", 1.8], ["rgba(255, 255, 255, 0.8)", 0.7]] as const) {
        t.strokeStyle = color;
        t.lineWidth = width;
        wrapped(size, x0, y0, (x, y) => {
          t.beginPath();
          points.forEach(([dx, dy], k) => (k === 0 ? t.moveTo(x + dx, y + dy) : t.lineTo(x + dx, y + dy)));
          t.stroke();
        });
      }
    }
    speckle(t, size, random, 500, 1.2);
  },

  moss(t, size, cell, random) {
    // Old flagstones with moss creeping over them.
    PAINTERS.stone(t, size, cell, random);
    for (let i = 0; i < 70; i++) {
      t.fillStyle = ["rgba(70, 120, 45, 0.30)", "rgba(110, 150, 60, 0.26)", "rgba(40, 85, 40, 0.28)"][i % 3];
      const radius = 3 + random() * 11;
      const wobble = Array.from({ length: 7 }, () => 0.65 + random() * 0.5);
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        wobble.forEach((w, k) => {
          const a = (k / 7) * Math.PI * 2;
          if (k === 0) t.moveTo(x + Math.cos(a) * radius * w, y + Math.sin(a) * radius * w);
          else t.lineTo(x + Math.cos(a) * radius * w, y + Math.sin(a) * radius * w);
        });
        t.closePath();
        t.fill();
      });
    }
    for (let i = 0; i < 400; i++) {
      t.fillStyle = random() < 0.6 ? "rgba(120, 170, 70, 0.5)" : "rgba(30, 70, 30, 0.4)";
      const s = 0.6 + random() * 1.4;
      t.fillRect(random() * size, random() * size, s, s);
    }
  },

  rock(t, size, cell, random) {
    // Rough natural rock: lumps with light tops and dark outlines, and a few cracks.
    for (let i = 0; i < 46; i++) {
      const radius = cell * (0.1 + random() * 0.17);
      const tone = random() * 0.2 - 0.1;
      const wobble = Array.from({ length: 9 }, () => 0.75 + random() * 0.35);
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        wobble.forEach((w, k) => {
          const a = (k / 9) * Math.PI * 2;
          if (k === 0) t.moveTo(x + Math.cos(a) * radius * w, y + Math.sin(a) * radius * w);
          else t.lineTo(x + Math.cos(a) * radius * w, y + Math.sin(a) * radius * w);
        });
        t.closePath();
        t.fillStyle = shade(tone);
        t.fill();
        t.strokeStyle = "rgba(25, 20, 15, 0.26)";
        t.lineWidth = 0.9;
        t.stroke();
        t.fillStyle = "rgba(255, 255, 255, 0.1)";
        t.beginPath();
        t.arc(x - radius * 0.25, y - radius * 0.3, radius * 0.45, 0, Math.PI * 2);
        t.fill();
      });
    }
    t.strokeStyle = "rgba(20, 15, 10, 0.4)";
    t.lineWidth = 0.9;
    for (let i = 0; i < 14; i++) {
      const dx = random() * 18 - 9;
      const dy = random() * 18 - 9;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.moveTo(x, y);
        t.lineTo(x + dx, y + dy);
        t.lineTo(x + dx * 1.6 + 3, y + dy * 1.3 - 2);
        t.stroke();
      });
    }
    speckle(t, size, random, 900, 1.6);
  },

  forest(t, size, _cell, random) {
    // Leaf litter and pine needles over dark earth.
    for (let i = 0; i < 40; i++) {
      t.fillStyle = random() < 0.5 ? "rgba(20, 35, 15, 0.12)" : "rgba(120, 90, 40, 0.07)";
      const radius = 8 + random() * 16;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.arc(x, y, radius, 0, Math.PI * 2);
        t.fill();
      });
    }
    const leaves = ["rgba(120, 80, 30, 0.55)", "rgba(165, 110, 35, 0.5)", "rgba(60, 100, 40, 0.55)", "rgba(95, 60, 25, 0.5)", "rgba(185, 140, 50, 0.4)"];
    for (let i = 0; i < 230; i++) {
      t.fillStyle = leaves[i % leaves.length];
      const rotation = random() * Math.PI;
      const length = 2.2 + random() * 2.6;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.ellipse(x, y, length, length * 0.5, rotation, 0, Math.PI * 2);
        t.fill();
      });
    }
    t.lineWidth = 0.8;
    for (let i = 0; i < 180; i++) {
      t.strokeStyle = random() < 0.5 ? "rgba(150, 110, 50, 0.45)" : "rgba(30, 55, 25, 0.5)";
      const angle = random() * Math.PI;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.moveTo(x, y);
        t.lineTo(x + Math.cos(angle) * 5, y + Math.sin(angle) * 5);
        t.stroke();
      });
    }
  },

  magic(t, size, cell, random) {
    // Deep violet with glowing arcs, motes and small star glints.
    t.lineCap = "round";
    for (let i = 0; i < 9; i++) {
      const radius = cell * (0.25 + random() * 0.45);
      const start = random() * Math.PI * 2;
      const span = 1.2 + random() * 2.4;
      const cx = random() * size;
      const cy = random() * size;
      for (const [color, width] of [["rgba(160, 90, 255, 0.18)", 4], ["rgba(120, 220, 255, 0.55)", 1.1]] as const) {
        t.strokeStyle = color;
        t.lineWidth = width;
        wrapped(size, cx, cy, (x, y) => {
          t.beginPath();
          t.arc(x, y, radius, start, start + span);
          t.stroke();
        });
      }
    }
    for (let i = 0; i < 38; i++) {
      const glow = random() < 0.5 ? "190, 130, 255" : "120, 230, 255";
      const radius = 2 + random() * 5;
      wrapped(size, random() * size, random() * size, (x, y) => {
        const g = t.createRadialGradient(x, y, 0, x, y, radius);
        g.addColorStop(0, `rgba(${glow}, 0.9)`);
        g.addColorStop(1, `rgba(${glow}, 0)`);
        t.fillStyle = g;
        t.beginPath();
        t.arc(x, y, radius, 0, Math.PI * 2);
        t.fill();
      });
    }
    t.strokeStyle = "rgba(255, 255, 255, 0.85)";
    t.lineWidth = 0.7;
    for (let i = 0; i < 26; i++) {
      const arm = 1.5 + random() * 2.5;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.moveTo(x - arm, y);
        t.lineTo(x + arm, y);
        t.moveTo(x, y - arm);
        t.lineTo(x, y + arm);
        t.stroke();
      });
    }
  },

  lava(t, size, _cell, random) {
    // Glowing melt with dark crust plates floating on it.
    for (let i = 0; i < 30; i++) {
      t.fillStyle = random() < 0.5 ? "rgba(255, 190, 40, 0.28)" : "rgba(120, 20, 5, 0.3)";
      const radius = 8 + random() * 18;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.arc(x, y, radius, 0, Math.PI * 2);
        t.fill();
      });
    }
    for (let i = 0; i < 36; i++) {
      const radius = 7 + random() * 12;
      const wobble = Array.from({ length: 8 }, () => 0.7 + random() * 0.45);
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        wobble.forEach((w, k) => {
          const a = (k / 8) * Math.PI * 2;
          if (k === 0) t.moveTo(x + Math.cos(a) * radius * w, y + Math.sin(a) * radius * w);
          else t.lineTo(x + Math.cos(a) * radius * w, y + Math.sin(a) * radius * w);
        });
        t.closePath();
        t.fillStyle = "rgba(42, 20, 14, 0.94)";
        t.fill();
        t.strokeStyle = "rgba(255, 190, 50, 0.85)";
        t.lineWidth = 1.3;
        t.stroke();
      });
    }
    for (let i = 0; i < 120; i++) {
      t.fillStyle = random() < 0.5 ? "rgba(255, 230, 120, 0.8)" : "rgba(255, 120, 30, 0.7)";
      const s = 0.6 + random() * 1.4;
      t.fillRect(random() * size, random() * size, s, s);
    }
  },

  metal(t, size, cell, random) {
    // Riveted plates with bevelled edges, scratches and the odd stain.
    const plate = cell / 2;
    for (let y = 0; y < size; y += plate) {
      for (let x = 0; x < size; x += plate) {
        t.fillStyle = shade(random() * 0.1 - 0.05);
        t.fillRect(x, y, plate, plate);
        t.fillStyle = "rgba(255, 255, 255, 0.16)";
        t.fillRect(x, y, plate, 1.6);
        t.fillRect(x, y, 1.6, plate);
        t.fillStyle = "rgba(0, 0, 0, 0.3)";
        t.fillRect(x, y + plate - 1.6, plate, 1.6);
        t.fillRect(x + plate - 1.6, y, 1.6, plate);
        for (const [rx, ry] of [[4, 4], [plate - 4, 4], [4, plate - 4], [plate - 4, plate - 4]]) {
          t.fillStyle = "rgba(0, 0, 0, 0.35)";
          t.beginPath();
          t.arc(x + rx + 0.5, y + ry + 0.7, 1.7, 0, Math.PI * 2);
          t.fill();
          t.fillStyle = "rgba(235, 240, 245, 0.7)";
          t.beginPath();
          t.arc(x + rx, y + ry, 1.5, 0, Math.PI * 2);
          t.fill();
        }
      }
    }
    t.lineWidth = 0.6;
    for (let i = 0; i < 60; i++) {
      t.strokeStyle = random() < 0.5 ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.2)";
      const dx = random() * 12 - 6;
      const dy = random() * 4 - 2;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.moveTo(x, y);
        t.lineTo(x + dx, y + dy);
        t.stroke();
      });
    }
    for (let i = 0; i < 8; i++) {
      t.fillStyle = "rgba(90, 60, 30, 0.1)";
      const radius = 5 + random() * 10;
      wrapped(size, random() * size, random() * size, (x, y) => {
        t.beginPath();
        t.arc(x, y, radius, 0, Math.PI * 2);
        t.fill();
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
