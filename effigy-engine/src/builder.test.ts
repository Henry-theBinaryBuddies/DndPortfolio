import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildBust } from "./builder";
import { buildHeadGeometry } from "./face";
import { defaultParams } from "./params";

const countObjects = (group: THREE.Object3D) => {
  let n = 0;
  group.traverse(() => n++);
  return n;
};

describe("buildBust", () => {
  it("returns a group containing meshes", () => {
    let meshes = 0;
    buildBust(defaultParams()).traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBeGreaterThan(8);
  });

  it("omits horns when the horn slider is zero", () => {
    const none = countObjects(buildBust({ ...defaultParams(), horns: 0 }));
    const some = countObjects(buildBust({ ...defaultParams(), horns: 0.5 }));
    expect(none).toBeLessThan(some);
  });

  it("adds tusks only when the slider is raised", () => {
    const none = countObjects(buildBust({ ...defaultParams(), tusks: 0 }));
    const some = countObjects(buildBust({ ...defaultParams(), tusks: 0.8 }));
    expect(none).toBeLessThan(some);
  });
});

describe("buildHeadGeometry", () => {
  const extent = (geo: THREE.BufferGeometry) => new THREE.Box3().setFromBufferAttribute(geo.attributes.position as THREE.BufferAttribute).getSize(new THREE.Vector3());

  it("pushes the nose forward as the nose slider rises", () => {
    const short = extent(buildHeadGeometry({ ...defaultParams(), noseLength: 0 }));
    const long = extent(buildHeadGeometry({ ...defaultParams(), noseLength: 1 }));
    expect(long.z).toBeGreaterThan(short.z);
  });

  it("widens the head with the skull width slider", () => {
    const narrow = extent(buildHeadGeometry({ ...defaultParams(), headWidth: 0.85 }));
    const wide = extent(buildHeadGeometry({ ...defaultParams(), headWidth: 1.2 }));
    expect(wide.x).toBeGreaterThan(narrow.x);
  });

  it("paints vertex colours, and scars change them", () => {
    const clean = buildHeadGeometry({ ...defaultParams(), scars: 0, grime: 0 });
    const scarred = buildHeadGeometry({ ...defaultParams(), scars: 1, grime: 0 });
    const a = clean.attributes.color.array as Float32Array;
    const b = scarred.attributes.color.array as Float32Array;
    expect(a.length).toBe(clean.attributes.position.count * 3);
    expect(a.some((value, i) => Math.abs(value - b[i]) > 0.05)).toBe(true);
  });

  it("darkens skin where grime is turned up", () => {
    const average = (geo: THREE.BufferGeometry) => {
      const c = geo.attributes.color.array as Float32Array;
      return c.reduce((sum, v) => sum + v, 0) / c.length;
    };
    const clean = average(buildHeadGeometry({ ...defaultParams(), scars: 0, grime: 0 }));
    const filthy = average(buildHeadGeometry({ ...defaultParams(), scars: 0, grime: 1 }));
    expect(filthy).toBeLessThan(clean);
  });

  it("keeps the vertex count stable so sliders never change the mesh topology", () => {
    const a = buildHeadGeometry(defaultParams()).attributes.position.count;
    const b = buildHeadGeometry({ ...defaultParams(), chin: 1, brow: 1 }).attributes.position.count;
    expect(a).toBe(b);
  });
});
