import type { Part } from "./printable";

// How far the print reaches, as the merge will leave it: the base whole, and every other part above the flat cut,
// where the merge trims it. A triangle that crosses the cut is trimmed to a new edge on the cut, and that edge can
// reach farther out than any of the part's own vertices above it (a lock hanging out past the cut, say), so the
// points where each edge crosses the cut are measured too. In the parts' own millimetres, Z up.

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function printBounds(parts: Part[], flatCut: number, withBase = true): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const take = (x: number, y: number, z: number) => {
    if (x < min[0]) min[0] = x;
    if (x > max[0]) max[0] = x;
    if (y < min[1]) min[1] = y;
    if (y > max[1]) max[1] = y;
    if (z < min[2]) min[2] = z;
    if (z > max[2]) max[2] = z;
  };
  for (const part of parts) {
    const v = part.positions;
    if (part.name === "base") {
      if (withBase) for (let i = 0; i < v.length; i += 3) take(v[i], v[i + 1], v[i + 2]);
      continue;
    }
    for (let i = 0; i < v.length; i += 3) if (v[i + 2] >= flatCut) take(v[i], v[i + 1], v[i + 2]);
    // (each edge of each triangle that has one end either side of the cut: where it crosses it)
    const t = part.indices;
    for (let f = 0; f < t.length; f += 3) {
      for (let e = 0; e < 3; e++) {
        const a = t[f + e] * 3;
        const b = t[f + ((e + 1) % 3)] * 3;
        const [za, zb] = [v[a + 2], v[b + 2]];
        if (za >= flatCut === zb >= flatCut) continue;
        const s = (flatCut - za) / (zb - za);
        take(v[a] + (v[b] - v[a]) * s, v[a + 1] + (v[b + 1] - v[a + 1]) * s, flatCut);
      }
    }
  }
  return { min, max };
}
