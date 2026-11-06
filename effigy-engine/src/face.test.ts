import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { castRay } from "./face";

describe("finding the surface along a ray", () => {
  it("gives the normal square to the surface on a mesh stretched more one way than another", () => {
    // a plane facing +z, turned 45 degrees about y, in a group twice as wide as it is deep: the surface it makes runs
    // as (x, z) = (2, -1) does, so its normal is (1, 2), normalised; turning the normal as a direction gave (2, 1)
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    plane.rotation.y = Math.PI / 4;
    const group = new THREE.Group();
    group.scale.set(2, 1, 1);
    group.add(plane);
    group.updateMatrixWorld(true);
    const hit = castRay(plane, new THREE.Vector3(0, 0, 4), new THREE.Vector3(0, 0, -1))!;
    expect(hit.position.length()).toBeCloseTo(0, 6);
    const expected = new THREE.Vector3(1, 0, 2).normalize();
    expect(hit.normal.length()).toBeCloseTo(1, 6);
    expect(hit.normal.distanceTo(expected)).toBeLessThan(1e-6);
  });
});
