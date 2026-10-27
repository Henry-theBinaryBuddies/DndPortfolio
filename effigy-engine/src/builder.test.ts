import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildBust } from "./builder";
import { buildBodyGeometry } from "./face";
import { defaultParams } from "./params";

const countObjects = (group: THREE.Object3D) => {
  let n = 0;
  group.traverse(() => n++);
  return n;
};

const bust = (overrides: Partial<ReturnType<typeof defaultParams>>) => buildBust({ ...defaultParams(), ...overrides }, "draft");

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

  it("removes the hood when it is toggled off", () => {
    expect(countObjects(bust({ hood: false, hair: 0 }))).toBeLessThan(countObjects(bust({ hood: true, hair: 0 })));
  });

  it("shows hair only when the hood is off", () => {
    expect(countObjects(bust({ hood: true, hair: 1 }))).toBe(countObjects(bust({ hood: true, hair: 0 })));
    expect(countObjects(bust({ hood: false, hair: 1 }))).toBeGreaterThan(countObjects(bust({ hood: false, hair: 0 })));
  });

  it("grows a moustache and then a full beard as the slider rises", () => {
    const none = countObjects(bust({ beard: 0 }));
    const moustache = countObjects(bust({ beard: 0.2 }));
    expect(moustache).toBeGreaterThan(none);
    expect(countObjects(bust({ beard: 0.9 }))).toBeGreaterThan(moustache);
  });

  it("adds tusks only when the slider is raised", () => {
    expect(countObjects(bust({ tusks: 0 }))).toBeLessThan(countObjects(bust({ tusks: 0.8 })));
  });
});

describe("buildBodyGeometry", () => {
  const body = (overrides: Partial<ReturnType<typeof defaultParams>>) => buildBodyGeometry({ ...defaultParams(), ...overrides }, "draft");

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

  it("produces a real mesh with colours and whole triangles", () => {
    const geo = body({});
    expect(geo.attributes.position.count).toBeGreaterThan(1000);
    expect(geo.index!.count % 3).toBe(0);
    expect(geo.attributes.color.count).toBe(geo.attributes.position.count);
  });

  it("is watertight: every edge is shared by exactly two triangles", () => {
    const geo = body({});
    const index = geo.index!.array;
    const edges = new Map<string, number>();
    for (let t = 0; t < index.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = index[t + e];
        const b = index[t + ((e + 1) % 3)];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    const boundary = [...edges.values()].filter((n) => n === 1).length;
    expect(boundary).toBe(0);
  });

  it("pushes the nose forward as the nose slider rises", () => {
    expect(extent(body({ noseLength: 1 }), -0.3, 0.7).z).toBeGreaterThan(extent(body({ noseLength: 0 }), -0.3, 0.7).z);
  });

  it("pushes the muzzle forward with the snout slider", () => {
    expect(extent(body({ snout: 1 }), -0.5, 0.7).z).toBeGreaterThan(extent(body({ snout: 0 }), -0.5, 0.7).z);
  });

  it("widens the head with the skull width slider", () => {
    expect(extent(body({ headWidth: 1.2 }), -0.1, 0.7).x).toBeGreaterThan(extent(body({ headWidth: 0.85 }), -0.1, 0.7).x);
  });

  it("gives masculine busts broader shoulders and thicker necks than feminine ones", () => {
    const masc = body({ body: "masculine" });
    const fem = body({ body: "feminine" });
    expect(extent(masc, -1.3, -0.9).x).toBeGreaterThan(extent(fem, -1.3, -0.9).x);
    expect(extent(masc, -0.75, -0.6).x).toBeGreaterThan(extent(fem, -0.75, -0.6).x);
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
    const draft = buildBodyGeometry(defaultParams(), "draft").attributes.position.count;
    const start = performance.now();
    const final = buildBodyGeometry(defaultParams(), "final").attributes.position.count;
    console.log(`final-quality build: ${Math.round(performance.now() - start)} ms, ${final} vertices (draft ${draft})`);
    expect(final).toBeGreaterThan(draft * 4);
  });
});
