import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { measureWalls, summariseWalls } from "./thickness";

// A triangle soup: each triangle is three vertices; `x` places it, and `z` its height (the sampler only looks
// above z = 1 by default)
const triangle = (x: number, z: number, width: number, height: number) => [x, 0, z, x + width, 0, z, x, height, z];

// Which of the triangles (each in its own band of x, 10 apart) each sample fell in
const counts = (soup: number[][], samples: number, seed = 1) => {
  const { points } = measureWalls(Float32Array.from(soup.flat()), null, samples, 1, seed);
  const hits = new Array(soup.length).fill(0);
  for (let i = 0; i < points.length; i += 3) hits[Math.round(points[i] / 10)]++;
  return hits;
};

describe("measureWalls samples the surface by area", () => {
  it("reaches every triangle that counts, whatever is skipped between them", () => {
    // areas 1, (skipped), 2, 3: the first used to have a zero total ahead of it in the list and was never chosen
    const soup = [triangle(0, 5, 2, 1), triangle(10, 0, 2, 5), triangle(20, 5, 2, 2), triangle(30, 5, 2, 3)];
    const hits = counts(soup, 6000);
    expect(hits[1]).toBe(0);
    expect(hits[0] / 6000).toBeCloseTo(1 / 6, 1);
    expect(hits[2] / 6000).toBeCloseTo(2 / 6, 1);
    expect(hits[3] / 6000).toBeCloseTo(3 / 6, 1);
  });

  it("gives the same shares in any order of the triangles, with skipped ones anywhere", () => {
    // each triangle's x says which it is: areas 1, (skipped), 2, 3, (skipped)
    const soup = [triangle(0, 5, 2, 1), triangle(10, 0, 2, 5), triangle(20, 5, 2, 2), triangle(30, 5, 2, 3), triangle(40, -3, 2, 4)];
    for (const order of [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [1, 4, 0, 3, 2], [3, 0, 4, 2, 1]]) {
      const { points } = measureWalls(Float32Array.from(order.flatMap((i) => soup[i])), null, 6000, 1, 7);
      const byTriangle = new Array(5).fill(0);
      for (let k = 0; k < points.length; k += 3) byTriangle[Math.round(points[k] / 10)]++;
      expect(byTriangle[0] / 6000).toBeCloseTo(1 / 6, 1);
      expect(byTriangle[2] / 6000).toBeCloseTo(2 / 6, 1);
      expect(byTriangle[3] / 6000).toBeCloseTo(3 / 6, 1);
      expect(byTriangle[1] + byTriangle[4]).toBe(0);
    }
  });

  it("returns nothing, and does not fail, when no triangle counts", () => {
    const soup = [triangle(0, 0, 2, 1), triangle(10, -2, 2, 2)];
    const walls = measureWalls(Float32Array.from(soup.flat()), null, 100);
    expect(walls.points.length).toBe(0);
    const report = summariseWalls(walls);
    expect(report.samples).toBe(0);
    expect(report.thinner.every((t) => t.share === 0)).toBe(true);
  });

  it("finds the thin share of a surface with a known area: a thin plate beside a thick block", () => {
    const solid = (w: number, h: number, d: number, x: number) => new THREE.BoxGeometry(w, h, d).translate(x, 0, 10).toNonIndexed().attributes.position.array;
    // the plate: 10 x 10 x 0.3 (two faces of 100 mm² that are thin, four edges of 3 mm² that are not); the block: 5 mm cube (150 mm²)
    const positions = Float32Array.from([...solid(10, 10, 0.3, 0), ...solid(5, 5, 5, 40)]);
    const report = summariseWalls(measureWalls(positions, null, 8000, 1, 3));
    const thin = report.thinner[0].share;
    expect(thin).toBeGreaterThan(200 / 362 - 0.05);
    expect(thin).toBeLessThan(200 / 362 + 0.05);
    expect(report.misses).toBe(0);
  });

  it("counts the rays that find no far side as misses, not as measurements of a thick wall", () => {
    // a single open triangle: nothing for a ray to leave through
    const report = summariseWalls(measureWalls(Float32Array.from(triangle(0, 5, 4, 4)), null, 50));
    expect(report.misses).toBe(50);
    expect(report.thinner[0].share).toBe(0);
  });
});
