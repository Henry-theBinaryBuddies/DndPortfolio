import { readFileSync } from "node:fs";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import { bodySurface } from "./bodySurface";
import { buildBust } from "./builder";
import { parseDragonborn, type DragonbornManifest } from "./dragonborn";
import { collectBust } from "./export";
import { collectTabletop } from "./fit";
import { buildOutfit, fittedAlready } from "./garments";
import { applyRace, defaultParams, type Params } from "./params";
import { partInfo } from "./parts";
import { printKey } from "./printPreview";
import { mergeParts } from "./printable";
import { MM } from "./print";

let assets: Assets;
beforeAll(() => {
  const read = (path: string) => {
    const file = readFileSync(new URL(path, import.meta.url));
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  };
  const shapes = {} as Record<ShapeName, ArrayBuffer>;
  for (const name of SHAPE_NAMES) shapes[name] = read(`../public/models/horns/${name}.bin`);
  assets = parseAssets(read("../public/models/head.bin"), shapes, read("../public/models/feminine.bin"));
  assets.dragonborn = parseDragonborn(read("../public/models/dragonborn.bin"), JSON.parse(new TextDecoder().decode(read("../public/models/dragonborn.json"))) as DragonbornManifest);
});

const human = (outfit: Params["outfit"], cloak: Params["cloak"] = "none"): Params => ({ ...applyRace(defaultParams(), "human"), outfit, cloak });
const dragonborn = (outfit: Params["outfit"], cloak: Params["cloak"] = "none"): Params => ({ ...defaultParams(), family: "dragonborn", outfit, cloak });

