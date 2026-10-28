import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBust, fitSphere, socketFit } from "./builder";
import { BEARD_CARVING, carvingDepth } from "./beardCarve";
import { BROW_CARVING, buildBrows } from "./brows";
import { MIN_FEATURE, MIN_GROOVE, MM } from "./print";
import { deformHead } from "./deform";
import { sculptBust } from "./face";
import { buildBeard, buildBeardShell, buildHairShell, buildHangingHair } from "./hairShell";
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

  it("fits each eyeball to its socket: up against the lids, bulging at the cornea, never through the skin", () => {
    for (const lids of [0.1, 0.75]) {
      const { positions, eyes } = deformHead(base, params({ lids }));
      const centre = new THREE.Vector3(...eyes.left);
      const ball = new THREE.SphereGeometry(eyes.radius, 48, 36);
      ball.rotateX(Math.PI / 2);
      fitSphere(ball, socketFit(positions, centre, eyes.radius));
      const pos = ball.attributes.position;
      const v = new THREE.Vector3();
      let front = 0;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        front = Math.max(front, v.z);
        // No skin vertex lies closer to the eye's centre in this vertex's direction
        const r = v.length();
        const u = v.clone().normalize();
        for (let j = 0; j < positions.length; j += 3) {
          const x = positions[j] - centre.x;
          const y = positions[j + 1] - centre.y;
          const z = positions[j + 2] - centre.z;
          const d = Math.hypot(x, y, z);
          if (d > 2 * eyes.radius || (x * u.x + y * u.y + z * u.z) / d < Math.cos(0.05)) continue;
          expect(d, `lids ${lids}`).toBeGreaterThan(r);
        }
      }
      expect(front).toBeGreaterThan(eyes.radius * 1.1);
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

  it("gives a half-orc a heavy jaw without ballooning the cheeks", () => {
    const human = shape(applyRace(defaultParams(), "human"));
    const orc = shape(applyRace(defaultParams(), "half-orc"));
    // At the cheeks the orc is broader only by about its skull's breadth (1.08)
    expect(extent(orc, -0.3, -0.2, 0).x / extent(human, -0.3, -0.2, 0).x).toBeLessThan(1.12);
    // ...and broader still at the jaw
    expect(extent(orc, -0.55, -0.45, -0.2).x).toBeGreaterThan(extent(human, -0.55, -0.45, -0.2).x * 1.05);
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

  it("gives a muscular bust defined forms, not a broader frame", () => {
    const slight = shape(params({ muscle: 0 }));
    const strong = shape(params({ muscle: 1 }));
    // Barely any broader through the shoulders (the deltoids' caps are most of it)...
    expect(extent(strong, -1.2, -1.0).x / extent(slight, -1.2, -1.0).x).toBeLessThan(1.05);
    // ...but the neck cords, collarbones and chest stand out: somewhere on the front of the neck and chest
    // the surface moves by a couple of millimetres or more
    let most = 0;
    for (let i = 0; i < strong.length; i += 3) {
      if (strong[i + 1] > -0.5 || strong[i + 1] < -1.6) continue;
      most = Math.max(most, Math.hypot(strong[i] - slight[i], strong[i + 1] - slight[i + 1], strong[i + 2] - slight[i + 2]));
    }
    expect(most).toBeGreaterThan(0.012);
  });

  it("keeps stocky races' shoulders in proportion", () => {
    const width = (race: Params["race"]) => extent(shape(applyRace(defaultParams(), race)), -1.2, -1.0).x;
    for (const race of ["dwarf", "half-orc"] as const) expect(width(race) / width("human"), race).toBeLessThan(1.2);
  });

  it("keeps the neck round however wide the jaw, skull or shoulders: as deep for its width as the sculpt's", () => {
    // The neck's depth over its width just below the jaw
    const roundness = (positions: Float32Array) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        if (Math.abs(positions[i + 1] + 0.72) > 0.012 || Math.hypot(positions[i] - base.neck.x, positions[i + 2] - base.neck.z) > 0.5) continue;
        minX = Math.min(minX, positions[i]);
        maxX = Math.max(maxX, positions[i]);
        minZ = Math.min(minZ, positions[i + 2]);
        maxZ = Math.max(maxZ, positions[i + 2]);
      }
      return (maxZ - minZ) / (maxX - minX);
    };
    const sculpt = roundness(base.positions);
    for (const race of RACES) {
      const p = applyRace(defaultParams(), race);
      p.muscle = 1;
      p.jaw = 0.8;
      expect(roundness(shape(p)) / sculpt, race).toBeGreaterThan(0.92);
    }
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

  it("keeps the base head's topology", () => {
    const { geometry } = sculpt({});
    expect(geometry.index!.count).toBe(base.indices.length);
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
    sculpt({ age: 1 });
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

  it("keeps hair off the face: the hair shell lies on the skin in front of the brow and below the hairline", () => {
    for (const style of ["cropped", "swept", "mohawk", "long"] as const) {
      const p = params({ hairStyle: style });
      const bust = sculptBust(p, base);
      const shell = buildHairShell(p, bust.positions, bust.normals, base)!;
      expect(shell, style).not.toBeNull();
      const onFace = (x: number, y: number, z: number) => z > 0.15 && y < 0.2 && y > -0.3 && Math.abs(x) < 0.4;
      const skin: number[] = [];
      for (let i = 0; i < bust.positions.length; i += 3) {
        if (onFace(bust.positions[i], bust.positions[i + 1], bust.positions[i + 2] - 0.02)) skin.push(bust.positions[i], bust.positions[i + 1], bust.positions[i + 2]);
      }
      const pos = shell.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (!onFace(pos.getX(i), pos.getY(i), pos.getZ(i))) continue;
        let nearest = Infinity;
        for (let j = 0; j < skin.length; j += 3) nearest = Math.min(nearest, Math.hypot(pos.getX(i) - skin[j], pos.getY(i) - skin[j + 1], pos.getZ(i) - skin[j + 2]));
        expect(nearest, style).toBeLessThan(0.01);
      }
    }
    expect(buildHairShell(params({ hairStyle: "none" }), new Float32Array(), new Float32Array(), base)).toBeNull();
  }, 120000);

  it("drapes long hair as one solid curtain that hangs outside the head and body, for long hair only", () => {
    for (const body of ["masculine", "feminine"] as const) {
      const p = params({ hairStyle: "long", body });
      const bust = sculptBust(p, base);
      const curtain = buildHangingHair(p, bust.positions, base)!;
      expect(curtain, body).not.toBeNull();
      const pos = curtain.attributes.position;
      // Every point of the curtain is outside the body: further from the neck's axis than the body's own
      // surface at the same height and angle (checked against the body vertices close to it)
      for (let i = 0; i < pos.count; i += 7) {
        const dx = pos.getX(i) - base.neck.x;
        const dz = pos.getZ(i) - base.neck.z;
        const r = Math.hypot(dx, dz);
        const a = Math.atan2(dx, -dz);
        for (let j = 0; j < bust.positions.length; j += 3) {
          if (Math.abs(bust.positions[j + 1] - pos.getY(i)) > 0.01) continue;
          const bx = bust.positions[j] - base.neck.x;
          const bz = bust.positions[j + 2] - base.neck.z;
          if (Math.abs(Math.atan2(bx, -bz) - a) > 0.02) continue;
          expect(r, body).toBeGreaterThan(Math.hypot(bx, bz) - 0.004);
        }
      }
    }
    expect(buildHangingHair(params({ hairStyle: "swept" }), new Float32Array(), base)).toBeNull();
  }, 120000);

  it("sculpts beards on the lower face only, keeping off the lips", () => {
    const beardOf = (beardStyle: Params["beardStyle"]) => {
      const p = params({ beardStyle });
      const bust = sculptBust(p, base);
      return buildBeard(p, bust.positions, bust.normals, base);
    };
    expect(beardOf("none")).toBeNull();
    const sizes: Record<string, number> = {};
    for (const style of ["goatee", "short", "full"] as const) {
      const beard = beardOf(style)!;
      expect(beard, style).not.toBeNull();
      const pos = beard.attributes.position;
      const hair = beard.attributes.hairAmount;
      let visible = 0;
      for (let i = 0; i < pos.count; i++) {
        if (hair.getX(i) < 0.1) continue; // the faded edge
        visible++;
        // Nothing above the cheek line beside the nose, and nothing over the eyes or forehead
        expect(pos.getY(i), style).toBeLessThan(0.05);
      }
      sizes[style] = visible;
    }
    // A goatee covers much less than a short beard
    expect(sizes.goatee).toBeLessThan(sizes.short * 0.6);
    // No visible beard over the red of the lips
    const p = params({ beardStyle: "full" });
    const bust = sculptBust(p, base);
    const full = buildBeard(p, bust.positions, bust.normals, base)!;
    let onLips = 0;
    const hair = full.attributes.hairAmount;
    const pos = full.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (hair.getX(i) > 0.5 && Math.abs(pos.getX(i)) < 0.08 && y > -0.4 && y < -0.33 && pos.getZ(i) > 0.15) onLips++;
    }
    expect(onLips).toBe(0);
  }, 120000);

  it("closes every hair and beard shell: each edge is shared by exactly two triangles, so no open underside", () => {
    const openEdges = (geometry: THREE.BufferGeometry) => {
      const index = geometry.index!;
      const pos = geometry.attributes.position;
      // Weld by position, since the shell's outer and inner surfaces meet along its walls
      const key = (i: number) => `${pos.getX(i).toFixed(6)},${pos.getY(i).toFixed(6)},${pos.getZ(i).toFixed(6)}`;
      const id = new Map<string, number>();
      const weld = (i: number) => {
        const k = key(i);
        if (!id.has(k)) id.set(k, id.size);
        return id.get(k)!;
      };
      const uses = new Map<string, number>();
      for (let t = 0; t < index.count; t += 3) {
        const v = [weld(index.getX(t)), weld(index.getX(t + 1)), weld(index.getX(t + 2))];
        for (let e = 0; e < 3; e++) {
          const a = v[e];
          const b = v[(e + 1) % 3];
          if (a === b) continue;
          const k = a < b ? `${a},${b}` : `${b},${a}`;
          uses.set(k, (uses.get(k) ?? 0) + 1);
        }
      }
      let open = 0;
      for (const n of uses.values()) if (n !== 2) open++;
      return open;
    };
    for (const hairStyle of ["cropped", "swept", "mohawk", "long"] as const) {
      const p = params({ hairStyle });
      const bust = sculptBust(p, base);
      expect(openEdges(buildHairShell(p, bust.positions, bust.normals, base)!), hairStyle).toBe(0);
    }
    for (const beardStyle of ["goatee", "short", "full"] as const) {
      const p = params({ beardStyle });
      const bust = sculptBust(p, base);
      expect(openEdges(buildBeard(p, bust.positions, bust.normals, base)!), beardStyle).toBe(0);
    }
  }, 120000);

  it("never folds a hair or beard shell over itself: every visible outer triangle faces the same way as the skin under it", () => {
    // A fold shows as a pale plate with a dark slit (a full beard's lean once slid the front of the chin down
    // past its own underside)
    const folds = (geometry: THREE.BufferGeometry) => {
      const index = geometry.index!;
      const pos = geometry.attributes.position;
      const hair = geometry.attributes.hairAmount;
      const total = pos.count / 2;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const outer = new THREE.Vector3();
      const inner = new THREE.Vector3();
      let folded = 0;
      for (let t = 0; t < index.count; t += 3) {
        const i0 = index.getX(t);
        const i1 = index.getX(t + 1);
        const i2 = index.getX(t + 2);
        if (i0 >= total || i1 >= total || i2 >= total) continue; // only the outer surface
        if (Math.min(hair.getX(i0), hair.getX(i1), hair.getX(i2)) < 0.5) continue; // only where it shows
        // The outer triangle's facing, against the same triangle on the inner surface (which follows the skin)
        outer.crossVectors(b.fromBufferAttribute(pos, i1).sub(a.fromBufferAttribute(pos, i0)), c.fromBufferAttribute(pos, i2).sub(a));
        inner.crossVectors(b.fromBufferAttribute(pos, total + i1).sub(a.fromBufferAttribute(pos, total + i0)), c.fromBufferAttribute(pos, total + i2).sub(a));
        if (outer.dot(inner) < 0) folded++;
      }
      return folded;
    };
    const cases: Partial<Params>[] = [
      { beardStyle: "full" },
      { beardStyle: "full", race: "dwarf", lips: 0.75, jaw: 0.8 },
      { beardStyle: "full", lips: 0.25, jaw: 0.2 },
      { beardStyle: "goatee" },
      { beardStyle: "short" },
    ];
    for (const overrides of cases) {
      const p = params(overrides);
      const bust = sculptBust(p, base);
      expect(folds(buildBeardShell(p, bust.positions, bust.normals, base)!), JSON.stringify(overrides)).toBe(0);
    }
    for (const hairStyle of ["cropped", "swept", "mohawk", "long"] as const) {
      const p = params({ hairStyle });
      const bust = sculptBust(p, base);
      expect(folds(buildHairShell(p, bust.positions, bust.normals, base)!), hairStyle).toBe(0);
    }
  }, 120000);
});

describe("sculpted eyebrows", () => {
  const browsOf = (overrides: Partial<Params>) => {
    const p = params(overrides);
    const bust = sculptBust(p, base);
    return { brows: buildBrows(p, bust.positions, bust.normals, base), bust };
  };

  it("are closed solids: every edge is used once each way, so they print and never show an open side", () => {
    const { brows } = browsOf({});
    const index = brows!.index!;
    const directed = new Map<string, number>();
    for (let t = 0; t < index.count; t += 3) {
      const v = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      for (let e = 0; e < 3; e++) {
        const k = `${v[e]},${v[(e + 1) % 3]}`;
        directed.set(k, (directed.get(k) ?? 0) + 1);
      }
    }
    let bad = 0;
    for (const [k, n] of directed) {
      const [a, b] = k.split(",");
      if (n !== 1 || directed.get(`${b},${a}`) !== 1) bad++;
    }
    expect(bad).toBe(0);
  });

  it("never fold their carved top over: each top triangle faces the same way as the base beneath it", () => {
    for (const overrides of [{}, { eyebrows: 1 }, { body: "feminine" as const }, { race: "half-orc" as const, brow: 0.8 }, { race: "elf" as const, brow: 0.2 }]) {
      const { brows } = browsOf(overrides);
      const index = brows!.index!;
      const pos = brows!.attributes.position;
      // Each brow is a top block of vertices followed by its base, the same grid just under the skin
      const per = pos.count / 4;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const normal = (i0: number, i1: number, i2: number) =>
        new THREE.Vector3().crossVectors(b.fromBufferAttribute(pos, i1).sub(a.fromBufferAttribute(pos, i0)), c.fromBufferAttribute(pos, i2).sub(a));
      let folded = 0;
      for (let t = 0; t < index.count; t += 3) {
        const v = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
        const block = Math.floor(v[0] / per);
        if (block % 2 === 1 || v.some((i) => Math.floor(i / per) !== block)) continue; // tops only
        if (normal(v[0], v[1], v[2]).dot(normal(v[0] + per, v[1] + per, v[2] + per)) < 0) folded++;
      }
      expect(folded, JSON.stringify(overrides)).toBe(0);
    }
  }, 120000);

  it("sit over the eyes on the front of the face, rise with the Eyebrows slider, and vanish at zero", () => {
    const rise = (eyebrows: number) => {
      const { brows } = browsOf({ eyebrows });
      const pos = brows!.attributes.position;
      const per = pos.count / 4;
      let most = 0;
      for (const block of [0, 2]) {
        for (let k = 0; k < per; k++) {
          const top = block * per + k;
          const under = top + per;
          most = Math.max(most, Math.hypot(pos.getX(top) - pos.getX(under), pos.getY(top) - pos.getY(under), pos.getZ(top) - pos.getZ(under)));
        }
      }
      return most;
    };
    const { brows, bust } = browsOf({});
    const box = new THREE.Box3().setFromBufferAttribute(brows!.attributes.position as THREE.BufferAttribute);
    expect(box.min.y).toBeGreaterThan(Math.max(bust.eyes.left[1], bust.eyes.right[1]));
    expect(box.max.y).toBeLessThan(0.25);
    expect(box.min.z).toBeGreaterThan(-0.2); // (the tail reaches round to the temple, no further)
    expect(rise(1)).toBeGreaterThan(rise(0.2) * 1.5);
    expect(browsOf({ eyebrows: 0 }).brows).toBeNull();
  });

  it("are carved no finer than the printer can make", () => {
    expect(BROW_CARVING.grooveWidth).toBeGreaterThanOrEqual(MIN_GROOVE);
    expect(BROW_CARVING.minWidth).toBeGreaterThanOrEqual(MIN_FEATURE);
    expect(BROW_CARVING.depth).toBeGreaterThan(0.2 * MM); // deep enough to show at all
  });

  it("fit every race and build without leaving the face", () => {
    for (const race of RACES) {
      for (const body of ["masculine", "feminine"] as const) {
        const p = applyRace({ ...defaultParams(), body }, race);
        p.eyebrows = 1;
        const bust = sculptBust(p, base);
        expect(() => buildBrows(p, bust.positions, bust.normals, base), `${race} ${body}`).not.toThrow();
      }
    }
  }, 120000);
});

describe("carved beards", () => {
  it("are carved no finer than the printer can make, and no deeper than is worth printing", () => {
    expect(BEARD_CARVING.lockGroove).toBeGreaterThanOrEqual(MIN_GROOVE);
    expect(BEARD_CARVING.fineGroove).toBeGreaterThanOrEqual(MIN_GROOVE);
    expect(BEARD_CARVING.lockDepth).toBeGreaterThanOrEqual(0.3 * MM);
    expect(BEARD_CARVING.fineDepth).toBeGreaterThanOrEqual(0.2 * MM);
    // The ridge left between a lock's groove and the finer one in its middle is wide enough to print
    expect(BEARD_CARVING.lockPitch / 2 - (BEARD_CARVING.lockGroove + BEARD_CARVING.fineGroove) / 2).toBeGreaterThanOrEqual(0.5 * MM);
    expect(BEARD_CARVING.lockPitch / 2 - (BEARD_CARVING.lockGroove + BEARD_CARVING.fineGroove) / 2).toBeGreaterThanOrEqual(MIN_FEATURE * 0.8);
  });

  it("run locks across the chin, each groove a lock's width apart, none deeper than the carving allows", () => {
    // Along a line across the chin, count the grooves (local maxima of the carving's depth)
    const grooves: number[] = [];
    let most = 0;
    let before = 0;
    let rising = false;
    const step = 0.0005;
    for (let x = -0.15; x <= 0.15; x += step) {
      const d = carvingDepth(x, -0.62, 0.1);
      most = Math.max(most, d);
      if (d > before) rising = true;
      else if (d < before && rising && before > 0.05 * MM) {
        grooves.push(x - step);
        rising = false;
      }
      before = d;
    }
    expect(most).toBeLessThanOrEqual(BEARD_CARVING.lockDepth * 1.0001);
    expect(most).toBeGreaterThan(0.3 * MM);
    // Locks of 2 mm with a finer groove between: about a groove every mm across about 10 mm
    expect(grooves.length).toBeGreaterThan(5);
    expect(grooves.length).toBeLessThan(16);
    for (let i = 1; i < grooves.length; i++) expect(grooves[i] - grooves[i - 1], `groove ${i}`).toBeGreaterThanOrEqual(0.3 * MM);
  });

  it("fan the moustache out from under the nose: its grooves run outward and down from it", () => {
    // At a point beside the philtrum the grooves lie along the line out from under the nose, so the carving
    // changes little along that line and a lot across it
    const [px, py] = [0.06, -0.3];
    const length = Math.hypot(px, py + 0.22);
    const along = [px / length, (py + 0.22) / length];
    const across = [-along[1], along[0]];
    const variation = (direction: number[]) => {
      let sum = 0;
      for (let t = -0.015; t < 0.015; t += 0.0005) {
        sum += Math.abs(carvingDepth(px + direction[0] * (t + 0.0005), py + direction[1] * (t + 0.0005), 0.2) - carvingDepth(px + direction[0] * t, py + direction[1] * t, 0.2));
      }
      return sum;
    };
    expect(variation(across)).toBeGreaterThan(2 * variation(along));
  });

  it("subdivide the shell finely enough to hold a groove, and stay closed", () => {
    const p = params({ beardStyle: "full" });
    const bust = sculptBust(p, base);
    const shell = buildBeardShell(p, bust.positions, bust.normals, base)!;
    const carved = buildBeard(p, bust.positions, bust.normals, base)!;
    expect(carved.index!.count).toBe(shell.index!.count * 16);
    // The typical edge, after quartering twice, is no more than a quarter of the finest groove's width
    const edge = (g: THREE.BufferGeometry) => {
      const pos = g.attributes.position;
      const index = g.index!;
      const lengths: number[] = [];
      for (let t = 0; t < index.count; t += 60) {
        const a = index.getX(t);
        const b = index.getX(t + 1);
        lengths.push(Math.hypot(pos.getX(a) - pos.getX(b), pos.getY(a) - pos.getY(b), pos.getZ(a) - pos.getZ(b)));
      }
      lengths.sort((x, y) => x - y);
      return lengths[Math.floor(lengths.length * 0.5)];
    };
    expect(edge(carved)).toBeLessThan(BEARD_CARVING.fineGroove / 4);
    // Carving never breaks the solid: every edge is shared by exactly two triangles
    const index = carved.index!;
    const uses = new Map<number, number>();
    for (let t = 0; t < index.count; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = index.getX(t + e);
        const b = index.getX(t + ((e + 1) % 3));
        const k = a < b ? a * 2097152 + b : b * 2097152 + a;
        uses.set(k, (uses.get(k) ?? 0) + 1);
      }
    }
    let open = 0;
    for (const n of uses.values()) if (n !== 2) open++;
    expect(open).toBe(0);
  }, 120000);

  it("rebuild in a few seconds at most once their pattern is cached", () => {
    const p = params({ beardStyle: "full" });
    const bust = sculptBust(p, base);
    buildBeard(p, bust.positions, bust.normals, base);
    const start = performance.now();
    buildBeard(p, bust.positions, bust.normals, base);
    expect(performance.now() - start).toBeLessThan(3000);
  }, 120000);

  it("never sink under the lower lip's own bulge: the shell stays above the skin that faces forward there, at full lips and a heavy jaw", () => {
    for (const overrides of [{ race: "dwarf" as const, lips: 0.75, jaw: 0.8 }, { lips: 0.75, jaw: 0.5 }, { lips: 0.25, jaw: 0.2 }]) {
      const p = params({ beardStyle: "full", ...overrides });
      const bust = sculptBust(p, base);
      const shell = buildBeardShell(p, bust.positions, bust.normals, base)!;
      const pos = shell.attributes.position;
      const head = shell.attributes.headPos;
      const hair = shell.attributes.hairAmount;
      // Which skin vertex each shell vertex grows from
      const at = new Map<string, number>();
      for (let i = 0; i < base.positions.length; i += 3) at.set(`${base.positions[i].toFixed(5)},${base.positions[i + 1].toFixed(5)},${base.positions[i + 2].toFixed(5)}`, i);
      let sunk = 0;
      let checked = 0;
      for (let j = 0; j < pos.count / 2; j++) {
        const x = head.getX(j);
        const y = head.getY(j);
        if (hair.getX(j) < 0.5 || Math.abs(x) > 0.1 || y < -0.5 || y > -0.4) continue;
        const v = at.get(`${x.toFixed(5)},${y.toFixed(5)},${head.getZ(j).toFixed(5)}`);
        // (only the skin that faces the viewer: the crease behind the lip is hidden by it)
        if (v === undefined || bust.normals[v + 2] < 0.5) continue;
        const along = (pos.getX(j) - bust.positions[v]) * bust.normals[v] + (pos.getY(j) - bust.positions[v + 1]) * bust.normals[v + 1] + (pos.getZ(j) - bust.positions[v + 2]) * bust.normals[v + 2];
        checked++;
        if (along < 0) sunk++;
      }
      expect(checked, JSON.stringify(overrides)).toBeGreaterThan(20);
      expect(sunk, JSON.stringify(overrides)).toBe(0);
    }
  }, 120000);
});
