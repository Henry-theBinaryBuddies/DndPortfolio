import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultParams } from "./params";

// A stand-in for the browser's Worker: records what it is sent, and lets each test answer, fail or refuse
class FakeWorker {
  static made: FakeWorker[] = [];
  static refuse = false;
  sent: { id: number }[] = [];
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(message: { id: number }) {
    if (FakeWorker.refuse) throw new Error("could not be cloned");
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  answer(id: number) {
    this.onmessage?.({ data: { id, prepared: { key: `answer ${id}`, parts: [] } } });
  }
}

let client: typeof import("./prepareClient");
beforeEach(async () => {
  FakeWorker.made = [];
  FakeWorker.refuse = false;
  vi.stubGlobal("Worker", FakeWorker);
  // (each test with a client of its own: no worker, nothing waiting)
  vi.resetModules();
  client = await import("./prepareClient");
});
afterEach(() => vi.unstubAllGlobals());

const ask = (latest = false) => client.prepareInBackground(defaultParams(), false, true, latest);

describe("the print worker's client", () => {
  it("answers each request by its own id", async () => {
    const [a, b] = [ask(), ask()];
    const [worker] = FakeWorker.made;
    worker.answer(worker.sent[1].id);
    worker.answer(worker.sent[0].id);
    expect((await a).key).toBe(`answer ${worker.sent[0].id}`);
    expect((await b).key).toBe(`answer ${worker.sent[1].id}`);
  });

  it("fails everything waiting when the worker fails, and starts a new one for the next request", async () => {
    const waiting = [ask(), ask()];
    FakeWorker.made[0].onerror!({ message: "out of memory" });
    for (const request of waiting) await expect(request).rejects.toThrow("out of memory");
    expect(FakeWorker.made[0].terminated).toBe(true);
    const again = ask();
    expect(FakeWorker.made).toHaveLength(2);
    FakeWorker.made[1].answer(FakeWorker.made[1].sent[0].id);
    await expect(again).resolves.toBeTruthy();
  });

  it("fails what is waiting when an answer cannot be read", async () => {
    const request = ask();
    FakeWorker.made[0].onmessageerror!();
    await expect(request).rejects.toThrow("could not be read");
    expect(FakeWorker.made[0].terminated).toBe(true);
  });

  it("fails a request that could not be sent, and leaves nothing of it waiting", async () => {
    FakeWorker.refuse = true;
    await expect(ask()).rejects.toThrow("could not be cloned");
    FakeWorker.refuse = false;
    // (a newer request is not taken for one still in hand: nothing is superseded)
    const next = ask(true);
    expect(FakeWorker.made).toHaveLength(1);
    FakeWorker.made[0].answer(FakeWorker.made[0].sent[0].id);
    await expect(next).resolves.toBeTruthy();
  });

  it("lets the latest request take the place of one still being prepared", async () => {
    const older = ask(true);
    const newer = ask(true);
    await expect(older).rejects.toBeInstanceOf(client.Superseded);
    expect(FakeWorker.made[0].terminated).toBe(true);
    // (a late failure of the stopped worker does not touch the new one's request)
    FakeWorker.made[0].onerror!({ message: "late" });
    FakeWorker.made[1].answer(FakeWorker.made[1].sent[0].id);
    await expect(newer).resolves.toBeTruthy();
  });
});
