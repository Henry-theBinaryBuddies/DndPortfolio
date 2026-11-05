import type { Params } from "./params";
import type { Prepared } from "./printPreview";

// The page's side of the print preparation worker (see prepareWorker.ts): one worker, started the first time it is
// needed and kept; each request is answered by its own id, so answers never cross. Whether an answer is still for the
// settings on show is for the caller to judge (see ui.ts: each edit starts a new generation).

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (prepared: Prepared) => void; reject: (error: Error) => void }>();

function start(): Worker {
  const made = new Worker(new URL("./prepareWorker.ts", import.meta.url), { type: "module" });
  made.onmessage = (event: MessageEvent<{ id: number; prepared?: Prepared; error?: string }>) => {
    const asked = waiting.get(event.data.id);
    if (!asked) return;
    waiting.delete(event.data.id);
    if (event.data.prepared) asked.resolve(event.data.prepared);
    else asked.reject(new Error(event.data.error ?? "the print could not be prepared"));
  };
  // (if the worker itself fails, everything it was asked fails with it, and the next request starts a new one)
  made.onerror = (event) => {
    for (const [, asked] of waiting) asked.reject(new Error(event.message || "the print worker stopped unexpectedly"));
    waiting.clear();
    made.terminate();
    worker = null;
  };
  return made;
}

export function prepareInBackground(params: Params, gusset: boolean, tabletop: boolean): Promise<Prepared> {
  worker ??= start();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker!.postMessage({ id, params, gusset, tabletop });
  });
}
