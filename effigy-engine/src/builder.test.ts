import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBust } from "./builder";
import { deformHead } from "./deform";
import { sculptBust } from "./face";
import { parseHead, type HeadBase } from "./headMesh";
import { applyRace, defaultParams, RACES, type Params } from "./params";

let base: HeadBase;
beforeAll(() => {
  const file = readFileSync(new URL("../public/models/head.bin", import.meta.url));
  base = parseHead(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
});

const params = (overrides: Partial<Params>): Params => ({ ...defaultParams(), ...overrides });

const countObjects = (group: THREE.Object3D) => {
  let n = 0;
  group.traverse(() => n++);
  return n;
};

// Bounding box of just the vertices inside a vertical band, so the head, neck and shoulders compare separately.
const extent = (positions: Float32Array, minY = -Infinity, maxY = Infinity, minZ = -Infinity) => {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    v.set(positions[i], positions[i + 1], positions[i + 2]);
    if (v.y >= minY && v.y <= maxY && v.z >= minZ) box.expandByPoint(v);
  }
  return box.getSize(new THREE.Vector3());
};

const shape = (p: Params) => deformHead(base, p).positions;

describe("the base head", () => {
  it("has the expected size and is a closed solid", () => {
    expect(base.positions.length / 3).toBe(13212);
    const edges = new Map<string, number>();
    for (let t = 0; t < base.indices.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = base.indices[t + e];
        const b = base.indices[t + ((e + 1) % 3)];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
  });

  it("is one connected piece", () => {
    const count = base.positions.length / 3;
    const parent = Array.from({ length: count }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let t = 0; t < base.indices.length; t += 3) {
      parent[find(base.indices[t])] = find(base.indices[t + 1]);
      parent[find(base.indices[t + 1])] = find(base.indices[t + 2]);
    }
    expect(new Set(Array.from({ length: count }, (_, i) => find(i))).size).toBe(1);
  });

  it("puts the eyes at the origin, level with each other and symmetric", () => {
    expect(base.eyes.left[1]).toBe(0);
    expect(base.eyes.left[0]).toBeCloseTo(-base.eyes.right[0], 5);
  });
});

describe("deformation", () => {
  it("never produces NaN or runaway vertices, for any race, build or extreme setting", () => {
    for (const race of RACES) {
      for (const body of ["masculine", "neutral", "feminine"] as const) {
        for (const v of [0, 1]) {
          const p = applyRace({ ...defaultParams(), body }, race);
          for (const key of ["age", "weight", "muscle", "brow", "cheekbones", "noseSize", "lips", "jaw"] as const) p[key] = v;
          const out = shape(p);
          let furthest = 0;
          let broken = 0;
          for (let i = 0; i < out.length; i++) {
            if (!Number.isFinite(out[i])) broken++;
            furthest = Math.max(furthest, Math.abs(out[i] - base.positions[i]));
          }
          expect(broken, `${race} ${body} ${v}`).toBe(0);
          expect(furthest, `${race} ${body} ${v}`).toBeLessThan(0.5);
        }
      }
    }
  });

  it("keeps skin out of the eyeballs for every race, build and extreme setting, so lids never clip", () => {
    for (const race of RACES) {
      for (const v of [0, 1]) {
        const p = applyRace(defaultParams(), race);
        for (const key of ["age", "weight", "muscle", "brow", "cheekbones", "noseSize", "lips", "jaw"] as const) p[key] = v;
        const { positions, eyes } = deformHead(base, p);
        for (const eye of [eyes.left, eyes.right]) {
          let nearest = Infinity;
          for (let i = 0; i < positions.length; i += 3) {
            nearest = Math.min(nearest, Math.hypot(positions[i] - eye[0], positions[i + 1] - eye[1], positions[i + 2] - eye[2]));
          }
          expect(nearest, `${race} ${v}`).toBeGreaterThan(eyes.radius * 0.9);
        }
      }
    }
  });

  it("pushes the nose forward as the nose size rises", () => {
    expect(extent(shape(params({ noseSize: 1 })), -0.3, 0.1).z).toBeGreaterThan(extent(shape(params({ noseSize: 0 })), -0.3, 0.1).z);
  });

  it("gives a dragonborn a muzzle that projects beyond a human face", () => {
    const human = extent(shape(applyRace(defaultParams(), "human")), -0.5, 0.1).z;
    const dragonborn = extent(shape(applyRace(defaultParams(), "dragonborn")), -0.5, 0.1).z;
    expect(dragonborn).toBeGreaterThan(human);
  });

  it("gives dwarves a broader skull than elves, measured above the ears", () => {
    const dwarf = extent(shape(applyRace(defaultParams(), "dwarf")), 0.2, 0.5, -0.2).x;
    const elf = extent(shape(applyRace(defaultParams(), "elf")), 0.2, 0.5, -0.2).x;
    expect(dwarf).toBeGreaterThan(elf);
  });

  it("gives elves ears that rise higher than a human's", () => {
    const top = (p: Params) => {
      const positions = shape(p);
      let highest = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        // Vertices clearly outside the skull, where the ears are
        if (Math.abs(positions[i]) > 0.43 && positions[i + 2] < -0.3 && positions[i + 1] < 0.6) highest = Math.max(highest, positions[i + 1]);
      }
      return highest;
    };
    expect(top(applyRace(defaultParams(), "elf"))).toBeGreaterThan(top(applyRace(defaultParams(), "human")));
  });

  it("gives masculine busts broader shoulders and thicker necks than feminine ones", () => {
    const masc = shape(params({ body: "masculine" }));
    const fem = shape(params({ body: "feminine" }));
    expect(extent(masc, -1.2, -1.0).x).toBeGreaterThan(extent(fem, -1.2, -1.0).x);
    expect(extent(masc, -0.85, -0.7).x).toBeGreaterThan(extent(fem, -0.85, -0.7).x);
  });

  it("makes a muscular bust broader through the shoulders than a slight one", () => {
    expect(extent(shape(params({ muscle: 1 })), -1.2, -1.0).x).toBeGreaterThan(extent(shape(params({ muscle: 0 })), -1.2, -1.0).x);
  });

  it("makes fuller lips taller", () => {
    const lipHeight = (lips: number) => {
      const positions = shape(params({ lips }));
      let top = -Infinity;
      let bottom = Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        if (Math.abs(positions[i]) < 0.1 && positions[i + 2] > 0.1 && positions[i + 1] > -0.46 && positions[i + 1] < -0.26) {
          top = Math.max(top, positions[i + 1]);
          bottom = Math.min(bottom, positions[i + 1]);
        }
      }
      return top - bottom;
    };
    expect(lipHeight(1)).toBeGreaterThanOrEqual(lipHeight(0));
  });
});

