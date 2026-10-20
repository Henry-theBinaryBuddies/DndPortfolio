import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadTextFile } from "./download";

// The real function needs a browser. These tests give it a tiny pretend page (vi.stubGlobal) and
// check that it does the right things in the right order.
describe("downloadTextFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function pretendPage() {
    const calls: string[] = [];
    const link = {
      href: "",
      download: "",
      click: () => calls.push("click"),
      remove: () => calls.push("remove"),
    };
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        calls.push(`create:${tag}`);
        return link;
      },
      body: { appendChild: () => calls.push("append") },
    });
    const created: Blob[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return "blob:fake-address";
      },
      revokeObjectURL: (url: string) => calls.push(`revoke:${url}`),
    });
    return { calls, link, created };
  }

  it("clicks a link that is on the page, then removes it", () => {
    vi.useFakeTimers();
    const { calls, link } = pretendPage();
    downloadTextFile("monster-x.json", "{}");
    expect(link.href).toBe("blob:fake-address");
    expect(link.download).toBe("monster-x.json");
    expect(calls).toEqual(["create:a", "append", "click", "remove"]);
  });

  it("releases the temporary address only after a delay", () => {
    vi.useFakeTimers();
    const { calls } = pretendPage();
    downloadTextFile("x.json", "{}");
    expect(calls).not.toContain("revoke:blob:fake-address");
    vi.advanceTimersByTime(1000);
    expect(calls).toContain("revoke:blob:fake-address");
  });

  it("puts the text in a blob with the given type", async () => {
    vi.useFakeTimers();
    const { created } = pretendPage();
    downloadTextFile("x.json", '{"a":1}');
    expect(created[0].type).toBe("application/json");
    expect(await created[0].text()).toBe('{"a":1}');
  });
});
