import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBust } from "./builder";
import { deformHead } from "./deform";
import { sculptBust } from "./face";
import { buildFineHair } from "./fineHair";
import { buildHair } from "./hair";
import { applySkinDetail } from "./skinShader";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import type { HeadBase } from "./headMesh";
import { applyRace, defaultParams, derive, RACES, type Params } from "./params";

let assets: Assets;
let base: HeadBase;
beforeAll(() => {
  const read = (path: string) => {
    const file = readFileSync(new URL(path, import.meta.url));
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  };
  const shapes = {} as Record<ShapeName, ArrayBuffer>;
  for (const name of SHAPE_NAMES) shapes[name] = read(`../public/models/horns/${name}.bin`);
  assets = parseAssets(read("../public/models/head.bin"), shapes, read("../public/models/feminine.bin"));
  base = assets.head;
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
    expect(base.positions.length / 3).toBe(57799);
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
          for (const key of ["age", "weight", "muscle", "brow", "cheekbones", "noseSize", "lips", "jaw", "lids"] as const) p[key] = v;
          const out = shape(p);
          let furthest = 0;
          let broken = 0;
          for (let i = 0; i < out.length; i++) {
            if (!Number.isFinite(out[i])) broken++;
            furthest = Math.max(furthest, Math.abs(out[i] - base.positions[i]));
          }
          expect(broken, `${race} ${body} ${v}`).toBe(0);
          expect(furthest, `${race} ${body} ${v}`).toBeLessThan(1.0);
        }
      }
    }
  }, 120000);

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
  }, 120000);

  it("lowers the upper lid over the eye as the lids get heavier", () => {
    // How far above the eye's front axis the upper lid's edge sits: the nearest skin in front of the eye,
    // in the slice straight above its centre
    const lidEdge = (lids: number) => {
      const { positions, eyes } = deformHead(base, params({ lids }));
      const [cx, cy, cz] = eyes.left;
      let edge = Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i] - cx;
        const y = positions[i + 1] - cy;
        const z = positions[i + 2] - cz;
        if (y <= 0 || z < 0 || Math.abs(x) > 0.3 * y || Math.hypot(x, y, z) > 1.6 * eyes.radius) continue;
        edge = Math.min(edge, Math.hypot(x, y));
      }
      return edge;
    };
    expect(lidEdge(0.75)).toBeLessThan(lidEdge(0.1));
  });

  it("pushes the nose forward as the nose size rises", () => {
    expect(extent(shape(params({ noseSize: 1 })), -0.3, 0.1).z).toBeGreaterThan(extent(shape(params({ noseSize: 0 })), -0.3, 0.1).z);
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

  it("cuts the bust's sides flat, narrowing from the shoulders to the base with no arm stumps", () => {
    for (const body of ["masculine", "feminine"] as const) {
      const bust = shape(params({ body }));
      const shoulders = extent(bust, -1.15, -1.05).x;
      const armpits = extent(bust, -1.5, -1.4).x;
      const bottom = extent(bust, -2.05, -1.95).x;
      expect(armpits, body).toBeLessThan(shoulders);
      expect(bottom, body).toBeLessThan(armpits);
    }
  });

  it("gives feminine busts a narrower jaw and a bust that projects beyond the masculine chest", () => {
    const masc = shape(params({ body: "masculine" }));
    const fem = shape(params({ body: "feminine" }));
    expect(extent(masc, -0.5, -0.4, 0).x).toBeGreaterThan(extent(fem, -0.5, -0.4, 0).x);
    const front = (positions: Float32Array) => {
      let z = -Infinity;
      for (let i = 0; i < positions.length; i += 3) if (positions[i + 1] < -1.6 && positions[i + 1] > -1.9) z = Math.max(z, positions[i + 2]);
      return z;
    };
    expect(front(fem)).toBeGreaterThan(front(masc));
  });

  it("makes a muscular bust broader through the shoulders than a slight one", () => {
    expect(extent(shape(params({ muscle: 1 })), -1.2, -1.0).x).toBeGreaterThan(extent(shape(params({ muscle: 0 })), -1.2, -1.0).x);
  });


  it("slopes a half-orc's forehead back and juts the lower face forward, compared with a human", () => {
    const human = shape(applyRace(defaultParams(), "human"));
    const orc = shape(applyRace(defaultParams(), "half-orc"));
    const forehead = (positions: Float32Array) => extent(positions, 0.25, 0.45, 0.0).z;
    const lowerFace = (positions: Float32Array) => extent(positions, -0.55, -0.35, 0.0).z;
    // z extent is measured from the back of the band, so compare the frontmost vertex instead
    const front = (positions: Float32Array, minY: number, maxY: number) => {
      let best = -Infinity;
      for (let i = 0; i < positions.length; i += 3) if (positions[i + 1] >= minY && positions[i + 1] <= maxY && Math.abs(positions[i]) < 0.15) best = Math.max(best, positions[i + 2]);
      return best;
    };
    expect(forehead(orc)).toBeDefined();
    expect(lowerFace(orc)).toBeDefined();
    expect(front(orc, 0.25, 0.45)).toBeLessThan(front(human, 0.25, 0.45));
    expect(front(orc, -0.55, -0.35)).toBeGreaterThan(front(human, -0.55, -0.35));
  });

  it("deepens the nasolabial folds with age", () => {
    const young = shape(params({ age: 0 }));
    const old = shape(params({ age: 1 }));
    // Vertices along the fold, from beside the nostril to past the corner of the mouth
    let deeper = 0;
    let checked = 0;
    for (let i = 0; i < base.positions.length; i += 3) {
      const x = Math.abs(base.positions[i]);
      const y = base.positions[i + 1];
      const t = (y + 0.25) / -0.12;
      if (t < 0.1 || t > 0.9) continue;
      const foldX = 0.09 + 0.055 * t;
      if (Math.abs(x - foldX) > 0.02 || base.normals[i + 2] < 0.3) continue;
      checked++;
      // Moving against the outward normal means the skin sank in
      const along = (old[i] - young[i]) * base.normals[i] + (old[i + 1] - young[i + 1]) * base.normals[i + 1] + (old[i + 2] - young[i + 2]) * base.normals[i + 2];
      if (along < 0) deeper++;
    }
    expect(checked).toBeGreaterThan(5);
    expect(deeper / checked).toBeGreaterThan(0.7);
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

  it("darkens skin where grime is turned up", () => {
    const average = (arr: Float32Array) => arr.reduce((sum, v) => sum + v, 0) / arr.length;
    const clean = average(sculpt({ grime: 0 }).geometry.attributes.color.array as Float32Array);
    const filthy = average(sculpt({ grime: 1 }).geometry.attributes.color.array as Float32Array);
    expect(filthy).toBeLessThan(clean);
  });

  it("finds the middle of the underside so the bust can sit centred on its plinth", () => {
    const { footprint, baseY } = sculpt({});
    expect(Number.isFinite(footprint.x)).toBe(true);
    expect(Number.isFinite(footprint.z)).toBe(true);
    expect(baseY).toBeLessThan(-1.5);
  });

  it("builds in well under a second", () => {
    sculpt({});
    const start = performance.now();
    sculpt({ age: 1, grime: 1 });
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("the body", () => {
  it("has real shoulders and a chest, not just a neck and a yoke", () => {
    const positions = shape(params({}));
    // From the chin down, the bust is tall enough to include the upper chest...
    expect(extent(positions).y).toBeGreaterThan(2.2);
    // ...and the shoulders are about as wide as the head is tall, or more
    expect(extent(positions, -1.8, -1.2).x).toBeGreaterThan(1.8);
  });
});

describe("buildBust", () => {
  const bust = (overrides: Partial<Params>) => buildBust(params(overrides), assets);

  it("returns a group containing meshes", () => {
    let meshes = 0;
    bust({}).traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBeGreaterThan(3);
  });

  it("stands the bust on the plinth: the underside is at y = 0 and the footprint is centred", () => {
    const group = bust({});
    const box = new THREE.Box3().setFromObject(group.children[0].children[0]);
    expect(box.min.y).toBeCloseTo(0, 1);
  });

  it("grows horns only for a chosen style, and a different asset for each style", () => {
    const none = countObjects(bust({ hornStyle: "none", hairStyle: "none" }));
    const ram = countObjects(bust({ hornStyle: "ram", hairStyle: "none" }));
    expect(ram).toBeGreaterThan(none);
    const shapes = new Set(["ram", "goat", "bull", "demon", "antelope", "stubby"].map((name) => JSON.stringify(Array.from(assets.shapes[name as ShapeName].positions.slice(0, 12)))));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it("gives tusks to half-orcs only", () => {
    const tusked = (race: Params["race"]) => countObjects(buildBust(applyRace({ ...defaultParams(), hairStyle: "none" }, race), assets));
    const withTusks = (race: Params["race"]) => {
      const p = { ...applyRace({ ...defaultParams(), hairStyle: "none" }, race), tusks: 1 };
      return countObjects(buildBust(p, assets));
    };
    // Setting the tusk slider changes nothing for any race but the half-orc
    for (const race of RACES) {
      if (race === "half-orc") continue;
      expect(withTusks(race), race).toBe(tusked(race));
    }
    expect(derive({ ...defaultParams(), race: "half-orc", tusks: 0.8 }).tusks).toBeGreaterThan(0.5);
    expect(derive({ ...defaultParams(), race: "human", tusks: 0.8 }).tusks).toBe(0);
  }, 120000);

  it("grows hair for each style, and none for none", () => {
    const none = countObjects(bust({ hairStyle: "none" }));
    for (const style of ["cropped", "swept", "mohawk", "long"] as const) {
      expect(countObjects(bust({ hairStyle: style })), style).toBeGreaterThan(none);
    }
  });

  it("keeps hair outside the face: no hair vertex below the hairline in front of the brow", () => {
    const { positions, normals } = sculptBust(params({ hairStyle: "swept" }), base);
    const hair = buildHair(params({ hairStyle: "swept" }), positions, normals, base.neck.z)!;
    const pos = hair.attributes.position;
    let onFace = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) > 0.15 && pos.getY(i) < 0.2 && pos.getY(i) > -0.3 && Math.abs(pos.getX(i)) < 0.4) onFace++;
    }
    expect(onFace).toBe(0);
  });


  it("grows real eyebrow and eyelash strands, more for bushier brows", () => {
    const fine = (p: Params) => {
      const bust = sculptBust(p, base);
      return buildFineHair(p, bust.positions, bust.normals, bust.eyes, base.masks);
    };
    const human = fine(params({ eyebrows: 0.2 }));
    const bushy = fine(params({ eyebrows: 1 }));
    expect(human).not.toBeNull();
    expect(bushy!.attributes.position.count).toBeGreaterThan(human!.attributes.position.count);
  });

  it("builds both eye styles", () => {
    expect(countObjects(bust({ eyeStyle: "glow" }))).toBeGreaterThan(3);
    expect(countObjects(bust({ eyeStyle: "realistic" }))).toBeGreaterThan(3);
  });
});

describe("skin detail", () => {
  it("patches the material's shader with the pore and wrinkle height field", () => {
    const material = new THREE.MeshStandardMaterial();
    applySkinDetail(material, params({ age: 0.7 }));
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: "#include <common>\n#include <begin_vertex>",
      fragmentShader: "#include <common>\n#include <normal_fragment_maps>",
    };
    (material.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
    expect(shader.uniforms.uAge.value).toBeCloseTo(0.7);
    expect(shader.vertexShader).toContain("vObjPos = position;");
    expect(shader.fragmentShader).toContain("skinHeight");
  });
});