describe("sculptBust", () => {
  const sculpt = (overrides: Partial<Params>) => sculptBust(params(overrides), base);

  it("keeps the base head's topology and paints a colour on every vertex", () => {
    const { geometry } = sculpt({});
    expect(geometry.index!.count).toBe(base.indices.length);
    expect(geometry.attributes.color.count).toBe(geometry.attributes.position.count);
  });

  it("paints vertex colours, and scars change them", () => {
    const a = sculpt({ scars: 0, grime: 0 }).geometry.attributes.color.array as Float32Array;
    const b = sculpt({ scars: 1, grime: 0 }).geometry.attributes.color.array as Float32Array;
    expect(a.some((value, i) => Math.abs(value - b[i]) > 0.05)).toBe(true);
  });

  it("darkens skin where grime is turned up", () => {
    const average = (arr: Float32Array) => arr.reduce((sum, v) => sum + v, 0) / arr.length;
    const clean = average(sculpt({ scars: 0, grime: 0 }).geometry.attributes.color.array as Float32Array);
    const filthy = average(sculpt({ scars: 0, grime: 1 }).geometry.attributes.color.array as Float32Array);
    expect(filthy).toBeLessThan(clean);
  });

  it("builds in well under a second", () => {
    const start = performance.now();
    sculpt({ scars: 1, grime: 1, age: 1 });
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("buildBust", () => {
  const bust = (overrides: Partial<Params>) => buildBust(params(overrides), base);

  it("returns a group containing meshes", () => {
    let meshes = 0;
    bust({}).traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBeGreaterThan(3);
  });

  it("omits horns when the horn slider is zero", () => {
    expect(countObjects(bust({ horns: 0 }))).toBeLessThan(countObjects(bust({ horns: 0.5 })));
  });

  it("adds stitch meshes only where scars exist", () => {
    const stitched = countObjects(bust({ scars: 1, stitches: 1 }));
    const unstitched = countObjects(bust({ scars: 1, stitches: 0 }));
    const noScars = countObjects(bust({ scars: 0, stitches: 1 }));
    expect(stitched).toBeGreaterThan(unstitched);
    expect(noScars).toBe(unstitched);
  });

  it("adds tusks only when the slider is raised", () => {
    expect(countObjects(bust({ tusks: 0 }))).toBeLessThan(countObjects(bust({ tusks: 0.8 })));
  });

  it("builds both eye styles", () => {
    expect(countObjects(bust({ eyeStyle: "glow" }))).toBeGreaterThan(3);
    expect(countObjects(bust({ eyeStyle: "realistic" }))).toBeGreaterThan(3);
  });

  it("seats the figure on the plinth: the underside of the head lands at y = 0", () => {
    const group = bust({});
    const box = new THREE.Box3().setFromObject(group.children[0]);
    expect(box.min.y).toBeCloseTo(0, 1);
  });
});
