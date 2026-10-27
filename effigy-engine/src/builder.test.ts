import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { eyeCentre, eyeRadius } from "./anatomy";
import { buildBust } from "./builder";
import { buildBodyGeometry } from "./face";
import { applyRace, defaultParams, RACES, type Params } from "./params";

const countObjects = (group: THREE.Object3D) => {
  let n = 0;
  group.traverse(() => n++);
  return n;
};

const params = (overrides: Partial<Params>): Params => ({ ...defaultParams(), ...overrides });
const bust = (overrides: Partial<Params>) => buildBust(params(overrides), "draft");

describe("buildBust", () => {
  it("returns a group containing meshes", () => {
    let meshes = 0;
    bust({}).traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBeGreaterThan(5);
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

  it("builds both eye styles, each with two eyes", () => {
    const eyeCount = (style: "glow" | "realistic") => {
      let n = 0;
      bust({ eyeStyle: style }).traverse((o) => {
        if (o instanceof THREE.Group && o.children.length > 0 && o.position.x !== 0 && Math.abs(o.rotation.y) > 0) n++;
      });
      return n;
    };
    expect(eyeCount("glow")).toBe(2);
    expect(eyeCount("realistic")).toBe(2);
  });
});

describe("buildBodyGeometry", () => {
  const body = (overrides: Partial<Params>, quality: "draft" | "final" = "draft") => buildBodyGeometry(params(overrides), quality);

  // Bounding box of just the vertices inside a vertical band, so we can compare the head, neck or shoulders separately.
  const extent = (geo: THREE.BufferGeometry, minY = -Infinity, maxY = Infinity) => {
    const pos = geo.attributes.position;
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos as THREE.BufferAttribute, i);
      if (v.y >= minY && v.y <= maxY) box.expandByPoint(v);
    }
    return box.getSize(new THREE.Vector3());
  };

  // How many separate pieces the mesh is made of. A nose or an eyelid that was merely stuck on would
  // show up as its own piece.
  const pieces = (geo: THREE.BufferGeometry) => {
    const count = geo.attributes.position.count;
    const parent = Array.from({ length: count }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const index = geo.index!.array;
    for (let t = 0; t < index.length; t += 3) {
      parent[find(index[t])] = find(index[t + 1]);
      parent[find(index[t + 1])] = find(index[t + 2]);
    }
    return new Set(Array.from({ length: count }, (_, i) => find(i))).size;
  };

  it("produces a real mesh with colours and whole triangles", () => {
    const geo = body({});
    expect(geo.attributes.position.count).toBeGreaterThan(1000);
    expect(geo.index!.count % 3).toBe(0);
    expect(geo.attributes.color.count).toBe(geo.attributes.position.count);
  });

  it("is watertight: every edge is shared by exactly two triangles", () => {
    const index = body({}).index!.array;
    const edges = new Map<string, number>();
    for (let t = 0; t < index.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = index[t + e];
        const b = index[t + ((e + 1) % 3)];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].filter((n) => n === 1).length).toBe(0);
  });

  it("is a single connected piece for every race and build, so noses, ears and lids are part of the face", () => {
    for (const race of RACES) {
      for (const bodyType of ["masculine", "feminine"] as const) {
        const p = applyRace({ ...defaultParams(), body: bodyType }, race);
        expect(pieces(buildBodyGeometry(p, "draft")), `${race} ${bodyType}`).toBe(1);
      }
    }
  });

  it("stays one piece at extreme slider settings", () => {
    for (const v of [0, 1]) {
      const p = defaultParams();
      p.noseSize = v;
      p.lips = v;
      p.jaw = v;
      p.brow = v;
      p.lids = v;
      p.age = v;
      p.weight = v;
      expect(pieces(buildBodyGeometry(p, "draft")), `all at ${v}`).toBe(1);
    }
  });

  it("keeps skin out of the eyeballs, so eyelids and sockets cannot clip", () => {
    const geo = body({ lids: 1 }, "final");
    const pos = geo.attributes.position;
    const p = params({ lids: 1 });
    for (const side of [-1, 1] as const) {
      const [cx, cy, cz] = eyeCentre(p, side);
      const radius = eyeRadius(p);
      let nearest = Infinity;
      for (let i = 0; i < pos.count; i++) {
        nearest = Math.min(nearest, Math.hypot(pos.getX(i) - cx, pos.getY(i) - cy, pos.getZ(i) - cz));
      }
      expect(nearest, `eye ${side}`).toBeGreaterThan(radius * 0.97);
    }
  }, 60000);

  it("pushes the nose forward as the nose size rises", () => {
    expect(extent(body({ noseSize: 1 }), -0.3, 0.7).z).toBeGreaterThan(extent(body({ noseSize: 0 }), -0.3, 0.7).z);
  });

  it("gives a dragonborn a muzzle that projects beyond a human face", () => {
    const human = extent(buildBodyGeometry(applyRace(defaultParams(), "human"), "draft"), -0.5, 0.7).z;
    const dragonborn = extent(buildBodyGeometry(applyRace(defaultParams(), "dragonborn"), "draft"), -0.5, 0.7).z;
    expect(dragonborn).toBeGreaterThan(human);
  });

  it("gives dwarves a broader skull than elves", () => {
    // Measured above the ears, so an elf's long ears do not count as skull
    const dwarf = extent(buildBodyGeometry(applyRace(defaultParams(), "dwarf"), "draft"), 0.33, 0.6).x;
    const elf = extent(buildBodyGeometry(applyRace(defaultParams(), "elf"), "draft"), 0.33, 0.6).x;
    expect(dwarf).toBeGreaterThan(elf);
  });

  it("gives masculine busts broader shoulders and thicker necks than feminine ones", () => {
    const masc = body({ body: "masculine" });
    const fem = body({ body: "feminine" });
    expect(extent(masc, -1.3, -0.9).x).toBeGreaterThan(extent(fem, -1.3, -0.9).x);
    expect(extent(masc, -0.75, -0.6).x).toBeGreaterThan(extent(fem, -0.75, -0.6).x);
  });

  it("makes a muscular bust broader through the shoulders than a slight one", () => {
    expect(extent(body({ muscle: 1 }), -1.3, -0.9).x).toBeGreaterThan(extent(body({ muscle: 0 }), -1.3, -0.9).x);
  });

  it("paints vertex colours, and scars change them", () => {
    const a = body({ scars: 0, grime: 0 }).attributes.color.array as Float32Array;
    const b = body({ scars: 1, grime: 0 }).attributes.color.array as Float32Array;
    expect(a.some((value, i) => Math.abs(value - b[i]) > 0.05)).toBe(true);
  });

  it("darkens skin where grime is turned up", () => {
    const average = (geo: THREE.BufferGeometry) => {
      const c = geo.attributes.color.array as Float32Array;
      return c.reduce((sum, v) => sum + v, 0) / c.length;
    };
    expect(average(body({ scars: 0, grime: 1 }))).toBeLessThan(average(body({ scars: 0, grime: 0 })));
  });

  it("builds a finer mesh at final quality", () => {
    const draft = body({}).attributes.position.count;
    const final = body({}, "final").attributes.position.count;
    expect(final).toBeGreaterThan(draft * 4);
  }, 60000);
});
