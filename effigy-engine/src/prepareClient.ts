import type { Params } from "./params";
import type { Prepared } from "./printPreview";

// The page's side of the print preparation worker (see prepareWorker.ts): one worker, started the first time it is
// needed and kept; each request is answered by its own id, so answers never cross. Whether an answer is still for the
// settings on show is for the caller to judge (see ui.ts: each edit starts a new generation).

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (prepared: Prepared) => void; reject: (error: Error) => void }>();

// What a request is answered with when a newer one has taken its place (see prepareInBackground)
export class Superseded extends Error {
  constructor() {
    super("a newer print was asked for");
  }
}

// Everything still waiting fails, and the worker is stopped: the next request starts a new one
function fail(error: Error) {
  const asked = [...waiting.values()];
  waiting.clear();
  worker?.terminate();
  worker = null;
  for (const { reject } of asked) reject(error);
}

function start(): Worker {
  const made = new Worker(new URL("./prepareWorker.ts", import.meta.url), { type: "module" });
  made.onmessage = (event: MessageEvent<{ id: number; prepared?: Prepared; error?: string }>) => {
    const asked = waiting.get(event.data.id);
    if (!asked) return;
    waiting.delete(event.data.id);
    if (event.data.prepared) asked.resolve(event.data.prepared);
    else asked.reject(new Error(event.data.error ?? "the print could not be prepared"));
  };
  // (if the worker itself fails, or an answer cannot be read, everything it was asked fails with it; a worker already
  // replaced has nothing left to fail)
  made.onerror = (event) => {
    if (worker === made) fail(new Error(event.message || "the print worker stopped unexpectedly"));
  };
  made.onmessageerror = () => {
    if (worker === made) fail(new Error("the print worker's answer could not be read"));
  };
  return made;
}

// `latest`: this request takes the place of any still being prepared (they fail with Superseded), as a preview of
// newer settings does: the worker cannot be interrupted, so it is stopped and a new one started
export function prepareInBackground(params: Params, gusset: boolean, tabletop: boolean, latest = false): Promise<Prepared> {
  if (latest && waiting.size > 0) fail(new Superseded());
  worker ??= start();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    try {
      worker!.postMessage({ id, params, gusset, tabletop });
    } catch (error) {
      // (not sent: nothing will answer it)
      waiting.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
