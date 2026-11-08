import { afterEach, describe, expect, it, vi } from "vitest";

// The built site's base is "./" (see vite.config.ts): its files must be found from the page's address, in the page and
// in a worker alike (a worker resolving them against its own script, in assets/, was served the page instead)
describe("the site's own files", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("are found from the page's address, wherever the site is", async () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", { baseURI: "https://example.com/tools/effigy/index.html" });
    vi.resetModules();
    const site = await import("./site");
    expect(site.siteUrl("models/head.bin")).toBe("https://example.com/tools/effigy/models/head.bin");
    expect(site.siteBase()).toBe("https://example.com/tools/effigy/");
  });

  it("are found from the address a worker is told, not its own", async () => {
    vi.stubEnv("BASE_URL", "./");
    vi.resetModules();
    const site = await import("./site");
    site.useSiteBase("https://example.com/tools/effigy/");
    expect(site.siteUrl("models/dragonborn.bin")).toBe("https://example.com/tools/effigy/models/dragonborn.bin");
  });
});
