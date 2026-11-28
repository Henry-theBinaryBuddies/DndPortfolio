import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * `npm run preview` sends the headers Cloudflare Pages will (from public/_headers), so the built site can be checked
 * under its real Content-Security-Policy before it goes online. Each block is a path ("/*", "/assets/*") and its
 * indented headers; later blocks add to earlier ones, as on Cloudflare.
 */
function pagesHeaders(): Plugin {
  const blocks: { path: string; headers: [string, string][] }[] = [];
  for (const line of readFileSync(new URL("./public/_headers", import.meta.url), "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) blocks.push({ path: line.trim(), headers: [] });
    else {
      const at = line.indexOf(":");
      blocks.at(-1)?.headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
    }
  }
  const matches = (path: string, url: string) => (path.endsWith("*") ? url.startsWith(path.slice(0, -1)) : url === path);
  return {
    name: "pages-headers",
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "/").split("?")[0];
        for (const b of blocks) if (matches(b.path, url)) for (const [k, v] of b.headers) res.setHeader(k, v);
        next();
      });
    },
  };
}

// base "./" keeps asset and pack URLs relative, so the built site works from any subfolder.
// The dev server always uses port 5205 and refuses to start if it is taken (Creature Cauldron uses 5199,
// Effigy Engine 5201 and 5203), because the Milestone 2 API will only accept requests from known page addresses.
export default defineConfig({
  base: "./",
  plugins: [react(), pagesHeaders()],
  server: { port: 5205, strictPort: true },
  preview: { port: 5206, strictPort: true },
  // The browser tests in e2e/ and e2e-production/ are Playwright's (npm run test:browser, test:production), not Vitest's.
  test: { exclude: ["e2e/**", "e2e-production/**", "node_modules/**"] },
});
