/// <reference lib="webworker" />
import { loadAssets, type Assets } from "./assets";
import { loadDragonborn } from "./dragonborn";
import type { Params } from "./params";
import { preparePrint, type Prepared } from "./printPreview";
import { useSiteBase } from "./site";

// The print prepared off the page (audit 19): the parts as the export will merge them, and at tabletop size the fit,
// whose repeated builds took seconds and held the page still meanwhile. The worker loads its own copy of the models
// (the Dragonborn's only when one is asked for) and keeps them, and runs the very preparePrint the page used to run.
// The parts go back to the page without being copied (their arrays are handed over).

let assets: Promise<Assets> | null = null;

self.onmessage = async (event: MessageEvent<{ id: number; params: Params; gusset: boolean; tabletop: boolean; base: string }>) => {
  const { id, params, gusset, tabletop, base } = event.data;
  try {
    // (the models are found from the page's address, not this script's: see site.ts)
    useSiteBase(base);
    assets ??= loadAssets();
    const loaded = await assets;
    if (params.family === "dragonborn" && !loaded.dragonborn) loaded.dragonborn = await loadDragonborn();
    const prepared: Prepared = preparePrint(params, loaded, gusset, tabletop);
    // (each array once: the tabletop fit's parts are the prepared parts themselves)
    const buffers = new Set<ArrayBuffer>();
    for (const part of prepared.parts) buffers.add(part.positions.buffer as ArrayBuffer).add(part.indices.buffer as ArrayBuffer);
    self.postMessage({ id, prepared }, [...buffers]);
  } catch (error) {
    // (the models are loaded again next time if loading them failed)
    if (!(await assets?.catch(() => null))) assets = null;
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
