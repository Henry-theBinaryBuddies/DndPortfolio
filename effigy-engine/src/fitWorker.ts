/// <reference lib="webworker" />
import { fromParts, type SurfaceParts } from "./bodySurface";
import { fit } from "./garments";
import type { Params } from "./params";

// Clothing fitted off the page (audit 21): a fit takes a second or more, and on the page it held the view and the
// controls still meanwhile. The page sends the body as it sculpted it (see bodySurface.ts), and the outfit fitted to it
// goes back, its arrays handed over rather than copied, to be kept there for that shape (see keepFit in garments.ts).

self.onmessage = (event: MessageEvent<{ id: number; params: Params; body: SurfaceParts }>) => {
  const { id, params, body } = event.data;
  try {
    const fitted = fit(params, fromParts(body));
    const buffers = new Set<ArrayBuffer>([fitted.moved.buffer as ArrayBuffer, fitted.to.buffer as ArrayBuffer]);
    for (const garment of fitted.garments) buffers.add(garment.positions.buffer as ArrayBuffer).add(garment.indices.buffer as ArrayBuffer);
    self.postMessage({ id, fitted }, [...buffers]);
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
