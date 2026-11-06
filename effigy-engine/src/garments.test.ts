import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { parseAssets, SHAPE_NAMES, type Assets, type ShapeName } from "./assets";
import { bodySurface } from "./bodySurface";
import { buildBust } from "./builder";
import { parseDragonborn, type DragonbornManifest } from "./dragonborn";
import { collectBust } from "./export";
import { collectTabletop } from "./fit";
import { buildOutfit } from "./garments";
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

const human = (outfit: Params["outfit"]): Params => ({ ...applyRace(defaultParams(), "human"), outfit });
const dragonborn = (outfit: Params["outfit"]): Params => ({ ...defaultParams(), family: "dragonborn", outfit });

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
      expect(names(p("armour"))).toEqual(["tunic", "cuirass", "pauldron", "pauldron"]);
    }
  });

  it("stands clear of the body everywhere above the flat cut, nearly all of it by a millimetre or more", () => {
    for (const p of [human("armour"), dragonborn("armour")]) {
      const body = bodySurface(p, assets);
      const outfit = buildOutfit(p, body)!;
      const cutY = body.baseY + body.cut * MM + 0.1;
      const point = new THREE.Vector3();
      for (const garment of outfit.garments) {
        // (its outside is the first half of its vertices: see garments.ts)
        const outside = garment.positions.length / 6;
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
    for (const p of [human("tunic"), dragonborn("tunic")].concat([0.6, 1.1].flatMap((torso) => [{ ...human("armour"), torso }, { ...dragonborn("armour"), torso }]))) {
      const { parts, flatCut } = collectBust(p, assets);
      const { report } = await mergeParts(parts, undefined, undefined, flatCut);
      expect(report.components, `${p.family} ${p.outfit} torso ${p.torso}`).toHaveLength(1);
      expect(report.badEdges).toBe(0);
    }
  }, 600000);

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
      for (let i = 0; i < tunic.positions.length / 2; i += 3) if (Math.abs(tunic.positions[i]) < 0.05 && tunic.positions[i + 2] > body.anchors.sternum.position.z - 0.2) top = Math.max(top, tunic.positions[i + 1]);
      return top;
    };
    expect(collar({ ...human("tunic"), beardStyle: "full" })).toBeLessThan(collar(human("tunic")) - 0.03);
  }, 120000);

  it("is kept for its body: changing the hair or a colour fits nothing anew, changing the outfit is a new print", () => {
    const p = human("armour");
    const body = bodySurface(p, assets);
    expect(buildOutfit({ ...p, hairStyle: "mohawk" }, body)).toBe(buildOutfit(p, body));
    expect(printKey(p, true, true)).not.toBe(printKey({ ...p, outfit: "tunic" }, true, true));
  });

  it("is fitted to the one inch square with the bust at tabletop size", () => {
    const t = collectTabletop(human("armour"), assets, true);
    expect(t.parts.some((part) => part.name === "pauldron")).toBe(true);
    expect(Math.max(t.width, t.depth)).toBeLessThanOrEqual(25 * 1.002);
    console.log(`armoured human at tabletop size: ${t.height.toFixed(1)} mm tall, torso ${Math.round(t.params.torso * 100)}%; ${t.notes.join(" ")}`);
  }, 300000);
});
