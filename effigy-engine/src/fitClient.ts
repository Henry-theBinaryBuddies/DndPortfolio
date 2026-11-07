import { surfaceParts, type BodySurface } from "./bodySurface";
import type { Fitted } from "./garments";
import type { Params } from "./params";

// The page's side of the clothing worker (see fitWorker.ts): one worker, started the first time it is needed and kept,
// each request answered by its own id. Which of its answers is still wanted is for the caller to judge (see main.ts:
// only the latest settings are fitted, and the bust on show stays until they are).

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (fitted: Fitted) => void; reject: (error: Error) => void }>();

function fail(error: Error) {
  const asked = [...waiting.values()];
  waiting.clear();
  worker?.terminate();
  worker = null;
  for (const { reject } of asked) reject(error);
}

function start(): Worker {
  const made = new Worker(new URL("./fitWorker.ts", import.meta.url), { type: "module" });
  made.onmessage = (event: MessageEvent<{ id: number; fitted?: Fitted; error?: string }>) => {
    const asked = waiting.get(event.data.id);
    if (!asked) return;
    waiting.delete(event.data.id);
    if (event.data.fitted) asked.resolve(event.data.fitted);
    else asked.reject(new Error(event.data.error ?? "the clothes could not be fitted"));
  };
  made.onerror = (event) => {
    if (worker === made) fail(new Error(event.message || "the clothing worker stopped unexpectedly"));
  };
  made.onmessageerror = () => {
    if (worker === made) fail(new Error("the clothing worker's answer could not be read"));
  };
  return made;
}

export function fitInBackground(params: Params, body: BodySurface): Promise<Fitted> {
  worker ??= start();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    try {
      // (the body's arrays are copied, not handed over: the page keeps them)
      worker!.postMessage({ id, params, body: surfaceParts(body) });
    } catch (error) {
      waiting.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
