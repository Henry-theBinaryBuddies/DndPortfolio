import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildCharacter } from "./builder";
import { defaultParams } from "./params";

describe("buildCharacter", () => {
  it("returns a group containing meshes", () => {
    const group = buildCharacter(defaultParams());
    let meshes = 0;
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBeGreaterThan(10);
  });

  it("scales the figure with the height parameter", () => {
    const tall = buildCharacter({ ...defaultParams(), height: 1.2 });
    const short = buildCharacter({ ...defaultParams(), height: 0.8 });
    const heightOf = (g: THREE.Group) => new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).y;
    expect(heightOf(tall)).toBeGreaterThan(heightOf(short));
  });

  it("omits horns when the horn slider is zero", () => {
    const count = (horns: number) => {
      let n = 0;
      buildCharacter({ ...defaultParams(), horns }).traverse(() => n++);
      return n;
    };
    expect(count(0)).toBeLessThan(count(0.5));
  });
});