describe("clothing", () => {
  it("is worn by either family, each piece a named part of the bust", () => {
    const names = (p: Params) => {
      const found: string[] = [];
      buildBust(p, assets, false).traverse((o) => {
        if (o instanceof THREE.Mesh && partInfo(o.name).role === "garment") found.push(o.name);
      });
      return found;
    };
    for (const p of [human, dragonborn]) {
      expect(names(p("none"))).toEqual([]);
      expect(names(p("tunic"))).toEqual(["tunic"]);
      expect(names(p("leather"))).toEqual(["tunic", "jerkin"]);
      expect(names(p("armour"))).toEqual(["tunic", "cuirass", "gorget", "pauldron", "pauldron"]);
      expect(names(p("none", "cloak"))).toEqual(["cloak", "clasp", "clasp"]);
      expect(names(p("armour", "cowl"))).toEqual(["tunic", "cuirass", "gorget", "pauldron", "pauldron", "cloak", "clasp", "clasp"]);
    }
  });

  it("stands clear of the body everywhere above the flat cut, nearly all of it by a millimetre or more", () => {
    for (const p of [human("armour", "cowl"), dragonborn("armour", "cowl"), human("leather"), dragonborn("leather")]) {
      const body = bodySurface(p, assets);
      const outfit = buildOutfit(p, body)!;
      const cutY = body.baseY + body.cut * MM + 0.1;
      const point = new THREE.Vector3();
      for (const garment of outfit.garments) {
        // (its outside is its first vertices: see garments.ts)
        const outside = garment.outside ?? garment.positions.length / 6;
        const offs: number[] = [];
        for (let i = 0; i < outside; i += 3) {
          point.fromArray(garment.positions, i * 3);
          if (point.y < cutY) continue;
          const near = body.closest(point);
          offs.push(near.normal.dot(point.clone().sub(near.point)) / MM);
        }
        offs.sort((a, b) => a - b);
        expect(offs[0], `${p.family} ${garment.name}: the closest`).toBeGreaterThan(0.2);
        expect(offs[Math.floor(0.05 * offs.length)], `${p.family} ${garment.name}: all but the closest 5%`).toBeGreaterThan(1);
      }
    }
  }, 120000);

  it("prints as one closed solid with the bust, at both ends of the torso, for either family", async () => {
    const worn = [human("tunic"), dragonborn("tunic"), human("leather", "cowl"), dragonborn("leather", "cloak"), human("none", "cloak"), dragonborn("none", "cowl")];
    for (const p of worn.concat([0.6, 1.1].flatMap((torso) => [{ ...human("armour", "cowl"), torso }, { ...dragonborn("armour", "cowl"), torso }]))) {
      const { parts, flatCut } = collectBust(p, assets);
      const { report } = await mergeParts(parts, undefined, undefined, flatCut);
      expect(report.components, `${p.family} ${p.outfit} ${p.cloak} torso ${p.torso}`).toHaveLength(1);
      expect(report.badEdges).toBe(0);
    }
  }, 600000);

  it("puts the cloak over everything else worn, which shows through it nowhere but at its very edge", () => {
    // (a point of a garment within the cloak's reach that is outside it: traced straight inward, it meets the cloak's
    // outside; one inside the cloak's own solid meets its inside instead, and is hidden)
    for (const p of [human("leather", "cowl"), human("armour", "cowl"), dragonborn("leather", "cowl"), dragonborn("armour", "cowl")]) {
      const body = bodySurface(p, assets);
      const outfit = buildOutfit(p, body)!;
      const cloak = outfit.garments.find((g) => g.name === "cloak")!;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(cloak.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(cloak.indices, 1));
      const bvh = new MeshBVH(geometry);
      // (the cloak's edge: the sides of its outside's triangles that no other of them shares)
      const half = cloak.outside!;
      const sides = new Map<string, number>();
      for (let t = 0; t < cloak.indices.length; t += 3) {
        const v = [cloak.indices[t], cloak.indices[t + 1], cloak.indices[t + 2]];
        if (v.some((i) => i >= half)) continue;
        for (let k = 0; k < 3; k++) {
          const [a, b] = [v[k], v[(k + 1) % 3]];
          const key = `${Math.min(a, b)} ${Math.max(a, b)}`;
          sides.set(key, (sides.get(key) ?? 0) + 1);
        }
      }
      const rim = [...sides].filter(([, n]) => n === 1).map(([key]) => new THREE.Vector3().fromArray(cloak.positions, Number(key.split(" ")[0]) * 3));
      const cutY = body.baseY + body.cut * MM + 0.12;
      const point = new THREE.Vector3();
      let [through, deep, under] = [0, 0, 0];
      for (const garment of outfit.garments) {
        if (garment.name === "cloak" || garment.name === "clasp") continue;
        for (let i = 0; i < (garment.outside ?? garment.positions.length / 6); i += 3) {
          point.fromArray(garment.positions, i * 3);
          if (point.y < cutY) continue;
          const normal = body.closest(point).normal.clone().normalize();
          const outward = bvh.raycastFirst(new THREE.Ray(point.clone(), normal), THREE.DoubleSide);
          if (outward && outward.distance < 0.4) {
            under++;
            continue;
          }
          const inward = bvh.raycastFirst(new THREE.Ray(point.clone(), normal.clone().negate()), THREE.DoubleSide);
          if (!inward || inward.distance > 0.4 || inward.face!.normal.dot(normal) < 0.3) continue;
          through++;
          // (deeper than a millimetre only within about 5 mm of its edge, under its rolled hem, or far down
          // under the arm, where the cloak hangs clear of the body and its own inside runs in under the tunic)
          if (inward.distance > MM && point.y > body.anchors.neckBase - 0.3 && !rim.some((r) => r.distanceTo(point) < 0.15)) deep++;
        }
      }
      expect(under, `${p.family} ${p.outfit}: under the cloak`).toBeGreaterThan(1000);
      // (some of it at the cloak's edge does: the top of the gorget, which stands above the cloak's collar at the back of
      // the neck, and the tops of the pauldrons within a millimetre or two of its edge, about half a percent in armour)
      expect(through / under, `${p.family} ${p.outfit}: through it`).toBeLessThan(0.006);
      expect(deep, `${p.family} ${p.outfit}: through it by more than a millimetre`).toBeLessThanOrEqual(2);
    }
  }, 300000);

  it("lies under the hair and the beard, which are built over it", () => {
    // Long hair hangs down the back over the tunic, not into it; a full beard lowers the collar at the front
    const bare = { ...human("none"), hairStyle: "long" as const };
    const reach = (p: Params) => {
      let back = Infinity;
      buildBust(p, assets, false).traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.name !== "curtain") return;
        const position = o.geometry.attributes.position;
        for (let i = 0; i < position.count; i++) if (position.getY(i) < -1.0) back = Math.min(back, position.getZ(i));
      });
      return back;
    };
    expect(reach({ ...bare, outfit: "armour" })).toBeLessThan(reach(bare) - 2 * MM);
    const collar = (p: Params) => {
      const body = bodySurface(p, assets);
      const tunic = buildOutfit(p, body)!.garments[0];
      let top = -Infinity;
      for (let i = 0; i < tunic.outside! * 3; i += 3) if (Math.abs(tunic.positions[i]) < 0.05 && tunic.positions[i + 2] > body.anchors.sternum.position.z - 0.2) top = Math.max(top, tunic.positions[i + 1]);
      return top;
    };
    expect(collar({ ...human("tunic"), beardStyle: "full" })).toBeLessThan(collar(human("tunic")) - 0.03);
  }, 120000);

  it("is kept for its body: changing the hair or a colour fits nothing anew, changing the outfit is a new print", () => {
    const p = human("armour");
    const body = bodySurface(p, assets);
    expect(buildOutfit({ ...p, hairStyle: "mohawk" }, body)).toBe(buildOutfit(p, body));
    expect(printKey(p, true, true)).not.toBe(printKey({ ...p, outfit: "tunic" }, true, true));
    expect(buildOutfit({ ...p, cloak: "cloak" }, body)).not.toBe(buildOutfit(p, body));
  });

  it("is kept for the shape it was fitted to: a new face puts the same fit on again, a new body fits it anew", () => {
    const p = human("armour", "cowl");
    const fitted = buildOutfit(p, bodySurface(p, assets))!;
    for (const face of [{ cheekbones: 0.8 }, { noseSize: 0.2 }, { smile: 0.7 }]) {
      const q = { ...p, ...face };
      const body = bodySurface(q, assets);
      expect(fittedAlready(q, body), JSON.stringify(face)).toBe(true);
      const again = buildOutfit(q, body)!;
      expect(again.garments).toBe(fitted.garments);
      // (and dressed over this body's own points: the face as now sculpted, the clothes where they were)
      expect(Array.from(again.dressed)).toEqual(Array.from(body.fitting.positions).map((v, i) => (fitted.dressed[i] !== bodySurface(p, assets).fitting.positions[i] ? fitted.dressed[i] : v)));
    }
    for (const shape of [{ weight: 0.9 }, { torso: 0.7 }, { jawOpen: 0.8 }]) {
      const q = { ...p, ...shape };
      expect(fittedAlready(q, bodySurface(q, assets)), JSON.stringify(shape)).toBe(false);
    }
  }, 120000);

  it("is fitted to the one inch square with the bust at tabletop size", () => {
    const t = collectTabletop(human("armour", "cowl"), assets, true);
    expect(t.parts.some((part) => part.name === "pauldron")).toBe(true);
    expect(t.parts.some((part) => part.name === "cloak")).toBe(true);
    expect(Math.max(t.width, t.depth)).toBeLessThanOrEqual(25 * 1.002);
    // (and says honestly that the clothes' finest relief comes out finer than prints, at this size)
    expect(t.notes.some((note) => note.includes("finest relief of the clothes"))).toBe(true);
    console.log(`armoured human at tabletop size: ${t.height.toFixed(1)} mm tall, torso ${Math.round(t.params.torso * 100)}%; ${t.notes.join(" ")}`);
  }, 300000);
});
