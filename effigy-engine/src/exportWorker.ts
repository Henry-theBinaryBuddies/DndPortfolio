import wasmUrl from "manifold-3d/manifold.wasm?url";
import { mergeParts, type Part } from "./printable";

// The merge of a bust's parts into one solid, off the page's own thread (it takes seconds on a bust with hair
// and a beard, and the page must stay alive). It takes the parts as typed arrays, and answers with the STL
// and the report, or the reason it failed. Each request carries an id, so a slow answer to an old request is
// never mistaken for the current one.

interface Request {
  id: number;
  parts: Part[];
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, parts } = event.data;
  try {
    const { stl, report } = await mergeParts(parts, (text) => self.postMessage({ id, progress: text }), wasmUrl);
    self.postMessage({ id, stl, report }, { transfer: [stl] });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
